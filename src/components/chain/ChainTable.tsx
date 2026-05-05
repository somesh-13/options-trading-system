'use client';

/**
 * Live option chain table — renders real yfinance chain data.
 *
 * Visual columns:
 *   CALLS:  Bid · Ask · Last · IV · OI · Vol
 *   Strike (centered, ATM badge if closest to spot)
 *   PUTS:   Bid · Ask · Last · IV · OI · Vol
 *
 * Click a Bid/Ask cell on either side to fire `onSelect` with the strike,
 * option_type, side, and price — the parent page wires this into the
 * Robinhood OptionsTradePanel for one-click order tickets.
 *   - Clicking a CALL Bid cell  → SELL call at bid
 *   - Clicking a CALL Ask cell  → BUY  call at ask
 *   - Clicking a PUT  Bid cell  → SELL put  at bid
 *   - Clicking a PUT  Ask cell  → BUY  put  at ask
 */

import type { OptionChainLeg } from '@/lib/pricing-api';

export interface ChainSelectPayload {
  strike: number;
  // Set when the user clicks a Bid/Ask cell. Omitted when they click the
  // strike column directly — in that case only `strike` is populated and
  // the trade panel keeps its current side/type/limit-price defaults.
  optionType?: 'call' | 'put';
  side?: 'buy' | 'sell';
  price?: number;
}

export interface ChainTableProps {
  expiration: string;
  spot: number | null;
  calls: OptionChainLeg[];
  puts: OptionChainLeg[];
  onSelect?: (payload: ChainSelectPayload) => void;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString();
}

function fmtIvPct(iv: number | null | undefined): string {
  if (iv == null || !Number.isFinite(iv)) return '—';
  return `${(iv * 100).toFixed(0)}`;
}

const QUOTE_CELL_BASE: React.CSSProperties = {
  cursor: 'pointer',
  position: 'relative',
};

function QuoteCell({
  value,
  itm,
  onClick,
  title,
}: {
  value: number | null;
  itm: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const className = `r ${itm ? 'itm' : ''}`;
  if (value == null || !onClick) {
    return <td className={className}>{fmtNum(value)}</td>;
  }
  return (
    <td
      className={className}
      style={QUOTE_CELL_BASE}
      onClick={onClick}
      title={title}
    >
      {fmtNum(value)}
    </td>
  );
}

export function ChainTable({ expiration, spot, calls, puts, onSelect }: ChainTableProps) {
  // Merge calls and puts by strike so each row shows both legs for the same strike.
  const strikes = Array.from(
    new Set(
      [...calls, ...puts]
        .map((l) => l.strike)
        .filter((k): k is number => k != null),
    ),
  ).sort((a, b) => a - b);

  if (strikes.length === 0) {
    return (
      <div className="rv-sub" style={{ padding: 16, fontSize: 12 }}>
        No strikes available for {expiration}.
      </div>
    );
  }

  // Find ATM strike — the one closest to spot, if we have a spot.
  let atmStrike: number | null = null;
  if (spot != null && Number.isFinite(spot)) {
    atmStrike = strikes.reduce((best, k) =>
      Math.abs(k - spot) < Math.abs(best - spot) ? k : best,
    strikes[0]);
  }

  const callByStrike = new Map<number, OptionChainLeg>();
  for (const c of calls) if (c.strike != null) callByStrike.set(c.strike, c);
  const putByStrike = new Map<number, OptionChainLeg>();
  for (const p of puts) if (p.strike != null) putByStrike.set(p.strike, p);

  return (
    <table className="rv-table rv-chain">
      <thead>
        <tr className="head2">
          <th
            colSpan={6}
            style={{ textAlign: 'center', color: 'var(--green)', borderRight: '1px solid var(--line)' }}
          >
            CALLS
          </th>
          <th rowSpan={2} className="r" style={{ verticalAlign: 'bottom' }}>
            Strike
          </th>
          <th colSpan={6} style={{ textAlign: 'center', color: 'var(--pink)' }}>
            PUTS
          </th>
        </tr>
        <tr>
          <th className="r">Bid</th>
          <th className="r">Ask</th>
          <th className="r">Last</th>
          <th className="r">IV%</th>
          <th className="r">OI</th>
          <th className="r" style={{ borderRight: '1px solid var(--line)' }}>Vol</th>
          <th className="r">Bid</th>
          <th className="r">Ask</th>
          <th className="r">Last</th>
          <th className="r">IV%</th>
          <th className="r">OI</th>
          <th className="r">Vol</th>
        </tr>
      </thead>
      <tbody>
        {strikes.map((k) => {
          const c = callByStrike.get(k);
          const p = putByStrike.get(k);
          const callItm = spot != null && k < spot;
          const putItm = spot != null && k > spot;
          const atm = k === atmStrike;
          const rowClass = atm ? 'atm' : '';

          const onCallBid = c && c.bid != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'call', side: 'sell', price: c.bid as number })
            : undefined;
          const onCallAsk = c && c.ask != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'call', side: 'buy', price: c.ask as number })
            : undefined;
          const onPutBid = p && p.bid != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'put', side: 'sell', price: p.bid as number })
            : undefined;
          const onPutAsk = p && p.ask != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'put', side: 'buy', price: p.ask as number })
            : undefined;

          return (
            <tr key={k} className={rowClass}>
              {/* Calls side — Bid (sell) / Ask (buy) are click targets */}
              <QuoteCell value={c?.bid ?? null} itm={callItm} onClick={onCallBid} title={onCallBid ? `SELL call ${k} @ ${c?.bid}` : undefined} />
              <QuoteCell value={c?.ask ?? null} itm={callItm} onClick={onCallAsk} title={onCallAsk ? `BUY call ${k} @ ${c?.ask}` : undefined} />
              <td className={`r ${callItm ? 'itm' : ''}`}>{fmtNum(c?.last ?? null)}</td>
              <td className="r">{fmtIvPct(c?.iv ?? null)}</td>
              <td className="r">{fmtInt(c?.open_interest ?? null)}</td>
              <td className="r" style={{ borderRight: '1px solid var(--line)' }}>{fmtInt(c?.volume ?? null)}</td>
              <td
                className="r strike"
                style={onSelect ? { cursor: 'pointer' } : undefined}
                onClick={onSelect ? () => onSelect({ strike: k }) : undefined}
                title={onSelect ? `Set strike ${k}` : undefined}
              >
                <b>{k.toFixed(2)}</b>
                {atm && (
                  <span
                    className="rv-chip"
                    style={{
                      background: 'rgba(58,141,255,.15)',
                      color: 'var(--blue)',
                      padding: '1px 4px',
                      marginLeft: 4,
                      fontSize: 9,
                    }}
                  >
                    ATM
                  </span>
                )}
              </td>
              {/* Puts side */}
              <QuoteCell value={p?.bid ?? null} itm={putItm} onClick={onPutBid} title={onPutBid ? `SELL put ${k} @ ${p?.bid}` : undefined} />
              <QuoteCell value={p?.ask ?? null} itm={putItm} onClick={onPutAsk} title={onPutAsk ? `BUY put ${k} @ ${p?.ask}` : undefined} />
              <td className={`r ${putItm ? 'itm' : ''}`}>{fmtNum(p?.last ?? null)}</td>
              <td className="r">{fmtIvPct(p?.iv ?? null)}</td>
              <td className="r">{fmtInt(p?.open_interest ?? null)}</td>
              <td className="r">{fmtInt(p?.volume ?? null)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
