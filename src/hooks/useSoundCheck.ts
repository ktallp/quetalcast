import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type SoundCheckPhase = 'idle' | 'noise' | 'speech' | 'done';

export interface SoundCheckResult {
  noiseDb: number;
  speechDb: number;
}

export interface UseSoundCheckReturn {
  phase: SoundCheckPhase;
  start: () => void;
  cancel: () => void;
  result: SoundCheckResult | null;
  secondsLeft: number;
}

const NOISE_PHASE_SECONDS = 3;
const SPEECH_PHASE_SECONDS = 6;
const SAMPLE_INTERVAL_MS = 100;
const MIN_DB = -100;

/** RMS of a time-domain buffer, in dBFS (clamped to MIN_DB) */
function rmsDb(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  const rms = Math.sqrt(sum / data.length);
  if (rms <= 0) return MIN_DB;
  return Math.max(MIN_DB, 20 * Math.log10(rms));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Calibration helper ─────────────────────────────────────────────

/**
 * Map a sound-check measurement to effect parameter suggestions. Pure math:
 * nothing here touches audio. The UI decides whether to apply the values via
 * updateEffect.
 */
export function calibrationFromMeasurement(r: { noiseDb: number; speechDb: number }): {
  enhance: { gate: number };
  compressor: { amount: number; makeup: number };
} {
  // Gate: put the threshold ~8 dB above the measured noise floor so the gate
  // stays closed on room noise but opens for speech.
  // useMicEffects maps gate 0-100 to thresholdDb = -80 + (gate / 100) * 60,
  // so the inverse is gate = (thresholdDb + 80) / 60 * 100.
  const gateThresholdDb = r.noiseDb + 8;
  const gate = clamp(Math.round(((gateThresholdDb + 80) / 60) * 100), 0, 100);

  // Compressor: put the threshold ~10 dB below the measured speech level so
  // normal speech gets a few dB of smoothing without being crushed.
  // useMicEffects maps amount 0-100 to threshold = -(amount / 100) * 50,
  // so the inverse is amount = -thresholdDb / 50 * 100.
  const compThresholdDb = r.speechDb - 10;
  const amount = clamp(Math.round((-compThresholdDb / 50) * 100), 0, 100);

  // Makeup: push the voice level toward -18 dBFS average.
  // useMicEffects maps makeup 0-100 to 0 to +24 dB of gain, so the inverse is
  // makeup = neededDb / 24 * 100. Clamped to 60 (about +14 dB) so a very
  // quiet measurement cannot dial in runaway gain.
  const neededDb = -18 - r.speechDb;
  const makeup = clamp(Math.round((neededDb / 24) * 100), 0, 60);

  return { enhance: { gate }, compressor: { amount, makeup } };
}

// ── Hook ───────────────────────────────────────────────────────────

/**
 * Two-stage mic measurement: 3s of silence (noise floor, average RMS), then
 * 6s of speech (95th percentile RMS). Pure measurement: it applies nothing.
 * The UI reads `result` (typically through calibrationFromMeasurement) and
 * decides what to do with it.
 */
export function useSoundCheck(opts: { getAnalyserData: () => Float32Array | null }): UseSoundCheckReturn {
  const [phase, setPhase] = useState<SoundCheckPhase>('idle');
  const [result, setResult] = useState<SoundCheckResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const intervalRef = useRef<number | null>(null);
  const phaseRef = useRef<SoundCheckPhase>('idle');
  const phaseEndRef = useRef(0);
  const samplesRef = useRef<number[]>([]);
  const noiseDbRef = useRef(MIN_DB);

  // Keep the latest accessor without retriggering callbacks
  const getDataRef = useRef(opts.getAnalyserData);
  getDataRef.current = opts.getAnalyserData;

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    stopTimer();
    phaseRef.current = 'idle';
    samplesRef.current = [];
    setPhase('idle');
    setSecondsLeft(0);
  }, [stopTimer]);

  const tick = useCallback(() => {
    const now = Date.now();

    const data = getDataRef.current();
    if (data && data.length > 0) {
      samplesRef.current.push(rmsDb(data));
    }

    setSecondsLeft(Math.max(0, Math.ceil((phaseEndRef.current - now) / 1000)));
    if (now < phaseEndRef.current) return;

    if (phaseRef.current === 'noise') {
      // Noise floor: average of the RMS dB readings
      const samples = samplesRef.current;
      noiseDbRef.current = samples.length > 0
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : MIN_DB;

      samplesRef.current = [];
      phaseRef.current = 'speech';
      phaseEndRef.current = now + SPEECH_PHASE_SECONDS * 1000;
      setPhase('speech');
      setSecondsLeft(SPEECH_PHASE_SECONDS);
    } else if (phaseRef.current === 'speech') {
      // Speech level: 95th percentile of the RMS dB readings, which tracks
      // the louder stretches of speech while ignoring pauses and brief peaks
      const sorted = [...samplesRef.current].sort((a, b) => a - b);
      const speechDb = sorted.length > 0
        ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]
        : MIN_DB;

      stopTimer();
      samplesRef.current = [];
      phaseRef.current = 'done';
      setResult({ noiseDb: noiseDbRef.current, speechDb });
      setPhase('done');
      setSecondsLeft(0);
    }
  }, [stopTimer]);

  const start = useCallback(() => {
    stopTimer();
    samplesRef.current = [];
    setResult(null);
    phaseRef.current = 'noise';
    phaseEndRef.current = Date.now() + NOISE_PHASE_SECONDS * 1000;
    setPhase('noise');
    setSecondsLeft(NOISE_PHASE_SECONDS);
    intervalRef.current = window.setInterval(tick, SAMPLE_INTERVAL_MS);
  }, [stopTimer, tick]);

  // Stop measuring if the component unmounts mid-run
  useEffect(() => stopTimer, [stopTimer]);

  return { phase, start, cancel, result, secondsLeft };
}
