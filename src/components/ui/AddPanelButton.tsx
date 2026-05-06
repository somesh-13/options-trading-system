'use client';

import { useEffect, useRef, useState } from 'react';

interface HiddenPanel {
  id: string;
  title: string;
}

interface Props {
  hidden: HiddenPanel[];
  onAdd: (id: string) => void;
}

/** Compact "+ Add panel" button shown at the end of a section when at least
 *  one panel has been removed. Click → small popover with the list of hidden
 *  panel titles; clicking a title restores it back to the section. */
export function AddPanelButton({ hidden, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (hidden.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 10 }}>
      <button
        type="button"
        aria-label="Add panel"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px dashed var(--line)',
          borderRadius: 4,
          color: 'var(--ink-mute)',
          padding: '8px 12px',
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          cursor: 'pointer',
        }}
      >
        + Add panel ({hidden.length} hidden)
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: 4,
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {hidden.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onAdd(p.id);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 0,
                color: 'var(--ink)',
                padding: '6px 10px',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                borderRadius: 3,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--line)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              + {p.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
