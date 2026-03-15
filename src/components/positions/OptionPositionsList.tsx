'use client';

import { PositionWithGreeks } from '@/lib/pricing-api';
import { formatOCCReadable } from '@/lib/utils';

interface OptionPositionsListProps {
  positions: PositionWithGreeks[];
}

export default function OptionPositionsList({ positions }: OptionPositionsListProps) {
  const optionPositions = positions.filter((p) => p.position_type === 'option');

  if (optionPositions.length === 0) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6">
        <h3 className="text-lg font-bold mb-2">Options Positions</h3>
        <p className="text-gray-500">No open options positions</p>
      </div>
    );
  }

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">Options Positions ({optionPositions.length})</h3>
      <div className="space-y-3">
        {optionPositions.map((pos, i) => {
          const pnl = parseFloat(pos.unrealized_pl || '0');
          const pnlPct = parseFloat(pos.unrealized_plpc || '0') * 100;
          const isPositive = pnl >= 0;

          return (
            <div key={i} className="bg-[#1E1E1E] rounded-lg p-4 border border-gray-700/50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-bold text-[#FFD700]">{formatOCCReadable(pos.symbol)}</p>
                  <p className="text-xs text-gray-500">{pos.symbol}</p>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${isPositive ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                    {isPositive ? '+' : ''}${pnl.toFixed(2)}
                  </p>
                  <p className={`text-xs ${isPositive ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                    {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">Qty</span>
                  <span className="ml-2 text-white">{pos.qty}</span>
                </div>
                <div>
                  <span className="text-gray-500">Entry</span>
                  <span className="ml-2 text-white">${parseFloat(pos.avg_entry_price || '0').toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Current</span>
                  <span className="ml-2 text-white">${parseFloat(pos.current_price || '0').toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Value</span>
                  <span className="ml-2 text-white">${parseFloat(pos.market_value || '0').toFixed(2)}</span>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2 mt-2 text-xs">
                <div><span className="text-gray-500">Delta</span> <span className="text-white">{pos.greeks.delta.toFixed(2)}</span></div>
                <div><span className="text-gray-500">Gamma</span> <span className="text-white">{pos.greeks.gamma.toFixed(4)}</span></div>
                <div><span className="text-gray-500">Vega</span> <span className="text-white">{pos.greeks.vega.toFixed(2)}</span></div>
                <div><span className="text-gray-500">Theta</span> <span className="text-white">{pos.greeks.theta.toFixed(2)}</span></div>
                <div><span className="text-gray-500">Rho</span> <span className="text-white">{pos.greeks.rho.toFixed(4)}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
