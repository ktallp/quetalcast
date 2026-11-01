import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useIntegrationStream } from '@/hooks/useIntegrationStream';
import type { IntegrationConfig } from '@/lib/integrations';

/**
 * Session lifecycle for the Icecast/Shoutcast integration. A session that
 * outlives its console keeps the external mount, and every later attempt is
 * refused with "Mount point in use", so these tests pin when one must end.
 */

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  });
  private listeners = new Set<(ev: { data: string }) => void>();

  constructor() {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  addEventListener(_: string, fn: (ev: { data: string }) => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_: string, fn: (ev: { data: string }) => void) {
    this.listeners.delete(fn);
  }
  receive(msg: object) {
    this.listeners.forEach((fn) => fn({ data: JSON.stringify(msg) }));
  }
}

let contexts: { close: ReturnType<typeof vi.fn> }[] = [];

class FakeAudioContext {
  state = 'running';
  destination = {};
  audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  constructor() {
    contexts.push(this);
  }
  resume = () => Promise.resolve();
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
}

class FakeWorkletNode {
  port: { onmessage: unknown } = { onmessage: null };
  connect = vi.fn();
  disconnect = vi.fn();
}

const config: IntegrationConfig = {
  integrationId: 'internet-radio',
  credentials: { host: 'h', port: '8000', mount: '/live', password: 'x' },
  rememberCredentials: false,
};
const stream = {} as MediaStream;

function lastSocket() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

/** Let the start reach the point where it is waiting for the server's ack */
async function untilAwaitingAck() {
  await act(async () => {
    for (let i = 0; i < 10 && lastSocket()?.send.mock.calls.length !== 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function start(result: { current: ReturnType<typeof useIntegrationStream> }, ack: object) {
  let started: Promise<boolean>;
  act(() => {
    started = result.current.startStream(stream, config);
  });
  await untilAwaitingAck();
  let value = false;
  await act(async () => {
    lastSocket().receive(ack);
    value = await started;
  });
  return value;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  contexts = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  (window as unknown as { lamejs: unknown }).lamejs = {
    Mp3Encoder: class {
      encodeBuffer() {
        return new Uint8Array(0);
      }
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useIntegrationStream', () => {
  it('reports success only once the pipeline is running', async () => {
    const { result } = renderHook(() => useIntegrationStream());

    expect(await start(result, { type: 'connected' })).toBe(true);

    expect(result.current.streaming).toBe(true);
    expect(result.current.relayStatus).toBe('connected');
    expect(result.current.error).toBeNull();
  });

  it('reports a refused mount as a failure, not as live', async () => {
    const { result } = renderHook(() => useIntegrationStream());

    const started = await start(result, { type: 'error', error: 'Mount point in use or forbidden' });

    expect(started).toBe(false);
    expect(result.current.streaming).toBe(false);
    expect(result.current.relayStatus).toBeNull();
    expect(result.current.error).toBe('Mount point in use or forbidden');
  });

  it('releases the session when the console unmounts', async () => {
    const { result, unmount } = renderHook(() => useIntegrationStream());
    await start(result, { type: 'connected' });
    const socket = lastSocket();

    unmount();

    expect(socket.close).toHaveBeenCalledWith(1000, 'stream-ended');
    expect(contexts[0].close).toHaveBeenCalled();
  });

  it('abandons a start when the console unmounts part way through', async () => {
    const { result, unmount } = renderHook(() => useIntegrationStream());
    let started: Promise<boolean>;
    act(() => {
      started = result.current.startStream(stream, config);
    });
    await untilAwaitingAck();
    const socket = lastSocket();

    unmount();
    socket.receive({ type: 'connected' });

    expect(await started!).toBe(false);
    expect(socket.close).toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it('closes an earlier session before starting another', async () => {
    const { result } = renderHook(() => useIntegrationStream());
    await start(result, { type: 'connected' });
    const first = lastSocket();

    expect(await start(result, { type: 'connected' })).toBe(true);

    expect(first.close).toHaveBeenCalledWith(1000, 'stream-ended');
    expect(lastSocket()).not.toBe(first);
    expect(result.current.streaming).toBe(true);
  });

  it('treats an unexpected close as a failure', async () => {
    const { result } = renderHook(() => useIntegrationStream());
    await start(result, { type: 'connected' });

    act(() => {
      lastSocket().close();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.error).toBe('Lost connection to the streaming server');
  });

  it('does not report an error when the session is stopped on purpose', async () => {
    const { result } = renderHook(() => useIntegrationStream());
    await start(result, { type: 'connected' });

    act(() => {
      result.current.stopStream();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
