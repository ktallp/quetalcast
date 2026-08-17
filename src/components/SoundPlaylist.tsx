import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Play, Pause, Square, SkipBack, SkipForward, Repeat, X, ListMusic, Layers } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export interface PlaylistTrack {
  id: string;
  title: string;
  objectUrl: string;
  /** Duration in seconds; filled in once metadata loads */
  duration: number | null;
}

interface SoundPlaylistProps {
  connectElement: (audio: HTMLAudioElement) => GainNode | null;
  /** Ref that receives a trigger function so number keys can jump to a track */
  triggerRef?: React.MutableRefObject<((index: number) => void) | null>;
  /** Called when a track starts or stops, for the broadcast log */
  onTrackPlayback?: (title: string, playing: boolean) => void;
  /** Reports the track count so the bank switcher can show C as filled */
  onTrackCountChange?: (count: number) => void;
  /** Hardware skin: match the broadcast-cart look of the pad banks */
  hardware?: boolean;
}

/** One playback deck: an element wired into the mixer, plus what it is playing */
interface Deck {
  el: HTMLAudioElement;
  gain: GainNode | null;
  trackId: string | null;
}

/** How a track takes over: replace everything, ride over the current one, or follow it */
type StartMode = 'cut' | 'segue' | 'advance';

const DECK_COUNT = 2;

function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Bank C: a continuous-play list rather than one-shot pads.
 *
 * Tracks live only for the current session — files are held as object URLs and
 * never persisted, so nothing survives a reload. That is deliberate: pads in
 * banks A and B are persisted to localStorage as base64, which a music-length
 * playlist would blow past the ~5MB quota immediately.
 *
 * Playback runs on two decks, the way playout software does, so a new track can
 * start over the tail of the one still fading out. A single element could only
 * ever hold one source, which forced every start to cut the previous track dead.
 * The mixer's connectElement() wraps an element in a MediaElementSource, which
 * can only be done once per element and cannot be undone, so each deck is
 * connected once at creation and then reused by swapping .src.
 */
export function SoundPlaylist({
  connectElement,
  triggerRef,
  onTrackPlayback,
  onTrackCountChange,
  hardware,
}: SoundPlaylistProps) {
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopList, setLoopList] = useState(false);
  const [volume, setVolume] = useState(100);
  const [elapsed, setElapsed] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  /** Tracks still sounding on a non-current deck — a fade-out being played over */
  const [tailIds, setTailIds] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const decksRef = useRef<Deck[] | null>(null);
  const currentDeckRef = useRef(0);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Deck 'ended' listeners are bound once at deck creation, so they read live
  // state through refs rather than closing over a stale render.
  const latestRef = useRef({ tracks, currentId, loopList });
  latestRef.current = { tracks, currentId, loopList };
  const endedRef = useRef<(deckIndex: number) => void>(() => {});

  const syncTails = useCallback(() => {
    const decks = decksRef.current;
    if (!decks) return;
    setTailIds(
      decks
        .filter((d, i) => i !== currentDeckRef.current && d.trackId)
        .map((d) => d.trackId as string),
    );
  }, []);

  /**
   * Build and connect both decks on first use. Deferred until a track actually
   * starts so the AudioContext is created inside a user gesture.
   */
  const ensureDecks = useCallback((): Deck[] => {
    if (!decksRef.current) {
      decksRef.current = Array.from({ length: DECK_COUNT }, (_, i) => {
        const el = new Audio();
        el.volume = 1;
        const gain = connectElement(el);
        if (gain) gain.gain.value = volume / 100;
        el.addEventListener('ended', () => endedRef.current(i));
        return { el, gain, trackId: null };
      });
    }
    return decksRef.current;
  }, [connectElement, volume]);

  const startTrack = useCallback(
    (id: string, mode: StartMode) => {
      const track = latestRef.current.tracks.find((t) => t.id === id);
      if (!track) return;
      const decks = ensureDecks();

      // 'cut' silences everything; 'segue' leaves the current track sounding and
      // claims the other deck; 'advance' follows on in place, leaving any tail.
      let deckIndex: number;
      if (mode === 'segue') {
        deckIndex = (currentDeckRef.current + 1) % DECK_COUNT;
        const stale = decks[deckIndex];
        stale.el.pause();
        stale.trackId = null;
      } else {
        deckIndex = currentDeckRef.current;
        if (mode === 'cut') {
          decks.forEach((d) => {
            d.el.pause();
            d.trackId = null;
          });
        }
      }

      const deck = decks[deckIndex];
      if (deck.el.src !== track.objectUrl) deck.el.src = track.objectUrl;
      deck.el.currentTime = 0;
      deck.trackId = id;
      deck.el.play().catch(() => {
        // Autoplay blocked until the next gesture; leave state untouched
      });

      currentDeckRef.current = deckIndex;
      setCurrentId(id);
      setIsPlaying(true);
      setElapsed(0);
      onTrackPlayback?.(track.title, true);
      syncTails();
    },
    [ensureDecks, onTrackPlayback, syncTails],
  );

  /** Cut to a track, stopping anything already sounding */
  const playTrack = useCallback((id: string) => startTrack(id, 'cut'), [startTrack]);

  /** Start a track over the top, letting the current one play out its tail */
  const segueTrack = useCallback((id: string) => startTrack(id, 'segue'), [startTrack]);

  /** Full stop: every deck, including tails still finishing */
  const stop = useCallback(() => {
    const decks = decksRef.current;
    if (decks) {
      decks.forEach((d) => {
        d.el.pause();
        d.el.currentTime = 0;
        d.trackId = null;
      });
    }
    const current = latestRef.current.tracks.find((t) => t.id === latestRef.current.currentId);
    setIsPlaying(false);
    setElapsed(0);
    setTailIds([]);
    if (current) onTrackPlayback?.(current.title, false);
  }, [onTrackPlayback]);

  /** Step by ±1, wrapping only when the list is set to repeat */
  const step = useCallback(
    (delta: number, mode: StartMode = 'cut') => {
      const { tracks: list, currentId: cur, loopList: loop } = latestRef.current;
      if (list.length === 0) return;
      const index = list.findIndex((t) => t.id === cur);
      const from = index === -1 ? 0 : index;
      const next = from + delta;

      if (next < 0) {
        startTrack(loop ? list[list.length - 1].id : list[0].id, mode);
        return;
      }
      if (next >= list.length) {
        if (loop) {
          startTrack(list[0].id, mode);
        } else {
          stop();
        }
        return;
      }
      startTrack(list[next].id, mode);
    },
    [startTrack, stop],
  );

  // Auto-advance. Only the deck holding the playlist position advances the list;
  // a tail finishing underneath a segue must not skip the list forward.
  endedRef.current = (deckIndex: number) => {
    const decks = decksRef.current;
    if (!decks) return;
    decks[deckIndex].trackId = null;

    if (deckIndex !== currentDeckRef.current) {
      syncTails();
      return;
    }
    step(1, 'advance');
  };

  const togglePlayPause = useCallback(() => {
    const decks = decksRef.current;
    const current = latestRef.current.tracks.find((t) => t.id === latestRef.current.currentId);

    if (!current) {
      const list = latestRef.current.tracks;
      if (list.length > 0) playTrack(list[0].id);
      return;
    }
    if (!decks) return;
    const deck = decks[currentDeckRef.current];

    if (isPlaying) {
      deck.el.pause();
      setIsPlaying(false);
      onTrackPlayback?.(current.title, false);
    } else {
      deck.el.play().catch(() => {
        // Autoplay blocked; ignore
      });
      setIsPlaying(true);
      onTrackPlayback?.(current.title, true);
    }
  }, [isPlaying, playTrack, onTrackPlayback]);

  useEffect(() => {
    onTrackCountChange?.(tracks.length);
  }, [tracks.length, onTrackCountChange]);

  // Progress readout for the deck holding the playlist position
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const decks = decksRef.current;
      if (decks) setElapsed(decks[currentDeckRef.current].el.currentTime);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Number keys jump straight to a track
  useEffect(() => {
    if (!triggerRef) return;
    triggerRef.current = (index: number) => {
      const list = latestRef.current.tracks;
      if (index >= 0 && index < list.length) playTrack(list[index].id);
    };
    return () => {
      if (triggerRef) triggerRef.current = null;
    };
  }, [triggerRef, playTrack]);

  // Release decks and object URLs when the playlist goes away for good
  useEffect(() => {
    const urls = () => latestRef.current.tracks.map((t) => t.objectUrl);
    return () => {
      decksRef.current?.forEach((d) => {
        d.el.pause();
        d.el.src = '';
      });
      urls().forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const added: PlaylistTrack[] = files.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      objectUrl: URL.createObjectURL(file),
      duration: null,
    }));

    // Read durations off-screen so the list can show run times before playback
    added.forEach((track) => {
      const probe = new Audio(track.objectUrl);
      probe.addEventListener('loadedmetadata', () => {
        setTracks((prev) =>
          prev.map((t) => (t.id === track.id ? { ...t, duration: probe.duration } : t)),
        );
      });
    });

    setTracks((prev) => [...prev, ...added]);
    e.target.value = '';
  };

  const handleRemove = (id: string) => {
    const track = tracks.find((t) => t.id === id);
    if (!track) return;

    if (id === currentId) {
      // Removing the playing track: hand off to the next one, or stop
      const index = tracks.findIndex((t) => t.id === id);
      const following = tracks[index + 1];
      if (following && isPlaying) {
        playTrack(following.id);
      } else {
        stop();
        setCurrentId(null);
      }
    }

    setTracks((prev) => prev.filter((t) => t.id !== id));
    URL.revokeObjectURL(track.objectUrl);
  };

  const handleClearAll = () => {
    stop();
    setCurrentId(null);
    tracks.forEach((t) => URL.revokeObjectURL(t.objectUrl));
    setTracks([]);
    decksRef.current?.forEach((d) => {
      d.el.src = '';
    });
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    decksRef.current?.forEach((d) => {
      if (d.gain) d.gain.gain.value = v / 100;
    });
  };

  const handleReorder = (from: number, to: number) => {
    if (from === to) return;
    setTracks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const current = tracks.find((t) => t.id === currentId) ?? null;
  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const anyUnknown = tracks.some((t) => t.duration === null);

  return (
    <>
      {/* Transport */}
      <div
        className={`flex items-center gap-1 mb-2 p-2 rounded-md border ${
          hardware ? 'hw-cart border-border' : 'border-border bg-secondary/40'
        }`}
      >
        <button
          onClick={() => step(-1)}
          disabled={tracks.length === 0}
          aria-label="Previous track"
          title="Previous"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
        >
          <SkipBack className="h-3.5 w-3.5" aria-hidden />
        </button>

        <button
          onClick={togglePlayPause}
          disabled={tracks.length === 0}
          aria-label={isPlaying ? 'Pause playlist' : 'Play playlist'}
          title={isPlaying ? 'Pause' : 'Play'}
          className={`p-1.5 rounded transition-all disabled:opacity-30 ${
            isPlaying ? 'text-primary bg-primary/20 glow-ring' : 'text-foreground hover:bg-secondary'
          }`}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 fill-current" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
        </button>

        <button
          onClick={stop}
          disabled={!current}
          aria-label="Stop playlist"
          title="Stop everything"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
        </button>

        <button
          onClick={() => step(1)}
          disabled={tracks.length === 0}
          aria-label="Next track"
          title="Next"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
        >
          <SkipForward className="h-3.5 w-3.5" aria-hidden />
        </button>

        <button
          onClick={() => setLoopList((v) => !v)}
          aria-label={loopList ? 'Disable repeat' : 'Repeat playlist'}
          aria-pressed={loopList}
          title={loopList ? 'Repeat on' : 'Repeat off'}
          className={`p-1.5 rounded transition-colors ${
            loopList ? 'text-primary bg-primary/20' : 'text-muted-foreground/40 hover:text-muted-foreground'
          }`}
        >
          <Repeat className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div className="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground">
          {current ? `${formatTime(elapsed)} / ${formatTime(current.duration)}` : '--:-- / --:--'}
        </div>
      </div>

      {/* Now playing */}
      {current && (
        <div className="mb-2 px-2 py-1.5 rounded-md bg-primary/10 border border-primary/30">
          <div className="text-[9px] font-mono uppercase tracking-wider text-primary/70">
            {isPlaying ? 'On Air' : 'Paused'}
            {tailIds.length > 0 && <span className="ml-1 text-muted-foreground">· over tail</span>}
          </div>
          <div className="text-[11px] font-mono text-foreground truncate">{current.title}</div>
        </div>
      )}

      {/* Track list */}
      {tracks.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-8 rounded-md border-2 border-dashed border-border/60 flex flex-col items-center justify-center gap-2 hover:border-muted-foreground hover:bg-secondary/30 transition-all"
        >
          <ListMusic className="h-6 w-6 text-muted-foreground/50" aria-hidden />
          <span className="text-[10px] font-mono text-muted-foreground">
            Add tracks to build a playlist
          </span>
        </button>
      ) : (
        <ul className="space-y-1 max-h-72 overflow-y-auto" aria-label="Playlist tracks">
          {tracks.map((track, i) => {
            const active = track.id === currentId;
            const finishing = tailIds.includes(track.id);
            return (
              <li
                key={track.id}
                draggable
                onDragStart={() => {
                  dragIndexRef.current = i;
                }}
                onDragOver={(e) => {
                  if (dragIndexRef.current !== null) {
                    e.preventDefault();
                    setDragOverIndex(i);
                  }
                }}
                onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndexRef.current !== null) handleReorder(dragIndexRef.current, i);
                  dragIndexRef.current = null;
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDragOverIndex(null);
                }}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-colors ${
                  active
                    ? 'border-primary bg-primary/15'
                    : finishing
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-border bg-secondary/40 hover:bg-secondary'
                } ${dragOverIndex === i ? 'ring-1 ring-primary' : ''}`}
              >
                <kbd className="text-[8px] font-mono text-muted-foreground/40 w-3 shrink-0" aria-hidden>
                  {i < 10 ? (i + 1) % 10 : ''}
                </kbd>

                {/* Cuts straight to this track, stopping whatever is playing */}
                <button
                  onClick={() => (active && isPlaying ? togglePlayPause() : playTrack(track.id))}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left group"
                  aria-label={active && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                  title={active && isPlaying ? 'Pause' : 'Play now (cuts current track)'}
                  aria-current={active ? 'true' : undefined}
                >
                  <span
                    className={`shrink-0 ${
                      active ? 'text-primary' : 'text-muted-foreground/50 group-hover:text-foreground'
                    }`}
                    aria-hidden
                  >
                    {active && isPlaying ? (
                      <Pause className="h-3 w-3 fill-current" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </span>
                  <span
                    className={`block flex-1 min-w-0 text-[10px] font-mono truncate ${
                      active ? 'text-primary' : finishing ? 'text-amber-500/90' : 'text-foreground/80'
                    }`}
                  >
                    {track.title}
                  </span>
                </button>

                {finishing && (
                  <span
                    className="text-[8px] font-mono uppercase tracking-wider text-amber-500/80 shrink-0"
                    title="Still playing out under the current track"
                  >
                    tail
                  </span>
                )}

                {/* Starts this track over the top, letting the current one finish */}
                <button
                  onClick={() => segueTrack(track.id)}
                  aria-label={`Start ${track.title} over the current track`}
                  title="Segue — start over the current track's fade-out"
                  className="p-0.5 rounded text-muted-foreground/40 hover:text-primary transition-colors shrink-0"
                >
                  <Layers className="h-3 w-3" aria-hidden />
                </button>

                <span className="text-[9px] font-mono tabular-nums text-muted-foreground/60 shrink-0">
                  {formatTime(track.duration)}
                </span>

                <button
                  onClick={() => handleRemove(track.id)}
                  aria-label={`Remove ${track.title} from the playlist`}
                  title="Remove"
                  className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add / clear */}
      {tracks.length > 0 && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-secondary/50 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Plus className="h-3 w-3" aria-hidden />
            Add tracks
          </button>
          <button
            onClick={() => setConfirmClear(true)}
            className="px-2 py-1 rounded-md border border-border bg-secondary/50 text-[10px] font-mono text-muted-foreground hover:text-destructive transition-colors"
          >
            Clear
          </button>
          <span className="ml-auto text-[9px] font-mono tabular-nums text-muted-foreground/60">
            {tracks.length} track{tracks.length === 1 ? '' : 's'} · {formatTime(totalDuration)}
            {anyUnknown ? '+' : ''}
          </span>
        </div>
      )}

      {/* Playlist volume */}
      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Playlist Volume
          </label>
          <span
            className={`text-[10px] font-mono tabular-nums ${
              volume > 100 ? 'text-red-500 font-semibold' : 'text-muted-foreground'
            }`}
          >
            {volume}%
          </span>
        </div>
        <Slider
          value={[volume]}
          onValueChange={([v]) => handleVolume(v)}
          min={0}
          max={300}
          step={1}
          className={volume > 100 ? 'slider-danger' : ''}
          aria-label="Playlist volume"
        />
        {volume > 100 && (
          <p className="text-[10px] font-mono text-red-500">
            Volume above 100% may cause distortion
          </p>
        )}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground/50">
        Plays continuously, advancing to the next track. Play cuts to a track; segue
        starts it over the current track's fade-out. Tracks are session-only — they clear
        when you reload.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,audio/*"
        multiple
        onChange={handleAddFiles}
        className="hidden"
        aria-hidden
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear the playlist?"
        description={`All ${tracks.length} track${tracks.length === 1 ? '' : 's'} will be removed from bank C.`}
        confirmLabel="Clear"
        destructive
        onConfirm={() => {
          handleClearAll();
          setConfirmClear(false);
        }}
      />
    </>
  );
}
