'use client';

/**
 * Phase-1 placeholder pills — visual shell only.
 * Live data wiring (regime poll, VaR poll, paper/live confirm modal, websocket
 * health) lands in Phase 1.4 follow-up once the corresponding endpoints
 * (/api/regime, /api/risk/var, /api/auto-engine/state) are confirmed wired.
 */

export function RegimePill({ state = 'high-vol' as 'normal' | 'high-vol' | 'crash' }) {
  const cls = state === 'crash' ? 'crash' : state === 'normal' ? 'normal' : '';
  const label = state === 'crash' ? 'CRASH' : state === 'normal' ? 'NORMAL' : 'HIGH VOL';
  return (
    <span className={`rv-pill regime ${cls}`}>
      <span className="dot" style={{ background: 'currentColor' }} />
      HMM · {label}
    </span>
  );
}

export function VarPill({ value = '$2.8k' }: { value?: string }) {
  return <span className="rv-pill var">VaR 1d · <b>{value}</b></span>;
}

export function PaperLivePill({ mode = 'paper' as 'paper' | 'live' }) {
  return mode === 'live' ? (
    <span className="rv-pill" style={{ color: 'var(--pink)', borderColor: 'rgba(255,0,110,.35)', background: 'rgba(255,0,110,.08)' }}>LIVE</span>
  ) : (
    <span className="rv-pill paper">PAPER</span>
  );
}

export function LiveDataPill({ connected = true }: { connected?: boolean }) {
  return (
    <span className={`rv-pill ${connected ? 'live' : ''}`}>
      <span className="dot" style={!connected ? { background: 'var(--ink-mute)' } : undefined} />
      live data
    </span>
  );
}

export function StatusPills() {
  return (
    <>
      <RegimePill />
      <VarPill />
      <PaperLivePill />
      <LiveDataPill />
    </>
  );
}
