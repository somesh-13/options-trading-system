'use client';

import { formatOCCReadable } from '@/lib/utils';

interface TradePanelProps {
  selectedOCC: string;
  side: 'buy' | 'sell';
  qty: number;
  onQtyChange: (qty: number) => void;
  orderType: 'market' | 'limit';
  onOrderTypeChange: (type: 'market' | 'limit') => void;
  limitPrice: number | undefined;
  onLimitPriceChange: (price: number | undefined) => void;
  onSubmit: () => void;
  orderResult: string;
  buyingPower: number;
  submitting: boolean;
}

export default function TradePanel({
  selectedOCC,
  side,
  qty,
  onQtyChange,
  orderType,
  onOrderTypeChange,
  limitPrice,
  onLimitPriceChange,
  onSubmit,
  orderResult,
  buyingPower,
  submitting,
}: TradePanelProps) {
  const totalCost = orderType === 'limit' && limitPrice ? limitPrice * qty * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Selected Contract */}
      <div className="bg-[#2D2D2D] rounded-lg p-4">
        <h3 className="text-sm font-bold text-gray-400 mb-3">Trade Builder</h3>
        {selectedOCC ? (
          <>
            <div className="bg-[#1E1E1E] rounded-lg p-3 border border-[#00C805]/30 mb-4">
              <p className="text-xs text-gray-400">Selected Contract</p>
              <p className="text-sm font-bold text-[#00C805]">{formatOCCReadable(selectedOCC)}</p>
              <p className="text-xs text-gray-500 mt-0.5">{selectedOCC}</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400">Contracts</label>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => onQtyChange(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg mt-1"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400">Order Type</label>
                <select
                  value={orderType}
                  onChange={(e) => onOrderTypeChange(e.target.value as 'market' | 'limit')}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg mt-1"
                >
                  <option value="limit">Limit</option>
                  <option value="market">Market</option>
                </select>
              </div>

              {orderType === 'limit' && (
                <div>
                  <label className="text-xs text-gray-400">Limit Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={limitPrice || ''}
                    onChange={(e) => onLimitPriceChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg mt-1"
                  />
                </div>
              )}

              {totalCost > 0 && (
                <div className="text-sm text-gray-400">
                  Est. Total: <span className="text-white font-bold">${totalCost.toFixed(2)}</span>
                </div>
              )}

              <button
                onClick={onSubmit}
                disabled={submitting}
                className={`w-full py-3 font-bold rounded-lg transition-colors disabled:opacity-50 ${
                  side === 'buy'
                    ? 'bg-[#00C805] hover:bg-[#00A004] text-white'
                    : 'bg-[#FF006E] hover:bg-[#CC0058] text-white'
                }`}
              >
                {submitting ? 'Submitting...' : `Review ${side === 'buy' ? 'Buy' : 'Sell'} Order`}
              </button>
            </div>

            {orderResult && (
              <pre className="mt-3 bg-[#1E1E1E] rounded p-3 text-xs text-gray-300 overflow-x-auto max-h-40">
                {orderResult}
              </pre>
            )}
          </>
        ) : (
          <p className="text-gray-500 text-sm">Select a contract from the chain to begin.</p>
        )}
      </div>

      {/* Buying Power */}
      <div className="bg-[#2D2D2D] rounded-lg p-4">
        <div className="flex justify-between">
          <span className="text-gray-500 text-sm">Buying Power</span>
          <span className="text-white font-bold">
            ${buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}
