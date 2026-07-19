import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BUILT_IN_PRESETS,
  getPresets,
  savePreset,
  deletePreset,
  sanitizeStoredPreset,
} from '@/lib/presets';

const LEGACY_KEY = 'quetalcast-presets';

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('built-in presets', () => {
  it('ships three built-ins with deEsser entries', () => {
    expect(BUILT_IN_PRESETS.map((p) => p.name)).toEqual(['Podcast Voice', 'DJ Mode', 'Lo-Fi']);
    for (const p of BUILT_IN_PRESETS) {
      expect(p.builtIn).toBe(true);
      expect(p.effects.deEsser).toBeDefined();
    }
    expect(BUILT_IN_PRESETS[0].effects.deEsser.enabled).toBe(true);
    expect(BUILT_IN_PRESETS[0].effects.deEsser.params.amount).toBe(40);
  });
});

describe('getPresets', () => {
  it('returns built-ins first, then user presets from the server', async () => {
    mockFetch((url) => {
      if (url === '/api/presets') {
        return jsonResponse({ presets: [{ name: 'Mine', effects: { enhance: { enabled: true, params: {} } } }] });
      }
      return jsonResponse({ ok: true });
    });
    const presets = await getPresets();
    expect(presets.map((p) => p.name)).toEqual(['Podcast Voice', 'DJ Mode', 'Lo-Fi', 'Mine']);
    expect(presets[3].builtIn).toBe(false);
  });

  it('falls back to built-ins when the server is unreachable', async () => {
    mockFetch(() => {
      throw new Error('network down');
    });
    const presets = await getPresets();
    expect(presets).toHaveLength(3);
    expect(presets.every((p) => p.builtIn)).toBe(true);
  });

  it('migrates legacy localStorage presets to the server once', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        { name: 'Old One', builtIn: false, effects: { tone: { enabled: true, params: { bass: 3 } } }, micVolume: 80 },
      ]),
    );
    const puts: string[] = [];
    mockFetch((url, init) => {
      if (init?.method === 'PUT') {
        puts.push(url);
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ presets: [] });
    });
    await getPresets();
    expect(puts).toEqual(['/api/presets/Old%20One']);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    // Second call does not migrate again
    await getPresets();
    expect(puts).toHaveLength(1);
  });
});

describe('savePreset / deletePreset', () => {
  it('PUTs the effects payload and reports success', async () => {
    const fn = mockFetch(() => jsonResponse({ ok: true }));
    const ok = await savePreset('My Preset', { effects: {} as never });
    expect(ok).toBe(true);
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe('/api/presets/My%20Preset');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toHaveProperty('effects');
  });

  it('reports failure on server rejection', async () => {
    mockFetch(() => jsonResponse({ error: 'nope' }, 400));
    expect(await savePreset('x', { effects: {} as never })).toBe(false);
  });

  it('DELETEs by name and reports success', async () => {
    const fn = mockFetch(() => jsonResponse({ ok: true }));
    expect(await deletePreset('My Preset')).toBe(true);
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe('/api/presets/My%20Preset');
    expect(init?.method).toBe('DELETE');
  });
});

describe('sanitizeStoredPreset', () => {
  it('strips legacy mixer fields and rejects malformed entries', () => {
    const cleaned = sanitizeStoredPreset({
      name: 'Legacy',
      effects: { tone: { enabled: true, params: {} } },
      // @ts-expect-error legacy fields not in the type
      micVolume: 80,
      limiterDb: -3,
    });
    expect(cleaned).toEqual({ name: 'Legacy', effects: { tone: { enabled: true, params: {} } } });
    expect(sanitizeStoredPreset({ name: '', effects: {} })).toBeNull();
    expect(sanitizeStoredPreset({ name: 'x' })).toBeNull();
  });
});
