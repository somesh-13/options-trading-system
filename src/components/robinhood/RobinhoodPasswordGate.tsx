'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

const STORAGE_KEY = 'rh-gate-ok';
const PASSWORD = '1769';

interface Props {
  children: ReactNode;
}

export function RobinhoodPasswordGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Deferred via Promise.resolve to keep setState off the synchronous
  // effect path (react-hooks/set-state-in-effect under React 19).
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        if (window.sessionStorage.getItem(STORAGE_KEY) === '1') {
          setUnlocked(true);
        }
      } catch {
        /* sessionStorage unavailable (private mode) — fall through to prompt */
      }
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (input === PASSWORD) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* ignore */
      }
      setUnlocked(true);
      setError(null);
    } else {
      setError('Incorrect password');
      setInput('');
    }
  }

  if (!checked) return null;

  if (unlocked) return <>{children}</>;

  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        className="rv-card"
        style={{ padding: 24, width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <h2 className="rv-h2" style={{ margin: 0 }}>Enter password</h2>
        <p className="rv-sub" style={{ margin: 0 }}>
          Required to view the Robinhood page.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: 'var(--ink-mute)' }}>Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            data-testid="rh-gate-input"
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid var(--border, #333)',
              background: 'var(--surface, #1E1E1E)',
              color: 'inherit',
            }}
          />
        </label>
        {error && (
          <div style={{ fontSize: 12, color: 'var(--pink, #FF006E)' }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={!input}
          className="rv-btn"
          data-testid="rh-gate-submit"
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            background: 'var(--green, #00C805)',
            color: '#000',
            fontWeight: 600,
            opacity: input ? 1 : 0.5,
            cursor: input ? 'pointer' : 'not-allowed',
          }}
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
