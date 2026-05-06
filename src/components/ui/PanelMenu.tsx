'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

interface PanelMenuProps {
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export function PanelMenu(props: PanelMenuProps) {
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

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        zIndex: 5,
      }}
    >
      <button
        type="button"
        aria-label="Panel menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          background: open ? 'var(--line)' : 'transparent',
          border: 0,
          color: open ? 'var(--ink)' : 'var(--ink-mute)',
          padding: 0,
          width: 22,
          height: 22,
          borderRadius: 3,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <DotsIcon />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: 4,
            zIndex: 10,
            minWidth: 150,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {props.onMoveUp && (
            <MenuItem
              disabled={props.canMoveUp === false}
              onClick={() => {
                props.onMoveUp?.();
                setOpen(false);
              }}
            >
              ↑ Move up
            </MenuItem>
          )}
          {props.onMoveDown && (
            <MenuItem
              disabled={props.canMoveDown === false}
              onClick={() => {
                props.onMoveDown?.();
                setOpen(false);
              }}
            >
              ↓ Move down
            </MenuItem>
          )}
          {(props.onMoveUp || props.onMoveDown) && props.onRemove && (
            <div style={{ height: 1, background: 'var(--line)', margin: '3px 0' }} />
          )}
          {props.onRemove && (
            <MenuItem
              danger
              onClick={() => {
                props.onRemove?.();
                setOpen(false);
              }}
            >
              ✕ Remove panel
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 0,
        padding: '6px 10px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--ink-mute)' : danger ? 'var(--pink)' : 'var(--ink)',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        borderRadius: 3,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--line)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
  );
}
