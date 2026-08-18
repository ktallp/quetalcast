export interface WebRTCStats {
  /** Payload bitrate over the last poll interval, kbps */
  bitrate: number;
  /** Cumulative packets lost since the connection started */
  packetsLost: number;
  /** Packet loss over the recent window (see LOSS_WINDOW_MS), percent 0-100 */
  lossRate: number;
  /** Inter-arrival jitter, ms */
  jitter: number;
  /** Round-trip time, ms (0 when unknown) */
  rtt: number;
  /** Receiver only: average jitter buffer delay over the last interval, ms */
  jitterBufferMs: number;
  /**
   * Receiver only: estimated end-to-end delay from the broadcaster's mic to
   * this device's speaker, ms (0 when unknown). One-way network (RTT/2) +
   * jitter buffer + playout + a fixed allowance for capture and encoding.
   * RTT alone is not what a listener experiences as delay.
   */
  latency: number;
  audioLevel: number;
  timestamp: number;
}

/**
 * How far back the loss rate looks. RTCP receiver reports for audio only
 * arrive every few seconds, so a per-poll delta would read 0 most of the
 * time and then spike; a rolling window gives a steady, comparable figure
 * on both ends of the call.
 */
export const LOSS_WINDOW_MS = 10_000;

interface Sample {
  timestamp: number;
  lost: number;
  /** packets sent (broadcaster) or received + lost (receiver) */
  total: number;
}

interface PcHistory {
  bytes?: number;
  timestamp?: number;
  samples: Sample[];
  jbDelay?: number;
  jbCount?: number;
  playoutDelay?: number;
  playoutCount?: number;
}

/** Capture + Opus framing + encode on the sending side, not visible in any stat */
const CAPTURE_ENCODE_MS = 30;

/** Stats history keyed by peer connection so several PCs can be polled independently */
let histories = new WeakMap<RTCPeerConnection, PcHistory>();

function historyFor(pc: RTCPeerConnection): PcHistory {
  let h = histories.get(pc);
  if (!h) {
    h = { samples: [] };
    histories.set(pc, h);
  }
  return h;
}

/** Percent of packets lost between the oldest sample inside the window and now */
export function windowedLossRate(samples: Sample[], now: number, windowMs = LOSS_WINDOW_MS): number {
  while (samples.length > 1 && now - samples[0].timestamp > windowMs) samples.shift();
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dLost = Math.max(0, last.lost - first.lost);
  const dTotal = Math.max(0, last.total - first.total);
  if (dTotal <= 0) return 0;
  return Math.min(100, (dLost / dTotal) * 100);
}

export async function parseStats(
  pc: RTCPeerConnection,
  role: 'broadcaster' | 'receiver'
): Promise<WebRTCStats> {
  const stats = await pc.getStats();
  const result: WebRTCStats = {
    bitrate: 0,
    packetsLost: 0,
    lossRate: 0,
    jitter: 0,
    rtt: 0,
    jitterBufferMs: 0,
    latency: 0,
    audioLevel: 0,
    timestamp: Date.now(),
  };

  const history = historyFor(pc);
  let bytes: number | undefined;
  let bytesTimestamp: number | undefined;
  let lost = 0;
  let received = 0;
  let sent = 0;
  let sampleTimestamp = 0;
  let hasRemoteReport = false;
  let candidatePairRtt = 0;
  let jbDelay: number | undefined;
  let jbCount: number | undefined;
  let playoutDelay: number | undefined;
  let playoutCount: number | undefined;

  stats.forEach((report) => {
    if (role === 'receiver' && report.type === 'inbound-rtp' && report.kind === 'audio') {
      lost = report.packetsLost ?? 0;
      received = report.packetsReceived ?? 0;
      result.jitter = (report.jitter ?? 0) * 1000; // convert to ms
      bytes = report.bytesReceived ?? 0;
      bytesTimestamp = report.timestamp;
      sampleTimestamp = report.timestamp;
      jbDelay = report.jitterBufferDelay;
      jbCount = report.jitterBufferEmittedCount;
    }

    // Chrome reports the audio device playout delay separately
    if (role === 'receiver' && report.type === 'media-playout' && report.kind === 'audio') {
      playoutDelay = report.totalPlayoutDelay;
      playoutCount = report.totalSamplesCount;
    }

    if (role === 'broadcaster' && report.type === 'outbound-rtp' && report.kind === 'audio') {
      sent = report.packetsSent ?? 0;
      bytes = report.bytesSent ?? 0;
      bytesTimestamp = report.timestamp;
      sampleTimestamp = report.timestamp;
    }

    if (role === 'broadcaster' && report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
      hasRemoteReport = true;
      result.rtt = (report.roundTripTime ?? 0) * 1000;
      result.jitter = (report.jitter ?? 0) * 1000;
      lost = report.packetsLost ?? 0;
    }

    if (report.type === 'media-source' && report.kind === 'audio') {
      result.audioLevel = report.audioLevel ?? 0;
    }

    // ICE round trip: the only RTT a receive-only peer has (it sends no RTP,
    // so it never gets a remote-inbound-rtp report)
    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime !== undefined) {
      if (report.nominated || report.selected || candidatePairRtt === 0) {
        candidatePairRtt = report.currentRoundTripTime * 1000;
      }
    }
  });

  if (result.rtt === 0 && candidatePairRtt > 0) result.rtt = candidatePairRtt;

  // Receiver: jitter buffer and playout delays are cumulative sums; average
  // them over the interval since the last poll
  if (role === 'receiver') {
    if (jbDelay !== undefined && jbCount !== undefined) {
      if (history.jbDelay !== undefined && history.jbCount !== undefined && jbCount > history.jbCount) {
        result.jitterBufferMs = ((jbDelay - history.jbDelay) / (jbCount - history.jbCount)) * 1000;
      }
      history.jbDelay = jbDelay;
      history.jbCount = jbCount;
    }
    let playoutMs = 0;
    if (playoutDelay !== undefined && playoutCount !== undefined) {
      if (history.playoutDelay !== undefined && history.playoutCount !== undefined && playoutCount > history.playoutCount) {
        playoutMs = ((playoutDelay - history.playoutDelay) / (playoutCount - history.playoutCount)) * 1000;
      }
      history.playoutDelay = playoutDelay;
      history.playoutCount = playoutCount;
    }
    if (result.jitterBufferMs > 0) {
      result.latency = result.rtt / 2 + result.jitterBufferMs + playoutMs + CAPTURE_ENCODE_MS;
    }
  }

  // Bitrate over the last poll interval
  if (bytes !== undefined && bytesTimestamp !== undefined) {
    if (history.bytes !== undefined && history.timestamp !== undefined) {
      const dt = (bytesTimestamp - history.timestamp) / 1000;
      if (dt > 0) result.bitrate = ((bytes - history.bytes) * 8) / dt / 1000; // kbps
    }
    history.bytes = bytes;
    history.timestamp = bytesTimestamp;
  }

  // Loss over the rolling window. Broadcaster loss comes from the receiver's
  // RTCP reports, so only sample once at least one has arrived.
  result.packetsLost = Math.max(0, lost);
  const total = role === 'receiver' ? received + Math.max(0, lost) : sent;
  if (sampleTimestamp > 0 && (role === 'receiver' || hasRemoteReport)) {
    history.samples.push({ timestamp: sampleTimestamp, lost: Math.max(0, lost), total });
    result.lossRate = windowedLossRate(history.samples, sampleTimestamp);
  }

  return result;
}

export function resetStats(): void {
  histories = new WeakMap();
}
