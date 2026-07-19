import { useEffect, useRef, useState } from 'react';
import {
  AudioLines, MicVocal, Timer, SlidersHorizontal, Gauge, Wand2, Settings,
  ListMusic, Trash2, Ear, RadioTower, Waves, Redo2, ArrowDownWideNarrow, Scissors,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  type EffectName,
  type FxName,
  type UseMicEffectsReturn,
  EFFECT_LABELS,
} from '@/hooks/useMicEffects';
import { useSoundCheck, calibrationFromMeasurement } from '@/hooks/useSoundCheck';
import { type Preset } from '@/lib/presets';

// ── Props ──────────────────────────────────────────────────────────

interface EffectsBoardProps {
  engine: UseMicEffectsReturn;
  presets: Preset[];
  onApplyPreset: (preset: Preset) => void;
  onSavePresetOpen: () => void;
  onRequestDeletePreset: (name: string) => void;
  getAnalyserData: () => Float32Array | null;
  onLog?: (msg: string) => void;
}

// ── Config ─────────────────────────────────────────────────────────

/** Always-useful voice processing, on the left of the chain */
const VOICE_EFFECTS: EffectName[] = ['enhance', 'tone', 'compressor', 'deEsser'];
/** Creative effects that stay in the chain when enabled */
const MANUAL_FX: EffectName[] = ['voiceShift', 'delay', 'echo'];

const EFFECT_ICONS: Record<EffectName, React.ComponentType<{ className?: string }>> = {
  enhance: Wand2,
  tone: SlidersHorizontal,
  compressor: Gauge,
  deEsser: Scissors,
  voiceShift: MicVocal,
  delay: Timer,
  echo: AudioLines,
};

const FX_PADS: Array<{ name: FxName; label: string; keycap: string; icon: React.ComponentType<{ className?: string }> }> = [
  { name: 'radioVoice', label: 'Radio Voice', keycap: 'Q', icon: RadioTower },
  { name: 'bigRoom', label: 'Big Room', keycap: 'W', icon: Waves },
  { name: 'slapback', label: 'Slapback', keycap: 'E', icon: Redo2 },
  { name: 'pitchDrop', label: 'Pitch Drop', keycap: 'T', icon: ArrowDownWideNarrow },
];

interface SliderConfig {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  formatValue?: (v: number) => string;
  minLabel?: string;
  maxLabel?: string;
}

const EFFECT_SETTINGS: Record<EffectName, SliderConfig[]> = {
  enhance: [
    {
      key: 'gate', label: 'Noise Gate',
      description: 'Cuts background noise when you\'re not speaking. Higher = more aggressive.',
      min: 0, max: 100, step: 1, defaultValue: 30,
      minLabel: 'Off', maxLabel: 'Aggressive',
    },
    {
      key: 'cleanup', label: 'Clean Up',
      description: 'Removes low-end rumble, hum, and plosives.',
      min: 0, max: 100, step: 1, defaultValue: 30,
      minLabel: 'None', maxLabel: 'Heavy',
    },
    {
      key: 'clarity', label: 'Clarity',
      description: 'Adds presence to make your voice cut through clearly.',
      min: 0, max: 100, step: 1, defaultValue: 0,
      formatValue: (v) => `+${Math.round((v / 100) * 12)} dB`,
    },
  ],
  tone: [
    {
      key: 'bass', label: 'Bass',
      description: 'Boost or cut the low end.',
      min: -12, max: 12, step: 1, defaultValue: 0,
      formatValue: (v) => `${v > 0 ? '+' : ''}${v} dB`,
    },
    {
      key: 'mids', label: 'Mids',
      description: 'Boost or cut the middle range.',
      min: -12, max: 12, step: 1, defaultValue: 0,
      formatValue: (v) => `${v > 0 ? '+' : ''}${v} dB`,
    },
    {
      key: 'treble', label: 'Treble',
      description: 'Boost or cut the high end.',
      min: -12, max: 12, step: 1, defaultValue: 0,
      formatValue: (v) => `${v > 0 ? '+' : ''}${v} dB`,
    },
  ],
  compressor: [
    {
      key: 'amount', label: 'Amount',
      description: 'How much compression to apply. Low = gentle leveling, high = heavy squash.',
      min: 0, max: 100, step: 1, defaultValue: 50,
      minLabel: 'Light', maxLabel: 'Heavy',
      formatValue: (v) => `${v}%`,
    },
    {
      key: 'speed', label: 'Speed',
      description: 'How fast the compressor reacts. Slow = smooth, fast = punchy.',
      min: 0, max: 100, step: 1, defaultValue: 50,
      minLabel: 'Smooth', maxLabel: 'Punchy',
    },
    {
      key: 'makeup', label: 'Makeup Gain',
      description: 'Boost the output volume to compensate for compression.',
      min: 0, max: 100, step: 1, defaultValue: 0,
      formatValue: (v) => `+${Math.round((v / 100) * 24)} dB`,
    },
  ],
  deEsser: [
    {
      key: 'amount', label: 'Amount',
      description: 'Tames harsh "s" sounds. Higher = stronger taming.',
      min: 0, max: 100, step: 1, defaultValue: 40,
      minLabel: 'Light', maxLabel: 'Strong',
      formatValue: (v) => `${v}%`,
    },
  ],
  voiceShift: [
    {
      key: 'shift', label: 'Pitch',
      description: 'Shifts your voice pitch. Left for deep, right for high.',
      min: 0, max: 100, step: 1, defaultValue: 50,
      minLabel: 'Deep', maxLabel: 'High',
    },
  ],
  delay: [
    {
      key: 'timing', label: 'Timing',
      description: 'How far apart the repeats are. Low = fast repeats, high = slow.',
      min: 0, max: 100, step: 1, defaultValue: 30,
    },
    {
      key: 'repeats', label: 'Repeats',
      description: 'How many times the sound bounces back.',
      min: 0, max: 100, step: 1, defaultValue: 30,
    },
    {
      key: 'amount', label: 'Amount',
      description: 'How loud the repeats are compared to your voice.',
      min: 0, max: 100, step: 1, defaultValue: 50,
      formatValue: (v) => `${v}%`,
    },
  ],
  echo: [
    {
      key: 'space', label: 'Space',
      description: 'How big the room sounds. Small = tight, large = cathedral.',
      min: 0, max: 100, step: 1, defaultValue: 50,
    },
    {
      key: 'fade', label: 'Fade',
      description: 'How long the reverb lingers before fading out.',
      min: 0, max: 100, step: 1, defaultValue: 50,
    },
    {
      key: 'amount', label: 'Amount',
      description: 'How much reverb is mixed in with your voice.',
      min: 0, max: 100, step: 1, defaultValue: 30,
      formatValue: (v) => `${v}%`,
    },
  ],
};

const LATCH_TAP_MS = 250;

// ── Component ──────────────────────────────────────────────────────

export function EffectsBoard({
  engine,
  presets,
  onApplyPreset,
  onSavePresetOpen,
  onRequestDeletePreset,
  getAnalyserData,
  onLog,
}: EffectsBoardProps) {
  const [editEffect, setEditEffect] = useState<EffectName | null>(null);
  const [meter, setMeter] = useState({ reductionDb: 0, gateOpen: true });
  const [soundCheckOpen, setSoundCheckOpen] = useState(false);
  const fxDownAtRef = useRef<Partial<Record<FxName, number>>>({});
  const fxLatchedRef = useRef<Partial<Record<FxName, boolean>>>({});

  const { effects, toggleEffect, updateEffect } = engine;

  // Poll the compressor gain reduction and gate state for the live meters
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (ts - last >= 100) {
        last = ts;
        const next = engine.getMeterState();
        setMeter((prev) =>
          prev.gateOpen === next.gateOpen && Math.abs(prev.reductionDb - next.reductionDb) < 0.2
            ? prev
            : next,
        );
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [engine]);

  const soundCheck = useSoundCheck({ getAnalyserData });

  const openSettings = (name: EffectName, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditEffect(name);
  };

  const handleToggle = (name: EffectName) => {
    const wasEnabled = effects[name].enabled;
    toggleEffect(name);
    if (!wasEnabled) setEditEffect(name);
  };

  const handleParamChange = (key: string, value: number) => {
    if (editEffect) updateEffect(editEffect, { [key]: value });
  };

  const handleFxDown = (name: FxName) => {
    if (fxLatchedRef.current[name]) {
      // Tapping a latched pad releases it
      fxLatchedRef.current[name] = false;
      fxDownAtRef.current[name] = undefined;
      engine.releaseFx(name);
      return;
    }
    fxDownAtRef.current[name] = performance.now();
    engine.triggerFx(name);
  };

  const handleFxUp = (name: FxName) => {
    const downAt = fxDownAtRef.current[name];
    if (downAt === undefined) return;
    fxDownAtRef.current[name] = undefined;
    if (performance.now() - downAt < LATCH_TAP_MS) {
      // Quick tap latches the effect on until tapped again
      fxLatchedRef.current[name] = true;
    } else {
      engine.releaseFx(name);
    }
  };

  const applySoundCheck = () => {
    if (!soundCheck.result) return;
    const cal = calibrationFromMeasurement(soundCheck.result);
    if (!effects.enhance.enabled) toggleEffect('enhance');
    if (!effects.compressor.enabled) toggleEffect('compressor');
    updateEffect('enhance', cal.enhance);
    updateEffect('compressor', cal.compressor);
    onLog?.(
      `Sound check applied: noise floor ${soundCheck.result.noiseDb.toFixed(0)} dB, voice ${soundCheck.result.speechDb.toFixed(0)} dB`,
    );
    setSoundCheckOpen(false);
    soundCheck.cancel();
  };

  const chipClass = (enabled: boolean) =>
    `relative flex items-center gap-1.5 pl-2.5 pr-7 py-2 rounded-md border text-[11px] font-mono transition-all ${
      enabled
        ? 'border-primary bg-primary/15 text-primary glow-ring'
        : 'border-border bg-secondary/50 text-muted-foreground hover:bg-secondary'
    }`;

  const reductionWidth = Math.min(1, Math.max(0, -meter.reductionDb) / 20);

  return (
    <div className="space-y-5">
      {/* ── Voice section ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Voice</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSoundCheckOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground bg-secondary transition-colors"
              title="Optional: measure your room and tune the voice chain automatically"
            >
              <Ear className="h-3 w-3" aria-hidden />
              Sound check
            </button>
            <button
              onPointerDown={() => engine.setBypassed(true)}
              onPointerUp={() => engine.setBypassed(false)}
              onPointerLeave={() => engine.bypassed && engine.setBypassed(false)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
                  e.preventDefault();
                  engine.setBypassed(true);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === 'Enter' || e.key === ' ') engine.setBypassed(false);
              }}
              aria-pressed={engine.bypassed}
              className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                engine.bypassed
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted-foreground hover:text-foreground bg-secondary'
              }`}
              title="Hold to hear your raw mic without processing"
            >
              {engine.bypassed ? 'Bypassed' : 'Hold to bypass'}
            </button>
          </div>
        </div>

        {/* Live meters: gate LED + compressor gain reduction */}
        <div className="flex items-center gap-3 mb-3 px-1">
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground w-24 shrink-0">
            Gate
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                effects.enhance.enabled
                  ? meter.gateOpen
                    ? 'bg-primary/20 text-primary'
                    : 'bg-secondary text-muted-foreground'
                  : 'bg-secondary text-muted-foreground/40'
              }`}
            >
              {effects.enhance.enabled ? (meter.gateOpen ? 'OPEN' : 'CLOSED') : 'OFF'}
            </span>
          </span>
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">Comp</span>
          <div className="flex-1 h-2 rounded-sm bg-secondary overflow-hidden" aria-hidden>
            <div
              className="h-full bg-yellow-400/90 transition-[width] duration-100"
              style={{ width: `${reductionWidth * 100}%` }}
            />
          </div>
          <span
            className="text-[10px] font-mono tabular-nums text-muted-foreground w-14 text-right shrink-0"
            aria-label={`Compressor gain reduction ${meter.reductionDb.toFixed(1)} decibels`}
          >
            {effects.compressor.enabled ? `${meter.reductionDb.toFixed(1)} dB` : 'off'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {VOICE_EFFECTS.map((name) => {
            const effect = effects[name];
            const Icon = EFFECT_ICONS[name];
            return (
              <div key={name} className="relative">
                <button
                  onClick={() => handleToggle(name)}
                  aria-pressed={effect.enabled}
                  className={`w-full ${chipClass(effect.enabled)}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {EFFECT_LABELS[name]}
                </button>
                <button
                  onClick={(e) => openSettings(name, e)}
                  className="absolute top-1/2 -translate-y-1/2 right-1.5 p-0.5 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                  title={`${EFFECT_LABELS[name]} settings`}
                  aria-label={`${EFFECT_LABELS[name]} settings`}
                >
                  <Settings className="h-3 w-3" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── FX pads: momentary performance effects ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">FX Pads</span>
          <span className="text-[10px] font-mono text-muted-foreground/60">hold to apply · tap to latch</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FX_PADS.map((pad) => {
            const active = engine.activeFx[pad.name];
            const Icon = pad.icon;
            return (
              <button
                key={pad.name}
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleFxDown(pad.name);
                }}
                onPointerUp={() => handleFxUp(pad.name)}
                onPointerLeave={() => handleFxUp(pad.name)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
                    e.preventDefault();
                    handleFxDown(pad.name);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleFxUp(pad.name);
                }}
                aria-pressed={active}
                aria-label={`${pad.label} FX (hold ${pad.keycap})`}
                className={`flex items-center justify-between px-3 py-3 rounded-md border transition-all select-none touch-none ${
                  active
                    ? 'border-primary bg-primary/15 text-primary glow-ring'
                    : 'border-border bg-secondary/50 text-muted-foreground hover:bg-secondary'
                }`}
              >
                <span className="flex items-center gap-2 text-[11px] font-mono">
                  <Icon className="h-4 w-4" aria-hidden />
                  {pad.label}
                </span>
                <kbd className="bg-background/60 border border-border rounded px-1.5 py-0.5 text-[9px] font-mono" aria-hidden>
                  {pad.keycap}
                </kbd>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Manual effects: stay in the chain while enabled ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manual Effects</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MANUAL_FX.map((name) => {
            const effect = effects[name];
            const Icon = EFFECT_ICONS[name];
            return (
              <div key={name} className="relative">
                <button
                  onClick={() => handleToggle(name)}
                  aria-pressed={effect.enabled}
                  className={`w-full ${chipClass(effect.enabled)}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {EFFECT_LABELS[name]}
                </button>
                <button
                  onClick={(e) => openSettings(name, e)}
                  className="absolute top-1/2 -translate-y-1/2 right-1.5 p-0.5 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                  title={`${EFFECT_LABELS[name]} settings`}
                  aria-label={`${EFFECT_LABELS[name]} settings`}
                >
                  <Settings className="h-3 w-3" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Presets ── */}
      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <ListMusic className="h-3 w-3" aria-hidden />
            Presets
          </span>
          <button
            onClick={onSavePresetOpen}
            className="text-[10px] font-mono text-primary hover:text-primary/80 transition-colors"
          >
            Save current…
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <span key={p.name} className="inline-flex items-center rounded-md bg-secondary border border-border overflow-hidden">
              <button
                onClick={() => onApplyPreset(p)}
                className="px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                title={`Apply preset: ${p.name}`}
              >
                {p.name}
              </button>
              {!p.builtIn && (
                <button
                  onClick={() => onRequestDeletePreset(p.name)}
                  className="pr-1.5 pl-0.5 py-1 text-muted-foreground/40 hover:text-destructive transition-colors"
                  title={`Delete preset: ${p.name}`}
                  aria-label={`Delete preset: ${p.name}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ── Effect settings modal ── */}
      <Dialog
        open={editEffect !== null}
        onOpenChange={(open) => {
          if (!open) setEditEffect(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editEffect ? EFFECT_LABELS[editEffect] : ''} Settings
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Adjust how this effect sounds.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {editEffect &&
              EFFECT_SETTINGS[editEffect].map((config) => {
                const value = effects[editEffect].params[config.key] ?? config.defaultValue;
                return (
                  <div key={config.key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        {config.label}
                      </label>
                      <span className="text-xs font-mono tabular-nums text-muted-foreground">
                        {config.formatValue ? config.formatValue(value) : value}
                      </span>
                    </div>

                    {config.minLabel && config.maxLabel && (
                      <div className="flex justify-between text-[10px] text-muted-foreground/60 -mb-1">
                        <span>{config.minLabel}</span>
                        <span>{config.maxLabel}</span>
                      </div>
                    )}

                    <Slider
                      value={[value]}
                      onValueChange={([v]) => handleParamChange(config.key, v)}
                      min={config.min}
                      max={config.max}
                      step={config.step}
                      aria-label={config.label}
                    />

                    <p className="text-[11px] text-muted-foreground/60">
                      {config.description}
                    </p>
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Sound check dialog (always optional) ── */}
      <Dialog
        open={soundCheckOpen}
        onOpenChange={(open) => {
          setSoundCheckOpen(open);
          if (!open) soundCheck.cancel();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ear className="h-4 w-4" aria-hidden />
              Sound Check
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Optional: a ten-second measurement that tunes the noise gate and compressor for your room and mic. You can skip this entirely.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {soundCheck.phase === 'idle' && (
              <div className="space-y-3">
                <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>Stay quiet for 3 seconds (we measure room noise)</li>
                  <li>Then read a sentence out loud for 6 seconds (we measure your voice)</li>
                </ol>
                <button
                  onClick={soundCheck.start}
                  className="w-full py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  Start measurement
                </button>
              </div>
            )}

            {(soundCheck.phase === 'noise' || soundCheck.phase === 'speech') && (
              <div className="text-center space-y-2 py-4">
                <p className="text-sm font-semibold text-foreground">
                  {soundCheck.phase === 'noise' ? 'Stay quiet…' : 'Now speak normally…'}
                </p>
                <p className="text-2xl font-mono text-primary tabular-nums">{soundCheck.secondsLeft}s</p>
                <p className="text-xs text-muted-foreground">
                  {soundCheck.phase === 'noise'
                    ? 'Measuring your room\'s noise floor'
                    : 'Try: "Good evening, you\'re listening to QueTal Cast."'}
                </p>
              </div>
            )}

            {soundCheck.phase === 'done' && soundCheck.result && (
              <div className="space-y-3">
                <div className="rounded-md bg-secondary/60 border border-border p-3 text-xs font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Room noise floor</span>
                    <span className="text-foreground tabular-nums">{soundCheck.result.noiseDb.toFixed(0)} dBFS</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Voice level</span>
                    <span className="text-foreground tabular-nums">{soundCheck.result.speechDb.toFixed(0)} dBFS</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Applying will set the noise gate just above your room noise and tune the compressor toward a consistent voice level.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSoundCheckOpen(false);
                      soundCheck.cancel();
                    }}
                    className="flex-1 py-2 rounded-md bg-secondary text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={applySoundCheck}
                    className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    Apply settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
