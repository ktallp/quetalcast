import { Gauge } from 'lucide-react';
import type { ChannelAnalysis } from '@/hooks/useAudioAnalyser';

interface LevelMeterProps {
  left: ChannelAnalysis;
  right: ChannelAnalysis;
  label?: string;
  segments?: number;
  /** Hardware skin: render analog VU faces instead of LED segment bars */
  hardware?: boolean;
}

const MIN_DB = -60;
const MAX_DB = 0;

/** Map a dBFS value to a 0–1 position on the meter */
function dbToPosition(db: number): number {
  const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
  return (clamped - MIN_DB) / (MAX_DB - MIN_DB);
}

const pos12 = dbToPosition(-12);
const pos6 = dbToPosition(-6);

const SCALE_MARKS = [
  { db: -48, label: '-48' },
  { db: -36, label: '-36' },
  { db: -24, label: '-24' },
  { db: -18, label: '-18' },
  { db: -12, label: '-12' },
  { db: -6, label: '-6' },
  { db: 0, label: '0' },
];

function MeterBar({ channel, segments, channelLabel }: { channel: ChannelAnalysis; segments: number; channelLabel: string }) {
  const levelPos = dbToPosition(channel.level);
  const peakPos = dbToPosition(channel.peak);
  const activeSegments = Math.round(levelPos * segments);
  const peakSegment = Math.round(peakPos * segments);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-muted-foreground w-3 text-right shrink-0">{channelLabel}</span>
      <div className="flex gap-[2px] h-3 items-end flex-1">
        {Array.from({ length: segments }).map((_, i) => {
          const ratio = i / segments;
          const isActive = i < activeSegments;
          const isPeak = i === peakSegment && channel.peak > MIN_DB + 1;

          let colorClass = 'bg-muted/40';
          if (isActive || isPeak) {
            if (ratio < pos12) colorClass = 'meter-segment-active-green';
            else if (ratio < pos6) colorClass = 'meter-segment-active-yellow';
            else colorClass = 'meter-segment-active-red';
          }

          return (
            <div
              key={i}
              className={`meter-segment flex-1 h-full ${colorClass} ${isPeak && !isActive ? 'opacity-60' : ''}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Analog VU face: the needle sweeps a real VU-style scale (-20 to +3 VU
 * mapped over dBFS) and the 250 ms CSS transition approximates classic
 * VU ballistics, showing perceived loudness rather than instant peaks.
 */
function AnalogVu({ channel, channelLabel }: { channel: ChannelAnalysis; channelLabel: string }) {
  const position = Math.max(0, Math.min(1, (channel.level + 23) / 25));
  const angle = -46 + position * 92;

  return (
    <div className="vu-face flex-1" role="img" aria-label={`${channelLabel} channel VU meter`}>
      <div className="vu-dial">
        <div className="vu-arc" />
        <div className="vu-needle" style={{ transform: `rotate(${angle}deg)` }} />
        <div className="vu-hub" />
      </div>
      <span className="vu-tag font-mono">VU · {channelLabel}</span>
    </div>
  );
}

export function LevelMeter({ left, right, label = 'Level', segments = 48, hardware }: LevelMeterProps) {
  const clipping = left.clipping || right.clipping;
  const maxLevel = Math.max(left.level, right.level);
  const maxPeak = Math.max(left.peak, right.peak);

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-2">
        <span className="panel-header flex items-center gap-1.5 mb-0">
          <Gauge className="h-3.5 w-3.5" />
          {label}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums min-w-[3.5rem]">
            {maxLevel > MIN_DB ? `${maxLevel.toFixed(1)} dB` : '0.00 dB'}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums min-w-[3.5rem]">
            pk {maxPeak > MIN_DB ? maxPeak.toFixed(1) : '0.00'}
          </span>
          {clipping && (
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-destructive animate-pulse">
              CLIP
            </span>
          )}
        </div>
      </div>
      {hardware ? (
        <div className="flex gap-2">
          <AnalogVu channel={left} channelLabel="L" />
          <AnalogVu channel={right} channelLabel="R" />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <MeterBar channel={left} segments={segments} channelLabel="L" />
            <MeterBar channel={right} segments={segments} channelLabel="R" />
          </div>
          <div className="relative mt-1 ml-5 h-3">
            {SCALE_MARKS.map((mark) => (
              <span
                key={mark.db}
                className="absolute text-[9px] font-mono text-muted-foreground -translate-x-1/2"
                style={{ left: `${dbToPosition(mark.db) * 100}%` }}
              >
                {mark.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
