'use client';

import { useEffect, useMemo, useState } from 'react';
import { FilterChips, SCANNER_TABS, type ScannerTab } from './FilterChips';
import { ScannerTable, SCANNER_ROWS, type Opportunity } from './ScannerTable';
import { NLScannerBar, type ScannerParseResult } from './NLScannerBar';
import { InflectionTable, type InflectionCandidate } from './InflectionTable';
import INFLECTION_DATA from '@/data/inflection-candidates.json';

const INFLECTION_CANDIDATES = (INFLECTION_DATA.candidates as InflectionCandidate[]) ?? [];
const INFLECTION_AS_OF = (INFLECTION_DATA as { as_of: string }).as_of;

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

export function ScannerShell() {
  const [activeTab, setActiveTab] = useState<ScannerTab>('all');
  const [llmResult, setLlmResult] = useState<ScannerParseResult | null>(null);
  const [spotMap, setSpotMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const symbols = SCANNER_ROWS.map((r) => r.ticker).join(',');
    let cancelled = false;
    fetch(`/api/quotes?symbols=${symbols}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.success) return;
        setSpotMap(j.data ?? {});
      })
      .catch((e) => console.error('quotes fetch failed', e));
    return () => {
      cancelled = true;
    };
  }, []);

  const livedRows: Opportunity[] = useMemo(
    () =>
      SCANNER_ROWS.map((r) => {
        const live = spotMap[r.ticker];
        if (!live || live <= 0) return r;
        return { ...r, spot: live, ratio: r.iv / r.hv };
      }),
    [spotMap],
  );

  const counts = useMemo(() => {
    const out = {} as Record<ScannerTab, number>;
    for (const t of SCANNER_TABS) {
      out[t.id] = livedRows.filter(t.predicate).length;
    }
    out.inflection = INFLECTION_CANDIDATES.length;
    return out;
  }, [livedRows]);

  const baseRows: Opportunity[] = useMemo(() => {
    const spec = SCANNER_TABS.find((t) => t.id === activeTab) ?? SCANNER_TABS[0];
    return livedRows.filter(spec.predicate);
  }, [activeTab, livedRows]);

  // If the LLM resolved concrete tickers, restrict the table to them within the
  // current tab. Otherwise show the full tab rows.
  const rows: Opportunity[] = useMemo(() => {
    if (!llmResult || llmResult.tickers.length === 0) return baseRows;
    const focus = new Set(llmResult.tickers.map((t) => t.toUpperCase()));
    const matches = livedRows.filter((r) => focus.has(r.ticker));
    if (matches.length === 0) return baseRows;
    return matches;
  }, [baseRows, livedRows, llmResult]);

  const highlightTicker = llmResult?.tickers?.[0];

  const handleLlmResult = (result: ScannerParseResult) => {
    setLlmResult(result);
    const suggested = intentToTab(result.intent);
    if (suggested && counts[suggested] > 0) {
      setActiveTab(suggested);
    }
  };

  return (
    <>
      <NLScannerBar onResult={handleLlmResult} />

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
                {rows.length} of {livedRows.length} shown · sort: ratio desc
              </span>
              <span className="rv-kbd">/</span> filter
              <span className="rv-kbd">j/k</span> row
              <span className="rv-kbd">⏎</span> open chain
              <span className="rv-kbd">b</span> build trade
            </div>
            <div>auto-refresh: 5m · last: 12:08:42</div>
          </>
        )}
      </div>
    </>
  );
}
