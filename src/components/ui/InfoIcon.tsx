'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GLOSSARY } from '@/lib/glossary';

interface InfoIconProps {
  term: string; // glossary slug
}

export function InfoIcon({ term }: InfoIconProps) {
  const entry = GLOSSARY[term];
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Don't render if slug is unknown
  if (!entry) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const checkFlip = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setFlipUp(rect.bottom + 180 > window.innerHeight);
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleToggle = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      checkFlip();
      setOpen((v) => !v);
    },
    [checkFlip],
  );

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleToggle(e);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    },
    [handleToggle],
  );

  // Close on outside click or Escape
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (
        btnRef.current &&
        !btnRef.current.contains(e.target as Node) &&
        popRef.current &&
        !popRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const popoverStyle: React.CSSProperties = {
    position: 'absolute',
    [flipUp ? 'bottom' : 'top']: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: flipUp ? 0 : 6,
    marginBottom: flipUp ? 6 : 0,
    zIndex: 999,
    width: 260,
    background: 'var(--card, #17181c)',
    border: '1px solid var(--line, #26272d)',
    borderRadius: 8,
    padding: '10px 12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    color: 'var(--ink, #e8e8ea)',
    fontSize: 12,
    lineHeight: '1.55',
    fontFamily: 'inherit',
    textAlign: 'left',
  };

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 4 }}
    >
      <button
        ref={btnRef}
        type="button"
        className="rv-info-icon-btn"
        aria-label={`Help: ${entry.term}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        style={{
          background: 'none',
          border: 'none',
          padding: '0 1px',
          cursor: 'pointer',
          color: open ? 'var(--gold, #FFD700)' : 'var(--ink-mute, #6b6b72)',
          fontSize: 11,
          lineHeight: 1,
          fontFamily: "'JetBrains Mono', monospace",
          transition: 'color 0.12s ease-out',
          display: 'inline-flex',
          alignItems: 'center',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink, #e8e8ea)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = open
            ? 'var(--gold, #FFD700)'
            : 'var(--ink-mute, #6b6b72)';
        }}
      >
        &#9432;
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Definition: ${entry.term}`}
          style={popoverStyle}
        >
          {/* Term name + category */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 6,
              gap: 6,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink, #e8e8ea)' }}>
              {entry.term}
            </span>
            <span
              style={{
                fontSize: 9,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--ink-mute, #6b6b72)',
                border: '1px solid var(--line, #26272d)',
                borderRadius: 3,
                padding: '1px 5px',
                flexShrink: 0,
              }}
            >
              {entry.category}
            </span>
          </div>

          {/* Simple explanation */}
          <p style={{ margin: '0 0 8px', color: 'var(--ink-dim, #a3a3a8)', fontSize: 12 }}>
            {entry.simple}
          </p>

          {/* Learn more link */}
          <Link
            href={`/glossary#${term}`}
            style={{
              fontSize: 11,
              color: 'var(--gold, #FFD700)',
              textDecoration: 'none',
              fontFamily: "'JetBrains Mono', monospace",
            }}
            onClick={() => setOpen(false)}
          >
            Learn more →
          </Link>
        </div>
      )}
    </span>
  );
}
