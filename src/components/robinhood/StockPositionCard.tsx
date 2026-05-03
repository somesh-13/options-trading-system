'use client';

/**
 * Shows the user's actual Robinhood position in a given ticker.
 * Displayed on the stock detail page — always rendered (empty state handles
 * tickers not in the portfolio).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  getRobinhoodHoldings,
  type RobinhoodHolding,
  type RobinhoodOption,
} from '@/lib/robinhood-api';

// ---- formatters -------------------------------------------------------------

const fmt = (n: number | null | undefined, fraction = 2) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

const fmtMoney = (n: number | null | undefined, fraction = 2) =>
  n == null ? '—' : `$${fmt(n, fraction)}`;

const fmtSigned = (n: number | null | undefined) => {
  if (n == null) return '—';
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const cls = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');

const ACCOUNT_LABEL: Record<string, string> = {
  brokerage: 'Individual',
  roth_ira: 'Roth IRA',
  sofi: 'SoFi',
  crypto: 'Crypto',
};
const accountLabel = (a: string) => ACCOUNT_LABEL[a] ?? a.replace('_', ' ');

// ---- helpers ----------------------------------------------------------------

function detectStrategy(
  shares: number,
  legs: RobinhoodOption[],
): { label: string; tone: 'good' | 'neutral' | 'warn' } | null {
  if (legs.length === 0) return null;
  const longCalls  = legs.filter((l) => l.side === 'Call' && l.position === 'long');
  const shortCalls = legs.filter((l) => l.side === 'Call' && l.position === 'short');
  const longPuts   = legs.filter((l) => l.side === 'Put'  && l.position === 'long');
  const shortPuts  = legs.filter((l) => l.side === 'Put'  && l.position === 'short');
  const totalShortCallContracts = shortCalls.reduce((s, l) => s + l.quantity, 0);
  const totalLongCallContracts  = longCalls.reduce((s, l) => s + l.quantity, 0);

  if (shortCalls.length > 0 && longCalls.length === 0 && longPuts.length === 0 && shortPuts.length === 0) {
    return shares >= totalShortCallContracts * 100
      ? { label: 'Covered call', tone: 'good' }
      : { label: 'Naked call', tone: 'warn' };
  }
  if (shortPuts.length > 0 && longPuts.length === 0 && longCalls.length === 0 && shortCalls.length === 0) {
    return { label: 'Short put', tone: 'neutral' };
  }
  if (longPuts.length > 0 && shares > 0 && shortPuts.length === 0 && longCalls.length === 0 && shortCalls.length === 0) {
    return { label: 'Protective put', tone: 'good' };
  }
  if (longCalls.length > 0 && shortCalls.length > 0 && longPuts.length === 0 && shortPuts.length === 0
      && totalLongCallContracts === totalShortCallContracts) {
    return { label: 'Call spread', tone: 'neutral' };
  }
  if (shares > 0 && (longCalls.length > 0 || shortCalls.length > 0)) {
    return { label: 'Stock + options combo', tone: 'neutral' };
  }
  return { label: `${legs.length} option leg${legs.length === 1 ? '' : 's'}`, tone: 'neutral' };
}

interface PerAccountEquity {
  account: string;
  qty: number;
  avgCost: number;
  costBasis: number;
  marketValue: number | null;
  unrealized: number | null;
  inferred: boolean;
}

function buildEquityRows(rows: RobinhoodHolding[], ticker: string): PerAccountEquity[] {
  const t = ticker.toUpperCase();
  return rows
    .filter((h) => h.symbol.toUpperCase() === t)
    .map((h) => ({
      account: h.account,
      qty: h.quantity,
      avgCost: h.avg_cost,
      costBasis: h.cost_basis,
      marketValue: h.market_value ?? null,
      unrealized: h.unrealized_pnl ?? null,
      inferred: h.inferred_opening,
    }));
}

// ---- option sort ------------------------------------------------------------

type OptSortKey = 'side' | 'position' | 'strike' | 'expiry' | 'quantity' | 'market_value' | 'unrealized_pnl';
type SortDir = 'asc' | 'desc';

const OPT_COLS: Array<{ key: OptSortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'side', label: 'Side', align: 'left' },
  { key: 'position', label: 'Position', align: 'left' },
  { key: 'strike', label: 'Strike', align: 'right' },
  { key: 'expiry', label: 'Expiry', align: 'left' },
  { key: 'quantity', label: 'Qty', align: 'right' },
  { key: 'market_value', label: 'Mkt value', align: 'right' },
  { key: 'unrealized_pnl', label: 'Unrealized', align: 'right' },
];

function optValue(o: RobinhoodOption, key: OptSortKey): number | string | null | undefined {
  switch (key) {
    case 'side': return o.side;
    case 'position': return o.position;
    case 'strike': return o.strike;
    case 'expiry': return o.expiry;
    case 'quantity': return o.quantity;
    case 'market_value': return o.market_value;
    case 'unrealized_pnl': return o.unrealized_pnl;
  }
}

function compareOpt(a: RobinhoodOption, b: RobinhoodOption, key: OptSortKey, dir: SortDir): number {
  const av = optValue(a, key);
  const bv = optValue(b, key);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const cmp = typeof av === 'string' && typeof bv === 'string'
    ? av.localeCompare(bv)
    : (av as number) - (bv as number);
  return dir === 'asc' ? cmp : -cmp;
}

// ---- component --------------------------------------------------------------

export function StockPositionCard({ ticker }: { ticker: string }) {
  const [equityRows, setEquityRows] = useState<PerAccountEquity[] | 'loading'>('loading');
  const [optionLegs, setOptionLegs] = useState<RobinhoodOption[] | 'loading'>('loading');
  const [err, setErr] = useState<string | null>(null);

  const [optSortKey, setOptSortKey] = useState<OptSortKey>('expiry');
  const [optSortDir, setOptSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    let cancelled = false;
    getRobinhoodHoldings(true, 'all', 'live')
      .then((data) => {
        if (cancelled) return;
        setEquityRows(buildEquityRows(data.equities, ticker));
        setOptionLegs(data.options.filter((o) => o.underlying.toUpperCase() === ticker.toUpperCase()));
        setErr(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setErr(e.message);
        setEquityRows([]);
        setOptionLegs([]);
      });
    return () => { cancelled = true; };
  }, [ticker]);

  const loading = equityRows === 'loading' || optionLegs === 'loading';
  const equities = useMemo<PerAccountEquity[]>(
    () => (equityRows === 'loading' ? [] : equityRows),
    [equityRows],
  );
  const options = useMemo<RobinhoodOption[]>(
    () => (optionLegs === 'loading' ? [] : optionLegs),
    [optionLegs],
  );

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => compareOpt(a, b, optSortKey, optSortDir)),
    [options, optSortKey, optSortDir],
  );

  const totals = useMemo(() => {
    const totalQty = equities.reduce((s, r) => s + r.qty, 0);
    const totalCost = equities.reduce((s, r) => s + r.costBasis, 0);
    const hasMV = equities.some((r) => r.marketValue != null);
    const totalMV = hasMV ? equities.reduce((s, r) => s + (r.marketValue ?? 0), 0) : null;
    const hasUn = equities.some((r) => r.unrealized != null);
    const totalUn = hasUn ? equities.reduce((s, r) => s + (r.unrealized ?? 0), 0) : null;
    const blendedAvg = totalQty > 0 && totalCost > 0 ? totalCost / totalQty : null;
    return { totalQty, totalCost, totalMV, totalUn, blendedAvg };
  }, [equities]);

  // Option totals — sign-correct for net portfolio contribution.
  // Per-leg market_value is gross-positive; long is an asset (+mv), short is
  // a liability to close (−mv). cost_basis is already signed (long: -debit
  // paid, short: +credit received). unrealized_pnl is signed correctly per
  // leg. So:
  //   netContracts   = +qty for longs, −qty for shorts (a market-direction
  //                    proxy; mostly informational)
  //   netMarketValue = signed sum (cost to close all legs)
  //   netCostBasis   = signed sum (positive = net credit received opening
  //                                the position, negative = net debit)
  //   netUnrealized  = simple sum of per-leg unrealized
  const optTotals = useMemo(() => {
    let netContracts = 0;
    let netMarketValue = 0;
    let netCostBasis = 0;
    let netUnrealized = 0;
    let mvSeen = false;
    let unSeen = false;
    for (const o of options) {
      const sign = o.position === 'long' ? 1 : -1;
      netContracts += sign * o.quantity;
      netCostBasis += o.cost_basis;
      if (o.market_value != null) {
        netMarketValue += sign * o.market_value;
        mvSeen = true;
      }
      if (o.unrealized_pnl != null) {
        netUnrealized += o.unrealized_pnl;
        unSeen = true;
      }
    }
    return {
      netContracts,
      netCostBasis,
      netMarketValue: mvSeen ? netMarketValue : null,
      netUnrealized: unSeen ? netUnrealized : null,
    };
  }, [options]);

  const hasEquity = equities.length > 0;
  const hasOptions = options.length > 0;
  const strategy = !loading && !err
    ? detectStrategy(totals.totalQty, options)
    : null;
  const toneColor = strategy?.tone === 'good'
    ? 'var(--green, #00C805)'
    : strategy?.tone === 'warn'
      ? 'var(--pink, #FF006E)'
      : 'var(--gold, #FFD700)';

  const onOptHeader = (key: OptSortKey) => {
    if (optSortKey === key) {
      setOptSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOptSortKey(key);
      setOptSortDir(['side', 'position', 'expiry'].includes(key) ? 'asc' : 'desc');
    }
  };
  const arrow = (k: OptSortKey) => (optSortKey === k ? (optSortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className="rv-card" style={{ marginBottom: 14 }}>
      <div className="rv-card-head">
        <h3 style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
          Your position · {ticker.toUpperCase()}
        </h3>
        {strategy && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 999,
              border: `1px solid ${toneColor}`,
              color: toneColor,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
            }}
            title="Detected from your equity + option legs"
          >
            {strategy.label}
          </span>
        )}
      </div>

      {loading && <div className="rv-sub" style={{ fontSize: 11 }}>loading…</div>}

      {!loading && err && (
        <div style={{ color: 'var(--pink)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
          error: {err}
        </div>
      )}

      {!loading && !err && !hasEquity && !hasOptions && (
        <div className="rv-sub" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
          No open position in this ticker
        </div>
      )}

      {!loading && !err && hasEquity && (
        <div style={{ marginBottom: hasOptions ? 12 : 0, overflowX: 'auto' }}>
          <table
            className="rv-table"
            style={{ width: '100%', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Account</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Avg cost</th>
                <th style={{ textAlign: 'right' }}>Cost basis</th>
                <th style={{ textAlign: 'right' }}>Mkt value</th>
                <th style={{ textAlign: 'right' }}>Unrealized</th>
              </tr>
            </thead>
            <tbody>
              {equities.map((r) => (
                <tr key={r.account}>
                  <td>{accountLabel(r.account)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.qty, 4)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.inferred ? '—' : fmtMoney(r.avgCost)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(r.costBasis)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(r.marketValue)}</td>
                  <td className={cls(r.unrealized)} style={{ textAlign: 'right' }}>
                    {fmtSigned(r.unrealized)}
                  </td>
                </tr>
              ))}
              {equities.length > 1 && (
                <tr style={{ borderTop: '1px solid var(--line)', fontWeight: 700 }}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.totalQty, 4)}</td>
                  <td style={{ textAlign: 'right' }} title="cost-weighted average">
                    {totals.blendedAvg != null ? fmtMoney(totals.blendedAvg) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(totals.totalCost)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(totals.totalMV)}</td>
                  <td className={cls(totals.totalUn)} style={{ textAlign: 'right' }}>
                    {fmtSigned(totals.totalUn)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !err && hasOptions && (
        <div>
          <div className="rv-sub" style={{ fontSize: 11, marginBottom: 4 }}>
            Option leg{options.length === 1 ? '' : 's'} ({options.length})
          </div>
          <div className="rv-table-wrap" style={{ overflowX: 'auto' }}>
            <table
              className="rv-table"
              style={{ width: '100%', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
            >
              <thead>
                <tr>
                  {OPT_COLS.map((col) => {
                    const active = optSortKey === col.key;
                    return (
                      <th
                        key={col.key}
                        onClick={() => onOptHeader(col.key)}
                        aria-sort={active ? (optSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        style={{
                          textAlign: col.align,
                          cursor: 'pointer',
                          userSelect: 'none',
                          color: active ? 'var(--gold, #FFD700)' : undefined,
                        }}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}{arrow(col.key)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedOptions.map((o, i) => (
                  <tr key={`${o.account}-${o.strike}-${o.expiry}-${o.side}-${i}`}>
                    <td>{o.side}</td>
                    <td>
                      <span className={o.position === 'long' ? 'rv-up' : 'rv-dn'}>{o.position}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>${fmt(o.strike, 2)}</td>
                    <td>{o.expiry}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(o.quantity, 0)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(o.market_value ?? null)}</td>
                    <td className={cls(o.unrealized_pnl)} style={{ textAlign: 'right' }}>
                      {fmtSigned(o.unrealized_pnl ?? null)}
                    </td>
                  </tr>
                ))}
                {options.length > 1 && (
                  <tr style={{ borderTop: '1px solid var(--line)', fontWeight: 700 }}>
                    <td colSpan={4} title="Sign-corrected: long legs add, short legs subtract">
                      Total ({options.length} legs)
                    </td>
                    <td
                      className={optTotals.netContracts > 0 ? 'rv-up' : optTotals.netContracts < 0 ? 'rv-dn' : ''}
                      style={{ textAlign: 'right' }}
                      title="Long contracts minus short contracts"
                    >
                      {optTotals.netContracts >= 0 ? '+' : ''}{fmt(optTotals.netContracts, 0)}
                    </td>
                    <td
                      className={cls(optTotals.netMarketValue)}
                      style={{ textAlign: 'right' }}
                      title="Net cost to close all legs (longs as asset, shorts as liability)"
                    >
                      {fmtSigned(optTotals.netMarketValue)}
                    </td>
                    <td
                      className={cls(optTotals.netUnrealized)}
                      style={{ textAlign: 'right' }}
                      title="Sum of per-leg mark-to-market P&L"
                    >
                      {fmtSigned(optTotals.netUnrealized)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {options.length > 1 && optTotals.netCostBasis !== 0 && (
            <div className="rv-sub" style={{ fontSize: 10, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              Net premium flowed when opening:{' '}
              <span className={cls(optTotals.netCostBasis)}>
                {fmtSigned(optTotals.netCostBasis)}
              </span>
              {' '}({optTotals.netCostBasis > 0 ? 'net credit received' : 'net debit paid'})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
