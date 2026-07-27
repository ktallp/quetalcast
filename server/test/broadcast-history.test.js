import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// storage.js reads DATA_DIR at construction time; set env before importing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quetalcast-history-test-'));
process.env.DATA_DIR = tmpDir;
process.env.LOG_DIR = path.join(tmpDir, 'logs');

const { Storage } = await import('../storage.js');
const { RoomManager } = await import('../room-manager.js');

const fakeLogger = { info() {}, warn() {}, error() {}, debug() {} };

let storage;
let rooms;

before(() => {
  storage = new Storage(null);
  rooms = new RoomManager(fakeLogger, storage);

  storage.createUser({ id: 'u-dj', username: 'nightowl', role: 'dj' });
  storage.createUser({ id: 'u-owner', username: 'stationboss', role: 'owner' });

  // Two ended shows (oldest first) plus one still live
  storage.createRoom({ id: 'show-old', createdAt: 1000, title: 'Old Show', ownerUserId: 'u-dj' });
  storage.endRoom('show-old', 5000);
  storage.createRoom({ id: 'show-new', createdAt: 2000, title: 'New Show', ownerUserId: 'u-owner' });
  storage.endRoom('show-new', 6000);
  storage.createRoom({ id: 'show-live', createdAt: 1500, title: 'Live Show', ownerUserId: 'u-dj' });
  // Orphaned owner id: the user was deleted after the broadcast
  storage.createRoom({ id: 'show-orphan', createdAt: 500, title: 'Orphan', ownerUserId: 'gone' });
  storage.endRoom('show-orphan', 900);

  storage.upsertArchive('show-new', path.join(tmpDir, 'show-new.mp3'));
  storage.updateArchiveBytes('show-new', 4242);
});

after(() => {
  clearInterval(rooms.cleanupInterval);
  clearInterval(rooms.sampleInterval);
  storage.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listRoomsWithMeta', () => {
  it('puts live rooms first, then newest by created_at', () => {
    const ids = storage.listRoomsWithMeta({ limit: 50, offset: 0 }).map((r) => r.id);
    assert.deepEqual(ids, ['show-live', 'show-new', 'show-old', 'show-orphan']);
  });

  it('joins the broadcaster username and leaves it null when the user is gone', () => {
    const byId = Object.fromEntries(storage.listRoomsWithMeta({}).map((r) => [r.id, r]));
    assert.equal(byId['show-live'].username, 'nightowl');
    assert.equal(byId['show-new'].username, 'stationboss');
    assert.equal(byId['show-orphan'].username, null);
  });

  it('flags archives and reports their size', () => {
    const byId = Object.fromEntries(storage.listRoomsWithMeta({}).map((r) => [r.id, r]));
    assert.equal(byId['show-new'].has_archive, 1);
    assert.equal(byId['show-new'].archive_bytes, 4242);
    assert.equal(byId['show-old'].has_archive, 0);
    assert.equal(byId['show-old'].archive_bytes, null);
  });

  it('carries the room fields the panel needs', () => {
    const [live] = storage.listRoomsWithMeta({ limit: 1, offset: 0 });
    assert.equal(live.id, 'show-live');
    assert.equal(live.created_at, 1500);
    assert.equal(live.ended_at, null);
    assert.equal(live.title, 'Live Show');
    assert.equal(live.peak_listeners, 0);
  });

  it('pages with limit and offset without repeating rows', () => {
    const first = storage.listRoomsWithMeta({ limit: 2, offset: 0 }).map((r) => r.id);
    const second = storage.listRoomsWithMeta({ limit: 2, offset: 2 }).map((r) => r.id);
    assert.deepEqual(first, ['show-live', 'show-new']);
    assert.deepEqual(second, ['show-old', 'show-orphan']);
    assert.equal(storage.listRoomsWithMeta({ limit: 2, offset: 4 }).length, 0);
  });

  it('defaults to the first 50 rooms', () => {
    assert.equal(storage.listRoomsWithMeta().length, 4);
  });

  it('countRooms matches the full history', () => {
    assert.equal(storage.countRooms(), 4);
  });
});

describe('relay listener sessions', () => {
  it('skips the listener session for admin monitoring but still relays', () => {
    const roomId = rooms.create('relay-room', 'u-dj').roomId;
    const before = storage.getListenerSessionsInRange(0, Date.now() + 1000).length;

    const normal = {};
    const monitor = {};
    assert.equal(rooms.addRelayListener(roomId, normal), true);
    assert.equal(rooms.addRelayListener(roomId, monitor, { countSession: false }), true);

    assert.equal(rooms.getRelayListeners(roomId).size, 2);
    assert.ok(normal._listenerSessionId);
    assert.equal(monitor._listenerSessionId, null);

    const after = storage.getListenerSessionsInRange(0, Date.now() + 1000).length;
    assert.equal(after, before + 1);

    rooms.removeRelayListener(roomId, normal);
    rooms.removeRelayListener(roomId, monitor);
    assert.equal(rooms.getRelayListeners(roomId).size, 0);
  });
});
