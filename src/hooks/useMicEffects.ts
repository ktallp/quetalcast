import { useCallback, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type EffectName = 'enhance' | 'tone' | 'voiceShift' | 'delay' | 'echo' | 'compressor' | 'deEsser';

/** Momentary (hold-to-engage) FX triggered via triggerFx / releaseFx */
export type FxName = 'radioVoice' | 'bigRoom' | 'slapback' | 'pitchDrop';

export const FX_NAMES: FxName[] = ['radioVoice', 'bigRoom', 'slapback', 'pitchDrop'];

export interface EffectState {
  enabled: boolean;
  params: Record<string, number>;
}

export const CHAIN_ORDER: EffectName[] = ['enhance', 'tone', 'compressor', 'deEsser', 'voiceShift', 'delay', 'echo'];

export const EFFECT_LABELS: Record<EffectName, string> = {
  enhance: 'Enhance',
  tone: 'Tone',
  compressor: 'Compressor',
  deEsser: 'De-esser',
  voiceShift: 'Pitch',
  delay: 'Delay',
  echo: 'Reverb',
};

export const DEFAULT_PARAMS: Record<EffectName, Record<string, number>> = {
  enhance: { gate: 30, cleanup: 30, clarity: 0 },
  tone: { bass: 0, mids: 0, treble: 0 },
  compressor: { amount: 50, speed: 50, makeup: 0 },
  deEsser: { amount: 40 },
  voiceShift: { shift: 50 },
  delay: { timing: 30, repeats: 30, amount: 50 },
  echo: { space: 50, fade: 50, amount: 30 },
};

// ── Internal types ─────────────────────────────────────────────────

interface EffectNodeSet {
  input: AudioNode;
  output: AudioNode;
  internals: Record<string, AudioNode>;
}

// ── Impulse response generator (reverb) ────────────────────────────

function generateImpulse(ctx: AudioContext, space: number, fade: number): AudioBuffer {
  // space 0-100 → duration 0.1 – 5 s
  // fade  0-100 → decay rate
  const duration = 0.1 + (space / 100) * 4.9;
  const decayRate = 0.5 + (fade / 100) * 5;
  const sampleRate = ctx.sampleRate;
  const length = Math.max(Math.floor(sampleRate * duration), 1);
  const buffer = ctx.createBuffer(2, length, sampleRate);

  // 9 discrete early reflections spread over the first 40ms, decaying in level
  const reflectionCount = 9;
  const earlyReflections: Array<{ offset: number; gain: number }> = [];
  for (let r = 0; r < reflectionCount; r++) {
    const timeSec = 0.005 + (r / (reflectionCount - 1)) * 0.035;
    earlyReflections.push({
      offset: Math.floor(timeSec * sampleRate),
      gain: 0.6 * Math.pow(0.8, r),
    });
  }

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);

    // Decorrelated noise tail (fresh random per channel) with exponential decay
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-3 * decayRate * t);
    }

    // Progressive lowpass damping: a one-pole filter whose smoothing deepens
    // over the tail so highs die out faster than lows, like a real room
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const k = 1 - 0.85 * t; // 1 = no filtering at the start, heavy at the end
      lp = lp + k * (data[i] - lp);
      data[i] = lp;
    }

    // Stamp in the early reflections. Opposite polarity and a little timing
    // jitter per channel keep the stereo image wide.
    for (const { offset, gain } of earlyReflections) {
      const jitter = Math.floor(Math.random() * 0.002 * sampleRate);
      const idx = offset + jitter;
      if (idx < length) {
        data[idx] += (ch === 0 ? 1 : -1) * gain * (0.7 + Math.random() * 0.3);
      }
    }
  }
  return buffer;
}

// ── Node creators ──────────────────────────────────────────────────

/**
 * Enhance: noise gate (worklet) → high-pass filter → presence boost.
 * The noise gate worklet MUST be loaded before calling this function.
 */
function createEnhanceNodes(ctx: AudioContext): EffectNodeSet {
  const gate = new AudioWorkletNode(ctx, 'noise-gate-processor');

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 80; // default for cleanup=30
  highpass.Q.value = 0.7;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3500;
  presence.Q.value = 1.2;
  presence.gain.value = 0; // default for clarity=0

  gate.connect(highpass);
  highpass.connect(presence);

  return { input: gate, output: presence, internals: { gate, highpass, presence } };
}

function createToneNodes(ctx: AudioContext): EffectNodeSet {
  const lowshelf = ctx.createBiquadFilter();
  lowshelf.type = 'lowshelf';
  lowshelf.frequency.value = 200;
  lowshelf.gain.value = 0;

  const peaking = ctx.createBiquadFilter();
  peaking.type = 'peaking';
  peaking.frequency.value = 1000;
  peaking.Q.value = 1;
  peaking.gain.value = 0;

  const highshelf = ctx.createBiquadFilter();
  highshelf.type = 'highshelf';
  highshelf.frequency.value = 4000;
  highshelf.gain.value = 0;

  lowshelf.connect(peaking);
  peaking.connect(highshelf);

  return { input: lowshelf, output: highshelf, internals: { lowshelf, peaking, highshelf } };
}

/**
 * Voice Shift uses an AudioWorklet that performs real-time granular pitch
 * shifting.  The worklet module MUST be loaded on the AudioContext before
 * this function is called (see `ensureWorkletLoaded`).
 */
function createVoiceShiftNodes(ctx: AudioContext): EffectNodeSet {
  const worklet = new AudioWorkletNode(ctx, 'pitch-shift-processor');
  // AudioWorkletNode is both input and output
  return { input: worklet, output: worklet, internals: { worklet } };
}

function createDelayNodes(ctx: AudioContext): EffectNodeSet {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const delayNode = ctx.createDelay(5.0);
  const feedback = ctx.createGain();

  // Defaults: timing 30, repeats 30, amount 50
  delayNode.delayTime.value = 0.05 + (30 / 100) * 0.95;
  feedback.gain.value = (30 / 100) * 0.9;
  dryGain.gain.value = 1;
  wetGain.gain.value = 0.5;

  // Dry path
  input.connect(dryGain);
  dryGain.connect(output);

  // Wet path with feedback
  input.connect(delayNode);
  delayNode.connect(feedback);
  feedback.connect(delayNode);
  delayNode.connect(wetGain);
  wetGain.connect(output);

  return { input, output, internals: { dryGain, wetGain, delay: delayNode, feedback } };
}

function createCompressorNodes(ctx: AudioContext): EffectNodeSet {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  const makeupGain = ctx.createGain();

  // Defaults for amount=50, speed=50
  compressor.threshold.value = -25;
  compressor.knee.value = 10;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.15;
  makeupGain.gain.value = 1;

  input.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(output);

  return { input, output, internals: { compressor, makeupGain } };
}

/**
 * De-esser: split-band design. The signal splits at ~5 kHz; the high band
 * runs through a compressor that clamps sibilance and is summed back with
 * the untouched low band.
 */
function createDeEsserNodes(ctx: AudioContext): EffectNodeSet {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const lowBand = ctx.createBiquadFilter();
  lowBand.type = 'lowpass';
  lowBand.frequency.value = 5000;
  lowBand.Q.value = 0.7;

  const highBand = ctx.createBiquadFilter();
  highBand.type = 'highpass';
  highBand.frequency.value = 5000;
  highBand.Q.value = 0.7;

  const sibilanceComp = ctx.createDynamicsCompressor();
  // Defaults for amount=40 (threshold -32 dB, ratio 6.4)
  sibilanceComp.threshold.value = -32;
  sibilanceComp.ratio.value = 6.4;
  sibilanceComp.knee.value = 6;
  sibilanceComp.attack.value = 0.002;
  sibilanceComp.release.value = 0.06;

  // Low band passes through untouched
  input.connect(lowBand);
  lowBand.connect(output);

  // High band gets compressed, then summed back in
  input.connect(highBand);
  highBand.connect(sibilanceComp);
  sibilanceComp.connect(output);

  return { input, output, internals: { lowBand, highBand, sibilanceComp } };
}

function createEchoNodes(ctx: AudioContext): EffectNodeSet {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const convolver = ctx.createConvolver();

  convolver.buffer = generateImpulse(ctx, 50, 50);
  dryGain.gain.value = 1;
  wetGain.gain.value = 0.3;

  // Dry path
  input.connect(dryGain);
  dryGain.connect(output);

  // Wet path
  input.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(output);

  return { input, output, internals: { dryGain, wetGain, convolver } };
}

// ── Parameter applicators ──────────────────────────────────────────

function applyEnhanceParams(nodes: EffectNodeSet, params: Record<string, number>) {
  const gate = params.gate ?? 30;
  const cleanup = params.cleanup ?? 30;
  const clarity = params.clarity ?? 0;

  // Gate: 0 = off (-100 dB, effectively disabled), 100 = aggressive (-20 dB)
  const thresholdDb = gate === 0 ? -100 : -80 + (gate / 100) * 60;
  (nodes.internals.gate as AudioWorkletNode).port.postMessage({ thresholdDb });

  // Cleanup: high-pass cutoff from 20 Hz (0) to 300 Hz (100)
  (nodes.internals.highpass as BiquadFilterNode).frequency.value = 20 + (cleanup / 100) * 280;

  // Clarity: presence boost 0 to +12 dB at 3.5 kHz
  (nodes.internals.presence as BiquadFilterNode).gain.value = (clarity / 100) * 12;
}

function applyToneParams(nodes: EffectNodeSet, params: Record<string, number>) {
  (nodes.internals.lowshelf as BiquadFilterNode).gain.value = params.bass ?? 0;
  (nodes.internals.peaking as BiquadFilterNode).gain.value = params.mids ?? 0;
  (nodes.internals.highshelf as BiquadFilterNode).gain.value = params.treble ?? 0;
}

function applyVoiceShiftParams(nodes: EffectNodeSet, params: Record<string, number>) {
  const shift = params.shift ?? 50;
  // Map 0–100 to pitch ratio: 0 → 0.5 (octave down), 50 → 1.0, 100 → 2.0 (octave up)
  const pitchFactor = Math.pow(2, (shift - 50) / 50);
  (nodes.internals.worklet as AudioWorkletNode).port.postMessage({ pitchFactor });
}

function applyCompressorParams(nodes: EffectNodeSet, params: Record<string, number>) {
  const amount = params.amount ?? 50;
  const speed = params.speed ?? 50;
  const makeup = params.makeup ?? 0;

  const comp = nodes.internals.compressor as DynamicsCompressorNode;
  // amount 0–100 → threshold 0 to -50 dB, ratio 1 to 12
  comp.threshold.value = -(amount / 100) * 50;
  comp.ratio.value = 1 + (amount / 100) * 11;
  comp.knee.value = 30 - (amount / 100) * 25; // softer knee at low amounts

  // speed 0–100 → attack 0.1s (slow) to 0.001s (fast), release 0.5s to 0.05s
  comp.attack.value = 0.1 - (speed / 100) * 0.099;
  comp.release.value = 0.5 - (speed / 100) * 0.45;

  // makeup 0–100 → 0 to +24 dB of gain
  (nodes.internals.makeupGain as GainNode).gain.value = Math.pow(10, (makeup / 100) * 24 / 20);
}

function applyDeEsserParams(nodes: EffectNodeSet, params: Record<string, number>) {
  const amount = params.amount ?? 40;
  const comp = nodes.internals.sibilanceComp as DynamicsCompressorNode;
  // amount 0-100 → threshold -20 to -50 dB, ratio 4 to 10
  comp.threshold.value = -20 - (amount / 100) * 30;
  comp.ratio.value = 4 + (amount / 100) * 6;
}

function applyDelayParams(nodes: EffectNodeSet, params: Record<string, number>) {
  const timing = params.timing ?? 30;
  const repeats = params.repeats ?? 30;
  const amount = params.amount ?? 50;
  (nodes.internals.delay as DelayNode).delayTime.value = 0.05 + (timing / 100) * 0.95;
  (nodes.internals.feedback as GainNode).gain.value = (repeats / 100) * 0.9;
  (nodes.internals.wetGain as GainNode).gain.value = amount / 100;
}

function applyEchoParams(ctx: AudioContext, nodes: EffectNodeSet, params: Record<string, number>) {
  const space = params.space ?? 50;
  const fade = params.fade ?? 50;
  const amount = params.amount ?? 30;
  (nodes.internals.convolver as ConvolverNode).buffer = generateImpulse(ctx, space, fade);
  (nodes.internals.wetGain as GainNode).gain.value = amount / 100;
}

// ── Momentary FX bus ───────────────────────────────────────────────

const FX_ATTACK_SEC = 0.03;  // ramp-in when an FX is triggered
const FX_RELEASE_SEC = 0.08; // send ramp-out on release (tails keep ringing)

interface FxBusNodes {
  /** Fixed tail node the effects chain always terminates into */
  postChain: GainNode;
  /** Dry path postChain → output; ducked for crossfade-style FX */
  dryGain: GainNode;
  /** Per-FX send gains (0 = off, 1 = engaged) */
  sends: Record<FxName, GainNode>;
  /** Nodes wired directly into the chain output (for rewiring on output change) */
  outputs: AudioNode[];
  /** The chain output node the bus is currently connected to */
  connectedTo: AudioNode;
}

function buildDriveCurve() {
  // Gentle tanh drive for the radio voice
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (2 * i) / (samples - 1) - 1;
    curve[i] = Math.tanh(1.8 * x);
  }
  return curve;
}

/** Cancel pending automation and ramp an AudioParam linearly to a target */
function rampParam(param: AudioParam, ctx: AudioContext, target: number, seconds: number) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

/**
 * Permanent parallel FX bus. The voice chain terminates into postChain, which
 * feeds a dry path plus one send per momentary FX; every wet return sums back
 * into the chain output. Sends default to 0, so the bus is silent until an FX
 * is triggered and nothing needs rewiring mid-broadcast.
 *
 * The pitch-shift worklet module MUST be loaded before calling this.
 */
function createFxBus(ctx: AudioContext, output: AudioNode): FxBusNodes {
  const postChain = ctx.createGain();
  const dryGain = ctx.createGain();
  dryGain.gain.value = 1;
  postChain.connect(dryGain);
  dryGain.connect(output);

  // radioVoice: bandpass 300-3400 Hz with slight drive, fully wet while held
  const radioSend = ctx.createGain();
  radioSend.gain.value = 0;
  const radioHighpass = ctx.createBiquadFilter();
  radioHighpass.type = 'highpass';
  radioHighpass.frequency.value = 300;
  radioHighpass.Q.value = 0.7;
  const radioLowpass = ctx.createBiquadFilter();
  radioLowpass.type = 'lowpass';
  radioLowpass.frequency.value = 3400;
  radioLowpass.Q.value = 0.7;
  const radioDrive = ctx.createWaveShaper();
  radioDrive.curve = buildDriveCurve();
  radioDrive.oversample = '2x';
  const radioWet = ctx.createGain();
  radioWet.gain.value = 1;
  postChain.connect(radioSend);
  radioSend.connect(radioHighpass);
  radioHighpass.connect(radioLowpass);
  radioLowpass.connect(radioDrive);
  radioDrive.connect(radioWet);
  radioWet.connect(output);

  // bigRoom: large damped hall (about 2.8s), tail rings out after release
  const roomSend = ctx.createGain();
  roomSend.gain.value = 0;
  const roomConvolver = ctx.createConvolver();
  roomConvolver.buffer = generateImpulse(ctx, 55, 60);
  const roomWet = ctx.createGain();
  roomWet.gain.value = 0.45;
  postChain.connect(roomSend);
  roomSend.connect(roomConvolver);
  roomConvolver.connect(roomWet);
  roomWet.connect(output);

  // slapback: single 110ms delay with light feedback
  const slapSend = ctx.createGain();
  slapSend.gain.value = 0;
  const slapDelay = ctx.createDelay(1.0);
  slapDelay.delayTime.value = 0.11;
  const slapFeedback = ctx.createGain();
  slapFeedback.gain.value = 0.25;
  const slapWet = ctx.createGain();
  slapWet.gain.value = 0.5;
  postChain.connect(slapSend);
  slapSend.connect(slapDelay);
  slapDelay.connect(slapFeedback);
  slapFeedback.connect(slapDelay);
  slapDelay.connect(slapWet);
  slapWet.connect(output);

  // pitchDrop: dedicated pitch-shift worklet fixed at 0.7, ~70% wet while held
  const pitchSend = ctx.createGain();
  pitchSend.gain.value = 0;
  const pitchWorklet = new AudioWorkletNode(ctx, 'pitch-shift-processor');
  pitchWorklet.port.postMessage({ pitchFactor: 0.7 });
  const pitchWet = ctx.createGain();
  pitchWet.gain.value = 0.7;
  postChain.connect(pitchSend);
  pitchSend.connect(pitchWorklet);
  pitchWorklet.connect(pitchWet);
  pitchWet.connect(output);

  return {
    postChain,
    dryGain,
    sends: { radioVoice: radioSend, bigRoom: roomSend, slapback: slapSend, pitchDrop: pitchSend },
    outputs: [dryGain, radioWet, roomWet, slapWet, pitchWet],
    connectedTo: output,
  };
}

/** Combined dry level while crossfade-style FX are held */
function fxDryTarget(active: Record<FxName, boolean>): number {
  let dry = 1;
  if (active.radioVoice) dry = Math.min(dry, 0.2);
  if (active.pitchDrop) dry = Math.min(dry, 0.3);
  return dry;
}

// ── Hook ───────────────────────────────────────────────────────────

export interface UseMicEffectsReturn {
  effects: Record<EffectName, EffectState>;
  toggleEffect: (name: EffectName) => void;
  updateEffect: (name: EffectName, params: Record<string, number>) => void;
  replaceEffects: (next: Partial<Record<EffectName, EffectState>>) => void;
  insertIntoChain: (ctx: AudioContext, input: AudioNode, output: AudioNode) => Promise<void>;
  removeFromChain: () => void;
  bypassed: boolean;
  setBypassed: (b: boolean) => void;
  getMeterState: () => { reductionDb: number; gateOpen: boolean };
  activeFx: Record<FxName, boolean>;
  triggerFx: (name: FxName) => void;
  releaseFx: (name: FxName) => void;
}

function buildInitialState(): Record<EffectName, EffectState> {
  const state = {} as Record<EffectName, EffectState>;
  for (const name of CHAIN_ORDER) {
    state[name] = { enabled: false, params: { ...DEFAULT_PARAMS[name] } };
  }
  return state;
}

function buildInitialFxState(): Record<FxName, boolean> {
  return { radioVoice: false, bigRoom: false, slapback: false, pitchDrop: false };
}

export function useMicEffects(): UseMicEffectsReturn {
  const [effects, setEffects] = useState<Record<EffectName, EffectState>>(buildInitialState);
  const [bypassed, setBypassedState] = useState(false);
  const [activeFx, setActiveFx] = useState<Record<FxName, boolean>>(buildInitialFxState);

  // Synchronous mirrors for audio operations (avoids async React batching)
  const audioStateRef = useRef<Record<EffectName, EffectState>>(buildInitialState());
  const bypassedRef = useRef(false);
  const activeFxRef = useRef<Record<FxName, boolean>>(buildInitialFxState());

  const ctxRef = useRef<AudioContext | null>(null);
  const chainInputRef = useRef<AudioNode | null>(null);
  const chainOutputRef = useRef<AudioNode | null>(null);
  const effectNodesRef = useRef<Record<EffectName, EffectNodeSet> | null>(null);
  const chainConnectionsRef = useRef<Array<{ from: AudioNode; to: AudioNode }>>([]);
  const insertedRef = useRef(false);
  const fxBusRef = useRef<FxBusNodes | null>(null);
  // Latest gate open/closed state reported by the noise-gate worklet
  const gateOpenRef = useRef(true);

  const createAllNodes = useCallback((ctx: AudioContext): Record<EffectName, EffectNodeSet> => {
    return {
      enhance: createEnhanceNodes(ctx),
      tone: createToneNodes(ctx),
      compressor: createCompressorNodes(ctx),
      deEsser: createDeEsserNodes(ctx),
      voiceShift: createVoiceShiftNodes(ctx),
      delay: createDelayNodes(ctx),
      echo: createEchoNodes(ctx),
    };
  }, []);

  /** Disconnect old chain connections and rebuild based on which effects are enabled */
  const rebuildChain = useCallback(() => {
    // Tear down previous chain connections
    for (const conn of chainConnectionsRef.current) {
      try { conn.from.disconnect(conn.to); } catch { /* already disconnected */ }
    }
    chainConnectionsRef.current = [];

    if (!insertedRef.current || !effectNodesRef.current) return;

    const micGain = chainInputRef.current!;
    const broadcastBus = chainOutputRef.current!;
    const nodes = effectNodesRef.current;
    const state = audioStateRef.current;

    const connections: Array<{ from: AudioNode; to: AudioNode }> = [];
    let current: AudioNode = micGain;

    // When bypassed, skip every effect (enabled flags stay untouched, so
    // releasing bypass rebuilds the full chain instantly)
    if (!bypassedRef.current) {
      for (const name of CHAIN_ORDER) {
        if (state[name].enabled) {
          current.connect(nodes[name].input);
          connections.push({ from: current, to: nodes[name].input });
          current = nodes[name].output;
        }
      }
    }

    // The chain terminates in the FX bus tail (postChain → dry + sends → output)
    // so momentary FX stay wired no matter which effects are enabled
    const tail: AudioNode = fxBusRef.current ? fxBusRef.current.postChain : broadcastBus;
    current.connect(tail);
    connections.push({ from: current, to: tail });

    chainConnectionsRef.current = connections;
  }, []);

  /** Ensure all AudioWorklet modules are loaded on this context */
  const workletLoadedRef = useRef(false);
  const ensureWorkletLoaded = useCallback(async (ctx: AudioContext) => {
    if (workletLoadedRef.current) return;
    await Promise.all([
      ctx.audioWorklet.addModule('/pitch-shift-processor.js'),
      ctx.audioWorklet.addModule('/noise-gate-processor.js'),
    ]);
    workletLoadedRef.current = true;
  }, []);

  /** Wire the effects chain between micGain and broadcastBus */
  const insertIntoChain = useCallback(
    async (ctx: AudioContext, input: AudioNode, output: AudioNode) => {
      ctxRef.current = ctx;
      chainInputRef.current = input;
      chainOutputRef.current = output;

      // Load worklet module before creating nodes (required for AudioWorkletNode)
      await ensureWorkletLoaded(ctx);

      if (!effectNodesRef.current) {
        effectNodesRef.current = createAllNodes(ctx);
        // Listen for gate open/closed reports from the noise-gate worklet
        const gateWorklet = effectNodesRef.current.enhance.internals.gate as AudioWorkletNode;
        gateWorklet.port.onmessage = (e) => {
          if (e.data && e.data.type === 'gateState') {
            gateOpenRef.current = Boolean(e.data.open);
          }
        };
      }

      if (!fxBusRef.current) {
        fxBusRef.current = createFxBus(ctx, output);
        // Sync with any FX latched before the bus existed
        const active = activeFxRef.current;
        for (const fx of FX_NAMES) {
          fxBusRef.current.sends[fx].gain.value = active[fx] ? 1 : 0;
        }
        fxBusRef.current.dryGain.gain.value = fxDryTarget(active);
      } else if (fxBusRef.current.connectedTo !== output) {
        // Chain output node changed: rewire the bus outputs to the new node
        for (const node of fxBusRef.current.outputs) {
          try { node.disconnect(fxBusRef.current.connectedTo); } catch { /* not connected */ }
          node.connect(output);
        }
        fxBusRef.current.connectedTo = output;
      }

      // Remove the direct micGain → broadcastBus connection
      try { input.disconnect(output); } catch { /* not connected */ }

      insertedRef.current = true;
      rebuildChain();
    },
    [createAllNodes, rebuildChain, ensureWorkletLoaded],
  );

  /** Remove chain and reconnect micGain → broadcastBus directly */
  const removeFromChain = useCallback(() => {
    for (const conn of chainConnectionsRef.current) {
      try { conn.from.disconnect(conn.to); } catch { /* already disconnected */ }
    }
    chainConnectionsRef.current = [];

    if (chainInputRef.current && chainOutputRef.current) {
      try { chainInputRef.current.connect(chainOutputRef.current); } catch { /* */ }
    }
    insertedRef.current = false;
  }, []);

  const toggleEffect = useCallback(
    (name: EffectName) => {
      const newState = { ...audioStateRef.current };
      newState[name] = { ...newState[name], enabled: !newState[name].enabled };
      audioStateRef.current = newState;
      setEffects(newState);
      rebuildChain();
    },
    [rebuildChain],
  );

  const updateEffect = useCallback((name: EffectName, params: Record<string, number>) => {
    const newState = { ...audioStateRef.current };
    newState[name] = { ...newState[name], params: { ...newState[name].params, ...params } };
    audioStateRef.current = newState;
    setEffects(newState);

    // Apply to audio nodes immediately
    if (effectNodesRef.current && ctxRef.current) {
      const nodeSet = effectNodesRef.current[name];
      const fullParams = newState[name].params;
      switch (name) {
        case 'enhance':
          applyEnhanceParams(nodeSet, fullParams);
          break;
        case 'tone':
          applyToneParams(nodeSet, fullParams);
          break;
        case 'compressor':
          applyCompressorParams(nodeSet, fullParams);
          break;
        case 'deEsser':
          applyDeEsserParams(nodeSet, fullParams);
          break;
        case 'voiceShift':
          applyVoiceShiftParams(nodeSet, fullParams);
          break;
        case 'delay':
          applyDelayParams(nodeSet, fullParams);
          break;
        case 'echo':
          applyEchoParams(ctxRef.current, nodeSet, fullParams);
          break;
      }
    }
  }, []);

  const replaceEffects = useCallback((next: Partial<Record<EffectName, EffectState>>) => {
    const merged = buildInitialState();
    for (const name of CHAIN_ORDER) {
      const incoming = next[name];
      if (!incoming) continue;
      merged[name] = {
        enabled: Boolean(incoming.enabled),
        params: { ...merged[name].params, ...(incoming.params ?? {}) },
      };
    }

    audioStateRef.current = merged;
    setEffects(merged);

    if (effectNodesRef.current && ctxRef.current) {
      for (const name of CHAIN_ORDER) {
        const nodeSet = effectNodesRef.current[name];
        const fullParams = merged[name].params;
        switch (name) {
          case 'enhance':
            applyEnhanceParams(nodeSet, fullParams);
            break;
          case 'tone':
            applyToneParams(nodeSet, fullParams);
            break;
          case 'compressor':
            applyCompressorParams(nodeSet, fullParams);
            break;
          case 'deEsser':
            applyDeEsserParams(nodeSet, fullParams);
            break;
          case 'voiceShift':
            applyVoiceShiftParams(nodeSet, fullParams);
            break;
          case 'delay':
            applyDelayParams(nodeSet, fullParams);
            break;
          case 'echo':
            applyEchoParams(ctxRef.current, nodeSet, fullParams);
            break;
        }
      }
    }

    rebuildChain();
  }, [rebuildChain]);

  /**
   * Hard bypass: reconnect input directly to output (same as all-disabled)
   * without touching the enabled flags, so releasing bypass restores the
   * chain instantly. Safe to toggle rapidly (hold-to-compare).
   */
  const setBypassed = useCallback(
    (b: boolean) => {
      if (bypassedRef.current === b) return;
      bypassedRef.current = b;
      setBypassedState(b);
      rebuildChain();
    },
    [rebuildChain],
  );

  const getMeterState = useCallback((): { reductionDb: number; gateOpen: boolean } => {
    const state = audioStateRef.current;
    const nodes = effectNodesRef.current;

    let reductionDb = 0;
    if (nodes && state.compressor.enabled && !bypassedRef.current) {
      reductionDb = (nodes.compressor.internals.compressor as DynamicsCompressorNode).reduction;
    }

    // When enhance is off (or the chain is bypassed) nothing is gating,
    // so the gate reads as open
    const gateOpen = !state.enhance.enabled || bypassedRef.current ? true : gateOpenRef.current;

    return { reductionDb, gateOpen };
  }, []);

  /** Ramp the dry path to the combined crossfade level of the held FX */
  const updateFxDryGain = useCallback(() => {
    const bus = fxBusRef.current;
    const ctx = ctxRef.current;
    if (!bus || !ctx) return;
    rampParam(bus.dryGain.gain, ctx, fxDryTarget(activeFxRef.current), FX_ATTACK_SEC);
  }, []);

  const triggerFx = useCallback(
    (name: FxName) => {
      if (activeFxRef.current[name]) return;
      const next = { ...activeFxRef.current, [name]: true };
      activeFxRef.current = next;
      setActiveFx(next);

      const bus = fxBusRef.current;
      const ctx = ctxRef.current;
      if (bus && ctx) {
        rampParam(bus.sends[name].gain, ctx, 1, FX_ATTACK_SEC);
      }
      updateFxDryGain();
    },
    [updateFxDryGain],
  );

  const releaseFx = useCallback(
    (name: FxName) => {
      if (!activeFxRef.current[name]) return;
      const next = { ...activeFxRef.current, [name]: false };
      activeFxRef.current = next;
      setActiveFx(next);

      const bus = fxBusRef.current;
      const ctx = ctxRef.current;
      if (bus && ctx) {
        // Only the send ramps down; delay feedback and reverb tails keep
        // ringing through the wet return. radioVoice and pitchDrop have no
        // tail, so they restore near-instantly.
        const releaseSec = name === 'radioVoice' || name === 'pitchDrop' ? FX_ATTACK_SEC : FX_RELEASE_SEC;
        rampParam(bus.sends[name].gain, ctx, 0, releaseSec);
      }
      updateFxDryGain();
    },
    [updateFxDryGain],
  );

  return {
    effects,
    toggleEffect,
    updateEffect,
    replaceEffects,
    insertIntoChain,
    removeFromChain,
    bypassed,
    setBypassed,
    getMeterState,
    activeFx,
    triggerFx,
    releaseFx,
  };
}
