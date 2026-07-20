import { useState } from 'react';
import { Disc3, ListMusic, Download, Clock, Gauge, AlertTriangle, Copy } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export interface Track {
  title: string;           // display string "Artist — Song"
  time: string;            // ISO timestamp or HH:MM:SS when played
  cover?: string;          // small album art URL
  coverMedium?: string;    // medium album art URL
  artist?: string;
  trackTitle?: string;     // song name (distinct from display title)
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

interface TrackListProps {
  tracks: Track[];
  /** Optional slot rendered above the list (e.g. Now Playing search for broadcasters) */
  topContent?: React.ReactNode;
  /** Whether to show the collapsible even when empty (for empty state) */
  alwaysShow?: boolean;
  /** Room ID to include in CSV export */
  roomId?: string;
  /** Render without the outer panel/accordion chrome (for use inside a tab) */
  bare?: boolean;
}

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format an ISO timestamp or HH:MM:SS string into the user's local time */
function formatTime(time: string): string {
  if (time.includes('T') || time.includes('Z')) {
    const d = new Date(time);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }
  return time;
}

function extractYear(dateStr?: string): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})/);
  return match ? match[1] : '';
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function downloadCsv(tracks: Track[], roomId?: string) {
  const rows = [...tracks].reverse();
  const baseHeader = [
    'Time Played', 'Artist', 'Title', 'Album', 'Duration', 'Release Date',
    'ISRC', 'BPM', 'Label', 'Genres', 'Contributors', 'Track #', 'Disc #', 'Explicit',
  ];
  const header = roomId ? ['Room ID', ...baseHeader].join(',') : baseHeader.join(',');

  const lines = rows.map((t) => {
    const dur = t.duration ? formatDuration(t.duration) : '';
    const contribs = (t.contributors || [])
      .map(c => `${c.name}${c.role ? ` (${c.role})` : ''}`)
      .join('; ');
    const genres = (t.genres || []).join('; ');

    const baseRow = [
      escapeCsvField(formatTime(t.time)),
      escapeCsvField(t.artist || ''),
      escapeCsvField(t.trackTitle || t.title),
      escapeCsvField(t.album || ''),
      escapeCsvField(dur),
      escapeCsvField(t.releaseDate || ''),
      escapeCsvField(t.isrc || ''),
      escapeCsvField(t.bpm ? String(t.bpm) : ''),
      escapeCsvField(t.label || ''),
      escapeCsvField(genres),
      escapeCsvField(contribs),
      escapeCsvField(t.trackPosition ? String(t.trackPosition) : ''),
      escapeCsvField(t.diskNumber ? String(t.diskNumber) : ''),
      escapeCsvField(t.explicitLyrics ? 'Yes' : ''),
    ];
    return roomId ? [escapeCsvField(roomId), ...baseRow].join(',') : baseRow.join(',');
  });

  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  const shortHash = Math.random().toString(36).slice(2, 8);
  a.download = `quetalcast-tracklist-${date}-${shortHash}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Metadata cell inside the detail grid ── */
function MetaCell({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold mb-0.5">{label}</div>
      <div className="text-[13px] text-foreground leading-snug break-words">{value}</div>
    </div>
  );
}

/* ── Track Detail Modal ── */
function TrackDetailModal({ track, open, onOpenChange }: { track: Track | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!track) return null;

  const artSrc = track.coverMedium || track.cover;
  const dur = formatDuration(track.duration);
  const year = extractYear(track.releaseDate);
  const fullDate = formatDate(track.releaseDate);
  const genres = (track.genres || []).join(', ');

  // Group contributors by role
  const contribsByRole: Record<string, string[]> = {};
  for (const c of track.contributors || []) {
    const role = c.role || 'Artist';
    if (!contribsByRole[role]) contribsByRole[role] = [];
    contribsByRole[role].push(c.name);
  }

  // Build metadata pairs for the grid
  const metaPairs: { label: string; value: string }[] = [];
  if (track.album) metaPairs.push({ label: 'Album', value: track.album });
  if (fullDate) metaPairs.push({ label: 'Released', value: fullDate });
  if (track.label) metaPairs.push({ label: 'Label', value: track.label });
  if (genres) metaPairs.push({ label: 'Genre', value: genres });
  if (track.isrc) metaPairs.push({ label: 'ISRC', value: track.isrc });
  if (track.trackPosition || track.diskNumber) {
    metaPairs.push({
      label: 'Position',
      value: [
        track.trackPosition ? `Track ${track.trackPosition}` : '',
        track.diskNumber ? `Disc ${track.diskNumber}` : '',
      ].filter(Boolean).join(' · '),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 overflow-hidden gap-0">
        {/* ── Hero: blurred backdrop + artwork + text ── */}
        <div className="relative overflow-hidden">
          {/* Blurred art background */}
          {artSrc && (
            <div
              className="absolute inset-0 bg-cover bg-center blur-3xl scale-125 opacity-25"
              style={{ backgroundImage: `url(${artSrc})` }}
            />
          )}
          {/* Gradient fade at the bottom for a smooth blend */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />

          <div className="relative flex flex-col items-center px-8 pt-10 pb-5">
            {/* Artwork */}
            {artSrc ? (
              <img
                src={artSrc}
                alt=""
                className="w-44 h-44 rounded-xl shadow-2xl ring-1 ring-white/10 bg-secondary"
              />
            ) : (
              <div className="w-44 h-44 rounded-xl bg-secondary/60 flex items-center justify-center ring-1 ring-white/10">
                <Disc3 className="h-16 w-16 text-muted-foreground/20" />
              </div>
            )}

            {/* Title + Artist — centered */}
            <div className="mt-5 text-center w-full">
              <DialogTitle className="text-base font-bold text-foreground leading-tight tracking-tight">
                {track.trackTitle || track.title}
              </DialogTitle>
              {track.artist && (
                <DialogDescription className="text-sm text-primary/90 font-medium mt-1">
                  {track.artist}
                </DialogDescription>
              )}
              {track.album && (
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  {track.album}{year ? ` · ${year}` : ''}
                </p>
              )}
            </div>

            {/* Badges row */}
            <div className="flex items-center justify-center gap-1.5 mt-3 flex-wrap">
              {dur && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/80 bg-white/5 backdrop-blur-sm border border-white/10 px-2 py-0.5 rounded-full">
                  <Clock className="h-2.5 w-2.5" /> {dur}
                </span>
              )}
              {track.bpm ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/80 bg-white/5 backdrop-blur-sm border border-white/10 px-2 py-0.5 rounded-full">
                  <Gauge className="h-2.5 w-2.5" /> {track.bpm} BPM
                </span>
              ) : null}
              {track.explicitLyrics && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/20 px-2 py-0.5 rounded-full">
                  <AlertTriangle className="h-2.5 w-2.5" /> E
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/80 bg-white/5 backdrop-blur-sm border border-white/10 px-2 py-0.5 rounded-full">
                <Clock className="h-2.5 w-2.5" /> {formatTime(track.time)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Metadata grid ── */}
        {(metaPairs.length > 0 || Object.keys(contribsByRole).length > 0) && (
          <div className="px-6 pt-4 pb-6 space-y-4">
            {/* Credits */}
            {Object.keys(contribsByRole).length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold mb-2">Credits</div>
                <div className="space-y-1">
                  {Object.entries(contribsByRole).map(([role, names]) => (
                    <div key={role} className="flex items-baseline gap-2">
                      <span className="text-[10px] text-muted-foreground/50 shrink-0 min-w-[4rem]">{role}</span>
                      <span className="text-[13px] text-foreground leading-snug">{names.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2-column grid for metadata */}
            {metaPairs.length > 0 && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {metaPairs.map((pair) => (
                  <MetaCell key={pair.label} label={pair.label} value={pair.value} />
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Main TrackList Component ── */
export function TrackList({ tracks, topContent, alwaysShow, roomId, bare }: TrackListProps) {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);

  const showPanel = alwaysShow || tracks.length > 0 || topContent;
  if (!showPanel) return null;

  const listBody = (
    <>
      {topContent && (
        <div className="pt-3 pb-2 border-b border-border">
          {topContent}
        </div>
      )}
      {tracks.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-xs">
          No tracks have been added yet
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5 px-2 py-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider border-b border-border">
            <span className="w-16 shrink-0">Time</span>
            <span className="w-8 shrink-0" />
            <span className="flex-1 min-w-0">Title</span>
            <span className="hidden sm:block w-32 shrink-0 truncate">Album</span>
            <span className="w-10 shrink-0 text-right">Dur.</span>
            <span className="hidden sm:block w-10 shrink-0 text-right">Year</span>
          </div>

          <div className="space-y-0 max-h-72 overflow-y-auto scrollbar-thin">
            {tracks.map((track, i) => {
              const year = extractYear(track.releaseDate);
              const dur = formatDuration(track.duration);
              const isCurrent = i === 0;

              const copyLabel = [track.artist, track.trackTitle || track.title]
                .filter(Boolean)
                .join(' · ');

              return (
                <div
                  key={i}
                  className={`group flex items-center transition-colors ${
                    isCurrent ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-secondary/50'
                  }`}
                >
                <button
                  onClick={() => setSelectedTrack(track)}
                  className="flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1.5 text-xs text-left cursor-pointer"
                >
                  <span className="w-16 shrink-0 text-muted-foreground/60 tabular-nums font-mono">
                    {formatTime(track.time)}
                  </span>

                  {(track.coverMedium || track.cover) ? (
                    <img
                      src={track.coverMedium || track.cover}
                      alt=""
                      className="w-8 h-8 rounded shrink-0 bg-secondary"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded bg-secondary shrink-0 flex items-center justify-center">
                      <Disc3
                        className={`h-3.5 w-3.5 ${
                          isCurrent ? 'text-primary animate-spin' : 'text-muted-foreground/40'
                        }`}
                        style={isCurrent ? { animationDuration: '3s' } : undefined}
                      />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className={`truncate ${isCurrent ? 'text-foreground font-medium' : 'text-foreground/80'}`}>
                      {track.trackTitle || track.title}
                    </div>
                    {track.artist && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {track.artist}
                      </div>
                    )}
                  </div>

                  <span className="hidden sm:block w-32 shrink-0 text-muted-foreground truncate text-[11px]">
                    {track.album || ''}
                  </span>

                  <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/60 font-mono">
                    {dur}
                  </span>

                  <span className="hidden sm:block w-10 shrink-0 text-right tabular-nums text-muted-foreground/60 font-mono">
                    {year}
                  </span>
                </button>
                <button
                  onClick={() => copyText(`${copyLabel} · ${formatTime(track.time)}`, 'Track')}
                  className="shrink-0 p-1.5 mr-1 rounded text-muted-foreground/50 hover:text-foreground opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title="Copy artist, title, and time"
                  aria-label={`Copy ${copyLabel}`}
                >
                  <Copy className="h-3 w-3" aria-hidden />
                </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  const detailModal = (
    <TrackDetailModal
      track={selectedTrack}
      open={!!selectedTrack}
      onOpenChange={(open) => { if (!open) setSelectedTrack(null); }}
    />
  );

  if (bare) {
    return (
      <>
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ListMusic className="h-3.5 w-3.5" aria-hidden />
          Track List
          <span className="font-normal text-muted-foreground/60">({tracks.length})</span>
          {tracks.length > 0 && (
            <button
              onClick={() => downloadCsv(tracks, roomId)}
              className="p-0.5 ml-1 text-muted-foreground hover:text-foreground transition-colors rounded cursor-pointer"
              title="Download track list as CSV"
              aria-label="Download track list as CSV"
            >
              <Download className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
        {listBody}
        {detailModal}
      </>
    );
  }

  return (
    <>
      <div className="panel !p-0">
        <Accordion type="single" collapsible defaultValue="tracklist">
          <AccordionItem value="tracklist" className="border-b-0">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ListMusic className="h-3.5 w-3.5" />
                Track List
                <span className="font-normal text-muted-foreground/60">({tracks.length})</span>
                {tracks.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadCsv(tracks, roomId);
                    }}
                    className="p-0.5 ml-1 text-muted-foreground hover:text-foreground transition-colors rounded cursor-pointer"
                    title="Download track list as CSV"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-0">
              {listBody}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {detailModal}
    </>
  );
}
