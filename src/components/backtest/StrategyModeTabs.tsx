'use client';

import { BacktestMode } from './types';

interface Props {
  mode: BacktestMode;
  onChange: (m: BacktestMode) => void;
}

const TABS: Array<{ id: BacktestMode; label: string; hint: string; icon?: string }> = [
  { id: 'comparison', label: 'Multi-Strategy', hint: 'Rank multiple strategies on the same universe' },
  { id: 'single', label: 'Single Strategy', hint: 'Deep-dive on one ticker / one strategy' },
  { id: 'wheel', label: 'Wheel (CSP + CC)', hint: 'Premium-selling backtest, held to expiry' },
  { id: 'calendar', label: 'Calendar Spread', hint: 'Sell front-month, buy back-month at same strike; roll & re-enter', icon: '📅' },
];

export default function StrategyModeTabs({ mode, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Backtest mode"
      className="inline-flex p-1 bg-[#17181c] rounded-xl ring-1 ring-inset ring-[#26272d] gap-1"
    >
      {TABS.map((t) => {
        const active = mode === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            title={t.hint}
            onClick={() => onChange(t.id)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              active
                ? 'bg-[#22D3EE]/15 text-[#22D3EE] ring-1 ring-inset ring-[#22D3EE]/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t.icon && <span style={{ marginRight: 6 }}>{t.icon}</span>}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
