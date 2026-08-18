import { BarChart2 } from 'lucide-react';
import type { WebRTCStats } from '@/lib/webrtc-stats';

/** Health of the HTTP relay (RadioDJ, VLC), as pushed by the server */
export interface RelayHealth {
  state: 'idle' | 'feeding' | 'stalled';
  /** How long the current stall has lasted, ms */
  gapMs: number;
  stalls: number;
  lastStallMs: number;
  /** Total late audio dropped to keep players near live, ms */
  droppedMs: number;
  listeners: number;
}

interface HealthPanelProps {
  role: 'broadcaster' | 'receiver';
  stats: WebRTCStats | null;
  connectionState: string;
  iceConnectionState: string;
  signalingState: string;
  peerConnected: boolean;
  /** Broadcaster only; null while the relay is not running */
  relay?: RelayHealth | null;
  /** Broadcaster only: our own link to the server, shown when no browser listener is connected */
  relayLink?: {
    uploadKbps: number;
    rttMs: number | null;
    /** Seconds of relay audio queued in the socket, not yet sent */
    backlogSeconds: number;
    state: 'idle' | 'streaming' | 'catching-up';
    relayKbps: number;
  } | null;
}

function StatItem({ label, value, unit, warn, title }: { label: string; value: string | number; unit?: string; warn?: boolean; title?: string }) {
  const hasData = value !== '—';
  return (
    <div className="flex flex-col items-center" title={title}>
      <span className={`stat-value ${warn ? 'text-destructive' : ''}`}>
        {value}
        {unit && hasData && <span className="text-xs text-muted-foreground ml-0.5">{unit}</span>}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function StateIndicator({ label, value, text, title }: { label: string; value: string; text?: string; title?: string }) {
  const colorMap: Record<string, string> = {
    connected: 'text-primary',
    completed: 'text-primary',
    stable: 'text-primary',
    feeding: 'text-primary',
    lossy: 'text-yellow-500',
    stalled: 'text-yellow-500',
    idle: 'text-muted-foreground',
    checking: 'text-accent',
    connecting: 'text-accent',
    'have-local-offer': 'text-accent',
    'have-remote-offer': 'text-accent',
    new: 'text-muted-foreground',
    disconnected: 'text-destructive',
    failed: 'text-destructive',
    closed: 'text-muted-foreground',
  };

  const friendlyValue: Record<string, string> = {
    connected: 'Good',
    completed: 'Good',
    stable: 'Stable',
    lossy: 'Lossy',
    feeding: 'Feeding',
    stalled: 'Stalled',
    idle: 'Waiting for audio',
    checking: 'Checking…',
    connecting: 'Connecting…',
    'have-local-offer': 'Setting up…',
    'have-remote-offer': 'Setting up…',
    new: 'Waiting',
    disconnected: 'Lost',
    failed: 'Failed',
    closed: 'Closed',
  };

  return (
    <div className="flex items-center justify-between text-xs" title={title}>
      <span className="font-mono text-muted-foreground uppercase">{label}</span>
      <span className={`font-mono font-semibold ${colorMap[value] || 'text-foreground'}`}>{text ?? friendlyValue[value] ?? value}</span>
    </div>
  );
}

/** Text for the Relay line: state plus stall duration and player count */
function relayText(relay: RelayHealth): string {
  if (relay.state === 'stalled') return `Stalled ${(relay.gapMs / 1000).toFixed(1)} s`;
  if (relay.state === 'feeding') {
    const players = `${relay.listeners} player${relay.listeners === 1 ? '' : 's'}`;
    return relay.stalls > 0 ? `Feeding, ${players}, ${relay.stalls} stall${relay.stalls === 1 ? '' : 's'}` : `Feeding, ${players}`;
  }
  return 'Waiting for audio';
}

/** Loss over the recent window above this reads as a problem (percent) */
const LOSS_WARN_PERCENT = 2;
/** Above this the transport is up but audio is audibly suffering (percent) */
const LOSS_STREAM_PERCENT = 5;

export function HealthPanel({ role, stats, connectionState, iceConnectionState, signalingState, peerConnected, relay, relayLink }: HealthPanelProps) {
  const lossRate = stats?.lossRate ?? 0;
  // The four tiles measure WebRTC listeners. With none connected (RadioDJ or
  // VLC on the relay only) the broadcaster still has a link worth showing:
  // its own upload to the server and the round trip to it. Loss and jitter
  // do not exist on that TCP path; stalls appear on the Relay line instead.
  const showingRelayLink = role === 'broadcaster' && !stats && !!relayLink;
  // A listener sees the delay it actually hears (network + jitter buffer +
  // playout); the broadcaster only knows the round trip to its worst listener,
  // which is not what anyone experiences as delay, so it is labelled as such.
  const delayItem = role === 'receiver'
    ? {
        label: 'Latency',
        value: stats && stats.latency > 0 ? stats.latency.toFixed(0) : '—',
        title: stats && stats.latency > 0
          ? `Estimated mic-to-speaker delay: ${(stats.rtt / 2).toFixed(0)} ms network + ${stats.jitterBufferMs.toFixed(0)} ms jitter buffer + playout and encoding`
          : 'Estimated mic-to-speaker delay',
      }
    : {
        label: 'RTT',
        value: stats ? stats.rtt.toFixed(0) : '—',
        title: 'Round trip to the listener having the hardest time. Their audible delay is larger (jitter buffer and playout are added on their side).',
      };
  // The connection state only says the transport is up; fold recent loss into
  // the Stream line so "Good" is not shown next to a red loss figure.
  const streamState = connectionState === 'connected' && lossRate > LOSS_STREAM_PERCENT ? 'lossy' : connectionState;
  return (
    <div className="panel space-y-4">
      <div className="panel-header flex items-center gap-1.5 !mb-0">
        <BarChart2 className="h-3.5 w-3.5" />
        Stats
      </div>

      {/* Stats grid — 2 col on mobile, 4 col on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {showingRelayLink ? (
          <>
            <StatItem
              label="Upload"
              value={relayLink!.uploadKbps.toFixed(1)}
              unit="kbps"
              warn={relayLink!.backlogSeconds > 1}
              title={`Relay audio actually leaving this computer (target ${relayLink!.relayKbps} kbps). ${relayLink!.backlogSeconds.toFixed(1)} s queued in the socket.`}
            />
            <StatItem label="Loss" value="n/a" title="The relay runs over TCP: nothing is lost, it stalls instead. Stalls show on the Relay line." />
            <StatItem label="Jitter" value="n/a" title="Not measurable on the relay link; stalls show on the Relay line." />
            <StatItem
              label="Server RTT"
              value={relayLink!.rttMs === null ? '—' : relayLink!.rttMs.toFixed(0)}
              unit="ms"
              warn={(relayLink!.rttMs ?? 0) > 2000}
              title="Round trip from this console to the server. Climbing into seconds means the socket is not draining: audio is queuing in the browser."
            />
          </>
        ) : (
          <>
            <StatItem label="Speed" value={stats ? stats.bitrate.toFixed(1) : '—'} unit="kbps" />
            <StatItem
              label="Loss"
              value={stats ? lossRate.toFixed(1) : '—'}
              unit="%"
              warn={!!stats && lossRate > LOSS_WARN_PERCENT}
              title={stats ? `${stats.packetsLost} packets lost since connecting` : undefined}
            />
            <StatItem label="Jitter" value={stats ? stats.jitter.toFixed(1) : '—'} unit="ms" />
            <StatItem label={delayItem.label} value={delayItem.value} unit="ms" title={delayItem.title} />
          </>
        )}
      </div>
      {showingRelayLink && (
        <p className="text-[10px] text-muted-foreground -mt-2">
          {relayLink!.state === 'catching-up'
            ? `Relay upload paused: ${relayLink!.backlogSeconds.toFixed(1)} s still queued, waiting for the socket to drain.`
            : relayLink!.backlogSeconds > 1
              ? `No browser listeners connected; showing this console's link. ${relayLink!.backlogSeconds.toFixed(1)} s of relay audio queued.`
              : "No browser listeners connected; showing this console's link to the server."}
        </p>
      )}

      {/* Connection states */}
      <div className="space-y-1.5 pt-2 border-t border-border/50">
        <StateIndicator label="Stream" value={streamState} />
        <StateIndicator label="Network" value={iceConnectionState} />
        <StateIndicator label="Server" value={signalingState} />
        {role === 'broadcaster' && relay && (
          <StateIndicator
            label="Relay"
            value={relay.state}
            text={relayText(relay)}
            title="The MP3 stream URL used by RadioDJ, VLC and other players. It runs on a separate connection from WebRTC listeners; a stall here is filled with silence so players stay connected."
          />
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-muted-foreground uppercase">Peer</span>
          <span className={`font-mono font-semibold ${peerConnected ? 'text-primary' : 'text-muted-foreground'}`}>
            {peerConnected ? 'Connected' : 'Waiting'}
          </span>
        </div>
      </div>
    </div>
  );
}
