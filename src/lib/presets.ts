import { type EffectName, type EffectState, DEFAULT_PARAMS } from '@/hooks/useMicEffects';

// ── Types ──────────────────────────────────────────────────────────

export interface Preset {
  name: string;
  builtIn: boolean;
  effects: Record<EffectName, EffectState>;
}

// Legacy localStorage key (pre-0.6.2, when presets were per-browser).
// Existing presets are migrated to the signed-in user's account once.
const LEGACY_STORAGE_KEY = 'quetalcast-presets';

// ── Built-in presets ───────────────────────────────────────────────

function off(name: EffectName): EffectState {
  return { enabled: false, params: { ...DEFAULT_PARAMS[name] } };
}

function on(name: EffectName, overrides?: Record<string, number>): EffectState {
  return { enabled: true, params: { ...DEFAULT_PARAMS[name], ...overrides } };
}

export const BUILT_IN_PRESETS: Preset[] = [
  {
    name: 'Podcast Voice',
    builtIn: true,
    effects: {
      enhance: on('enhance', { gate: 40, cleanup: 50, clarity: 30 }),
      tone: off('tone'),
      compressor: on('compressor', { amount: 60, speed: 40, makeup: 20 }),
      deEsser: on('deEsser', { amount: 40 }),
      voiceShift: off('voiceShift'),
      delay: off('delay'),
      echo: off('echo'),
    },
  },
  {
    name: 'DJ Mode',
    builtIn: true,
    effects: {
      enhance: off('enhance'),
      tone: on('tone', { bass: 30, mids: 10, treble: 20 }),
      compressor: on('compressor', { amount: 70, speed: 60, makeup: 10 }),
      deEsser: off('deEsser'),
      voiceShift: off('voiceShift'),
      delay: off('delay'),
      echo: off('echo'),
    },
  },
  {
    name: 'Lo-Fi',
    builtIn: true,
    effects: {
      enhance: off('enhance'),
      tone: on('tone', { bass: 40, mids: -20, treble: -30 }),
      compressor: off('compressor'),
      deEsser: off('deEsser'),
      voiceShift: on('voiceShift', { shift: 35 }),
      delay: off('delay'),
      echo: on('echo', { space: 60, fade: 40, amount: 40 }),
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────

/** Strip legacy mixer fields so only name/effects survive */
export function sanitizeStoredPreset(p: { name?: unknown; effects?: unknown }): Omit<Preset, 'builtIn'> | null {
  if (!p || typeof p.name !== 'string' || !p.name || !p.effects || typeof p.effects !== 'object') return null;
  return { name: p.name, effects: p.effects as Record<EffectName, EffectState> };
}

/** One-time migration: push presets saved in this browser to the user's account */
async function migrateLegacyPresets(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const preset = sanitizeStoredPreset(item);
        if (!preset) continue;
        await fetch(`/api/presets/${encodeURIComponent(preset.name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ effects: preset.effects }),
        });
      }
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Leave the legacy data in place; migration retries next load
  }
}

// ── Server-backed API ──────────────────────────────────────────────

/** Returns all presets: built-ins first, then the signed-in user's own */
export async function getPresets(): Promise<Preset[]> {
  await migrateLegacyPresets();
  try {
    const res = await fetch('/api/presets', { credentials: 'include' });
    if (!res.ok) return [...BUILT_IN_PRESETS];
    const data = await res.json();
    const userPresets: Preset[] = (Array.isArray(data.presets) ? data.presets : [])
      .map((p: { name?: unknown; effects?: unknown }) => sanitizeStoredPreset(p))
      .filter(Boolean)
      .map((p: Omit<Preset, 'builtIn'>) => ({ ...p, builtIn: false }));
    return [...BUILT_IN_PRESETS, ...userPresets];
  } catch {
    return [...BUILT_IN_PRESETS];
  }
}

/** Save (or overwrite) a preset on the signed-in user's account */
export async function savePreset(name: string, config: Omit<Preset, 'name' | 'builtIn'>): Promise<boolean> {
  try {
    const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ effects: config.effects }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete one of the signed-in user's presets (built-ins cannot be deleted) */
export async function deletePreset(name: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}
