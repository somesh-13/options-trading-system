'use client';

import { useState } from 'react';
import type { PositionWithGreeks, PortfolioGreeks } from '@/lib/pricing-api';

interface LivePositionsTableProps {
  positions: PositionWithGreeks[] | null;
  portfolioGreeks: PortfolioGreeks | null;
  loading: boolean;
}

type SortKey = 'symbol' | 'qty' | 'market_value' | 'unrealized_pl' | 'delta' | 'gamma' | 'theta' | 'vega';

export default function LivePositionsTable({ positions, portfolioGreeks, loading }: LivePositionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [sortAsc, setSortAsc] = useState(true);

  if (loading || !positions) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6 mb-6 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/4 mb-4"></div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-gray-700 rounded w-full mb-2"></div>
        ))}
      </div>
    );
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sorted = [...positions].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    switch (sortKey) {
      case 'symbol': aVal = a.parsed_symbol || a.symbol; bVal = b.parsed_symbol || b.symbol; break;
      case 'qty': aVal = parseFloat(a.qty); bVal = parseFloat(b.qty); break;
      case 'market_value': aVal = parseFloat(a.market_value || '0'); bVal = parseFloat(b.market_value || '0'); break;
      case 'unrealized_pl': aVal = parseFloat(a.unrealized_pl || '0'); bVal = parseFloat(b.unrealized_pl || '0'); break;
      case 'delta': aVal = a.greeks.delta; bVal = b.greeks.delta; break;
      case 'gamma': aVal = a.greeks.gamma; bVal = b.greeks.gamma; break;
      case 'theta': aVal = a.greeks.theta; bVal = b.greeks.theta; break;
      case 'vega': aVal = a.greeks.vega; bVal = b.greeks.vega; break;
      default: aVal = 0; bVal = 0;
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ^' : ' v') : '';

  const fmt = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (isNaN(n)) return '-';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const plColor = (v: string) => {
    const n = parseFloat(v || '0');
    return n >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]';
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6 mb-6 overflow-x-auto">
      <h3 className="text-lg font-bold mb-4">Live Positions ({positions.length})</h3>
      {positions.length === 0 ? (
        <p className="text-gray-400">No open positions</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('symbol')}>Symbol{arrow('symbol')}</th>
              <th className="text-left py-2 px-2">Type</th>
              <th className="text-right py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('qty')}>Qty{arrow('qty')}</th>
              <th className="text-right py-2 px-2">Entry</th>
              <th className="text-right py-2 px-2">Current</th>
              <th className="text-right py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('market_value')}>Mkt Value{arrow('market_value')}</th>
              <th className="text-right py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('unrealized_pl')}>Unreal P&L{arrow('unrealized_pl')}</th>
              <th className="text-right py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('delta')}>Delta{arrow('delta')}</th>
              <th className="text-right py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('gamma')}>Gamma{arrow('gamma')}</th>
              <th className="text-right py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('theta')}>Theta{arrow('theta')}</th>
              <th className="text-right py-2 px-2 cursor-pointer hover:text-white" onClick={() => handleSort('vega')}>Vega{arrow('vega')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((pos, i) => (
              <tr key={i} className="border-b border-gray-800 hover:bg-[#333333]">
                <td className="py-2 px-2 font-mono text-xs">
                  {pos.parsed_symbol || pos.symbol}
                </td>
                <td className="py-2 px-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    pos.position_type === 'option'
                      ? pos.parsed_symbol?.includes('Call') ? 'bg-[#00C805]/20 text-[#00C805]' : 'bg-[#FF006E]/20 text-[#FF006E]'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {pos.position_type === 'stock' ? 'Stock' : pos.parsed_symbol?.includes('Call') ? 'Call' : 'Put'}
                  </span>
                </td>
                <td className="text-right py-2 px-2">{pos.qty}</td>
                <td className="text-right py-2 px-2">${fmt(pos.avg_entry_price)}</td>
                <td className="text-right py-2 px-2">${fmt(pos.current_price)}</td>
                <td className="text-right py-2 px-2">${fmt(pos.market_value)}</td>
                <td className={`text-right py-2 px-2 font-medium ${plColor(pos.unrealized_pl)}`}>
                  {parseFloat(pos.unrealized_pl || '0') >= 0 ? '+' : ''}${fmt(pos.unrealized_pl)}
                </td>
                <td className="text-right py-2 px-2">{pos.greeks.delta.toFixed(2)}</td>
                <td className="text-right py-2 px-2">{pos.greeks.gamma.toFixed(2)}</td>
                <td className="text-right py-2 px-2">{pos.greeks.theta.toFixed(2)}</td>
                <td className="text-right py-2 px-2">{pos.greeks.vega.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          {portfolioGreeks && (
            <tfoot>
              <tr className="border-t-2 border-gray-600 font-bold">
                <td className="py-2 px-2" colSpan={7}>Portfolio Total</td>
                <td className="text-right py-2 px-2">{portfolioGreeks.total_delta.toFixed(2)}</td>
                <td className="text-right py-2 px-2">{portfolioGreeks.total_gamma.toFixed(2)}</td>
                <td className="text-right py-2 px-2">{portfolioGreeks.total_theta.toFixed(2)}</td>
                <td className="text-right py-2 px-2">{portfolioGreeks.total_vega.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}
