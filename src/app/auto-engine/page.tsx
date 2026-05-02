'use client';

/**
 * Auto engine — Phase 7 of the VegaEdge UI revamp.
 *
 * Visual port of `engineAfter()` from
 *   design/stocks-revamp/project/pages/06-auto-engine.js
 *
 * Header: status chip + uptime sub + dry-run / HALT-ALL controls.
 * Body  : `<Guardrails />` (left, 320px) + `<EventStream />` (right, 1fr).
 */

import { useCallback, useEffect, useState } from 'react';
import { Guardrails } from '@/components/auto/Guardrails';
import { EventStream } from '@/components/auto/EventStream';

type StatusBody = {
  state?: string;
  stats?: {
    started_at?: string | null;
    last_scan_time?: string | null;
  };
  config?: {
    dry_run?: boolean;
    scan_interval_seconds?: number;
  };
};

const POLL_MS = 5000;

function fmtUptime(startedAt?: string | null): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  const ms = Date.now() - start;
  if (ms < 0) return '—';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m uptime` : `${m}m uptime`;
}

function fmtNextScan(lastScanIso?: string | null, intervalSec?: number): string {
  if (!lastScanIso || !intervalSec) return '';
  const last = new Date(lastScanIso).getTime();
  if (Number.isNaN(last)) return '';
  const next = last + intervalSec * 1000;
  const remainingMs = next - Date.now();
  if (remainingMs <= 0) return ' · scan due';
  const totalSec = Math.floor(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return ` · next scan in ${m}m ${s}s`;
}

function fmtStartedTime(startedAt?: string | null): string {
  if (!startedAt) return '—';
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour12: false });
}

export default function AutoEnginePage() {
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/engine/status', { cache: 'no-store' });
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // Soft-fail: leave previous status visible
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const state = status?.state ?? 'UNKNOWN';
  const isRunning = state !== 'STOPPED' && state !== 'UNKNOWN';
  const dryRun = status?.config?.dry_run ?? false;

  const handleHaltAll = useCallback(async () => {
    if (busy) return;
    if (!window.confirm('Stop the auto engine?')) return;
    setBusy(true);
    try {
      await fetch('/api/engine/stop', { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const handleDryRunToggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/engine/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: !dryRun }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, dryRun, refresh]);

  const handleStart = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/engine/start', { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const startedTime = fmtStartedTime(status?.stats?.started_at);
  const uptime = fmtUptime(status?.stats?.started_at);
  const nextScan = fmtNextScan(status?.stats?.last_scan_time, status?.config?.scan_interval_seconds);
  const chipClass = isRunning ? 'buy' : 'sell';
  const chipLabel = state;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <h2 className="rv-h1" style={{ margin: 0 }}>Auto engine</h2>
        <span className={`rv-chip ${chipClass}`}>
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: isRunning ? 'var(--green)' : 'var(--pink)',
              marginRight: 4,
              animation: isRunning ? 'rv-pulse 1.5s infinite' : 'none',
            }}
          />
          {chipLabel}
        </span>
        <span className="rv-sub" style={{ margin: 0 }}>
          {status?.stats?.started_at ? `started ${startedTime} · ${uptime}${nextScan}` : 'never started'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!isRunning && (
            <button
              type="button"
              className="rv-btn"
              style={{ fontSize: 11 }}
              onClick={handleStart}
              disabled={busy}
            >
              ▶ START
            </button>
          )}
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11 }}
            onClick={handleDryRunToggle}
            disabled={busy}
          >
            dry run: {dryRun ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="rv-btn"
            style={{
              fontSize: 11,
              background: 'var(--pink)',
              color: '#fff',
              fontWeight: 700,
            }}
            onClick={handleHaltAll}
            disabled={busy || !isRunning}
          >
            ■ HALT ALL
          </button>
        </span>
      </div>

      <div className="rv-grid-2" style={{ gridTemplateColumns: '320px 1fr' }}>
        <Guardrails />
        <EventStream />
      </div>
    </>
  );
}
