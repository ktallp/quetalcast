import { useCallback, useEffect, useState } from 'react';
import { Download, FileCheck2, Search, Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface ComplianceWork {
  artist: string;
  title: string;
  isrc: string;
  album: string;
  label: string;
  spins: number;
  performances: number;
}

interface MissingTrack {
  id: number;
  ts: number;
  roomId: string;
  text: string;
  artist: string | null;
  trackTitle: string | null;
  album: string | null;
}

interface ComplianceReport {
  start: number;
  end: number;
  athHours: number;
  totalPerformances: number;
  totalSpins: number;
  works: ComplianceWork[];
  missing: MissingTrack[];
  station: { name: string | null; category: string | null };
}

interface DeezerResult {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string;
}

interface Quarter {
  label: string;
  start: number;
  end: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  'noncommercial-crb': 'Noncommercial webcaster (CRB)',
  'noncommercial-educational': 'Noncommercial educational webcaster',
  'commercial-crb': 'Commercial webcaster (CRB)',
};

/** The current quarter plus the seven before it, newest first */
function recentQuarters(): Quarter[] {
  const out: Quarter[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3);
  for (let i = 0; i < 8; i++) {
    const start = new Date(year, quarter * 3, 1).getTime();
    const end = new Date(quarter === 3 ? year + 1 : year, ((quarter + 1) % 4) * 3, 1).getTime();
    out.push({ label: `Q${quarter + 1} ${year}`, start, end });
    quarter -= 1;
    if (quarter < 0) { quarter = 3; year -= 1; }
  }
  return out;
}

async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * SoundExchange compliance: pick a quarter, check the blockers, export the
 * Report of Use. The fix-up dialog reuses the Deezer search to attach an
 * ISRC, album, and label to any track that arrived without them.
 */
export function CompliancePanel() {
  const [quarters] = useState<Quarter[]>(recentQuarters);
  const [selected, setSelected] = useState(0);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [stationName, setStationName] = useState('');
  const [category, setCategory] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [fixing, setFixing] = useState<MissingTrack | null>(null);
  const [fixQuery, setFixQuery] = useState('');
  const [fixResults, setFixResults] = useState<DeezerResult[]>([]);
  const [fixSearching, setFixSearching] = useState(false);
  const [fixApplying, setFixApplying] = useState(false);

  const range = quarters[selected];

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/compliance/report?start=${range.start}&end=${range.end}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data: ComplianceReport = await res.json();
        setReport(data);
        if (data.station.name !== null) setStationName((cur) => cur || data.station.name || '');
        if (data.station.category !== null) setCategory((cur) => cur || data.station.category || '');
      }
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await fetch(`${API_BASE}/api/station-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station_name: stationName, license_category: category || undefined }),
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const openFix = (track: MissingTrack) => {
    setFixing(track);
    setFixResults([]);
    setFixQuery([track.artist, track.trackTitle || track.text].filter(Boolean).join(' '));
  };

  const runFixSearch = async () => {
    if (fixQuery.trim().length < 2) return;
    setFixSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/music-search?q=${encodeURIComponent(fixQuery)}`);
      const data = await res.json();
      setFixResults(Array.isArray(data?.data) ? data.data : []);
    } catch {
      setFixResults([]);
    } finally {
      setFixSearching(false);
    }
  };

  const applyFix = async (result: DeezerResult) => {
    if (!fixing) return;
    setFixApplying(true);
    try {
      const detailRes = await fetch(`${API_BASE}/api/music-detail/${result.id}`);
      const detail = (await detailRes.json())?.data;
      if (!detail) return;
      await fetch(`${API_BASE}/api/compliance/track/${fixing.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackTitle: detail.title || result.title,
          artist: detail.artist || result.artist,
          album: detail.album || result.album,
          label: detail.label || null,
          isrc: detail.isrc || null,
          duration: detail.duration || null,
        }),
      });
      setFixing(null);
      await loadReport();
    } finally {
      setFixApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Range + station settings */}
      <div className="panel space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="panel-header mb-0 flex items-center gap-1.5">
            <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
            Report of Use
          </span>
          <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
            <SelectTrigger className="w-[120px] h-8 bg-secondary border-border text-xs font-mono" aria-label="Reporting quarter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quarters.map((q, i) => (
                <SelectItem key={q.label} value={String(i)} className="text-xs font-mono">{q.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Service name
            </label>
            <input
              value={stationName}
              onChange={(e) => setStationName(e.target.value)}
              placeholder="Station name on the report"
              maxLength={100}
              className="w-52 rounded-md border border-border bg-input px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              License category
            </label>
            <Select value={category || undefined} onValueChange={setCategory}>
              <SelectTrigger className="w-64 h-8 bg-secondary border-border text-xs" aria-label="License category">
                <SelectValue placeholder="Select your agreement type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-xs">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/70 disabled:opacity-50 transition-colors"
          >
            {savingSettings ? 'Saving…' : 'Save settings'}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/60 max-w-xl">
          Field names follow SoundExchange's Report of Use spec. Verify the current
          template, delimiter, and your license category against your agreement
          before filing; this tool prepares the data, it is not legal advice.
        </p>
      </div>

      {report && (
        <>
          {/* Headline tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="panel py-3">
              <div className="text-xl font-mono font-bold text-foreground tabular-nums">{report.athHours.toLocaleString()}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">ATH · hours</div>
            </div>
            <div className="panel py-3">
              <div className="text-xl font-mono font-bold text-foreground tabular-nums">{report.totalPerformances.toLocaleString()}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">performances</div>
            </div>
            <div className="panel py-3">
              <div className="text-xl font-mono font-bold text-foreground tabular-nums">{report.totalSpins.toLocaleString()}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">spins</div>
            </div>
            <div className="panel py-3">
              <div className={`text-xl font-mono font-bold tabular-nums ${report.missing.length ? 'text-accent' : 'text-foreground'}`}>
                {report.missing.length}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">need ISRC</div>
            </div>
          </div>

          {/* Blockers */}
          {report.missing.length > 0 && (
            <div className="panel border-accent/40 space-y-2">
              <div className="flex items-center gap-2 text-xs text-accent">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {report.missing.length} track{report.missing.length === 1 ? '' : 's'} lack an ISRC and album + label.
                Fix them before exporting, or they file on title and artist alone.
              </div>
              <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                {report.missing.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs text-foreground/80 border border-border rounded-md px-2 py-1.5">
                    <span className="font-mono text-muted-foreground/60 text-[10px] shrink-0">
                      {new Date(t.ts).toLocaleDateString()}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{t.text}</span>
                    <button
                      onClick={() => openFix(t)}
                      className="shrink-0 px-2 py-0.5 rounded border border-border text-[10px] font-semibold hover:border-primary hover:text-primary transition-colors"
                    >
                      Fix
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exports */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => downloadFile(`/api/compliance/rou?start=${range.start}&end=${range.end}`, 'rou.txt')}
              disabled={report.totalSpins === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download Report of Use
            </button>
            <button
              onClick={() => downloadFile(`/api/compliance/playlist?start=${range.start}&end=${range.end}`, 'playlist.csv')}
              disabled={report.totalSpins === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Playlist CSV
            </button>
          </div>

          {/* Works table */}
          {report.works.length > 0 && (
            <div className="panel overflow-x-auto">
              <table className="w-full text-xs min-w-[560px]">
                <thead>
                  <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 border-b border-border">
                    <th className="py-2 pr-3 font-semibold">Artist</th>
                    <th className="py-2 pr-3 font-semibold">Title</th>
                    <th className="py-2 pr-3 font-semibold">ISRC</th>
                    <th className="py-2 pr-3 font-semibold">Label</th>
                    <th className="py-2 pr-3 font-semibold text-right">Spins</th>
                    <th className="py-2 font-semibold text-right">Perf.</th>
                  </tr>
                </thead>
                <tbody>
                  {report.works.map((w, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 text-foreground/80">
                      <td className="py-1.5 pr-3 truncate max-w-40">{w.artist}</td>
                      <td className="py-1.5 pr-3 truncate max-w-48">{w.title}</td>
                      <td className="py-1.5 pr-3 font-mono text-[10px] text-muted-foreground">{w.isrc || '-'}</td>
                      <td className="py-1.5 pr-3 truncate max-w-32 text-muted-foreground">{w.label || '-'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-mono">{w.spins}</td>
                      <td className="py-1.5 text-right tabular-nums font-mono">{w.performances}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ISRC fix-up dialog */}
      <Dialog open={!!fixing} onOpenChange={(open) => { if (!open) setFixing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Match this track</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {fixing?.text} · search Deezer and pick the right recording to attach
            its ISRC, album, and label.
          </DialogDescription>
          <div className="flex gap-2">
            <input
              value={fixQuery}
              onChange={(e) => setFixQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runFixSearch(); }}
              placeholder="Artist and song"
              className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={runFixSearch}
              disabled={fixSearching}
              className="px-3 py-2 rounded-md text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/70 disabled:opacity-50 transition-colors"
              aria-label="Search"
            >
              {fixSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto scrollbar-thin space-y-1">
            {fixResults.map((r) => (
              <button
                key={r.id}
                onClick={() => applyFix(r)}
                disabled={fixApplying}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left hover:bg-secondary/60 disabled:opacity-50 transition-colors"
              >
                {r.cover ? (
                  <img src={r.cover} alt="" className="w-7 h-7 rounded shrink-0 bg-secondary" loading="lazy" />
                ) : (
                  <span className="w-7 h-7 rounded bg-secondary shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-foreground truncate">{r.title}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">{r.artist}{r.album ? ` · ${r.album}` : ''}</span>
                </span>
              </button>
            ))}
            {!fixSearching && fixResults.length === 0 && (
              <p className="text-[10px] text-muted-foreground/60 px-1 py-2">
                Search to see candidates. Tracks with no match keep their freeform text.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
