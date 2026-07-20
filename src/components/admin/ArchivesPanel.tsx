import { useCallback, useEffect, useState } from 'react';
import { Archive, ExternalLink, Trash2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface ArchiveRow {
  roomId: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  bytes: number;
  updatedAt: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Show archive management: turn server-side recording on, cap how many
 * shows are kept on the volume, and manage the archived pages.
 */
export function ArchivesPanel() {
  const [archives, setArchives] = useState<ArchiveRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [keep, setKeep] = useState(10);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [archRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE}/api/archives`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/station-settings`, { credentials: 'include' }),
      ]);
      if (archRes.ok) {
        const data = await archRes.json();
        setArchives(Array.isArray(data.archives) ? data.archives : []);
      }
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setEnabled(settings.archive_enabled === 'true');
        const parsedKeep = Number(settings.archive_keep);
        if (Number.isInteger(parsedKeep) && parsedKeep >= 1) setKeep(parsedKeep);
      }
    } catch {
      // Leave state as-is; the panel shows what it has
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async (nextEnabled: boolean, nextKeep: number) => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/station-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive_enabled: nextEnabled, archive_keep: nextKeep }),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (roomId: string) => {
    await fetch(`${API_BASE}/api/archives/${encodeURIComponent(roomId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setPendingDelete(null);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="panel space-y-3">
        <span className="panel-header mb-0 flex items-center gap-1.5">
          <Archive className="h-3.5 w-3.5" aria-hidden />
          Show archive
        </span>
        <label className="flex items-start gap-2.5 cursor-pointer select-none max-w-xl">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => {
              setEnabled(e.target.checked);
              saveSettings(e.target.checked, keep);
            }}
            className="mt-0.5 h-4 w-4 rounded border-border bg-input accent-primary"
          />
          <span>
            <span className="block text-xs font-semibold text-foreground">
              Record every broadcast to the server
            </span>
            <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
              Tees the relay MP3 (128 kbps) to the data volume and publishes a
              public page at /show/&lt;room&gt; with the recording, track list, and
              chat replay. Applies to broadcasts started after switching on.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="archive-keep">
            Keep last
          </label>
          <input
            id="archive-keep"
            type="number"
            min={1}
            max={100}
            value={keep}
            disabled={saving}
            onChange={(e) => {
              const v = Math.max(1, Math.min(100, Number(e.target.value) || 1));
              setKeep(v);
            }}
            onBlur={() => saveSettings(enabled, keep)}
            className="w-16 rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[10px] text-muted-foreground">shows; older recordings are deleted automatically</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Archived shows</div>
        {archives.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">
            Nothing archived yet{enabled ? '; the next broadcast will appear here' : ''}.
          </p>
        ) : (
          <div className="space-y-1">
            {archives.map((a) => (
              <div key={a.roomId} className="flex items-center gap-3 border border-border rounded-md px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="text-foreground/90 truncate">{a.title || a.roomId}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {new Date(a.startedAt).toLocaleString()} · {formatBytes(a.bytes)}
                  </div>
                </div>
                <a
                  href={`/show/${a.roomId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline underline-offset-2"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Open page
                </a>
                {pendingDelete === a.roomId ? (
                  <button
                    onClick={() => remove(a.roomId)}
                    className="shrink-0 text-[10px] font-semibold text-destructive"
                  >
                    Delete?
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setPendingDelete(a.roomId);
                      setTimeout(() => setPendingDelete((cur) => (cur === a.roomId ? null : cur)), 3000);
                    }}
                    className="shrink-0 p-1 text-muted-foreground/50 hover:text-destructive transition-colors"
                    aria-label={`Delete archive for ${a.title || a.roomId}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
