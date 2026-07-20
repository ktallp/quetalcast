import { useCallback, useRef } from 'react';
import { Headphones, MicOff as _MicOff } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

export interface ChannelStripState {
  id: 'mic' | 'pads' | 'system';
  label: string;
  level: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  monitor: boolean;
  /** System audio is inactive until connected */
  active: boolean;
  /** Show the auto-duck toggle on this channel */
  duckable?: boolean;
  /** Auto-duck under mic enabled */
  duck?: boolean;
}

export type ChannelPatch = Partial<
  Pick<ChannelStripState, 'volume' | 'muted' | 'solo' | 'pan' | 'monitor' | 'duck'>
>;

interface MixerBoardProps {
  channels: ChannelStripState[];
  onChange: (id: ChannelStripState['id'], patch: ChannelPatch) => void;
  /** True while music channels are actively being ducked under the mic */
  duckActive?: boolean;
}

/** Rotary pan control: pointer drag, wheel, and full keyboard support. */
export function PanKnob({
  value,
  onChange,
  disabled = false,
  label = 'Pan',
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const clamped = Math.max(-100, Math.min(100, value));
  const angle = (clamped / 100) * 135;
  const display = clamped === 0 ? 'C' : clamped < 0 ? `L${Math.abs(clamped)}` : `R${clamped}`;
  const knobRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startValue: number } | null>(null);

  const nudge = useCallback(
    (delta: number) => {
      if (disabled) return;
      onChange(Math.max(-100, Math.min(100, clamped + delta)));
    },
    [disabled, onChange, clamped],
  );

  return (
    <div className={`relative hidden sm:flex items-center justify-center w-14 ${disabled ? 'opacity-40' : ''}`}>
      <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono text-muted-foreground" aria-hidden>
        {display}
      </span>
      <div
        ref={knobRef}
        role="slider"
        aria-label={label}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={clamped === 0 ? 'Center' : clamped < 0 ? `Left ${Math.abs(clamped)}` : `Right ${clamped}`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className={`relative h-10 w-10 rounded-full border border-border/80 bg-gradient-to-b from-secondary to-background shadow-[inset_0_1px_4px_rgba(0,0,0,0.55),0_1px_2px_rgba(0,0,0,0.35)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
        onKeyDown={(e) => {
          if (disabled) return;
          switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
              e.preventDefault();
              nudge(e.shiftKey ? -10 : -3);
              break;
            case 'ArrowRight':
            case 'ArrowUp':
              e.preventDefault();
              nudge(e.shiftKey ? 10 : 3);
              break;
            case 'Home':
              e.preventDefault();
              onChange(0);
              break;
          }
        }}
        onDoubleClick={() => {
          if (disabled) return;
          onChange(0);
        }}
        onWheel={(e) => {
          e.preventDefault();
          nudge(e.deltaY > 0 ? -3 : 3);
        }}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startValue: clamped,
          };
          knobRef.current?.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId || disabled) return;
          const dx = e.clientX - drag.startX;
          const dy = drag.startY - e.clientY;
          const next = drag.startValue + (dx + dy) * 0.9;
          onChange(Math.max(-100, Math.min(100, Math.round(next))));
        }}
        onPointerUp={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) {
            dragRef.current = null;
            if (knobRef.current?.hasPointerCapture(e.pointerId)) {
              knobRef.current.releasePointerCapture(e.pointerId);
            }
          }
        }}
        onPointerCancel={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) {
            dragRef.current = null;
            if (knobRef.current?.hasPointerCapture(e.pointerId)) {
              knobRef.current.releasePointerCapture(e.pointerId);
            }
          }
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-[88%] rounded bg-primary shadow-[0_0_6px_rgba(34,197,94,0.35)]"
          style={{ transform: `translate(-50%, -88%) rotate(${angle}deg)`, transformOrigin: '50% 150%' }}
        />
      </div>
    </div>
  );
}

/** Touch-friendly pan control shown on small screens instead of the knob. */
function PanSegments({
  value,
  onChange,
  disabled = false,
  label = 'Pan',
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const options: Array<{ key: string; v: number }> = [
    { key: 'L', v: -60 },
    { key: 'C', v: 0 },
    { key: 'R', v: 60 },
  ];
  const selected = value < -20 ? 'L' : value > 20 ? 'R' : 'C';
  return (
    <div
      className={`flex sm:hidden rounded-md border border-border overflow-hidden ${disabled ? 'opacity-40' : ''}`}
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.key}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          aria-label={`${label} ${o.key === 'L' ? 'left' : o.key === 'R' ? 'right' : 'center'}`}
          aria-pressed={selected === o.key}
          className={`px-2.5 py-1 text-[10px] font-mono ${
            selected === o.key ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'
          }`}
        >
          {o.key}
        </button>
      ))}
    </div>
  );
}

export function VolumeLeds({ level, disabled = false }: { level: number; disabled?: boolean }) {
  const clamped = Math.max(0, Math.min(1, level));
  const ledCount = 10;
  const activeCount = disabled ? 0 : Math.round(clamped * ledCount);

  return (
    <div className={`inline-flex flex-col-reverse items-center gap-0.5 ${disabled ? 'opacity-30' : ''}`} aria-hidden>
      {Array.from({ length: ledCount }).map((_, i) => {
        const active = i < activeCount;
        const tone = i >= 9 ? 'danger' : i >= 7 ? 'warn' : 'safe';
        const activeClass =
          tone === 'danger'
            ? 'bg-red-500/95 border-red-400/80 shadow-[0_0_4px_rgba(239,68,68,0.55)]'
            : tone === 'warn'
              ? 'bg-yellow-400/95 border-yellow-300/80 shadow-[0_0_4px_rgba(250,204,21,0.5)]'
              : 'bg-primary/95 border-primary/70 shadow-[0_0_4px_rgba(34,197,94,0.45)]';

        return (
          <span
            key={i}
            className={`h-1 w-2 rounded-[2px] border ${active ? activeClass : 'bg-muted/25 border-border/40'}`}
          />
        );
      })}
    </div>
  );
}

function ChannelStrip({
  channel,
  onChange,
  duckActive,
}: {
  channel: ChannelStripState;
  onChange: (patch: ChannelPatch) => void;
  duckActive?: boolean;
}) {
  const c = channel;
  const controlsDisabled = !c.active;
  const volumeLabel = c.active ? (c.muted ? '—' : `${c.volume}%`) : 'OFF';

  return (
    <div
      className={`rounded-md border p-2.5 space-y-2 bg-gradient-to-b from-background to-background/60 ${
        c.active ? 'border-border/70' : 'border-border/40 opacity-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-start gap-2 shrink-0 min-w-[126px]">
          <VolumeLeds level={c.level} disabled={!c.active || c.muted} />
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-foreground">
              {c.label}{' '}
              <span className="font-mono text-muted-foreground tabular-nums">{volumeLabel}</span>
              {c.duckable && c.duck && (
                <span
                  className={`inline-flex items-center gap-1 ml-1.5 align-middle text-[8px] font-mono uppercase tracking-widest ${
                    duckActive ? 'text-accent' : 'text-muted-foreground/40'
                  }`}
                  title={duckActive ? 'Auto-duck engaged: dipped about 9 dB under the mic' : 'Auto-duck armed'}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      duckActive
                        ? 'bg-accent shadow-[0_0_6px_hsl(var(--accent))] motion-safe:animate-pulse'
                        : 'bg-muted-foreground/30'
                    }`}
                    aria-hidden
                  />
                  duck
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onChange({ muted: !c.muted })}
                disabled={controlsDisabled}
                aria-label={c.muted ? `Unmute ${c.label}` : `Mute ${c.label}`}
                aria-pressed={c.muted}
                className={`size-7 flex items-center justify-center rounded text-[10px] font-mono ${
                  c.muted ? 'bg-destructive/20 text-destructive' : 'bg-secondary text-muted-foreground'
                } disabled:opacity-40`}
                title={`${c.label} mute`}
              >
                M
              </button>
              <button
                onClick={() => onChange({ solo: !c.solo })}
                disabled={controlsDisabled}
                aria-label={c.solo ? `Unsolo ${c.label}` : `Solo ${c.label}`}
                aria-pressed={c.solo}
                className={`size-7 flex items-center justify-center rounded text-[10px] font-mono ${
                  c.solo ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'
                } disabled:opacity-40`}
                title={`${c.label} solo`}
              >
                S
              </button>
              <button
                onClick={() => onChange({ monitor: !c.monitor })}
                disabled={controlsDisabled}
                aria-label={c.monitor ? `Stop monitoring ${c.label} in headphones` : `Monitor ${c.label} in headphones`}
                aria-pressed={c.monitor}
                className={`size-7 flex items-center justify-center rounded ${
                  c.monitor ? 'bg-emerald-500/20 text-emerald-400' : 'bg-secondary text-muted-foreground'
                } disabled:opacity-40`}
                title={c.monitor ? `Disable ${c.label} monitor` : `Monitor ${c.label} locally`}
              >
                <Headphones className="h-3 w-3" aria-hidden />
              </button>
              {c.duckable && (
                <button
                  onClick={() => onChange({ duck: !c.duck })}
                  disabled={controlsDisabled}
                  aria-label={c.duck ? `Stop ducking ${c.label} under the mic` : `Auto-duck ${c.label} under the mic`}
                  aria-pressed={c.duck}
                  className={`h-7 px-1.5 flex items-center justify-center rounded text-[9px] font-mono uppercase tracking-wide ${
                    c.duck
                      ? duckActive
                        ? 'bg-accent/30 text-accent animate-pulse'
                        : 'bg-accent/20 text-accent'
                      : 'bg-secondary text-muted-foreground'
                  } disabled:opacity-40`}
                  title="Auto-duck this channel under the mic while you speak"
                >
                  Duck
                </button>
              )}
            </div>
          </div>
        </div>
        <Slider
          value={[c.volume]}
          onValueChange={([v]) => onChange({ volume: v })}
          min={0}
          max={100}
          step={1}
          disabled={controlsDisabled}
          sliderVariant="mixer"
          className="flex-1 min-w-0"
          aria-label={`${c.label} volume`}
        />
        <PanKnob value={c.pan} onChange={(v) => onChange({ pan: v })} disabled={controlsDisabled} label={`${c.label} pan`} />
        <PanSegments value={c.pan} onChange={(v) => onChange({ pan: v })} disabled={controlsDisabled} label={`${c.label} pan`} />
      </div>
    </div>
  );
}

/** Always-visible mixer: one strip per channel with level LEDs, M/S/monitor, duck, volume, and pan. */
export function MixerBoard({ channels, onChange, duckActive }: MixerBoardProps) {
  return (
    <div className="space-y-3">
      {channels.map((c) => (
        <ChannelStrip key={c.id} channel={c} onChange={(patch) => onChange(c.id, patch)} duckActive={duckActive} />
      ))}
    </div>
  );
}
