import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Repeat, Square, Play, X, Settings } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SoundPlaylist } from '@/components/SoundPlaylist';

interface PadState {
  file: File | null;
  audioEl: HTMLAudioElement | null;
  objectUrl: string | null;
  dataUrl: string | null;
  title: string;
  volume: number; // 0-300
  gainNode: GainNode | null;
  loop: boolean;
  isPlaying: boolean;
}

const EMPTY_PAD: PadState = {
  file: null,
  audioEl: null,
  objectUrl: null,
  dataUrl: null,
  title: '',
  volume: 100,
  gainNode: null,
  loop: false,
  isPlaying: false,
};

const PAD_COUNT = 10;
const BANK_COUNT = 3;
const BANK_LABELS = ['A', 'B', 'C'];
/** Bank C is a continuous-play playlist rather than a grid of one-shot pads */
const PLAYLIST_BANK = 2;
const SOUNDBOARD_STORAGE_KEY = 'quetalcast:soundboard:v1';
const PAD_KEYCAPS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

interface StoredPad {
  title: string;
  volume: number;
  loop: boolean;
  dataUrl: string | null;
}

interface StoredBoard {
  version: 2;
  activeBank: number;
  banks: StoredPad[][];
}

function emptyBanks(): PadState[][] {
  return Array.from({ length: BANK_COUNT }, () =>
    Array.from({ length: PAD_COUNT }, () => ({ ...EMPTY_PAD })),
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

interface SoundBoardProps {
  connectElement: (audio: HTMLAudioElement) => GainNode | null;
  /** Ref that receives a triggerPad function for keyboard shortcuts (active bank) */
  triggerRef?: React.MutableRefObject<((index: number) => void) | null>;
  /** Called when a pad starts or stops playing */
  onPadPlayback?: (padTitle: string, playing: boolean) => void;
  /** Hardware skin: pads render as broadcast carts (stripe, label strip, LED) */
  hardware?: boolean;
}

/** Cart stripe colors cycle by slot so a wall of carts stays scannable */
const CART_STRIPE_COLORS = ['bg-red-400/80', 'bg-amber-400/80', 'bg-emerald-400/80', 'bg-sky-400/80', 'bg-fuchsia-400/70'];

export function SoundBoard({ connectElement, triggerRef, onPadPlayback, hardware }: SoundBoardProps) {
  const [banks, setBanks] = useState<PadState[][]>(emptyBanks);
  const [activeBank, setActiveBank] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activePadRef = useRef<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const playlistTriggerRef = useRef<((index: number) => void) | null>(null);
  const [playlistCount, setPlaylistCount] = useState(0);

  // Edit modal state
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editVolume, setEditVolume] = useState(100);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  const pads = banks[activeBank];

  const updatePad = useCallback((bank: number, index: number, update: Partial<PadState>) => {
    setBanks((prev) =>
      prev.map((b, bi) => (bi === bank ? b.map((p, i) => (i === index ? { ...p, ...update } : p)) : b)),
    );
  }, []);

  /** Build a live pad from a stored one (audio element + mixer connection) */
  const hydratePad = useCallback(
    (stored: StoredPad, bank: number, index: number): PadState => {
      if (!stored?.dataUrl) return { ...EMPTY_PAD };
      const audio = new Audio(stored.dataUrl);
      audio.loop = Boolean(stored.loop);
      audio.volume = 1;
      const gainNode = connectElement(audio);
      if (gainNode) gainNode.gain.value = (stored.volume ?? 100) / 100;
      audio.addEventListener('ended', () => {
        setBanks((prev) =>
          prev.map((b, bi) => (bi === bank ? b.map((p, i) => (i === index ? { ...p, isPlaying: false } : p)) : b)),
        );
      });
      return {
        file: null,
        audioEl: audio,
        objectUrl: null,
        dataUrl: stored.dataUrl,
        title: stored.title || `Pad ${index + 1}`,
        volume: typeof stored.volume === 'number' ? stored.volume : 100,
        gainNode,
        loop: Boolean(stored.loop),
        isPlaying: false,
      };
    },
    [connectElement],
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = () => {
      try {
        const raw = localStorage.getItem(SOUNDBOARD_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as StoredBoard | StoredPad[] | null;
        if (!parsed) return;

        // v1 payloads were a flat array of pads: migrate into bank A
        const storedBanks: StoredPad[][] = Array.isArray(parsed)
          ? [parsed, [], []]
          : Array.isArray((parsed as StoredBoard).banks)
            ? (parsed as StoredBoard).banks
            : [];
        if (storedBanks.length === 0) return;

        const nextBanks = Array.from({ length: BANK_COUNT }, (_, bank) =>
          Array.from({ length: PAD_COUNT }, (_, index) => {
            // Bank C is a session-only playlist; skip any pads a previous
            // version persisted there rather than hydrating dead audio.
            if (bank === PLAYLIST_BANK) return { ...EMPTY_PAD };
            const stored = storedBanks[bank]?.[index];
            return stored?.dataUrl ? hydratePad(stored, bank, index) : { ...EMPTY_PAD };
          }),
        );

        if (!cancelled) {
          setBanks(nextBanks);
          if (!Array.isArray(parsed) && typeof (parsed as StoredBoard).activeBank === 'number') {
            const b = (parsed as StoredBoard).activeBank;
            if (b >= 0 && b < BANK_COUNT) setActiveBank(b);
          }
        }
      } catch {
        // Ignore invalid persisted payloads
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [hydratePad]);

  useEffect(() => {
    const payload: StoredBoard = {
      version: 2,
      activeBank,
      // Bank C holds session-only playlist tracks, which are far too large for
      // localStorage; persist it as empty so a reload starts it clean.
      banks: banks.map((bank, bi) =>
        bi === PLAYLIST_BANK
          ? []
          : bank.map((p) => ({
              title: p.title,
              volume: p.volume,
              loop: p.loop,
              dataUrl: p.dataUrl,
            })),
      ),
    };
    try {
      localStorage.setItem(SOUNDBOARD_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Most likely quota exceeded; keep runtime state functional.
    }
  }, [banks, activeBank]);

  // Progress rings for playing pads
  useEffect(() => {
    const anyPlaying = banks.some((bank) => bank.some((p) => p.isPlaying));
    if (!anyPlaying) {
      setProgress({});
      return;
    }
    let raf = 0;
    const tick = () => {
      const next: Record<string, number> = {};
      banks.forEach((bank, bi) => {
        bank.forEach((p, pi) => {
          if (p.isPlaying && p.audioEl && p.audioEl.duration > 0) {
            next[`${bi}-${pi}`] = (p.audioEl.currentTime % p.audioEl.duration) / p.audioEl.duration;
          }
        });
      });
      setProgress(next);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [banks]);

  const handleLoadFile = (index: number) => {
    activePadRef.current = index;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const index = activePadRef.current;
    if (!file || index === null) return;

    const bank = activeBank;
    const prev = banks[bank][index];
    if (prev.audioEl) {
      prev.audioEl.pause();
      prev.audioEl.src = '';
    }
    if (prev.objectUrl) {
      URL.revokeObjectURL(prev.objectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    const audio = new Audio(objectUrl);
    let dataUrl: string | null = null;
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      dataUrl = null;
    }

    const gainNode = connectElement(audio);
    audio.volume = 1;

    audio.addEventListener('ended', () => {
      updatePad(bank, index, { isPlaying: false });
    });

    const defaultTitle = file.name.replace(/\.[^.]+$/, '');

    updatePad(bank, index, {
      file,
      audioEl: audio,
      objectUrl,
      dataUrl,
      title: defaultTitle,
      volume: 100,
      gainNode,
      loop: false,
      isPlaying: false,
    });

    e.target.value = '';
    activePadRef.current = null;
  };

  const handlePlayStop = useCallback((index: number) => {
    const pad = banks[activeBank][index];
    if (!pad?.audioEl) return;

    if (pad.isPlaying) {
      pad.audioEl.pause();
      pad.audioEl.currentTime = 0;
      updatePad(activeBank, index, { isPlaying: false });
      onPadPlayback?.(pad.title, false);
    } else {
      pad.audioEl.currentTime = 0;
      pad.audioEl.play().catch(() => {
        // Autoplay blocked; ignore
      });
      updatePad(activeBank, index, { isPlaying: true });
      onPadPlayback?.(pad.title, true);
    }
  }, [banks, activeBank, updatePad, onPadPlayback]);

  const handleToggleLoop = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const pad = pads[index];
    const newLoop = !pad.loop;
    if (pad.audioEl) {
      pad.audioEl.loop = newLoop;
    }
    updatePad(activeBank, index, { loop: newLoop });
  };

  const handleRemove = (index: number) => {
    const pad = pads[index];
    if (pad.audioEl) {
      pad.audioEl.pause();
      pad.audioEl.src = '';
    }
    if (pad.objectUrl) {
      URL.revokeObjectURL(pad.objectUrl);
    }
    setBanks((prev) =>
      prev.map((b, bi) => (bi === activeBank ? b.map((p, i) => (i === index ? { ...EMPTY_PAD } : p)) : b)),
    );
  };

  const openEditModal = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const pad = pads[index];
    setEditTitle(pad.title);
    setEditVolume(pad.volume);
    setEditIndex(index);
  };

  const handleEditSave = () => {
    if (editIndex === null) return;
    const pad = pads[editIndex];
    if (pad.gainNode) {
      pad.gainNode.gain.value = editVolume / 100; // 0-3.0
    }
    updatePad(activeBank, editIndex, { title: editTitle, volume: editVolume });
    setEditIndex(null);
  };

  const handleReorder = (from: number, to: number) => {
    if (from === to) return;
    setBanks((prev) =>
      prev.map((bank, bi) => {
        if (bi !== activeBank) return bank;
        const next = [...bank];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      }),
    );
  };

  // Expose triggerPad for keyboard shortcuts, routed to whichever bank is
  // showing: pads in A and B, playlist tracks in C.
  useEffect(() => {
    if (triggerRef) {
      triggerRef.current = (index: number) => {
        if (activeBank === PLAYLIST_BANK) {
          playlistTriggerRef.current?.(index);
        } else if (index >= 0 && index < PAD_COUNT) {
          handlePlayStop(index);
        }
      };
    }
    return () => {
      if (triggerRef) triggerRef.current = null;
    };
  }, [handlePlayStop, triggerRef, activeBank]);

  const editPad = editIndex !== null ? pads[editIndex] : null;
  const removePad = removeIndex !== null ? pads[removeIndex] : null;

  return (
    <>
      {/* Bank switcher */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Bank {BANK_LABELS[activeBank]}
          {activeBank === PLAYLIST_BANK && (
            <span className="ml-1 text-muted-foreground/60">· Playlist</span>
          )}
        </span>
        <div className="flex rounded-md border border-border overflow-hidden" role="group" aria-label="Sound pad bank">
          {BANK_LABELS.map((label, i) => {
            const hasContent =
              i === PLAYLIST_BANK ? playlistCount > 0 : banks[i].some((p) => p.audioEl);
            return (
              <button
                key={label}
                onClick={() => setActiveBank(i)}
                aria-pressed={activeBank === i}
                aria-label={`Bank ${label}${hasContent ? '' : ' (empty)'}`}
                className={`px-3 py-1 text-[10px] font-mono font-semibold ${
                  activeBank === i
                    ? 'bg-primary/20 text-primary'
                    : hasContent
                      ? 'bg-secondary text-foreground/80'
                      : 'bg-secondary text-muted-foreground/50'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pad banks (A and B). Kept mounted but hidden while bank C shows, so
          switching banks never interrupts a pad that is mid-playback. */}
      <div className={activeBank === PLAYLIST_BANK ? 'hidden' : undefined}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {pads.map((pad, i) => {
          const frac = progress[`${activeBank}-${i}`];
          return (
            <div
              key={i}
              className={`relative aspect-square ${dragOverIndex === i ? 'ring-1 ring-primary rounded-md' : ''}`}
              draggable={Boolean(pad.audioEl)}
              onDragStart={(e) => {
                dragIndexRef.current = i;
                e.dataTransfer.effectAllowed = 'move';
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
                if (dragIndexRef.current !== null) {
                  handleReorder(dragIndexRef.current, i);
                }
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
              onDragEnd={() => {
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
            >
              {pad.audioEl ? (
                <button
                  onClick={() => handlePlayStop(i)}
                  aria-label={`${pad.isPlaying ? 'Stop' : 'Play'} pad ${i + 1}: ${pad.title}`}
                  className={
                    hardware
                      ? `w-full h-full rounded-md hw-cart flex flex-col items-center justify-between pt-[40%] pb-6 transition-all ${
                          pad.isPlaying
                            ? 'border-primary shadow-[0_0_12px_hsl(var(--primary)/0.35)]'
                            : 'hover:brightness-110'
                        }`
                      : `w-full h-full rounded-md border flex flex-col items-center justify-between pt-[40%] pb-6 transition-all ${
                          pad.isPlaying
                            ? 'border-primary bg-primary/15 glow-ring'
                            : 'border-border bg-secondary/50 hover:bg-secondary'
                        }`
                  }
                >
                  {hardware && (
                    <span
                      className={`absolute top-[18%] left-2 right-2 h-1 rounded-full ${CART_STRIPE_COLORS[i % CART_STRIPE_COLORS.length]}`}
                      aria-hidden
                    />
                  )}
                  {pad.isPlaying ? (
                    <Square className="h-4 w-4 text-primary fill-primary" aria-hidden />
                  ) : (
                    <Play className="h-4 w-4 text-muted-foreground" aria-hidden />
                  )}
                  <span
                    className={
                      hardware
                        ? 'hw-cart-label text-[9px] font-mono leading-tight text-center line-clamp-2 overflow-hidden max-w-[92%]'
                        : 'text-[10px] font-mono text-muted-foreground leading-tight text-center px-1 line-clamp-2 overflow-hidden'
                    }
                  >
                    {pad.title}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => handleLoadFile(i)}
                  aria-label={`Load a sound into pad ${i + 1}`}
                  className="w-full h-full rounded-md border-2 border-dashed border-border/60 flex items-center justify-center hover:border-muted-foreground hover:bg-secondary/30 transition-all"
                >
                  <Plus className="h-5 w-5 text-muted-foreground/50" aria-hidden />
                </button>
              )}

              {/* Keycap hint: bottom-left */}
              <kbd
                className="absolute bottom-0.5 left-1 text-[8px] font-mono text-muted-foreground/40 pointer-events-none"
                aria-hidden
              >
                {PAD_KEYCAPS[i]}
              </kbd>

              {/* Progress ring for playing pads: top-center */}
              {pad.isPlaying && frac !== undefined && (
                <span
                  className="absolute top-1 left-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full pointer-events-none"
                  style={{
                    background: `conic-gradient(hsl(var(--primary)) ${frac * 360}deg, hsl(var(--secondary)) ${frac * 360}deg)`,
                    mask: 'radial-gradient(circle, transparent 3.5px, #000 4px)',
                    WebkitMask: 'radial-gradient(circle, transparent 3.5px, #000 4px)',
                  }}
                  aria-hidden
                />
              )}

              {/* Loop toggle: top-right */}
              {pad.audioEl && (
                <button
                  onClick={(e) => handleToggleLoop(i, e)}
                  aria-label={pad.loop ? `Disable loop on pad ${i + 1}` : `Loop pad ${i + 1}`}
                  aria-pressed={pad.loop}
                  className={`absolute top-0.5 right-0.5 p-0.5 rounded transition-colors ${
                    pad.loop
                      ? 'text-primary bg-primary/20'
                      : 'text-muted-foreground/40 hover:text-muted-foreground'
                  }`}
                  title={pad.loop ? 'Loop on' : 'Loop off'}
                >
                  <Repeat className="h-3 w-3" aria-hidden />
                </button>
              )}

              {/* Remove: top-left */}
              {pad.audioEl && !pad.isPlaying && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemoveIndex(i);
                  }}
                  aria-label={`Remove pad ${i + 1}: ${pad.title}`}
                  className="absolute top-0.5 left-0.5 p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-colors"
                  title="Remove"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}

              {/* Edit: bottom-right */}
              {pad.audioEl && (
                <button
                  onClick={(e) => openEditModal(i, e)}
                  aria-label={`Edit pad ${i + 1}: ${pad.title}`}
                  className="absolute bottom-0.5 right-0.5 p-0.5 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                  title="Edit"
                >
                  <Settings className="h-3 w-3" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
        </div>

        <p className="mt-2 text-[10px] text-muted-foreground/50 hidden sm:block">
          Drag pads to reorder. Keys 1-0 trigger the active bank.
        </p>
      </div>

      {/* Bank C: continuous playlist. Also kept mounted so a set keeps playing
          while you switch to A or B to fire a jingle over it. */}
      <div className={activeBank === PLAYLIST_BANK ? undefined : 'hidden'}>
        <SoundPlaylist
          connectElement={connectElement}
          triggerRef={playlistTriggerRef}
          onTrackPlayback={onPadPlayback}
          onTrackCountChange={setPlaylistCount}
          hardware={hardware}
        />
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,audio/*"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
      />

      {/* Remove confirmation */}
      <ConfirmDialog
        open={removeIndex !== null}
        onOpenChange={(open) => { if (!open) setRemoveIndex(null); }}
        title="Remove this pad?"
        description={removePad ? `"${removePad.title}" will be removed from bank ${BANK_LABELS[activeBank]}.` : undefined}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removeIndex !== null) handleRemove(removeIndex);
          setRemoveIndex(null);
        }}
      />

      {/* Edit modal */}
      <Dialog open={editIndex !== null} onOpenChange={(open) => { if (!open) setEditIndex(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Pad</DialogTitle>
            <DialogDescription className="text-xs font-mono text-muted-foreground">
              {editPad?.file?.name || editPad?.title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground" htmlFor="pad-title-input">
                Title
              </label>
              <input
                id="pad-title-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Pad title…"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Volume
                </label>
                <span className={`text-xs font-mono tabular-nums ${editVolume > 100 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                  {editVolume}%
                </span>
              </div>
              <Slider
                value={[editVolume]}
                onValueChange={([v]) => setEditVolume(v)}
                min={0}
                max={300}
                step={1}
                className={editVolume > 100 ? 'slider-danger' : ''}
                aria-label="Pad volume"
              />
              {editVolume > 100 && (
                <p className="text-[11px] font-mono text-red-500">
                  Volume above 100% may cause distortion
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleEditSave}
              className="bg-primary text-primary-foreground rounded-md px-6 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
