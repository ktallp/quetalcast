import { useEffect, useState } from 'react';

const APPEARANCE_KEY = 'quetalcast:appearance:v1';

function readHardwareSkin(): boolean {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.hardware === true;
  } catch {
    return false;
  }
}

/**
 * The optional "Hardware" look: analog VU needles, cart-style pads,
 * backlit transport switches, and the LED clock. Off by default; the
 * minimal console stays the baseline. Presentation only, no behavior
 * changes anywhere.
 */
export function useHardwareSkin(): [boolean, (on: boolean) => void] {
  const [hardware, setHardware] = useState(readHardwareSkin);

  useEffect(() => {
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ hardware }));
    } catch {
      // Ignore quota errors and keep runtime behavior intact.
    }
  }, [hardware]);

  return [hardware, setHardware];
}
