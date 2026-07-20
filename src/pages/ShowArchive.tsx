import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Radio, Disc3, MessageSquare, ListMusic } from 'lucide-react';
import { Footer } from '@/components/Footer';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface ArchiveTrack {
  ts: number;
  text: string;
  artist: string | null;
  trackTitle: string | null;
  album: string | null;
  cover: string | null;
  duration: number | null;
}

interface ArchiveChatMessage {
  ts: number;
  name: string;
  text: string;
  system: boolean;
}

interface ShowData {
  id: string;
  title: string | null;
  description: string | null;
  startedAt: number;
  endedAt: number | null;
  bytes: number;
  tracks: ArchiveTrack[];
  chat: ArchiveChatMessage[];
}

function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Public archive page for an ended broadcast: the recording with a seek
 * bar, the setlist with timestamps (click to jump), and the chat replayed
 * in step with playback.
 */
const ShowArchive = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [show, setShow] = useState<ShowData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!roomId) return;
    fetch(`${API_BASE}/api/show/${encodeURIComponent(roomId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setShow)
      .catch(() => setNotFound(true));
  }, [roomId]);

  // Chat replay follows the playhead
  const playheadTs = show ? show.startedAt + currentTime * 1000 : 0;
  const visibleChat = show ? show.chat.filter((m) => m.ts <= playheadTs) : [];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [visibleChat.length]);

  const seekTo = (ts: number) => {
    if (!show || !audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, (ts - show.startedAt) / 1000);
    audioRef.current.play().catch(() => { /* autoplay policies */ });
  };

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 text-center p-6">
        <Radio className="h-8 w-8 text-muted-foreground/40" aria-hidden />
        <p className="text-sm text-muted-foreground">This show is not in the archive.</p>
        <Link to="/" className="text-xs text-primary underline underline-offset-4">Back to QueTal Cast</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 bg-card border-b border-border">
        <Radio className="h-4 w-4 text-primary" aria-hidden />
        <span className="text-sm font-mono font-semibold text-foreground">QUETAL CAST</span>
        <span className="text-xs font-mono text-muted-foreground">ARCHIVE</span>
      </div>

      <div className="flex-1 w-full max-w-3xl mx-auto p-4 space-y-4">
        {show && (
          <>
            <div className="panel space-y-3">
              <div>
                <h1 className="text-lg font-semibold text-foreground text-balance">
                  {show.title || `Broadcast ${show.id}`}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {new Date(show.startedAt).toLocaleString()}
                  {show.endedAt ? ` · ${formatOffset(show.endedAt - show.startedAt)} on air` : ''}
                </p>
                {show.description && (
                  <p className="text-xs text-muted-foreground/80 mt-1">{show.description}</p>
                )}
              </div>
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                src={`${API_BASE}/api/show/${encodeURIComponent(show.id)}/audio`}
                className="w-full"
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              />
            </div>

            {show.tracks.length > 0 && (
              <div className="panel">
                <div className="panel-header flex items-center gap-1.5">
                  <ListMusic className="h-3.5 w-3.5" aria-hidden />
                  Track list · click to jump
                </div>
                <div className="max-h-72 overflow-y-auto scrollbar-thin">
                  {show.tracks.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => seekTo(t.ts)}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 text-xs text-left hover:bg-secondary/50 transition-colors"
                    >
                      <span className="w-14 shrink-0 font-mono tabular-nums text-muted-foreground/60">
                        {formatOffset(t.ts - show.startedAt)}
                      </span>
                      {t.cover ? (
                        <img src={t.cover} alt="" className="w-7 h-7 rounded shrink-0 bg-secondary" loading="lazy" />
                      ) : (
                        <span className="w-7 h-7 rounded bg-secondary shrink-0 flex items-center justify-center">
                          <Disc3 className="h-3 w-3 text-muted-foreground/40" aria-hidden />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground/90">{t.trackTitle || t.text}</span>
                        {t.artist && <span className="block text-[10px] text-muted-foreground truncate">{t.artist}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {show.chat.length > 0 && (
              <div className="panel">
                <div className="panel-header flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                  Chat replay · follows playback
                </div>
                <div className="max-h-56 overflow-y-auto scrollbar-thin space-y-1 text-xs">
                  {visibleChat.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/60 py-2">
                      Press play; messages appear as they happened during the show.
                    </p>
                  )}
                  {visibleChat.map((m, i) => (
                    <div key={i} className={m.system ? 'text-muted-foreground/50 italic' : 'text-foreground/85'}>
                      <span className="font-mono text-[10px] text-muted-foreground/50 mr-2 tabular-nums">
                        {formatOffset(m.ts - show.startedAt)}
                      </span>
                      {!m.system && <span className="font-semibold text-primary/90 mr-1">{m.name}:</span>}
                      {m.text}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default ShowArchive;
