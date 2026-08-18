import { useCallback, useRef, useState } from 'react';
import type { SignalingMessage, UseSignalingReturn } from './useSignaling';

export interface UseRelayStreamReturn {
  active: boolean;
  error: string | null;
  streamUrl: string | null;
  /** Bytes handed to the WebSocket over the last second, as kbps (0 when inactive) */
  uploadKbps: number;
  startRelay: (stream: MediaStream, roomId: string) => Promise<void>;
  stopRelay: () => void;
}

/**
 * Records the broadcast audio using MediaRecorder (WebM/Opus) and sends
 * chunks over the signaling WebSocket as binary frames. The server
 * transcodes WebM→MP3 via FFmpeg and serves an Icecast-compatible stream
 * at /stream/:roomId for VLC, RadioDJ, internet-radio.com, etc.
 *
 * MediaRecorder is used instead of ScriptProcessorNode/AudioWorklet
 * because those AudioNode-based approaches silently fail to capture
 * output from createMediaStreamDestination (the mixer's output).
 */
export function useRelayStream(signaling: UseSignalingReturn): UseRelayStreamReturn {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const [uploadKbps, setUploadKbps] = useState(0);
  const bytesRef = useRef(0);
  const rateTimerRef = useRef<ReturnType<typeof setInterval>>();

  const stopRelay = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (rateTimerRef.current) { clearInterval(rateTimerRef.current); rateTimerRef.current = undefined; }
    bytesRef.current = 0;
    setUploadKbps(0);
    setActive(false);
    setStreamUrl(null);
  }, []);

  const startRelay = useCallback(async (stream: MediaStream, roomId: string) => {
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

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      recorderRef.current = recorder;

      const sendBin = signaling.sendBinary;

      recorder.ondataavailable = (e: BlobEvent) => {
        // A stopped recorder still flushes a final chunk; a header-less
        // chunk from an old recorder must never reach the server ahead of
        // the new recorder's WebM header.
        if (recorderRef.current !== recorder) return;
        if (e.data.size > 0) {
          e.data.arrayBuffer().then((buf) => {
            if (recorderRef.current === recorder) {
              sendBin(new Uint8Array(buf));
              bytesRef.current += buf.byteLength;
            }
          });
        }
      };

      recorder.onerror = () => {
        setError('MediaRecorder error');
        stopRelay();
      };

      recorder.start(250);
      if (rateTimerRef.current) clearInterval(rateTimerRef.current);
      rateTimerRef.current = setInterval(() => {
        setUploadKbps((bytesRef.current * 8) / 1000);
        bytesRef.current = 0;
      }, 1000);
      setActive(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Relay failed: ${msg}`);
      stopRelay();
    }
  }, [stopRelay, signaling]);

  return { active, error, streamUrl, uploadKbps, startRelay, stopRelay };
}
