import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { createLogger } from './logger.js';
import { RoomManager } from './room-manager.js';
import { SessionManager, hashPassword, verifyPassword } from './auth.js';
import { Storage } from './storage.js';
import { testConnection, connectToServer, updateStreamMetadata, buildListenerUrl } from './integration-relay.js';
import { identifyAudio } from './audio-identify.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const REQUIRE_TLS = process.env.REQUIRE_TLS === 'true';
const DEFAULT_SESSION_SECRET = 'dev-secret-change-in-production';
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SECURE_COOKIES = REQUIRE_TLS || IS_PRODUCTION;
const SERVER_STARTED_AT = Date.now();

// App version (read once from the repo-root VERSION file)
let APP_VERSION = 'unknown';
try {
  APP_VERSION = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
} catch { /* VERSION file missing */ }

// TURN — option A: Metered.ca dynamic credentials (recommended)
const METERED_APP_NAME = process.env.METERED_APP_NAME || '';   // e.g. quetalcast.metered.live
const METERED_API_KEY = process.env.METERED_API_KEY || '';
// TURN — option B: Static credentials (any TURN provider)
const TURN_URL = process.env.TURN_URL || '';
const TURN_USERNAME = process.env.TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';

const logger = createLogger('server');
const storage = new Storage(logger);
const rooms = new RoomManager(logger, storage);
const sessions = new SessionManager(SESSION_SECRET, storage);

// Production guard: refuse to boot with dev credentials in production.
// ADMIN_PASSWORD only matters while the users table is empty (it seeds the
// bootstrap admin account); once real users exist it is ignored.
if (IS_PRODUCTION) {
  if (SESSION_SECRET === DEFAULT_SESSION_SECRET) {
    logger.fatal('SESSION_SECRET is the dev default. Set a strong SESSION_SECRET before running in production.');
    process.exit(1);
  }
  if (ADMIN_PASSWORD === 'admin' && storage.countUsers() === 0) {
    logger.fatal('ADMIN_PASSWORD is "admin" and no users exist. Set ADMIN_PASSWORD before first production boot.');
    process.exit(1);
  }
}

// Bootstrap: seed the first owner account so existing logins keep working
if (storage.countUsers() === 0) {
  storage.createUser({
    id: crypto.randomUUID(),
    username: 'admin',
    role: 'owner',
    passwordHash: hashPassword(ADMIN_PASSWORD),
  });
  logger.info('Bootstrapped initial "admin" owner account from ADMIN_PASSWORD');
}

// Express setup
const app = express();
app.use(express.json({ limit: '16kb' })); // Fix: explicit size limit
app.use(cookieParser());
app.set('trust proxy', 1); // Fix #4: trust first proxy hop (Fly.io etc.)

// Fix #2: CORS — don't reflect arbitrary origins with credentials
app.use((req, res, next) => {
  if (ALLOWED_ORIGIN === '*') {
    // Wildcard: no credentials, open access
    res.header('Access-Control-Allow-Origin', '*');
  } else {
    // Specific origin: allow credentials
    res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// TLS enforcement
if (REQUIRE_TLS) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.status(403).json({ error: 'HTTPS required' });
    }
    next();
  });
}

// Rate limiting
const loginLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many login attempts' } });
const musicLimiter = rateLimit({ windowMs: 60000, max: 30, message: { error: 'Too many music lookups' } });

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies.session;
  const session = token ? sessions.validate(token) : null;
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = session;
  next();
}

// Owner-only middleware (use after requireAuth)
function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

// Health check (no auth) - used by Fly.io http checks and monitoring
app.get('/health', (req, res) => {
  let liveRooms = 0;
  for (const [, room] of rooms.rooms) {
    if (room.broadcaster && room.broadcaster.readyState === 1) liveRooms++;
  }
  res.json({
    ok: true,
    uptime: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
    rooms: rooms.rooms.size,
    liveRooms,
    ffmpeg: !!ffmpegPath,
    version: APP_VERSION,
  });
});

// Auth routes
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = typeof username === 'string' ? storage.getUserByUsername(username.trim()) : null;
  if (user && !user.disabled && typeof password === 'string' && verifyPassword(password, user.password_hash)) {
    const token = sessions.create(user.id);
    res.cookie('session', token, {
      httpOnly: true,
      secure: SECURE_COOKIES,
      sameSite: 'strict',
      maxAge: 86400000, // 24h
    });
    logger.info({ username: user.username }, 'Login successful');
    res.json({ ok: true, username: user.username, role: user.role });
  } else {
    logger.warn('Login failed');
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) sessions.destroy(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

// Session check - lets the client verify if the session is still valid
app.get('/api/session', (req, res) => {
  const token = req.cookies.session;
  const session = token ? sessions.validate(token) : null;
  if (session) {
    res.json({ ok: true, authenticated: true, username: session.username, role: session.role });
  } else {
    res.status(401).json({ ok: false, authenticated: false });
  }
});

// Feature capabilities for the logged-in client
app.get('/api/capabilities', requireAuth, (req, res) => {
  res.json({ autoIdentify: !!process.env.ACOUSTID_API_KEY });
});

// ---------------------------------------------------------------------------
// User management (owner only) + invite flow
// ---------------------------------------------------------------------------
const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$/;

function serializeUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: !!u.disabled,
    createdAt: u.created_at,
    lastActiveAt: u.last_active_at || null,
  };
}

function createInviteFor(userId, purpose) {
  const token = crypto.randomBytes(24).toString('base64url');
  storage.createInvite({ token, userId, purpose, expiresAt: Date.now() + INVITE_TTL_MS });
  return { inviteToken: token, inviteUrl: `/join/${token}` };
}

app.get('/api/users', requireAuth, requireOwner, (req, res) => {
  res.json({ users: storage.listUsers().map(serializeUser) });
});

app.post('/api/users', requireAuth, requireOwner, (req, res) => {
  const { username, role } = req.body || {};
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid username (2-32 chars: letters, numbers, . _ -)' });
  }
  if (role !== 'owner' && role !== 'dj') {
    return res.status(400).json({ error: 'Role must be "owner" or "dj"' });
  }
  if (storage.getUserByUsername(name)) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const id = crypto.randomUUID();
  storage.createUser({ id, username: name, role });
  const invite = createInviteFor(id, 'invite');
  logger.info({ username: name, role }, 'User created');
  res.json({ id, ...invite });
});

app.post('/api/users/:id/reset', requireAuth, requireOwner, (req, res) => {
  const user = storage.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const invite = createInviteFor(user.id, 'reset');
  storage.revokeUserSessions(user.id);
  logger.info({ username: user.username }, 'Password reset invite issued');
  res.json({ ok: true, ...invite });
});

app.patch('/api/users/:id', requireAuth, requireOwner, (req, res) => {
  const user = storage.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { disabled } = req.body || {};
  if (typeof disabled !== 'boolean') {
    return res.status(400).json({ error: 'Expected { disabled: boolean }' });
  }
  if (disabled) {
    if (user.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot disable your own account' });
    }
    if (user.role === 'owner' && !user.disabled && storage.countEnabledOwners() <= 1) {
      return res.status(400).json({ error: 'Cannot disable the last enabled owner' });
    }
  }
  storage.setUserDisabled(user.id, disabled);
  if (disabled) storage.revokeUserSessions(user.id);
  logger.info({ username: user.username, disabled }, 'User disabled flag updated');
  res.json({ ok: true, user: serializeUser(storage.getUserById(user.id)) });
});

app.delete('/api/users/:id', requireAuth, requireOwner, (req, res) => {
  const user = storage.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (user.role === 'owner' && !user.disabled && storage.countEnabledOwners() <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last enabled owner' });
  }
  storage.deleteUser(user.id);
  logger.info({ username: user.username }, 'User deleted');
  res.json({ ok: true });
});

/** Look up an invite token. Returns the invite row + user, or null if invalid. */
function resolveInvite(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const invite = storage.getInvite(token);
  if (!invite || invite.used_at || invite.expires_at <= Date.now()) return null;
  const user = storage.getUserById(invite.user_id);
  if (!user || user.disabled) return null;
  return { invite, user };
}

// Invite flow (no auth) - lets an invited user set their password
app.get('/api/invite/:token', (req, res) => {
  const resolved = resolveInvite(req.params.token);
  if (!resolved) return res.json({ valid: false });
  res.json({ valid: true, username: resolved.user.username, purpose: resolved.invite.purpose });
});

app.post('/api/invite/:token', loginLimiter, (req, res) => {
  const resolved = resolveInvite(req.params.token);
  if (!resolved) return res.status(400).json({ error: 'Invalid or expired invite' });
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  storage.setUserPassword(resolved.user.id, hashPassword(password));
  storage.markInviteUsed(resolved.invite.token);
  logger.info({ username: resolved.user.username, purpose: resolved.invite.purpose }, 'Invite completed - password set');
  res.json({ ok: true });
});

// ICE server configuration — returns STUN + TURN servers for WebRTC
// Supports Metered.ca dynamic credentials or static TURN credentials.
// Caches Metered response for 5 minutes to avoid hammering their API.
let meteredCache = { iceServers: null, expiresAt: 0 };

app.get('/api/ice-config', async (req, res) => {
  // Option A: Metered.ca — fetch temporary TURN credentials from their API
  if (METERED_APP_NAME && METERED_API_KEY) {
    const now = Date.now();
    if (meteredCache.iceServers && now < meteredCache.expiresAt) {
      return res.json({ iceServers: meteredCache.iceServers });
    }

    try {
      const url = `https://${METERED_APP_NAME}/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const servers = await resp.json();
        meteredCache = { iceServers: servers, expiresAt: now + 5 * 60 * 1000 };
        logger.info('ICE config: fetched TURN credentials from Metered');
        return res.json({ iceServers: servers });
      }
      logger.warn({ status: resp.status }, 'Metered API returned error');
    } catch (err) {
      logger.warn({ error: err.message }, 'Failed to fetch Metered TURN credentials');
    }
    // Fall through to static or STUN-only on error
  }

  // Option B: Static TURN credentials from env vars
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    const turnUrls = TURN_URL.split(',').map(u => u.trim()).filter(Boolean);
    iceServers.push({
      urls: turnUrls,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
    logger.debug('ICE config: STUN + static TURN');
  } else {
    logger.debug('ICE config: STUN only (no TURN configured)');
  }

  res.json({ iceServers });
});

// ---------------------------------------------------------------------------
// FFmpeg transcoding — converts WebM/Opus relay data to MP3 for listeners
// ---------------------------------------------------------------------------

// Resolve once at startup (top-level await — file is ESM)
let ffmpegPath;
try {
  // Try ffmpeg-static
  const mod = await import('ffmpeg-static').catch(() => null);
  ffmpegPath = mod?.default || null;
} catch { /* */ }
if (!ffmpegPath) {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpegPath = 'ffmpeg';
  } catch { /* */ }
}
if (ffmpegPath) {
  logger.info({ ffmpegPath }, 'FFmpeg found — relay transcoding enabled');
} else {
  logger.warn('FFmpeg not found — relay stream will serve raw WebM (install ffmpeg for MP3 support)');
}

/**
 * Spawns an FFmpeg process that reads WebM/Opus from stdin and writes MP3
 * to stdout. MP3 output chunks are distributed to all relay listeners.
 */
function startRoomTranscoder(room, roomId) {
  if (room.ffmpegProcess || !ffmpegPath) return;

  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+nobuffer+flush_packets',
    '-probesize', '4096',
    '-analyzeduration', '0',
    '-f', 'webm',
    '-i', 'pipe:0',
    '-f', 'mp3',
    '-codec:a', 'libmp3lame',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-flush_packets', '1',
    'pipe:1',
  ];

  const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  room.ffmpegProcess = proc;

  proc.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
      logger.warn({ roomId: roomId.slice(0, 8), error: err.message }, 'FFmpeg stdin error');
    }
  });

  proc.stdout.on('data', (mp3Data) => {
    for (const writer of room.relayListeners) {
      if (writer.dead) { room.relayListeners.delete(writer); continue; }
      try { writer.write(mp3Data); } catch { room.relayListeners.delete(writer); }
    }
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) logger.debug({ roomId: roomId.slice(0, 8) }, `FFmpeg: ${msg}`);
  });

  proc.on('error', (err) => {
    logger.error({ roomId: roomId.slice(0, 8), error: err.message }, 'FFmpeg process error');
    if (room.ffmpegProcess === proc) room.ffmpegProcess = null;
  });

  proc.on('close', (code) => {
    if (code && code !== 0 && code !== 255) {
      logger.warn({ roomId: roomId.slice(0, 8), code }, 'FFmpeg exited with error');
    }
    if (room.ffmpegProcess === proc) room.ffmpegProcess = null;
  });

  logger.info({ roomId: roomId.slice(0, 8) }, 'FFmpeg transcoder started (WebM→MP3)');
}

function stopRoomTranscoder(room) {
  if (!room.ffmpegProcess) return;
  const proc = room.ffmpegProcess;
  room.ffmpegProcess = null;
  try { proc.stdin.end(); } catch { /* already closed */ }
  setTimeout(() => {
    try { if (!proc.killed) proc.kill('SIGTERM'); } catch { /* already exited */ }
  }, 500);
}

// ---------------------------------------------------------------------------
// Silence keepalive — when the broadcaster disconnects unexpectedly, feed
// silent MP3 frames to relay listeners so VLC/RadioDJ don't drop the stream.
// After SILENCE_TIMEOUT_MS without a broadcaster rejoining, tear down for real.
// ---------------------------------------------------------------------------
const SILENCE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SILENCE_FRAME_INTERVAL_MS = 250;

let silentMp3Frame = null;

function generateSilentMp3Frame() {
  if (silentMp3Frame) return Promise.resolve();
  if (!ffmpegPath) return Promise.resolve();
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', '0.5',
      '-f', 'mp3', '-codec:a', 'libmp3lame', '-b:a', '128k',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('close', () => {
      if (chunks.length) silentMp3Frame = Buffer.concat(chunks);
      resolve();
    });
    proc.on('error', () => resolve());
  });
}

function startSilenceKeepalive(room, roomId) {
  if (room.silenceInterval || !silentMp3Frame) return;

  room.silenceInterval = setInterval(() => {
    for (const writer of room.relayListeners) {
      if (writer.dead) { room.relayListeners.delete(writer); continue; }
      try { writer.write(silentMp3Frame); } catch { room.relayListeners.delete(writer); }
    }
  }, SILENCE_FRAME_INTERVAL_MS);

  room.silenceTimeout = setTimeout(() => {
    logger.info({ roomId: roomId.slice(0, 8) }, 'Silence keepalive expired — tearing down relay');
    stopSilenceKeepalive(room);
    for (const writer of room.relayListeners) {
      try { writer.end(); } catch { /* ignore */ }
    }
    room.relayListeners.clear();
  }, SILENCE_TIMEOUT_MS);

  logger.info({ roomId: roomId.slice(0, 8) }, 'Silence keepalive started (10m timeout)');
}

function stopSilenceKeepalive(room) {
  if (room.silenceInterval) { clearInterval(room.silenceInterval); room.silenceInterval = null; }
  if (room.silenceTimeout) { clearTimeout(room.silenceTimeout); room.silenceTimeout = null; }
}

// Pre-generate the silent MP3 frame at startup
generateSilentMp3Frame().then(() => {
  if (silentMp3Frame) logger.info({ bytes: silentMp3Frame.length }, 'Silent MP3 frame generated for keepalive');
});

// ICY metadata constants for Icecast-compatible streaming
const ICY_METAINT = 16384;

/**
 * Wraps an HTTP response to interleave ICY metadata blocks every
 * ICY_METAINT bytes of audio data. Players that send "Icy-MetaData: 1"
 * expect this framing; others receive raw MP3 without metadata blocks.
 */
class IcyWriter {
  constructor(res, icyEnabled) {
    this.res = res;
    this.icyEnabled = icyEnabled;
    this.byteCount = 0;
    this.metaTitle = '';
    this.dead = false;
  }

  setTitle(title) {
    this.metaTitle = title || '';
  }

  write(data) {
    if (this.dead) return;
    try {
      if (!this.icyEnabled) {
        return this.res.write(data);
      }

      let offset = 0;
      while (offset < data.length) {
        const bytesUntilMeta = ICY_METAINT - this.byteCount;
        const end = Math.min(offset + bytesUntilMeta, data.length);
        const chunk = data.slice(offset, end);
        this.res.write(chunk);
        this.byteCount += chunk.length;
        offset = end;

        if (this.byteCount >= ICY_METAINT) {
          this._insertMetadata();
          this.byteCount = 0;
        }
      }
    } catch {
      this.dead = true;
    }
  }

  _insertMetadata() {
    if (!this.metaTitle) {
      this.res.write(Buffer.from([0]));
      return;
    }
    const metaStr = `StreamTitle='${this.metaTitle.replace(/'/g, "\\'")}';`;
    const metaBuf = Buffer.from(metaStr, 'utf8');
    const paddedLen = Math.ceil(metaBuf.length / 16) * 16;
    const block = Buffer.alloc(1 + paddedLen);
    block[0] = paddedLen / 16;
    metaBuf.copy(block, 1);
    this.res.write(block);
  }

  end() {
    if (this.dead) return;
    this.dead = true;
    try { this.res.end(); } catch { /* already closed */ }
  }
}

/** Update ICY metadata title on all relay listeners for a room */
function updateRelayMetadata(roomId, title) {
  const listeners = rooms.getRelayListeners(roomId);
  for (const writer of listeners) {
    if (writer.setTitle) writer.setTitle(title);
  }
}

// HTTP audio relay — serves MP3 audio (via FFmpeg) as an Icecast-compatible stream
// Falls back to raw WebM if FFmpeg is not available
app.get('/stream/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.rooms.get(roomId);

  if (!room) {
    return res.status(404).send('Room not found');
  }

  const usesMp3 = !!ffmpegPath;
  const wantsIcyMeta = usesMp3 && req.headers['icy-metadata'] === '1';

  const headers = {
    'Content-Type': usesMp3 ? 'audio/mpeg' : 'audio/webm',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache, no-store',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  };

  if (usesMp3) {
    headers['icy-name'] = room.streamTitle || 'QuetalCast';
    headers['icy-description'] = room.streamDescription || '';
    headers['icy-genre'] = 'Various';
    headers['icy-pub'] = '1';
    headers['icy-br'] = '128';
    headers['icy-sr'] = '44100';
    if (wantsIcyMeta) {
      headers['icy-metaint'] = String(ICY_METAINT);
    }
  }

  res.writeHead(200, headers);

  // When FFmpeg is active, wrap response in IcyWriter for ICY metadata interleaving.
  // FFmpeg stdout callback writes MP3 data to all listeners.
  // Without FFmpeg, raw WebM is forwarded directly (IcyWriter still wraps but
  // metadata interleaving is disabled since the format is WebM, not MP3).
  const writer = new IcyWriter(res, wantsIcyMeta);

  const meta = rooms.getMetadata(roomId);
  if (meta?.text) {
    writer.setTitle(meta.text);
  }

  // In WebM fallback mode, send the init segment so the player can start decoding
  if (!usesMp3 && room.relayHeader) {
    res.write(room.relayHeader);
  }

  const added = rooms.addRelayListener(roomId, writer);
  if (!added) {
    res.end();
    return;
  }

  logger.info({ roomId: roomId.slice(0, 8), format: usesMp3 ? 'mp3' : 'webm', icyMeta: wantsIcyMeta }, 'Relay listener connected');

  const cleanupListener = () => {
    if (writer.dead) return;
    writer.dead = true;
    rooms.removeRelayListener(roomId, writer);
    logger.info({ roomId: roomId.slice(0, 8) }, 'Relay listener disconnected');
  };
  req.on('close', cleanupListener);
  req.on('error', cleanupListener);
  res.on('error', cleanupListener);
});

// ---------------------------------------------------------------------------
// Admin API - room overview, force-end, analytics
// ---------------------------------------------------------------------------
app.get('/admin/rooms', requireAuth, (req, res) => {
  const now = Date.now();
  let liveRooms = 0;
  let listenersNow = 0;
  const roomList = [];

  for (const [roomId, room] of rooms.rooms) {
    const broadcasterConnected = !!(room.broadcaster && room.broadcaster.readyState === 1);
    const live = !room.endedAt;
    const receiverCount = rooms.getReceiverIds(roomId).length;
    const relayListenerCount = room.relayListeners.size;
    if (broadcasterConnected) liveRooms++;
    listenersNow += receiverCount + relayListenerCount;

    const createdMs = Date.parse(room.createdAt) || now;
    const endedMs = room.endedAt ? (Date.parse(room.endedAt) || now) : null;
    roomList.push({
      id: roomId,
      title: room.streamTitle || null,
      createdAt: room.createdAt,
      endedAt: room.endedAt || null,
      live,
      broadcasterConnected,
      receiverCount,
      relayListenerCount,
      peakListeners: room.peakListeners || 0,
      durationSec: Math.max(0, Math.floor(((endedMs ?? now) - createdMs) / 1000)),
    });
  }

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  res.json({
    stats: {
      liveRooms,
      listenersNow,
      peakToday: storage.getPeakListenersSince(midnight.getTime()),
      uptimeSec: Math.floor((now - SERVER_STARTED_AT) / 1000),
    },
    rooms: roomList,
  });
});

// Force-end a live room (owner only): closes all sockets politely and marks it ended
app.delete('/admin/rooms/:id', requireAuth, requireOwner, (req, res) => {
  const roomId = req.params.id;
  const room = rooms.rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  // Tear down relay resources first so the broadcaster's close handler
  // doesn't start the silence keepalive for a room we're force-ending.
  stopRoomTranscoder(room);
  stopSilenceKeepalive(room);
  room.relayHeader = null;
  for (const writer of room.relayListeners) {
    try { writer.end(); } catch { /* ignore */ }
  }
  room.relayListeners.clear();

  const endedMsg = JSON.stringify({ type: 'room-ended', reason: 'Ended by admin' });
  const receiverIds = rooms.getReceiverIds(roomId);
  for (const rid of receiverIds) {
    const rws = rooms.getReceiver(roomId, rid);
    if (rws) {
      try { rws.send(endedMsg); rws.close(1000, 'Room ended by admin'); } catch { /* ignore */ }
    }
  }

  if (room.broadcaster && room.broadcaster.readyState === 1) {
    try { room.broadcaster.send(endedMsg); room.broadcaster.close(1000, 'Room ended by admin'); } catch { /* ignore */ }
  }

  if (!room.endedAt) {
    room.endedAt = new Date().toISOString();
    try { storage.endRoom(roomId, Date.now()); } catch { /* non-fatal */ }
  }

  logger.info({ roomId: roomId.slice(0, 8), by: req.user.username }, 'Room force-ended by admin');
  res.json({ ok: true });
});

// Listener count samples for a room (last 24h)
app.get('/admin/rooms/:id/analytics', requireAuth, (req, res) => {
  const samples = storage.getListenerSamples(req.params.id, Date.now() - 24 * 60 * 60 * 1000);
  res.json({ samples: samples.map((s) => ({ ts: s.ts, count: s.count })) });
});

// Room slug history — saved custom room IDs with live status
app.get('/api/room-slugs', requireAuth, (req, res) => {
  res.json({ slugs: rooms.getSlugHistory() });
});

app.delete('/api/room-slugs/:slug', requireAuth, (req, res) => {
  const { slug } = req.params;
  if (!slug) return res.status(400).json({ ok: false });
  rooms.removeSlug(slug);
  res.json({ ok: true });
});

// Check if a room is recoverable (exists and can accept a broadcaster rejoin)
app.get('/api/room-status/:roomId', requireAuth, (req, res) => {
  const { roomId } = req.params;
  const room = rooms.rooms.get(roomId);
  if (!room) return res.json({ exists: false });
  const hasBroadcaster = room.broadcaster && room.broadcaster.readyState === 1;
  res.json({ exists: true, recoverable: !hasBroadcaster, hasListeners: room.relayListeners.size > 0 });
});

// Integration test — verify streaming credentials without starting a stream
const integrationTestLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many test attempts' } });

app.post('/api/integration-test', requireAuth, integrationTestLimiter, async (req, res) => {
  const { type, credentials } = req.body;
  if (!type || !credentials) {
    return res.status(400).json({ ok: false, error: 'Missing type or credentials' });
  }

  const validTypes = ['icecast', 'shoutcast', 'radio-co'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ ok: false, error: 'Invalid integration type' });
  }

  logger.info({ type }, 'Integration test requested');
  const result = await testConnection(type, credentials, logger);
  res.json(result);
});

// Deezer search proxy — avoids CORS issues with the Deezer API
app.get('/api/music-search', musicLimiter, async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string' || query.length < 2) {
    return res.json({ data: [] });
  }
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`;
    const response = await fetch(url);
    const data = await response.json();
    const results = (data.data || []).map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist?.name || '',
      album: t.album?.title || '',
      cover: t.album?.cover_small || '',
      coverMedium: t.album?.cover_medium || '',
      duration: t.duration || 0,
    }));
    res.json({ data: results });
  } catch (e) {
    logger.warn({ error: e.message }, 'Deezer search proxy error');
    res.json({ data: [] });
  }
});

// Deezer track detail proxy — fetches full metadata for a selected track
app.get('/api/music-detail/:id', musicLimiter, async (req, res) => {
  const trackId = req.params.id;
  if (!trackId || !/^\d+$/.test(trackId)) {
    return res.json({ data: null });
  }
  try {
    // Fetch track and album details in parallel
    const trackRes = await fetch(`https://api.deezer.com/track/${trackId}`);
    const track = await trackRes.json();
    if (track.error) return res.json({ data: null });

    let albumData = null;
    if (track.album?.id) {
      try {
        const albumRes = await fetch(`https://api.deezer.com/album/${track.album.id}`);
        albumData = await albumRes.json();
        if (albumData.error) albumData = null;
      } catch { /* album fetch optional */ }
    }

    const contributors = (track.contributors || []).map(c => ({
      name: c.name || '',
      role: c.role || '',
    }));

    const result = {
      id: track.id,
      title: track.title || '',
      artist: track.artist?.name || '',
      album: track.album?.title || '',
      cover: track.album?.cover_small || '',
      coverMedium: track.album?.cover_medium || '',
      duration: track.duration || 0,
      releaseDate: track.release_date || albumData?.release_date || '',
      isrc: track.isrc || '',
      bpm: track.bpm || 0,
      trackPosition: track.track_position || 0,
      diskNumber: track.disk_number || 0,
      explicitLyrics: !!track.explicit_lyrics,
      contributors,
      label: albumData?.label || '',
      genres: (albumData?.genres?.data || []).map(g => g.name),
    };
    res.json({ data: result });
  } catch (e) {
    logger.warn({ error: e.message }, 'Deezer detail proxy error');
    res.json({ data: null });
  }
});

// Audio identification — accepts raw PCM (signed 16-bit LE, mono, 22050 Hz)
const identifyLimiter = rateLimit({ windowMs: 10000, max: 2, message: { error: 'Too many identify requests' } });

app.post('/api/identify-audio', requireAuth, identifyLimiter, express.raw({ type: 'application/octet-stream', limit: '2mb' }), async (req, res) => {
  if (!req.body || req.body.length < 1000) {
    return res.status(400).json({ match: null, error: 'Audio data too short' });
  }

  if (!process.env.ACOUSTID_API_KEY) {
    return res.status(503).json({ match: null, error: 'Audio identification not configured (ACOUSTID_API_KEY missing)' });
  }

  try {
    const audioFormat = req.headers['x-audio-format'] || 'webm';
    const match = await identifyAudio(req.body, logger, audioFormat);
    res.json({ match });
  } catch (e) {
    logger.warn({ error: e.message }, 'Audio identify failed');
    res.status(500).json({ match: null, error: e.message });
  }
});

// Serve static frontend (production)
const staticPath = path.join(__dirname, '..', 'dist');
app.use(express.static(staticPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path.startsWith('/stream/')) return next();
  res.sendFile(path.join(staticPath, 'index.html'));
});

// HTTP + WebSocket server
const server = http.createServer(app);

// Fix #6: Set maxPayload to prevent memory exhaustion
// Signaling WSS — handles room/peer signaling
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 }); // 256KB — carries binary MP3 relay data

// Integration stream WSS — handles MP3 relay to Icecast/Shoutcast/Radio.co
// Higher maxPayload to accommodate MP3 chunks
const integrationWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

// Route WebSocket upgrades by URL path
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/integration-stream') {
    integrationWss.handleUpgrade(request, socket, head, (ws) => {
      integrationWss.emit('connection', ws, request);
    });
  } else {
    // Default: signaling WebSocket (also carries binary relay MP3 data)
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// WebSocket keep-alive — ping every 25s to prevent Fly.io proxy timeout (default ~60s)
const WS_PING_INTERVAL = 25000;
const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, WS_PING_INTERVAL);
wss.on('close', () => clearInterval(pingInterval));

const integrationPingInterval = setInterval(() => {
  for (const ws of integrationWss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, WS_PING_INTERVAL);
integrationWss.on('close', () => clearInterval(integrationPingInterval));

// WebSocket rate limiting
const wsJoinCounts = new Map();
const WS_JOIN_LIMIT = 20;
const WS_JOIN_WINDOW = 60000;

// Fix #9: Periodic cleanup of stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of wsJoinCounts) {
    const recent = timestamps.filter(t => now - t < WS_JOIN_WINDOW);
    if (recent.length === 0) {
      wsJoinCounts.delete(ip);
    } else {
      wsJoinCounts.set(ip, recent);
    }
  }
}, 5 * 60 * 1000);

/** Parse a cookie header string into a key-value map */
function parseCookies(header) {
  const map = {};
  if (!header) return map;
  header.split(';').forEach(pair => {
    const [key, ...rest] = pair.split('=');
    if (key) map[key.trim()] = rest.join('=').trim();
  });
  return map;
}

/** Validate SDP payload */
function isValidSdp(sdp) {
  return sdp && typeof sdp === 'object' && typeof sdp.sdp === 'string' && sdp.sdp.length <= 10000;
}

/** Validate ICE candidate payload */
function isValidCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  try { return JSON.stringify(candidate).length <= 2000; } catch { return false; }
}

/** Send current listener count to the broadcaster in a room */
function sendListenerCount(roomId) {
  const broadcaster = rooms.getBroadcaster(roomId);
  if (broadcaster) {
    const count = rooms.getReceiverIds(roomId).length;
    broadcaster.send(JSON.stringify({ type: 'listener-count', count }));
  }
}

wss.on('connection', (ws, req) => {
  // Fix #4: Use socket IP, not X-Forwarded-For (can't be spoofed)
  const ip = req.socket.remoteAddress || 'unknown';

  // Fix #5: Origin check — reject missing origin when checking is enabled
  if (ALLOWED_ORIGIN !== '*') {
    const origin = req.headers.origin;
    if (!origin || origin !== ALLOWED_ORIGIN) {
      logger.warn({ origin: origin || 'none', ip }, 'WebSocket rejected: origin mismatch');
      ws.close(4003, 'Origin not allowed');
      return;
    }
  }

  // Rate limit
  const now = Date.now();
  const joins = wsJoinCounts.get(ip) || [];
  const recent = joins.filter(t => now - t < WS_JOIN_WINDOW);
  if (recent.length >= WS_JOIN_LIMIT) {
    logger.warn({ ip }, 'WebSocket rate limited');
    ws.close(4029, 'Rate limited');
    return;
  }
  recent.push(now);
  wsJoinCounts.set(ip, recent);

  // Authenticate session from cookie (needed for broadcaster actions)
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.session || null;
  const sessionData = sessionToken ? sessions.validate(sessionToken) : null;
  const isAuthed = !!sessionData;

  // Keep-alive: mark connection as alive on pong
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let clientRoom = null;
  let clientRole = null;
  let clientReceiverId = null; // set when joining as receiver
  let lastChatTime = 0; // rate limit: 1 chat msg per second

  logger.info({ ip, authed: isAuthed }, 'WebSocket connected');

    let binaryCount = 0;
  ws.on('message', (raw, isBinary) => {
    if (isBinary && clientRoom && clientRole === 'broadcaster') {
      binaryCount++;
      const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const room = rooms.rooms.get(clientRoom);

      if (room) {
        if (ffmpegPath) {
          // FFmpeg transcoding: always restart transcoder on first chunk of a
          // new connection so it receives a fresh WebM header for probing.
          if (!room.ffmpegProcess) {
            startRoomTranscoder(room, clientRoom);
          }
          if (room.ffmpegProcess?.stdin.writable) {
            try { room.ffmpegProcess.stdin.write(data); } catch { /* EPIPE handled by stdin error handler */ }
          }
        } else {
          // WebM fallback: store first chunk as init segment for late-joining listeners
          if (binaryCount === 1) {
            room.relayHeader = data;
          }
          for (const writer of room.relayListeners) {
            if (writer.dead) { room.relayListeners.delete(writer); continue; }
            try {
              if (writer.res) writer.res.write(data);
              else writer.write(data);
            } catch { room.relayListeners.delete(writer); }
          }
        }
      }

      if (binaryCount === 1 || binaryCount % 500 === 0) {
        const listeners = rooms.getRelayListeners(clientRoom);
        logger.info({ roomId: clientRoom.slice(0, 8), binaryCount, bytes: data.length, listeners: listeners.size, transcoding: !!ffmpegPath }, 'Relay audio data');
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create-room': {
        if (!isAuthed) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication required', code: 'AUTH_REQUIRED' }));
          logger.warn({ ip }, 'Unauthenticated create-room attempt');
          break;
        }
        const customId = typeof msg.customId === 'string' ? msg.customId.toLowerCase().trim() : undefined;
        const createResult = rooms.create(customId || undefined, sessionData?.userId);
        if (!createResult.ok) {
          ws.send(JSON.stringify({ type: 'error', message: createResult.error, code: createResult.code }));
          break;
        }
        const roomId = createResult.roomId;
        const room = rooms.rooms.get(roomId);
        if (room) {
          rooms.setStreamInfo(
            roomId,
            typeof msg.streamTitle === 'string' ? msg.streamTitle.slice(0, 100) : undefined,
            typeof msg.streamDescription === 'string' ? msg.streamDescription.slice(0, 200) : undefined
          );
        }
        clientRoom = roomId;
        clientRole = 'broadcaster';
        rooms.join(roomId, 'broadcaster', ws);
        ws.send(JSON.stringify({ type: 'room-created', roomId }));
        ws.send(JSON.stringify({ type: 'joined', roomId, role: 'broadcaster' }));
        ws.send(JSON.stringify({ type: 'listener-count', count: 0 }));
        logger.info({ roomId: roomId.slice(0, 8), ip, custom: !!customId }, 'Room created');
        break;
      }

      case 'start-relay': {
        // Broadcaster requests relay stream setup — audio will be sent as binary frames
        if (!clientRoom || clientRole !== 'broadcaster') break;
        const isSecure = req.headers['x-forwarded-proto'] === 'https'
          || req.headers.origin?.startsWith('https')
          || req.socket.encrypted;
        const protocol = isSecure ? 'https' : 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
        const localStreamUrl = `${protocol}://${host}/stream/${clientRoom}`;

        // Store so receivers joining later can get it
        rooms.setIntegrationInfo(clientRoom, {
          ...(rooms.getIntegrationInfo(clientRoom) || {}),
          localStreamUrl,
        });

        // Broadcast stream URL to all connected receivers
        const streamUrlMsg = JSON.stringify({ type: 'stream-url', url: localStreamUrl });
        const relayReceiverIds = rooms.getReceiverIds(clientRoom);
        for (const rid of relayReceiverIds) {
          const rws = rooms.getReceiver(clientRoom, rid);
          if (rws) rws.send(streamUrlMsg);
        }

        ws.send(JSON.stringify({ type: 'relay-started', url: localStreamUrl }));
        logger.info({ roomId: clientRoom.slice(0, 8), localStreamUrl }, 'Relay stream: active via signaling WS');
        break;
      }

      case 'join-room': {
        const { roomId, role } = msg;
        if (!roomId || !role) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing roomId or role', code: 'MISSING_PARAMS' }));
          break;
        }
        if (role === 'broadcaster' && !isAuthed) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication required', code: 'AUTH_REQUIRED' }));
          logger.warn({ ip, roomId }, 'Unauthenticated broadcaster join attempt');
          break;
        }
        const result = rooms.join(roomId, role, ws);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'error', message: result.error, code: result.code }));
          break;
        }
        clientRoom = roomId;
        clientRole = role;

        if (role === 'receiver') {
          clientReceiverId = result.receiverId;
          ws.send(JSON.stringify({ type: 'joined', roomId, role }));

          // Tell the broadcaster about this new receiver
          const broadcaster = rooms.getBroadcaster(roomId);
          if (broadcaster) {
            broadcaster.send(JSON.stringify({ type: 'peer-joined', role: 'receiver', receiverId: clientReceiverId }));
            ws.send(JSON.stringify({ type: 'peer-joined', role: 'broadcaster' }));
          }
          sendListenerCount(roomId);
          // Send current metadata to the new receiver
          const currentMeta = rooms.getMetadata(roomId);
          if (currentMeta) {
            const initMetaPayload = { type: 'metadata', text: currentMeta.text };
            if (currentMeta.cover) initMetaPayload.cover = currentMeta.cover;
            ws.send(JSON.stringify(initMetaPayload));
          }
          // Send track list history
          const trackList = rooms.getTrackList(roomId);
          if (trackList.length > 0) {
            ws.send(JSON.stringify({ type: 'track-list', tracks: trackList }));
          }
          // Send chat history to the new receiver
          const chatHistory = rooms.getChatHistory(roomId);
          if (chatHistory.length > 0) {
            ws.send(JSON.stringify({ type: 'chat-history', messages: chatHistory }));
          }
          // Send stream URL if an integration or relay is active
          const integrationInfoForReceiver = rooms.getIntegrationInfo(roomId);
          if (integrationInfoForReceiver?.listenerUrl) {
            ws.send(JSON.stringify({ type: 'stream-url', url: integrationInfoForReceiver.listenerUrl }));
          } else if (integrationInfoForReceiver?.localStreamUrl) {
            ws.send(JSON.stringify({ type: 'stream-url', url: integrationInfoForReceiver.localStreamUrl }));
          }
        } else {
          // Broadcaster joining an existing room (possibly recovering from disconnect)
          const joinRoom = rooms.rooms.get(roomId);
          if (joinRoom) {
            stopSilenceKeepalive(joinRoom);
            rooms.reopen(roomId);
          }
          ws.send(JSON.stringify({ type: 'joined', roomId, role }));
          const receiverIds = rooms.getReceiverIds(roomId);
          for (const rid of receiverIds) {
            const rws = rooms.getReceiver(roomId, rid);
            if (rws) {
              rws.send(JSON.stringify({ type: 'peer-joined', role: 'broadcaster' }));
              ws.send(JSON.stringify({ type: 'peer-joined', role: 'receiver', receiverId: rid }));
            }
          }
          logger.info({ roomId: roomId.slice(0, 8) }, 'Broadcaster rejoined — silence keepalive cancelled');
        }

        logger.info({ roomId: roomId.slice(0, 8), role, ip }, 'Joined room');
        break;
      }

      case 'ready': {
        // Broadcaster signals ready — tell it about all existing receivers
        if (clientRoom && clientRole === 'broadcaster') {
          const receiverIds = rooms.getReceiverIds(clientRoom);
          for (const rid of receiverIds) {
            ws.send(JSON.stringify({ type: 'peer-joined', role: 'receiver', receiverId: rid }));
          }
        }
        break;
      }

      // Fix #8: Validate SDP before relay
      case 'offer': {
        if (!clientRoom || !isValidSdp(msg.sdp)) break;

        if (clientRole === 'broadcaster') {
          // Route to specific receiver
          const receiverId = msg.receiverId;
          if (!receiverId) break;
          const receiver = rooms.getReceiver(clientRoom, receiverId);
          if (receiver) {
            receiver.send(JSON.stringify({ type: 'offer', sdp: msg.sdp }));
            logger.info({ roomId: clientRoom.slice(0, 8), type: 'offer' }, 'Relayed SDP');
          }
        }
        break;
      }

      case 'answer': {
        if (!clientRoom || !isValidSdp(msg.sdp)) break;

        if (clientRole === 'receiver') {
          // Route to broadcaster, include receiverId
          const broadcaster = rooms.getBroadcaster(clientRoom);
          if (broadcaster) {
            broadcaster.send(JSON.stringify({ type: 'answer', sdp: msg.sdp, receiverId: clientReceiverId }));
            logger.info({ roomId: clientRoom.slice(0, 8), type: 'answer' }, 'Relayed SDP');
          }
        }
        break;
      }

      case 'candidate': {
        if (!clientRoom || !isValidCandidate(msg.candidate)) break;

        if (clientRole === 'broadcaster') {
          // Route to specific receiver
          const receiverId = msg.receiverId;
          if (!receiverId) break;
          const receiver = rooms.getReceiver(clientRoom, receiverId);
          if (receiver) {
            receiver.send(JSON.stringify({ type: 'candidate', candidate: msg.candidate }));
          }
        } else if (clientRole === 'receiver') {
          // Route to broadcaster, include receiverId
          const broadcaster = rooms.getBroadcaster(clientRoom);
          if (broadcaster) {
            broadcaster.send(JSON.stringify({ type: 'candidate', candidate: msg.candidate, receiverId: clientReceiverId }));
          }
        }
        break;
      }

      case 'leave': {
        if (clientRoom && clientRole) {
          if (clientRole === 'broadcaster') {
            const leaveRoom = rooms.rooms.get(clientRoom);
            if (leaveRoom) {
              stopRoomTranscoder(leaveRoom);
              stopSilenceKeepalive(leaveRoom);
              leaveRoom.relayHeader = null;
              for (const writer of leaveRoom.relayListeners) {
                try { writer.end(); } catch { /* ignore */ }
              }
              leaveRoom.relayListeners.clear();
              const relayInfo = rooms.getIntegrationInfo(clientRoom);
              if (relayInfo && relayInfo.localStreamUrl) {
                if (relayInfo.type) { delete relayInfo.localStreamUrl; }
                else { rooms.setIntegrationInfo(clientRoom, null); }
              }
            }
            const receiverIds = rooms.getReceiverIds(clientRoom);
            for (const rid of receiverIds) {
              const rws = rooms.getReceiver(clientRoom, rid);
              if (rws) rws.send(JSON.stringify({ type: 'peer-left', role: 'broadcaster' }));
            }
            const bcasterName = rooms.removeChatParticipant(clientRoom, 'broadcaster');
            if (bcasterName) {
              const leaveText = `${bcasterName} has left the chat`;
              const leaveMsg = JSON.stringify({ type: 'chat', name: '', text: leaveText, system: true });
              rooms.addChat(clientRoom, { name: '', text: leaveText, system: true });
              for (const rid of receiverIds) {
                const rws = rooms.getReceiver(clientRoom, rid);
                if (rws) rws.send(leaveMsg);
              }
            }
            rooms.leave(clientRoom, 'broadcaster');
          } else if (clientRole === 'receiver') {
            const bcaster = rooms.getBroadcaster(clientRoom);
            if (bcaster) {
              bcaster.send(JSON.stringify({ type: 'peer-left', role: 'receiver', receiverId: clientReceiverId }));
            }
            const leftName = rooms.removeChatParticipant(clientRoom, clientReceiverId);
            if (leftName) {
              const leaveText = `${leftName} has left the chat`;
              const leaveMsg = JSON.stringify({ type: 'chat', name: '', text: leaveText, system: true });
              rooms.addChat(clientRoom, { name: '', text: leaveText, system: true });
              if (bcaster) bcaster.send(leaveMsg);
              const otherReceiverIds = rooms.getReceiverIds(clientRoom);
              for (const rid of otherReceiverIds) {
                const rws = rooms.getReceiver(clientRoom, rid);
                if (rws && rws !== ws) rws.send(leaveMsg);
              }
            }
            rooms.leave(clientRoom, 'receiver', clientReceiverId);
            sendListenerCount(clientRoom);
          }
          logger.info({ roomId: clientRoom.slice(0, 8), role: clientRole }, 'Left room');
        }
        clientRoom = null;
        clientRole = null;
        clientReceiverId = null;
        break;
      }

      case 'stats': {
        if (clientRoom && clientRole) {
          rooms.logStats(clientRoom, clientRole, msg.data);
        }
        break;
      }

      case 'metadata': {
        // Live metadata update — updates the "now playing" display for receivers
        // Does NOT add to track list (that's handled by 'add-track')
        if (!clientRoom || clientRole !== 'broadcaster') break;
        const metaText = typeof msg.text === 'string' ? msg.text.slice(0, 200) : '';
        const metaCover = typeof msg.cover === 'string' ? msg.cover.slice(0, 500) : undefined;
        rooms.setMetadata(clientRoom, metaText, metaCover);

        // Broadcast metadata to all receivers
        const metaPayload = { type: 'metadata', text: metaText };
        if (metaCover) metaPayload.cover = metaCover;
        const metaMsg = JSON.stringify(metaPayload);
        const metaReceiverIds = rooms.getReceiverIds(clientRoom);
        for (const rid of metaReceiverIds) {
          const rws = rooms.getReceiver(clientRoom, rid);
          if (rws) rws.send(metaMsg);
        }

        // Update ICY metadata on relay stream listeners
        updateRelayMetadata(clientRoom, metaText);
        break;
      }

      case 'add-track': {
        // Explicit track commit — adds to track list + pushes integration metadata
        if (!clientRoom || clientRole !== 'broadcaster') break;
        const trackText = typeof msg.text === 'string' ? msg.text.slice(0, 200) : '';
        if (!trackText) break;

        // Avoid duplicate if the last track is the same title
        const existingTracks = rooms.getTrackList(clientRoom);
        if (existingTracks.length > 0 && existingTracks[0].title === trackText) break;

        // Build rich metadata object
        const str = (k) => typeof msg[k] === 'string' ? msg[k].slice(0, 500) : undefined;
        const num = (k) => typeof msg[k] === 'number' ? msg[k] : undefined;
        const trackMeta = {
          text: trackText,
          cover: str('cover'),
          coverMedium: str('coverMedium'),
          artist: str('artist'),
          title: str('title'),
          album: str('album'),
          duration: num('duration'),
          releaseDate: str('releaseDate'),
          isrc: str('isrc'),
          bpm: num('bpm'),
          trackPosition: num('trackPosition'),
          diskNumber: num('diskNumber'),
          explicitLyrics: msg.explicitLyrics === true ? true : undefined,
          contributors: Array.isArray(msg.contributors) ? msg.contributors.slice(0, 20).map(c => ({
            name: typeof c.name === 'string' ? c.name.slice(0, 200) : '',
            role: typeof c.role === 'string' ? c.role.slice(0, 100) : '',
          })) : undefined,
          label: str('label'),
          genres: Array.isArray(msg.genres) ? msg.genres.filter(g => typeof g === 'string').slice(0, 10) : undefined,
        };

        rooms.addTrack(clientRoom, trackMeta);
        // Also update metadata to match the committed track
        rooms.setMetadata(clientRoom, trackText, trackMeta.coverMedium || trackMeta.cover);

        // Broadcast updated track list to all receivers + broadcaster
        const trackListMsg = JSON.stringify({ type: 'track-list', tracks: rooms.getTrackList(clientRoom) });
        const tlReceiverIds = rooms.getReceiverIds(clientRoom);
        for (const rid of tlReceiverIds) {
          const rws = rooms.getReceiver(clientRoom, rid);
          if (rws) rws.send(trackListMsg);
        }
        ws.send(trackListMsg);

        // Broadcast metadata to all receivers
        const trackMetaPayload = { type: 'metadata', text: trackText };
        if (trackMeta.coverMedium || trackMeta.cover) trackMetaPayload.cover = trackMeta.coverMedium || trackMeta.cover;
        const trackMetaMsg = JSON.stringify(trackMetaPayload);
        const trackMetaReceiverIds = rooms.getReceiverIds(clientRoom);
        for (const rid of trackMetaReceiverIds) {
          const rws = rooms.getReceiver(clientRoom, rid);
          if (rws) rws.send(trackMetaMsg);
        }

        // Push metadata to integration stream if active
        const integrationInfo = rooms.getIntegrationInfo(clientRoom);
        // Build rich song string: "Artist - Title [Album (Year)]"
        let songStr = trackText;
        if (trackMeta.artist && trackMeta.title) {
          songStr = `${trackMeta.artist} - ${trackMeta.title}`;
          const parts = [];
          if (trackMeta.album) parts.push(trackMeta.album);
          if (trackMeta.releaseDate) {
            const yr = trackMeta.releaseDate.match(/^(\d{4})/);
            if (yr) parts.push(yr[1]);
          }
          if (parts.length) songStr += ` [${parts.join(' · ')}]`;
        }

        // Update ICY metadata on relay stream listeners
        updateRelayMetadata(clientRoom, songStr);

        if (integrationInfo) {
          updateStreamMetadata(integrationInfo.type, integrationInfo.credentials, songStr, logger)
            .then((ok) => {
              if (ok) logger.debug({ roomId: clientRoom.slice(0, 8) }, 'Integration metadata updated');
            });
        }
        break;
      }

      case 'chat': {
        if (!clientRoom) break;
        // Validate
        const chatText = msg.text;
        const chatName = msg.name;
        if (typeof chatText !== 'string' || chatText.length === 0 || chatText.length > 280) break;
        if (typeof chatName !== 'string' || chatName.length === 0 || chatName.length > 50) break;
        // Rate limit: 1 message per second per connection
        const chatNow = Date.now();
        if (chatNow - lastChatTime < 1000) break;
        lastChatTime = chatNow;

        const participantId = clientRole === 'broadcaster' ? 'broadcaster' : clientReceiverId;
        const isNewToChat = rooms.addChatParticipant(clientRoom, participantId, chatName);

        const chatMsg = JSON.stringify({ type: 'chat', name: chatName, text: chatText });

        // If this is their first chat message, broadcast a join system message
        if (isNewToChat) {
          const joinText = clientRole === 'broadcaster' ? `${chatName} has joined the chat` : `${chatName} has joined the chat`;
          const joinMsg = JSON.stringify({ type: 'chat', name: '', text: joinText, system: true });
          rooms.addChat(clientRoom, { name: '', text: joinText, system: true });
          const bcaster = rooms.getBroadcaster(clientRoom);
          if (bcaster && bcaster !== ws) bcaster.send(joinMsg);
          const receiverIds = rooms.getReceiverIds(clientRoom);
          for (const rid of receiverIds) {
            const rws = rooms.getReceiver(clientRoom, rid);
            if (rws && rws !== ws) rws.send(joinMsg);
          }
          ws.send(joinMsg); // sender also sees their own join message
        }

        // Store in history
        rooms.addChat(clientRoom, { name: chatName, text: chatText });

        // Broadcast to all participants EXCEPT the sender
        const broadcaster = rooms.getBroadcaster(clientRoom);
        if (broadcaster && broadcaster !== ws) broadcaster.send(chatMsg);
        const receiverIds = rooms.getReceiverIds(clientRoom);
        for (const rid of receiverIds) {
          const rws = rooms.getReceiver(clientRoom, rid);
          if (rws && rws !== ws) rws.send(chatMsg);
        }
        break;
      }

      case 'relay-diag': {
        logger.info({ roomId: clientRoom?.slice(0, 8), frameCount: msg.frameCount, lastMp3Len: msg.lastMp3Len, ctxState: msg.ctxState }, 'Relay diag from client');
        break;
      }

      default:
        logger.debug({ type: msg.type }, 'Unknown message type');
    }
  });

  ws.on('close', (code, reason) => {
    if (clientRoom && clientRole) {
      if (clientRole === 'broadcaster') {
        const dcRoom = rooms.rooms.get(clientRoom);
        if (dcRoom) {
          stopRoomTranscoder(dcRoom);
          dcRoom.relayHeader = null;

          if (dcRoom.relayListeners.size > 0 && silentMp3Frame) {
            startSilenceKeepalive(dcRoom, clientRoom);
          }
        }

        const receiverIds = rooms.getReceiverIds(clientRoom);
        for (const rid of receiverIds) {
          const rws = rooms.getReceiver(clientRoom, rid);
          if (rws) {
            rws.send(JSON.stringify({ type: 'peer-left', role: 'broadcaster' }));
            rws.send(JSON.stringify({ type: 'broadcaster-disconnected' }));
          }
        }
        const bcasterName = rooms.removeChatParticipant(clientRoom, 'broadcaster');
        if (bcasterName) {
          const leaveText = `${bcasterName} has left the chat`;
          const leaveMsg = JSON.stringify({ type: 'chat', name: '', text: leaveText, system: true });
          rooms.addChat(clientRoom, { name: '', text: leaveText, system: true });
          for (const rid of receiverIds) {
            const rws = rooms.getReceiver(clientRoom, rid);
            if (rws) rws.send(leaveMsg);
          }
        }
        rooms.leave(clientRoom, 'broadcaster');
      } else if (clientRole === 'receiver') {
        const bcaster = rooms.getBroadcaster(clientRoom);
        if (bcaster) {
          bcaster.send(JSON.stringify({ type: 'peer-left', role: 'receiver', receiverId: clientReceiverId }));
        }
        const leftName = rooms.removeChatParticipant(clientRoom, clientReceiverId);
        if (leftName) {
          const leaveText = `${leftName} has left the chat`;
          const leaveMsg = JSON.stringify({ type: 'chat', name: '', text: leaveText, system: true });
          rooms.addChat(clientRoom, { name: '', text: leaveText, system: true });
          if (bcaster) bcaster.send(leaveMsg);
          const otherReceiverIds = rooms.getReceiverIds(clientRoom);
          for (const rid of otherReceiverIds) {
            const rws = rooms.getReceiver(clientRoom, rid);
            if (rws && rws !== ws) rws.send(leaveMsg);
          }
        }
        rooms.leave(clientRoom, 'receiver', clientReceiverId);
        sendListenerCount(clientRoom);
      }
      logger.info({ roomId: clientRoom?.slice(0, 8), role: clientRole, code, reason: reason?.toString() }, 'Disconnected');
    }
  });

  ws.on('error', (err) => {
    logger.error({ ip, error: err.message }, 'WebSocket error');
  });
});

// ---------------------------------------------------------------------------
// Integration stream WebSocket — relays MP3 audio to external streaming servers
// ---------------------------------------------------------------------------
integrationWss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';

  // Authenticate via session cookie
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.session || null;
  const sessionData = sessionToken ? sessions.validate(sessionToken) : null;

  if (!sessionData) {
    logger.warn({ ip }, 'Unauthenticated integration-stream attempt');
    ws.close(4001, 'Authentication required');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let sourceSocket = null;
  let initialized = false;
  let integrationRoomId = null;
  let firstAudioChunkReceived = false;
  let firstAudioChunkTimeout = null;

  // Auto-reconnect state: when the external server drops mid-stream we retry
  // with exponential backoff instead of tearing down the client WebSocket.
  const RECONNECT_MAX_ATTEMPTS = 10;
  const RECONNECT_BASE_DELAY_MS = 1000;
  const RECONNECT_MAX_DELAY_MS = 30000;
  let connConfig = null; // { type, credentials, streamQuality }
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let shuttingDown = false;

  logger.info({ ip }, 'Integration stream WebSocket connected');

  const sendJson = (obj) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  };

  /** Wire loss detection onto a connected source socket */
  const attachSourceSocket = (socket) => {
    sourceSocket = socket;
    let lost = false;
    const onLoss = (err) => {
      if (lost) return; // error + close can both fire
      lost = true;
      if (socket !== sourceSocket) return; // stale socket from a previous attempt
      sourceSocket = null;
      try { socket.destroy(); } catch { /* ignore */ }
      if (shuttingDown || ws.readyState !== ws.OPEN) return;
      logger.warn({ error: err?.message }, 'Integration source socket lost - scheduling reconnect');
      scheduleReconnect();
    };
    socket.on('error', onLoss);
    socket.on('close', () => onLoss());
  };

  /** Schedule the next reconnect attempt with exponential backoff */
  const scheduleReconnect = () => {
    if (shuttingDown || reconnectTimer) return;
    reconnectAttempt++;
    if (reconnectAttempt > RECONNECT_MAX_ATTEMPTS) {
      logger.error({ attempts: RECONNECT_MAX_ATTEMPTS }, 'Integration reconnect gave up');
      sendJson({ type: 'status', state: 'failed', attempt: RECONNECT_MAX_ATTEMPTS });
      sendJson({ type: 'error', error: 'Stream server disconnected and reconnect failed' });
      ws.close();
      return;
    }
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttempt - 1), RECONNECT_MAX_DELAY_MS);
    sendJson({ type: 'status', state: 'reconnecting', attempt: reconnectAttempt });
    logger.info({ attempt: reconnectAttempt, delay }, 'Integration reconnect scheduled');
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (shuttingDown || ws.readyState !== ws.OPEN || !connConfig) return;
      try {
        const socket = await connectToServer(connConfig.type, connConfig.credentials, logger, connConfig.streamQuality);
        attachSourceSocket(socket);
        reconnectAttempt = 0;
        sendJson({ type: 'status', state: 'connected', attempt: 0 });
        logger.info({ type: connConfig.type }, 'Integration stream reconnected');
        // Re-push current now-playing metadata to the external server
        if (integrationRoomId) {
          const meta = rooms.getMetadata(integrationRoomId);
          if (meta?.text) {
            updateStreamMetadata(connConfig.type, connConfig.credentials, meta.text, logger);
          }
        }
      } catch (err) {
        // Wrong credentials will never succeed - hard failure, no retry
        if (/authentication failed/i.test(err.message)) {
          logger.error({ error: err.message }, 'Integration reconnect: auth failure, giving up');
          sendJson({ type: 'status', state: 'failed', attempt: reconnectAttempt });
          sendJson({ type: 'error', error: err.message });
          ws.close();
          return;
        }
        logger.warn({ attempt: reconnectAttempt, error: err.message }, 'Integration reconnect attempt failed');
        scheduleReconnect();
      }
    }, delay);
  };

  ws.on('message', async (raw, isBinary) => {
    // First message should be JSON with integration config
    if (!initialized) {
      try {
        const msg = JSON.parse(raw.toString());
        const { type, credentials, roomId: msgRoomId, streamQuality } = msg;

        if (!type || !credentials) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing type or credentials' }));
          ws.close();
          return;
        }

        logger.info({ type, ip, bitrate: streamQuality?.bitrate, channels: streamQuality?.channels }, 'Integration stream: connecting to server');

        try {
          const socket = await connectToServer(type, credentials, logger, streamQuality);
          connConfig = { type, credentials, streamQuality };
          attachSourceSocket(socket);

          initialized = true;
          firstAudioChunkReceived = false;

          // Guard against false "connected" states where auth succeeds but no audio ever arrives.
          firstAudioChunkTimeout = setTimeout(() => {
            if (firstAudioChunkReceived) return;
            logger.warn({ ip, type }, 'Integration stream connected but no audio payload received');
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'error', error: 'Connected to server, but no audio data received' }));
              ws.close();
            }
          }, 8000);

          // Store integration info on the room for metadata updates
          const listenerUrl = buildListenerUrl(type, credentials);
          if (msgRoomId) {
            integrationRoomId = msgRoomId;
            rooms.setIntegrationInfo(msgRoomId, { type, credentials, listenerUrl });

            // Broadcast stream URL to all connected receivers
            if (listenerUrl) {
              const streamUrlMsg = JSON.stringify({ type: 'stream-url', url: listenerUrl });
              const receiverIds = rooms.getReceiverIds(msgRoomId);
              for (const rid of receiverIds) {
                const rws = rooms.getReceiver(msgRoomId, rid);
                if (rws) rws.send(streamUrlMsg);
              }
            }
          }

          ws.send(JSON.stringify({ type: 'connected' }));
          logger.info({ type, ip, listenerUrl }, 'Integration stream: connected and relaying');
        } catch (err) {
          logger.warn({ type, error: err.message }, 'Integration stream: connection failed');
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
          ws.close();
        }
      } catch {
        // Not JSON — ignore before initialization
        return;
      }
      return;
    }

    // After initialization, relay binary MP3 data to the source socket
    if (sourceSocket && !sourceSocket.destroyed) {
      try {
        if (!firstAudioChunkReceived) {
          firstAudioChunkReceived = true;
          if (firstAudioChunkTimeout) {
            clearTimeout(firstAudioChunkTimeout);
            firstAudioChunkTimeout = null;
          }
        }
        const data = isBinary ? raw : Buffer.from(raw);
        sourceSocket.write(data);
      } catch (err) {
        logger.error({ error: err.message }, 'Failed to write to source socket');
      }
    }
  });

  ws.on('close', () => {
    shuttingDown = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (firstAudioChunkTimeout) {
      clearTimeout(firstAudioChunkTimeout);
      firstAudioChunkTimeout = null;
    }
    if (sourceSocket && !sourceSocket.destroyed) {
      sourceSocket.destroy();
      sourceSocket = null;
    }
    if (integrationRoomId) {
      rooms.setIntegrationInfo(integrationRoomId, null);
    }
    logger.info({ ip }, 'Integration stream WebSocket closed');
  });

  ws.on('error', (err) => {
    logger.error({ ip, error: err.message }, 'Integration stream WebSocket error');
    shuttingDown = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (firstAudioChunkTimeout) {
      clearTimeout(firstAudioChunkTimeout);
      firstAudioChunkTimeout = null;
    }
    if (sourceSocket && !sourceSocket.destroyed) {
      sourceSocket.destroy();
      sourceSocket = null;
    }
    if (integrationRoomId) {
      rooms.setIntegrationInfo(integrationRoomId, null);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, origin: ALLOWED_ORIGIN, tls: REQUIRE_TLS }, 'Signaling server started');
});

function gracefulShutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully…');

  for (const [roomId, room] of rooms.rooms) {
    stopSilenceKeepalive(room);
    stopRoomTranscoder(room);
    for (const writer of room.relayListeners) {
      try { writer.end(); } catch { /* ignore */ }
    }
    room.relayListeners.clear();
  }

  for (const ws of wss.clients) {
    ws.close(1001, 'Server shutting down');
  }
  for (const ws of integrationWss.clients) {
    ws.close(1001, 'Server shutting down');
  }

  server.close(() => {
    logger.info('HTTP server closed');
    storage.close();
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
