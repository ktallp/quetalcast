import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// storage.js and logger.js read env at construction/import time; set env first
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quetalcast-room-test-'));
process.env.DATA_DIR = tmpDir;
process.env.LOG_DIR = path.join(tmpDir, 'logs');

const { Storage } = await import('../storage.js');
const { RoomManager, usernameToSlug } = await import('../room-manager.js');

const fakeLogger = { info() {}, warn() {}, error() {}, debug() {} };

function fakeWs() {
  return { readyState: 1, send() {}, close() {} };
}

/** Stop a RoomManager's background intervals so the test process can exit */
function stopIntervals(rm) {
  clearInterval(rm.cleanupInterval);
  clearInterval(rm.sampleInterval);
}

let storage;
let rm;
const managers = [];

function newManager() {
  const manager = new RoomManager(fakeLogger, storage);
  managers.push(manager);
  return manager;
}

before(() => {
  storage = new Storage(null);
  rm = newManager();
});

after(() => {
  for (const manager of managers) stopIntervals(manager);
  storage.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateCustomId', () => {
  it('accepts valid slugs', () => {
    assert.equal(RoomManager.validateCustomId('dj'), null);
    assert.equal(RoomManager.validateCustomId('abc'), null);
    assert.equal(RoomManager.validateCustomId('my-room'), null);
    assert.equal(RoomManager.validateCustomId('show-42'), null);
    assert.equal(RoomManager.validateCustomId('a'.repeat(40)), null);
  });

  it('rejects non-strings', () => {
    assert.match(RoomManager.validateCustomId(null), /must be a string/);
    assert.match(RoomManager.validateCustomId(42), /must be a string/);
  });

  it('rejects too short and too long slugs', () => {
    assert.match(RoomManager.validateCustomId('a'), /2-40 characters/);
    assert.match(RoomManager.validateCustomId(''), /2-40 characters/);
    assert.match(RoomManager.validateCustomId('a'.repeat(41)), /2-40 characters/);
  });

  it('rejects bad characters and leading/trailing hyphens', () => {
    assert.match(RoomManager.validateCustomId('My-Room'), /lowercase/);
    assert.match(RoomManager.validateCustomId('has_underscore'), /lowercase/);
    assert.match(RoomManager.validateCustomId('has space'), /lowercase/);
    assert.match(RoomManager.validateCustomId('-leading'), /lowercase/);
    assert.match(RoomManager.validateCustomId('trailing-'), /lowercase/);
  });

  it('rejects consecutive hyphens', () => {
    assert.match(RoomManager.validateCustomId('a--b'), /consecutive hyphens/i);
    assert.match(RoomManager.validateCustomId('one--two-three'), /consecutive hyphens/i);
  });
});

describe('usernameToSlug', () => {
  it('lowercases and maps dots and underscores to hyphens', () => {
    assert.equal(usernameToSlug('DJ_Nova'), 'dj-nova');
    assert.equal(usernameToSlug('tom.larkin'), 'tom-larkin');
    assert.equal(usernameToSlug('MiXeD.Case_Name'), 'mixed-case-name');
  });

  it('collapses and trims hyphen runs', () => {
    assert.equal(usernameToSlug('a._b'), 'a-b');
    assert.equal(usernameToSlug('__dj__'), 'dj');
    assert.equal(usernameToSlug('-edge-'), 'edge');
    assert.equal(usernameToSlug('a---b'), 'a-b');
  });

  it('leaves already-valid slugs alone', () => {
    assert.equal(usernameToSlug('nightowl'), 'nightowl');
    assert.equal(usernameToSlug('show-42'), 'show-42');
  });

  it('can produce output that is not a valid room id', () => {
    assert.equal(usernameToSlug(''), '');
    assert.equal(usernameToSlug('___'), '');
    assert.equal(usernameToSlug(null), '');
    assert.equal(usernameToSlug('x'), 'x');
    assert.ok(RoomManager.validateCustomId(usernameToSlug('x')));
  });
});

describe('room creation', () => {
  it('creates a room with a generated 7-char id when no custom id given', () => {
    const result = rm.create();
    assert.equal(result.ok, true);
    assert.equal(result.roomId.length, 7);
    assert.ok(rm.rooms.has(result.roomId));
  });

  it('creates a room with a custom slug and records slug history', () => {
    const result = rm.create('my-cool-show');
    assert.equal(result.ok, true);
    assert.equal(result.roomId, 'my-cool-show');

    const history = rm.getSlugHistory();
    const entry = history.find((e) => e.slug === 'my-cool-show');
    assert.ok(entry);
    assert.equal(entry.live, false); // no broadcaster yet
    assert.ok(storage.listSlugs().some((s) => s.slug === 'my-cool-show'));
  });

  it('rejects an invalid custom slug', () => {
    const result = rm.create('Bad Slug!');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_ROOM_ID');
  });

  it('rejects a slug that is currently live, but reclaims a non-live one', () => {
    rm.create('busy-room');
    const ws = fakeWs();
    assert.equal(rm.join('busy-room', 'broadcaster', ws).ok, true);

    const taken = rm.create('busy-room');
    assert.equal(taken.ok, false);
    assert.equal(taken.code, 'ROOM_ID_TAKEN');

    // Broadcaster socket goes dead: slug becomes reclaimable
    ws.readyState = 3;
    const reclaimed = rm.create('busy-room');
    assert.equal(reclaimed.ok, true);
    assert.equal(reclaimed.roomId, 'busy-room');
  });
});

describe('default room id (username slug)', () => {
  it('uses the default id without recording slug history', () => {
    const result = rm.create(undefined, 'user-1', { defaultId: 'dj-nova' });
    assert.equal(result.ok, true);
    assert.equal(result.roomId, 'dj-nova');
    assert.equal(rm.getSlugHistory().some((e) => e.slug === 'dj-nova'), false);
    assert.equal(storage.listSlugs().some((s) => s.slug === 'dj-nova'), false);
  });

  it('still records slug history for an explicit custom id', () => {
    const result = rm.create('hand-typed', 'user-1', { defaultId: 'dj-nova' });
    assert.equal(result.ok, true);
    assert.equal(result.roomId, 'hand-typed');
    assert.ok(rm.getSlugHistory().some((e) => e.slug === 'hand-typed'));
  });

  it('accepts a two-character default id', () => {
    const result = rm.create(undefined, 'user-2', { defaultId: 'dj' });
    assert.equal(result.ok, true);
    assert.equal(result.roomId, 'dj');
  });

  it('falls back to a random id when the default id is invalid', () => {
    const result = rm.create(undefined, 'user-3', { defaultId: 'x' });
    assert.equal(result.ok, true);
    assert.equal(result.roomId.length, 7);
    assert.notEqual(result.roomId, 'x');
  });

  it('falls back to a random id when the default id is live elsewhere', () => {
    rm.create(undefined, 'user-4', { defaultId: 'popular-dj' });
    const ws = fakeWs();
    assert.equal(rm.join('popular-dj', 'broadcaster', ws).ok, true);

    const second = rm.create(undefined, 'user-5', { defaultId: 'popular-dj' });
    assert.equal(second.ok, true);
    assert.equal(second.roomId.length, 7);
    assert.notEqual(second.roomId, 'popular-dj');
  });

  it('reclaims the broadcaster own ended room at the default id', () => {
    rm.create(undefined, 'user-6', { defaultId: 'returning-dj' });
    rm.join('returning-dj', 'broadcaster', fakeWs());
    rm.addChat('returning-dj', { name: 'dj', text: 'set 1' });
    rm.leave('returning-dj', 'broadcaster');

    const again = rm.create(undefined, 'user-6', { defaultId: 'returning-dj' });
    assert.equal(again.ok, true);
    assert.equal(again.roomId, 'returning-dj');
    assert.equal(rm.join('returning-dj', 'broadcaster', fakeWs()).ok, true);
  });
});

describe('join and receiver cap', () => {
  it('rejects joining a missing room and invalid roles', () => {
    assert.equal(rm.join('no-such-room', 'receiver', fakeWs()).code, 'ROOM_NOT_FOUND');
    const { roomId } = rm.create('role-check');
    assert.equal(rm.join(roomId, 'listener', fakeWs()).code, 'INVALID_ROLE');
  });

  it('locks the broadcaster slot while live', () => {
    const { roomId } = rm.create('one-dj-only');
    assert.equal(rm.join(roomId, 'broadcaster', fakeWs()).ok, true);
    const second = rm.join(roomId, 'broadcaster', fakeWs());
    assert.equal(second.ok, false);
    assert.equal(second.code, 'BROADCASTER_OCCUPIED');
  });

  it('caps receivers at MAX_RECEIVERS (4)', () => {
    const { roomId } = rm.create('full-house');
    rm.join(roomId, 'broadcaster', fakeWs());

    const ids = [];
    for (let i = 0; i < 4; i++) {
      const result = rm.join(roomId, 'receiver', fakeWs());
      assert.equal(result.ok, true, `receiver ${i + 1} should join`);
      ids.push(result.receiverId);
    }
    assert.equal(new Set(ids).size, 4);

    const fifth = rm.join(roomId, 'receiver', fakeWs());
    assert.equal(fifth.ok, false);
    assert.equal(fifth.code, 'ROOM_FULL');

    // A receiver leaving frees a slot
    rm.leave(roomId, 'receiver', ids[0]);
    assert.equal(rm.join(roomId, 'receiver', fakeWs()).ok, true);
  });
});

describe('room lifecycle: end, keep, recover', () => {
  it('broadcaster leave ends the room but keeps it for history', () => {
    const { roomId } = rm.create('ends-gracefully');
    rm.join(roomId, 'broadcaster', fakeWs());
    rm.addChat(roomId, { name: 'dj', text: 'hello' });

    rm.leave(roomId, 'broadcaster');
    const room = rm.rooms.get(roomId);
    assert.ok(room, 'room is kept after broadcast ends');
    assert.ok(room.endedAt, 'endedAt is set');
    assert.ok(storage.getRoom(roomId).ended_at, 'persisted ended_at is set');
  });

  it('deletes a room that ends up empty and was never used', () => {
    const { roomId } = rm.create();
    const join = rm.join(roomId, 'receiver', fakeWs());
    rm.leave(roomId, 'receiver', join.receiverId);
    assert.equal(rm.rooms.has(roomId), false);
    assert.equal(storage.getRoom(roomId), null);
  });

  it('reopen clears the ended state in memory and storage', () => {
    const { roomId } = rm.create('comeback-show');
    rm.join(roomId, 'broadcaster', fakeWs());
    rm.addChat(roomId, { name: 'dj', text: 'set 1' });
    rm.leave(roomId, 'broadcaster');
    assert.ok(rm.rooms.get(roomId).endedAt);

    rm.reopen(roomId);
    assert.equal(rm.rooms.get(roomId).endedAt, null);
    assert.equal(storage.getRoom(roomId).ended_at, null);

    // Broadcaster can rejoin the reopened room
    assert.equal(rm.join(roomId, 'broadcaster', fakeWs()).ok, true);
  });

  it('recovers a recently ended room (with tracks and chat) after a restart', () => {
    const { roomId } = rm.create('survives-restart');
    rm.join(roomId, 'broadcaster', fakeWs());
    rm.addTrack(roomId, {
      text: 'Artist - Great Song',
      artist: 'Artist',
      album: 'Album',
      releaseDate: '2021-06-01',
      coverMedium: 'https://covers.example/x.jpg',
    });
    rm.addChat(roomId, { name: 'listener', text: 'great set' });
    rm.addChat(roomId, { name: 'server', text: 'dj left', system: true });
    rm.leave(roomId, 'broadcaster');

    // Simulate a restart: fresh RoomManager over the same storage
    const rm2 = newManager();
    const restored = rm2.rooms.get(roomId);
    assert.ok(restored, 'room restored from storage within 24h');
    assert.ok(restored.endedAt, 'restored room is marked ended');

    assert.equal(restored.trackList.length, 1);
    assert.equal(restored.trackList[0].title, 'Artist - Great Song');
    assert.equal(restored.trackList[0].artist, 'Artist');
    assert.equal(restored.trackList[0].album, 'Album');
    assert.equal(restored.trackList[0].releaseDate, '2021'); // year only survives persistence

    assert.equal(restored.chatHistory.length, 2);
    assert.equal(restored.chatHistory[0].text, 'great set');
    assert.equal(restored.chatHistory[1].system, true);

    // The broadcaster can recover the room on the new instance
    rm2.reopen(roomId);
    assert.equal(rm2.join(roomId, 'broadcaster', fakeWs()).ok, true);
  });

  it('does not restore rooms that ended more than 24h ago', () => {
    const staleId = 'stale-room';
    storage.createRoom({ id: staleId, createdAt: Date.now() - 30 * 60 * 60 * 1000 });
    storage.endRoom(staleId, Date.now() - 25 * 60 * 60 * 1000);

    const rm3 = newManager();
    assert.equal(rm3.rooms.has(staleId), false);
  });

  it('marks a still-live room as ended when restored (server died mid-broadcast)', () => {
    const crashId = 'crashed-live-room';
    storage.createRoom({ id: crashId, createdAt: Date.now() - 60 * 1000 });
    // ended_at is NULL: process died while live
    const rm4 = newManager();
    const restored = rm4.rooms.get(crashId);
    assert.ok(restored);
    assert.ok(restored.endedAt, 'restored live room gets endedAt stamped');
    assert.ok(storage.getRoom(crashId).ended_at, 'ended_at persisted');
  });
});

describe('in-memory caps', () => {
  it('trackList caps at 100 entries, newest first', () => {
    const { roomId } = rm.create('track-cap');
    for (let i = 0; i < 105; i++) {
      rm.addTrack(roomId, { text: `Track ${i}` });
    }
    const list = rm.getTrackList(roomId);
    assert.equal(list.length, 100);
    assert.equal(list[0].title, 'Track 104');
  });

  it('chatHistory caps at 200 messages, keeping the newest', () => {
    const { roomId } = rm.create('chat-cap');
    for (let i = 0; i < 205; i++) {
      rm.addChat(roomId, { name: 'u', text: `msg ${i}` });
    }
    const history = rm.getChatHistory(roomId);
    assert.equal(history.length, 200);
    assert.equal(history[0].text, 'msg 5');
    assert.equal(history[199].text, 'msg 204');
  });
});
