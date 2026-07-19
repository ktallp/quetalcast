import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// storage.js reads DATA_DIR at construction time; set env before importing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quetalcast-auth-test-'));
process.env.DATA_DIR = tmpDir;
process.env.LOG_DIR = path.join(tmpDir, 'logs');

const { Storage } = await import('../storage.js');
const { SessionManager, hashPassword, verifyPassword } = await import('../auth.js');

const SECRET = 'test-secret-key';

let storage;
let sessions;

function makeUser(username, role = 'owner') {
  const id = crypto.randomUUID();
  storage.createUser({ id, username, role, passwordHash: hashPassword('pw-' + username) });
  return storage.getUserById(id);
}

/** Extract the session id from a signed token's payload */
function sidFromToken(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  return payload.sid;
}

before(() => {
  storage = new Storage(null);
  sessions = new SessionManager(SECRET, storage);
});

after(() => {
  storage.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('password hashing', () => {
  it('hashPassword/verifyPassword round-trip', () => {
    const hash = hashPassword('correct horse');
    assert.notEqual(hash, 'correct horse');
    assert.equal(verifyPassword('correct horse', hash), true);
    assert.equal(verifyPassword('wrong', hash), false);
  });

  it('verifyPassword rejects empty inputs', () => {
    assert.equal(verifyPassword('', hashPassword('x')), false);
    assert.equal(verifyPassword('x', ''), false);
    assert.equal(verifyPassword(null, null), false);
  });
});

describe('SessionManager', () => {
  it('create/validate round-trip returns user identity', () => {
    const user = makeUser('alice');
    const token = sessions.create(user.id);
    assert.ok(typeof token === 'string' && token.includes('.'));

    const result = sessions.validate(token);
    assert.ok(result);
    assert.equal(result.userId, user.id);
    assert.equal(result.username, 'alice');
    assert.equal(result.role, 'owner');
    assert.equal(result.sid, sidFromToken(token));
  });

  it('destroy revokes the session', () => {
    const user = makeUser('bob');
    const token = sessions.create(user.id);
    assert.ok(sessions.validate(token));

    sessions.destroy(token);
    assert.equal(sessions.validate(token), null);

    const row = storage.getSession(sidFromToken(token));
    assert.ok(row.revoked_at, 'revoked_at should be set on the session row');
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const user = makeUser('carol');
    const other = makeUser('carol2');
    const token = sessions.create(user.id);
    const [payloadB64, sig] = token.split('.');

    // Swap the uid inside the payload without re-signing
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    payload.uid = other.id;
    const forgedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assert.equal(sessions.validate(`${forgedPayload}.${sig}`), null);
  });

  it('rejects a token signed with a different secret', () => {
    const user = makeUser('dave');
    const rogue = new SessionManager('another-secret', storage);
    const token = rogue.create(user.id);
    assert.equal(sessions.validate(token), null);
  });

  it('rejects malformed tokens', () => {
    assert.equal(sessions.validate(null), null);
    assert.equal(sessions.validate(''), null);
    assert.equal(sessions.validate('nodots'), null);
    assert.equal(sessions.validate('too.many.parts'), null);
    assert.equal(sessions.validate('!!!.###'), null);
  });

  it('rejects a session for a disabled user', () => {
    const user = makeUser('eve');
    const token = sessions.create(user.id);
    assert.ok(sessions.validate(token));

    storage.setUserDisabled(user.id, true);
    assert.equal(sessions.validate(token), null);

    storage.setUserDisabled(user.id, false);
    assert.ok(sessions.validate(token), 'validates again once re-enabled');
  });

  it('rejects an expired session', () => {
    const user = makeUser('frank');
    const token = sessions.create(user.id);

    // Force the session row into the past
    storage.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1000, sidFromToken(token));

    assert.equal(sessions.validate(token), null);
  });

  it('rejects a valid-signature token whose session row is missing', () => {
    const user = makeUser('grace');
    const token = sessions.create(user.id);
    storage.db.prepare('DELETE FROM sessions WHERE id = ?').run(sidFromToken(token));
    assert.equal(sessions.validate(token), null);
  });

  it('destroy tolerates garbage tokens', () => {
    assert.doesNotThrow(() => sessions.destroy('garbage'));
    assert.doesNotThrow(() => sessions.destroy(null));
  });
});
