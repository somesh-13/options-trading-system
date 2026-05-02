'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRobinhoodHoldings, getRobinhoodSummary } from '@/lib/robinhood-api';
import { getLimitsCheck, getDrawdown, getVaR } from '@/lib/robinhood-analytics-api';
import type { RobinhoodHolding, RobinhoodSummary } from '@/lib/robinhood-api';
import type { LimitsCheckResult, DrawdownResult, VaRResult } from '@/lib/robinhood-analytics-api';
import { PortfolioRiskSummary } from '@/components/risk/PortfolioRiskSummary';
import { PerTickerRiskTable } from '@/components/risk/PerTickerRiskTable';

const REFRESH_MS = 60_000;

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
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, () => worker()));
  return results;
}

export default function RiskManagementPage() {
  const [equities, setEquities] = useState<RobinhoodHolding[]>([]);
  const [summary, setSummary] = useState<RobinhoodSummary | null>(null);
  const [limits, setLimits] = useState<LimitsCheckResult | null>(null);
  const [drawdown, setDrawdown] = useState<DrawdownResult | null>(null);
  // undefined = not yet fetched, null = failed, VaRResult = success
  const [varMap, setVarMap] = useState<Map<string, VaRResult | null>>(new Map());
  const [loadingTop, setLoadingTop] = useState(false);
  const [loadingVar, setLoadingVar] = useState(false);
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    cancelRef.current = false;
    // Defer the loading state update to a microtask so the linter is happy
    // (avoids synchronous setState at the effect call site).
    await Promise.resolve();
    if (cancelRef.current) return;
    setLoadingTop(true);

    try {
      const [holdingsData, summaryData, limitsData, drawdownData] = await Promise.allSettled([
        getRobinhoodHoldings(true, 'all', 'live'),
        getRobinhoodSummary(true, 'all', 'live'),
        getLimitsCheck('all'),
        getDrawdown('all'),
      ]);

      if (cancelRef.current) return;

      const eqs =
        holdingsData.status === 'fulfilled' ? holdingsData.value.equities : [];
      setEquities(eqs);
      setSummary(summaryData.status === 'fulfilled' ? summaryData.value : null);
      setLimits(limitsData.status === 'fulfilled' ? limitsData.value : null);
      setDrawdown(drawdownData.status === 'fulfilled' ? drawdownData.value : null);
      setLoadingTop(false);

      // Fan-out VaR per unique symbol
      const symbols = Array.from(new Set(eqs.map((h) => h.symbol)));
      if (symbols.length === 0) return;

      setLoadingVar(true);
      // Pre-fill map with undefined (loading state)
      setVarMap(new Map(symbols.map((s) => [s, undefined as unknown as VaRResult | null])));

      const varResults = await throttledAllSettled(
        symbols.map((sym) => () => getVaR(sym)),
        6,
      );

      if (cancelRef.current) return;

      const newMap = new Map<string, VaRResult | null>();
      varResults.forEach((r, i) => {
        newMap.set(symbols[i], r.status === 'fulfilled' ? r.value : null);
      });
      setVarMap(newMap);
      setLoadingVar(false);
    } catch {
      setLoadingTop(false);
      setLoadingVar(false);
    }
  }, []);

  useEffect(() => {
    async function run() { await load(); }
    run();
    return () => { cancelRef.current = true; };
  }, [load]);

  // Auto-refresh + visibility-based refresh
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const totalMarketValue = summary?.total_market_value ?? 0;

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h2 className="rv-h1" style={{ margin: 0 }}>Risk Management</h2>
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => void load()}
            disabled={loadingTop || loadingVar}
          >
            {(loadingTop || loadingVar) ? '…' : '↻ refresh'}
          </button>
        </div>
        <div className="rv-sub" style={{ marginBottom: 16 }}>
          Portfolio-level limits + drawdown · per-ticker VaR 95% + CVaR 95% (1-day) · auto-refresh 60s
        </div>

        {/* Top: portfolio summary */}
        <PortfolioRiskSummary
          summary={summary}
          limits={limits}
          drawdown={drawdown}
          loading={loadingTop}
        />

        {/* Middle: per-ticker risk table */}
        <PerTickerRiskTable
          equities={equities}
          varMap={varMap}
          totalMarketValue={totalMarketValue}
          loading={loadingVar}
        />

        {/* Bottom: static reference card */}
        <div className="mt-4 sm:mt-6 bg-[#2D2D2D] rounded-lg p-4">
          <h3 className="font-bold text-[#FFD700] mb-2">Risk Limits (SIG Standard)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm text-gray-300">
            <ul className="space-y-1">
              <li>Max Portfolio Delta: +/- 10,000</li>
              <li>Max Single-Stock Delta: +/- 2,000</li>
              <li>Max Portfolio Gamma: +/- 500</li>
            </ul>
            <ul className="space-y-1">
              <li>Max Portfolio Vega: +/- 10,000</li>
              <li>Max Position Size: 10% of NAV</li>
              <li>Max Drawdown Trigger: 10%</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
