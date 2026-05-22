'use client';

import { useCallback, useEffect, useState } from 'react';
import { MarketSnapshot } from './MarketSnapshot';
import { MacroNewsFeed } from './MacroNewsFeed';
import {
  getRobinhoodHoldings,
  getRobinhoodSummary,
  type RobinhoodHoldingsResponse,
  type RobinhoodSummary,
} from '@/lib/robinhood-api';
import {
  getPortfolioGreeks,
  type PortfolioGreeksResult,
} from '@/lib/robinhood-analytics-api';
import {
  getCachedGreeks,
  getCachedHoldings,
  getCachedSummary,
  setCachedGreeks,
  setCachedHoldings,
  setCachedSummary,
} from '@/lib/robinhoodCache';

/**
 * Home dashboard.
 *
 *   KPIs ← /api/robinhood/summary?source=live + portfolio-greeks (net delta)
 *   News ← /api/macro-news/feed (GDELT + curated RSS)
 *
 * Holdings, portfolio Greeks breakdown, and engine logs live on /robinhood
 * and /agent — duplicating them here was confusing.
 */

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function formatToday(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtUsd(n: number | null | undefined, opts?: { signed?: boolean }): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const compact = abs >= 10_000;
  const formatted = compact
    ? `$${(abs / 1000).toFixed(1)}k`
    : `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (!opts?.signed) return n < 0 ? `-${formatted}` : formatted;
  return n < 0 ? `−${formatted}` : `+${formatted}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function Dashboard() {
  const [summary, setSummary] = useState<RobinhoodSummary | null>(null);
  const [holdings, setHoldings] = useState<RobinhoodHoldingsResponse | null>(null);
  const [greeks, setGreeks] = useState<PortfolioGreeksResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState('');

  useEffect(() => {
    setToday(formatToday());
    // Hydrate from the shared cache on mount so the KPI tiles show real
    // numbers immediately if /robinhood was visited recently — the fresh
    // loadKpis call below overwrites them when its requests return.
    const cs = getCachedSummary();
    const ch = getCachedHoldings();
    const cg = getCachedGreeks();
    if (cs) setSummary(cs);
    if (ch) setHoldings(ch);
    if (cg) setGreeks(cg);
  }, []);

  const loadKpis = useCallback(async () => {
    setError(null);
    const [s, h, g] = await Promise.all([
      getRobinhoodSummary(true, 'all', 'live').catch(() => null),
      getRobinhoodHoldings(true, 'all', 'live').catch(() => null),
      getPortfolioGreeks('all').catch(() => null),
    ]);
    if (s) { setSummary(s); setCachedSummary(s); }
    if (h) { setHoldings(h); setCachedHoldings(h); }
    if (g) { setGreeks(g); setCachedGreeks(g); }
    // If every call failed, surface a single error so the user has a retry path.
    if (!s && !h && !g) {
      setError('All snapshot endpoints failed — check backend / tunnel');
    }
  }, []);

  useEffect(() => {
    loadKpis().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load dashboard'),
    );
    const id = setInterval(() => {
      loadKpis().catch(() => {
        /* swallow background errors */
      });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadKpis]);

  const equityCount = holdings?.equities.length ?? 0;
  const optionCount = holdings?.options.length ?? 0;

  const unrealized = summary?.unrealized_pnl ?? 0;
  const unrealizedPct =
    summary?.total_invested && summary.total_invested > 0
      ? (unrealized / summary.total_invested) * 100
      : null;

  return (
    <>
      <h2 className="rv-h1">Today</h2>
      <div className="rv-sub" suppressHydrationWarning>
        {today || ' '} · live portfolio · world affairs feed
      </div>

      {error && (
        <div
          style={{
            border: '1px solid rgba(255,0,110,.35)',
            background: 'rgba(255,0,110,.08)',
            color: 'var(--pink)',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          Error loading dashboard: {error}
          <button
            type="button"
            onClick={() =>
              loadKpis().catch((e) =>
                setError(e instanceof Error ? e.message : 'Failed to load dashboard'),
              )
            }
            className="rv-btn ghost"
            style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px' }}
          >
            Retry
          </button>
        </div>
      )}

      <MarketSnapshot />

      <div className="rv-grid-4" style={{ marginBottom: 14 }}>
        <div className="rv-kpi">
          <div className="k">NAV</div>
          <div className="v">{fmtUsd(summary?.nav ?? null)}</div>
          <div className="d">
            invested {fmtUsd(summary?.total_invested ?? null)}
          </div>
        </div>
        <div className="rv-kpi">
          <div className="k">Unrealized P&amp;L</div>
          <div className={`v ${unrealized >= 0 ? 'rv-up' : 'rv-dn'}`}>
            {fmtUsd(unrealized, { signed: true })}
          </div>
          <div className="d">
            {unrealizedPct !== null ? `${fmtPct(unrealizedPct)} on cost · ` : ''}
            {equityCount} stocks · {optionCount} legs
          </div>
        </div>
        <div className="rv-kpi">
          <div className="k">Cash</div>
          <div className="v">{fmtUsd(summary?.cash_balance ?? null)}</div>
          <div className="d">available · live snapshot</div>
        </div>
        <div className="rv-kpi">
          <div className="k">Net delta (options)</div>
          <div className="v">
            {greeks?.total_delta !== undefined && greeks?.total_delta !== null
              ? `${greeks.total_delta >= 0 ? '+' : ''}${greeks.total_delta.toFixed(0)}`
              : '—'}
          </div>
          <div className="d">
            {greeks?.position_count
              ? `${greeks.position_count} legs · vega ${greeks.total_vega !== undefined ? greeks.total_vega.toFixed(0) : '—'}`
              : 'no option positions'}
          </div>
        </div>
      </div>

      <MacroNewsFeed />
    </>
  );
}
