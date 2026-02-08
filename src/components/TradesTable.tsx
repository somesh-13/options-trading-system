'use client';

import { useState } from 'react';
import { format } from 'date-fns';

interface TradesTableProps {
  trades: any[];
  positions: any[];
}

export default function TradesTable({ trades, positions }: TradesTableProps) {
  const [filter, setFilter] = useState<'all' | 'filled' | 'open'>('all');

  const filteredTrades = trades.filter((trade) => {
    if (filter === 'all') return true;
    if (filter === 'filled') return trade.status === 'filled';
    if (filter === 'open') return trade.status !== 'filled' && trade.status !== 'canceled';
    return true;
  });

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Recent Trades</h2>
        <div className="flex gap-2">
          {['all', 'filled', 'open'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === f
                  ? 'bg-[#00C805] text-white'
                  : 'bg-[#1E1E1E] text-gray-400 hover:bg-[#333333]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filteredTrades.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-xl mb-2">No trades found</p>
          <p className="text-sm">Your recent trades will appear here</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Date/Time</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Symbol</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Side</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Qty</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Price</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((trade) => (
                <tr
                  key={trade.id}
                  className="border-b border-gray-800 hover:bg-[#333333] transition-colors"
                >
                  <td className="py-4 px-4 text-sm">
                    {trade.created_at
                      ? format(new Date(trade.created_at), 'MMM dd, yyyy HH:mm')
                      : 'N/A'}
                  </td>
                  <td className="py-4 px-4 font-bold">{trade.symbol}</td>
                  <td className="py-4 px-4">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        trade.side === 'buy'
                          ? 'bg-[#00C805] bg-opacity-20 text-[#00C805]'
                          : 'bg-[#FFD700] bg-opacity-20 text-[#FFD700]'
                      }`}
                    >
                      {trade.side?.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-4 px-4">{trade.qty}</td>
                  <td className="py-4 px-4">
                    ${trade.filled_avg_price || trade.limit_price || 'Market'}
                  </td>
                  <td className="py-4 px-4">
                    <span
                      className={`text-sm ${
                        trade.status === 'filled'
                          ? 'text-[#00C805]'
                          : trade.status === 'canceled'
                          ? 'text-[#FF006E]'
                          : 'text-[#FFD700]'
                      }`}
                    >
                      {trade.status}
                    </span>
                  </td>
                  <td className="py-4 px-4 font-bold">
                    ${(
                      parseFloat(trade.filled_avg_price || trade.limit_price || '0') *
                      parseFloat(trade.qty)
                    ).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
