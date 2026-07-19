import { Copy, Radio } from 'lucide-react';
import { copyText } from '@/lib/clipboard';

export function receiveLinkFor(roomId: string): string {
  return `${window.location.origin}/receive/${roomId}`;
}

export function streamLinkFor(roomId: string): string {
  return `${window.location.origin}/stream/${roomId}`;
}

interface ShareLinksProps {
  roomId: string;
  /** Icon-only compact variant for tight headers */
  compact?: boolean;
}

/**
 * Independent copy buttons for the two links every broadcast exposes:
 * the receive page (browser listeners) and the raw MP3 stream URL
 * (VLC, RadioDJ, and other media players).
 */
export function ShareLinks({ roomId, compact = false }: ShareLinksProps) {
  const btn =
    'flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors bg-secondary px-3 py-1.5 rounded-md';

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => copyText(receiveLinkFor(roomId), 'Receive link')}
        className={btn}
        aria-label="Copy receive link"
        title="Copy the listener page link"
      >
        <Copy className="h-3 w-3" aria-hidden />
        {!compact && 'Receive link'}
      </button>
      <button
        onClick={() => copyText(streamLinkFor(roomId), 'Stream link')}
        className={btn}
        aria-label="Copy stream link for VLC, RadioDJ, and media players"
        title="Copy the MP3 stream URL for VLC, RadioDJ, and media players"
      >
        <Radio className="h-3 w-3" aria-hidden />
        {!compact && 'Stream link'}
      </button>
    </div>
  );
}
