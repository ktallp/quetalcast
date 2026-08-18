import { useCallback, useEffect, useRef, useState } from 'react';
import { type UseSignalingReturn, type SignalingMessage } from './useSignaling';
import { parseStats, resetStats, type WebRTCStats } from '@/lib/webrtc-stats';
import { dbg, dbgWarn } from '@/lib/debug';

export type ConnectionStatus = 'idle' | 'connecting' | 'on-air' | 'receiving' | 'disconnected' | 'error';
export type AudioQuality = 'high' | 'low' | 'auto';
export type EffectiveQuality = 'high' | 'medium' | 'reduced' | 'low';

export interface UseWebRTCReturn {
  status: ConnectionStatus;
  connectionState: string;
  iceConnectionState: string;
  signalingState: string;
  stats: WebRTCStats | null;
  remoteStream: MediaStream | null;
  peerConnected: boolean;
  startBroadcast: (stream: MediaStream) => void;
  joinAsReceiver: (roomId: string) => void;
  /** Rejoin an existing room as broadcaster (for "continue previous broadcast") */
  joinRoomAsBroadcaster: (roomId: string) => void;
  stop: () => void;
  createRoom: (customId?: string, streamTitle?: string, streamDescription?: string) => void;
  roomId: string | null;
  setAudioQuality: (quality: AudioQuality) => void;
  /** Lowest quality tier currently in use across listeners (meaningful when mode is 'auto') */
  effectiveQuality: EffectiveQuality;
  /** Number of listeners auto mode has moved off the starting tier */
  adaptedListeners: number;
  /** Current reconnect attempt (0 = not reconnecting) */
  reconnectAttempt: number;
  /** Max reconnect attempts before giving up */
  maxReconnectAttempts: number;
  /** Manual retry after reconnection gave up */
  retryConnection: () => void;
}

// Default fallback — STUN only (no TURN relay)
const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/** Fetch ICE server configuration (STUN + TURN) from the server */
async function fetchIceConfig(): Promise<RTCConfiguration> {
  try {
    const res = await fetch('/api/ice-config');
    if (res.ok) {
      const data = await res.json();
      if (data.iceServers && data.iceServers.length > 0) {
        const hasTurn = data.iceServers.some((s: { urls: string | string[] }) => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return urls.some((u: string) => u.startsWith('turn:') || u.startsWith('turns:'));
        });
        dbg(`[ICE] Fetched config: ${data.iceServers.length} server(s), TURN: ${hasTurn ? 'YES' : 'NO'}`);
        return { iceServers: data.iceServers };
      }
    }
    dbgWarn('[ICE] Server returned empty or bad response, using STUN-only fallback');
  } catch (e) {
    dbgWarn('[ICE] Could not fetch config, using STUN-only fallback', e);
  }
  return DEFAULT_RTC_CONFIG;
}

// ---------------------------------------------------------------------------
// Opus SDP parameters for pristine vs bandwidth-saving audio
// ---------------------------------------------------------------------------

/** Pristine: 510 kbps stereo Opus, CBR, no DTX. In-band FEC is requested too;
 *  it costs nothing at CELT rates and protects the lower auto tiers. */
const HQ_OPUS_PARAMS: Record<string, number> = {
  maxaveragebitrate: 510000,
  stereo: 1,
  'sprop-stereo': 1,
  maxplaybackrate: 48000,
  usedtx: 0,
  useinbandfec: 1,
  cbr: 1,
};

/** Low bandwidth: 32 kbps mono Opus, VBR, DTX + FEC for resilience */
const LQ_OPUS_PARAMS: Record<string, number> = {
  maxaveragebitrate: 32000,
  stereo: 0,
  'sprop-stereo': 0,
  maxplaybackrate: 24000,
  usedtx: 1,
  useinbandfec: 1,
  cbr: 0,
};

/** Opus fmtp keys a receiver copies from the offer into its answer */
const ECHOED_OPUS_PARAMS = ['maxaveragebitrate', 'stereo', 'sprop-stereo', 'maxplaybackrate', 'usedtx', 'useinbandfec', 'cbr'] as const;

/** Payload type of the Opus codec in an SDP, if present */
function findOpusPayloadType(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+) opus\/48000/);
    if (match) return match[1];
  }
  return null;
}

/** Read the Opus fmtp parameters out of an SDP string */
export function extractOpusFmtp(sdp: string): Record<string, string> {
  const lines = sdp.split('\r\n');
  const opusPT = findOpusPayloadType(lines);
  const params: Record<string, string> = {};
  if (!opusPT) return params;
  const fmtpPrefix = `a=fmtp:${opusPT}`;
  const line = lines.find((l) => l.startsWith(fmtpPrefix));
  if (!line) return params;
  line.slice(fmtpPrefix.length + 1).split(';').forEach((p) => {
    const [k, ...v] = p.trim().split('=');
    if (k) params[k] = v.join('=');
  });
  return params;
}

/** Rewrite the Opus fmtp line in an SDP string to inject codec params */
export function mungeOpusSdpParams(sdp: string, params: Record<string, string | number>): string {
  const lines = sdp.split('\r\n');
  const opusPT = findOpusPayloadType(lines);
  if (!opusPT) return sdp;

  const fmtpPrefix = `a=fmtp:${opusPT}`;
  let found = false;

  const result = lines.map((line) => {
    if (line.startsWith(fmtpPrefix)) {
      found = true;
      const existing = line.slice(fmtpPrefix.length + 1);
      const map = new Map<string, string>();
      existing.split(';').forEach((p) => {
        const [k, ...v] = p.trim().split('=');
        if (k) map.set(k, v.join('='));
      });
      for (const [k, v] of Object.entries(params)) {
        map.set(k, String(v));
      }
      return `${fmtpPrefix} ${Array.from(map).map(([k, v]) => `${k}=${v}`).join(';')}`;
    }
    return line;
  });

  if (!found) {
    const rtpmapIdx = result.findIndex((l) => l.startsWith(`a=rtpmap:${opusPT} opus/`));
    if (rtpmapIdx !== -1) {
      const paramStr = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(';');
      result.splice(rtpmapIdx + 1, 0, `${fmtpPrefix} ${paramStr}`);
    }
  }

  return result.join('\r\n');
}

/** Rewrite the Opus fmtp line for a quality mode */
function mungeOpusSdp(sdp: string, quality: 'high' | 'low'): string {
  return mungeOpusSdpParams(sdp, quality === 'high' ? HQ_OPUS_PARAMS : LQ_OPUS_PARAMS);
}

// ---------------------------------------------------------------------------
// Quality tiers
// ---------------------------------------------------------------------------
// Stereo/mono, DTX and playback rate are fixed when the offer is negotiated;
// what can move at runtime without renegotiating is the target bitrate and,
// where the browser supports RTCRtpEncodingParameters.codec, the send codec.
// Auto mode steps each listener down this ladder on loss/jitter/RTT and back
// up when the link has been clean for a while. Tiers below "high" also switch
// that listener to audio RED (one redundant copy of the previous packet in
// every packet), which is what actually recovers the bursty loss seen on
// cellular and tethered links; lowering the bitrate alone does not.

interface QualityTier {
  name: EffectiveQuality;
  bitrate: number;
  /** Send audio/red for this tier when auto mode chose it */
  red: boolean;
  label: string;
}

const QUALITY_TIERS: readonly QualityTier[] = [
  { name: 'high', bitrate: 510000, red: false, label: '510 kbps' },
  { name: 'medium', bitrate: 128000, red: true, label: '128 kbps + redundancy' },
  { name: 'reduced', bitrate: 64000, red: true, label: '64 kbps + redundancy' },
  { name: 'low', bitrate: 32000, red: true, label: '32 kbps + redundancy' },
];
const TIER_HIGH = 0;
const TIER_LOW = QUALITY_TIERS.length - 1;

/** Apply a tier (bitrate, and RED on/off) to the audio senders of a peer connection */
async function applyTierToSenders(pc: RTCPeerConnection, tier: QualityTier, useRed: boolean) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio') continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = tier.bitrate;

      // Pick the send codec: RED when asked for and negotiated, otherwise Opus.
      // Older browsers ignore or reject `codec`; if so, retry with bitrate only.
      const codecs = params.codecs ?? [];
      const wanted = useRed
        ? codecs.find((c) => c.mimeType.toLowerCase() === 'audio/red')
        : codecs.find((c) => c.mimeType.toLowerCase() === 'audio/opus');
      const encoding = params.encodings[0] as RTCRtpEncodingParameters & { codec?: RTCRtpCodec };
      if (wanted) {
        encoding.codec = { mimeType: wanted.mimeType, clockRate: wanted.clockRate, channels: wanted.channels, sdpFmtpLine: wanted.sdpFmtpLine };
      } else if (useRed) {
        dbg('[RTC:B] audio/red not negotiated with this listener; bitrate only');
      }
      try {
        await sender.setParameters(params);
      } catch (e) {
        if (encoding.codec) {
          dbgWarn('[RTC:B] setParameters with codec rejected, retrying without', e);
          delete encoding.codec;
          await sender.setParameters(params);
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.warn('Could not set sender parameters:', e);
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-adaptive quality thresholds (per listener)
// ---------------------------------------------------------------------------
// Loss is the rate over the stats window (see LOSS_WINDOW_MS), not the
// cumulative counter, so a link that had one bad patch can recover.
const AUTO_DOWN_LOSS = 3;          // % lost over the window: step down
const AUTO_DOWN_LOSS_WITH_RED = 8; // % once RED is on (it hides isolated loss, so allow more)
const AUTO_DOWN_JITTER = 50;       // ms
const AUTO_DOWN_RTT = 300;         // ms

const AUTO_UP_LOSS = 0.5;          // % must be below this to step up
const AUTO_UP_JITTER = 20;         // ms
const AUTO_UP_RTT = 150;           // ms

const AUTO_STEP_COOLDOWN_MS = 10_000; // wait for the loss window to reflect the last change
const AUTO_UP_STABLE_SECONDS = 15;    // consecutive clean readings before stepping up
const AUTO_UP_MAX_STABLE_SECONDS = 120;
const AUTO_FLAP_WINDOW_MS = 60_000;   // an up followed by a down within this doubles the next hold

/** Tier a listener starts at for the chosen mode */
function tierForMode(mode: AudioQuality): number {
  return mode === 'low' ? TIER_LOW : TIER_HIGH;
}

export interface ListenerAdapt {
  tier: number;
  goodSeconds: number;
  /** Clean seconds currently required before stepping up (grows on flapping) */
  requiredGood: number;
  lastChangeAt: number;
  lastUpAt: number;
}

function newListenerAdapt(tier: number): ListenerAdapt {
  return { tier, goodSeconds: 0, requiredGood: AUTO_UP_STABLE_SECONDS, lastChangeAt: 0, lastUpAt: 0 };
}

/**
 * Decide the next tier for one listener from its latest stats.
 * Pure so it can be unit tested; returns the (possibly unchanged) state.
 */
export function stepListenerTier(state: ListenerAdapt, s: { lossRate: number; jitter: number; rtt: number }, now: number): ListenerAdapt {
  const next = { ...state };
  const inCooldown = now - state.lastChangeAt < AUTO_STEP_COOLDOWN_MS;
  const redOn = QUALITY_TIERS[state.tier].red;
  const lossLimit = redOn ? AUTO_DOWN_LOSS_WITH_RED : AUTO_DOWN_LOSS;

  const bad = s.lossRate > lossLimit || s.jitter > AUTO_DOWN_JITTER || s.rtt > AUTO_DOWN_RTT;
  const good = s.lossRate < AUTO_UP_LOSS && s.jitter < AUTO_UP_JITTER && s.rtt < AUTO_UP_RTT;

  if (bad) {
    next.goodSeconds = 0;
    if (!inCooldown && state.tier < TIER_LOW) {
      next.tier = state.tier + 1;
      next.lastChangeAt = now;
      // Stepped up recently and it did not hold: demand a longer clean run next time
      if (now - state.lastUpAt < AUTO_FLAP_WINDOW_MS) {
        next.requiredGood = Math.min(AUTO_UP_MAX_STABLE_SECONDS, state.requiredGood * 2);
      }
    }
    return next;
  }

  if (good && state.tier > TIER_HIGH) {
    next.goodSeconds = state.goodSeconds + 1;
    if (!inCooldown && next.goodSeconds >= state.requiredGood) {
      next.tier = state.tier - 1;
      next.goodSeconds = 0;
      next.lastChangeAt = now;
      next.lastUpAt = now;
    }
    return next;
  }

  if (!good) next.goodSeconds = 0;
  return next;
}

// ---------------------------------------------------------------------------
// Receiver jitter buffer
// ---------------------------------------------------------------------------
const RECEIVER_JITTER_BUFFER_MS = 150;       // baseline target, a touch above the browser default
const RECEIVER_JITTER_BUFFER_LOSSY_MS = 400; // while the link is dropping or jittery
const RECEIVER_BUFFER_ESCALATE_LOSS = 2;     // % over the stats window
const RECEIVER_BUFFER_ESCALATE_JITTER = 30;  // ms
const RECEIVER_BUFFER_RELAX_SECONDS = 30;    // clean seconds before going back to baseline

// ---------------------------------------------------------------------------
// Receiver auto-reconnect
// ---------------------------------------------------------------------------
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000; // ms
const RECONNECT_MAX_DELAY = 15000; // ms

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebRTC(
  signaling: UseSignalingReturn,
  role: 'broadcaster' | 'receiver'
): UseWebRTCReturn {
  // --- Shared state ---
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [connectionState, setConnectionState] = useState('new');
  const [iceConnectionState, setIceConnectionState] = useState('new');
  const [signalingStateVal, setSignalingState] = useState('stable');
  const [stats, setStats] = useState<WebRTCStats | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerConnected, setPeerConnected] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);

  // ICE config (fetched from server, includes TURN credentials when configured)
  const rtcConfigRef = useRef<RTCConfiguration>(DEFAULT_RTC_CONFIG);
  const iceConfigFetchedRef = useRef(false);
  const iceConfigPromiseRef = useRef<Promise<RTCConfiguration> | null>(null);

  /** Ensure ICE config is fetched exactly once; returns the cached promise */
  const ensureIceConfig = useCallback(async (): Promise<RTCConfiguration> => {
    if (iceConfigFetchedRef.current) return rtcConfigRef.current;
    if (!iceConfigPromiseRef.current) {
      iceConfigPromiseRef.current = fetchIceConfig().then((cfg) => {
        rtcConfigRef.current = cfg;
        iceConfigFetchedRef.current = true;
        return cfg;
      });
    }
    return iceConfigPromiseRef.current;
  }, []);

  // Kick off fetch eagerly (but PCs will also await it before creation)
  useEffect(() => { ensureIceConfig(); }, [ensureIceConfig]);

  // Audio quality
  const audioQualityModeRef = useRef<AudioQuality>('auto');     // user's chosen mode
  const [effectiveQuality, setEffectiveQuality] = useState<EffectiveQuality>('high');
  const [adaptedListeners, setAdaptedListeners] = useState(0);
  /** Per-listener adaptation state, keyed by receiverId (broadcaster only) */
  const listenersRef = useRef<Map<string, ListenerAdapt>>(new Map());

  // Receiver jitter buffer (see applyJitterBufferTarget)
  const rtpReceiverRef = useRef<RTCRtpReceiver | null>(null);
  const jitterTargetRef = useRef(0);
  const jitterCleanSecondsRef = useRef(0);

  // Receiver reconnect state
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const receiverRoomIdRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);

  // Receiver: single PC
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // Broadcaster: multiple PCs keyed by receiverId
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const broadcastStreamRef = useRef<MediaStream | null>(null);

  const statsIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const reportIntervalRef = useRef<ReturnType<typeof setInterval>>();

  /** Recompute the summary shown in the UI: worst tier in use, and how many listeners are adapted */
  const refreshEffectiveQuality = useCallback(() => {
    const base = tierForMode(audioQualityModeRef.current);
    let worst = base;
    let adapted = 0;
    for (const l of listenersRef.current.values()) {
      if (l.tier > worst) worst = l.tier;
      if (l.tier !== base) adapted++;
    }
    setEffectiveQuality(QUALITY_TIERS[worst].name);
    setAdaptedListeners(adapted);
  }, []);

  /** Push a listener's tier to its peer connection */
  const applyListenerTier = useCallback((receiverId: string, tierIdx: number) => {
    const pc = pcsRef.current.get(receiverId);
    if (!pc) return;
    const tier = QUALITY_TIERS[tierIdx];
    // RED is an auto-mode tool; manual Low means "spend less", so no redundancy there
    const useRed = audioQualityModeRef.current === 'auto' && tier.red;
    applyTierToSenders(pc, tier, useRed);
  }, []);

  /** Auto-adaptive: evaluate one listener's stats and step its tier if needed */
  const evaluateAutoQuality = useCallback((receiverId: string, s: WebRTCStats) => {
    if (audioQualityModeRef.current !== 'auto') return;
    const state = listenersRef.current.get(receiverId);
    if (!state) return;
    const next = stepListenerTier(state, s, Date.now());
    listenersRef.current.set(receiverId, next);
    if (next.tier !== state.tier) {
      const dir = next.tier > state.tier ? 'down' : 'up';
      dbg(`[RTC:B] Listener ${receiverId} stepping ${dir} to ${QUALITY_TIERS[next.tier].label} (loss ${s.lossRate.toFixed(1)}%, jitter ${s.jitter.toFixed(0)}ms, rtt ${s.rtt.toFixed(0)}ms)`);
      applyListenerTier(receiverId, next.tier);
      refreshEffectiveQuality();
    }
  }, [applyListenerTier, refreshEffectiveQuality]);

  /**
   * Receiver: ask the browser for a deeper jitter buffer than its low-latency
   * default. Live radio can afford a bit more delay, and on lossy links the
   * extra headroom turns gaps into smooth playback. Escalates while the link
   * is bad and relaxes again after it has been clean for a while.
   */
  const applyJitterBufferTarget = useCallback((ms: number) => {
    // jitterBufferTarget is the standard knob (Chrome 114+, Firefox, Safari);
    // playoutDelayHint is the older Chrome-only spelling, in seconds.
    const receiver = rtpReceiverRef.current as unknown as { jitterBufferTarget?: number | null; playoutDelayHint?: number | null } | null;
    if (!receiver || jitterTargetRef.current === ms) return;
    jitterTargetRef.current = ms;
    try {
      if ('jitterBufferTarget' in receiver) {
        receiver.jitterBufferTarget = ms;
      } else if ('playoutDelayHint' in receiver) {
        receiver.playoutDelayHint = ms / 1000;
      } else {
        return;
      }
      dbg(`[RTC:R] Jitter buffer target set to ${ms}ms`);
    } catch (e) {
      dbgWarn('[RTC:R] Could not set jitter buffer target', e);
    }
  }, []);

  const evaluateReceiverBuffer = useCallback((s: WebRTCStats) => {
    const bad = s.lossRate > RECEIVER_BUFFER_ESCALATE_LOSS || s.jitter > RECEIVER_BUFFER_ESCALATE_JITTER;
    if (bad) {
      jitterCleanSecondsRef.current = 0;
      applyJitterBufferTarget(RECEIVER_JITTER_BUFFER_LOSSY_MS);
      return;
    }
    if (jitterTargetRef.current === RECEIVER_JITTER_BUFFER_LOSSY_MS) {
      jitterCleanSecondsRef.current++;
      if (jitterCleanSecondsRef.current >= RECEIVER_BUFFER_RELAX_SECONDS) {
        jitterCleanSecondsRef.current = 0;
        applyJitterBufferTarget(RECEIVER_JITTER_BUFFER_MS);
      }
    }
  }, [applyJitterBufferTarget]);

  const cleanup = useCallback(() => {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    if (reportIntervalRef.current) clearInterval(reportIntervalRef.current);

    // Receiver PC
    pcRef.current?.close();
    pcRef.current = null;

    // Broadcaster PCs
    for (const pc of pcsRef.current.values()) {
      pc.close();
    }
    pcsRef.current.clear();
    broadcastStreamRef.current = null;

    resetStats();
    setStats(null);
    setRemoteStream(null);
    setPeerConnected(false);
    setConnectionState('new');
    setIceConnectionState('new');
    setSignalingState('stable');
    listenersRef.current.clear();
    rtpReceiverRef.current = null;
    jitterTargetRef.current = 0;
    jitterCleanSecondsRef.current = 0;
    setAdaptedListeners(0);
  }, []);

  // --- Broadcaster: create a PC for a specific receiver ---
  const createPCForReceiver = useCallback(
    async (receiverId: string, stream: MediaStream) => {
      const config = await ensureIceConfig();
      dbg(`[RTC:B] Creating PC for receiver ${receiverId}`, {
        iceServers: config.iceServers?.length,
        tracks: stream.getTracks().map(t => `${t.kind}:${t.readyState}`),
      });

      const pc = new RTCPeerConnection(config);
      pcsRef.current.set(receiverId, pc);

      // Add all tracks from the broadcast stream
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Negotiate Opus first (the default send codec) with audio RED behind it,
      // so lossy listeners can be switched to redundancy later without a
      // renegotiation. Browsers without setCodecPreferences or without RED
      // simply keep their default codec list.
      try {
        const caps = RTCRtpReceiver.getCapabilities?.('audio');
        if (caps) {
          const opus = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'audio/opus');
          const red = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'audio/red');
          const rest = caps.codecs.filter((c) => !opus.includes(c) && !red.includes(c));
          if (opus.length > 0) {
            for (const tr of pc.getTransceivers()) {
              if (tr.sender.track?.kind === 'audio' && typeof tr.setCodecPreferences === 'function') {
                tr.setCodecPreferences([...opus, ...red, ...rest]);
              }
            }
          }
        }
      } catch (e) {
        dbgWarn('[RTC:B] Could not set codec preferences', e);
      }

      const startTier = tierForMode(audioQualityModeRef.current);
      listenersRef.current.set(receiverId, newListenerAdapt(startTier));
      refreshEffectiveQuality();

      pc.onconnectionstatechange = () => {
        dbg(`[RTC:B] connectionState → ${pc.connectionState} (receiver: ${receiverId})`);
        setConnectionState(pc.connectionState);
        const anyConnected = Array.from(pcsRef.current.values()).some(
          (p) => p.connectionState === 'connected',
        );
        setPeerConnected(anyConnected);
        if (anyConnected) setStatus('on-air');
      };

      pc.oniceconnectionstatechange = () => {
        dbg(`[RTC:B] iceConnectionState → ${pc.iceConnectionState} (receiver: ${receiverId})`);
        setIceConnectionState(pc.iceConnectionState);
      };

      pc.onsignalingstatechange = () => {
        dbg(`[RTC:B] signalingState → ${pc.signalingState} (receiver: ${receiverId})`);
        setSignalingState(pc.signalingState);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          dbg(`[RTC:B] ICE candidate: ${event.candidate.type || 'unknown'} ${event.candidate.protocol || ''} ${event.candidate.address || ''}:${event.candidate.port || ''}`);
          signaling.send({
            type: 'candidate',
            candidate: event.candidate.toJSON(),
            receiverId,
          });
        } else {
          dbg('[RTC:B] ICE gathering complete');
        }
      };

      // Create offer with Opus quality params baked in. The receiver echoes
      // these back in its answer, which is what actually configures our encoder.
      try {
        const offer = await pc.createOffer();
        const mungedSdp = mungeOpusSdp(offer.sdp!, audioQualityModeRef.current === 'low' ? 'low' : 'high');
        // Build the init explicitly: spreading an RTCSessionDescription instance
        // drops its prototype getters (type becomes undefined) in some browsers
        const mungedOffer: RTCSessionDescriptionInit = { type: offer.type ?? 'offer', sdp: mungedSdp };
        await pc.setLocalDescription(mungedOffer);
        dbg(`[RTC:B] Offer created & sent to receiver ${receiverId}`);
        signaling.send({ type: 'offer', sdp: mungedOffer, receiverId });

        applyTierToSenders(pc, QUALITY_TIERS[startTier], false);
      } catch (e) {
        console.error('Failed to create offer for receiver:', receiverId, e);
      }

      return pc;
    },
    [signaling, ensureIceConfig, refreshEffectiveQuality],
  );

  /** Receiver: attempt auto-reconnect with exponential backoff */
  const attemptReconnect = useCallback(() => {
    if (role !== 'receiver' || reconnectingRef.current) return;

    const roomIdToReconnect = receiverRoomIdRef.current;
    if (!roomIdToReconnect) {
      setStatus('disconnected');
      return;
    }

    reconnectingRef.current = true;

    setReconnectAttempt((prev) => {
      const next = prev + 1;
      if (next > MAX_RECONNECT_ATTEMPTS) {
        dbg(`[RTC:R] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
        setStatus('disconnected');
        reconnectingRef.current = false;
        return prev;
      }

      const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, next - 1), RECONNECT_MAX_DELAY);
      dbg(`[RTC:R] Reconnecting in ${delay}ms (attempt ${next}/${MAX_RECONNECT_ATTEMPTS})`);
      setStatus('connecting');

      reconnectTimerRef.current = setTimeout(async () => {
        // Clean up existing PC
        if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
        }
        if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
        if (reportIntervalRef.current) clearInterval(reportIntervalRef.current);
        resetStats();
        setRemoteStream(null);
        setPeerConnected(false);

        try {
          // Recreate PC and rejoin
          await createReceiverPC();
          signaling.send({ type: 'join-room', roomId: roomIdToReconnect, role: 'receiver' });
          reconnectingRef.current = false;
        } catch (e) {
          dbgWarn('[RTC:R] Reconnect failed:', e);
          reconnectingRef.current = false;
          attemptReconnect();
        }
      }, delay);

      return next;
    });
  }, [role, signaling]);

  // --- Receiver: create a single PC ---
  const createReceiverPC = useCallback(async () => {
    const config = await ensureIceConfig();
    dbg('[RTC:R] Creating receiver PC', {
      iceServers: config.iceServers?.length,
      iceConfigFetched: iceConfigFetchedRef.current,
    });

    const pc = new RTCPeerConnection(config);
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      dbg(`[RTC:R] connectionState → ${pc.connectionState}`);
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'connected') {
        setPeerConnected(true);
        setStatus('receiving');
        // Reset reconnect state on successful connection
        setReconnectAttempt(0);
        reconnectingRef.current = false;
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        // Attempt auto-reconnect
        attemptReconnect();
      }
    };

    pc.oniceconnectionstatechange = () => {
      dbg(`[RTC:R] iceConnectionState → ${pc.iceConnectionState}`);
      setIceConnectionState(pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      dbg(`[RTC:R] signalingState → ${pc.signalingState}`);
      setSignalingState(pc.signalingState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        dbg(`[RTC:R] ICE candidate: ${event.candidate.type || 'unknown'} ${event.candidate.protocol || ''} ${event.candidate.address || ''}:${event.candidate.port || ''}`);
        signaling.send({ type: 'candidate', candidate: event.candidate.toJSON() });
      } else {
        dbg('[RTC:R] ICE gathering complete');
      }
    };

    pc.ontrack = (event) => {
      dbg(`[RTC:R] Remote track received: ${event.track.kind} (${event.track.readyState})`);
      setRemoteStream(event.streams[0] || new MediaStream([event.track]));
      if (event.track.kind === 'audio') {
        rtpReceiverRef.current = event.receiver;
        jitterTargetRef.current = 0;
        applyJitterBufferTarget(RECEIVER_JITTER_BUFFER_MS);
      }
    };

    // Stats polling for receiver; also drives the jitter buffer target
    statsIntervalRef.current = setInterval(async () => {
      if (pc.connectionState === 'connected') {
        const s = await parseStats(pc, 'receiver');
        setStats(s);
        evaluateReceiverBuffer(s);
      }
    }, 1000);

    reportIntervalRef.current = setInterval(async () => {
      if (pc.connectionState === 'connected') {
        const s = await parseStats(pc, 'receiver');
        signaling.send({ type: 'stats', data: s });
      }
    }, 5000);

    return pc;
  }, [signaling, applyJitterBufferTarget, evaluateReceiverBuffer]);

  // --- Handle signaling messages ---
  useEffect(() => {
    const unsub = signaling.subscribe(async (msg: SignalingMessage) => {
      dbg(`[SIG:${role[0].toUpperCase()}] ← ${msg.type}`, msg.type === 'candidate' ? '' : msg);

      switch (msg.type) {
        case 'room-created':
          setRoomId(msg.roomId as string);
          break;

        case 'joined':
          setRoomId(msg.roomId as string);
          break;

        case 'peer-joined': {
          dbg(`[SIG:${role[0].toUpperCase()}] peer-joined: receiverId=${msg.receiverId}, broadcastStream=${!!broadcastStreamRef.current}`);
          if (role === 'broadcaster' && msg.receiverId && broadcastStreamRef.current) {
            // Await ICE config + PC creation (async)
            await createPCForReceiver(msg.receiverId as string, broadcastStreamRef.current);
          }
          setPeerConnected(true);
          break;
        }

        case 'peer-left': {
          if (role === 'broadcaster' && msg.receiverId) {
            const rid = msg.receiverId as string;
            const pc = pcsRef.current.get(rid);
            if (pc) {
              pc.close();
              pcsRef.current.delete(rid);
            }
            listenersRef.current.delete(rid);
            refreshEffectiveQuality();
            setPeerConnected(pcsRef.current.size > 0);
          } else {
            setPeerConnected(false);
            setStatus(role === 'broadcaster' ? 'on-air' : 'idle');
          }
          break;
        }

        case 'offer':
          if (role === 'receiver') {
            const pc = pcRef.current;
            dbg(`[RTC:R] Received offer, PC exists: ${!!pc}, signalingState: ${pc?.signalingState}`);
            if (pc) {
              try {
                const offerInit = msg.sdp as RTCSessionDescriptionInit;
                await pc.setRemoteDescription(new RTCSessionDescription(offerInit));
                dbg('[RTC:R] Remote description set, creating answer...');
                const answer = await pc.createAnswer();
                // Opus fmtp in an SDP describes what its author wants to
                // *receive*, so the broadcaster's params only take effect on
                // its encoder when they appear in our answer. Echo them.
                const offered = extractOpusFmtp(offerInit.sdp ?? '');
                const echo: Record<string, string> = {};
                for (const k of ECHOED_OPUS_PARAMS) if (offered[k] !== undefined) echo[k] = offered[k];
                const answerInit: RTCSessionDescriptionInit = {
                  type: answer.type ?? 'answer',
                  sdp: Object.keys(echo).length > 0 && answer.sdp ? mungeOpusSdpParams(answer.sdp, echo) : answer.sdp,
                };
                await pc.setLocalDescription(answerInit);
                dbg('[RTC:R] Answer created & sent');
                signaling.send({ type: 'answer', sdp: answerInit });
              } catch (e) {
                console.error('Failed to handle offer:', e);
                setStatus('error');
              }
            }
          }
          break;

        case 'answer':
          if (role === 'broadcaster' && msg.receiverId) {
            const rid = msg.receiverId as string;
            const pc = pcsRef.current.get(rid);
            if (pc) {
              try {
                await pc.setRemoteDescription(
                  new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit),
                );
                dbg(`[RTC:B] Answer set for receiver ${rid}`);
              } catch (e) {
                console.error('Failed to handle answer:', e);
              }
            }
          }
          break;

        case 'candidate':
          if (role === 'broadcaster' && msg.receiverId) {
            const rid = msg.receiverId as string;
            const pc = pcsRef.current.get(rid);
            if (pc) {
              try {
                await pc.addIceCandidate(
                  new RTCIceCandidate(msg.candidate as RTCIceCandidateInit),
                );
              } catch (e) {
                console.error('Failed to add ICE candidate:', e);
              }
            }
          } else if (role === 'receiver') {
            const pc = pcRef.current;
            if (pc) {
              try {
                await pc.addIceCandidate(
                  new RTCIceCandidate(msg.candidate as RTCIceCandidateInit),
                );
              } catch (e) {
                console.error('Failed to add ICE candidate:', e);
              }
            }
          }
          break;

        case 'error':
          console.error('Signaling error:', msg.message, msg.code);
          setStatus('error');
          break;
      }
    });

    return unsub;
  }, [signaling, role, createPCForReceiver, refreshEffectiveQuality]);

  const createRoom = useCallback((customId?: string, streamTitle?: string, streamDescription?: string) => {
    const msg: { type: string; [key: string]: string } = { type: 'create-room' };
    if (customId) msg.customId = customId;
    if (streamTitle) msg.streamTitle = streamTitle;
    if (streamDescription) msg.streamDescription = streamDescription;
    signaling.send(msg);
  }, [signaling]);

  const joinRoomAsBroadcaster = useCallback(
    (roomIdToJoin: string) => {
      setRoomId(roomIdToJoin);
      signaling.send({ type: 'join-room', roomId: roomIdToJoin, role: 'broadcaster' });
    },
    [signaling],
  );

  const startBroadcast = useCallback(
    (stream: MediaStream) => {
      if (!roomId) {
        dbgWarn('[RTC:B] startBroadcast called but no roomId');
        return;
      }
      dbg(`[RTC:B] Starting broadcast in room ${roomId}, stream tracks:`, stream.getTracks().map(t => `${t.kind}:${t.readyState}`));
      setStatus('on-air');
      broadcastStreamRef.current = stream;

      // Stats polling for broadcaster: every listener is polled and adapted
      // on its own; the panel shows the listener having the hardest time.
      statsIntervalRef.current = setInterval(async () => {
        let worst: WebRTCStats | null = null;
        for (const [rid, pc] of pcsRef.current) {
          if (pc.connectionState !== 'connected') continue;
          const s = await parseStats(pc, 'broadcaster');
          evaluateAutoQuality(rid, s);
          if (!worst || s.lossRate > worst.lossRate) worst = s;
        }
        if (worst) setStats(worst);
      }, 1000);

      reportIntervalRef.current = setInterval(async () => {
        for (const pc of pcsRef.current.values()) {
          if (pc.connectionState === 'connected') {
            const s = await parseStats(pc, 'broadcaster');
            signaling.send({ type: 'stats', data: s });
            break;
          }
        }
      }, 5000);

      signaling.send({ type: 'ready', roomId });
    },
    [roomId, signaling, evaluateAutoQuality],
  );

  const joinAsReceiver = useCallback(
    async (joinRoomId: string) => {
      dbg(`[RTC:R] Joining room ${joinRoomId} as receiver`);
      receiverRoomIdRef.current = joinRoomId;
      setReconnectAttempt(0);
      reconnectingRef.current = false;
      setStatus('connecting');
      await createReceiverPC();
      signaling.send({ type: 'join-room', roomId: joinRoomId, role: 'receiver' });
    },
    [createReceiverPC, signaling],
  );

  const stop = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectingRef.current = false;
    setReconnectAttempt(0);
    signaling.send({ type: 'leave' });
    cleanup();
    setStatus('idle');
  }, [signaling, cleanup]);

  /** Manual retry after auto-reconnect gave up */
  const retryConnection = useCallback(() => {
    const roomIdToRetry = receiverRoomIdRef.current;
    if (!roomIdToRetry || role !== 'receiver') return;
    setReconnectAttempt(0);
    reconnectingRef.current = false;
    joinAsReceiver(roomIdToRetry);
  }, [role, joinAsReceiver]);

  /** Change the audio quality mode. For 'high'/'low' applies immediately;
   *  for 'auto' starts at high and adapts based on stream health. */
  const setAudioQuality = useCallback((quality: AudioQuality) => {
    audioQualityModeRef.current = quality;
    // Every listener restarts from the mode's tier; auto adapts from there
    const tier = tierForMode(quality);
    for (const rid of listenersRef.current.keys()) {
      listenersRef.current.set(rid, newListenerAdapt(tier));
      applyListenerTier(rid, tier);
    }
    refreshEffectiveQuality();
  }, [applyListenerTier, refreshEffectiveQuality]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    connectionState,
    iceConnectionState,
    signalingState: signalingStateVal,
    stats,
    remoteStream,
    peerConnected,
    startBroadcast,
    joinAsReceiver,
    joinRoomAsBroadcaster,
    stop,
    createRoom,
    roomId,
    setAudioQuality,
    effectiveQuality,
    adaptedListeners,
    reconnectAttempt,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    retryConnection,
  };
}
