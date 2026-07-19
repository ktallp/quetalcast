import { type EffectName, type EffectState, DEFAULT_PARAMS } from '@/hooks/useMicEffects';

// ── Types ──────────────────────────────────────────────────────────

export interface Preset {
  name: string;
  builtIn: boolean;
  effects: Record<EffectName, EffectState>;
}

// ── localStorage key ───────────────────────────────────────────────

const STORAGE_KEY = 'quetalcast-presets';

// ── Built-in presets ───────────────────────────────────────────────

function off(name: EffectName): EffectState {
  return { enabled: false, params: { ...DEFAULT_PARAMS[name] } };
}

function on(name: EffectName, overrides?: Record<string, number>): EffectState {
  return { enabled: true, params: { ...DEFAULT_PARAMS[name], ...overrides } };
}

const BUILT_IN_PRESETS: Preset[] = [
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

// ── Functions ──────────────────────────────────────────────────────

/** Migrate old presets that have mixer fields — strip them to effects-only */
function migratePreset(p: Preset & { micVolume?: number; limiterDb?: number; qualityMode?: string }): Preset {
  return { name: p.name, builtIn: p.builtIn, effects: p.effects };
}

function loadUserPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as (Preset & { micVolume?: number; limiterDb?: number; qualityMode?: string })[];
    return parsed.map(migratePreset);
  } catch {
    return [];
  }
}

function saveUserPresets(presets: Preset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

/** Returns all presets: built-in first, then user-created */
export function getPresets(): Preset[] {
  return [...BUILT_IN_PRESETS, ...loadUserPresets()];
}

/** Save a new user preset (or overwrite existing by name) — effects only */
export function savePreset(name: string, config: Omit<Preset, 'name' | 'builtIn'>): void {
  const userPresets = loadUserPresets().filter((p) => p.name !== name);
  userPresets.push({ ...config, name, builtIn: false });
  saveUserPresets(userPresets);
}

/** Delete a user preset by name (built-in presets cannot be deleted) */
export function deletePreset(name: string): void {
  const userPresets = loadUserPresets().filter((p) => p.name !== name);
  saveUserPresets(userPresets);
}
