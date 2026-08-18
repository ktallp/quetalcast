/**
 * Relay output pacing.
 *
 * The HTTP relay (RadioDJ, VLC, internet-radio.com) is fed by the
 * broadcaster's browser over a WebSocket, transcoded to MP3 by FFmpeg, and
 * written to each listener as it arrives. TCP never drops bytes, it stalls
 * them, so any hiccup on the broadcaster's link becomes a pause in the MP3
 * byte stream, and players such as RadioDJ (BASS) treat a pause as the end
 * of the stream. Nothing on that path shows up as "packet loss" anywhere.
 *
 * This module keeps the byte stream continuous:
 *
 * - FFmpeg output is split into whole MP3 frames so anything we insert lands
 *   on a frame boundary.
 * - When no real frame has gone out for GAP_MS, silent frames are emitted at
 *   the real-time rate until real audio resumes. The listener hears a short
 *   silence instead of an underrun, and its buffer keeps a steady fill.
 * - The last BURST_MS of frames are kept in a ring and sent to a listener as
 *   soon as it connects (Icecast's burst-on-connect), so its buffer starts
 *   full and the first stall has a cushion to eat into.
 *
 * Fill silence goes to the archive too so its timeline stays wall-clock
 * aligned with the chat replay.
 */

const BITRATES = {
  // [MPEG version][layer] -> kbps table (index 1..14)
  1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  },
  2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
};
const SAMPLE_RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

/**
 * Parse an MPEG audio frame header at `offset`.
 * Returns { length, samples, sampleRate } or null when the bytes are not a
 * valid header. `length` includes the 4 header bytes.
 */
export function parseFrameHeader(buf, offset = 0) {
  if (buf.length < offset + 4) return null;
  const b1 = buf[offset], b2 = buf[offset + 1], b3 = buf[offset + 2];
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;

  const versionBits = (b2 >> 3) & 3; // 0: MPEG 2.5, 1: reserved, 2: MPEG 2, 3: MPEG 1
  const layerBits = (b2 >> 1) & 3;   // 1: Layer III, 2: Layer II, 3: Layer I
  if (versionBits === 1 || layerBits === 0) return null;
  const layer = 4 - layerBits;
  const versionKey = versionBits === 3 ? 1 : 2; // MPEG 2 and 2.5 share bitrate tables
  const bitrateIdx = b3 >> 4;
  const sampleIdx = (b3 >> 2) & 3;
  const padding = (b3 >> 1) & 1;
  if (bitrateIdx === 0 || bitrateIdx === 15 || sampleIdx === 3) return null;

  const bitrate = BITRATES[versionKey][layer][bitrateIdx] * 1000;
  const sampleRate = SAMPLE_RATES[versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25][sampleIdx];

  let length, samples;
  if (layer === 1) {
    length = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
    samples = 384;
  } else if (layer === 2) {
    length = Math.floor((144 * bitrate) / sampleRate) + padding;
    samples = 1152;
  } else if (versionBits === 3) {
    length = Math.floor((144 * bitrate) / sampleRate) + padding;
    samples = 1152;
  } else {
    length = Math.floor((72 * bitrate) / sampleRate) + padding;
    samples = 576;
  }
  if (length < 4) return null;
  return { length, samples, sampleRate };
}

/**
 * Split a byte stream into whole MPEG frames. Bytes that do not form a
 * complete frame yet are returned as `rest` to be prepended to the next call.
 * Junk between frames (a stray tag, a partial frame after a restart) is
 * skipped one byte at a time until a header that is followed by another
 * valid header, or by the end of the buffer, is found.
 */
export function splitFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos < buf.length) {
    const hdr = parseFrameHeader(buf, pos);
    if (!hdr) { pos++; continue; }
    if (pos + hdr.length > buf.length) break; // incomplete frame: keep for later
    // Guard against false syncs inside data: the next bytes, if any, must
    // start another frame.
    if (pos + hdr.length + 4 <= buf.length && !parseFrameHeader(buf, pos + hdr.length)) {
      pos++;
      continue;
    }
    frames.push({ data: buf.subarray(pos, pos + hdr.length), ms: (hdr.samples / hdr.sampleRate) * 1000 });
    pos += hdr.length;
  }
  return { frames, rest: buf.subarray(pos) };
}

// The recorder delivers a chunk every 250 ms, so healthy output arrives in
// bursts a quarter second apart; the gap threshold sits well above that so
// silence is only ever spliced into a genuine stall.
export const GAP_MS = 750;      // no real frame for this long: start filling
export const BURST_MS = 4000;   // backlog sent to a listener on connect
export const STALL_MS = 1000;   // a gap this long counts as a stall in the health report

export class RelayOutput {
  /**
   * @param {object} opts
   * @param {Buffer} opts.silentFrame  one silent MP3 frame matching the transcoder's format
   * @param {number} opts.silentFrameMs duration of that frame
   * @param {(data: Buffer, isFill: boolean) => void} opts.emit called for every frame (or batch) to write
   * @param {() => number} [opts.now]
   */
  constructor({ silentFrame, silentFrameMs, emit, now = Date.now, gapMs = GAP_MS, burstMs = BURST_MS }) {
    this.silentFrame = silentFrame;
    this.silentFrameMs = silentFrameMs;
    this.emit = emit;
    this.now = now;
    this.gapMs = gapMs;
    this.burstMs = burstMs;

    this.rest = Buffer.alloc(0);
    this.ring = [];        // { data, ms }
    this.ringMs = 0;

    /** Wall-clock time the stream position reached (real or fill) */
    this.streamAt = null;
    this.lastRealAt = null;
    this.lastIngestAt = null;
    this.filling = false;
    this.fillStartedAt = null;
    this.stalls = 0;
    this.totalFillMs = 0;
    this.lastStallMs = 0;
  }

  /** The broadcaster delivered a chunk (may not yield a whole frame yet) */
  noteIngest() {
    this.lastIngestAt = this.now();
  }

  /** Transcoded bytes from FFmpeg */
  pushEncoded(chunk) {
    const { frames, rest } = splitFrames(this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk);
    this.rest = Buffer.from(rest); // copy so the big chunk can be released
    if (frames.length === 0) return;

    const now = this.now();
    if (this.filling) {
      this.filling = false;
      const stallMs = now - this.fillStartedAt;
      this.lastStallMs = stallMs;
      if (stallMs >= STALL_MS) this.stalls++;
    }
    for (const f of frames) this._remember(f);
    this.emit(Buffer.concat(frames.map((f) => f.data)), false);
    this.lastRealAt = now;
    this.streamAt = now;
  }

  /**
   * Called every ~100 ms. Emits silent frames to cover any gap longer than
   * gapMs since the last frame, keeping the byte stream continuous.
   */
  tick() {
    if (!this.silentFrame || this.streamAt === null) return;
    const now = this.now();
    if (!this.filling) {
      if (now - this.streamAt < this.gapMs) return;
      this.filling = true;
      this.fillStartedAt = this.streamAt;
    }
    const due = Math.floor((now - this.streamAt) / this.silentFrameMs);
    if (due <= 0) return;
    const count = Math.min(due, 200); // never emit more than ~5 s in one go
    const frames = [];
    for (let i = 0; i < count; i++) {
      frames.push(this.silentFrame);
      this._remember({ data: this.silentFrame, ms: this.silentFrameMs });
    }
    this.emit(Buffer.concat(frames), true);
    this.streamAt += count * this.silentFrameMs;
    this.totalFillMs += count * this.silentFrameMs;
  }

  /** Bytes a new listener should get before live data */
  burst() {
    return this.ring.length ? Buffer.concat(this.ring.map((f) => f.data)) : Buffer.alloc(0);
  }

  /** Snapshot for the broadcaster's health line */
  health() {
    const now = this.now();
    return {
      streaming: this.streamAt !== null,
      filling: this.filling,
      gapMs: this.filling ? now - this.fillStartedAt : 0,
      ingestAgeMs: this.lastIngestAt === null ? null : now - this.lastIngestAt,
      stalls: this.stalls,
      lastStallMs: this.lastStallMs,
      totalFillMs: Math.round(this.totalFillMs),
      burstMs: Math.round(this.ringMs),
    };
  }

  _remember(frame) {
    this.ring.push(frame);
    this.ringMs += frame.ms;
    while (this.ringMs > this.burstMs && this.ring.length > 1) {
      this.ringMs -= this.ring.shift().ms;
    }
  }
}
