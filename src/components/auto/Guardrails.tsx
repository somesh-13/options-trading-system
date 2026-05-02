'use client';

/**
 * Guardrails card — port of the left card in `engineAfter()` from the design
 * source (design/stocks-revamp/project/pages/06-auto-engine.js).
 *
 * Wired to GET /api/engine/status. Polls every 5s.
 */

import { Fragment, useEffect, useState } from 'react';
import { LimitBar } from './LimitBar';

type EngineStats = {
  scans_completed?: number;
  trades_executed?: number;
  trades_skipped?: number;
  errors?: number;
  last_scan_time?: string | null;
  last_trade_time?: string | null;
  started_at?: string | null;
};

type EngineConfig = {
  dry_run?: boolean;
  scan_interval_seconds?: number;
  iv_hv_sell_threshold?: number;
  iv_hv_buy_threshold?: number;
  min_ev_per_contract?: number;
  max_contracts_per_trade?: number;
  max_total_contracts?: number;
  max_daily_trades?: number;
  max_daily_loss?: number;
};

type StatusBody = {
  state?: string;
  stats?: EngineStats;
  config?: EngineConfig;
};

const POLL_MS = 5000;

const monoGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '4px 8px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px dashed var(--line)',
  margin: '10px 0',
  paddingTop: 10,
};

function fmtInterval(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}

export function Guardrails() {
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/engine/status', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setError(`status ${res.status}`);
          return;
        }
        const body = (await res.json()) as StatusBody;
        if (!cancelled) {
          setStatus(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const config = status?.config ?? {};
  const stats = status?.stats ?? {};

  const entryConditions: Array<[string, string]> = [
    ['min EV', config.min_ev_per_contract != null ? `$${config.min_ev_per_contract}` : '—'],
    ['IV/HV sell ≥', config.iv_hv_sell_threshold != null ? `${config.iv_hv_sell_threshold}x` : '—'],
    ['IV/HV buy ≤', config.iv_hv_buy_threshold != null ? `${config.iv_hv_buy_threshold}x` : '—'],
    ['size', config.max_contracts_per_trade != null ? `${config.max_contracts_per_trade} contracts` : '—'],
    ['scan every', fmtInterval(config.scan_interval_seconds)],
    ['mode', config.dry_run ? 'dry-run' : 'live'],
  ];

  const sessionStats: Array<[string, string, string?]> = [
    ['scans', String(stats.scans_completed ?? 0)],
    ['executed', String(stats.trades_executed ?? 0)],
    ['skipped', String(stats.trades_skipped ?? 0)],
    ['errors', String(stats.errors ?? 0), (stats.errors ?? 0) > 0 ? 'rv-down' : undefined],
    ['last scan', stats.last_scan_time ? new Date(stats.last_scan_time).toLocaleTimeString('en-US', { hour12: false }) : '—'],
    ['last trade', stats.last_trade_time ? new Date(stats.last_trade_time).toLocaleTimeString('en-US', { hour12: false }) : '—'],
  ];

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Guardrails · today</h3>
      </div>
      <LimitBar
        label="Trades today"
        used={stats.trades_executed ?? 0}
        cap={config.max_daily_trades ?? 0}
      />
      <LimitBar
        label="Open contracts"
        used={0}
        cap={config.max_total_contracts ?? 0}
      />
      <LimitBar
        label="Daily loss cap"
        used={0}
        cap={config.max_daily_loss ?? 0}
        unit="$"
      />
      <LimitBar
        label="Per-trade size"
        used={0}
        cap={config.max_contracts_per_trade ?? 0}
      />

      <div style={dividerStyle}>
        <div className="rv-sub" style={{ marginBottom: 6 }}>
          Entry conditions
        </div>
        <div style={monoGridStyle}>
          {entryConditions.map(([k, v]) => (
            <Fragment key={k}>
              <div>{k}</div>
              <div>{v}</div>
            </Fragment>
          ))}
        </div>
      </div>

      <div style={dividerStyle}>
        <div className="rv-sub" style={{ marginBottom: 6 }}>
          Session stats
        </div>
        <div style={monoGridStyle}>
          {sessionStats.map(([k, v, cls]) => (
            <Fragment key={k}>
              <div>{k}</div>
              <div className={cls}>{v}</div>
            </Fragment>
          ))}
        </div>
        {error && (
          <div className="rv-sub" style={{ color: 'var(--pink)', marginTop: 6, fontSize: 10 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
