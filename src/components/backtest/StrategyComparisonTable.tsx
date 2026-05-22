'use client';

import { useMemo, useState } from 'react';
import { STRATEGY_COLORS, StrategyComparisonRow } from './types';

interface Props {
  rows: StrategyComparisonRow[];
  focusedId?: string;
  onFocus?: (id: string) => void;
}

type SortKey =
  | 'label'
  | 'totalReturnPct'
  | 'cagr'
  | 'sharpe'
  | 'sortino'
  | 'maxDrawdownPct'
  | 'calmar'
  | 'volatility'
  | 'winRate'
  | 'profitFactor'
  | 'totalTrades'
  | 'avgHoldingDays'
  | 'exposure';

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  format: (r: StrategyComparisonRow) => string;
  tone?: (r: StrategyComparisonRow) => string;
}

const numOrDash = (v: number | null | undefined, digits = 2, suffix = ''): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${suffix}`;

const pctOrDash = (v: number | null | undefined, sign = false): string =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `${sign && v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

const COLUMNS: Column[] = [
  { key: 'label', label: 'Strategy', align: 'left', format: (r) => r.label },
  {
    key: 'totalReturnPct',
    label: 'Return',
    align: 'right',
    format: (r) => pctOrDash(r.totalReturnPct, true),
    tone: (r) => (r.totalReturnPct >= 0 ? 'text-[#34D399]' : 'text-[#FF006E]'),
  },
  {
    key: 'cagr',
    label: 'CAGR',
    align: 'right',
    format: (r) => pctOrDash(r.cagr, true),
    tone: (r) => (r.cagr != null && r.cagr >= 0 ? 'text-[#34D399]' : 'text-[#FF006E]'),
  },
  {
    key: 'sharpe',
    label: 'Sharpe',
    align: 'right',
    format: (r) => numOrDash(r.sharpe),
    tone: (r) =>
      r.sharpe >= 1 ? 'text-[#34D399]' : r.sharpe >= 0 ? 'text-amber-300' : 'text-[#FF006E]',
  },
  {
    key: 'sortino',
    label: 'Sortino',
    align: 'right',
    format: (r) => numOrDash(r.sortino),
  },
  {
    key: 'maxDrawdownPct',
    label: 'Max DD',
    align: 'right',
    format: (r) => `−${Math.abs(r.maxDrawdownPct).toFixed(2)}%`,
    tone: (r) => (r.maxDrawdownPct < 15 ? 'text-[#34D399]' : 'text-[#FF006E]'),
  },
  { key: 'calmar', label: 'Calmar', align: 'right', format: (r) => numOrDash(r.calmar) },
  {
    key: 'volatility',
    label: 'Vol',
    align: 'right',
    format: (r) => (r.volatility == null ? '—' : pctOrDash(r.volatility)),
  },
  {
    key: 'winRate',
    label: 'Win Rate',
    align: 'right',
    format: (r) => `${r.winRate.toFixed(1)}%`,
    tone: (r) => (r.winRate > 50 ? 'text-[#34D399]' : 'text-amber-300'),
  },
  {
    key: 'profitFactor',
    label: 'PF',
    align: 'right',
    format: (r) => numOrDash(r.profitFactor),
    tone: (r) => (r.profitFactor > 1 ? 'text-[#34D399]' : 'text-[#FF006E]'),
  },
  {
    key: 'avgHoldingDays',
    label: 'Avg Hold',
    align: 'right',
    format: (r) => (r.avgHoldingDays == null ? '—' : `${r.avgHoldingDays.toFixed(0)}d`),
  },
  {
    key: 'exposure',
    label: 'Exposure',
    align: 'right',
    format: (r) => (r.exposure == null ? '—' : pctOrDash(r.exposure)),
  },
  { key: 'totalTrades', label: 'Trades', align: 'right', format: (r) => String(r.totalTrades) },
];

export default function StrategyComparisonTable({ rows, focusedId, onFocus }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('sharpe');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Strings (label)
      if (typeof av === 'string' && typeof bv === 'string') {
        return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = (av as number) ?? -Infinity;
      const bn = (bv as number) ?? -Infinity;
      return dir === 'asc' ? an - bn : bn - an;
    });
    return copy;
  }, [rows, sortKey, dir]);

  if (rows.length === 0) return null;

  const onHeaderClick = (k: SortKey) => {
    if (k === sortKey) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setDir(k === 'label' ? 'asc' : 'desc');
    }
  };

  return (
    <section className="rounded-2xl border border-[#1f2027] bg-[#0f1014] overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#16171c]">
        <h3 className="text-sm font-semibold text-white tracking-tight">Strategy Comparison</h3>
        <p className="text-[11px] text-gray-500">Click a row to focus the chart and ribbon</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-[#0b0b0d]">
              {COLUMNS.map((c) => {
                const active = c.key === sortKey;
                const arrow = active ? (dir === 'asc' ? '▲' : '▼') : '';
                return (
                  <th
                    key={c.key}
                    onClick={() => onHeaderClick(c.key)}
                    className={`px-3 py-2 select-none cursor-pointer hover:text-gray-300 ${
                      c.align === 'right' ? 'text-right' : 'text-left'
                    } ${active ? 'text-[#22D3EE]' : ''}`}
                  >
                    {c.label}
                    {arrow && <span className="ml-1 text-[9px]">{arrow}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isFocused = r.strategy === focusedId;
              const color = STRATEGY_COLORS[r.strategy as string] ?? '#22D3EE';
              return (
                <tr
                  key={r.strategy}
                  onClick={() => onFocus?.(r.strategy as string)}
                  className={`border-t border-[#16171c] cursor-pointer transition-colors ${
                    isFocused ? 'bg-[#22D3EE]/5' : 'hover:bg-white/[0.025]'
                  }`}
                >
                  {COLUMNS.map((c) => {
                    const formatted = c.format(r);
                    const tone = c.tone?.(r) ?? '';
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-2 tabular-nums ${
                          c.align === 'right' ? 'text-right' : 'text-left'
                        } ${tone}`}
                      >
                        {c.key === 'label' ? (
                          <span className="inline-flex items-center gap-2 font-medium text-white">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{
                                backgroundColor: color,
                                boxShadow: isFocused
                                  ? `0 0 8px ${color}`
                                  : `0 0 4px rgba(34,211,238,0.0)`,
                              }}
                            />
                            {formatted}
                          </span>
                        ) : (
                          formatted
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
