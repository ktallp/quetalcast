import { describe, it, expect, beforeEach } from 'vitest';
import { getPresets, savePreset, deletePreset, type Preset } from '@/lib/presets';

const STORAGE_KEY = 'quetalcast-presets';

function makeEffects(): Preset['effects'] {
  const presets = getPresets();
  // Clone the first built-in's effects as a valid effects payload
  return JSON.parse(JSON.stringify(presets[0].effects));
}

describe('presets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getPresets', () => {
    it('returns the 3 built-in presets first', () => {
      const presets = getPresets();
      expect(presets.length).toBe(3);
      expect(presets.map((p) => p.name)).toEqual(['Podcast Voice', 'DJ Mode', 'Lo-Fi']);
      expect(presets.every((p) => p.builtIn)).toBe(true);
    });

    it('keeps built-ins first when user presets exist', () => {
      savePreset('My Preset', { effects: makeEffects() });
      const presets = getPresets();
      expect(presets.length).toBe(4);
      expect(presets.slice(0, 3).every((p) => p.builtIn)).toBe(true);
      expect(presets[3].name).toBe('My Preset');
      expect(presets[3].builtIn).toBe(false);
    });

    it('built-in presets all include a deEsser entry', () => {
      for (const preset of getPresets()) {
        expect(preset.effects.deEsser).toBeDefined();
        expect(preset.effects.deEsser).toHaveProperty('enabled');
        expect(preset.effects.deEsser).toHaveProperty('params');
      }
    });

    it('Podcast Voice enables the deEsser', () => {
      const podcast = getPresets().find((p) => p.name === 'Podcast Voice')!;
      expect(podcast.effects.deEsser.enabled).toBe(true);
      expect(podcast.effects.deEsser.params.amount).toBe(40);
    });

    it('returns only built-ins when stored JSON is corrupt', () => {
      localStorage.setItem(STORAGE_KEY, 'not json{{');
      const presets = getPresets();
      expect(presets.length).toBe(3);
    });
  });

  describe('savePreset / deletePreset', () => {
    it('round-trips a user preset through localStorage', () => {
      const effects = makeEffects();
      savePreset('Round Trip', { effects });

      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).toBeTruthy();

      const presets = getPresets();
      const saved = presets.find((p) => p.name === 'Round Trip');
      expect(saved).toBeDefined();
      expect(saved!.builtIn).toBe(false);
      expect(saved!.effects).toEqual(effects);
    });

    it('overwrites an existing user preset with the same name', () => {
      const effectsA = makeEffects();
      const effectsB = makeEffects();
      effectsB.deEsser.enabled = !effectsB.deEsser.enabled;

      savePreset('Dup', { effects: effectsA });
      savePreset('Dup', { effects: effectsB });

      const matches = getPresets().filter((p) => p.name === 'Dup');
      expect(matches.length).toBe(1);
      expect(matches[0].effects.deEsser.enabled).toBe(effectsB.deEsser.enabled);
    });

    it('deletePreset removes a user preset', () => {
      savePreset('Doomed', { effects: makeEffects() });
      expect(getPresets().some((p) => p.name === 'Doomed')).toBe(true);
      deletePreset('Doomed');
      expect(getPresets().some((p) => p.name === 'Doomed')).toBe(false);
      expect(getPresets().length).toBe(3);
    });

    it('deletePreset of an unknown name leaves other presets intact', () => {
      savePreset('Keeper', { effects: makeEffects() });
      deletePreset('Nonexistent');
      expect(getPresets().some((p) => p.name === 'Keeper')).toBe(true);
    });
  });

  describe('migration of legacy mixer fields', () => {
    it('strips legacy micVolume/limiterDb/qualityMode keys on load', () => {
      const legacy = [
        {
          name: 'Legacy',
          builtIn: false,
          effects: makeEffects(),
          micVolume: 80,
          limiterDb: -6,
          qualityMode: 'high',
        },
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

      const loaded = getPresets().find((p) => p.name === 'Legacy')!;
      expect(loaded).toBeDefined();
      expect(loaded).not.toHaveProperty('micVolume');
      expect(loaded).not.toHaveProperty('limiterDb');
      expect(loaded).not.toHaveProperty('qualityMode');
      expect(Object.keys(loaded).sort()).toEqual(['builtIn', 'effects', 'name']);
    });
  });
});
