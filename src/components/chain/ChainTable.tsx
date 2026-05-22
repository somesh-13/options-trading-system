'use client';

/**
 * Live option chain table — renders real yfinance chain data.
 *
 * Two layouts (switched by CSS media query so SSR sees both):
 *  - Desktop (>720px): traditional Calls | Strike | Puts wide table.
 *  - Mobile (≤720px): Robinhood-style single-side view. A Call/Put pill
 *    toggle picks the side; rows show Strike (sticky-left, prominent) and
 *    a focused column set (Bid/Ask/Last/IV/OI/Vol). ITM rows are tinted
 *    and the ATM strike is badged.
 *
 * Click a Bid/Ask cell on either side to fire `onSelect` with strike,
 * option_type, side, and price — the parent page wires this into the
 * Robinhood OptionsTradePanel for one-click order tickets.
 *   - Clicking a CALL Bid cell  → SELL call at bid
 *   - Clicking a CALL Ask cell  → BUY  call at ask
 *   - Clicking a PUT  Bid cell  → SELL put  at bid
 *   - Clicking a PUT  Ask cell  → BUY  put  at ask
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const strikes = useMemo(
    () =>
      Array.from(
        new Set(
          [...calls, ...puts]
            .map((l) => l.strike)
            .filter((k): k is number => k != null),
        ),
      ).sort((a, b) => a - b),
    [calls, puts],
  );

  // Find ATM strike — the one closest to spot, if we have a spot.
  const atmStrike = useMemo(() => {
    if (strikes.length === 0) return null;
    if (spot == null || !Number.isFinite(spot)) return null;
    return strikes.reduce(
      (best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best),
      strikes[0],
    );
  }, [strikes, spot]);

  const callByStrike = useMemo(() => {
    const m = new Map<number, OptionChainLeg>();
    for (const c of calls) if (c.strike != null) m.set(c.strike, c);
    return m;
  }, [calls]);

  const putByStrike = useMemo(() => {
    const m = new Map<number, OptionChainLeg>();
    for (const p of puts) if (p.strike != null) m.set(p.strike, p);
    return m;
  }, [puts]);

  if (strikes.length === 0) {
    return (
      <div className="rv-sub" style={{ padding: 16, fontSize: 12 }}>
        No strikes available for {expiration}.
      </div>
    );
  }

  return (
    <>
      <div className="rv-chain-desktop">
        <DesktopChain
          strikes={strikes}
          spot={spot}
          atmStrike={atmStrike}
          callByStrike={callByStrike}
          putByStrike={putByStrike}
          onSelect={onSelect}
        />
      </div>
      <div className="rv-chain-mobile-wrap">
        <MobileChain
          strikes={strikes}
          spot={spot}
          atmStrike={atmStrike}
          callByStrike={callByStrike}
          putByStrike={putByStrike}
          onSelect={onSelect}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Desktop: full Calls | Strike | Puts table.
// ---------------------------------------------------------------------------

interface SideMaps {
  strikes: number[];
  spot: number | null;
  atmStrike: number | null;
  callByStrike: Map<number, OptionChainLeg>;
  putByStrike: Map<number, OptionChainLeg>;
  onSelect?: (p: ChainSelectPayload) => void;
}

function DesktopChain({ strikes, spot, atmStrike, callByStrike, putByStrike, onSelect }: SideMaps) {
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

          // Pre-populate the order panel with the leg's last traded price so
          // the user sees a real fill reference the moment the overlay opens.
          // Falls back to bid (for Bid clicks) / ask (for Ask clicks) when
          // `last` is missing — thinly-traded legs sometimes ship a null last.
          const callLast = c?.last && c.last > 0 ? c.last : null;
          const putLast = p?.last && p.last > 0 ? p.last : null;
          const onCallBid = c && c.bid != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'call', side: 'sell', price: (callLast ?? c.bid) as number })
            : undefined;
          const onCallAsk = c && c.ask != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'call', side: 'buy', price: (callLast ?? c.ask) as number })
            : undefined;
          const onPutBid = p && p.bid != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'put', side: 'sell', price: (putLast ?? p.bid) as number })
            : undefined;
          const onPutAsk = p && p.ask != null && onSelect
            ? () => onSelect({ strike: k, optionType: 'put', side: 'buy', price: (putLast ?? p.ask) as number })
            : undefined;
          // Bare strike click: no side committed, but still seed the panel's
          // limit with whichever leg has a usable last price (prefer call,
          // since the page defaults `optionType` to 'call').
          const strikeSeedPrice = callLast ?? putLast ?? c?.bid ?? c?.ask ?? p?.bid ?? p?.ask ?? undefined;

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
                onClick={onSelect ? () => onSelect({ strike: k, price: strikeSeedPrice }) : undefined}
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

// ---------------------------------------------------------------------------
// Mobile: Robinhood-style single-side view.
// ---------------------------------------------------------------------------

type Side = 'call' | 'put';

function MobileChain({ strikes, spot, atmStrike, callByStrike, putByStrike, onSelect }: SideMaps) {
  const [side, setSide] = useState<Side>('call');
  const legs = side === 'call' ? callByStrike : putByStrike;

  // On first render and whenever the strike list changes, scroll the ATM
  // strike into view so the user lands near-the-money instead of at the
  // deepest OTM row.
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);
  useEffect(() => {
    if (!bodyRef.current || atmStrike == null) return;
    const row = bodyRef.current.querySelector<HTMLTableRowElement>(
      `tr[data-strike="${atmStrike}"]`,
    );
    if (row) row.scrollIntoView({ block: 'center' });
  }, [atmStrike, side, strikes]);

  return (
    <div className="rv-chain-mobile">
      {/* Call / Put pill toggle */}
      <div className="rv-chain-side-toggle" role="tablist" aria-label="Option side">
        <button
          type="button"
          role="tab"
          aria-selected={side === 'call'}
          onClick={() => setSide('call')}
          className={side === 'call' ? 'on call' : ''}
        >
          Calls
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={side === 'put'}
          onClick={() => setSide('put')}
          className={side === 'put' ? 'on put' : ''}
        >
          Puts
        </button>
      </div>

      <div className="rv-chain-mobile-scroll">
        <table className="rv-chain-mobile-table">
          <thead>
            <tr>
              <th className="rv-sticky-col strike-col">Strike</th>
              <th className="r">Bid</th>
              <th className="r">Ask</th>
              <th className="r">Last</th>
              <th className="r">IV%</th>
              <th className="r">OI</th>
              <th className="r">Vol</th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {strikes.map((k) => {
              const l = legs.get(k);
              const itm = spot != null && (side === 'call' ? k < spot : k > spot);
              const atm = k === atmStrike;
              const rowClass = [itm ? 'itm' : '', atm ? 'atm' : ''].filter(Boolean).join(' ');

              // Prefer the leg's last traded price so the trade panel opens
              // with a real fill reference (not bid/ask) — falls back to the
              // tapped cell when last is unavailable.
              const lastPx = l?.last && l.last > 0 ? l.last : null;
              const onBid = l && l.bid != null && onSelect
                ? () => onSelect({ strike: k, optionType: side, side: 'sell', price: (lastPx ?? l.bid) as number })
                : undefined;
              const onAsk = l && l.ask != null && onSelect
                ? () => onSelect({ strike: k, optionType: side, side: 'buy', price: (lastPx ?? l.ask) as number })
                : undefined;
              const strikeSeedPrice = lastPx ?? l?.bid ?? l?.ask ?? undefined;
              const onStrike = onSelect
                ? () => onSelect({ strike: k, optionType: side, price: strikeSeedPrice })
                : undefined;

              return (
                <tr key={k} data-strike={k} className={rowClass}>
                  <td
                    className="rv-sticky-col strike-col"
                    onClick={onStrike}
                    style={onStrike ? { cursor: 'pointer' } : undefined}
                    title={onStrike ? `Set strike ${k}` : undefined}
                  >
                    <span className="strike-val">{k.toFixed(2)}</span>
                    {atm && <span className="strike-atm">ATM</span>}
                  </td>
                  <td
                    className="r bid"
                    onClick={onBid}
                    style={onBid ? { cursor: 'pointer' } : undefined}
                    title={onBid ? `SELL ${side} ${k} @ ${l?.bid}` : undefined}
                  >
                    {fmtNum(l?.bid ?? null)}
                  </td>
                  <td
                    className="r ask"
                    onClick={onAsk}
                    style={onAsk ? { cursor: 'pointer' } : undefined}
                    title={onAsk ? `BUY ${side} ${k} @ ${l?.ask}` : undefined}
                  >
                    {fmtNum(l?.ask ?? null)}
                  </td>
                  <td className="r">{fmtNum(l?.last ?? null)}</td>
                  <td className="r">{fmtIvPct(l?.iv ?? null)}</td>
                  <td className="r">{fmtInt(l?.open_interest ?? null)}</td>
                  <td className="r">{fmtInt(l?.volume ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rv-chain-mobile-hint">
        tap <b>Bid</b> to sell · tap <b>Ask</b> to buy
      </div>
    </div>
  );
}
