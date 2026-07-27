import crypto from 'crypto';
import { createStatsLogger } from './logger.js';

const MAX_RECEIVERS = 4;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LISTENER_SAMPLE_INTERVAL_MS = 60 * 1000; // sample listener counts every 60s

/**
 * Turn a username into its room-slug form: lowercase, "." and "_" become
 * hyphens, runs of hyphens collapse, edges trimmed. The result is not
 * guaranteed to be a valid slug (callers check with validateCustomId).
 */
export function usernameToSlug(username) {
  if (typeof username !== 'string') return '';
  return username
    .toLowerCase()
    .replace(/[._]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class RoomManager {
  constructor(logger, storage) {
    this.rooms = new Map();
    this.logger = logger;
    this.storage = storage;
    this.statsLogger = createStatsLogger();
    this.slugHistory = this._loadSlugHistory();
    this.cleanupInterval = setInterval(() => this.cleanupExpiredRooms(), 15 * 60 * 1000); // every 15 min
    this.sampleInterval = setInterval(() => this.sampleListenerCounts(), LISTENER_SAMPLE_INTERVAL_MS);
    this._restoreRecentRooms();
  }

  _loadSlugHistory() {
    if (!this.storage) return [];
    try {
      return this.storage.listSlugs().map((row) => ({
        slug: row.slug,
        lastUsed: new Date(row.last_used_at).toISOString(),
      }));
    } catch (err) {
      this.logger.warn({ error: err.message }, 'Failed to load slug history');
      return [];
    }
  }

  /**
   * Reload recently-ended rooms (and their tracks/chat) from SQLite so
   * post-broadcast history and broadcaster recovery survive restarts.
   * Rooms that were still live when the process died are marked ended now;
   * a rejoining broadcaster reopens them.
   */
  _restoreRecentRooms() {
    if (!this.storage) return;
    const now = Date.now();
    let restored = 0;
    try {
      for (const row of this.storage.getRecentRooms(now - ROOM_TTL_MS)) {
        if (this.rooms.has(row.id)) continue;
        let endedAt = row.ended_at;
        if (!endedAt) {
          // Server died while the room was live, mark it ended as of now
          endedAt = now;
          this.storage.endRoom(row.id, endedAt);
        }
        const room = this._newRoomState(row.id);
        room.createdAt = new Date(row.created_at).toISOString();
        room.endedAt = new Date(endedAt).toISOString();
        room.streamTitle = row.title || null;
        room.streamDescription = row.description || null;
        room.ownerUserId = row.owner_user_id || null;
        room.peakListeners = row.peak_listeners || 0;
        room.trackList = this.storage.getTracks(row.id, 100).map((t) => {
          const entry = { title: t.title || '', time: new Date(t.ts).toISOString() };
          if (t.artist) entry.artist = t.artist;
          if (t.album) entry.album = t.album;
          if (t.year) entry.releaseDate = t.year;
          if (t.cover_url) { entry.cover = t.cover_url; entry.coverMedium = t.cover_url; }
          if (t.track_title) entry.trackTitle = t.track_title;
          if (t.isrc) entry.isrc = t.isrc;
          if (t.label) entry.label = t.label;
          if (t.duration) entry.duration = t.duration;
          return entry;
        });
        room.chatHistory = this.storage.getChat(row.id, 200).map((c) => ({
          name: c.name,
          text: c.text,
          time: new Date(c.ts).toISOString(),
          ...(c.system ? { system: true } : {}),
        }));
        this.rooms.set(row.id, room);
        restored++;
      }
    } catch (err) {
      this.logger.warn({ error: err.message }, 'Failed to restore rooms from storage');
    }
    if (restored > 0) {
      this.logger.info({ restored }, 'Restored recent rooms from storage');
    }
  }

  _newRoomState(roomId) {
    return {
      roomId,
      broadcaster: null,
      receivers: new Map(),
      metadata: null,
      trackList: [],
      chatHistory: [],
      chatParticipants: new Map(),
      integrationInfo: null,
      receiverSessions: new Map(),
      relayListeners: new Set(),
      relayHeader: null,
      ffmpegProcess: null,
      streamTitle: null,
      streamDescription: null,
      ownerUserId: null,
      peakListeners: 0,
      silenceInterval: null,
      silenceTimeout: null,
      createdAt: new Date().toISOString(),
      endedAt: null,
    };
  }

  _recordSlug(slug) {
    const nowIso = new Date().toISOString();
    const existing = this.slugHistory.find((e) => e.slug === slug);
    if (existing) {
      existing.lastUsed = nowIso;
    } else {
      this.slugHistory.unshift({ slug, lastUsed: nowIso });
    }
    // Sort most-recently-used first and cap at 50
    this.slugHistory.sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
    if (this.slugHistory.length > 50) this.slugHistory.length = 50;
    try { this.storage?.upsertSlug(slug, Date.now()); } catch (err) {
      this.logger.warn({ error: err.message }, 'Failed to persist slug');
    }
  }

  removeSlug(slug) {
    this.slugHistory = this.slugHistory.filter((e) => e.slug !== slug);
    try { this.storage?.deleteSlug(slug); } catch (err) {
      this.logger.warn({ error: err.message }, 'Failed to delete slug');
    }
  }

  /**
   * Returns saved custom room slugs with their current live status.
   * Live slugs have an active broadcaster and cannot be reused simultaneously.
   */
  getSlugHistory() {
    return this.slugHistory.map((e) => {
      const room = this.rooms.get(e.slug);
      const live = !!(room && room.broadcaster && room.broadcaster.readyState === 1);
      return { slug: e.slug, lastUsed: e.lastUsed, live };
    });
  }

  /**
   * Sample current listener counts (WebRTC receivers + relay listeners)
   * for every live room into listener_samples and track peaks.
   */
  sampleListenerCounts() {
    if (!this.storage) return;
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      const isLive = room.broadcaster && room.broadcaster.readyState === 1;
      if (!isLive) continue;
      const count = this.getReceiverIds(roomId).length + room.relayListeners.size;
      try {
        this.storage.insertListenerSample(roomId, now, count);
        if (count > (room.peakListeners || 0)) {
          room.peakListeners = count;
          this.storage.updatePeakListeners(roomId, count);
        }
      } catch (err) {
        this.logger.warn({ roomId: roomId.slice(0, 8), error: err.message }, 'Listener sample failed');
      }
    }
  }

  cleanupExpiredRooms() {
    const cutoff = new Date(Date.now() - ROOM_TTL_MS).toISOString();
    for (const [id, room] of this.rooms) {
      if (room.endedAt && room.endedAt < cutoff) {
        if (room.silenceInterval) clearInterval(room.silenceInterval);
        if (room.silenceTimeout) clearTimeout(room.silenceTimeout);
        if (room.ffmpegProcess) {
          try { room.ffmpegProcess.stdin.end(); } catch { /* */ }
          try { room.ffmpegProcess.kill('SIGTERM'); } catch { /* */ }
          room.ffmpegProcess = null;
        }
        for (const writer of room.relayListeners) {
          try { writer.end(); } catch { /* */ }
        }
        room.relayListeners.clear();
        try { this.storage?.closeRoomListenerSessions(id, Date.now()); } catch { /* non-fatal */ }
        this.rooms.delete(id);
        this.logger.info({ roomId: id.slice(0, 8) }, 'Room expired (24h TTL)');
      }
    }
  }

  /**
   * Validate a custom room slug.
   * Allowed: lowercase letters, digits, hyphens. 2-40 chars. No leading/trailing hyphens.
   * Returns null if valid, or an error string if invalid.
   */
  static validateCustomId(id) {
    if (typeof id !== 'string') return 'Room ID must be a string';
    if (id.length < 2 || id.length > 40) return 'Room ID must be 2-40 characters';
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id)) return 'Only lowercase letters, numbers, and hyphens allowed (no leading/trailing hyphens)';
    if (/--/.test(id)) return 'No consecutive hyphens';
    return null;
  }

  /**
   * Free a slug held by a room that is not live, so it can be reclaimed.
   * Returns false if the room is still live.
   */
  _reclaimSlug(slug) {
    const existing = this.rooms.get(slug);
    if (!existing) return true;
    if (existing.broadcaster && existing.broadcaster.readyState === 1) return false;
    if (existing.silenceInterval) clearInterval(existing.silenceInterval);
    if (existing.silenceTimeout) clearTimeout(existing.silenceTimeout);
    for (const writer of existing.relayListeners) {
      try { writer.end(); } catch { /* ignore */ }
    }
    existing.relayListeners.clear();
    try { this.storage?.closeRoomListenerSessions(slug, Date.now()); } catch { /* non-fatal */ }
    this.rooms.delete(slug);
    return true;
  }

  /**
   * Create a room.
   * @param {string} [customId] slug the broadcaster explicitly asked for (recorded in slug history)
   * @param {string} [ownerUserId]
   * @param {object} [options]
   * @param {string} [options.defaultId] slug to use when no customId was given (a username
   *   slug). Never recorded in slug history, and silently falls back to a random id when it
   *   is invalid or currently live.
   */
  create(customId, ownerUserId, options = {}) {
    // If a custom ID is provided, validate and check uniqueness
    if (customId) {
      const error = RoomManager.validateCustomId(customId);
      if (error) return { ok: false, error, code: 'INVALID_ROOM_ID' };
      if (!this._reclaimSlug(customId)) {
        return { ok: false, error: 'That room is currently live, try again when it ends', code: 'ROOM_ID_TAKEN' };
      }
    }

    let defaultId = null;
    if (!customId && options.defaultId) {
      const error = RoomManager.validateCustomId(options.defaultId);
      if (error) {
        this.logger.warn({ defaultId: options.defaultId, error }, 'Username slug unusable, using a random room id');
      } else if (!this._reclaimSlug(options.defaultId)) {
        this.logger.warn({ defaultId: options.defaultId }, 'Username slug is live elsewhere, using a random room id');
      } else {
        defaultId = options.defaultId;
      }
    }

    const roomId = customId || defaultId || crypto.randomBytes(4).toString('hex').slice(0, 7);
    const room = this._newRoomState(roomId);
    room.ownerUserId = ownerUserId || null;
    this.rooms.set(roomId, room);

    try {
      this.storage?.createRoom({ id: roomId, createdAt: Date.now(), ownerUserId: ownerUserId || null });
    } catch (err) {
      this.logger.warn({ roomId: roomId.slice(0, 8), error: err.message }, 'Failed to persist room');
    }

    if (customId) {
      this._recordSlug(customId);
    }

    return { ok: true, roomId };
  }

  /** Set the display title/description for a room (persisted) */
  setStreamInfo(roomId, title, description) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (typeof title === 'string') room.streamTitle = title;
    if (typeof description === 'string') room.streamDescription = description;
    try { this.storage?.updateRoomInfo(roomId, room.streamTitle, room.streamDescription); } catch { /* non-fatal */ }
  }

  /** Clear a room's ended state when the broadcaster rejoins (persisted) */
  reopen(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.endedAt = null;
    try { this.storage?.reopenRoom(roomId); } catch { /* non-fatal */ }
  }

  join(roomId, role, ws) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return { ok: false, error: 'Room not found', code: 'ROOM_NOT_FOUND' };
    }

    if (role !== 'broadcaster' && role !== 'receiver') {
      return { ok: false, error: 'Invalid role', code: 'INVALID_ROLE' };
    }

    if (role === 'broadcaster') {
      // Lock broadcaster slot, reject if another broadcaster is already live
      if (room.broadcaster && room.broadcaster.readyState === 1) {
        this.logger.warn({ roomId: roomId.slice(0, 8) }, 'Broadcaster join rejected, slot occupied');
        return { ok: false, error: 'Broadcast already in progress', code: 'BROADCASTER_OCCUPIED' };
      }
      room.broadcaster = ws;
      return { ok: true };
    }

    // Receiver, enforce max
    if (room.receivers.size >= MAX_RECEIVERS) {
      this.logger.warn({ roomId: roomId.slice(0, 8) }, 'Receiver join rejected, room full');
      return { ok: false, error: 'Room is full', code: 'ROOM_FULL' };
    }

    const receiverId = crypto.randomBytes(4).toString('hex');
    room.receivers.set(receiverId, ws);
    try {
      const sessionId = this.storage?.openListenerSession(roomId, 'webrtc', Date.now());
      if (sessionId) room.receiverSessions.set(receiverId, sessionId);
    } catch (err) {
      this.logger.warn({ roomId: roomId.slice(0, 8), error: err.message }, 'Failed to open listener session');
    }
    return { ok: true, receiverId };
  }

  /** Close the persisted listening session for a receiver, if one is open */
  _closeReceiverSession(room, receiverId) {
    const sessionId = room.receiverSessions?.get(receiverId);
    if (!sessionId) return;
    room.receiverSessions.delete(receiverId);
    try { this.storage?.closeListenerSession(sessionId, Date.now()); } catch { /* non-fatal */ }
  }

  leave(roomId, role, receiverId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (role === 'broadcaster') {
      room.broadcaster = null;
      room.endedAt = new Date().toISOString();
      try { this.storage?.endRoom(roomId, Date.now()); } catch { /* non-fatal */ }
      this.logger.info({ roomId: roomId.slice(0, 8) }, 'Broadcast ended, room kept for 24h');
    } else if (role === 'receiver' && receiverId) {
      room.receivers.delete(receiverId);
      this._closeReceiverSession(room, receiverId);
    }

    // Only delete room if it was never used (no track list, no chat) and empty
    // Rooms with endedAt are kept for 24h via cleanupExpiredRooms
    const hasContent = (room.trackList?.length || 0) > 0 || (room.chatHistory?.length || 0) > 0;
    if (!room.broadcaster && room.receivers.size === 0 && !room.endedAt && !hasContent) {
      this.rooms.delete(roomId);
      try { this.storage?.deleteRoom(roomId); } catch { /* non-fatal */ }
      this.logger.info({ roomId: roomId.slice(0, 8) }, 'Room destroyed (empty, unused)');
    }
  }

  getBroadcaster(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.broadcaster || room.broadcaster.readyState !== 1) return null;
    return room.broadcaster;
  }

  getReceiver(roomId, receiverId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const ws = room.receivers.get(receiverId);
    if (ws && ws.readyState === 1) return ws;
    return null;
  }

  /** Returns all live receiverIds */
  getReceiverIds(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const ids = [];
    for (const [id, ws] of room.receivers) {
      if (ws.readyState === 1) ids.push(id);
    }
    return ids;
  }

  /** Find the receiverId associated with a WebSocket */
  findReceiverIdByWs(roomId, ws) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    for (const [id, rws] of room.receivers) {
      if (rws === ws) return id;
    }
    return null;
  }

  setMetadata(roomId, text, cover) {
    const room = this.rooms.get(roomId);
    if (room) room.metadata = text ? { text, cover: cover || null } : null;
  }

  getMetadata(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.metadata : null;
  }

  /**
   * Add a track entry with rich metadata.
   * @param {string} roomId
   * @param {object} meta, { text, cover, coverMedium, artist, title, album, duration,
   *   releaseDate, isrc, bpm, trackPosition, diskNumber, explicitLyrics,
   *   contributors, label, genres }
   */
  addTrack(roomId, meta) {
    const room = this.rooms.get(roomId);
    if (!room || !meta?.text) return;
    const entry = { title: meta.text, time: new Date().toISOString() };
    // Attach optional rich fields if present
    if (meta.cover) entry.cover = meta.cover;
    if (meta.coverMedium) entry.coverMedium = meta.coverMedium;
    if (meta.artist) entry.artist = meta.artist;
    if (meta.title) entry.trackTitle = meta.title; // "title" is the display string; trackTitle is the song name
    if (meta.album) entry.album = meta.album;
    if (meta.duration) entry.duration = meta.duration;
    if (meta.releaseDate) entry.releaseDate = meta.releaseDate;
    if (meta.isrc) entry.isrc = meta.isrc;
    if (meta.bpm) entry.bpm = meta.bpm;
    if (meta.trackPosition) entry.trackPosition = meta.trackPosition;
    if (meta.diskNumber) entry.diskNumber = meta.diskNumber;
    if (meta.explicitLyrics) entry.explicitLyrics = meta.explicitLyrics;
    if (meta.contributors?.length) entry.contributors = meta.contributors;
    if (meta.label) entry.label = meta.label;
    if (meta.genres?.length) entry.genres = meta.genres;

    room.trackList.unshift(entry); // newest first
    // Cap at 100 tracks
    if (room.trackList.length > 100) room.trackList.length = 100;

    try {
      const yearMatch = typeof meta.releaseDate === 'string' ? meta.releaseDate.match(/^(\d{4})/) : null;
      this.storage?.insertTrack(roomId, {
        ts: Date.now(),
        title: meta.text,
        artist: meta.artist,
        album: meta.album,
        year: yearMatch ? yearMatch[1] : null,
        coverUrl: meta.coverMedium || meta.cover || null,
        source: meta.source || 'live',
        trackTitle: meta.title || null,
        isrc: meta.isrc || null,
        label: meta.label || null,
        duration: typeof meta.duration === 'number' ? meta.duration : null,
      });
    } catch (err) {
      this.logger.warn({ roomId: roomId.slice(0, 8), error: err.message }, 'Failed to persist track');
    }
  }

  getTrackList(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.trackList : [];
  }

  /**
   * Add a chat message to the room history.
   * @param {string} roomId
   * @param {object} msg, { name, text, system? }
   */
  addChat(roomId, msg) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.chatHistory.push({
      name: msg.name,
      text: msg.text,
      time: new Date().toISOString(),
      ...(msg.system ? { system: true } : {}),
    });
    // Cap at 200 messages
    if (room.chatHistory.length > 200) {
      room.chatHistory = room.chatHistory.slice(-200);
    }

    try {
      this.storage?.insertChat(roomId, { ts: Date.now(), name: msg.name, text: msg.text, system: !!msg.system });
    } catch (err) {
      this.logger.warn({ roomId: roomId.slice(0, 8), error: err.message }, 'Failed to persist chat message');
    }
  }

  getChatHistory(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.chatHistory : [];
  }

  /** Add a chat participant (when they send their first message). Returns true if newly added. */
  addChatParticipant(roomId, participantId, name) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const had = room.chatParticipants.has(participantId);
    room.chatParticipants.set(participantId, { name });
    return !had;
  }

  /** Get and remove a chat participant (when they leave). Returns their name or null. */
  removeChatParticipant(roomId, participantId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const p = room.chatParticipants.get(participantId);
    room.chatParticipants.delete(participantId);
    return p?.name ?? null;
  }

  setIntegrationInfo(roomId, info) {
    const room = this.rooms.get(roomId);
    if (room) room.integrationInfo = info || null;
  }

  getIntegrationInfo(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.integrationInfo : null;
  }

  /**
   * Attach a relay listener. Pass countSession: false for admin monitoring so
   * the connection never lands in listener_sessions (royalty reporting reads
   * that table and must only count real listeners).
   */
  addRelayListener(roomId, res, { countSession = true } = {}) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.relayListeners.add(res);
    if (!countSession) {
      res._listenerSessionId = null;
      return true;
    }
    try {
      res._listenerSessionId = this.storage?.openListenerSession(roomId, 'relay', Date.now()) || null;
    } catch (err) {
      this.logger.warn({ roomId: roomId.slice(0, 8), error: err.message }, 'Failed to open relay listener session');
    }
    return true;
  }

  removeRelayListener(roomId, res) {
    const room = this.rooms.get(roomId);
    if (room) room.relayListeners.delete(res);
    if (res?._listenerSessionId) {
      try { this.storage?.closeListenerSession(res._listenerSessionId, Date.now()); } catch { /* non-fatal */ }
      res._listenerSessionId = null;
    }
  }

  getRelayListeners(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.relayListeners : new Set();
  }

  listRooms() {
    const result = [];
    for (const [, room] of this.rooms) {
      result.push({
        roomId: room.roomId,
        broadcaster: !!room.broadcaster,
        receivers: room.receivers.size,
        createdAt: room.createdAt,
      });
    }
    return result;
  }

  logStats(roomId, role, data) {
    // Sanitize: only allow primitive values, block prototype pollution
    const safe = {};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [key, val] of Object.entries(data)) {
        if (key === '__proto__' || key === 'constructor' || key === 'roomId' || key === 'role') continue;
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          safe[key] = val;
        }
      }
    }
    this.statsLogger.info({
      roomId: roomId.slice(0, 8),
      role,
      ...safe,
    });
  }
}
