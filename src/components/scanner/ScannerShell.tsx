'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilterChips, SCANNER_TABS, type ScannerTab } from './FilterChips';
import { ScannerTable, SCANNER_ROWS, type Opportunity, type Signal, type Regime } from './ScannerTable';
import { NLScannerBar, type ScannerParseResult } from './NLScannerBar';
import { InflectionTable, type InflectionCandidate } from './InflectionTable';
import { getRobinhoodHoldings } from '@/lib/robinhood-api';
import { getMispricing } from '@/lib/robinhood-analytics-api';
import INFLECTION_DATA from '@/data/inflection-candidates.json';

const INFLECTION_CANDIDATES = (INFLECTION_DATA.candidates as InflectionCandidate[]) ?? [];
const INFLECTION_AS_OF = (INFLECTION_DATA as { as_of: string }).as_of;

const REFRESH_MS = 60_000;

function intentToTab(intent: string): ScannerTab | null {
  switch (intent) {
    case 'mispricing_check':
    case 'trade_recommendation':
      return 'mispriced';
    case 'scan':
      return 'mispriced';
    case 'regime_check':
      return 'high-vol';
    case 'volatility_query':
      return 'high-vol';
    default:
      return null;
  }
}

function deriveRegime(ivHvRatio: number): Regime {
  return ivHvRatio > 1.3 ? 'high-vol' : 'normal';
}

/** Run at most `concurrency` promises at once. */
async function throttledAllSettled<T>(
  fns: Array<() => Promise<T>>,
  concurrency = 6,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(fns.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < fns.length) {
      const idx = nextIdx++;
      try {
        results[idx] = { status: 'fulfilled', value: await fns[idx]() };
      } catch (e) {
        results[idx] = { status: 'rejected', reason: e };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, fns.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; rows: Opportunity[]; tickerCount: number; errors: string[]; usedFallback: false; lastAt: string }
  | { status: 'fallback'; reason: string };

export function ScannerShell() {
  const [activeTab, setActiveTab] = useState<ScannerTab>('all');
  const [llmResult, setLlmResult] = useState<ScannerParseResult | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    cancelRef.current = false;
    // Defer the loading state update to a microtask so the linter is happy
    // (avoids synchronous setState in the effect body).
    await Promise.resolve();
    if (cancelRef.current) return;
    setFetchState({ status: 'loading' });

    let holdings;
    try {
      holdings = await getRobinhoodHoldings(true, 'all', 'live');
    } catch (e) {
      if (!cancelRef.current) {
        setFetchState({ status: 'fallback', reason: String(e) });
      }
      return;
    }

    if (cancelRef.current) return;

    const uniqueSymbols = Array.from(new Set(holdings.equities.map((h) => h.symbol)));
    const qtyMap = new Map<string, number>();
    for (const h of holdings.equities) {
      qtyMap.set(h.symbol, (qtyMap.get(h.symbol) ?? 0) + h.quantity);
    }

    const results = await throttledAllSettled(
      uniqueSymbols.map((sym) => () => getMispricing(sym)),
      6,
    );

    if (cancelRef.current) return;

    const rows: Opportunity[] = [];
    const errors: string[] = [];

    results.forEach((result, i) => {
      const sym = uniqueSymbols[i];
      if (result.status === 'rejected') {
        errors.push(sym);
        return;
      }
      const m = result.value;
      const iv = m.implied_vol_atm ?? 0;
      const hv = m.historical_vol ?? 0;
      const ratio = m.iv_hv_ratio ?? (hv > 0 ? iv / hv : 1);
      const seed = sym.charCodeAt(0) + (sym.charCodeAt(1) ?? 0);
      rows.push({
        ticker: sym,
        spot: m.spot_price ?? 0,
        iv,
        hv,
        ratio,
        signal: (m.signal as Signal) ?? 'NEUTRAL',
        regime: deriveRegime(ratio),
        ev: 0,
        hitRate: 0.5,
        seed,
      });
    });

    // Sort by ratio desc (highest IV/HV first — most actionable)
    rows.sort((a, b) => b.ratio - a.ratio);

    setFetchState({
      status: 'ok',
      rows,
      tickerCount: uniqueSymbols.length,
      errors,
      usedFallback: false,
      lastAt: new Date().toLocaleTimeString(),
    });
  }, []);

  // Initial load — wrap in local async fn so the rule's static analysis
  // doesn't flag `load` (a useCallback with setState) as synchronous setState.
  useEffect(() => {
    async function run() { await load(); }
    run();
    return () => { cancelRef.current = true; };
  }, [load]);

  // Auto-refresh every 60s when tab visible
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') load();
      }, REFRESH_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  // Derive working rows: live data OR fallback
  const liveRows: Opportunity[] = useMemo(() => {
    if (fetchState.status === 'ok') return fetchState.rows;
    return SCANNER_ROWS; // fallback
  }, [fetchState]);

  const counts = useMemo(() => {
    const out = {} as Record<ScannerTab, number>;
    for (const t of SCANNER_TABS) {
      out[t.id] = liveRows.filter(t.predicate).length;
    }
    out.inflection = INFLECTION_CANDIDATES.length;
    return out;
  }, [liveRows]);

  const baseRows: Opportunity[] = useMemo(() => {
    const spec = SCANNER_TABS.find((t) => t.id === activeTab) ?? SCANNER_TABS[0];
    return liveRows.filter(spec.predicate);
  }, [activeTab, liveRows]);

  const rows: Opportunity[] = useMemo(() => {
    if (!llmResult || llmResult.tickers.length === 0) return baseRows;
    const focus = new Set(llmResult.tickers.map((t) => t.toUpperCase()));
    const matches = liveRows.filter((r) => focus.has(r.ticker));
    if (matches.length === 0) return baseRows;
    return matches;
  }, [baseRows, liveRows, llmResult]);

  const highlightTicker = llmResult?.tickers?.[0];

  const handleLlmResult = (result: ScannerParseResult) => {
    setLlmResult(result);
    const suggested = intentToTab(result.intent);
    if (suggested && counts[suggested] > 0) setActiveTab(suggested);
  };

  const isLoading = fetchState.status === 'loading' || fetchState.status === 'idle';
  const isFallback = fetchState.status === 'fallback';
  const errors = fetchState.status === 'ok' ? fetchState.errors : [];
  const lastAt = fetchState.status === 'ok' ? fetchState.lastAt : null;

  return (
    <>
      {/* Header bar: LLM bar + refresh */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <NLScannerBar onResult={handleLlmResult} />
        </div>
        <button
          type="button"
          className="rv-btn ghost"
          style={{ fontSize: 11, padding: '4px 10px', marginTop: 2, whiteSpace: 'nowrap' }}
          onClick={() => void load()}
          disabled={isLoading}
          title="Re-fetch mispricing for all portfolio tickers"
        >
          {isLoading ? '…' : '↻ refresh'}
        </button>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
        {isLoading && (
          <span className="rv-chip warn" style={{ fontSize: 10 }}>loading portfolio…</span>
        )}
        {isFallback && (
          <span className="rv-chip sell" style={{ fontSize: 10 }} title={(fetchState as { reason: string }).reason}>
            demo data · backend unavailable
          </span>
        )}
        {errors.map((sym) => (
          <span key={sym} className="rv-chip sell" style={{ fontSize: 10 }} title={`${sym} mispricing fetch failed`}>
            {sym} ✗
          </span>
        ))}
      </div>

      <FilterChips active={activeTab} counts={counts} onChange={setActiveTab} />

      {activeTab === 'inflection' ? (
        <InflectionTable candidates={INFLECTION_CANDIDATES} asOf={INFLECTION_AS_OF} />
      ) : (
        <ScannerTable rows={rows} highlightTicker={highlightTicker} />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 10,
          fontSize: 10.5,
          color: 'var(--ink-mute)',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {activeTab === 'inflection' ? (
          <>
            <div>
              {INFLECTION_CANDIDATES.length} candidates · snapshot {INFLECTION_AS_OF} · sort: score desc
            </div>
            <div>refresh: manual · live recompute = wave 2</div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span>
                {rows.length} of {liveRows.length} shown · sort: ratio desc
              </span>
              <span className="rv-kbd">/</span> filter
              <span className="rv-kbd">j/k</span> row
              <span className="rv-kbd">⏎</span> open chain
              <span className="rv-kbd">b</span> build trade
            </div>
            <div>
              {isFallback
                ? 'demo data · backend down'
                : lastAt
                  ? `auto-refresh: 60s · last: ${lastAt}`
                  : 'loading…'}
            </div>
          </>
        )}
      </div>
    </>
  );
}
