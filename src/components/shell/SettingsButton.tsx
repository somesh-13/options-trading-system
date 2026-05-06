'use client';

import { useEffect, useRef, useState } from 'react';
import { resetAllCardSizes, useZoomControl } from '@/lib/useDisplaySettings';

const ZOOM_PRESETS = [0.9, 1.0, 1.1, 1.2, 1.3, 1.4];

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { zoom, setZoom } = useZoomControl();
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Close on outside click / Escape — same pattern as the existing
  // CommandPalette and NotificationBell popovers.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleReset = () => {
    const n = resetAllCardSizes();
    setResetMsg(n === 0 ? 'No saved sizes' : `Reset ${n} card${n === 1 ? '' : 's'} — refresh to apply`);
    window.setTimeout(() => setResetMsg(null), 3000);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Display settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: '1px solid var(--line)',
          color: open ? 'var(--ink)' : 'var(--ink-dim)',
          width: 28,
          height: 28,
          borderRadius: 4,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <GearIcon />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Display settings"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 280,
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: 12,
            zIndex: 50,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: 'var(--ink)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ink-mute)',
              marginBottom: 10,
            }}
          >
            Display
          </div>

          {/* Zoom */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ color: 'var(--ink-dim)' }}>Zoom</span>
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{Math.round(zoom * 100)}%</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {ZOOM_PRESETS.map((preset) => {
                const active = Math.abs(preset - zoom) < 0.005;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setZoom(preset)}
                    style={{
                      flex: 1,
                      background: active ? 'var(--line)' : 'transparent',
                      border: '1px solid var(--line)',
                      borderRadius: 3,
                      color: active ? 'var(--ink)' : 'var(--ink-mute)',
                      padding: '4px 0',
                      fontSize: 10,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {Math.round(preset * 100)}%
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reset card sizes */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--ink-dim)' }}>Reset card sizes</div>
                <div style={{ color: 'var(--ink-mute)', fontSize: 10, marginTop: 2 }}>
                  Restore every panel to its default dimensions.
                </div>
              </div>
              <button
                type="button"
                onClick={handleReset}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  borderRadius: 3,
                  color: 'var(--ink-dim)',
                  padding: '4px 10px',
                  fontSize: 10,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            </div>
            {resetMsg && (
              <div style={{ marginTop: 6, color: 'var(--gold)', fontSize: 10 }}>{resetMsg}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
