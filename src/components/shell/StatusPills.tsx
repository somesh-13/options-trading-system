'use client';

import { useEffect, useState } from 'react';
import { PRICING_API_URL } from '@/lib/pricing-api';

export function LiveDataPill({ connected = true }: { connected?: boolean }) {
  return (
    <span className={`rv-pill ${connected ? 'live' : ''}`}>
      <span className="dot" style={!connected ? { background: 'var(--ink-mute)' } : undefined} />
      live data
    </span>
  );
}

interface RhSessionStatus {
  configured: boolean;
  logged_in: boolean;
  last_login: number | null;
  age_seconds: number | null;
  refresh_after_seconds: number;
}

function formatAge(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function RhSessionPill() {
  const [status, setStatus] = useState<RhSessionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${PRICING_API_URL}/api/robinhood/session`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as RhSessionStatus;
        if (!cancelled) setStatus(data);
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!status || !status.configured) return null;

  const isStale =
    status.age_seconds !== null && status.age_seconds > status.refresh_after_seconds;
  const tone = !status.logged_in ? 'off' : isStale ? 'warn' : 'live';
  const label = !status.logged_in
    ? 'rh: logged out'
    : `rh: ${formatAge(status.age_seconds)}`;

  const dotColor =
    tone === 'live'
      ? undefined
      : tone === 'warn'
        ? { background: 'var(--gold, #FFD700)' }
        : { background: 'var(--ink-mute)' };

  return (
    <span className={`rv-pill ${tone === 'live' ? 'live' : ''}`} title="Robinhood session age (clears at 20h)">
      <span className="dot" style={dotColor} />
      {label}
    </span>
  );
}

export function StatusPills() {
  return (
    <>
      <LiveDataPill />
      <RhSessionPill />
    </>
  );
}
