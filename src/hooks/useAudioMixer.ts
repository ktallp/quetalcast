import { useCallback, useEffect, useRef, useState } from 'react';

export type LimiterThreshold = 0 | -3 | -6 | -12;

export type DuckChannel = 'pads' | 'system';

// ── Ducking tuning ──
// Mic RMS above this (dBFS) counts as speech
const DUCK_THRESHOLD_DB = -45;
// Consecutive readings above threshold needed to engage
const DUCK_ATTACK_READINGS = 2;
// Continuous silence (ms) needed before releasing
const DUCK_RELEASE_HOLD_MS = 700;
// Detector polling interval (ms)
const DUCK_INTERVAL_MS = 50;
// Ducked level: -9 dB
const DUCK_GAIN = Math.pow(10, -9 / 20);
// setTargetAtTime time constants (seconds)
const DUCK_ATTACK_TC = 0.05;
const DUCK_RELEASE_TC = 0.4;

export interface UseAudioMixerReturn {
  mixedStream: MediaStream | null;
  connectMic: (stream: MediaStream) => void;
  disconnectMic: () => void;
  connectElement: (audio: HTMLAudioElement) => GainNode | null;
  connectSystemAudio: (stream: MediaStream) => void;
  disconnectSystemAudio: () => void;
  setSystemAudioVolume: (v: number) => void;
  setMicVolume: (v: number) => void;
  setPadsVolume: (v: number) => void;
  setMicMuted: (muted: boolean) => void;
  setMicPan: (pan: number) => void;
  setSystemAudioPan: (pan: number) => void;
  setPadsPan: (pan: number) => void;
  setListening: (on: boolean) => void;
  setCueMode: (on: boolean) => void;
  setLimiterThreshold: (db: LimiterThreshold) => void;
  setMicMonitor: (on: boolean) => void;
  setSystemMonitor: (on: boolean) => void;
  setPadsMonitor: (on: boolean) => void;
  getChannelLevels: () => { mic: number; system: number; pads: number };
  getNodes: () => { ctx: AudioContext; micGain: GainNode; broadcastBus: GainNode; micVolumeGain: GainNode; clipper: WaveShaperNode } | null;
  ducking: { pads: boolean; system: boolean };
  setDucking: (channel: DuckChannel, enabled: boolean) => void;
  duckActive: boolean;
}

/**
 * Audio routing graph:
 *
 *   micSource → micGain (mute) → [effects] → micVolumeGain (volume) → micPan → broadcastBus
 *   micPan → micMonitorGain → ctx.destination        (per-channel headphone monitor)
 *   sysAudioSource → sysAudioGain → sysDuckGain → sysAudioPan → broadcastBus
 *   sysAudioPan → sysMonitorGain → ctx.destination   (per-channel headphone monitor)
 *   soundboardBus → padsVolumeGain → padsDuckGain → padsPan → sbToBroadcastGain → broadcastBus
 *   (duck gains sit after each channel's volume gain, default 1; the speech
 *    detector ramps them to -9 dB while the mic is active and ducking is on)
 *   padsPan → sbLocalGain → ctx.destination           (per-channel headphone monitor for pads)
 *   broadcastBus → broadcastOutGain → limiter → clipper → dest (→ mixedStream → WebRTC)
 *   broadcastBus → listenGain → ctx.destination       (global listen / full-mix monitor)
 *
 * Gain state table:
 *   Default  (listen OFF, cue OFF): broadcastOutGain=1, sbToBroadcast=1, listen=0
 *                                   per-channel monitors: mic=off, pads=on, sys=off (defaults)
 *   Listen ON (cue OFF):            broadcastOutGain=1, sbToBroadcast=1, listen=1
 *                                   per-channel monitors muted (heard through listen path)
 *   Cue ON:                         broadcastOutGain=0, sbToBroadcast=0, listen=1, sbLocal=1
 *                                   (nothing reaches receiver; soundboard + mic/effects play locally)
 */
export function useAudioMixer(): UseAudioMixerReturn {
  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micPrepSplitterRef = useRef<ChannelSplitterNode | null>(null);
  const micPrepMergerRef = useRef<ChannelMergerNode | null>(null);
  const sysAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sysAudioGainRef = useRef<GainNode | null>(null);
  const sysAudioPanRef = useRef<StereoPannerNode | null>(null);
  const sysAudioStreamRef = useRef<MediaStream | null>(null);
  const connectedElements = useRef<WeakSet<HTMLAudioElement>>(new WeakSet());
  const [mixedStream, setMixedStream] = useState<MediaStream | null>(null);

  // Gain node refs
  const micGainRef = useRef<GainNode | null>(null);
  const micVolumeGainRef = useRef<GainNode | null>(null);
  const micPanRef = useRef<StereoPannerNode | null>(null);
  const broadcastBusRef = useRef<GainNode | null>(null);
  const soundboardBusRef = useRef<GainNode | null>(null);
  const padsVolumeGainRef = useRef<GainNode | null>(null);
  const padsPanRef = useRef<StereoPannerNode | null>(null);
  const sbToBroadcastGainRef = useRef<GainNode | null>(null);
  const sbLocalGainRef = useRef<GainNode | null>(null);
  const listenGainRef = useRef<GainNode | null>(null);
  const broadcastOutGainRef = useRef<GainNode | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  const clipperRef = useRef<WaveShaperNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const padsAnalyserRef = useRef<AnalyserNode | null>(null);
  const systemAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const padsAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const systemAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Per-channel monitor gain nodes (headphone buttons)
  const micMonitorGainRef = useRef<GainNode | null>(null);
  const sysMonitorGainRef = useRef<GainNode | null>(null);
  // Pads monitor uses sbLocalGainRef

  // Track per-channel monitor desired state for listen/cue restore
  const micMonitorOnRef = useRef(false);
  const sysMonitorOnRef = useRef(false);
  const padsMonitorOnRef = useRef(true); // pads heard locally by default

  // Track current mic volume for mute/unmute restore
  const micVolumeRef = useRef(1);

  // ── Ducking state ──
  const padsDuckGainRef = useRef<GainNode | null>(null);
  const sysDuckGainRef = useRef<GainNode | null>(null);
  const duckingRef = useRef<{ pads: boolean; system: boolean }>({ pads: false, system: false });
  const [ducking, setDuckingState] = useState<{ pads: boolean; system: boolean }>({ pads: false, system: false });
  const duckActiveRef = useRef(false);
  const [duckActive, setDuckActiveState] = useState(false);
  const duckIntervalRef = useRef<number | null>(null);
  const duckAboveCountRef = useRef(0);
  const duckBelowMsRef = useRef(0);
  const duckDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  // Indirection so ensureContext (defined below) can kick the detector loop
  const updateDuckLoopRef = useRef<(() => void) | null>(null);

  /** Build a hard-clip transfer curve that caps amplitude at the given dBFS threshold */
  const buildClipCurve = useCallback((thresholdDb: number): Float32Array<ArrayBuffer> => {
    const samples = 8192;
    const curve = new Float32Array(samples);
    const ceiling = thresholdDb >= 0 ? 1.0 : Math.pow(10, thresholdDb / 20);
    for (let i = 0; i < samples; i++) {
      const x = (2 * i) / (samples - 1) - 1; // -1 to 1
      curve[i] = Math.max(-ceiling, Math.min(ceiling, x));
    }
    return curve;
  }, []);

  // Lazily initialise the AudioContext + full gain node graph
  const ensureContext = useCallback(() => {
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      if (ctxRef.current.state === 'suspended') {
        ctxRef.current.resume();
      }
      return {
        ctx: ctxRef.current,
        dest: destRef.current!,
        broadcastBus: broadcastBusRef.current!,
        soundboardBus: soundboardBusRef.current!,
        micGain: micGainRef.current!,
      };
    }

    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();

    // Create gain nodes
    const broadcastBus = ctx.createGain(); // unity, merges mic + soundboard
    const soundboardBus = ctx.createGain(); // unity, all soundboard elements connect here
    const micGain = ctx.createGain(); // mute only (0 or 1)
    const micVolumeGain = ctx.createGain(); // mic volume — after effects so it's the final control
    const micPan = ctx.createStereoPanner();
    const sbToBroadcastGain = ctx.createGain(); // 0 in cue mode
    const sbLocalGain = ctx.createGain(); // soundboard → local speakers
    const padsVolumeGain = ctx.createGain();
    const padsPan = ctx.createStereoPanner();
    const listenGain = ctx.createGain(); // broadcast → local speakers
    const broadcastOutGain = ctx.createGain(); // gates audio to WebRTC (0 in cue mode)
    const micAnalyser = ctx.createAnalyser();
    const padsAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.7;
    padsAnalyser.fftSize = 256;
    padsAnalyser.smoothingTimeConstant = 0.7;

    // Keep bus stereo but let Web Audio perform normal speaker upmix/downmix.
    // Using explicit channel mode here can leave mono sources effectively left-only
    // until a panner move re-distributes channels.
    broadcastBus.channelCount = 2;
    broadcastBus.channelCountMode = 'max';
    broadcastBus.channelInterpretation = 'speakers';

    // Default gains
    micGain.gain.value = 1;
    micVolumeGain.gain.value = 1;
    micPan.pan.value = 0;
    broadcastBus.gain.value = 1;
    soundboardBus.gain.value = 1;
    padsVolumeGain.gain.value = 1;
    padsPan.pan.value = 0;
    sbToBroadcastGain.gain.value = 1;
    sbLocalGain.gain.value = 1;
    listenGain.gain.value = 0; // listen off by default
    broadcastOutGain.gain.value = 1;

    // Output limiter: compressor (smooth gain reduction) + clipper (hard ceiling)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = 0;   // default: limit at 0 dBFS
    limiter.knee.value = 0;        // hard knee
    limiter.ratio.value = 20;      // aggressive ratio
    limiter.attack.value = 0;      // fastest possible attack
    limiter.release.value = 0.05;  // 50ms release

    // Hard clipper — guarantees nothing exceeds the threshold
    const clipper = ctx.createWaveShaper();
    clipper.curve = buildClipCurve(0);
    clipper.oversample = '4x'; // reduce aliasing from clipping

    // Per-channel monitor gain nodes
    const micMonitorGain = ctx.createGain();
    micMonitorGain.gain.value = 0; // mic monitor off by default

    // Duck gain for pads: inserted at build time (gain 1) so enabling
    // ducking later never rewires the graph mid-broadcast
    const padsDuckGain = ctx.createGain();
    padsDuckGain.gain.value = 1;

    // Wire the graph
    // micVolumeGain → micPan → broadcastBus (mic path always goes through volume + pan)
    micVolumeGain.connect(micPan);
    micPan.connect(broadcastBus);
    micPan.connect(micAnalyser);
    // micPan → micMonitorGain → ctx.destination (per-channel headphone monitor)
    micPan.connect(micMonitorGain);
    micMonitorGain.connect(ctx.destination);
    // micGain → micVolumeGain (connected when mic is added)
    // soundboardBus → padsVolumeGain → padsDuckGain → padsPan → (broadcast + local)
    soundboardBus.connect(padsVolumeGain);
    padsVolumeGain.connect(padsDuckGain);
    padsDuckGain.connect(padsPan);
    // padsPan → sbToBroadcastGain → broadcastBus
    padsPan.connect(sbToBroadcastGain);
    sbToBroadcastGain.connect(broadcastBus);
    padsPan.connect(padsAnalyser);
    // padsPan → sbLocalGain → ctx.destination
    padsPan.connect(sbLocalGain);
    sbLocalGain.connect(ctx.destination);
    // broadcastBus → broadcastOutGain → limiter → clipper → dest (WebRTC output)
    broadcastBus.connect(broadcastOutGain);
    broadcastOutGain.connect(limiter);
    limiter.connect(clipper);
    clipper.connect(dest);
    // broadcastBus → listenGain → ctx.destination
    broadcastBus.connect(listenGain);
    listenGain.connect(ctx.destination);

    // Store refs
    ctxRef.current = ctx;
    destRef.current = dest;
    broadcastBusRef.current = broadcastBus;
    soundboardBusRef.current = soundboardBus;
    micGainRef.current = micGain;
    micVolumeGainRef.current = micVolumeGain;
    micPanRef.current = micPan;
    padsVolumeGainRef.current = padsVolumeGain;
    padsPanRef.current = padsPan;
    sbToBroadcastGainRef.current = sbToBroadcastGain;
    sbLocalGainRef.current = sbLocalGain;
    listenGainRef.current = listenGain;
    broadcastOutGainRef.current = broadcastOutGain;
    limiterRef.current = limiter;
    clipperRef.current = clipper;
    micMonitorGainRef.current = micMonitorGain;
    padsDuckGainRef.current = padsDuckGain;
    micAnalyserRef.current = micAnalyser;
    padsAnalyserRef.current = padsAnalyser;
    micAnalyserDataRef.current = new Uint8Array(micAnalyser.fftSize);
    padsAnalyserDataRef.current = new Uint8Array(padsAnalyser.fftSize);

    setMixedStream(dest.stream);

    // Start the ducking detector if it was enabled before the graph existed
    updateDuckLoopRef.current?.();

    return { ctx, dest, broadcastBus, soundboardBus, micGain, micVolumeGain };
  }, []);

  const connectMic = useCallback(
    (stream: MediaStream) => {
      const { ctx, micGain } = ensureContext();

      // Disconnect previous mic source if any
      if (micSourceRef.current) {
        try {
          micSourceRef.current.disconnect();
        } catch {
          // already disconnected
        }
      }

      const source = ctx.createMediaStreamSource(stream);
      const track = stream.getAudioTracks()[0];
      const channels = track?.getSettings?.().channelCount;

      // Normalize mic input to 2ch before the mixer path.
      // - 2ch sources keep L/R separation.
      // - Non-2ch sources are duplicated to both sides.
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      source.connect(splitter);
      splitter.connect(merger, 0, 0);
      if (channels === 2) {
        splitter.connect(merger, 1, 1);
      } else {
        splitter.connect(merger, 0, 1);
      }
      merger.connect(micGain);

      micPrepSplitterRef.current = splitter;
      micPrepMergerRef.current = merger;
      micGain.connect(micVolumeGainRef.current!);
      micSourceRef.current = source;
    },
    [ensureContext],
  );

  const disconnectMic = useCallback(() => {
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch {
        // already disconnected
      }
      micSourceRef.current = null;
    }
    if (micPrepSplitterRef.current) {
      try { micPrepSplitterRef.current.disconnect(); } catch { /* already disconnected */ }
      micPrepSplitterRef.current = null;
    }
    if (micPrepMergerRef.current) {
      try { micPrepMergerRef.current.disconnect(); } catch { /* already disconnected */ }
      micPrepMergerRef.current = null;
    }
  }, []);

  const connectSystemAudio = useCallback(
    (stream: MediaStream) => {
      const { ctx } = ensureContext();

      // Disconnect previous system audio if any
      if (sysAudioSourceRef.current) {
        try { sysAudioSourceRef.current.disconnect(); } catch { /* already disconnected */ }
      }

      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const analyser = ctx.createAnalyser();
      gain.gain.value = 1;
      pan.pan.value = 0;
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      const sysMonitorGain = ctx.createGain();
      sysMonitorGain.gain.value = sysMonitorOnRef.current ? 1 : 0;

      // Duck gain inserted at build time; picks up any duck already in progress
      const sysDuckGain = ctx.createGain();
      sysDuckGain.gain.value = duckActiveRef.current && duckingRef.current.system ? DUCK_GAIN : 1;

      source.connect(gain);
      gain.connect(sysDuckGain);
      sysDuckGain.connect(pan);
      pan.connect(broadcastBusRef.current!);
      pan.connect(analyser);
      // Per-channel headphone monitor for system audio
      pan.connect(sysMonitorGain);
      sysMonitorGain.connect(ctx.destination);

      sysAudioSourceRef.current = source;
      sysAudioGainRef.current = gain;
      sysAudioPanRef.current = pan;
      sysDuckGainRef.current = sysDuckGain;
      sysMonitorGainRef.current = sysMonitorGain;
      systemAnalyserRef.current = analyser;
      systemAnalyserDataRef.current = new Uint8Array(analyser.fftSize);
      sysAudioStreamRef.current = stream;

      // If the system audio track ends (user stops sharing), clean up
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.addEventListener('ended', () => {
          disconnectSystemAudioInternal();
        });
      }
    },
    [ensureContext],
  );

  const disconnectSystemAudioInternal = useCallback(() => {
    if (sysAudioSourceRef.current) {
      try { sysAudioSourceRef.current.disconnect(); } catch { /* already disconnected */ }
      sysAudioSourceRef.current = null;
    }
    if (sysAudioGainRef.current) {
      sysAudioGainRef.current = null;
    }
    if (sysAudioPanRef.current) {
      sysAudioPanRef.current = null;
    }
    if (sysDuckGainRef.current) {
      sysDuckGainRef.current = null;
    }
    if (systemAnalyserRef.current) {
      systemAnalyserRef.current = null;
    }
    if (systemAnalyserDataRef.current) {
      systemAnalyserDataRef.current = null;
    }
    if (sysAudioStreamRef.current) {
      sysAudioStreamRef.current.getTracks().forEach(t => t.stop());
      sysAudioStreamRef.current = null;
    }
  }, []);

  const disconnectSystemAudio = disconnectSystemAudioInternal;

  const setSystemAudioVolume = useCallback((v: number) => {
    if (sysAudioGainRef.current) {
      sysAudioGainRef.current.gain.value = v;
    }
  }, []);

  const setSystemAudioPan = useCallback((pan: number) => {
    if (sysAudioPanRef.current) {
      sysAudioPanRef.current.pan.value = Math.max(-1, Math.min(1, pan));
    }
  }, []);

  const connectElement = useCallback(
    (audio: HTMLAudioElement): GainNode | null => {
      // Guard against double-connecting the same element
      if (connectedElements.current.has(audio)) return null;

      const { ctx, soundboardBus } = ensureContext();
      const source = ctx.createMediaElementSource(audio);

      // Insert a per-element gain node for volume control (supports >1.0 for boost)
      const elementGain = ctx.createGain();
      elementGain.gain.value = 1;
      source.connect(elementGain);
      elementGain.connect(soundboardBus);

      connectedElements.current.add(audio);
      return elementGain;
    },
    [ensureContext],
  );

  // --- Control methods ---

  const setMicVolume = useCallback((v: number) => {
    micVolumeRef.current = v;
    if (micVolumeGainRef.current) {
      micVolumeGainRef.current.gain.value = v;
    }
  }, []);

  const setMicPan = useCallback((pan: number) => {
    if (micPanRef.current) {
      micPanRef.current.pan.value = Math.max(-1, Math.min(1, pan));
    }
  }, []);

  const setPadsVolume = useCallback((v: number) => {
    if (padsVolumeGainRef.current) {
      padsVolumeGainRef.current.gain.value = v;
    }
  }, []);

  const setPadsPan = useCallback((pan: number) => {
    if (padsPanRef.current) {
      padsPanRef.current.pan.value = Math.max(-1, Math.min(1, pan));
    }
  }, []);

  const setMicMuted = useCallback((muted: boolean) => {
    if (micGainRef.current) {
      micGainRef.current.gain.value = muted ? 0 : 1;
    }
  }, []);

  const setListening = useCallback((on: boolean) => {
    if (listenGainRef.current) {
      listenGainRef.current.gain.value = on ? 1 : 0;
    }
    // When listen is ON, mute per-channel monitors to avoid doubling
    // (the full mix is already heard through the listen path).
    // When listen is OFF, restore each monitor to its saved state.
    if (sbLocalGainRef.current) {
      sbLocalGainRef.current.gain.value = on ? 0 : (padsMonitorOnRef.current ? 1 : 0);
    }
    if (micMonitorGainRef.current) {
      micMonitorGainRef.current.gain.value = on ? 0 : (micMonitorOnRef.current ? 1 : 0);
    }
    if (sysMonitorGainRef.current) {
      sysMonitorGainRef.current.gain.value = on ? 0 : (sysMonitorOnRef.current ? 1 : 0);
    }
  }, []);

  const setCueMode = useCallback((on: boolean) => {
    // Mute only the WebRTC output path in cue mode — broadcastBus stays live
    // so mic + effects can still be monitored locally via listenGain.
    if (broadcastOutGainRef.current) {
      broadcastOutGainRef.current.gain.value = on ? 0 : 1;
    }
    if (sbToBroadcastGainRef.current) {
      sbToBroadcastGainRef.current.gain.value = on ? 0 : 1;
    }
    if (on) {
      // Enable local monitoring for mic/effects and soundboard
      if (listenGainRef.current) {
        listenGainRef.current.gain.value = 1;
      }
      if (sbLocalGainRef.current) {
        sbLocalGainRef.current.gain.value = 1;
      }
      // Mute per-channel monitors in cue mode (heard through listen path)
      if (micMonitorGainRef.current) {
        micMonitorGainRef.current.gain.value = 0;
      }
      if (sysMonitorGainRef.current) {
        sysMonitorGainRef.current.gain.value = 0;
      }
    }
    // When cue off: defer to the listen state set by setListening
  }, []);

  const setMicMonitor = useCallback((on: boolean) => {
    micMonitorOnRef.current = on;
    if (micMonitorGainRef.current) {
      micMonitorGainRef.current.gain.value = on ? 1 : 0;
    }
  }, []);

  const setSystemMonitor = useCallback((on: boolean) => {
    sysMonitorOnRef.current = on;
    if (sysMonitorGainRef.current) {
      sysMonitorGainRef.current.gain.value = on ? 1 : 0;
    }
  }, []);

  const setPadsMonitor = useCallback((on: boolean) => {
    padsMonitorOnRef.current = on;
    if (sbLocalGainRef.current) {
      sbLocalGainRef.current.gain.value = on ? 1 : 0;
    }
  }, []);

  const setLimiterThreshold = useCallback((db: LimiterThreshold) => {
    if (limiterRef.current) {
      limiterRef.current.threshold.value = db;
    }
    if (clipperRef.current) {
      clipperRef.current.curve = buildClipCurve(db);
    }
  }, [buildClipCurve]);

  const analyserLevel = useCallback((analyser: AnalyserNode | null, data: Uint8Array<ArrayBuffer> | null): number => {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / data.length);
    if (rms <= 0) return 0;
    // Use dB-like scaling so mini LEDs track the main meter feel more closely.
    const db = Math.max(-60, 20 * Math.log10(rms));
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }, []);

  const getChannelLevels = useCallback(() => {
    return {
      mic: analyserLevel(micAnalyserRef.current, micAnalyserDataRef.current),
      system: analyserLevel(systemAnalyserRef.current, systemAnalyserDataRef.current),
      pads: analyserLevel(padsAnalyserRef.current, padsAnalyserDataRef.current),
    };
  }, [analyserLevel]);

  // ── Ducking ──

  /** Post-effects mic RMS in dBFS (uses the existing mic analyser, fed from micPan) */
  const readMicRmsDb = useCallback((): number => {
    const analyser = micAnalyserRef.current;
    if (!analyser) return -100;
    let data = duckDataRef.current;
    if (!data || data.length !== analyser.fftSize) {
      data = new Uint8Array(analyser.fftSize);
      duckDataRef.current = data;
    }
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / data.length);
    return rms <= 0 ? -100 : 20 * Math.log10(rms);
  }, []);

  /** Engage or release the duck on every enabled channel */
  const applyDuck = useCallback((active: boolean) => {
    duckActiveRef.current = active;
    setDuckActiveState(active);
    const ctx = ctxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    const enabled = duckingRef.current;
    const tc = active ? DUCK_ATTACK_TC : DUCK_RELEASE_TC;
    if (padsDuckGainRef.current) {
      padsDuckGainRef.current.gain.setTargetAtTime(active && enabled.pads ? DUCK_GAIN : 1, now, tc);
    }
    if (sysDuckGainRef.current) {
      sysDuckGainRef.current.gain.setTargetAtTime(active && enabled.system ? DUCK_GAIN : 1, now, tc);
    }
  }, []);

  const duckTick = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') return;
    const db = readMicRmsDb();
    if (db > DUCK_THRESHOLD_DB) {
      duckAboveCountRef.current += 1;
      duckBelowMsRef.current = 0;
      if (!duckActiveRef.current && duckAboveCountRef.current >= DUCK_ATTACK_READINGS) {
        applyDuck(true);
      }
    } else {
      duckAboveCountRef.current = 0;
      duckBelowMsRef.current += DUCK_INTERVAL_MS;
      if (duckActiveRef.current && duckBelowMsRef.current >= DUCK_RELEASE_HOLD_MS) {
        applyDuck(false);
      }
    }
  }, [readMicRmsDb, applyDuck]);

  /** Run the detector only while a duck channel is enabled and the mixer is live */
  const updateDuckLoop = useCallback(() => {
    const anyEnabled = duckingRef.current.pads || duckingRef.current.system;
    const live = !!ctxRef.current && ctxRef.current.state !== 'closed';
    if (anyEnabled && live) {
      if (duckIntervalRef.current === null) {
        duckAboveCountRef.current = 0;
        duckBelowMsRef.current = 0;
        duckIntervalRef.current = window.setInterval(duckTick, DUCK_INTERVAL_MS);
      }
    } else if (duckIntervalRef.current !== null) {
      window.clearInterval(duckIntervalRef.current);
      duckIntervalRef.current = null;
      if (duckActiveRef.current) {
        applyDuck(false);
      }
    }
  }, [duckTick, applyDuck]);
  updateDuckLoopRef.current = updateDuckLoop;

  const setDucking = useCallback(
    (channel: DuckChannel, enabled: boolean) => {
      duckingRef.current = { ...duckingRef.current, [channel]: enabled };
      setDuckingState(duckingRef.current);

      // If a duck is in progress, bring this channel in line immediately
      const ctx = ctxRef.current;
      const gainRef = channel === 'pads' ? padsDuckGainRef : sysDuckGainRef;
      if (ctx && gainRef.current) {
        const target = duckActiveRef.current && enabled ? DUCK_GAIN : 1;
        gainRef.current.gain.setTargetAtTime(target, ctx.currentTime, target === 1 ? DUCK_RELEASE_TC : DUCK_ATTACK_TC);
      }

      updateDuckLoop();
    },
    [updateDuckLoop],
  );

  /** Expose internal nodes so the effects chain can wire itself in */
  const getNodes = useCallback(() => {
    if (!ctxRef.current || !micGainRef.current || !micVolumeGainRef.current || !broadcastBusRef.current || !clipperRef.current) return null;
    return {
      ctx: ctxRef.current,
      micGain: micGainRef.current,
      broadcastBus: broadcastBusRef.current,
      micVolumeGain: micVolumeGainRef.current,
      clipper: clipperRef.current,
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (duckIntervalRef.current !== null) {
        window.clearInterval(duckIntervalRef.current);
        duckIntervalRef.current = null;
      }
      micSourceRef.current?.disconnect();
      sysAudioSourceRef.current?.disconnect();
      sysAudioStreamRef.current?.getTracks().forEach(t => t.stop());
      ctxRef.current?.close();
      ctxRef.current = null;
      destRef.current = null;
    };
  }, []);

  return {
    mixedStream,
    connectMic,
    disconnectMic,
    connectElement,
    connectSystemAudio,
    disconnectSystemAudio,
    setSystemAudioVolume,
    setMicVolume,
    setPadsVolume,
    setMicMuted,
    setMicPan,
    setSystemAudioPan,
    setPadsPan,
    setListening,
    setCueMode,
    setLimiterThreshold,
    setMicMonitor,
    setSystemMonitor,
    setPadsMonitor,
    getChannelLevels,
    getNodes,
    ducking,
    setDucking,
    duckActive,
  };
}
