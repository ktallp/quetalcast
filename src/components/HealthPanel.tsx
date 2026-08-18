import { BarChart2 } from 'lucide-react';
import type { WebRTCStats } from '@/lib/webrtc-stats';

interface HealthPanelProps {
  stats: WebRTCStats | null;
  connectionState: string;
  iceConnectionState: string;
  signalingState: string;
  peerConnected: boolean;
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

function StateIndicator({ label, value }: { label: string; value: string }) {
  const colorMap: Record<string, string> = {
    connected: 'text-primary',
    completed: 'text-primary',
    stable: 'text-primary',
    lossy: 'text-yellow-500',
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
    <div className="flex items-center justify-between text-xs">
      <span className="font-mono text-muted-foreground uppercase">{label}</span>
      <span className={`font-mono font-semibold ${colorMap[value] || 'text-foreground'}`}>{friendlyValue[value] || value}</span>
    </div>
  );
}

/** Loss over the recent window above this reads as a problem (percent) */
const LOSS_WARN_PERCENT = 2;
/** Above this the transport is up but audio is audibly suffering (percent) */
const LOSS_STREAM_PERCENT = 5;

export function HealthPanel({ stats, connectionState, iceConnectionState, signalingState, peerConnected }: HealthPanelProps) {
  const lossRate = stats?.lossRate ?? 0;
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
        <StatItem label="Speed" value={stats ? stats.bitrate.toFixed(1) : '—'} unit="kbps" />
        <StatItem
          label="Loss"
          value={stats ? lossRate.toFixed(1) : '—'}
          unit="%"
          warn={!!stats && lossRate > LOSS_WARN_PERCENT}
          title={stats ? `${stats.packetsLost} packets lost since connecting` : undefined}
        />
        <StatItem label="Jitter" value={stats ? stats.jitter.toFixed(1) : '—'} unit="ms" />
        <StatItem label="Delay" value={stats ? stats.rtt.toFixed(0) : '—'} unit="ms" />
      </div>

      {/* Connection states */}
      <div className="space-y-1.5 pt-2 border-t border-border/50">
        <StateIndicator label="Stream" value={streamState} />
        <StateIndicator label="Network" value={iceConnectionState} />
        <StateIndicator label="Server" value={signalingState} />
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
