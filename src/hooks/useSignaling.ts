import { useEffect, useRef, useState, useCallback } from 'react';
import { dbg, dbgWarn } from '@/lib/debug';

export interface SignalingMessage {
  type: string;
  [key: string]: unknown;
}

/** Server close code: this session was replaced by a newer one from the same account */
export const WS_CLOSE_REPLACED = 4002;

export interface UseSignalingReturn {
  connected: boolean;
  /** The server closed this socket because the same user resumed the room elsewhere */
  replaced: boolean;
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
  const [lastMessage, setLastMessage] = useState<SignalingMessage | null>(null);

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
      };

      ws.onclose = (event) => {
        dbg(`[WS] Closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        setConnected(false);
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
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { connected, replaced, send, sendBinary, lastMessage, subscribe, connect, disconnect };
}
