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
  | 'inflection';

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
];

interface FilterChipsProps {
  active: ScannerTab;
  counts: Record<ScannerTab, number>;
  onChange: (tab: ScannerTab) => void;
}

export function FilterChips({ active, counts, onChange }: FilterChipsProps) {
  const activeSpec = SCANNER_TABS.find((t) => t.id === active) ?? SCANNER_TABS[0];
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
                · {counts[tab.id]}
              </span>
            </button>
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
        {activeSpec.description}
      </div>
    </div>
  );
}
