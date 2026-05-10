'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilterChips, SCANNER_TABS, type ScannerTab, type CustomTab } from './FilterChips';
import { ScannerTable, type Opportunity, type Signal, type Regime } from './ScannerTable';
import { NLScannerBar, type ScannerParseResult, type ScannerSubmitPayload } from './NLScannerBar';
import { InflectionTable, type InflectionCandidate } from './InflectionTable';
import { PremiumPicksOverlay } from './PremiumPicksOverlay';
import { getRobinhoodHoldings } from '@/lib/robinhood-api';
import { getBatchMispricing } from '@/lib/robinhood-analytics-api';
import INFLECTION_DATA from '@/data/inflection-candidates.json';

const INFLECTION_CANDIDATES = (INFLECTION_DATA.candidates as InflectionCandidate[]) ?? [];
const INFLECTION_AS_OF = (INFLECTION_DATA as { as_of: string }).as_of;

// First scan of the calendar day is cached in localStorage; subsequent loads
// reuse it until the user clicks Refresh (which busts the cache) or the next
// day rolls over (the date-stamped key automatically misses).
const CACHE_KEY_PREFIX = 'scanner.snapshot.';
function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${CACHE_KEY_PREFIX}${yyyy}${mm}${dd}`;
}
interface CachedSnapshot {
  rows: Opportunity[];
  tickerCount: number;
  errors: string[];
  fetchedAt: string; // ISO timestamp
}
function readCache(): CachedSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(todayKey());
    if (!raw) return null;
    return JSON.parse(raw) as CachedSnapshot;
  } catch {
    return null;
  }
}
function writeCache(snap: CachedSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    // Best-effort cleanup of yesterday's keys so localStorage doesn't grow.
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(CACHE_KEY_PREFIX) && k !== todayKey()) {
        window.localStorage.removeItem(k);
      }
    }
    window.localStorage.setItem(todayKey(), JSON.stringify(snap));
  } catch {
    /* quota or privacy mode — silently skip */
  }
}

// Custom scanner tabs (built from combined LLM-scanner conditions) persist
// across sessions in localStorage.
const CUSTOM_TABS_KEY = 'scanner.customTabs';
function loadCustomTabs(): CustomTab[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveCustomTabs(list: CustomTab[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOM_TABS_KEY, JSON.stringify(list));
  } catch {
    /* quota or privacy mode — silently skip */
  }
}
function makeTabLabel(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= 28) return trimmed;
  return trimmed.slice(0, 27) + '…';
}

function formatRefreshedAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const yr = d.getFullYear();
  let h = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${day} ${mon} ${yr}, ${String(h).padStart(2, '0')}:${mins} ${ampm}`;
}

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

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; rows: Opportunity[]; tickerCount: number; errors: string[]; usedFallback: false; fetchedAt: string }
  | { status: 'fallback'; reason: string };

export function ScannerShell() {
  // activeTab is a built-in ScannerTab id OR a custom-tab id (string).
  const [activeTab, setActiveTab] = useState<string>('all');
  const [customTabs, setCustomTabs] = useState<CustomTab[]>([]);
  const [llmResult, setLlmResult] = useState<ScannerParseResult | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });
  const [picksOpen, setPicksOpen] = useState(false);
  const cancelRef = useRef(false);

  // Restore custom tabs from localStorage on mount.
  useEffect(() => {
    setCustomTabs(loadCustomTabs());
  }, []);

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
        console.warn('[Scanner] backend unavailable, showing empty state:', e);
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

    let batch;
    try {
      batch = await getBatchMispricing(uniqueSymbols);
    } catch (e) {
      if (!cancelRef.current) {
        console.warn('[Scanner] batch mispricing failed:', e);
        setFetchState({ status: 'fallback', reason: String(e) });
      }
      return;
    }

    if (cancelRef.current) return;

    const rows: Opportunity[] = [];
    const errors: string[] = Object.keys(batch.errors);

    for (const sym of uniqueSymbols) {
      const m = batch.results[sym];
      if (!m) continue;
      const iv = (m.implied_vol_atm as number | undefined) ?? 0;
      const hv = (m.historical_vol as number | undefined) ?? 0;
      const ratio = (m.iv_hv_ratio as number | undefined) ?? (hv > 0 ? iv / hv : 1);
      const seed = sym.charCodeAt(0) + (sym.charCodeAt(1) ?? 0);
      rows.push({
        ticker: sym,
        spot: (m.spot_price as number | undefined) ?? 0,
        iv,
        hv,
        ratio,
        signal: ((m.signal as Signal | undefined)) ?? 'NEUTRAL',
        regime: deriveRegime(ratio),
        ev: 0,
        hitRate: 0.5,
        seed,
      });
    }

    // Sort by ratio desc (highest IV/HV first — most actionable)
    rows.sort((a, b) => b.ratio - a.ratio);

    const fetchedAt = new Date().toISOString();
    // Don't persist all-fail snapshots — when the backend recovers, a stale
    // empty cache otherwise keeps the scanner (and the $ premium picks button)
    // looking dead until the user manually clicks ↻ Refresh latest.
    if (rows.length > 0) {
      writeCache({ rows, tickerCount: uniqueSymbols.length, errors, fetchedAt });
    }

    setFetchState({
      status: 'ok',
      rows,
      tickerCount: uniqueSymbols.length,
      errors,
      usedFallback: false,
      fetchedAt,
    });
  }, []);

  // On mount: prefer today's cached snapshot. Only hit the backend if the
  // cache is empty (first visit of the day) or stale (different calendar date).
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setFetchState({
        status: 'ok',
        rows: cached.rows,
        tickerCount: cached.tickerCount,
        errors: cached.errors,
        usedFallback: false,
        fetchedAt: cached.fetchedAt,
      });
      return;
    }
    async function run() { await load(); }
    run();
    return () => { cancelRef.current = true; };
  }, [load]);

  // Live rows only — no static/demo fallback while loading or on backend error.
  const liveRows: Opportunity[] = useMemo(() => {
    return fetchState.status === 'ok' ? fetchState.rows : [];
  }, [fetchState]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of SCANNER_TABS) {
      out[t.id] = liveRows.filter(t.predicate).length;
    }
    out.inflection = INFLECTION_CANDIDATES.length;
    for (const c of customTabs) {
      if (c.tickers.length === 0) {
        out[c.id] = liveRows.length;
      } else {
        const focus = new Set(c.tickers.map((t) => t.toUpperCase()));
        out[c.id] = liveRows.filter((r) => focus.has(r.ticker)).length;
      }
    }
    return out;
  }, [liveRows, customTabs]);

  const baseRows: Opportunity[] = useMemo(() => {
    const builtIn = SCANNER_TABS.find((t) => t.id === activeTab);
    if (builtIn) return liveRows.filter(builtIn.predicate);
    const custom = customTabs.find((c) => c.id === activeTab);
    if (!custom) return liveRows;
    if (custom.tickers.length === 0) return liveRows;
    const focus = new Set(custom.tickers.map((t) => t.toUpperCase()));
    return liveRows.filter((r) => focus.has(r.ticker));
  }, [activeTab, liveRows, customTabs]);

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

  const handleCustomScannerSaved = (payload: ScannerSubmitPayload) => {
    // Skip if a tab with the same query already exists — switch to it instead.
    const existing = customTabs.find((c) => c.query === payload.query);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    const tab: CustomTab = {
      id: `ct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      query: payload.query,
      label: makeTabLabel(payload.query),
      tickers: payload.result.tickers ?? [],
      intent: payload.result.intent,
      conditions: payload.result.conditions,
      createdAt: new Date().toISOString(),
    };
    const next = [...customTabs, tab];
    setCustomTabs(next);
    saveCustomTabs(next);
    setActiveTab(tab.id);
  };

  const handleRemoveCustomTab = (id: string) => {
    const next = customTabs.filter((c) => c.id !== id);
    setCustomTabs(next);
    saveCustomTabs(next);
    if (activeTab === id) setActiveTab('all');
  };

  const isLoading = fetchState.status === 'loading' || fetchState.status === 'idle';
  const isFallback = fetchState.status === 'fallback';
  const errors = fetchState.status === 'ok' ? fetchState.errors : [];
  const fetchedAtIso = fetchState.status === 'ok' ? fetchState.fetchedAt : null;
  const lastRefreshedLabel = formatRefreshedAt(fetchedAtIso);

  return (
    <>
      {/* Header bar: LLM bar + premium picks + refresh */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <NLScannerBar onResult={handleLlmResult} onSubmitted={handleCustomScannerSaved} />
        </div>
        <button
          type="button"
          className="rv-btn primary"
          style={{ fontSize: 11, padding: '4px 10px', marginTop: 2, whiteSpace: 'nowrap' }}
          onClick={() => setPicksOpen(true)}
          disabled={liveRows.length === 0}
          title="Find OTM strikes with the juiciest annualized premium to sell"
        >
          $ premium picks
        </button>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 2,
            marginTop: 2,
          }}
        >
          <button
            type="button"
            className="rv-btn"
            style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
            onClick={() => void load()}
            disabled={isLoading}
            title="Bust today's cache and re-fetch mispricing for all portfolio tickers"
            data-testid="scanner-refresh-button"
          >
            {isLoading ? '⟳ refreshing…' : '↻ Refresh latest'}
          </button>
          <span
            style={{
              fontSize: 10,
              color: 'var(--ink-mute)',
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: 'nowrap',
            }}
            data-testid="scanner-last-refreshed"
          >
            Last refreshed: {lastRefreshedLabel}
          </span>
        </div>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
        {isLoading && (
          <span className="rv-chip warn" style={{ fontSize: 10 }}>loading portfolio…</span>
        )}
        {isFallback && (
          <span className="rv-chip sell" style={{ fontSize: 10 }} title={(fetchState as { reason: string }).reason}>
            backend unavailable
          </span>
        )}
        {errors.map((sym) => (
          <span key={sym} className="rv-chip sell" style={{ fontSize: 10 }} title={`${sym} mispricing fetch failed`}>
            {sym} ✗
          </span>
        ))}
      </div>

      <FilterChips
        active={activeTab}
        counts={counts}
        customTabs={customTabs}
        onChange={setActiveTab}
        onRemoveCustom={handleRemoveCustomTab}
      />

      {activeTab === 'inflection' ? (
        <InflectionTable candidates={INFLECTION_CANDIDATES} asOf={INFLECTION_AS_OF} />
      ) : isLoading ? (
        <div
          className="rv-card"
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--ink-mute)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 8 }}>⟳</div>
          <div>Scanning portfolio tickers…</div>
          <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>
            fetching live IV/HV mispricing from backend
          </div>
        </div>
      ) : isFallback ? (
        <div
          className="rv-card"
          style={{
            padding: 32,
            textAlign: 'center',
            color: 'var(--ink-mute)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}
          title={(fetchState as { reason: string }).reason}
        >
          <div style={{ fontSize: 18, marginBottom: 6, color: 'var(--pink, #FF006E)' }}>✗</div>
          <div>Backend unavailable.</div>
          <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>
            no live data — try ↻ refresh
          </div>
        </div>
      ) : (
        <ScannerTable rows={rows} highlightTicker={highlightTicker} />
      )}

      <PremiumPicksOverlay
        open={picksOpen}
        onClose={() => setPicksOpen(false)}
        candidates={liveRows}
      />

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
              {liveRows.length > 0 ? (
                <>
                  <span>
                    {rows.length} of {liveRows.length} shown · sort: ratio desc
                  </span>
                  <span className="rv-kbd">/</span> filter
                  <span className="rv-kbd">j/k</span> row
                  <span className="rv-kbd">⏎</span> open chain
                  <span className="rv-kbd">b</span> build trade
                </>
              ) : (
                <span>&nbsp;</span>
              )}
            </div>
            <div>
              {isFallback
                ? 'backend down'
                : fetchedAtIso
                  ? `cached for today · click ↻ Refresh latest for fresh data`
                  : 'loading…'}
            </div>
          </>
        )}
      </div>
    </>
  );
}
