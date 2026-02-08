'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  getTradeHistory,
  getPnLSummary,
  getPnLBySignal,
  syncOrderStatuses,
  type TradeRecord,
  type PnLSummary,
  type SignalStats,
} from '@/lib/pricing-api';

export default function JournalPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [pnl, setPnl] = useState<PnLSummary | null>(null);
  const [signalStats, setSignalStats] = useState<SignalStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // Filters
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSignal, setFilterSignal] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const filters: Record<string, string | number> = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      if (filterSymbol) filters.symbol = filterSymbol;
      if (filterStatus) filters.status = filterStatus;
      if (filterSignal) filters.signal_source = filterSignal;

      const [tradesRes, pnlRes, signalRes] = await Promise.all([
        getTradeHistory(filters),
        getPnLSummary(),
        getPnLBySignal(),
      ]);

      setTrades(tradesRes.trades);
      setPnl(pnlRes);
      setSignalStats(signalRes.signal_stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal data');
    } finally {
      setLoading(false);
    }
  }, [page, filterSymbol, filterStatus, filterSignal]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncOrderStatuses();
      await fetchData();
    } catch {
      setError('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'filled': return 'text-[#00C805]';
      case 'submitted': return 'text-[#FFD700]';
      case 'partial': return 'text-[#FFD700]';
      case 'cancelled': return 'text-gray-500';
      case 'rejected': return 'text-[#FF006E]';
      default: return 'text-gray-400';
    }
  };

  const sideColor = (side: string) => side === 'buy' ? 'text-[#00C805]' : 'text-[#FF006E]';

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">&larr; Dashboard</Link>
            <h1 className="text-3xl font-bold">Trade Journal</h1>
            <p className="text-gray-400 text-sm mt-1">Order history, P&L tracking, and signal attribution</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-[#FFD700]/20 text-[#FFD700] text-xs font-bold rounded">PAPER</span>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Sync from Alpaca'}
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-4 p-3 bg-[#FF006E]/20 border border-[#FF006E]/40 rounded-lg text-sm text-[#FF006E]">
            {error}
          </div>
        )}

        {/* P&L Summary Cards */}
        {pnl && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-[#2D2D2D] rounded-lg p-4">
              <p className="text-gray-400 text-xs uppercase">Total P&L</p>
              <p className={`text-2xl font-bold ${pnl.total_pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                ${pnl.total_pnl.toFixed(2)}
              </p>
            </div>
            <div className="bg-[#2D2D2D] rounded-lg p-4">
              <p className="text-gray-400 text-xs uppercase">Win Rate</p>
              <p className="text-2xl font-bold text-white">{pnl.win_rate}%</p>
              <p className="text-xs text-gray-500">{pnl.winning_trades}W / {pnl.losing_trades}L</p>
            </div>
            <div className="bg-[#2D2D2D] rounded-lg p-4">
              <p className="text-gray-400 text-xs uppercase">Profit Factor</p>
              <p className="text-2xl font-bold text-white">
                {pnl.profit_factor === 'inf' ? '\u221E' : pnl.profit_factor}
              </p>
            </div>
            <div className="bg-[#2D2D2D] rounded-lg p-4">
              <p className="text-gray-400 text-xs uppercase">Avg Win / Loss</p>
              <p className="text-sm">
                <span className="text-[#00C805]">${pnl.avg_win.toFixed(2)}</span>
                {' / '}
                <span className="text-[#FF006E]">${pnl.avg_loss.toFixed(2)}</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Best: ${pnl.best_trade.toFixed(2)} | Worst: ${pnl.worst_trade.toFixed(2)}
              </p>
            </div>
          </div>
        )}

        {/* Signal Attribution */}
        {signalStats.length > 0 && (
          <div className="mb-6 bg-[#2D2D2D] rounded-lg p-4">
            <h2 className="font-bold text-sm uppercase text-gray-400 mb-3">Signal Attribution</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {signalStats.map((s) => (
                <div key={s.signal_source} className="bg-[#1E1E1E] rounded-lg p-3">
                  <p className="font-bold text-sm capitalize">{s.signal_source.replace('_', ' ')}</p>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{s.total_trades} trades</span>
                    <span className={s.total_pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}>
                      ${s.total_pnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Win rate: {s.win_rate}%</span>
                    <span>Avg: ${s.avg_pnl.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            value={filterSymbol}
            onChange={(e) => { setFilterSymbol(e.target.value.toUpperCase()); setPage(0); }}
            placeholder="Symbol filter"
            className="w-32 bg-[#2D2D2D] text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
          />
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
            className="bg-[#2D2D2D] text-white px-3 py-2 rounded-lg text-sm focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="submitted">Submitted</option>
            <option value="filled">Filled</option>
            <option value="partial">Partial</option>
            <option value="cancelled">Cancelled</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={filterSignal}
            onChange={(e) => { setFilterSignal(e.target.value); setPage(0); }}
            className="bg-[#2D2D2D] text-white px-3 py-2 rounded-lg text-sm focus:outline-none"
          >
            <option value="">All Sources</option>
            <option value="manual">Manual</option>
            <option value="auto_engine">Auto Engine</option>
          </select>
        </div>

        {/* Trade History Table */}
        <div className="bg-[#2D2D2D] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Side</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Limit</th>
                  <th className="px-4 py-3 text-right">Filled</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                ) : trades.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No trades found</td></tr>
                ) : (
                  trades.map((t) => (
                    <tr key={t.id} className="border-b border-gray-700/50 hover:bg-[#333333]/50">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {new Date(t.timestamp).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold">{t.symbol}</td>
                      <td className={`px-4 py-3 font-bold uppercase ${sideColor(t.side)}`}>{t.side}</td>
                      <td className="px-4 py-3 text-right">{t.qty}</td>
                      <td className="px-4 py-3 text-gray-400">{t.order_type}</td>
                      <td className="px-4 py-3 text-right">{t.limit_price != null ? `$${t.limit_price.toFixed(2)}` : '-'}</td>
                      <td className="px-4 py-3 text-right">{t.filled_price != null ? `$${t.filled_price.toFixed(2)}` : '-'}</td>
                      <td className={`px-4 py-3 capitalize ${statusColor(t.status)}`}>{t.status}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          t.signal_source === 'auto_engine'
                            ? 'bg-[#FF006E]/20 text-[#FF006E]'
                            : 'bg-gray-600/30 text-gray-400'
                        }`}>
                          {t.signal_source === 'auto_engine' ? 'Auto' : 'Manual'}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${
                        t.realized_pnl == null ? 'text-gray-500' :
                        t.realized_pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'
                      }`}>
                        {t.realized_pnl != null ? `$${t.realized_pnl.toFixed(2)}` : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1 bg-[#1E1E1E] rounded text-sm disabled:opacity-30 hover:bg-[#333333]"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">Page {page + 1}</span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={trades.length < PAGE_SIZE}
              className="px-3 py-1 bg-[#1E1E1E] rounded text-sm disabled:opacity-30 hover:bg-[#333333]"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
