'use client';

import type { Opportunity } from './ScannerTable';

export type ScannerTab =
  | 'all'
  | 'mispriced'
  | 'cheap'
  | 'high-vol'
  | 'normal'
  | 'buy'
  | 'sell'
  | 'inflection'
  | 'calendar-opp';

export interface TabSpec {
  id: ScannerTab;
  label: string;
  description: string;
  predicate: (o: Opportunity) => boolean;
}

export const SCANNER_TABS: TabSpec[] = [
  {
    id: 'all',
    label: 'My list',
    description: 'All watchlist tickers',
    predicate: () => true,
  },
  {
    id: 'mispriced',
    label: 'Mispriced (IV ≫ HV)',
    description: 'IV / HV ratio above 1.3 — premium selling candidates',
    predicate: (o) => o.ratio > 1.3,
  },
  {
    id: 'cheap',
    label: 'Cheap IV',
    description: 'IV / HV ratio below 0.8 — premium buying candidates',
    predicate: (o) => o.ratio < 0.8,
  },
  {
    id: 'high-vol',
    label: 'High-vol regime',
    description: 'Regime = high-vol',
    predicate: (o) => o.regime === 'high-vol',
  },
  {
    id: 'normal',
    label: 'Normal regime',
    description: 'Regime = normal',
    predicate: (o) => o.regime === 'normal',
  },
  {
    id: 'buy',
    label: 'BUY signal',
    description: 'Current scanner signal = BUY',
    predicate: (o) => o.signal === 'BUY',
  },
  {
    id: 'sell',
    label: 'SELL signal',
    description: 'Current scanner signal = SELL',
    predicate: (o) => o.signal === 'SELL',
  },
  {
    id: 'inflection',
    label: 'Inflection',
    description: 'Mid-cap $2B–$10B inflection candidates (Vishal methodology, static snapshot)',
    predicate: () => true,
  },
  {
    id: 'calendar-opp',
    label: 'Calendar Opp',
    description: 'F/B IV ratio > 1.15 AND IV/HV > 1.10 — sell-the-front, buy-the-back candidates',
    predicate: (o) =>
      typeof o.fbRatio === 'number' && o.fbRatio > 1.15 && o.ratio > 1.10,
  },
];

// User-saved scanners produced by combining LLM-scanner conditions. Stored in
// localStorage by ScannerShell. Filtered by `tickers` (subset of the universe);
// when tickers is empty the tab acts like a saved query name only and shows
// all rows.
export interface CustomTab {
  id: string;
  query: string;       // full combined query string
  label: string;       // truncated label shown in the chip
  tickers: string[];   // parsed tickers to filter rows by
  intent?: string;
  conditions?: string[];
  createdAt: string;   // ISO
}

interface FilterChipsProps {
  active: string;
  counts: Record<string, number>;
  customTabs: CustomTab[];
  onChange: (tab: string) => void;
  onRemoveCustom?: (id: string) => void;
}

export function FilterChips({ active, counts, customTabs, onChange, onRemoveCustom }: FilterChipsProps) {
  const activeBuiltIn = SCANNER_TABS.find((t) => t.id === active);
  const activeCustom = !activeBuiltIn ? customTabs.find((c) => c.id === active) : null;
  const activeDescription =
    activeBuiltIn?.description ??
    (activeCustom ? `Custom · ${activeCustom.query}` : SCANNER_TABS[0].description);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCANNER_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`rv-btn ${isActive ? '' : 'ghost'}`}
              style={{
                background: isActive ? 'var(--line)' : undefined,
                color: isActive ? 'var(--ink)' : 'var(--ink-dim)',
                fontSize: 12,
                cursor: 'pointer',
                borderColor: isActive ? 'var(--gold-dim)' : 'var(--line)',
              }}
              title={tab.description}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: 6,
                  color: 'var(--ink-mute)',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 10,
                }}
              >
                · {counts[tab.id] ?? 0}
              </span>
            </button>
          );
        })}

        {customTabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <span
              key={tab.id}
              className={`rv-btn ${isActive ? '' : 'ghost'}`}
              style={{
                background: isActive ? 'var(--line)' : undefined,
                color: isActive ? 'var(--gold)' : 'var(--gold-dim, var(--ink-dim))',
                fontSize: 12,
                cursor: 'pointer',
                borderColor: isActive ? 'var(--gold)' : 'var(--gold-dim, var(--line))',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px 4px 10px',
              }}
              title={tab.query}
            >
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: 'inherit',
                  cursor: 'pointer',
                  font: 'inherit',
                  padding: 0,
                }}
              >
                {tab.label}
                <span
                  style={{
                    marginLeft: 6,
                    color: 'var(--ink-mute)',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 10,
                  }}
                >
                  · {counts[tab.id] ?? 0}
                </span>
              </button>
              {onRemoveCustom && (
                <button
                  type="button"
                  onClick={() => onRemoveCustom(tab.id)}
                  aria-label={`Remove custom scanner "${tab.label}"`}
                  title="Remove custom scanner"
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--ink-mute)',
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                    padding: '0 2px',
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: 'var(--ink-mute)',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {activeDescription}
      </div>
    </div>
  );
}
