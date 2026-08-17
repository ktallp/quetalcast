import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { SoundPlaylist } from '@/components/SoundPlaylist';

/**
 * Bank C playlist behaviour. The component drives two <audio> decks, so these
 * tests capture the elements it constructs and drive them directly, since jsdom
 * implements no real media playback.
 */

/** Audio elements the component constructed, in order */
let constructed: { el: HTMLAudioElement; initialSrc: string | undefined }[] = [];
/** Which elements had play()/pause() called on them, in order */
let playCalls: HTMLMediaElement[] = [];
let pauseCalls: HTMLMediaElement[] = [];

/** The long-lived playback decks: built with no src argument, in creation order */
function decks(): HTMLAudioElement[] {
  const found = constructed.filter((c) => c.initialSrc === undefined).map((c) => c.el);
  if (found.length === 0) throw new Error('decks have not been created yet');
  return found;
}

/** The deck sounding a given track, identified by a fragment of its object URL */
function deckPlaying(urlFragment: string): HTMLAudioElement {
  const el = decks().find((d) => d.src.includes(urlFragment));
  if (!el) throw new Error(`no deck is playing ${urlFragment}`);
  return el;
}

function makeFile(name: string): File {
  return new File([new Uint8Array([0, 1, 2])], name, { type: 'audio/mpeg' });
}

/** A stand-in for the mixer's per-element gain node */
function fakeGain() {
  return { gain: { value: 1 } } as unknown as GainNode;
}

const NativeAudio = window.Audio;

beforeEach(() => {
  constructed = [];
  playCalls = [];
  pauseCalls = [];

  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    playCalls.push(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    pauseCalls.push(this);
  });

  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/track-${counter++}`);
  URL.revokeObjectURL = vi.fn();

  // Record every element the component builds so tests can drive them
  window.Audio = function (src?: string) {
    const el = new NativeAudio(src);
    constructed.push({ el, initialSrc: src });
    return el;
  } as unknown as typeof window.Audio;
});

afterEach(() => {
  // Unmount before restoring mocks: the component pauses its decks on teardown,
  // and jsdom has no real pause() to fall back on.
  cleanup();
  window.Audio = NativeAudio;
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderPlaylist(props: Partial<React.ComponentProps<typeof SoundPlaylist>> = {}) {
  const onTrackPlayback = vi.fn();
  const utils = render(
    <SoundPlaylist connectElement={() => fakeGain()} onTrackPlayback={onTrackPlayback} {...props} />,
  );
  return { ...utils, onTrackPlayback };
}

/** Add files through the hidden multi-select input */
function addTracks(container: HTMLElement, names: string[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const files = names.map(makeFile);
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

describe('SoundPlaylist', () => {
  it('adds several tracks at once and lists them in order', () => {
    const { container } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3', 'Three.mp3']);

    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.getByText(/3 tracks/)).toBeInTheDocument();
  });

  it('advances to the next track when one ends', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    expect(onTrackPlayback).toHaveBeenLastCalledWith('One', true);

    act(() => {
      decks()[0].dispatchEvent(new Event('ended'));
    });

    expect(onTrackPlayback).toHaveBeenLastCalledWith('Two', true);
  });

  it('stops at the end of the list when repeat is off', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Play Two'));
    act(() => {
      decks()[0].dispatchEvent(new Event('ended'));
    });

    expect(onTrackPlayback).toHaveBeenLastCalledWith('Two', false);
    expect(screen.getByLabelText('Play playlist')).toBeInTheDocument();
  });

  it('wraps back to the first track when repeat is on', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Repeat playlist'));
    fireEvent.click(screen.getByLabelText('Play Two'));

    act(() => {
      decks()[0].dispatchEvent(new Event('ended'));
    });

    expect(onTrackPlayback).toHaveBeenLastCalledWith('One', true);
  });

  it('builds exactly two decks and connects each to the mixer once', () => {
    const connectElement = vi.fn(() => fakeGain());
    const { container } = renderPlaylist({ connectElement });
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    act(() => {
      decks()[0].dispatchEvent(new Event('ended'));
    });
    fireEvent.click(screen.getByLabelText('Play One'));

    expect(decks()).toHaveLength(2);
    expect(connectElement).toHaveBeenCalledTimes(2);
  });

  it('cuts to another track while one is already playing', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3', 'Three.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    fireEvent.click(screen.getByLabelText('Play Three'));

    expect(onTrackPlayback).toHaveBeenLastCalledWith('Three', true);
    expect(screen.getByLabelText('Pause Three')).toBeInTheDocument();
    // The cut silenced the deck that was carrying One
    expect(pauseCalls).toContain(deckPlaying('track-2'));
  });

  it('segues a track over the current one without stopping it', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    const playingOne = deckPlaying('track-0');
    pauseCalls = [];

    fireEvent.click(screen.getByLabelText('Start Two over the current track'));

    // Two came up on the other deck; One was left to play out its tail
    expect(onTrackPlayback).toHaveBeenLastCalledWith('Two', true);
    expect(deckPlaying('track-1')).not.toBe(playingOne);
    expect(pauseCalls).not.toContain(playingOne);
    expect(screen.getByText('tail')).toBeInTheDocument();
  });

  it('does not advance the list when a tail finishes underneath', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3', 'Three.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    fireEvent.click(screen.getByLabelText('Start Three over the current track'));
    const tailDeck = deckPlaying('track-0');
    const callsBefore = playCalls.length;

    act(() => {
      tailDeck.dispatchEvent(new Event('ended'));
    });

    // The list position stays on Three; the finished tail must not skip it on
    expect(onTrackPlayback).toHaveBeenLastCalledWith('Three', true);
    expect(playCalls.length).toBe(callsBefore);
    expect(screen.queryByText('tail')).not.toBeInTheDocument();
  });

  it('advances from the segued track when it ends, not from the old one', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3', 'Three.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    fireEvent.click(screen.getByLabelText('Start Two over the current track'));

    act(() => {
      deckPlaying('track-1').dispatchEvent(new Event('ended'));
    });

    expect(onTrackPlayback).toHaveBeenLastCalledWith('Three', true);
  });

  it('stop silences a tail as well as the current track', () => {
    const { container } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    fireEvent.click(screen.getByLabelText('Start Two over the current track'));
    pauseCalls = [];

    fireEvent.click(screen.getByLabelText('Stop playlist'));

    expect(pauseCalls).toContain(decks()[0]);
    expect(pauseCalls).toContain(decks()[1]);
    expect(screen.queryByText('tail')).not.toBeInTheDocument();
  });

  it('pauses from the row control of the playing track', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    fireEvent.click(screen.getByLabelText('Pause One'));

    expect(onTrackPlayback).toHaveBeenLastCalledWith('One', false);
    expect(screen.getByLabelText('Play One')).toBeInTheDocument();
  });

  it('hands off to the following track when the playing one is removed', () => {
    const { container, onTrackPlayback } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Play One'));
    fireEvent.click(screen.getByLabelText('Remove One from the playlist'));

    expect(onTrackPlayback).toHaveBeenLastCalledWith('Two', true);
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('skips to a track by number-key trigger', () => {
    const triggerRef = { current: null } as React.MutableRefObject<((i: number) => void) | null>;
    const { container, onTrackPlayback } = renderPlaylist({ triggerRef });
    addTracks(container, ['One.mp3', 'Two.mp3', 'Three.mp3']);

    act(() => {
      triggerRef.current?.(2);
    });

    expect(onTrackPlayback).toHaveBeenLastCalledWith('Three', true);
  });

  it('persists nothing: the playlist is session-only', () => {
    const { container } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);
    fireEvent.click(screen.getByLabelText('Play One'));

    expect(localStorage.length).toBe(0);
  });

  it('releases object URLs for tracks it drops', () => {
    const { container } = renderPlaylist();
    addTracks(container, ['One.mp3', 'Two.mp3']);

    fireEvent.click(screen.getByLabelText('Remove Two from the playlist'));

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reports its track count so bank C can show as filled', () => {
    const onTrackCountChange = vi.fn();
    const { container } = renderPlaylist({ onTrackCountChange });
    addTracks(container, ['One.mp3', 'Two.mp3']);

    expect(onTrackCountChange).toHaveBeenLastCalledWith(2);
  });
});
