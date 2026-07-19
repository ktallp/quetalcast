import { useState, useEffect, useRef, useCallback } from 'react';
import { Radio, Clock, X, Link, Type, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const API_BASE = import.meta.env.VITE_API_URL || '';
const CUSTOM_URL_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

interface SavedSlug {
  slug: string;
  lastUsed: string;
  live: boolean;
}

export interface BroadcastSettings {
  customUrl: string;
  streamTitle: string;
  streamDescription: string;
}

interface PreBroadcastModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (settings: BroadcastSettings) => void;
  onSkip: () => void;
}

async function fetchSavedSlugs(): Promise<SavedSlug[]> {
  try {
    const res = await fetch(`${API_BASE}/api/room-slugs`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.slugs) ? data.slugs : [];
  } catch {
    return [];
  }
}

async function deleteServerSlug(slug: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/room-slugs/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    // best-effort
  }
}

function validateCustomUrl(value: string): string | null {
  if (!value) return null;
  if (value.length < 3) return 'At least 3 characters';
  if (value.length > 40) return '40 characters max';
  if (/--/.test(value)) return 'No consecutive hyphens';
  if (!CUSTOM_URL_PATTERN.test(value)) return 'Lowercase letters, numbers, hyphens only';
  return null;
}

const TITLE_KEY = 'quetalcast:stream-title';
const DESC_KEY = 'quetalcast:stream-description';

export function PreBroadcastModal({ open, onOpenChange, onStart, onSkip }: PreBroadcastModalProps) {
  const [customUrl, setCustomUrl] = useState('');
  const [customUrlError, setCustomUrlError] = useState<string | null>(null);
  const [savedSlugs, setSavedSlugs] = useState<SavedSlug[]>([]);
  const [showUrlSuggestions, setShowUrlSuggestions] = useState(false);
  const [streamTitle, setStreamTitle] = useState(() => localStorage.getItem(TITLE_KEY) ?? '');
  const [streamDescription, setStreamDescription] = useState(() => localStorage.getItem(DESC_KEY) ?? '');
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const refreshSlugs = useCallback(async () => {
    const slugs = await fetchSavedSlugs();
    setSavedSlugs(slugs);
  }, []);

  useEffect(() => {
    if (open) {
      refreshSlugs();
      setCustomUrlError(null);
    }
  }, [open, refreshSlugs]);

  const handleStart = () => {
    const slug = customUrl.trim().toLowerCase();
    if (slug) {
      const error = validateCustomUrl(slug);
      if (error) {
        setCustomUrlError(error);
        return;
      }
    }
    localStorage.setItem(TITLE_KEY, streamTitle);
    localStorage.setItem(DESC_KEY, streamDescription);
    onStart({ customUrl: slug, streamTitle: streamTitle.trim(), streamDescription: streamDescription.trim() });
  };

  const handleSkip = () => {
    onSkip();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Broadcast Settings</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            Configure your stream before going on air, or skip to start immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Stream Title */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Type className="h-3.5 w-3.5" />
              Stream Title
            </label>
            <input
              value={streamTitle}
              onChange={(e) => setStreamTitle(e.target.value)}
              placeholder="e.g. Friday Night Jams"
              maxLength={100}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Shown in media players as the station name
            </p>
          </div>

          {/* Stream Description */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Description
            </label>
            <input
              value={streamDescription}
              onChange={(e) => setStreamDescription(e.target.value)}
              placeholder="e.g. Live from El Paso, chill beats and good vibes"
              maxLength={200}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Included in stream headers for directories and players
            </p>
          </div>

          {/* Custom Receive URL */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link className="h-3.5 w-3.5" />
              Receive URL
            </label>
            <div className="relative">
              <div className="flex items-center gap-0 rounded-md border border-border bg-input overflow-hidden focus-within:ring-1 focus-within:ring-ring">
                <span className="text-xs font-mono text-muted-foreground/60 pl-3 shrink-0 select-none whitespace-nowrap">
                  /receive/
                </span>
                <input
                  ref={urlInputRef}
                  value={customUrl}
                  onChange={(e) => {
                    const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                    setCustomUrl(v);
                    setCustomUrlError(null);
                  }}
                  onFocus={() => { refreshSlugs(); setShowUrlSuggestions(true); }}
                  onBlur={() => {
                    setTimeout(() => setShowUrlSuggestions(false), 200);
                  }}
                  placeholder="auto-generated"
                  maxLength={40}
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 min-w-0 bg-transparent py-2 pr-2 text-sm font-mono text-foreground focus:outline-none placeholder:text-muted-foreground/40"
                />
                {customUrl && (
                  <button
                    onClick={() => { setCustomUrl(''); setCustomUrlError(null); }}
                    className="pr-2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    title="Clear"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {showUrlSuggestions && savedSlugs.length > 0 && !customUrl && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                  <div className="px-3 py-1.5 border-b border-border">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Previously used</span>
                  </div>
                  {savedSlugs.map(({ slug, live }) => (
                    <div
                      key={slug}
                      className={`flex items-center justify-between px-3 py-1.5 group ${live ? 'opacity-50' : 'hover:bg-secondary/80 cursor-pointer'}`}
                    >
                      <button
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        disabled={live}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (!live) {
                            setCustomUrl(slug);
                            setShowUrlSuggestions(false);
                          }
                        }}
                      >
                        {live ? (
                          <Radio className="h-3 w-3 text-destructive shrink-0 animate-pulse" />
                        ) : (
                          <Clock className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className="text-xs font-mono text-foreground truncate">{slug}</span>
                        {live && (
                          <span className="text-[10px] font-semibold text-destructive uppercase shrink-0">Live</span>
                        )}
                      </button>
                      {!live && (
                        pendingDeleteSlug === slug ? (
                          <button
                            className="text-[10px] font-semibold text-destructive shrink-0 ml-2"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setPendingDeleteSlug(null);
                              deleteServerSlug(slug).then(refreshSlugs);
                            }}
                            aria-label={`Confirm delete saved URL ${slug}`}
                          >
                            Delete?
                          </button>
                        ) : (
                          <button
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all shrink-0 ml-2"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setPendingDeleteSlug(slug);
                              setTimeout(() => setPendingDeleteSlug((cur) => (cur === slug ? null : cur)), 3000);
                            }}
                            title="Remove"
                            aria-label={`Remove saved URL ${slug}`}
                          >
                            <X className="h-3 w-3" aria-hidden />
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {customUrlError && (
              <p className="text-[11px] text-destructive">{customUrlError}</p>
            )}
            {customUrl && !customUrlError && (
              <p className="text-[10px] text-muted-foreground/60 font-mono truncate">
                Listeners join at: {window.location.origin}/receive/{customUrl}
              </p>
            )}
            {!customUrl && (
              <p className="text-[10px] text-muted-foreground/60">
                Leave blank for an auto-generated ID
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t border-border">
          <button
            onClick={handleSkip}
            className="flex-1 px-4 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleStart}
            className="flex-1 px-4 py-2.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Save & Start
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
