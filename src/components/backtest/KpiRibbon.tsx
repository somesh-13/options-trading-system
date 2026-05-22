'use client';

import { StrategySummary } from './types';

interface Props {
  summary: StrategySummary | null;
  /** Optional small caption per cell (e.g., "Annualized"). */
  loading?: boolean;
}

interface Cell {
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'negative' | 'neutral' | 'accent';
}

const fmtPct = (v: number | null | undefined, sign = false): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${sign && v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
};

const fmtNum = (v: number | null | undefined, digits = 2): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
};

const fmtCurrency = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

function buildCells(s: StrategySummary): Cell[] {
  return [
    {
      id: 'cagr',
      label: 'Annualized Return',
      value: fmtPct(s.cagr ?? s.totalReturnPct, true),
      hint: s.cagr == null ? 'Total return' : 'CAGR',
      tone: (s.cagr ?? s.totalReturnPct) >= 0 ? 'positive' : 'negative',
    },
    {
      id: 'maxdd',
      label: 'Max Drawdown',
      value: `−${Math.abs(s.maxDrawdownPct).toFixed(2)}%`,
      hint: 'Peak-to-trough',
      tone: s.maxDrawdownPct < 15 ? 'positive' : 'negative',
    },
    {
      id: 'sharpe',
      label: 'Sharpe',
      value: fmtNum(s.sharpe),
      hint: 'Risk-adjusted',
      tone: s.sharpe >= 1 ? 'positive' : s.sharpe >= 0 ? 'neutral' : 'negative',
    },
    {
      id: 'winrate',
      label: 'Win Rate',
      value: `${s.winRate.toFixed(1)}%`,
      hint: `${s.totalTrades} trades`,
      tone: s.winRate > 50 ? 'positive' : 'neutral',
    },
    {
      id: 'pf',
      label: 'Profit Factor',
      value: fmtNum(s.profitFactor),
      hint: 'Gross win / loss',
      tone: s.profitFactor > 1 ? 'positive' : 'negative',
    },
    {
      id: 'trades',
      label: 'Total Trades',
      value: s.totalTrades.toLocaleString(),
      hint: s.avgHoldingDays ? `${s.avgHoldingDays.toFixed(0)}d avg hold` : undefined,
      tone: 'neutral',
    },
    {
      id: 'finalEquity',
      label: 'Final Equity',
      value: fmtCurrency(s.finalEquity),
      hint: fmtPct(s.totalReturnPct, true),
      tone: 'accent',
    },
    {
      id: 'lastBar',
      label: 'Last Bar',
      value: fmtPct(s.lastBarPctChange, true),
      hint: 'Most recent day',
      tone:
        s.lastBarPctChange == null
          ? 'neutral'
          : s.lastBarPctChange >= 0
            ? 'positive'
            : 'negative',
    },
  ];
}

function toneClass(tone?: Cell['tone']): string {
  switch (tone) {
    case 'positive':
      return 'text-[#34D399]';
    case 'negative':
      return 'text-[#FF006E]';
    case 'accent':
      return 'text-[#22D3EE]';
    default:
      return 'text-white';
  }
}

export default function KpiRibbon({ summary, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-[#16171c] rounded-xl overflow-hidden ring-1 ring-inset ring-[#1f2027]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-[#0f1014] p-3 animate-pulse">
            <div className="h-3 w-20 bg-white/5 rounded mb-2" />
            <div className="h-6 w-24 bg-white/10 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-[#16171c] rounded-xl overflow-hidden ring-1 ring-inset ring-[#1f2027]">
        {[
          'Annualized',
          'Max DD',
          'Sharpe',
          'Win Rate',
          'Profit Factor',
          'Trades',
          'Final Equity',
          'Last Bar',
        ].map((label) => (
          <div key={label} className="bg-[#0f1014] p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
            <div className="text-xl text-gray-600 tabular-nums mt-1">—</div>
          </div>
        ))}
      </div>
    );
  }

  const cells = buildCells(summary);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-[#16171c] rounded-xl overflow-hidden ring-1 ring-inset ring-[#1f2027]">
      {cells.map((c) => (
        <div
          key={c.id}
          className="bg-[#0f1014] p-3 hover:bg-[#12131a] transition-colors min-w-0"
        >
          <div className="text-[10px] uppercase tracking-wider text-gray-500 truncate">
            {c.label}
          </div>
          <div className={`text-lg sm:text-xl font-semibold tabular-nums mt-1 ${toneClass(c.tone)}`}>
            {c.value}
          </div>
          {c.hint && (
            <div className="text-[10px] text-gray-600 mt-0.5 truncate">{c.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}
