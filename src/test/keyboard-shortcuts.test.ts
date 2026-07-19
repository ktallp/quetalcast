import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts, SHORTCUT_MAP, type ShortcutHandlers } from '@/hooks/useKeyboardShortcuts';

function makeHandlers(): ShortcutHandlers {
  return {
    onToggleMute: vi.fn(),
    onToggleRecording: vi.fn(),
    onToggleListen: vi.fn(),
    onToggleCue: vi.fn(),
    onTriggerPad: vi.fn(),
    onFxDown: vi.fn(),
    onFxUp: vi.fn(),
  };
}

function keydown(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

function keyup(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, ...init }));
}

describe('useKeyboardShortcuts', () => {
  let handlers: ShortcutHandlers;

  beforeEach(() => {
    handlers = makeHandlers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it("keydown 'q' calls onFxDown('radioVoice') once even with repeat events", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(true, handlers));

    keydown('q');
    keydown('q', { repeat: true });
    keydown('q', { repeat: true });

    expect(handlers.onFxDown).toHaveBeenCalledTimes(1);
    expect(handlers.onFxDown).toHaveBeenCalledWith('radioVoice');
    unmount();
  });

  it("keyup 'q' calls onFxUp('radioVoice')", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(true, handlers));

    keydown('q');
    keyup('q');

    expect(handlers.onFxUp).toHaveBeenCalledTimes(1);
    expect(handlers.onFxUp).toHaveBeenCalledWith('radioVoice');
    unmount();
  });

  it('maps w/e/t to their FX names and uppercase keys still match', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(true, handlers));

    keydown('w');
    keydown('e');
    keydown('T'); // uppercase is lowercased by the hook

    expect(handlers.onFxDown).toHaveBeenCalledWith('bigRoom');
    expect(handlers.onFxDown).toHaveBeenCalledWith('slapback');
    expect(handlers.onFxDown).toHaveBeenCalledWith('pitchDrop');
    unmount();
  });

  it('inactive hook ignores keys', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(false, handlers));

    keydown('q');
    keyup('q');
    keydown(' ');
    keydown('r');
    keydown('1');

    expect(handlers.onFxDown).not.toHaveBeenCalled();
    expect(handlers.onFxUp).not.toHaveBeenCalled();
    expect(handlers.onToggleMute).not.toHaveBeenCalled();
    expect(handlers.onToggleRecording).not.toHaveBeenCalled();
    expect(handlers.onTriggerPad).not.toHaveBeenCalled();
    unmount();
  });

  it('ignores keys when the event target is an INPUT', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(true, handlers));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));

    expect(handlers.onFxDown).not.toHaveBeenCalled();
    expect(handlers.onFxUp).not.toHaveBeenCalled();
    expect(handlers.onToggleRecording).not.toHaveBeenCalled();
    unmount();
  });

  it('handles toggle and pad keys when active', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(true, handlers));

    keydown(' ');
    keydown('r');
    keydown('L');
    keydown('c');
    keydown('1');
    keydown('9');
    keydown('0');

    expect(handlers.onToggleMute).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleRecording).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleListen).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleCue).toHaveBeenCalledTimes(1);
    expect(handlers.onTriggerPad).toHaveBeenNthCalledWith(1, 0);
    expect(handlers.onTriggerPad).toHaveBeenNthCalledWith(2, 8);
    expect(handlers.onTriggerPad).toHaveBeenNthCalledWith(3, 9);
    unmount();
  });

  it('documents every FX hold key in the shortcut map', () => {
    const keys = SHORTCUT_MAP.map((s) => s.key);
    for (const k of ['Q', 'W', 'E', 'T']) {
      expect(keys).toContain(k);
    }
  });
});
