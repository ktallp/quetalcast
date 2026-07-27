import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'dj')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  title TEXT,
  description TEXT,
  owner_user_id TEXT,
  peak_listeners INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tracks (
  room_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  title TEXT,
  artist TEXT,
  album TEXT,
  year TEXT,
  cover_url TEXT,
  source TEXT,
  track_title TEXT,
  isrc TEXT,
  label TEXT,
  duration INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tracks_room ON tracks (room_id, ts);

CREATE TABLE IF NOT EXISTS listener_sessions (
  room_id TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('webrtc', 'relay')),
  joined_at INTEGER NOT NULL,
  left_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lsessions_room ON listener_sessions (room_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_lsessions_joined ON listener_sessions (joined_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS archives (
  room_id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat (
  room_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  name TEXT,
  text TEXT,
  system INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_room ON chat (room_id, ts);

CREATE TABLE IF NOT EXISTS listener_samples (
  room_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_room ON listener_samples (room_id, ts);
CREATE INDEX IF NOT EXISTS idx_samples_ts ON listener_samples (ts);

CREATE TABLE IF NOT EXISTS slugs (
  slug TEXT PRIMARY KEY,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  effects TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, name)
);
`;

/**
 * SQLite-backed persistence layer. All methods are synchronous
 * (better-sqlite3) and safe to call from the hot path; writes are
 * small single-row statements running in WAL mode.
 */
export class Storage {
  constructor(logger) {
    this.logger = logger;
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, 'quetalcast.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
    this._ensureTrackColumns();
    this._migrateSlugFile();
    this._closeOrphanListenerSessions();
    logger?.info({ dbPath: this.dbPath }, 'SQLite storage ready');
  }

  /** Add track metadata columns to databases created before they existed */
  _ensureTrackColumns() {
    const existing = new Set(this.db.pragma('table_info(tracks)').map((c) => c.name));
    const wanted = [
      ['track_title', 'TEXT'],
      ['isrc', 'TEXT'],
      ['label', 'TEXT'],
      ['duration', 'INTEGER'],
    ];
    for (const [name, type] of wanted) {
      if (!existing.has(name)) {
        this.db.exec(`ALTER TABLE tracks ADD COLUMN ${name} ${type}`);
        this.logger?.info({ column: name }, 'Added tracks column');
      }
    }
  }

  /**
   * Sessions left open by a crash or restart have no real end time.
   * Close them conservatively at the room's last listener sample after the
   * join (or at joined_at when no sample exists) so listening hours are
   * never overstated.
   */
  _closeOrphanListenerSessions() {
    const info = this.db.prepare(`
      UPDATE listener_sessions SET left_at = COALESCE(
        (SELECT MAX(ls.ts) FROM listener_samples ls
          WHERE ls.room_id = listener_sessions.room_id AND ls.ts >= joined_at),
        joined_at)
      WHERE left_at IS NULL
    `).run();
    if (info.changes > 0) {
      this.logger?.info({ closed: info.changes }, 'Closed orphaned listener sessions');
    }
  }

  /** One-time migration of the legacy data/room-slugs.json file into the slugs table */
  _migrateSlugFile() {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM slugs').get();
    if (row.n > 0) return;
    const candidates = [
      path.join(this.dataDir, 'room-slugs.json'),
      path.join(__dirname, '..', 'data', 'room-slugs.json'),
    ];
    for (const file of candidates) {
      try {
        if (!fs.existsSync(file)) continue;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(parsed)) continue;
        const insert = this.db.prepare('INSERT OR IGNORE INTO slugs (slug, last_used_at) VALUES (?, ?)');
        let count = 0;
        for (const entry of parsed) {
          if (!entry || typeof entry.slug !== 'string') continue;
          const ts = entry.lastUsed ? Date.parse(entry.lastUsed) || Date.now() : Date.now();
          insert.run(entry.slug, ts);
          count++;
        }
        if (count > 0) {
          this.logger?.info({ file, count }, 'Migrated room-slugs.json into SQLite');
        }
        return;
      } catch (err) {
        this.logger?.warn({ file, error: err.message }, 'Slug file migration failed');
      }
    }
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }

  // ------------------------------------------------------------------ users

  createUser({ id, username, role, passwordHash }) {
    this.db.prepare(
      'INSERT INTO users (id, username, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(id, username, passwordHash || null, role, Date.now());
  }

  getUserById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }

  getUserByUsername(username) {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
  }

  listUsers() {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  }

  countUsers() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  countEnabledOwners() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled = 0").get().n;
  }

  setUserPassword(id, passwordHash) {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }

  setUserDisabled(id, disabled) {
    this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
  }

  setUserRole(id, role) {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  // ---------------------------------------------------------------- presets

  listPresets(userId) {
    return this.db
      .prepare('SELECT name, effects FROM presets WHERE user_id = ? ORDER BY updated_at ASC')
      .all(userId)
      .map((row) => {
        try {
          return { name: row.name, effects: JSON.parse(row.effects) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  upsertPreset(userId, name, effects) {
    this.db.prepare(`
      INSERT INTO presets (user_id, name, effects, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, name) DO UPDATE SET effects = excluded.effects, updated_at = excluded.updated_at
    `).run(userId, name, JSON.stringify(effects), Date.now());
  }

  deletePreset(userId, name) {
    this.db.prepare('DELETE FROM presets WHERE user_id = ? AND name = ?').run(userId, name);
  }

  deleteUser(id) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    this.db.prepare('DELETE FROM invites WHERE user_id = ?').run(id);
  }

  touchUserActivity(id, ts) {
    this.db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(ts, id);
  }

  // --------------------------------------------------------------- sessions

  createSession({ id, userId, expiresAt }) {
    this.db.prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(id, userId, Date.now(), expiresAt);
  }

  getSession(id) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
  }

  revokeSession(id) {
    this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), id);
  }

  revokeUserSessions(userId) {
    this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId);
  }

  // ---------------------------------------------------------------- invites

  createInvite({ token, userId, purpose, expiresAt }) {
    this.db.prepare(
      'INSERT INTO invites (token, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(token, userId, purpose, Date.now(), expiresAt);
  }

  getInvite(token) {
    return this.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) || null;
  }

  markInviteUsed(token) {
    this.db.prepare('UPDATE invites SET used_at = ? WHERE token = ?').run(Date.now(), token);
  }

  // ------------------------------------------------------------------ rooms

  createRoom({ id, createdAt, title, description, ownerUserId }) {
    this.db.prepare(
      `INSERT INTO rooms (id, created_at, ended_at, title, description, owner_user_id, peak_listeners)
       VALUES (?, ?, NULL, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, ended_at = NULL,
         title = excluded.title, description = excluded.description,
         owner_user_id = excluded.owner_user_id, peak_listeners = 0`
    ).run(id, createdAt, title || null, description || null, ownerUserId || null);
  }

  updateRoomInfo(id, title, description) {
    this.db.prepare('UPDATE rooms SET title = ?, description = ? WHERE id = ?').run(title || null, description || null, id);
  }

  endRoom(id, endedAt) {
    this.db.prepare('UPDATE rooms SET ended_at = ? WHERE id = ?').run(endedAt, id);
  }

  reopenRoom(id) {
    this.db.prepare('UPDATE rooms SET ended_at = NULL WHERE id = ?').run(id);
  }

  deleteRoom(id) {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM tracks WHERE room_id = ?').run(id);
    this.db.prepare('DELETE FROM chat WHERE room_id = ?').run(id);
    this.db.prepare('DELETE FROM listener_samples WHERE room_id = ?').run(id);
    this.db.prepare('DELETE FROM listener_sessions WHERE room_id = ?').run(id);
  }

  updatePeakListeners(id, count) {
    this.db.prepare('UPDATE rooms SET peak_listeners = MAX(peak_listeners, ?) WHERE id = ?').run(count, id);
  }

  getRoom(id) {
    return this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) || null;
  }

  /** Rooms that ended within the given window, or never ended (server died while live) */
  getRecentRooms(sinceTs) {
    return this.db.prepare('SELECT * FROM rooms WHERE ended_at IS NULL OR ended_at >= ?').all(sinceTs);
  }

  /**
   * Full broadcast history for the admin panel: every room with its
   * broadcaster username and archive info, active rooms first, then newest.
   */
  listRoomsWithMeta({ limit = 50, offset = 0 } = {}) {
    return this.db.prepare(
      `SELECT r.id, r.created_at, r.ended_at, r.title, r.description, r.owner_user_id, r.peak_listeners,
              u.username AS username,
              CASE WHEN a.room_id IS NULL THEN 0 ELSE 1 END AS has_archive,
              a.bytes AS archive_bytes
       FROM rooms r
       LEFT JOIN users u ON u.id = r.owner_user_id
       LEFT JOIN archives a ON a.room_id = r.id
       ORDER BY (r.ended_at IS NULL) DESC, r.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(limit, offset);
  }

  countRooms() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
  }

  // ----------------------------------------------------------------- tracks

  insertTrack(roomId, { ts, title, artist, album, year, coverUrl, source, trackTitle, isrc, label, duration }) {
    this.db.prepare(
      `INSERT INTO tracks (room_id, ts, title, artist, album, year, cover_url, source, track_title, isrc, label, duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      roomId, ts, title || null, artist || null, album || null, year || null, coverUrl || null, source || null,
      trackTitle || null, isrc || null, label || null, Number.isFinite(duration) ? Math.round(duration) : null
    );
  }

  getTracks(roomId, limit = 100) {
    return this.db.prepare('SELECT * FROM tracks WHERE room_id = ? ORDER BY ts DESC LIMIT ?').all(roomId, limit);
  }

  /** All tracks played in [startTs, endTs), oldest first, for reporting */
  getTracksInRange(startTs, endTs) {
    return this.db.prepare(
      'SELECT rowid AS id, * FROM tracks WHERE ts >= ? AND ts < ? ORDER BY ts ASC'
    ).all(startTs, endTs);
  }

  /** Update reporting metadata on a single track row (the ISRC fix-up flow) */
  updateTrackReportingMeta(id, { trackTitle, artist, album, label, isrc, duration }) {
    this.db.prepare(
      `UPDATE tracks SET track_title = ?, artist = ?, album = ?, label = ?, isrc = ?, duration = ?
       WHERE rowid = ?`
    ).run(
      trackTitle || null, artist || null, album || null, label || null, isrc || null,
      Number.isFinite(duration) ? Math.round(duration) : null, id
    );
  }

  // ------------------------------------------------------ listener sessions

  /** Open a listener session; returns the session row id used to close it */
  openListenerSession(roomId, transport, ts) {
    const info = this.db.prepare(
      'INSERT INTO listener_sessions (room_id, transport, joined_at) VALUES (?, ?, ?)'
    ).run(roomId, transport, ts);
    return info.lastInsertRowid;
  }

  closeListenerSession(sessionId, ts) {
    if (!sessionId) return;
    this.db.prepare(
      'UPDATE listener_sessions SET left_at = ? WHERE rowid = ? AND left_at IS NULL'
    ).run(ts, sessionId);
  }

  /** Close every still-open session for a room (room ended or reclaimed) */
  closeRoomListenerSessions(roomId, ts) {
    this.db.prepare(
      'UPDATE listener_sessions SET left_at = ? WHERE room_id = ? AND left_at IS NULL'
    ).run(ts, roomId);
  }

  /** Sessions overlapping [startTs, endTs), for performance and ATH queries */
  getListenerSessionsInRange(startTs, endTs) {
    return this.db.prepare(
      `SELECT room_id, transport, joined_at, left_at FROM listener_sessions
       WHERE joined_at < ? AND COALESCE(left_at, ?) > ?`
    ).all(endTs, endTs, startTs);
  }

  // --------------------------------------------------------------- archives

  upsertArchive(roomId, file) {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO archives (room_id, file, bytes, created_at, updated_at) VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET updated_at = excluded.updated_at`
    ).run(roomId, file, now, now);
  }

  updateArchiveBytes(roomId, bytes) {
    this.db.prepare('UPDATE archives SET bytes = ?, updated_at = ? WHERE room_id = ?').run(bytes, Date.now(), roomId);
  }

  getArchive(roomId) {
    return this.db.prepare('SELECT * FROM archives WHERE room_id = ?').get(roomId) || null;
  }

  listArchives() {
    return this.db.prepare('SELECT * FROM archives ORDER BY updated_at DESC').all();
  }

  deleteArchive(roomId) {
    this.db.prepare('DELETE FROM archives WHERE room_id = ?').run(roomId);
  }

  // --------------------------------------------------------------- settings

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setSetting(key, value) {
    this.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value == null ? null : String(value), Date.now());
  }

  getAllSettings() {
    const out = {};
    for (const row of this.db.prepare('SELECT key, value FROM settings').all()) {
      out[row.key] = row.value;
    }
    return out;
  }

  // ------------------------------------------------------------------- chat

  insertChat(roomId, { ts, name, text, system }) {
    this.db.prepare(
      'INSERT INTO chat (room_id, ts, name, text, system) VALUES (?, ?, ?, ?, ?)'
    ).run(roomId, ts, name || '', text || '', system ? 1 : 0);
  }

  getChat(roomId, limit = 200) {
    const rows = this.db.prepare('SELECT * FROM chat WHERE room_id = ? ORDER BY ts DESC LIMIT ?').all(roomId, limit);
    return rows.reverse(); // oldest first
  }

  // ------------------------------------------------------- listener samples

  insertListenerSample(roomId, ts, count) {
    this.db.prepare('INSERT INTO listener_samples (room_id, ts, count) VALUES (?, ?, ?)').run(roomId, ts, count);
  }

  getListenerSamples(roomId, sinceTs) {
    return this.db.prepare(
      'SELECT ts, count FROM listener_samples WHERE room_id = ? AND ts >= ? ORDER BY ts ASC'
    ).all(roomId, sinceTs);
  }

  getListenerSamplesBetween(roomId, startTs, endTs) {
    return this.db.prepare(
      'SELECT ts, count FROM listener_samples WHERE room_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC'
    ).all(roomId, startTs, endTs);
  }

  countTracks(roomId) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE room_id = ?').get(roomId).n;
  }

  getPeakListenersSince(sinceTs) {
    const row = this.db.prepare('SELECT MAX(count) AS peak FROM listener_samples WHERE ts >= ?').get(sinceTs);
    return row?.peak || 0;
  }

  // ------------------------------------------------------------------ slugs

  upsertSlug(slug, lastUsedAt) {
    this.db.prepare(
      'INSERT INTO slugs (slug, last_used_at) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET last_used_at = excluded.last_used_at'
    ).run(slug, lastUsedAt);
  }

  deleteSlug(slug) {
    this.db.prepare('DELETE FROM slugs WHERE slug = ?').run(slug);
  }

  listSlugs(limit = 50) {
    return this.db.prepare('SELECT slug, last_used_at FROM slugs ORDER BY last_used_at DESC LIMIT ?').all(limit);
  }
}
