import { useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Copy, Square, AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDuration, formatUptime, absoluteUrl, copyToClipboard } from './format';

export interface RoomStats {
  liveRooms: number;
  listenersNow: number;
  peakToday: number;
  uptimeSec: number;
}

export interface AdminRoom {
  id: string;
  title: string | null;
  createdAt: string;
  endedAt: string | null;
  live: boolean;
  broadcasterConnected: boolean;
  receiverCount: number;
  relayListenerCount: number;
  peakListeners: number;
  durationSec: number;
}

interface RoomsPanelProps {
  stats: RoomStats | null;
  rooms: AdminRoom[];
  loading: boolean;
  error: boolean;
  isOwner: boolean;
  onRefresh: () => void;
}

export function RoomsPanel({ stats, rooms, loading, error, isOwner, onRefresh }: RoomsPanelProps) {
  const [endTarget, setEndTarget] = useState<AdminRoom | null>(null);
  const [ending, setEnding] = useState(false);

  const handleCopyLink = async (room: AdminRoom) => {
    const url = absoluteUrl(`/receive/${room.id}`);
    if (await copyToClipboard(url)) {
      toast.success('Listener link copied');
    } else {
      toast.error('Could not copy link');
    }
  };

  const handleEndRoom = async () => {
    if (!endTarget) return;
    setEnding(true);
    try {
      const res = await fetch(`/admin/rooms/${encodeURIComponent(endTarget.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        toast.success('Room ended');
        setEndTarget(null);
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to end room' }));
        toast.error(err.error || 'Failed to end room');
      }
    } catch {
      toast.error('Could not reach server');
    } finally {
      setEnding(false);
    }
  };

  if (loading) {
    return (
      <div className="panel flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading rooms…
      </div>
    );
  }

  if (error) {
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel">
          <div className="stat-label">Live Rooms</div>
          <div className="stat-value">{stats?.liveRooms ?? 0}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Listeners Now</div>
          <div className="stat-value">{stats?.listenersNow ?? 0}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Peak Today</div>
          <div className="stat-value">{stats?.peakToday ?? 0}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Server Uptime</div>
          <div className="stat-value">{stats ? formatUptime(stats.uptimeSec) : '--'}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Rooms</div>

        {rooms.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">No rooms yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Room</th>
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Status</th>
                  <th className="stat-label text-right pb-2 pr-3 font-normal">Listeners</th>
                  <th className="stat-label text-right pb-2 pr-3 font-normal">Peak</th>
                  <th className="stat-label text-right pb-2 pr-3 font-normal">Duration</th>
                  <th className="stat-label text-right pb-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-mono text-foreground text-xs">
                        {room.title || room.id.slice(0, 16)}
                      </div>
                      {room.title && (
                        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                          {room.id.slice(0, 16)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {room.live ? (
                        <span className="status-badge status-on-air text-[10px]">Live</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="status-badge status-offline text-[10px]">Ended</span>
                          {room.endedAt && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {new Date(room.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-foreground">
                      {room.receiverCount + room.relayListenerCount}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                      {room.peakListeners}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                      {formatDuration(room.durationSec)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                          <a
                            href={`/receive/${room.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open room ${room.title || room.id}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyLink(room)}
                          aria-label={`Copy listener link for ${room.title || room.id}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        {isOwner && room.live && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setEndTarget(room)}
                            aria-label={`End room ${room.title || room.id}`}
                          >
                            <Square className="h-3.5 w-3.5" />
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
      </div>

      <Dialog open={endTarget !== null} onOpenChange={(open) => { if (!open) setEndTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>End room?</DialogTitle>
            <DialogDescription>
              This will disconnect the broadcaster and all listeners in{' '}
              <span className="font-mono text-foreground">
                {endTarget?.title || endTarget?.id.slice(0, 16)}
              </span>
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEndTarget(null)} disabled={ending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleEndRoom} disabled={ending}>
              {ending ? 'Ending…' : 'End Room'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
