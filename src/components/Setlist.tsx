import { ListPlus, Play, X, Disc3 } from 'lucide-react';
import type { TrackMeta } from '@/components/NowPlayingInput';

/** A planned track: full Deezer metadata captured at queue time */
export interface SetlistItem extends TrackMeta {
  id: string;
}

interface SetlistProps {
  items: SetlistItem[];
  /** True while on air; publishing requires a live room */
  canPublish: boolean;
  onMarkPlayed: (item: SetlistItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

/**
 * The show plan. Tracks queue here off-air (or mid-show) with their
 * metadata intact, then publish to the live track list one at a time
 * as they actually air.
 */
export function Setlist({ items, canPublish, onMarkPlayed, onRemove, onClear }: SetlistProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ListPlus className="h-3 w-3" aria-hidden />
          Setlist · publishes when played
        </span>
        <button
          onClick={onClear}
          className="text-[10px] text-muted-foreground/60 hover:text-destructive transition-colors"
          aria-label="Clear the entire setlist"
        >
          Clear
        </button>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2 py-1.5"
          >
            {item.cover ? (
              <img src={item.cover} alt="" className="w-6 h-6 rounded shrink-0 bg-secondary" loading="lazy" />
            ) : (
              <div className="w-6 h-6 rounded bg-secondary shrink-0 flex items-center justify-center">
                <Disc3 className="h-3 w-3 text-muted-foreground/40" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-foreground truncate">
                {item.title || item.text}
              </div>
              {(item.artist || item.album) && (
                <div className="text-[10px] text-muted-foreground truncate">
                  {item.artist}
                  {item.album ? ` · ${item.album}` : ''}
                </div>
              )}
            </div>
            <button
              onClick={() => onMarkPlayed(item)}
              disabled={!canPublish}
              title={canPublish ? 'Add to the live track list now' : 'Go on air to publish'}
              className="shrink-0 flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-foreground enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="h-2.5 w-2.5" aria-hidden />
              Mark played
            </button>
            <button
              onClick={() => onRemove(item.id)}
              className="shrink-0 p-0.5 text-muted-foreground/60 hover:text-destructive transition-colors"
              aria-label={`Remove ${item.title || item.text} from setlist`}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
