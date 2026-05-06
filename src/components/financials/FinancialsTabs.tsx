'use client';

import { useState } from 'react';
import FinancialsPanel, { type StatementName } from './FinancialsPanel';
import { FinancialAIInsights } from './FinancialAIInsights';
import type { StatementKind } from '@/lib/pricing-api';

const STATEMENT_KIND_BY_TAB: Record<StatementName, StatementKind> = {
  income: 'income-statement',
  balance: 'balance-sheet',
  'cash-flow': 'cash-flow',
  ratios: 'ratios',
};

interface Props {
  ticker: string;
}

const TABS: Array<{ key: StatementName; label: string }> = [
  { key: 'income', label: 'Income Statement' },
  { key: 'balance', label: 'Balance Sheet' },
  { key: 'cash-flow', label: 'Cash Flow' },
  { key: 'ratios', label: 'Ratios' },
];

export default function FinancialsTabs({ ticker }: Props) {
  const [active, setActive] = useState<StatementName>('income');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        role="tablist"
        aria-label="Financial statements"
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          gap: 4,
          padding: 3,
          border: '1px solid var(--line)',
          borderRadius: 6,
          background: '#0d0e11',
        }}
      >
        {TABS.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(t.key)}
              style={{
                background: selected ? 'var(--line)' : 'transparent',
                color: selected ? 'var(--ink)' : 'var(--ink-mute)',
                border: 0,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: selected ? 600 : 500,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                borderRadius: 4,
                transition: 'background 120ms ease, color 120ms ease',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <FinancialsPanel ticker={ticker} statement={active} />
      <FinancialAIInsights
        key={`${ticker}-${active}`}
        ticker={ticker}
        statement={STATEMENT_KIND_BY_TAB[active]}
        period="annual"
      />
    </div>
  );
}
