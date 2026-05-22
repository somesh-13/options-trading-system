'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getCalendarSignals, type CalendarSignalsBundle } from '@/lib/pricing-api';
import type { CalendarPair } from '@/lib/calendar';
import IvTermTable from '@/components/calendar/IvTermTable';
import IvForwardCurve from '@/components/calendar/IvForwardCurve';
import EdgeDots from '@/components/calendar/EdgeDots';

const DEFAULT_TICKER = 'NVDA';
const REFRESH_MS = 5 * 60_000;

function formatExpiration(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

function ratioColor(ratio: number): string {
  if (ratio > 1.2) return 'var(--green)';
  if (ratio >= 1.05) return 'var(--gold)';
  return 'var(--ink-dim)';
}

function buildPricingDeepLink(
  ticker: string,
  pair: CalendarPair,
  strike: number | null | undefined,
): string {
  const params = new URLSearchParams({
    mode: 'calendar',
    ticker,
    short_expiry: pair.short.expiration,
    long_expiry: pair.long.expiration,
  });
  if (typeof strike === 'number' && Number.isFinite(strike) && strike > 0) {
    params.set('strike', String(strike));
  }
  return `/pricing?${params.toString()}`;
}

function PairRow({
  ticker,
  pair,
  strike,
  isSelected,
  onSelect,
}: {
  ticker: string;
  pair: CalendarPair;
  strike: number | null | undefined;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: 'left',
        width: '100%',
        background: isSelected ? 'rgba(255,215,0,.06)' : '#0c0d10',
        border: '1px solid ' + (isSelected ? 'rgba(255,215,0,.35)' : 'var(--line)'),
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'pointer',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr auto auto auto',
        gap: 12,
        alignItems: 'center',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 12,
        color: 'var(--ink)',
      }}
    >
      <div>
        <div className="text-meta" style={{ fontSize: 9 }}>SHORT</div>
        <div>
          {formatExpiration(pair.short.expiration)} ({pair.short.dte}d) ·{' '}
          {(pair.short.atm_iv! * 100).toFixed(0)}%
        </div>
      </div>
      <div>
        <div className="text-meta" style={{ fontSize: 9 }}>LONG</div>
        <div>
          {formatExpiration(pair.long.expiration)} ({pair.long.dte}d) ·{' '}
          {(pair.long.atm_iv! * 100).toFixed(0)}%
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="text-meta" style={{ fontSize: 9 }}>RATIO</div>
        <div style={{ color: ratioColor(pair.ratio), fontWeight: 600 }}>
          {pair.ratio.toFixed(2)}×
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="text-meta" style={{ fontSize: 9 }}>EDGE</div>
        <EdgeDots score={pair.edgeScore} fontSize={11} />
      </div>
      <Link
        href={buildPricingDeepLink(ticker, pair, strike)}
        className="rv-btn ghost"
        style={{ fontSize: 11, padding: '4px 10px' }}
        onClick={(e) => e.stopPropagation()}
      >
        build →
      </Link>
    </button>
  );
}

function CalendarPageInner() {
  const searchParams = useSearchParams();
  const initial = useMemo(() => {
    const t = searchParams?.get('ticker');
    return t && /^[A-Z0-9.\-]+$/i.test(t) ? t.toUpperCase() : DEFAULT_TICKER;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialShort = searchParams?.get('short_expiry') || null;
  const initialLong = searchParams?.get('long_expiry') || null;

  const [ticker, setTicker] = useState(initial);
  const [tickerInput, setTickerInput] = useState(initial);
  const [data, setData] = useState<CalendarSignalsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const bundle = await getCalendarSignals(ticker);
      setData(bundle);
      // If the URL pre-selects a pair, find its index in `all`.
      if (initialShort && initialLong) {
        const idx = bundle.all.findIndex(
          (p) => p.short.expiration === initialShort && p.long.expiration === initialLong,
        );
        setSelectedIdx(idx >= 0 ? idx : 0);
      } else {
        setSelectedIdx(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calendar signals');
      setData(null);
    } finally {
      setLoading(false);
    }
    // initialShort / initialLong are mount-time only; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const selectedPair: CalendarPair | null = data?.all[selectedIdx] ?? data?.best ?? null;

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '16px 18px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <h2 className="rv-h1" style={{ margin: 0 }}>Calendar Spreads</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = tickerInput.trim().toUpperCase();
              if (next && next !== ticker) setTicker(next);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="Ticker"
              spellCheck={false}
              maxLength={8}
              style={{
                width: 90,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                background: '#0c0d10',
                border: '1px solid var(--line)',
                color: 'var(--ink)',
                padding: '3px 6px',
                borderRadius: 3,
                textTransform: 'uppercase',
              }}
            />
            <button type="submit" className="rv-btn ghost" style={{ fontSize: 11, padding: '3px 8px' }}>
              load
            </button>
          </form>
          <button
            type="button"
            onClick={load}
            className="rv-btn ghost"
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            refresh
          </button>
          {data && (
            <span className="rv-sub" style={{ marginLeft: 'auto', margin: 0 }}>
              status: <b style={{ color: data.status === 'FAVORABLE' ? 'var(--green)' : data.status === 'NEUTRAL' ? 'var(--gold)' : 'var(--ink-dim)' }}>{data.status}</b>
              {' · '}HV(30D) {(data.hv * 100).toFixed(1)}%
            </span>
          )}
        </div>

        {loading && !data && (
          <div className="rv-sub">loading calendar signals…</div>
        )}
        {error && (
          <div
            style={{
              border: '1px solid rgba(255,0,110,.35)',
              background: 'rgba(255,0,110,.08)',
              color: 'var(--pink)',
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {data && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="rv-card">
                <div className="rv-card-head">
                  <h3>{ticker} IV TERM STRUCTURE</h3>
                </div>
                <IvTermTable
                  termStructure={data.termStructure}
                  hv={data.hv}
                  size="lg"
                />
              </div>
              <div className="rv-card">
                <div className="rv-card-head">
                  <h3>IV FORWARD CURVE</h3>
                </div>
                <IvForwardCurve
                  termStructure={data.termStructure}
                  hv={data.hv}
                  best={selectedPair ?? data.best}
                  height={200}
                  xMaxDte={35}
                />
              </div>
              <div className="rv-card">
                <div className="rv-card-head">
                  <h3>RANKED PAIRS · {data.all.length}</h3>
                </div>
                {data.all.length === 0 ? (
                  <div className="rv-sub">
                    no viable front/back pair in the 7d / 21d window for {ticker}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.all.map((pair, i) => (
                      <PairRow
                        key={`${pair.short.expiration}-${pair.long.expiration}`}
                        ticker={ticker}
                        pair={pair}
                        strike={data.atmStrike}
                        isSelected={i === selectedIdx}
                        onSelect={() => setSelectedIdx(i)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="rv-card">
                <div className="rv-card-head">
                  <h3>SELECTED PAIR</h3>
                </div>
                {selectedPair ? (
                  <>
                    <div
                      style={{
                        background: '#0c0d10',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        padding: 12,
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 12,
                        display: 'grid',
                        gap: 8,
                      }}
                    >
                      <div>
                        <div className="text-meta">SHORT (front)</div>
                        <div>
                          {formatExpiration(selectedPair.short.expiration)} ·{' '}
                          {selectedPair.short.dte}d ·{' '}
                          {(selectedPair.short.atm_iv! * 100).toFixed(1)}% IV
                        </div>
                      </div>
                      <div>
                        <div className="text-meta">LONG (back)</div>
                        <div>
                          {formatExpiration(selectedPair.long.expiration)} ·{' '}
                          {selectedPair.long.dte}d ·{' '}
                          {(selectedPair.long.atm_iv! * 100).toFixed(1)}% IV
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <span>
                          <span style={{ color: 'var(--ink-mute)' }}>Ratio </span>
                          <b style={{ color: ratioColor(selectedPair.ratio) }}>
                            {selectedPair.ratio.toFixed(2)}×
                          </b>
                        </span>
                        <span>
                          <span style={{ color: 'var(--ink-mute)' }}>Δ </span>
                          <b>
                            {selectedPair.differential >= 0 ? '+' : ''}
                            {selectedPair.differential.toFixed(1)}pp
                          </b>
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--ink-mute)' }}>Edge</span>
                          <EdgeDots score={selectedPair.edgeScore} fontSize={12} />
                        </span>
                      </div>
                    </div>
                    <Link
                      href={buildPricingDeepLink(ticker, selectedPair, data.atmStrike)}
                      className="rv-btn"
                      style={{
                        marginTop: 12,
                        width: '100%',
                        justifyContent: 'center',
                        textAlign: 'center',
                        display: 'block',
                        padding: '10px 12px',
                      }}
                    >
                      Build in Pricing →
                    </Link>
                  </>
                ) : (
                  <div className="rv-sub">No pair selected.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="rv-sub" style={{ padding: 16 }}>Loading calendar…</div>}>
      <CalendarPageInner />
    </Suspense>
  );
}
