import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';

import { useSignaling } from '@/hooks/useSignaling';
import { useWebRTC, type ConnectionStatus } from '@/hooks/useWebRTC';
import { useAudioAnalyser } from '@/hooks/useAudioAnalyser';
import { StatusBar } from '@/components/StatusBar';
import { LevelMeter } from '@/components/LevelMeter';
import { HealthPanel } from '@/components/HealthPanel';
import { EventLog, createLogEntry, type LogEntry } from '@/components/EventLog';
import {
  Headphones, Radio, Volume2, VolumeX, ExternalLink, RefreshCw, Disc3, ChevronDown,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Footer } from '@/components/Footer';
import { ChatPanel } from '@/components/ChatPanel';
import { TrackList, type Track } from '@/components/TrackList';
import { ShareLinks, streamLinkFor } from '@/components/broadcast/ShareLinks';

const WS_URL = import.meta.env.VITE_WS_URL || (
  window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : `ws://${window.location.hostname}:3001`
);

const LISTENER_VOLUME_KEY = 'quetalcast:listener-volume:v1';

function readStoredVolume(): { volume: number; muted: boolean } {
  try {
    const raw = localStorage.getItem(LISTENER_VOLUME_KEY);
    if (!raw) return { volume: 80, muted: false };
    const parsed = JSON.parse(raw);
    return {
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(100, parsed.volume)) : 80,
      muted: Boolean(parsed.muted),
    };
  } catch {
    return { volume: 80, muted: false };
  }
}

const Receiver = () => {
  const { roomId: paramRoomId } = useParams();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [roomInput, setRoomInput] = useState(paramRoomId || '');
  const [joined, setJoined] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [audioStartFailed, setAudioStartFailed] = useState(false);
  const [externalStream, setExternalStream] = useState(false);
  const [nowPlaying, setNowPlaying] = useState('');
  const [nowPlayingCover, setNowPlayingCover] = useState<string | undefined>();
  const [trackList, setTrackList] = useState<Track[]>([]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [roomFull, setRoomFull] = useState(false);
  const [roomEnded, setRoomEnded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const initialVolume = useRef(readStoredVolume());
  const [volume, setVolume] = useState(initialVolume.current.volume);
  const [muted, setMuted] = useState(initialVolume.current.muted);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const volumeGainRef = useRef<GainNode | null>(null);
  const noAudioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs((prev) => [...prev.slice(-100), createLogEntry(msg, level)]);
  }, []);

  const signaling = useSignaling(WS_URL);
  const webrtc = useWebRTC(signaling, 'receiver');
  const audioAnalysis = useAudioAnalyser(audioStarted ? webrtc.remoteStream : null);

  const statusLabels: Record<ConnectionStatus, string> = {
    idle: 'Ready',
    connecting: 'Connecting to broadcast…',
    'on-air': 'On air',
    receiving: 'Listening',
    disconnected: 'Broadcast ended',
    error: 'Could not connect',
  };

  useEffect(() => {
    signaling.connect();
    addLog('Connecting…');
    return () => signaling.disconnect();
  }, []);

  useEffect(() => {
    if (signaling.connected) addLog('Connected to server');
  }, [signaling.connected]);

  // Listen for metadata, track list updates, stream URL, room-full, and room-ended
  useEffect(() => {
    const unsub = signaling.subscribe((msg) => {
      if (msg.type === 'metadata' && typeof msg.text === 'string') {
        setNowPlaying(msg.text as string);
        setNowPlayingCover(typeof msg.cover === 'string' ? (msg.cover as string) : undefined);
      }
      if (msg.type === 'track-list' && Array.isArray(msg.tracks)) {
        setTrackList(msg.tracks as Track[]);
      }
      if (msg.type === 'stream-url' && typeof msg.url === 'string') {
        setStreamUrl(msg.url as string);
      }
      if (msg.type === 'error' && (msg.code === 'ROOM_FULL' || msg.code === 'MAX_RECEIVERS')) {
        setRoomFull(true);
        addLog('Room is full. Listen via the radio stream instead.', 'warn');
      }
      if (msg.type === 'room-ended') {
        setRoomEnded(true);
        addLog('The broadcast was ended', 'warn');
      }
    });
    return unsub;
  }, [signaling, addLog]);

  const prevStatus = useRef<ConnectionStatus>('idle');
  useEffect(() => {
    if (webrtc.status !== prevStatus.current) {
      addLog(statusLabels[webrtc.status] || webrtc.status);
      prevStatus.current = webrtc.status;
    }
  }, [webrtc.status, addLog]);

  // Auto-join if roomId is in URL
  useEffect(() => {
    if (paramRoomId && signaling.connected && !joined) {
      handleJoin();
    }
  }, [paramRoomId, signaling.connected]);

  const handleJoin = () => {
    const rid = roomInput.trim();
    if (!rid) {
      addLog('Enter a room ID', 'warn');
      return;
    }
    setRoomFull(false);
    setRoomEnded(false);
    webrtc.joinAsReceiver(rid);
    setJoined(true);
    addLog('Tuning in…');
  };

  const applyVolume = useCallback((vol: number, isMuted: boolean) => {
    if (volumeGainRef.current) {
      volumeGainRef.current.gain.value = isMuted ? 0 : vol / 100;
    }
  }, []);

  const handleClickToListen = () => {
    if (webrtc.remoteStream) {
      setAudioStartFailed(false);
      // Use AudioContext for playback: preserves stereo on Safari
      // (Safari downmixes WebRTC audio to mono with a plain Audio element)
      const ctx = new AudioContext();
      playbackCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(webrtc.remoteStream);
      const gain = ctx.createGain();
      gain.gain.value = muted ? 0 : volume / 100;
      volumeGainRef.current = gain;
      source.connect(gain);
      gain.connect(ctx.destination);
      ctx.resume().then(() => {
        setAudioStarted(true);
        addLog('You\'re listening');
      }).catch(() => {
        setAudioStartFailed(true);
        addLog('Couldn\'t start playback. Tap again to retry.', 'error');
      });

      // Also set on an Audio element as fallback (some browsers need it)
      const audio = new Audio();
      audio.srcObject = webrtc.remoteStream;
      audio.volume = 0; // muted: the AudioContext handles actual playback
      audio.play().catch(() => {});
      audioElRef.current = audio;
    }
  };

  // Persist and apply volume changes
  useEffect(() => {
    applyVolume(volume, muted);
    try {
      localStorage.setItem(LISTENER_VOLUME_KEY, JSON.stringify({ volume, muted }));
    } catch {
      // Ignore quota errors
    }
  }, [volume, muted, applyVolume]);

  // Update playback source when remote stream changes
  useEffect(() => {
    if (webrtc.remoteStream && playbackCtxRef.current) {
      const ctx = playbackCtxRef.current;
      const source = ctx.createMediaStreamSource(webrtc.remoteStream);
      if (volumeGainRef.current) {
        source.connect(volumeGainRef.current);
      } else {
        source.connect(ctx.destination);
      }
    }
    if (webrtc.remoteStream && audioElRef.current) {
      audioElRef.current.srcObject = webrtc.remoteStream;
    }
  }, [webrtc.remoteStream]);

  // Buffering indicator: track mute/unmute on the remote audio track
  useEffect(() => {
    const stream = webrtc.remoteStream;
    if (!stream || !audioStarted) {
      setBuffering(false);
      return;
    }
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    const onMute = () => setBuffering(true);
    const onUnmute = () => setBuffering(false);
    setBuffering(track.muted);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
    return () => {
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
    };
  }, [webrtc.remoteStream, audioStarted]);

  // Detect integration rooms: joined + peer connected but no audio track after 5s
  useEffect(() => {
    if (joined && webrtc.peerConnected && !webrtc.remoteStream && !externalStream) {
      noAudioTimerRef.current = setTimeout(() => {
        setExternalStream(true);
        addLog('This broadcast is streaming externally');
      }, 5000);
    }
    if (webrtc.remoteStream) {
      if (noAudioTimerRef.current) {
        clearTimeout(noAudioTimerRef.current);
        noAudioTimerRef.current = null;
      }
      setExternalStream(false);
    }
    return () => {
      if (noAudioTimerRef.current) {
        clearTimeout(noAudioTimerRef.current);
        noAudioTimerRef.current = null;
      }
    };
  }, [joined, webrtc.peerConnected, webrtc.remoteStream, externalStream, addLog]);

  const activeRoomId = roomInput || paramRoomId || '';
  const effectiveStreamUrl = streamUrl || (activeRoomId ? streamLinkFor(activeRoomId) : null);

  const reconnecting = joined
    && webrtc.reconnectAttempt > 0
    && webrtc.reconnectAttempt <= webrtc.maxReconnectAttempts
    && webrtc.status === 'connecting';

  // Plain-language connection status
  const plainStatus: { label: string; tone: 'good' | 'warn' | 'bad' } | null = (() => {
    if (!joined || !audioStarted) return null;
    if (reconnecting) {
      return { label: `Reconnecting (attempt ${webrtc.reconnectAttempt} of ${webrtc.maxReconnectAttempts})`, tone: 'warn' };
    }
    if (buffering) return { label: 'Buffering…', tone: 'warn' };
    if (webrtc.iceConnectionState === 'connected' || webrtc.iceConnectionState === 'completed') {
      return { label: 'Streaming well', tone: 'good' };
    }
    if (webrtc.status === 'disconnected' || webrtc.status === 'error') {
      return { label: 'Connection lost', tone: 'bad' };
    }
    return { label: 'Unstable connection, adjusting…', tone: 'warn' };
  })();

  // Split "Artist - Title" style now-playing strings for the hero
  const npParts = (() => {
    const seps = [' — ', ' - ', ' – '];
    for (const sep of seps) {
      const idx = nowPlaying.indexOf(sep);
      if (idx > 0) {
        return { artist: nowPlaying.slice(0, idx).trim(), title: nowPlaying.slice(idx + sep.length).trim() };
      }
    }
    return { artist: '', title: nowPlaying };
  })();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <StatusBar status={webrtc.status} roomId={activeRoomId || null} />

      <div className="flex-1 p-4 max-w-4xl mx-auto w-full space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Headphones className="h-5 w-5 text-primary" aria-hidden />
            Receiver
          </h1>
          {joined && activeRoomId && <ShareLinks roomId={activeRoomId} />}
        </div>

        {/* Reconnecting state */}
        {reconnecting && (
          <div className="panel text-center py-8 space-y-3">
            <RefreshCw className="h-8 w-8 text-muted-foreground animate-spin mx-auto" aria-hidden />
            <p className="text-sm text-foreground font-semibold">Reconnecting…</p>
            <p className="text-xs text-muted-foreground">
              Attempt {webrtc.reconnectAttempt} of {webrtc.maxReconnectAttempts}
            </p>
          </div>
        )}

        {/* Room full: hand off to the radio stream */}
        {roomFull && effectiveStreamUrl && (
          <div className="panel py-6 px-5 space-y-4 text-center">
            <Radio className="h-8 w-8 text-primary mx-auto" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">This room is full</p>
              <p className="text-xs text-muted-foreground mt-1">
                Live listening slots are taken, but you can still tune in through the radio stream below.
              </p>
            </div>
            <audio controls src={effectiveStreamUrl} className="w-full max-w-sm mx-auto" aria-label="Radio stream player" />
            <p className="text-[11px] font-mono text-muted-foreground break-all">{effectiveStreamUrl}</p>
          </div>
        )}

        {/* Broadcast force-ended */}
        {roomEnded && (
          <div className="panel text-center py-8 space-y-2">
            <Radio className="h-8 w-8 text-muted-foreground/40 mx-auto" aria-hidden />
            <p className="text-sm font-semibold text-foreground">This broadcast has ended</p>
            <p className="text-xs text-muted-foreground">Thanks for listening.</p>
          </div>
        )}

        {/* Off-air / not joined / error: message + room ID input */}
        {!roomFull && !roomEnded && (!joined || (joined && !webrtc.remoteStream && webrtc.reconnectAttempt === 0 && (webrtc.status === 'error' || webrtc.status === 'disconnected'))) && (
          <div className="panel text-center py-10 space-y-5">
            <div>
              <Radio className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" aria-hidden />
              <p className="text-sm text-muted-foreground">This broadcast isn't on air right now</p>
            </div>
            <div className="max-w-sm mx-auto">
              <p className="text-xs text-muted-foreground/60 mb-2">Have a Room ID? Paste it below to tune in.</p>
              <div className="flex gap-2">
                <input
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  placeholder="Enter room ID"
                  aria-label="Room ID"
                  className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={handleJoin}
                  disabled={!signaling.connected}
                  className="bg-primary text-primary-foreground rounded-md px-6 py-2 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  Join
                </button>
              </div>
              {joined && (webrtc.status === 'error' || webrtc.status === 'disconnected') && (
                <button
                  onClick={webrtc.retryConnection}
                  className="mt-4 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Retry this broadcast
                </button>
              )}
            </div>
          </div>
        )}

        {/* Connection lost after max retries */}
        {joined && webrtc.reconnectAttempt > webrtc.maxReconnectAttempts && webrtc.status === 'disconnected' && (
          <div className="panel text-center py-8 space-y-3">
            <Radio className="h-8 w-8 text-muted-foreground/40 mx-auto" aria-hidden />
            <p className="text-sm text-foreground font-semibold">Connection lost</p>
            <p className="text-xs text-muted-foreground">
              Couldn't reconnect after {webrtc.maxReconnectAttempts} attempts
            </p>
            <button
              onClick={webrtc.retryConnection}
              className="text-xs text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Tap to Listen */}
        {joined && webrtc.remoteStream && !audioStarted && (
          <button
            onClick={handleClickToListen}
            className="w-full py-12 rounded-lg bg-primary/10 border-2 border-primary/30 text-primary hover:bg-primary/20 transition-colors flex flex-col items-center gap-3"
          >
            <Volume2 className="h-12 w-12" aria-hidden />
            <span className="text-lg font-semibold">{audioStartFailed ? 'Tap again to start audio' : 'Tap to Listen'}</span>
            <span className="text-xs text-muted-foreground">
              {audioStartFailed
                ? 'Playback was blocked by the browser. One more tap should do it.'
                : 'The broadcast is ready. Tap to start audio.'}
            </span>
          </button>
        )}

        {/* External stream notice */}
        {joined && externalStream && !webrtc.remoteStream && !roomFull && !roomEnded && (
          <div className="panel text-center py-8 space-y-2">
            <ExternalLink className="h-8 w-8 text-primary mx-auto" aria-hidden />
            <p className="text-sm font-semibold text-foreground">This broadcast is streaming externally</p>
            <p className="text-xs text-muted-foreground">
              Audio is being broadcast on an external platform. You can still use chat below.
            </p>
          </div>
        )}

        {/* Waiting state */}
        {joined && !webrtc.remoteStream && !externalStream && !roomFull && !roomEnded && webrtc.status !== 'error' && webrtc.status !== 'disconnected' && (
          <div className="panel text-center py-8">
            <div className="text-muted-foreground text-sm">Connecting to broadcast…</div>
            <div className="text-xs text-muted-foreground/60 mt-1">
              Hang tight, we're setting up the connection
            </div>
          </div>
        )}

        {/* Now Playing hero + player controls */}
        {audioStarted && (
          <div className="panel">
            <div className="flex gap-4 items-center flex-wrap sm:flex-nowrap">
              {nowPlayingCover ? (
                <img
                  src={nowPlayingCover}
                  alt=""
                  className="w-28 h-28 sm:w-32 sm:h-32 rounded-lg shadow-xl ring-1 ring-white/10 bg-secondary shrink-0"
                />
              ) : (
                <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-lg bg-secondary/60 ring-1 ring-white/10 flex items-center justify-center shrink-0">
                  <Disc3
                    className="h-12 w-12 text-muted-foreground/30 animate-spin"
                    style={{ animationDuration: '4s' }}
                    aria-hidden
                  />
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-1">
                    Now Playing
                  </p>
                  {nowPlaying ? (
                    <>
                      <p className="text-lg font-bold text-foreground leading-tight truncate">{npParts.title}</p>
                      {npParts.artist && (
                        <p className="text-sm text-primary/90 truncate">{npParts.artist}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Live broadcast</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setMuted((m) => !m)}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    aria-pressed={muted}
                    className={`h-9 w-9 flex items-center justify-center rounded-full transition-colors shrink-0 ${
                      muted ? 'bg-destructive/20 text-destructive' : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
                  </button>
                  <Slider
                    value={[muted ? 0 : volume]}
                    onValueChange={([v]) => {
                      setVolume(v);
                      if (muted && v > 0) setMuted(false);
                    }}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                    aria-label="Playback volume"
                  />
                  <span className="text-xs font-mono tabular-nums text-muted-foreground w-9 text-right shrink-0">
                    {muted ? '0%' : `${volume}%`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Plain-language connection status */}
        {plainStatus && (
          <div className="panel !py-2.5 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-2 text-xs text-foreground">
              <span
                className={`h-2 w-2 rounded-full ${
                  plainStatus.tone === 'good'
                    ? 'bg-primary shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                    : plainStatus.tone === 'warn'
                      ? 'bg-yellow-400'
                      : 'bg-destructive'
                }`}
                aria-hidden
              />
              {plainStatus.label}
            </span>
            <button
              onClick={() => setShowTechnical((s) => !s)}
              className="ml-auto flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={showTechnical}
            >
              Technical details
              <ChevronDown className={`h-3 w-3 transition-transform ${showTechnical ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          </div>
        )}

        {/* Level meter (inside technical details once playing; always visible pre-detail) */}
        {audioStarted && showTechnical && (
          <LevelMeter
            left={audioAnalysis.left}
            right={audioAnalysis.right}
            label="Output Level"
          />
        )}

        {/* Track List */}
        {joined && !roomFull && (
          <TrackList
            tracks={trackList}
            alwaysShow
            roomId={activeRoomId || undefined}
          />
        )}

        {/* Technical details: health + log */}
        {joined && showTechnical && webrtc.status !== 'error' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <HealthPanel
              role="receiver"
              stats={webrtc.stats}
              connectionState={webrtc.connectionState}
              iceConnectionState={webrtc.iceConnectionState}
              signalingState={webrtc.signalingState}
              peerConnected={webrtc.peerConnected}
            />
            <EventLog entries={logs} />
          </div>
        )}
      </div>

      <Footer />

      {/* Chat FAB: visible as soon as the receiver has joined a room */}
      <ChatPanel signaling={signaling} active={joined && !roomFull} />
    </div>
  );
};

export default Receiver;
