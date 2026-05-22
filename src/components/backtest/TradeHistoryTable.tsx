'use client';

import { useMemo, useState } from 'react';
import { TradeRow } from './types';

interface Props {
  trades: TradeRow[];
  /** Optional title override. */
  title?: string;
  /** Initial page size. */
  pageSize?: number;
}

const fmtCurrency0 = (v: number): string => {
  const sign = v >= 0 ? '+' : '';
  if (Math.abs(v) >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${sign}$${(v / 1_000).toFixed(1)}K`;
  return `${sign}$${v.toFixed(0)}`;
};

type DirFilter = 'all' | 'long' | 'short';
type PnlFilter = 'all' | 'win' | 'loss';

export default function TradeHistoryTable({ trades, title = 'Trade History', pageSize = 25 }: Props) {
  const [query, setQuery] = useState('');
  const [dirFilter, setDirFilter] = useState<DirFilter>('all');
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>('all');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trades.filter((t) => {
      if (
        q &&
        !(
          t.ticker?.toLowerCase().includes(q) ||
          t.direction.toLowerCase().includes(q) ||
          t.exitReason.toLowerCase().includes(q)
        )
      ) {
        return false;
      }
      if (dirFilter !== 'all') {
        const isShort =
          /SELL/i.test(t.direction) || /SHORT/i.test(t.direction) || /PUT/i.test(t.direction);
        if (dirFilter === 'short' && !isShort) return false;
        if (dirFilter === 'long' && isShort) return false;
      }
      if (pnlFilter === 'win' && t.pnl <= 0) return false;
      if (pnlFilter === 'loss' && t.pnl >= 0) return false;
      return true;
    });
  }, [trades, query, dirFilter, pnlFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);

  if (trades.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#1f2027] bg-[#0f1014] overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#16171c]">
        <div>
          <h3 className="text-sm font-semibold text-white tracking-tight">{title}</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {filtered.length === trades.length
              ? `${trades.length} trades`
              : `${filtered.length} of ${trades.length} trades`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search ticker, type, reason…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            className="text-sm bg-[#0b0b0d] text-white px-2.5 py-1.5 rounded-md ring-1 ring-inset ring-[#26272d] focus:outline-none focus:ring-[#22D3EE]/60 w-48"
          />
          <select
            value={dirFilter}
            onChange={(e) => {
              setDirFilter(e.target.value as DirFilter);
              setPage(0);
            }}
            className="text-xs bg-[#0b0b0d] text-gray-300 px-2 py-1.5 rounded-md ring-1 ring-inset ring-[#26272d]"
          >
            <option value="all">All directions</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
          <select
            value={pnlFilter}
            onChange={(e) => {
              setPnlFilter(e.target.value as PnlFilter);
              setPage(0);
            }}
            className="text-xs bg-[#0b0b0d] text-gray-300 px-2 py-1.5 rounded-md ring-1 ring-inset ring-[#26272d]"
          >
            <option value="all">All P&L</option>
            <option value="win">Winners</option>
            <option value="loss">Losers</option>
          </select>
        </div>
      </header>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0b0b0d] text-[10px] uppercase tracking-wider text-gray-500 z-10">
            <tr>
              <th className="px-3 py-2 text-left w-6"></th>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-left">Entry</th>
              <th className="px-3 py-2 text-left">Exit</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Hold</th>
              <th className="px-3 py-2 text-right">P&L</th>
              <th className="px-3 py-2 text-right">P&L %</th>
              <th className="px-3 py-2 text-right">IV/HV</th>
              <th className="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, idx) => {
              const realIdx = page * pageSize + idx;
              const isExpanded = expanded === realIdx;
              const pnlTone =
                t.pnl > 0 ? 'text-[#34D399]' : t.pnl < 0 ? 'text-[#FF006E]' : 'text-gray-300';
              return (
                <FragmentRow
                  key={realIdx}
                  trade={t}
                  index={realIdx}
                  expanded={isExpanded}
                  onToggle={() => setExpanded(isExpanded ? null : realIdx)}
                  pnlTone={pnlTone}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <footer className="flex items-center justify-between px-4 py-2.5 border-t border-[#16171c] text-xs text-gray-400">
          <span>
            Page {page + 1} / {pages}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded-md hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ‹ Prev
            </button>
            <button
              onClick={() => setPage(Math.min(pages - 1, page + 1))}
              disabled={page >= pages - 1}
              className="px-2 py-1 rounded-md hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next ›
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function FragmentRow({
  trade: t,
  index,
  expanded,
  onToggle,
  pnlTone,
}: {
  trade: TradeRow;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  pnlTone: string;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-t border-[#16171c] cursor-pointer hover:bg-white/[0.03] transition-colors"
      >
        <td className="px-3 py-2 text-gray-500">{expanded ? '▼' : '▸'}</td>
        <td className="px-3 py-2 font-mono text-white">{t.ticker ?? '—'}</td>
        <td className="px-3 py-2 text-gray-300 tabular-nums">{t.entryDate}</td>
        <td className="px-3 py-2 text-gray-300 tabular-nums">{t.exitDate}</td>
        <td className="px-3 py-2 text-gray-300">{t.direction}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-300">{t.holdingDays}d</td>
        <td className={`px-3 py-2 text-right tabular-nums font-medium ${pnlTone}`}>
          {(t.pnl >= 0 ? '+' : '') + '$' + Math.abs(t.pnl).toFixed(0)}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums ${pnlTone}`}>
          {t.pnlPct >= 0 ? '+' : ''}
          {t.pnlPct.toFixed(2)}%
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-300">
          {t.ivHvRatio.toFixed(2)}
        </td>
        <td className="px-3 py-2 text-gray-500 text-xs">{t.exitReason}</td>
      </tr>
      {expanded && (
        <tr className="border-t border-[#16171c] bg-[#0c0d11]">
          <td colSpan={10} className="px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <Detail label="Stock at Entry" value={`$${t.entryPrice.toFixed(2)}`} />
              <Detail label="Stock at Exit" value={`$${t.exitPrice.toFixed(2)}`} />
              {t.optionPremiumAtEntry != null && (
                <Detail
                  label="Premium at Entry"
                  value={`$${t.optionPremiumAtEntry.toFixed(2)}/shr`}
                />
              )}
              {t.optionPremiumAtExit != null && (
                <Detail
                  label="Premium at Exit"
                  value={`$${t.optionPremiumAtExit.toFixed(2)}/shr`}
                />
              )}
              <Detail label="Holding Days" value={`${t.holdingDays}`} />
              <Detail label="IV / HV at entry" value={t.ivHvRatio.toFixed(2)} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-gray-200 tabular-nums">{value}</div>
    </div>
  );
}
