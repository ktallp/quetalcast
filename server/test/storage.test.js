import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// storage.js reads DATA_DIR at construction time; set env before importing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quetalcast-storage-test-'));
process.env.DATA_DIR = tmpDir;
process.env.LOG_DIR = path.join(tmpDir, 'logs');

const { Storage } = await import('../storage.js');

let storage;

before(() => {
  storage = new Storage(null);
});

after(() => {
  storage.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('users CRUD', () => {
  it('creates and fetches a user by id and username', () => {
    const id = crypto.randomUUID();
    storage.createUser({ id, username: 'owner1', role: 'owner', passwordHash: 'hash123' });

    const byId = storage.getUserById(id);
    assert.equal(byId.username, 'owner1');
    assert.equal(byId.role, 'owner');
    assert.equal(byId.disabled, 0);
    assert.equal(byId.password_hash, 'hash123');
    assert.ok(byId.created_at > 0);

    const byName = storage.getUserByUsername('owner1');
    assert.equal(byName.id, id);
  });

  it('returns null for unknown users', () => {
    assert.equal(storage.getUserById('nope'), null);
    assert.equal(storage.getUserByUsername('nope'), null);
  });

  it('enforces unique usernames', () => {
    storage.createUser({ id: crypto.randomUUID(), username: 'unique-name', role: 'dj' });
    assert.throws(() =>
      storage.createUser({ id: crypto.randomUUID(), username: 'unique-name', role: 'dj' })
    );
  });

  it('rejects invalid roles via CHECK constraint', () => {
    assert.throws(() =>
      storage.createUser({ id: crypto.randomUUID(), username: 'bad-role', role: 'admin' })
    );
  });

  it('lists and counts users, counting enabled owners separately', () => {
    const startTotal = storage.countUsers();
    const startOwners = storage.countEnabledOwners();

    const ownerId = crypto.randomUUID();
    storage.createUser({ id: ownerId, username: 'count-owner', role: 'owner' });
    storage.createUser({ id: crypto.randomUUID(), username: 'count-dj', role: 'dj' });

    assert.equal(storage.countUsers(), startTotal + 2);
    assert.equal(storage.countEnabledOwners(), startOwners + 1);
    assert.ok(storage.listUsers().some((u) => u.username === 'count-owner'));

    storage.setUserDisabled(ownerId, true);
    assert.equal(storage.countEnabledOwners(), startOwners);
  });

  it('updates password, disabled flag, and activity timestamp', () => {
    const id = crypto.randomUUID();
    storage.createUser({ id, username: 'updatable', role: 'dj', passwordHash: 'old' });

    storage.setUserPassword(id, 'new-hash');
    assert.equal(storage.getUserById(id).password_hash, 'new-hash');

    storage.setUserDisabled(id, true);
    assert.equal(storage.getUserById(id).disabled, 1);
    storage.setUserDisabled(id, false);
    assert.equal(storage.getUserById(id).disabled, 0);

    storage.touchUserActivity(id, 12345);
    assert.equal(storage.getUserById(id).last_active_at, 12345);
  });

  it('deleteUser removes the user plus their sessions and invites', () => {
    const id = crypto.randomUUID();
    storage.createUser({ id, username: 'doomed', role: 'dj' });
    storage.createSession({ id: 'sess-doomed', userId: id, expiresAt: Date.now() + 10000 });
    storage.createInvite({ token: 'inv-doomed', userId: id, purpose: 'setup', expiresAt: Date.now() + 10000 });

    storage.deleteUser(id);
    assert.equal(storage.getUserById(id), null);
    assert.equal(storage.getSession('sess-doomed'), null);
    assert.equal(storage.getInvite('inv-doomed'), null);
  });
});

describe('invites', () => {
  it('creates and consumes an invite (single-use via used_at)', () => {
    const token = 'invite-' + crypto.randomUUID();
    const userId = crypto.randomUUID();
    storage.createInvite({ token, userId, purpose: 'setup', expiresAt: Date.now() + 60000 });

    const fresh = storage.getInvite(token);
    assert.equal(fresh.user_id, userId);
    assert.equal(fresh.purpose, 'setup');
    assert.equal(fresh.used_at, null);

    storage.markInviteUsed(token);
    const used = storage.getInvite(token);
    assert.ok(used.used_at, 'used_at should be set after consumption');

    // A second consumer sees the invite as already used
    assert.ok(storage.getInvite(token).used_at);
  });

  it('returns null for unknown invite tokens', () => {
    assert.equal(storage.getInvite('missing-token'), null);
  });
});

describe('rooms', () => {
  it('persists a room and round-trips its fields', () => {
    storage.createRoom({ id: 'room-a', createdAt: 111, title: 'Show', description: 'Desc', ownerUserId: 'u1' });
    const room = storage.getRoom('room-a');
    assert.equal(room.created_at, 111);
    assert.equal(room.ended_at, null);
    assert.equal(room.title, 'Show');
    assert.equal(room.description, 'Desc');
    assert.equal(room.owner_user_id, 'u1');
    assert.equal(room.peak_listeners, 0);
  });

  it('createRoom upserts: recreating a room resets ended_at and peak', () => {
    storage.createRoom({ id: 'room-b', createdAt: 1 });
    storage.endRoom('room-b', 2);
    storage.updatePeakListeners('room-b', 7);
    assert.equal(storage.getRoom('room-b').ended_at, 2);

    storage.createRoom({ id: 'room-b', createdAt: 3, title: 'Again' });
    const room = storage.getRoom('room-b');
    assert.equal(room.ended_at, null);
    assert.equal(room.created_at, 3);
    assert.equal(room.peak_listeners, 0);
    assert.equal(room.title, 'Again');
  });

  it('end/reopen/updateRoomInfo/updatePeakListeners', () => {
    storage.createRoom({ id: 'room-c', createdAt: 10 });
    storage.endRoom('room-c', 99);
    assert.equal(storage.getRoom('room-c').ended_at, 99);
    storage.reopenRoom('room-c');
    assert.equal(storage.getRoom('room-c').ended_at, null);

    storage.updateRoomInfo('room-c', 'New Title', 'New Desc');
    assert.equal(storage.getRoom('room-c').title, 'New Title');

    storage.updatePeakListeners('room-c', 5);
    storage.updatePeakListeners('room-c', 3); // MAX() keeps 5
    assert.equal(storage.getRoom('room-c').peak_listeners, 5);
  });

  it('getRecentRooms returns live rooms and those ended after the cutoff', () => {
    storage.createRoom({ id: 'recent-live', createdAt: 1 });
    storage.createRoom({ id: 'recent-ended', createdAt: 1 });
    storage.endRoom('recent-ended', 1000);
    storage.createRoom({ id: 'old-ended', createdAt: 1 });
    storage.endRoom('old-ended', 10);

    const ids = storage.getRecentRooms(500).map((r) => r.id);
    assert.ok(ids.includes('recent-live'));
    assert.ok(ids.includes('recent-ended'));
    assert.ok(!ids.includes('old-ended'));
  });

  it('deleteRoom cascades to tracks, chat, and listener samples', () => {
    storage.createRoom({ id: 'room-d', createdAt: 1 });
    storage.insertTrack('room-d', { ts: 1, title: 'Song' });
    storage.insertChat('room-d', { ts: 1, name: 'a', text: 'hi' });
    storage.insertListenerSample('room-d', 1, 3);

    storage.deleteRoom('room-d');
    assert.equal(storage.getRoom('room-d'), null);
    assert.equal(storage.getTracks('room-d').length, 0);
    assert.equal(storage.getChat('room-d').length, 0);
    assert.equal(storage.getListenerSamples('room-d', 0).length, 0);
  });
});

describe('tracks and chat caps', () => {
  it('getTracks caps at 100 by default, newest first', () => {
    storage.createRoom({ id: 'trackful', createdAt: 1 });
    for (let i = 0; i < 105; i++) {
      storage.insertTrack('trackful', { ts: 1000 + i, title: `Track ${i}`, artist: 'A', source: 'live' });
    }
    const tracks = storage.getTracks('trackful');
    assert.equal(tracks.length, 100);
    assert.equal(tracks[0].title, 'Track 104'); // newest first
    assert.equal(tracks[99].title, 'Track 5');

    const limited = storage.getTracks('trackful', 10);
    assert.equal(limited.length, 10);
    assert.equal(limited[0].title, 'Track 104');
  });

  it('getChat caps at 200 by default and returns oldest first', () => {
    storage.createRoom({ id: 'chatty', createdAt: 1 });
    for (let i = 0; i < 205; i++) {
      storage.insertChat('chatty', { ts: 2000 + i, name: 'user', text: `msg ${i}`, system: false });
    }
    const chat = storage.getChat('chatty');
    assert.equal(chat.length, 200);
    // The 200 newest messages, ordered oldest to newest
    assert.equal(chat[0].text, 'msg 5');
    assert.equal(chat[199].text, 'msg 204');
  });

  it('insertChat records the system flag as 0/1', () => {
    storage.createRoom({ id: 'sysroom', createdAt: 1 });
    storage.insertChat('sysroom', { ts: 1, name: 'srv', text: 'joined', system: true });
    storage.insertChat('sysroom', { ts: 2, name: 'u', text: 'hello', system: false });
    const chat = storage.getChat('sysroom');
    assert.equal(chat[0].system, 1);
    assert.equal(chat[1].system, 0);
  });
});

describe('slugs', () => {
  it('upsertSlug inserts, then updates last_used_at on conflict', () => {
    storage.upsertSlug('my-show', 100);
    storage.upsertSlug('other-show', 200);
    storage.upsertSlug('my-show', 300); // upsert, not duplicate

    const slugs = storage.listSlugs();
    const mine = slugs.filter((s) => s.slug === 'my-show');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].last_used_at, 300);
    // Most recently used first
    assert.equal(slugs[0].slug, 'my-show');
  });

  it('deleteSlug removes the slug', () => {
    storage.upsertSlug('temp-slug', 1);
    storage.deleteSlug('temp-slug');
    assert.ok(!storage.listSlugs().some((s) => s.slug === 'temp-slug'));
  });
});
