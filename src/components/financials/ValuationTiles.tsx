'use client';

import { useEffect, useRef, useState } from 'react';
import { getValuationSnapshot, type ValuationSnapshot } from '@/lib/pricing-api';

interface Props {
  ticker: string;
  /** Increment to force a re-fetch — e.g., wired to the Financials Panel's
   *  "Scan latest" button so the tiles re-pull spot + force the underlying
   *  statements through the same cache-bypass path. */
  refreshKey?: number;
}

interface FetchState {
  snapshot: ValuationSnapshot | null;
  error: string | null;
  /** Identifies which {ticker, refreshKey} the in-state result belongs to.
   *  When this differs from the active key the UI treats the state as stale
   *  and shows a loading skeleton. */
  forKey: string | null;
}

const TILE_ORDER: string[] = ['pe', 'ps', 'pb', 'p_fcf', 'ev_ebitda', 'ev_sales'];

function formatMultiple(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `${v.toFixed(0)}x`;
  if (Math.abs(v) >= 100) return `${v.toFixed(1)}x`;
  return `${v.toFixed(2)}x`;
}

function formatMoneyM(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  // Backend value is in millions. Convert to B / T as needed.
  const trillions = m / 1_000_000;
  if (Math.abs(trillions) >= 1) return `$${trillions.toFixed(2)}T`;
  const billions = m / 1000;
  if (Math.abs(billions) >= 1) return `$${billions.toFixed(2)}B`;
  return `$${m.toFixed(0)}M`;
}

export function ValuationTiles({ ticker, refreshKey = 0 }: Props) {
  const [state, setState] = useState<FetchState>({ snapshot: null, error: null, forKey: null });
  const fetchSeqRef = useRef(0);
  const activeKey = `${ticker}|${refreshKey}`;

  useEffect(() => {
    const mySeq = ++fetchSeqRef.current;
    getValuationSnapshot(ticker, refreshKey > 0 ? { force: true } : undefined)
      .then((s) => {
        if (fetchSeqRef.current !== mySeq) return;
        setState({ snapshot: s, error: null, forKey: `${ticker}|${refreshKey}` });
      })
      .catch((e: Error) => {
        if (fetchSeqRef.current !== mySeq) return;
        setState({ snapshot: null, error: e.message, forKey: `${ticker}|${refreshKey}` });
      });
  }, [ticker, refreshKey]);

  // Loading = no result yet for the *current* (ticker, refreshKey) pair.
  // While a re-fetch is in flight, the previous snapshot stays visible
  // (stale-while-revalidate UX) and only flips when the new result arrives.
  const loading = state.forKey !== activeKey;
  const { snapshot, error } = state;

  if (!snapshot) {
    return (
      <div className="rv-card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="rv-sub" style={{ fontSize: 11, margin: 0 }}>
          {error ?? 'Loading valuation snapshot…'}
        </div>
      </div>
    );
  }

  if (snapshot.message) {
    return (
      <div className="rv-card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="rv-sub" style={{ fontSize: 11, margin: 0 }}>
          {snapshot.message}
        </div>
      </div>
    );
  }

  return (
    <div className="rv-card" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
      {/* Headline strip: market cap, EV, asof + spot context */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          {snapshot.ticker} Valuation
        </h3>
        <span className="rv-sub" style={{ fontSize: 11, margin: 0 }}>
          Live spot · latest annual filing {snapshot.asof_period ? `(${snapshot.asof_period})` : ''}
          {loading && (
            <span style={{ marginLeft: 8, color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
              ⟳ refreshing
            </span>
          )}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
          <span style={{ color: 'var(--ink-mute)' }}>
            spot{' '}
            <span style={{ color: 'var(--ink)' }}>
              {snapshot.spot != null ? `$${snapshot.spot.toFixed(2)}` : '—'}
            </span>
          </span>
          <span style={{ color: 'var(--ink-mute)' }}>
            mcap <span style={{ color: 'var(--ink)' }}>{formatMoneyM(snapshot.market_cap_m)}</span>
          </span>
          <span style={{ color: 'var(--ink-mute)' }}>
            EV <span style={{ color: 'var(--ink)' }}>{formatMoneyM(snapshot.enterprise_value_m)}</span>
          </span>
        </div>
      </div>

      {/* Tile grid: 6 multiples in a responsive flex row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 1,
          background: 'var(--line)',
        }}
      >
        {TILE_ORDER.map((key) => {
          const m = snapshot.multiples[key];
          if (!m) return null;
          const v = m.value;
          const display = formatMultiple(v);
          return (
            <div
              key={key}
              title={m.tooltip}
              style={{
                background: '#0d0e11',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--ink-mute)',
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {m.label}
              </span>
              <span
                style={{
                  fontSize: 18,
                  color: v == null ? 'var(--ink-mute)' : 'var(--ink)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                }}
              >
                {display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
