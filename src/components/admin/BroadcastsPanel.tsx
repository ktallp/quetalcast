import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Link2, Loader2, Play, Square, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { receiveLinkFor, streamLinkFor } from '@/components/broadcast/ShareLinks';
import { absoluteUrl, formatDuration, relativeTime } from './format';

const PAGE_SIZE = 50;
const MAX_LIMIT = 200;

export interface Broadcast {
  id: string;
  title: string | null;
  username: string | null;
  createdAt: string;
  endedAt: string | null;
  live: boolean;
  broadcasterConnected: boolean;
  listeners: number | null;
  peakListeners: number;
  durationSec: number;
  hasArchive: boolean;
  archiveBytes: number;
}

function archiveUrlFor(roomId: string): string {
  return absoluteUrl(`/api/show/${roomId}/audio`);
}

function labelFor(b: Broadcast): string {
  return b.title || b.id.slice(0, 16);
}

/**
 * Every broadcast the station has ever run, live ones pinned on top.
 * Reads the database history rather than the 24h in-memory window the
 * Rooms tab shows, and overlays live counts on rooms still in memory.
 */
export function BroadcastsPanel({ isOwner }: { isOwner: boolean }) {
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [endTarget, setEndTarget] = useState<Broadcast | null>(null);
  const [ending, setEnding] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rowsRef = useRef<Broadcast[]>([]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const fetchPage = useCallback(async (limit: number, offset: number) => {
    const res = await fetch(`/admin/broadcasts?limit=${limit}&offset=${offset}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('request failed');
    return (await res.json()) as { total: number; broadcasts: Broadcast[] };
  }, []);

  const refresh = useCallback(async () => {
    const limit = Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, rowsRef.current.length));
    try {
      const data = await fetchPage(limit, 0);
      const fresh = data.broadcasts || [];
      setRows((prev) => {
        if (prev.length <= fresh.length) return fresh;
        // More than one page is loaded: refresh what we asked for and keep the tail
        const seen = new Set(fresh.map((b) => b.id));
        return [...fresh, ...prev.filter((b) => !seen.has(b.id))];
      });
      setTotal(data.total || 0);
      setFetchedAt(Date.now());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Local ticking so live running times move between polls
  useEffect(() => {
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await fetchPage(PAGE_SIZE, rowsRef.current.length);
      const more = data.broadcasts || [];
      setRows((prev) => {
        const seen = new Set(prev.map((b) => b.id));
        return [...prev, ...more.filter((b) => !seen.has(b.id))];
      });
      setTotal(data.total || 0);
    } catch {
      toast.error('Could not load more broadcasts');
    } finally {
      setLoadingMore(false);
    }
  };

  const stopPlayback = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setPlayingId(null);
  };

  const togglePlay = (row: Broadcast) => {
    if (playingId === row.id) {
      stopPlayback();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    // monitor=1 keeps admin listening out of the royalty stats
    const src = row.live ? `${streamLinkFor(row.id)}?monitor=1` : archiveUrlFor(row.id);
    audio.pause();
    audio.src = src;
    setPlayingId(row.id);
    audio.play().catch(() => {
      toast.error(`Could not play ${labelFor(row)}`);
      setPlayingId(null);
    });
  };

  const handleTerminate = async () => {
    if (!endTarget) return;
    setEnding(true);
    try {
      const res = await fetch(`/admin/rooms/${encodeURIComponent(endTarget.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        toast.success('Broadcast terminated');
        if (playingId === endTarget.id) stopPlayback();
        setEndTarget(null);
        refresh();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to terminate' }));
        toast.error(err.error || 'Failed to terminate');
      }
    } catch {
      toast.error('Could not reach server');
    } finally {
      setEnding(false);
    }
  };

  const runningSec = (row: Broadcast) =>
    row.live ? row.durationSec + Math.max(0, Math.floor((tick - fetchedAt) / 1000)) : row.durationSec;

  if (loading) {
    return (
      <div className="panel flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading broadcasts…
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div className="panel border-destructive/40 text-center py-8 space-y-2">
        <AlertTriangle className="h-5 w-5 text-destructive mx-auto" />
        <div className="text-sm font-mono text-destructive">Cannot reach server</div>
        <div className="text-xs text-muted-foreground">Retrying automatically…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="panel-header">Broadcasts</div>

        {rows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">No broadcasts yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Status</th>
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Broadcaster</th>
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Title</th>
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Started</th>
                  <th className="stat-label text-right pb-2 pr-3 font-normal">Running</th>
                  <th className="stat-label text-right pb-2 pr-3 font-normal">Listeners</th>
                  <th className="stat-label text-right pb-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2.5 pr-3">
                      {row.live ? (
                        <span className="status-badge status-on-air text-[10px]">Live</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="status-badge status-offline text-[10px]">Ended</span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {relativeTime(row.endedAt)}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">
                      {row.username ? (
                        <span className="text-foreground">{row.username}</span>
                      ) : (
                        <span className="text-muted-foreground">unknown</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-foreground">{labelFor(row)}</span>
                        {playingId === row.id && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
                            aria-label="Playing"
                          />
                        )}
                      </div>
                    </td>
                    <td
                      className="py-2.5 pr-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap"
                      title={new Date(row.createdAt).toLocaleString()}
                    >
                      {relativeTime(row.createdAt)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                      {formatDuration(runningSec(row))}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {row.live ? (
                        <span className="text-foreground">{row.listeners ?? 0}</span>
                      ) : (
                        <span className="text-muted-foreground">peak {row.peakListeners}</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {!row.live && !row.hasArchive ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground"
                                  disabled
                                  aria-label={`No recording for ${labelFor(row)}`}
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>No recording</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => togglePlay(row)}
                            aria-label={
                              playingId === row.id
                                ? `Stop ${labelFor(row)}`
                                : `Play ${labelFor(row)}`
                            }
                          >
                            {playingId === row.id ? (
                              <Square className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              aria-label={`Copy links for ${labelFor(row)}`}
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[10rem]">
                            <DropdownMenuItem
                              onSelect={() => copyText(receiveLinkFor(row.id), 'Receiver link')}
                            >
                              Receiver link
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => copyText(streamLinkFor(row.id), 'Stream link')}
                            >
                              Stream link
                            </DropdownMenuItem>
                            {row.hasArchive && (
                              <DropdownMenuItem
                                onSelect={() => copyText(archiveUrlFor(row.id), 'Broadcast MP3')}
                              >
                                Broadcast MP3
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {isOwner && row.live && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setEndTarget(row)}
                            aria-label={`Terminate ${labelFor(row)}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > rows.length && (
          <div className="pt-3 flex justify-center">
            <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : `Load more (${rows.length} of ${total})`}
            </Button>
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        onEnded={() => setPlayingId(null)}
        onError={() => {
          if (!playingId) return;
          toast.error('Playback failed');
          setPlayingId(null);
        }}
      />

      <Dialog open={endTarget !== null} onOpenChange={(open) => { if (!open) setEndTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Terminate broadcast?</DialogTitle>
            <DialogDescription>
              This will disconnect the broadcaster and all listeners on{' '}
              <span className="font-mono text-foreground">{endTarget ? labelFor(endTarget) : ''}</span>
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEndTarget(null)} disabled={ending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleTerminate} disabled={ending}>
              {ending ? 'Terminating…' : 'Terminate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
