import { useEffect, useState, useCallback } from 'react';
import type { FxName } from '@/hooks/useMicEffects';

export interface ShortcutHandlers {
  onToggleMute: () => void;
  onToggleRecording: () => void;
  onToggleListen: () => void;
  onToggleCue: () => void;
  onTriggerPad: (index: number) => void;
  /** Momentary FX: key down engages, key up releases */
  onFxDown?: (name: FxName) => void;
  onFxUp?: (name: FxName) => void;
}

interface UseKeyboardShortcutsReturn {
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
}

const FX_KEYS: Record<string, FxName> = {
  q: 'radioVoice',
  w: 'bigRoom',
  e: 'slapback',
  t: 'pitchDrop',
};

/**
 * Keyboard shortcuts for the broadcaster.
 * Only active when `active` is true. Ignores events when focus
 * is in an input, textarea, or select element.
 */
export function useKeyboardShortcuts(
  active: boolean,
  handlers: ShortcutHandlers,
): UseKeyboardShortcutsReturn {
  const [showHelp, setShowHelp] = useState(false);

  const isFormTarget = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!active) return;
      if (isFormTarget(e)) return;

      const fx = FX_KEYS[e.key.toLowerCase()];
      if (fx && handlers.onFxDown) {
        if (!e.repeat) handlers.onFxDown(fx);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handlers.onToggleMute();
          break;
        case 'r':
        case 'R':
          handlers.onToggleRecording();
          break;
        case 'l':
        case 'L':
          handlers.onToggleListen();
          break;
        case 'c':
        case 'C':
          handlers.onToggleCue();
          break;
        case '?':
          setShowHelp((prev) => !prev);
          break;
        // Number keys: 1-9 map to pads 0-8, 0 maps to pad 9
        case '1': handlers.onTriggerPad(0); break;
        case '2': handlers.onTriggerPad(1); break;
        case '3': handlers.onTriggerPad(2); break;
        case '4': handlers.onTriggerPad(3); break;
        case '5': handlers.onTriggerPad(4); break;
        case '6': handlers.onTriggerPad(5); break;
        case '7': handlers.onTriggerPad(6); break;
        case '8': handlers.onTriggerPad(7); break;
        case '9': handlers.onTriggerPad(8); break;
        case '0': handlers.onTriggerPad(9); break;
      }
    },
    [active, handlers],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!active) return;
      if (isFormTarget(e)) return;
      const fx = FX_KEYS[e.key.toLowerCase()];
      if (fx && handlers.onFxUp) {
        handlers.onFxUp(fx);
      }
    },
    [active, handlers],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return { showHelp, setShowHelp };
}

/** Map of all keyboard shortcuts for the help overlay */
export const SHORTCUT_MAP = [
  { key: 'Space', description: 'Toggle mute' },
  { key: 'R', description: 'Toggle recording' },
  { key: 'L', description: 'Toggle listen' },
  { key: 'C', description: 'Toggle cue mode' },
  { key: '1–9, 0', description: 'Trigger sound pads 1–10 (bank C: playlist tracks)' },
  { key: 'Q', description: 'Hold for Radio Voice FX' },
  { key: 'W', description: 'Hold for Big Room FX' },
  { key: 'E', description: 'Hold for Slapback FX' },
  { key: 'T', description: 'Hold for Pitch Drop FX' },
  { key: '?', description: 'Show/hide shortcuts' },
];
