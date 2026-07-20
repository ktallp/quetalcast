import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// storage.js reads DATA_DIR at construction time; set env before importing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quetalcast-compliance-test-'));
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

describe('track reporting metadata', () => {
  it('persists isrc, label, duration, and the discrete song title', () => {
    storage.createRoom({ id: 'meta-room', createdAt: 1000 });
    storage.insertTrack('meta-room', {
      ts: 2000,
      title: 'Vicente Fernández - El Rey',
      artist: 'Vicente Fernández',
      album: '16 Éxitos',
      trackTitle: 'El Rey',
      isrc: 'MXF017600123',
      label: 'Sony Discos',
      duration: 195,
    });

    const [row] = storage.getTracks('meta-room');
    assert.equal(row.track_title, 'El Rey');
    assert.equal(row.isrc, 'MXF017600123');
    assert.equal(row.label, 'Sony Discos');
    assert.equal(row.duration, 195);
  });

  it('updates reporting metadata by rowid (the fix-up flow)', () => {
    storage.createRoom({ id: 'fix-room', createdAt: 1000 });
    storage.insertTrack('fix-room', { ts: 3000, title: 'freeform text' });
    const [row] = storage.getTracksInRange(3000, 3001);
    assert.equal(row.isrc, null);

    storage.updateTrackReportingMeta(row.id, {
      trackTitle: 'La Chona',
      artist: 'Los Tucanes De Tijuana',
      album: 'Me Gusta la Banda',
      label: 'Fonovisa',
      isrc: 'MXF049800111',
      duration: 183,
    });

    const [updated] = storage.getTracksInRange(3000, 3001);
    assert.equal(updated.isrc, 'MXF049800111');
    assert.equal(updated.artist, 'Los Tucanes De Tijuana');
  });
});

describe('listener sessions', () => {
  it('opens, closes, and queries sessions by range overlap', () => {
    const roomId = 'session-room';
    storage.createRoom({ id: roomId, createdAt: 1000 });

    const a = storage.openListenerSession(roomId, 'webrtc', 10_000);
    const b = storage.openListenerSession(roomId, 'relay', 20_000);
    assert.ok(a && b && a !== b);

    storage.closeListenerSession(a, 15_000);

    // Range [12k, 18k): session a overlaps (10k-15k), session b starts at 20k and does not
    const overlapping = storage.getListenerSessionsInRange(12_000, 18_000);
    const rooms = overlapping.filter((s) => s.room_id === roomId);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].transport, 'webrtc');

    // Open session b (no left_at) counts as ongoing for a later range
    const later = storage.getListenerSessionsInRange(25_000, 30_000).filter((s) => s.room_id === roomId);
    assert.equal(later.length, 1);
    assert.equal(later[0].transport, 'relay');

    storage.closeRoomListenerSessions(roomId, 40_000);
    const afterClose = storage.getListenerSessionsInRange(45_000, 50_000).filter((s) => s.room_id === roomId);
    assert.equal(afterClose.length, 0);
  });
});

describe('settings', () => {
  it('round-trips station settings', () => {
    assert.equal(storage.getSetting('station_name'), null);
    storage.setSetting('station_name', 'El Paso Rocks');
    storage.setSetting('license_category', 'noncommercial-crb');
    assert.equal(storage.getSetting('station_name'), 'El Paso Rocks');
    assert.equal(storage.getAllSettings().license_category, 'noncommercial-crb');

    storage.setSetting('station_name', 'Renamed');
    assert.equal(storage.getSetting('station_name'), 'Renamed');
  });
});

describe('archives', () => {
  it('tracks archive rows and deletes them', () => {
    storage.upsertArchive('arch-room', '/data/archive/arch-room.mp3');
    storage.updateArchiveBytes('arch-room', 12345);

    const row = storage.getArchive('arch-room');
    assert.equal(row.bytes, 12345);
    assert.equal(storage.listArchives().some((a) => a.room_id === 'arch-room'), true);

    storage.deleteArchive('arch-room');
    assert.equal(storage.getArchive('arch-room'), null);
  });
});
