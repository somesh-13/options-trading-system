'use client';

/**
 * Shows the user's actual Robinhood position in a given ticker.
 * Displayed on the stock detail page — always rendered (empty state handles
 * tickers not in the portfolio).
 */

import { useEffect, useState } from 'react';
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

// ---- helpers ----------------------------------------------------------------

interface AggEquity {
  symbol: string;
  totalQty: number;
  totalCost: number;
  totalMV: number | null;
  totalUnrealized: number | null;
  byAccount: Array<{ account: string; qty: number }>;
  inferred: boolean;
}

function aggregateEquity(rows: RobinhoodHolding[], ticker: string): AggEquity | null {
  const matching = rows.filter((h) => h.symbol.toUpperCase() === ticker.toUpperCase());
  if (matching.length === 0) return null;
  const totalQty = matching.reduce((s, h) => s + h.quantity, 0);
  const totalCost = matching.reduce((s, h) => s + h.cost_basis, 0);
  const hasMV = matching.some((h) => h.market_value != null);
  const totalMV = hasMV ? matching.reduce((s, h) => s + (h.market_value ?? 0), 0) : null;
  const hasUn = matching.some((h) => h.unrealized_pnl != null);
  const totalUnrealized = hasUn ? matching.reduce((s, h) => s + (h.unrealized_pnl ?? 0), 0) : null;
  const byAccount = matching.map((h) => ({ account: h.account, qty: h.quantity }));
  const inferred = matching.some((h) => h.inferred_opening);
  return { symbol: ticker.toUpperCase(), totalQty, totalCost, totalMV, totalUnrealized, byAccount, inferred };
}

// ---- component --------------------------------------------------------------

export function StockPositionCard({ ticker }: { ticker: string }) {
  const [equityPos, setEquityPos] = useState<AggEquity | null | 'loading'>('loading');
  const [optionLegs, setOptionLegs] = useState<RobinhoodOption[] | 'loading'>('loading');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRobinhoodHoldings(true, 'all', 'live')
      .then((data) => {
        if (cancelled) return;
        const eq = aggregateEquity(data.equities, ticker);
        const opts = data.options.filter(
          (o) => o.underlying.toUpperCase() === ticker.toUpperCase(),
        );
        setEquityPos(eq);
        setOptionLegs(opts);
        setErr(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setErr(e.message);
        setEquityPos(null);
        setOptionLegs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const loading = equityPos === 'loading' || optionLegs === 'loading';
  const equity = equityPos === 'loading' ? null : equityPos;
  const options = optionLegs === 'loading' ? [] : optionLegs;

  const hasEquity = equity != null;
  const hasOptions = options.length > 0;

  return (
    <div className="rv-card" style={{ marginBottom: 14 }}>
      <div className="rv-card-head">
        <h3 style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
          Your position · {ticker.toUpperCase()}
        </h3>
      </div>

      {loading && (
        <div className="rv-sub" style={{ fontSize: 11 }}>loading…</div>
      )}

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

      {!loading && !err && hasEquity && equity && (
        <div style={{ marginBottom: hasOptions ? 12 : 0 }}>
          {/* Equity summary row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, auto)',
              gap: '4px 16px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              alignItems: 'baseline',
              marginBottom: 4,
            }}
          >
            <div>
              <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{fmt(equity.totalQty, 2)}</span>
              <span className="rv-sub" style={{ marginLeft: 4 }}>shares</span>
            </div>
            <div>
              <span className="rv-sub">cost </span>
              <span style={{ color: 'var(--ink)' }}>
                {equity.inferred ? '—' : fmtMoney(equity.totalCost > 0 ? equity.totalCost / equity.totalQty : null)}
              </span>
            </div>
            {equity.totalMV != null && (
              <div>
                <span className="rv-sub">market </span>
                <span style={{ color: 'var(--ink)' }}>{fmtMoney(equity.totalMV)}</span>
              </div>
            )}
            {equity.totalUnrealized != null && (
              <div>
                <span className={`${cls(equity.totalUnrealized)}`} style={{ fontWeight: 600 }}>
                  {fmtSigned(equity.totalUnrealized)} unrealized
                </span>
              </div>
            )}
          </div>

          {/* Account breakdown when held in >1 account */}
          {equity.byAccount.length > 1 && (
            <div className="rv-sub" style={{ fontSize: 10, marginTop: 2 }}>
              {equity.byAccount
                .map((a) => `${fmt(a.qty, 0)} in ${a.account.replace('_', ' ')}`)
                .join(' + ')}{' '}
              = {fmt(equity.totalQty, 0)} total
            </div>
          )}
        </div>
      )}

      {!loading && !err && hasOptions && (
        <div>
          <div className="rv-sub" style={{ fontSize: 11, marginBottom: 4 }}>
            Option leg{options.length === 1 ? '' : 's'} ({options.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table
              className="rv-table"
              style={{ width: '100%', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
            >
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Position</th>
                  <th style={{ textAlign: 'right' }}>Strike</th>
                  <th>Expiry</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Mkt value</th>
                  <th style={{ textAlign: 'right' }}>Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {options.map((o, i) => (
                  <tr key={`${o.underlying}-${o.strike}-${o.expiry}-${o.side}-${i}`}>
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
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
