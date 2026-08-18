import { useCallback, useEffect, useRef, useState } from 'react';
import type { SignalingMessage, UseSignalingReturn } from './useSignaling';
import { dbg, dbgWarn } from '@/lib/debug';

export type RelayUploadState = 'idle' | 'streaming' | 'catching-up';

export interface RelayUploadEvent {
  type: 'paused' | 'resumed' | 'bitrate';
  /** paused: seconds of audio that were queued; resumed: seconds the pause lasted */
  seconds?: number;
  /** bitrate: the new relay bitrate in kbps */
  kbps?: number;
}

export interface UseRelayStreamReturn {
  active: boolean;
  error: string | null;
  streamUrl: string | null;
  /** Bytes that actually left the browser over the last second, as kbps (0 when inactive) */
  uploadKbps: number;
  /** Seconds of relay audio queued in the socket that have not left the browser yet */
  backlogSeconds: number;
  /** Relay bitrate currently in use, kbps */
  relayKbps: number;
  uploadState: RelayUploadState;
  /** Register for backlog events (pause, resume, bitrate change); returns an unsubscribe */
  onUploadEvent: (handler: (e: RelayUploadEvent) => void) => () => void;
  startRelay: (stream: MediaStream, roomId: string) => Promise<void>;
  stopRelay: () => void;
}

/** Bitrates the relay recorder steps through when the socket cannot keep up */
const RELAY_BITRATES_KBPS = [128, 96, 64, 48];
/** Queued audio beyond this means the socket is not draining: stop feeding it */
const BACKLOG_PAUSE_SECONDS = 3;
/** Resume once the queue is down to this */
const BACKLOG_RESUME_SECONDS = 0.5;
/**
 * bufferedAmount only counts what the browser has not yet handed to the
 * network layer; the OS socket buffers below it can hold many seconds of
 * relay audio without it showing. The heartbeat round trip sees all of it
 * (the ping waits behind every queued byte), so it is the primary signal.
 */
const RTT_PAUSE_MS = 3000;
const RTT_RESUME_MS = 1000;
/** Two pauses within this window step the bitrate down a notch */
const STEP_DOWN_WINDOW_MS = 120_000;
/** This long without a pause steps the bitrate back up a notch */
const STEP_UP_AFTER_MS = 300_000;
const MONITOR_INTERVAL_MS = 250;
const RECORDER_TIMESLICE_MS = 250;

/**
 * Records the broadcast audio using MediaRecorder (WebM/Opus) and sends
 * chunks over the signaling WebSocket as binary frames. The server
 * transcodes WebM→MP3 via FFmpeg and serves an Icecast-compatible stream
 * at /stream/:roomId for VLC, RadioDJ, internet-radio.com, etc.
 *
 * MediaRecorder is used instead of ScriptProcessorNode/AudioWorklet
 * because those AudioNode-based approaches silently fail to capture
 * output from createMediaStreamDestination (the mixer's output).
 *
 * The socket is TCP: when the uplink cannot carry the relay, nothing is
 * lost, it queues in the browser, and left alone that queue grows without
 * bound (tens of seconds behind, and every message behind it, including
 * signaling, arrives that late). So the hook watches the socket's real
 * backlog: past BACKLOG_PAUSE_SECONDS it stops the recorder (the server
 * fills the gap with silence and drops what arrives stale), waits for the
 * queue to drain, and starts a fresh recorder, a notch lower in bitrate if
 * this keeps happening. A new recorder always begins with a WebM header,
 * which the server treats as a resync.
 */
export function useRelayStream(signaling: UseSignalingReturn): UseRelayStreamReturn {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [uploadKbps, setUploadKbps] = useState(0);
  const [backlogSeconds, setBacklogSeconds] = useState(0);
  const [relayKbps, setRelayKbps] = useState(RELAY_BITRATES_KBPS[0]);
  const [uploadState, setUploadState] = useState<RelayUploadState>('idle');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bitrateIdxRef = useRef(0);
  const monitorRef = useRef<ReturnType<typeof setInterval>>();
  const handlersRef = useRef<Set<(e: RelayUploadEvent) => void>>(new Set());

  // Upload accounting: bytes handed to the socket vs. bytes still queued
  const producedRef = useRef(0);          // bytes handed to the socket since start
  const lastProducedRef = useRef(0);
  const lastBufferedRef = useRef(0);
  const lastRateAtRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const lastPauseAtRef = useRef(0);
  const lastStepAtRef = useRef(0);

  const emitEvent = (e: RelayUploadEvent) => handlersRef.current.forEach((h) => h(e));

  const onUploadEvent = useCallback((handler: (e: RelayUploadEvent) => void) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  /** Start (or restart) the recorder on the current stream at the current bitrate */
  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* already stopped */ }
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const kbps = RELAY_BITRATES_KBPS[bitrateIdxRef.current];
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: kbps * 1000 });
    recorderRef.current = recorder;
    const sendBin = signaling.sendBinary;

    recorder.ondataavailable = (e: BlobEvent) => {
      // A stopped recorder still flushes a final chunk; a header-less chunk
      // from an old recorder must never reach the server ahead of the new
      // recorder's WebM header.
      if (recorderRef.current !== recorder) return;
      if (e.data.size > 0) {
        e.data.arrayBuffer().then((buf) => {
          if (recorderRef.current === recorder) {
            sendBin(new Uint8Array(buf));
            producedRef.current += buf.byteLength;
          }
        });
      }
    };
    recorder.onerror = () => {
      setError('MediaRecorder error');
      dbgWarn('[Relay] MediaRecorder error');
    };
    recorder.start(RECORDER_TIMESLICE_MS);
    setRelayKbps(kbps);
    setUploadState('streaming');
    dbg(`[Relay] Recorder started at ${kbps} kbps`);
  }, [signaling.sendBinary]);

  /** Every MONITOR_INTERVAL_MS: measure the real upload rate and police the backlog */
  const monitor = useCallback(() => {
    const now = Date.now();
    const buffered = signaling.getBufferedAmount();
    const bytesPerSecond = (RELAY_BITRATES_KBPS[bitrateIdxRef.current] * 1000) / 8;
    // Visible queue plus what the round trip says is queued below it
    const rttSeconds = signaling.rtt === null ? 0 : signaling.rtt / 1000;
    const backlog = Math.max(buffered / bytesPerSecond, rttSeconds);
    setBacklogSeconds(backlog);

    // Drained rate = handed to the socket minus growth of the queue
    if (now - lastRateAtRef.current >= 1000) {
      const dt = (now - lastRateAtRef.current) / 1000;
      const produced = producedRef.current - lastProducedRef.current;
      const queued = buffered - lastBufferedRef.current;
      const drained = Math.max(0, produced - queued);
      setUploadKbps(dt > 0 ? (drained * 8) / dt / 1000 : 0);
      lastRateAtRef.current = now;
      lastProducedRef.current = producedRef.current;
      lastBufferedRef.current = buffered;
    }

    if (pausedAtRef.current === null) {
      const congested = buffered / bytesPerSecond > BACKLOG_PAUSE_SECONDS || (signaling.rtt !== null && signaling.rtt > RTT_PAUSE_MS);
      if (congested && recorderRef.current) {
        // The socket is not keeping up. Stop producing; the server fills
        // the gap with silence and drops whatever of this backlog arrives stale.
        pausedAtRef.current = now;
        const sinceLastPause = now - lastPauseAtRef.current;
        lastPauseAtRef.current = now;
        try { recorderRef.current.stop(); } catch { /* already stopped */ }
        recorderRef.current = null;
        setUploadState('catching-up');
        dbgWarn(`[Relay] Upload backlog ${backlog.toFixed(1)}s; pausing relay audio until the socket drains`);
        emitEvent({ type: 'paused', seconds: backlog });
        if (sinceLastPause < STEP_DOWN_WINDOW_MS && bitrateIdxRef.current < RELAY_BITRATES_KBPS.length - 1) {
          bitrateIdxRef.current++;
          lastStepAtRef.current = now;
          emitEvent({ type: 'bitrate', kbps: RELAY_BITRATES_KBPS[bitrateIdxRef.current] });
        }
      } else if (
        bitrateIdxRef.current > 0 &&
        now - lastPauseAtRef.current > STEP_UP_AFTER_MS &&
        now - lastStepAtRef.current > STEP_UP_AFTER_MS &&
        backlog < BACKLOG_RESUME_SECONDS &&
        recorderRef.current
      ) {
        // Clean for a while: try a notch higher (fresh recorder, fresh header)
        bitrateIdxRef.current--;
        lastStepAtRef.current = now;
        emitEvent({ type: 'bitrate', kbps: RELAY_BITRATES_KBPS[bitrateIdxRef.current] });
        startRecorder();
      }
      return;
    }

    // Paused: wait for the queue to drain (visible queue empty and the round
    // trip back to normal), then start a fresh recorder
    const drained = buffered / bytesPerSecond <= BACKLOG_RESUME_SECONDS && (signaling.rtt === null || signaling.rtt < RTT_RESUME_MS);
    if (drained && signaling.connected) {
      const pausedFor = (now - pausedAtRef.current) / 1000;
      pausedAtRef.current = null;
      dbg(`[Relay] Socket drained after ${pausedFor.toFixed(1)}s; restarting relay audio`);
      emitEvent({ type: 'resumed', seconds: pausedFor });
      startRecorder();
    }
  }, [signaling, startRecorder]);

  const stopRelay = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* already stopped */ }
    }
    recorderRef.current = null;
    streamRef.current = null;
    if (monitorRef.current) { clearInterval(monitorRef.current); monitorRef.current = undefined; }
    pausedAtRef.current = null;
    producedRef.current = 0;
    lastProducedRef.current = 0;
    lastBufferedRef.current = 0;
    setUploadKbps(0);
    setBacklogSeconds(0);
    setUploadState('idle');
    setActive(false);
    setStreamUrl(null);
  }, []);

  // roomId is accepted for symmetry with the integration stream; the server
  // already knows which room this socket belongs to
  const startRelay = useCallback(async (stream: MediaStream, _roomId: string) => {
    setError(null);
    try {
      if (!signaling.connected) {
        setError('Signaling not connected');
        return;
      }

      // Ask the server to set up the /stream/:roomId endpoint
      signaling.send({ type: 'start-relay' });

      // Wait for the server's ack with the stream URL
      const ack = await new Promise<{ ok: boolean; url?: string; error?: string }>((resolve) => {
        const unsub = signaling.subscribe((msg: SignalingMessage) => {
          if (msg.type === 'relay-started') {
            unsub();
            resolve({ ok: true, url: msg.url as string | undefined });
          } else if (msg.type === 'error' && typeof msg.message === 'string' && msg.message.includes('relay')) {
            unsub();
            resolve({ ok: false, error: msg.message as string });
          }
        });
        setTimeout(() => {
          unsub();
          resolve({ ok: false, error: 'Relay start timeout' });
        }, 10000);
      });

      if (!ack.ok) {
        setError(ack.error || 'Relay stream failed');
        return;
      }

      if (ack.url) setStreamUrl(ack.url);

      streamRef.current = stream;
      pausedAtRef.current = null;
      producedRef.current = 0;
      lastProducedRef.current = 0;
      lastBufferedRef.current = signaling.getBufferedAmount();
      lastRateAtRef.current = Date.now();
      startRecorder();
      setActive(true); // the monitor interval follows `active`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Relay failed: ${msg}`);
      stopRelay();
    }
  }, [stopRelay, signaling, startRecorder]);

  // Keep the monitor's closure current without restarting the interval
  const monitorFnRef = useRef(monitor);
  useEffect(() => { monitorFnRef.current = monitor; }, [monitor]);
  useEffect(() => {
    if (!active) return;
    if (monitorRef.current) clearInterval(monitorRef.current);
    monitorRef.current = setInterval(() => monitorFnRef.current(), MONITOR_INTERVAL_MS);
    return () => { if (monitorRef.current) { clearInterval(monitorRef.current); monitorRef.current = undefined; } };
  }, [active]);

  return { active, error, streamUrl, uploadKbps, backlogSeconds, relayKbps, uploadState, onUploadEvent, startRelay, stopRelay };
}
