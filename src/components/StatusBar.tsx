import { type ConnectionStatus } from '@/hooks/useWebRTC';
import { Radio, Wifi, WifiOff, AlertCircle, Headphones, Users } from 'lucide-react';
import { formatClock } from '@/components/broadcast/TransportBar';

interface StatusBarProps {
  status: ConnectionStatus;
  roomId?: string | null;
  integrationName?: string;
  /** Broadcast vitals: shown when provided so a DJ never scrolls to find them */
  listenerCount?: number;
  elapsedSeconds?: number;
  recording?: boolean;
  recordElapsed?: number;
  /** Hardware skin: render the elapsed timer as an LED display */
  hardware?: boolean;
}

const statusConfig: Record<ConnectionStatus, { label: string; className: string; icon: typeof Radio }> = {
  idle: { label: 'OFFLINE', className: 'status-offline', icon: WifiOff },
  connecting: { label: 'CONNECTING…', className: 'status-connecting', icon: Wifi },
  'on-air': { label: 'ON AIR', className: 'status-on-air', icon: Radio },
  receiving: { label: 'LISTENING', className: 'status-receiving', icon: Headphones },
  disconnected: { label: 'OFF AIR', className: 'status-error', icon: WifiOff },
  error: { label: 'OFFLINE', className: 'status-error', icon: AlertCircle },
};

export function StatusBar({
  status,
  roomId,
  integrationName,
  listenerCount,
  elapsedSeconds,
  recording,
  recordElapsed,
  hardware,
}: StatusBarProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const onAir = status === 'on-air';

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-card border-b border-border">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 text-sm font-mono font-semibold text-foreground tracking-tight shrink-0">
          <Radio className="h-4 w-4 text-primary" aria-hidden />
          <span>QUETAL CAST</span>
        </div>
        {integrationName ? (
          <span className="text-xs font-mono text-primary truncate">
            STREAMING ON {integrationName.toUpperCase()}
          </span>
        ) : roomId ? (
          <span className="text-xs font-mono text-muted-foreground truncate">
            ROOM: {roomId}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {recording && (
          <span className="flex items-center gap-1.5 text-[11px] font-mono font-bold tracking-wider text-red-400" aria-label="Recording">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse" aria-hidden />
            REC{typeof recordElapsed === 'number' ? ` ${formatClock(recordElapsed)}` : ''}
          </span>
        )}
        {onAir && typeof elapsedSeconds === 'number' && (
          <span
            className={`hidden sm:inline text-xs font-mono tabular-nums ${hardware ? 'lcd-clock' : 'text-muted-foreground'}`}
            data-ghost={hardware ? formatClock(elapsedSeconds).replace(/\d/g, '8') : undefined}
          >
            {formatClock(elapsedSeconds)}
          </span>
        )}
        {onAir && typeof listenerCount === 'number' && (
          <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground tabular-nums" title={`${listenerCount} listener${listenerCount === 1 ? '' : 's'} connected`}>
            <Users className="h-3 w-3" aria-hidden />
            {listenerCount}
          </span>
        )}
        <div className={`status-badge flex items-center gap-1.5 ${config.className} ${onAir ? 'onair-lamp' : ''}`}>
          <Icon className="h-3 w-3" aria-hidden />
          {config.label}
        </div>
      </div>
    </div>
  );
}
