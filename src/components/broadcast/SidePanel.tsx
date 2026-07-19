import type { ReactNode, ComponentType } from 'react';

export interface SidePanelTab {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  content: ReactNode;
}

interface SidePanelProps {
  tabs: SidePanelTab[];
  active: string;
  onTabChange: (id: string) => void;
}

/**
 * Tabbed side panel for the console: Sounds, Effects, Tracks, and Log
 * live here so the page stays one screen tall on desktop.
 */
export function SidePanel({ tabs, active, onTabChange }: SidePanelProps) {
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="panel !p-0 flex flex-col min-h-0">
      <div className="flex border-b border-border" role="tablist" aria-label="Console panels">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`side-panel-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-mono font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div id={`side-panel-${activeTab.id}`} role="tabpanel" className="p-4 overflow-y-auto min-h-0">
        {activeTab.content}
      </div>
    </div>
  );
}
