import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrameHeader, splitFrames, RelayOutput } from '../relay-output.js';

/** Build a fake MPEG-1 Layer III frame: 128 kbps, 44.1 kHz, stereo, optional padding */
function frame(padding = 0, fill = 0xaa) {
  const len = Math.floor((144 * 128000) / 44100) + padding; // 417 or 418
  const buf = Buffer.alloc(len, fill);
  buf[0] = 0xff;
  buf[1] = 0xfb;                    // MPEG-1, Layer III, no CRC
  buf[2] = (9 << 4) | (0 << 2) | (padding << 1); // 128 kbps, 44.1 kHz
  buf[3] = 0x00;                    // stereo
  return buf;
}

test('parseFrameHeader reads MPEG-1 Layer III 128k/44.1k frames', () => {
  const h = parseFrameHeader(frame(0));
  assert.deepEqual(h, { length: 417, samples: 1152, sampleRate: 44100 });
  assert.equal(parseFrameHeader(frame(1)).length, 418);
  assert.equal(parseFrameHeader(Buffer.from([0x00, 0x00, 0x00, 0x00])), null);
  assert.equal(parseFrameHeader(Buffer.from([0xff, 0xfb, 0xf0, 0x00])), null); // bad bitrate index
});

test('splitFrames returns whole frames and keeps the tail for the next call', () => {
  const stream = Buffer.concat([frame(0), frame(1), frame(0)]);
  const first = stream.subarray(0, 417 + 100);
  const r1 = splitFrames(first);
  assert.equal(r1.frames.length, 1);
  assert.equal(r1.rest.length, 100);
  const r2 = splitFrames(Buffer.concat([r1.rest, stream.subarray(417 + 100)]));
  assert.equal(r2.frames.length, 2);
  assert.equal(r2.rest.length, 0);
  assert.ok(Math.abs(r2.frames[0].ms - 26.12) < 0.01);
});

test('splitFrames skips junk such as a leftover tag before the first frame', () => {
  const junk = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x0aXXXXXXXXXX', 'latin1');
  const r = splitFrames(Buffer.concat([junk, frame(0), frame(0)]));
  assert.equal(r.frames.length, 2);
  assert.equal(r.rest.length, 0);
});

function makeOutput(overrides = {}) {
  let now = 1_000_000;
  const emitted = [];
  const out = new RelayOutput({
    silentFrame: frame(0, 0x00),
    silentFrameMs: 1152000 / 44100,
    emit: (data, isFill) => emitted.push({ bytes: data.length, isFill }),
    now: () => now,
    ...overrides,
  });
  return { out, emitted, advance: (ms) => { now += ms; } };
}

test('real frames pass straight through and healthy 250 ms bursts get no fill', () => {
  const { out, emitted, advance } = makeOutput();
  for (let i = 0; i < 8; i++) {
    out.pushEncoded(Buffer.concat(Array.from({ length: 10 }, () => frame(0))));
    for (let t = 0; t < 250; t += 100) { advance(100); out.tick(); }
  }
  assert.ok(emitted.length >= 8);
  assert.equal(emitted.filter((e) => e.isFill).length, 0);
  assert.equal(out.health().filling, false);
});

test('a stall is filled with silence at the real-time rate and counted', () => {
  const { out, emitted, advance } = makeOutput();
  out.pushEncoded(Buffer.concat([frame(0), frame(0)]));
  // Nothing arrives for 3 seconds
  for (let t = 0; t < 3000; t += 100) { advance(100); out.tick(); }
  const fill = emitted.filter((e) => e.isFill);
  assert.ok(fill.length > 0);
  const fillBytes = fill.reduce((n, e) => n + e.bytes, 0);
  const fillFrames = fillBytes / 417;
  // ~3 s of 26.12 ms frames, minus the 750 ms grace before filling begins
  assert.ok(fillFrames >= 100 && fillFrames <= 116, `filled ${fillFrames} frames`);
  assert.equal(out.health().filling, true);
  assert.ok(out.health().gapMs >= 2900);

  // Audio resumes: fill stops, the stall is recorded
  out.pushEncoded(frame(0));
  const h = out.health();
  assert.equal(h.filling, false);
  assert.equal(h.stalls, 1);
  assert.ok(h.lastStallMs >= 2900);
  advance(100); out.tick();
  assert.equal(emitted.filter((e) => e.isFill).length, fill.length);
});

test('burst holds the last few seconds of frames, fill included', () => {
  const { out, advance } = makeOutput({ burstMs: 1000 });
  for (let i = 0; i < 100; i++) out.pushEncoded(frame(0));
  const burst = out.burst();
  // 1000 ms / 26.12 ms = ~38 frames
  assert.ok(burst.length / 417 >= 37 && burst.length / 417 <= 39, `burst ${burst.length / 417} frames`);
  advance(2000); out.tick();
  assert.ok(out.burst().length / 417 <= 39);
});

test('no fill before the first real frame', () => {
  const { out, emitted, advance } = makeOutput();
  for (let t = 0; t < 5000; t += 100) { advance(100); out.tick(); }
  assert.equal(emitted.length, 0);
  assert.equal(out.health().streaming, false);
});

test('late audio arriving after a filled stall is dropped rather than pushing players behind live', () => {
  const { out, emitted, advance } = makeOutput();
  out.pushEncoded(frame(0));
  for (let t = 0; t < 4000; t += 100) { advance(100); out.tick(); }
  const fillBefore = emitted.filter((e) => e.isFill).length;
  assert.ok(fillBefore > 0);
  // The stalled 4 s of audio now arrives in one burst (~153 frames)
  const burst = Buffer.concat(Array.from({ length: 153 }, () => frame(0)));
  const realBefore = emitted.filter((e) => !e.isFill).reduce((n, e) => n + e.bytes, 0);
  out.pushEncoded(burst);
  const realAfter = emitted.filter((e) => !e.isFill).reduce((n, e) => n + e.bytes, 0);
  const kept = (realAfter - realBefore) / 417;
  // Only ~1 s (MAX_AHEAD_MS) of the burst may go out
  assert.ok(kept <= 39 && kept >= 36, `kept ${kept} frames`);
  assert.ok(out.health().droppedMs > 2900, `dropped ${out.health().droppedMs} ms`);
});

test('normal quarter-second bursts never trip the late-audio guard', () => {
  const { out, advance } = makeOutput();
  for (let i = 0; i < 40; i++) {
    out.pushEncoded(Buffer.concat(Array.from({ length: 10 }, () => frame(0)))); // ~261 ms of audio
    advance(250); out.tick(); // wait: 261 ms every 250 ms is slightly fast
    advance(11);
  }
  assert.equal(out.health().droppedMs, 0);
});
