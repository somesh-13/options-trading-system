'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlowLeaderboard } from '@/components/flow/FlowLeaderboard';
import { FlowContractTable } from '@/components/flow/FlowContractTable';
import {
  getFlowScan,
  getTickerFlow,
  type FlowScanResponse,
  type FlowTickerResponse,
} from '@/lib/flow-api';

const REFRESH_MS = 5 * 60_000; // 5 min — snapshot job runs once a day

export default function FlowPage() {
  const [scan, setScan] = useState<FlowScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowTickerResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadScan = useCallback(async () => {
    try {
      const data = await getFlowScan({ top: 30 });
      setScan(data);
      setScanError(null);
      // Auto-pick the top ticker the first time we land on the page.
      setSelected((cur) => cur ?? data.rows[0]?.ticker ?? null);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScan();
    const id = setInterval(loadScan, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadScan]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getTickerFlow(selected, 30)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setDetailError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-4 sm:mb-6">
          <h2 className="rv-h1">Flow</h2>
          <div className="rv-sub">
            Premium-ranked options activity from the daily 16:05 ET snapshot.
            {scan?.snapshot_at && (
              <> Latest: <span className="font-mono">{scan.snapshot_at.slice(0, 19).replace('T', ' ')}</span> UTC.</>
            )}
            {scan && (
              <> {scan.tickers_with_data}/{scan.tickers_scanned} tickers with data.</>
            )}
          </div>
        </header>

        {loading && !scan && (
          <div className="rv-card p-6 text-sm" style={{ color: 'var(--ink-mute)' }}>
            Loading flow snapshot…
          </div>
        )}

        {scanError && (
          <div className="rv-card p-6 text-sm" style={{ color: 'var(--red, #FF006E)' }}>
            Could not load flow scan: {scanError}
          </div>
        )}

        {scan && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]">
            <section>
              <h3 className="rv-h3 mb-2">Leaderboard</h3>
              <FlowLeaderboard
                rows={scan.rows}
                selected={selected ?? undefined}
                onSelect={setSelected}
              />
            </section>

            <section>
              <h3 className="rv-h3 mb-2">
                {selected ? `${selected} contracts` : 'Select a ticker'}
                {detail?.iv_percentile !== null && detail?.iv_percentile !== undefined && (
                  <span className="ml-3 text-sm" style={{ color: 'var(--ink-mute)' }}>
                    IV rank {Math.round((detail.iv_percentile ?? 0) * 100)}
                  </span>
                )}
              </h3>
              {detailError && (
                <div className="rv-card p-6 text-sm" style={{ color: 'var(--red, #FF006E)' }}>
                  {detailError}
                </div>
              )}
              {detail && (
                <FlowContractTable ticker={detail.ticker} contracts={detail.contracts} />
              )}
              {!detail && !detailError && selected && (
                <div className="rv-card p-6 text-sm" style={{ color: 'var(--ink-mute)' }}>
                  Loading contracts for {selected}…
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
