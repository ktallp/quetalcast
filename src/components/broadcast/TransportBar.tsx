import { Mic, MicOff, Headphones, Circle, Square, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface TransportBarProps {
  isOnAir: boolean;
  goingOnAir: boolean;
  canGoOnAir: boolean;
  elapsedSeconds: number;
  onGoOnAir: () => void;
  onEndBroadcast: () => void;
  recording: boolean;
  recordElapsed: number;
  recordLabel: string;
  canRecord: boolean;
  onToggleRecording: () => void;
  muted: boolean;
  onToggleMute: () => void;
  listening: boolean;
  onToggleListen: () => void;
  cueMode: boolean;
  onToggleCue: () => void;
  limiterDb: 0 | -3 | -6 | -12;
  onLimiterChange: (value: string) => void;
}

/**
 * Persistent transport row: Go On Air / End Broadcast, Record, Mute,
 * Listen, Cue, and the output limiter, always visible at the top of
 * the console.
 */
export function TransportBar(props: TransportBarProps) {
  const {
    isOnAir,
    goingOnAir,
    canGoOnAir,
    elapsedSeconds,
    onGoOnAir,
    onEndBroadcast,
    recording,
    recordElapsed,
    recordLabel,
    canRecord,
    onToggleRecording,
    muted,
    onToggleMute,
    listening,
    onToggleListen,
    cueMode,
    onToggleCue,
    limiterDb,
    onLimiterChange,
  } = props;

  const toggleBtn = (activeClass: string) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${activeClass}`;

  return (
    <div className="panel space-y-3">
      <div className="flex gap-3">
        {!isOnAir ? (
          <button
            onClick={onGoOnAir}
            disabled={goingOnAir || !canGoOnAir}
            aria-busy={goingOnAir}
            className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-md text-sm font-semibold transition-all ${
              goingOnAir || !canGoOnAir
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:opacity-90 animate-pulse-on-air'
            }`}
          >
            {goingOnAir ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                Requesting mic…
              </>
            ) : (
              <>
                <Mic className="h-5 w-5" aria-hidden />
                Go On Air
              </>
            )}
          </button>
        ) : (
          <button
            onClick={onEndBroadcast}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-md text-sm font-semibold transition-all bg-destructive text-destructive-foreground hover:opacity-90"
          >
            <MicOff className="h-5 w-5" aria-hidden />
            End Broadcast
            <span className="font-mono tabular-nums font-normal opacity-90">{formatClock(elapsedSeconds)}</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onToggleRecording}
          disabled={!recording && !canRecord}
          aria-pressed={recording}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          className={toggleBtn(
            recording
              ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
              : 'bg-secondary text-muted-foreground hover:text-foreground',
          )}
          title={recording ? recordLabel : 'Record the broadcast as a 320 kbps MP3'}
        >
          {recording ? (
            <>
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
              <span className="font-mono tabular-nums">{formatClock(recordElapsed)}</span>
            </>
          ) : (
            <>
              <Circle className="h-3.5 w-3.5 fill-current" aria-hidden />
              Rec
            </>
          )}
        </button>
        <button
          onClick={onToggleMute}
          disabled={!isOnAir}
          aria-pressed={muted}
          className={toggleBtn(
            muted ? 'bg-destructive/20 text-destructive' : 'bg-secondary text-muted-foreground hover:text-foreground',
          )}
          title={muted ? 'Unmute all channels (Space)' : 'Mute all channels (Space)'}
        >
          <MicOff className="h-3.5 w-3.5" aria-hidden />
          {muted ? 'Muted' : 'Mute'}
        </button>
        <button
          onClick={onToggleListen}
          disabled={!isOnAir}
          aria-pressed={listening}
          className={toggleBtn(
            listening ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground',
          )}
          title={listening ? 'Stop listening (L)' : 'Listen to your broadcast (L)'}
        >
          <Headphones className="h-3.5 w-3.5" aria-hidden />
          Listen
        </button>
        <button
          onClick={onToggleCue}
          disabled={!isOnAir}
          aria-pressed={cueMode}
          className={`px-3 py-2 rounded-md text-xs font-mono font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            cueMode ? 'bg-accent/20 text-accent' : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
          title={cueMode ? 'Cue mode on: sounds are local only (C)' : 'Enable cue mode (C)'}
        >
          CUE
        </button>
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Limit</span>
          <Select value={String(limiterDb)} onValueChange={onLimiterChange}>
            <SelectTrigger className="w-[92px] h-8 bg-secondary border-border text-xs font-mono" aria-label="Output limiter ceiling">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0" className="text-xs font-mono">0 dB</SelectItem>
              <SelectItem value="-3" className="text-xs font-mono">-3 dB</SelectItem>
              <SelectItem value="-6" className="text-xs font-mono">-6 dB</SelectItem>
              <SelectItem value="-12" className="text-xs font-mono">-12 dB</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
