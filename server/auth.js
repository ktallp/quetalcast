import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000; // write last_active_at at most once/min per session

const BCRYPT_ROUNDS = 10;

/** Hash a plaintext password for storage */
export function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/** Compare a plaintext password against a stored hash */
export function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

/**
 * DB-backed session manager with HMAC-signed tokens.
 *
 * Tokens carry `{ sid, uid }` as `base64(payload).base64(signature)`.
 * The signature proves the token was issued by this server; the sessions
 * table is the source of truth for revocation and expiry, and the users
 * table gates disabled accounts.
 */
export class SessionManager {
  constructor(secret, storage) {
    this.secret = secret;
    this.storage = storage;
    this.lastActivityWrite = new Map(); // sid -> last write timestamp
  }

  _sign(payloadB64) {
    return crypto.createHmac('sha256', this.secret).update(payloadB64).digest('base64url');
  }

  /** Decode and signature-check a token. Returns { sid, uid } or null. */
  _decode(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sig] = parts;
    const expected = this._sign(payloadB64);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (typeof payload.sid !== 'string' || typeof payload.uid !== 'string') return null;
      return { sid: payload.sid, uid: payload.uid };
    } catch {
      return null;
    }
  }

  /** Create a session row for the user and return the signed token */
  create(userId) {
    const sid = crypto.randomBytes(16).toString('hex');
    this.storage.createSession({ id: sid, userId, expiresAt: Date.now() + SESSION_TTL });
    const payloadB64 = Buffer.from(JSON.stringify({ sid, uid: userId })).toString('base64url');
    return `${payloadB64}.${this._sign(payloadB64)}`;
  }

  /**
   * Validate a token against the sessions and users tables.
   * Returns { sid, userId, username, role } or null.
   */
  validate(token) {
    const decoded = this._decode(token);
    if (!decoded) return null;

    const session = this.storage.getSession(decoded.sid);
    if (!session) return null;
    if (session.revoked_at) return null;
    if (session.expires_at <= Date.now()) return null;
    if (session.user_id !== decoded.uid) return null;

    const user = this.storage.getUserById(decoded.uid);
    if (!user || user.disabled) return null;

    // Throttled activity tracking
    const now = Date.now();
    const lastWrite = this.lastActivityWrite.get(decoded.sid) || 0;
    if (now - lastWrite > ACTIVITY_WRITE_THROTTLE_MS) {
      this.lastActivityWrite.set(decoded.sid, now);
      try { this.storage.touchUserActivity(user.id, now); } catch { /* non-fatal */ }
    }

    return { sid: decoded.sid, userId: user.id, username: user.username, role: user.role };
  }

  /** Revoke the session row referenced by the token */
  destroy(token) {
    const decoded = this._decode(token);
    if (!decoded) return;
    this.storage.revokeSession(decoded.sid);
    this.lastActivityWrite.delete(decoded.sid);
  }
}
