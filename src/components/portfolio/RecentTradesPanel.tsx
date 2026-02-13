'use client';

import { useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { getTradeHistory, type TradeRecord } from '@/lib/pricing-api';

interface RecentTradesPanelProps {
  refreshInterval: number;
}

export default function RecentTradesPanel({ refreshInterval }: RecentTradesPanelProps) {
  const fetchTrades = useCallback(
    () => getTradeHistory({ status: 'filled', limit: 10 }),
    []
  );

  const { data, loading } = usePolling(fetchTrades, {
    interval: refreshInterval > 0 ? Math.max(refreshInterval, 60000) : 0,
  });

  const trades = data?.trades ?? [];

  const fmtTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6 mb-6">
      <h3 className="text-lg font-bold mb-4">Recent Trades</h3>

      {loading && trades.length === 0 ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-700 rounded" />
          ))}
        </div>
      ) : trades.length === 0 ? (
        <p className="text-gray-500 text-sm">No filled trades yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-gray-700">
                <th className="text-left pb-2 pr-4">Time</th>
                <th className="text-left pb-2 pr-4">Symbol</th>
                <th className="text-left pb-2 pr-4">Side</th>
                <th className="text-right pb-2 pr-4">Qty</th>
                <th className="text-right pb-2 pr-4">Fill Price</th>
                <th className="text-right pb-2 pr-4">P&L</th>
                <th className="text-left pb-2">Signal</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: TradeRecord) => {
                const pnl = t.realized_pnl;
                const pnlColor = pnl === null ? 'text-gray-500' : pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]';
                const sideColor = t.side === 'buy' ? 'text-[#00C805]' : 'text-[#FF006E]';

                return (
                  <tr key={t.id} className="border-b border-gray-700/50 hover:bg-[#333333] transition-colors">
                    <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{fmtTime(t.timestamp)}</td>
                    <td className="py-2 pr-4 font-medium">{t.symbol}</td>
                    <td className={`py-2 pr-4 uppercase font-medium ${sideColor}`}>{t.side}</td>
                    <td className="py-2 pr-4 text-right">{t.filled_qty ?? t.qty}</td>
                    <td className="py-2 pr-4 text-right">
                      {t.filled_price !== null ? `$${Number(t.filled_price).toFixed(2)}` : '-'}
                    </td>
                    <td className={`py-2 pr-4 text-right font-medium ${pnlColor}`}>
                      {pnl !== null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '-'}
                    </td>
                    <td className="py-2 text-gray-400 text-xs">{t.signal_source || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
