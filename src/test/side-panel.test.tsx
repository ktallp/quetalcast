import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { Music, FileText } from 'lucide-react';
import { SidePanel } from '@/components/broadcast/SidePanel';

/**
 * The Sounds tab owns live audio: soundboard pads and the bank C playlist.
 * If SidePanel drops inactive tabs, glancing at the Log kills playback and
 * discards everything loaded, so these tests pin that tabs stay mounted.
 */

afterEach(cleanup);

/** Reports mount/unmount so tests can prove a tab was never torn down */
function Probe({ onUnmount, label }: { onUnmount: () => void; label: string }) {
  useEffect(() => onUnmount, [onUnmount]);
  return <div>{label}</div>;
}

/** Holds state that would be lost if the tab unmounted */
function StatefulProbe() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount((c) => c + 1)}>count: {count}</button>
  );
}

function renderPanel(content: React.ReactNode, logContent: React.ReactNode = <div>log body</div>) {
  function Harness() {
    const [active, setActive] = useState('sounds');
    return (
      <SidePanel
        active={active}
        onTabChange={setActive}
        tabs={[
          { id: 'sounds', label: 'Sounds', icon: Music, content },
          { id: 'log', label: 'Log', icon: FileText, content: logContent },
        ]}
      />
    );
  }
  return render(<Harness />);
}

describe('SidePanel', () => {
  it('keeps an inactive tab mounted when you switch away', () => {
    const onUnmount = vi.fn();
    renderPanel(<Probe onUnmount={onUnmount} label="sounds body" />);

    fireEvent.click(screen.getByRole('tab', { name: /log/i }));

    expect(onUnmount).not.toHaveBeenCalled();
    expect(screen.getByText('sounds body')).toBeInTheDocument();
  });

  it('hides the inactive panel and shows the active one', () => {
    renderPanel(<div>sounds body</div>);

    fireEvent.click(screen.getByRole('tab', { name: /log/i }));

    // getByText still finds it, but the panel wrapper carries `hidden`
    expect(screen.getByText('sounds body').closest('[role="tabpanel"]')).toHaveAttribute('hidden');
    expect(screen.getByText('log body').closest('[role="tabpanel"]')).not.toHaveAttribute('hidden');
  });

  it('preserves tab state across a switch and back', () => {
    renderPanel(<StatefulProbe />);

    fireEvent.click(screen.getByText('count: 0'));
    fireEvent.click(screen.getByText('count: 1'));
    expect(screen.getByText('count: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /log/i }));
    fireEvent.click(screen.getByRole('tab', { name: /sounds/i }));

    // A remount would have reset this to zero
    expect(screen.getByText('count: 2')).toBeInTheDocument();
  });

  it('marks the active tab as selected', () => {
    renderPanel(<div>sounds body</div>);

    expect(screen.getByRole('tab', { name: /sounds/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: /log/i }));

    expect(screen.getByRole('tab', { name: /log/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /sounds/i })).toHaveAttribute('aria-selected', 'false');
  });
});
