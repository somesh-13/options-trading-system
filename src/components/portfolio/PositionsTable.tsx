'use client';

/**
 * Live open-positions table — wired to Robinhood snapshot + portfolio Greeks.
 *
 * Sources:
 *   GET /api/robinhood/holdings?source=live (equities + option legs with mkt_value, unrealized_pnl)
 *   GET /api/robinhood/analytics/portfolio-greeks (per_position with underlying, expiry, signed greeks)
 *
 * Unlike the desktop "stock" detail page, this surface emphasises Greek
 * contribution. Equity rows show qty/cost/mkt-value/unrealized; option rows
 * additionally show per-leg Δ/Γ/Θ/V contribution (already sign-adjusted by
 * the backend so short legs come back negative).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getRobinhoodHoldings,
  type RobinhoodHoldingsResponse,
  type RobinhoodHolding,
  type RobinhoodOption,
} from '@/lib/robinhood-api';
import {
  getPortfolioGreeks,
  type PortfolioGreeksResult,
} from '@/lib/robinhood-analytics-api';

type SortKey = 'symbol' | 'mkt' | 'pnl' | 'delta';

type EnrichedOption = RobinhoodOption & {
  delta_contrib: number;
  gamma_contrib: number;
  theta_contrib: number;
  vega_contrib: number;
};

function fmt(n: number | null | undefined, signed = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const compact = abs >= 10_000;
  const fmt = compact
    ? `$${(abs / 1000).toFixed(1)}k`
    : `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (!signed) return n < 0 ? `-${fmt}` : fmt;
  if (n > 0) return `+${fmt}`;
  if (n < 0) return `−${fmt}`;
  return fmt;
}

function fmtNum(n: number | null | undefined, decimals = 1, signed = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = n.toFixed(decimals);
  if (signed && n > 0) return `+${v}`;
  return v;
}

export function PositionsTable() {
  const [holdings, setHoldings] = useState<RobinhoodHoldingsResponse | null>(null);
  const [greeks, setGreeks] = useState<PortfolioGreeksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('mkt');

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const [h, g] = await Promise.all([
        getRobinhoodHoldings(true, 'all', 'live'),
        getPortfolioGreeks('all').catch(() => null),
      ]);
      setHoldings(h);
      setGreeks(g);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load holdings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Stitch each option leg's Greek contribution from per_position. Match by
  // (underlying, expiry, strike, type, qty sign) — the only fields RH legs
  // and Greeks share. Multiplied by 100 to convert per-share to per-contract.
  const optionsEnriched: EnrichedOption[] = useMemo(() => {
    if (!holdings?.options) return [];
    const lookups = new Map<string, { d: number; g: number; t: number; v: number }>();
    if (greeks?.per_position) {
      for (const p of greeks.per_position) {
        const u = (p as Record<string, unknown>).underlying as string | undefined;
        const exp = (p as Record<string, unknown>).expiry as string | undefined;
        if (!u || !exp) continue;
        const qtyNum = Number(p.qty ?? 0);
        const sign = qtyNum >= 0 ? 'L' : 'S';
        const key = `${u}|${exp}|${Math.round((p.strike ?? 0) * 1000)}|${(p.type ?? '').toLowerCase()}|${sign}`;
        const mult = 100;
        const sign_qty = Math.sign(qtyNum) || 1;
        lookups.set(key, {
          // qty is signed in greeks per_position output, so multiplying by qty
          // and 100 gives signed dollar contribution. We store *signed* but
          // also keep magnitude for the caller to format.
          d: qtyNum * (p.greeks.delta ?? 0) * mult / sign_qty * sign_qty,
          g: qtyNum * (p.greeks.gamma ?? 0) * mult / sign_qty * sign_qty,
          t: qtyNum * (p.greeks.theta ?? 0) * mult / sign_qty * sign_qty,
          v: qtyNum * (p.greeks.vega ?? 0) * mult / sign_qty * sign_qty,
        });
      }
    }
    return holdings.options.map((o): EnrichedOption => {
      const sign = o.position === 'long' ? 'L' : 'S';
      const key = `${o.underlying.toUpperCase()}|${o.expiry}|${Math.round(o.strike * 1000)}|${o.side.toLowerCase()}|${sign}`;
      const g = lookups.get(key) ?? { d: 0, g: 0, t: 0, v: 0 };
      return {
        ...o,
        delta_contrib: g.d,
        gamma_contrib: g.g,
        theta_contrib: g.t,
        vega_contrib: g.v,
      };
    });
  }, [holdings, greeks]);

  const equitiesSorted = useMemo(() => {
    const list = [...(holdings?.equities ?? [])];
    list.sort((a, b) => {
      switch (sort) {
        case 'symbol': return a.symbol.localeCompare(b.symbol);
        case 'pnl':    return Math.abs(b.unrealized_pnl ?? 0) - Math.abs(a.unrealized_pnl ?? 0);
        case 'delta':  return Math.abs(b.market_value ?? 0) - Math.abs(a.market_value ?? 0);
        case 'mkt':
        default:       return Math.abs(b.market_value ?? 0) - Math.abs(a.market_value ?? 0);
      }
    });
    return list;
  }, [holdings, sort]);

  const optionsSorted = useMemo(() => {
    const list = [...optionsEnriched];
    list.sort((a, b) => {
      switch (sort) {
        case 'symbol': return a.underlying.localeCompare(b.underlying);
        case 'pnl':    return Math.abs(b.unrealized_pnl ?? 0) - Math.abs(a.unrealized_pnl ?? 0);
        case 'delta':  return Math.abs(b.delta_contrib) - Math.abs(a.delta_contrib);
        case 'mkt':
        default:       return Math.abs(b.market_value ?? 0) - Math.abs(a.market_value ?? 0);
      }
    });
    return list;
  }, [optionsEnriched, sort]);

  const equityCount = holdings?.equities.length ?? 0;
  const optionCount = holdings?.options.length ?? 0;

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Open positions — live snapshot</h3>
        <div className="tools" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className="on">{equityCount} stocks</span>
          <span className="on">{optionCount} legs</span>
          <button
            type="button"
            onClick={fetchAll}
            className="rv-btn ghost"
            style={{ fontSize: 11, padding: '2px 8px' }}
            disabled={loading}
          >
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
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
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      {/* Sort chips */}
      <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--ink-mute)' }}>sort:</span>
        {(['mkt', 'pnl', 'symbol', 'delta'] as SortKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSort(k)}
            className={sort === k ? 'on' : ''}
            style={{
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              padding: 0,
              font: 'inherit',
              color: sort === k ? 'var(--gold)' : 'var(--ink-mute)',
              textDecoration: sort === k ? 'underline' : 'none',
            }}
          >
            {k === 'mkt' ? 'mkt value' : k === 'pnl' ? 'unrealized' : k === 'delta' ? '|Δ contrib|' : k}
          </button>
        ))}
      </div>

      {/* Equities */}
      {equityCount > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4 }}>
            STOCKS
          </div>
          <div className="rv-table-wrap">
            <table className="rv-table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Account</th>
                  <th className="r">Qty</th>
                  <th className="r">Avg cost</th>
                  <th className="r">Mark</th>
                  <th className="r">Mkt value</th>
                  <th className="r">Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {equitiesSorted.map((e: RobinhoodHolding) => (
                  <tr key={`${e.account}|${e.symbol}`}>
                    <td>
                      <Link href={`/stock/${e.symbol}`} prefetch className="rv-ticker-link">
                        <b>{e.symbol}</b>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--ink-mute)', fontSize: 10.5 }}>
                      {e.account === 'brokerage' ? 'Individual' : e.account.replace('_', ' ')}
                    </td>
                    <td className="r">{e.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="r">${e.avg_cost.toFixed(2)}</td>
                    <td className="r">{e.current_price ? `$${e.current_price.toFixed(2)}` : '—'}</td>
                    <td className="r"><b>{fmt(e.market_value)}</b></td>
                    <td className={`r ${(e.unrealized_pnl ?? 0) >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {fmt(e.unrealized_pnl, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Options */}
      {optionCount > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', margin: '12px 0 4px' }}>
            OPTION LEGS — Greek contribution per leg
          </div>
          <div className="rv-table-wrap">
            <table className="rv-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Underlying</th>
                  <th>Side</th>
                  <th>Position</th>
                  <th className="r">Strike</th>
                  <th>Expiry</th>
                  <th className="r">Qty</th>
                  <th className="r">Mkt value</th>
                  <th className="r">P&amp;L</th>
                  <th className="r">Δ contrib</th>
                  <th className="r">Γ contrib</th>
                  <th className="r">Θ contrib</th>
                  <th className="r">V contrib</th>
                </tr>
              </thead>
              <tbody>
                {optionsSorted.map((o, i) => (
                  <tr key={`${o.account}|${o.underlying}|${o.side}|${o.strike}|${o.expiry}|${o.position}|${i}`}>
                    <td>
                      <Link href={`/stock/${o.underlying}`} prefetch className="rv-ticker-link">
                        <b>{o.underlying}</b>
                      </Link>
                    </td>
                    <td>
                      <span className={`rv-chip ${o.side === 'Call' ? 'buy' : 'sell'}`}>
                        {o.side}
                      </span>
                    </td>
                    <td>
                      <span className={`rv-chip ${o.position === 'long' ? 'buy' : 'sell'}`}>
                        {o.position}
                      </span>
                    </td>
                    <td className="r">${o.strike.toFixed(0)}</td>
                    <td style={{ fontSize: 10 }}>{o.expiry}</td>
                    <td className="r">{o.position === 'short' ? '−' : '+'}{o.quantity}</td>
                    <td className="r">{fmt(o.market_value)}</td>
                    <td className={`r ${(o.unrealized_pnl ?? 0) >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {fmt(o.unrealized_pnl, true)}
                    </td>
                    <td className="r">{fmtNum(o.delta_contrib, 1, true)}</td>
                    <td className="r">{fmtNum(o.gamma_contrib, 2, true)}</td>
                    <td className={`r ${o.theta_contrib >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {fmtNum(o.theta_contrib, 0, true)}
                    </td>
                    <td className={`r ${o.vega_contrib >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {fmtNum(o.vega_contrib, 0, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && equityCount === 0 && optionCount === 0 && (
        <div style={{ padding: 14, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 12 }}>
          No open positions in the live snapshot. Sync Robinhood to populate.
        </div>
      )}
    </div>
  );
}

export default PositionsTable;
