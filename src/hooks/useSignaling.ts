import { useEffect, useRef, useState, useCallback } from 'react';
import { dbg, dbgWarn } from '@/lib/debug';

export interface SignalingMessage {
  type: string;
  [key: string]: unknown;
}

/** Server close code: this session was replaced by a newer one from the same account */
export const WS_CLOSE_REPLACED = 4002;
/** Client close code: no pong within the deadline, the socket is treated as dead */
export const WS_CLOSE_HEARTBEAT = 4000;

// A socket can die silently (tether hop, NAT timeout, laptop lid) and the
// browser will keep queueing into it for minutes. The heartbeat notices
// within HEARTBEAT_TIMEOUT_MS and reconnects; the app-level round trip it
// yields is also what the Stats panel shows as Server RTT.
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 15000;

export interface UseSignalingReturn {
  connected: boolean;
  /** The server closed this socket because the same user resumed the room elsewhere */
  replaced: boolean;
  /** Application-level round trip to the server, ms (null until measured) */
  rtt: number | null;
  /**
   * Split of the round trip into console-to-server and server-to-console, ms.
   * Estimated against the clock offset seen on the fastest ping so far, so
   * it is only meaningful relative to that best sample; it exists to show
   * which direction is congested when rtt climbs.
   */
  uplinkMs: number | null;
  downlinkMs: number | null;
  /** Bytes queued in the socket that have not left the browser yet */
  getBufferedAmount: () => number;
  send: (msg: SignalingMessage) => void;
  sendBinary: (data: ArrayBuffer | Uint8Array) => void;
  lastMessage: SignalingMessage | null;
  subscribe: (handler: (msg: SignalingMessage) => void) => () => void;
  connect: () => void;
  disconnect: () => void;
}

export function useSignaling(url: string): UseSignalingReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<(msg: SignalingMessage) => void>>(new Set());
  const [connected, setConnected] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [rtt, setRtt] = useState<number | null>(null);
  const [uplinkMs, setUplinkMs] = useState<number | null>(null);
  const [downlinkMs, setDownlinkMs] = useState<number | null>(null);
  /** Best (lowest-rtt) estimate of server clock minus our clock */
  const clockOffsetRef = useRef<{ offset: number; rtt: number } | null>(null);
  const [lastMessage, setLastMessage] = useState<SignalingMessage | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval>>();
  const lastPongAtRef = useRef(0);

  const stopHeartbeat = () => {
    if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = undefined; }
  };

  // Auto-reconnect state
  const shouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelayRef = useRef(1000); // starts at 1s, backs off

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Clear any pending reconnect
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    shouldReconnectRef.current = true;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        dbg('[WS] Connected');
        setConnected(true);
        reconnectDelayRef.current = 1000; // reset backoff on success
        setRtt(null);
        setUplinkMs(null);
        setDownlinkMs(null);
        clockOffsetRef.current = null;
        lastPongAtRef.current = Date.now();
        stopHeartbeat();
        heartbeatTimerRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastPongAtRef.current > HEARTBEAT_TIMEOUT_MS) {
            dbgWarn(`[WS] No pong for ${HEARTBEAT_TIMEOUT_MS}ms (${ws.bufferedAmount} bytes queued); closing as dead`);
            stopHeartbeat();
            try { ws.close(WS_CLOSE_HEARTBEAT, 'heartbeat timeout'); } catch { /* already closing */ }
            return;
          }
          try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch { /* closing */ }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onclose = (event) => {
        dbg(`[WS] Closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        stopHeartbeat();
        setConnected(false);
        setRtt(null);
        if (event.code === WS_CLOSE_REPLACED) {
          // Another session of ours took the room; reconnecting would only fight it
          shouldReconnectRef.current = false;
          setReplaced(true);
          return;
        }
        // Auto-reconnect with exponential backoff
        if (shouldReconnectRef.current) {
          const delay = reconnectDelayRef.current;
          reconnectDelayRef.current = Math.min(delay * 2, 15000); // max 15s
          dbg(`[WS] Reconnecting in ${delay}ms...`);
          reconnectTimerRef.current = setTimeout(() => {
            if (shouldReconnectRef.current) connect();
          }, delay);
        }
      };

      ws.onerror = (event) => {
        dbgWarn('[WS] Error:', event);
        // onclose will fire after onerror, which handles reconnect
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage;
          if (msg.type === 'pong') {
            const now = Date.now();
            lastPongAtRef.current = now;
            if (typeof msg.t === 'number') {
              const sample = Math.max(0, now - msg.t);
              setRtt(sample);
              if (typeof msg.s === 'number') {
                // offset = server clock - our clock, best estimated on the fastest ping
                const offset = msg.s - (msg.t + sample / 2);
                const best = clockOffsetRef.current;
                if (!best || sample < best.rtt) clockOffsetRef.current = { offset, rtt: sample };
                const ref = clockOffsetRef.current!;
                const up = Math.max(0, Math.min(sample, msg.s - msg.t - ref.offset));
                setUplinkMs(up);
                setDownlinkMs(Math.max(0, sample - up));
              }
            }
          }
          setLastMessage(msg);
          handlersRef.current.forEach((h) => h(msg));
        } catch {
          // ignore malformed messages
        }
      };
    } catch {
      setConnected(false);
    }
  }, [url]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    stopHeartbeat();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const send = useCallback((msg: SignalingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const getBufferedAmount = useCallback(() => wsRef.current?.bufferedAmount ?? 0, []);

  const sendBinary = useCallback((data: ArrayBuffer | Uint8Array) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const subscribe = useCallback((handler: (msg: SignalingMessage) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      stopHeartbeat();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { connected, replaced, rtt, uplinkMs, downlinkMs, getBufferedAmount, send, sendBinary, lastMessage, subscribe, connect, disconnect };
}
