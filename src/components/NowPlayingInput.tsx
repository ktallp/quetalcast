import { useState, useRef, useEffect, useCallback } from 'react';
import { Disc3, Search, X, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

interface DeezerResult {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string;
  coverMedium?: string;
  duration?: number;
}

/** Rich track metadata passed on commit */
export interface TrackMeta {
  text: string;
  cover?: string;
  coverMedium?: string;
  artist?: string;
  title?: string;
  album?: string;
  duration?: number;       // seconds
  releaseDate?: string;    // YYYY-MM-DD
  isrc?: string;
  bpm?: number;
  trackPosition?: number;
  diskNumber?: number;
  explicitLyrics?: boolean;
  contributors?: { name: string; role: string }[];
  label?: string;
  genres?: string[];
}

/** Lightweight metadata sent during live typing preview */
export interface NowPlayingMeta {
  text: string;
  cover?: string;
}

interface NowPlayingInputProps {
  value: string;
  onChange: (meta: NowPlayingMeta) => void;
  /** Called when the user commits a track (Enter or Deezer selection) */
  onCommit: (meta: TrackMeta) => void;
  /** When true, input is disabled and click shows "Go on air first to add tracks" */
  disabled?: boolean;
  /** Toast shown on commit; lets the setlist mode say where the track went */
  toastLabel?: string;
}

export function NowPlayingInput({ value, onChange, onCommit, disabled, toastLabel = 'Added to track list' }: NowPlayingInputProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<DeezerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCommittedRef = useRef(value);

  // Keep local query in sync with external value changes (e.g. reset on off-air)
  useEffect(() => {
    setQuery(value);
    lastCommittedRef.current = value;
  }, [value]);

  const searchDeezer = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/music-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.data || []);
      setOpen(data.data?.length > 0);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch full track detail from Deezer and commit */
  const fetchAndCommit = useCallback(async (result: DeezerResult) => {
    const displayText = `${result.artist} — ${result.title}`;
    setFetching(true);
    try {
      const res = await fetch(`/api/music-detail/${result.id}`);
      const { data } = await res.json();
      if (data) {
        const meta: TrackMeta = {
          text: displayText,
          cover: data.cover || result.cover || undefined,
          coverMedium: data.coverMedium || result.coverMedium || undefined,
          artist: data.artist || result.artist || undefined,
          title: data.title || result.title || undefined,
          album: data.album || result.album || undefined,
          duration: data.duration || result.duration || undefined,
          releaseDate: data.releaseDate || undefined,
          isrc: data.isrc || undefined,
          bpm: data.bpm || undefined,
          trackPosition: data.trackPosition || undefined,
          diskNumber: data.diskNumber || undefined,
          explicitLyrics: data.explicitLyrics || undefined,
          contributors: data.contributors?.length ? data.contributors : undefined,
          label: data.label || undefined,
          genres: data.genres?.length ? data.genres : undefined,
        };
        onCommit(meta);
      } else {
        // Fallback if detail fetch failed
        onCommit({
          text: displayText,
          cover: result.cover || undefined,
          coverMedium: result.coverMedium || undefined,
          artist: result.artist || undefined,
          title: result.title || undefined,
          album: result.album || undefined,
          duration: result.duration || undefined,
        });
      }
    } catch {
      // Fallback — commit with search data
      onCommit({
        text: displayText,
        cover: result.cover || undefined,
        coverMedium: result.coverMedium || undefined,
        artist: result.artist || undefined,
        title: result.title || undefined,
        album: result.album || undefined,
        duration: result.duration || undefined,
      });
    } finally {
      setFetching(false);
      // Clear input and notify
      lastCommittedRef.current = '';
      setQuery('');
      onChange({ text: '' });
      setResults([]);
      setOpen(false);
      toast(toastLabel, { duration: 2000 });
    }
  }, [onCommit, onChange, toastLabel]);

  /** Simple commit for freeform text (Enter key) */
  const commitFreeform = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== lastCommittedRef.current) {
      lastCommittedRef.current = '';
      onCommit({ text: trimmed });
      setQuery('');
      onChange({ text: '' });
      setResults([]);
      setOpen(false);
      toast(toastLabel, { duration: 2000 });
    }
  }, [onCommit, onChange, toastLabel]);

  const handleInput = (val: string) => {
    setQuery(val);
    // Live metadata update for receivers (typing preview)
    onChange({ text: val });
    // Debounce the Deezer search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(val), 300);
  };

  const handleSelect = (result: DeezerResult) => {
    // Show selected text immediately while fetching details
    const text = `${result.artist} — ${result.title}`;
    setQuery(text);
    setOpen(false);
    setResults([]);
    fetchAndCommit(result);
  };

  const handleClear = () => {
    setQuery('');
    onChange({ text: '' });
    lastCommittedRef.current = '';
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (query.trim()) {
        commitFreeform(query);
      }
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleDisabledClick = () => {
    if (disabled) {
      toast.info('Go on air first to add tracks');
    }
  };

  return (
    <div
      className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed' : ''}`}
      onClick={disabled ? handleDisabledClick : undefined}
    >
      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5 shrink-0">
        <Disc3 className="h-3 w-3" />
        Now Playing
      </span>

      <div ref={containerRef} className={`relative flex-1 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
        <div className="relative flex items-center">
          {fetching ? (
            <Loader2 className="absolute left-2 h-3 w-3 text-primary animate-spin pointer-events-none" />
          ) : (
            <Search className="absolute left-2 h-3 w-3 text-muted-foreground/60 pointer-events-none" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            onKeyDown={handleKeyDown}
            placeholder="Search artist or song…"
            maxLength={200}
            disabled={fetching}
            className="w-full bg-input border border-border rounded-md pl-7 pr-7 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            readOnly={disabled}
          />
          {query && !fetching && (
            <button
              onClick={handleClear}
              className="absolute right-1.5 p-0.5 text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Autocomplete dropdown */}
        {open && results.length > 0 && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden max-h-64 overflow-y-auto scrollbar-thin">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => handleSelect(r)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left hover:bg-accent/50 transition-colors"
              >
                {r.cover ? (
                  <img
                    src={r.cover}
                    alt=""
                    className="w-8 h-8 rounded shrink-0 bg-secondary"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-secondary shrink-0 flex items-center justify-center">
                    <Disc3 className="h-3.5 w-3.5 text-muted-foreground/40" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground truncate">{r.title}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {r.artist}{r.album ? ` · ${r.album}` : ''}
                    {r.duration ? ` · ${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}` : ''}
                  </div>
                </div>
              </button>
            ))}
            {loading && (
              <div className="px-3 py-2 text-[10px] text-muted-foreground text-center">Searching…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
