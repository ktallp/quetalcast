import { useEffect, useRef, useState, useCallback } from 'react';

export interface ChannelAnalysis {
  level: number;   // dBFS RMS level (e.g. -60 to 0)
  peak: number;    // dBFS peak hold
  clipping: boolean;
}

export interface AudioAnalysis {
  left: ChannelAnalysis;
  right: ChannelAnalysis;
}

export interface UseAudioAnalyserReturn extends AudioAnalysis {
  /**
   * Raw time-domain samples (left channel) from the analyser, or null if no
   * stream is connected. Used by useSoundCheck for RMS measurement.
   */
  getAnalyserData: () => Float32Array | null;
}

const MIN_DB = -60;

/** Convert a linear amplitude (0–1) to dBFS, clamped to MIN_DB */
function toDbfs(linear: number): number {
  if (linear <= 0) return MIN_DB;
  const db = 20 * Math.log10(linear);
  return Math.max(MIN_DB, db);
}

const EMPTY_CHANNEL: ChannelAnalysis = { level: MIN_DB, peak: MIN_DB, clipping: false };
const EMPTY_ANALYSIS: AudioAnalysis = { left: { ...EMPTY_CHANNEL }, right: { ...EMPTY_CHANNEL } };

function analyseChannel(analyser: AnalyserNode, data: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(data);

  let sum = 0;
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    sum += abs * abs;
    if (abs > max) max = abs;
  }

  const rms = Math.sqrt(sum / data.length);
  return {
    rmsDb: toDbfs(rms),
    peakDb: toDbfs(max),
    clipping: max >= 0.99,
  };
}

export function useAudioAnalyser(stream: MediaStream | null): UseAudioAnalyserReturn {
  const [analysis, setAnalysis] = useState<AudioAnalysis>(EMPTY_ANALYSIS);
  const contextRef = useRef<AudioContext | null>(null);
  const leftAnalyserRef = useRef<AnalyserNode | null>(null);
  const rightAnalyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const monoHintRef = useRef(false);
  const monoMirrorRef = useRef(false);

  // Per-channel peak state
  const leftPeakRef = useRef(MIN_DB);
  const leftDecayRef = useRef(0);
  const rightPeakRef = useRef(MIN_DB);
  const rightDecayRef = useRef(0);

  const tick = useCallback(() => {
    const leftAnalyser = leftAnalyserRef.current;
    const rightAnalyser = rightAnalyserRef.current;
    if (!leftAnalyser || !rightAnalyser) return;

    const bufSize = leftAnalyser.fftSize;
    const dataL = new Float32Array(bufSize);
    const dataR = new Float32Array(bufSize);

    const left = analyseChannel(leftAnalyser, dataL);
    const right = analyseChannel(rightAnalyser, dataR);

    // Peak hold with decay — left
    if (left.peakDb > leftPeakRef.current) {
      leftPeakRef.current = left.peakDb;
      leftDecayRef.current = 0;
    } else {
      leftDecayRef.current++;
      if (leftDecayRef.current > 30) {
        leftPeakRef.current = Math.max(MIN_DB, leftPeakRef.current - 0.5);
      }
    }

    // Mono handling: only mirror when we have a mono hint *and* right channel
    // remains effectively silent. If right becomes active, immediately unmirror.
    if (monoHintRef.current) {
      const rightActive = right.rmsDb > -45 || right.peakDb > -35;
      const leftActive = left.rmsDb > -50 || left.peakDb > -40;
      monoMirrorRef.current = !rightActive && leftActive;
    } else {
      monoMirrorRef.current = false;
    }

    // Peak hold with decay — right (or mirrored left in mono mode)
    if (monoMirrorRef.current) {
      rightPeakRef.current = leftPeakRef.current;
      rightDecayRef.current = leftDecayRef.current;
    } else if (right.peakDb > rightPeakRef.current) {
      rightPeakRef.current = right.peakDb;
      rightDecayRef.current = 0;
    } else {
      rightDecayRef.current++;
      if (rightDecayRef.current > 30) {
        rightPeakRef.current = Math.max(MIN_DB, rightPeakRef.current - 0.5);
      }
    }

    setAnalysis({
      left: { level: left.rmsDb, peak: leftPeakRef.current, clipping: left.clipping },
      right: {
        level: monoMirrorRef.current ? left.rmsDb : right.rmsDb,
        peak: rightPeakRef.current,
        clipping: monoMirrorRef.current ? left.clipping : right.clipping,
      },
    });

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!stream || stream.getTracks().length === 0) {
      monoHintRef.current = false;
      monoMirrorRef.current = false;
      setAnalysis(EMPTY_ANALYSIS);
      return;
    }

    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const source = ctx.createMediaStreamSource(stream);
    const track = stream.getAudioTracks()[0];
    const channels = track?.getSettings?.().channelCount;
    // Some browsers/devices report mono channelCount for paths that still carry
    // stereo content. Treat this only as a hint; runtime activity decides mirror.
    monoHintRef.current = channels === 1;
    monoMirrorRef.current = false;

    const splitter = ctx.createChannelSplitter(2);

    const leftAnalyser = ctx.createAnalyser();
    leftAnalyser.fftSize = 2048;
    leftAnalyser.smoothingTimeConstant = 0.3;

    const rightAnalyser = ctx.createAnalyser();
    rightAnalyser.fftSize = 2048;
    rightAnalyser.smoothingTimeConstant = 0.3;

    source.connect(splitter);
    splitter.connect(leftAnalyser, 0);
    splitter.connect(rightAnalyser, 1);

    contextRef.current = ctx;
    leftAnalyserRef.current = leftAnalyser;
    rightAnalyserRef.current = rightAnalyser;

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      splitter.disconnect();
      leftAnalyser.disconnect();
      rightAnalyser.disconnect();
      ctx.close();
      contextRef.current = null;
      leftAnalyserRef.current = null;
      rightAnalyserRef.current = null;
    };
  }, [stream, tick]);

  const getAnalyserData = useCallback((): Float32Array | null => {
    const analyser = leftAnalyserRef.current;
    if (!analyser) return null;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    return data;
  }, []);

  return { ...analysis, getAnalyserData };
}
