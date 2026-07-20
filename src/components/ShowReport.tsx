import { useEffect, useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface ReportData {
  id: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  durationSec: number;
  peak: number;
  avg: number;
  trackCount: number;
  samples: { ts: number; count: number }[];
}

interface ShowReportProps {
  roomId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function downloadSamplesCsv(report: ReportData) {
  const lines = ['time,listeners'];
  for (const s of report.samples) {
    lines.push(`${new Date(s.ts).toISOString()},${s.count}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quetalcast-listeners-${report.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Post-broadcast report: the listener curve and headline numbers for the
 * show that just ended, pulled from the per-minute samples the server
 * already records.
 */
export function ShowReport({ roomId, open, onOpenChange }: ShowReportProps) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !roomId) return;
    let cancelled = false;
    setReport(null);
    setError(false);
    fetch(`${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/report`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => { if (!cancelled) setReport(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [open, roomId]);

  const maxCount = report ? Math.max(1, ...report.samples.map((s) => s.count)) : 1;
  const peakIndex = report ? report.samples.findIndex((s) => s.count === maxCount) : -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
            Show report
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {report?.title ? `${report.title} · ` : ''}
            {report ? `${formatDuration(report.durationSec)} on air` : 'Loading…'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-sm text-muted-foreground">
            Report unavailable for this room.
          </p>
        )}

        {report && (
          <div className="space-y-4">
            {report.samples.length > 1 ? (
              <div
                className="flex items-end gap-[2px] h-16"
                role="img"
                aria-label={`Listener curve, peak of ${report.peak}`}
              >
                {report.samples.map((s, i) => (
                  <div
                    key={s.ts}
                    className={`flex-1 min-w-[2px] rounded-t-sm ${i === peakIndex ? 'bg-primary' : 'bg-primary/40'}`}
                    style={{ height: `${Math.max(4, (s.count / maxCount) * 100)}%` }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not enough samples for a listener curve (shows under a couple of minutes).
              </p>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
              <span>peak <b className="text-foreground">{report.peak}</b></span>
              <span>avg <b className="text-foreground">{report.avg}</b></span>
              <span>tracks <b className="text-foreground">{report.trackCount}</b></span>
              <span>on air <b className="text-foreground">{formatDuration(report.durationSec)}</b></span>
            </div>

            <div className="flex gap-2 pt-2 border-t border-border">
              <button
                onClick={() => downloadSamplesCsv(report)}
                disabled={report.samples.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
              >
                <Download className="h-3 w-3" aria-hidden />
                Listener CSV
              </button>
              <button
                onClick={() => onOpenChange(false)}
                className="ml-auto px-4 py-2 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
