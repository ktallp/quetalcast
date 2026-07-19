import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { error: ReturnType<typeof vi.fn> };
  fn.error = vi.fn();
  return fn;
});

vi.mock('@/components/ui/sonner', () => ({
  toast: toastMock,
}));

import { copyText } from '@/lib/clipboard';

function setClipboard(value: unknown) {
  Object.defineProperty(window.navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('copyText', () => {
  let execCommandMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastMock.mockClear();
    toastMock.error.mockClear();
    execCommandMock = vi.fn();
    // jsdom does not implement execCommand; stub it
    (document as Document & { execCommand: typeof execCommandMock }).execCommand = execCommandMock;
  });

  afterEach(() => {
    setClipboard(undefined);
  });

  it('uses navigator.clipboard.writeText and toasts on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    const result = await copyText('hello world');

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello world');
    expect(toastMock).toHaveBeenCalledWith('Link copied');
    expect(execCommandMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('uses the custom label in the success toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await copyText('abc', 'Invite');
    expect(toastMock).toHaveBeenCalledWith('Invite copied');
  });

  it('falls back to execCommand when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    setClipboard({ writeText });
    execCommandMock.mockReturnValue(true);

    const result = await copyText('fallback text');

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('fallback text');
    expect(execCommandMock).toHaveBeenCalledWith('copy');
    expect(toastMock).toHaveBeenCalledWith('Link copied');
    expect(toastMock.error).not.toHaveBeenCalled();
    // Fallback textarea must be cleaned up
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to execCommand when the Clipboard API is unavailable', async () => {
    setClipboard(undefined);
    execCommandMock.mockReturnValue(true);

    const result = await copyText('no api');

    expect(result).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith('copy');
    expect(toastMock).toHaveBeenCalledWith('Link copied');
  });

  it('shows an error toast and returns false when every strategy fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    setClipboard({ writeText });
    execCommandMock.mockReturnValue(false);

    const result = await copyText('https://example.com/room', 'Link');

    expect(result).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith(
      "Couldn't copy automatically. Link: https://example.com/room",
      { duration: 8000 },
    );
    expect(document.querySelector('textarea')).toBeNull();
  });
});
