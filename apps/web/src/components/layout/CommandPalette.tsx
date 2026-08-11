import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const COMMANDS = [
  { id: 'search', label: 'Search', hint: '1', to: '/' },
  { id: 'progress', label: 'Progress', hint: '2', to: '/progress' },
  { id: 'results', label: 'Results', hint: '3', to: '/results' },
  { id: 'verify', label: 'Verify emails', hint: 'V', to: '/verify' },
  { id: 'export', label: 'Export', hint: '4', to: '/export' },
  { id: 'settings', label: 'Settings', hint: '5', to: '/settings' },
  { id: 'clear', label: 'Clear results', hint: '', to: null },
];

export function CommandPalette({
  onClose,
  onClear,
}: {
  onClose: () => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const filtered = useMemo(
    () => COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    [q],
  );

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && filtered[active]) {
        e.preventDefault();
        run(filtered[active].id, filtered[active].to);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, filtered, active]);

  function run(id: string, to: string | null) {
    if (id === 'clear') onClear();
    else if (to) {
      navigate(to);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/75 pt-[12vh]">
      <div className="w-full max-w-lg border border-primary bg-card">
        <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-widest text-accent">
          Command palette
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a command…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
        />
        <ul className="max-h-72 overflow-auto py-1">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  i === active ? 'bg-primary/15 text-primary' : 'hover:bg-muted hover:text-primary'
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c.id, c.to)}
              >
                <span>{c.label}</span>
                {c.hint ? <span className="text-[10px] text-accent">[{c.hint}]</span> : null}
              </button>
            </li>
          ))}
          {!filtered.length && (
            <li className="px-4 py-3 text-xs text-muted-foreground">No matches</li>
          )}
        </ul>
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          <span className="text-primary">↑↓</span> navigate · <span className="text-primary">Enter</span>{' '}
          run · <span className="text-primary">Esc</span> close
        </div>
      </div>
    </div>
  );
}
