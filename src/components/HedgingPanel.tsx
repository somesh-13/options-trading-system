'use client';

import { useState } from 'react';
import { PRICING_API_URL as API_URL } from '@/lib/pricing-api';

interface Position {
  S: number; K: number; T: number; r: number; sigma: number;
  option_type: string; qty: number;
}

interface HedgeResult {
  current_delta: number;
  target_delta: number;
  hedge_shares: number;
  hedge_direction: string;
  hedge_notional: number;
  portfolio_greeks: {
    total_delta: number;
    total_gamma: number;
    total_vega: number;
    total_theta: number;
    total_rho: number;
    per_position: Array<{
      strike: number; type: string; qty: number; price: number;
      greeks: Record<string, number>;
    }>;
  };
}

const DEFAULT_POSITION: Position = { S: 150, K: 155, T: 0.25, r: 0.05, sigma: 0.3, option_type: 'call', qty: 10 };

export default function HedgingPanel() {
  const [positions, setPositions] = useState<Position[]>([{ ...DEFAULT_POSITION }]);
  const [result, setResult] = useState<HedgeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addPosition = () => setPositions([...positions, { ...DEFAULT_POSITION }]);
  const removePosition = (idx: number) => setPositions(positions.filter((_, i) => i !== idx));

  const updatePosition = (idx: number, field: string, value: string | number) => {
    const updated = [...positions];
    updated[idx] = { ...updated[idx], [field]: typeof value === 'string' && field !== 'option_type' ? parseFloat(value) : value };
    setPositions(updated);
  };

  const calculateHedge = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${API_URL}/api/hedge/ratio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, target_delta: 0.0 }),
      });
      if (!resp.ok) throw new Error('Hedge calculation failed');
      setResult(await resp.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-xl font-bold mb-4">Dynamic Hedging Engine</h3>

      {/* Position Builder */}
      <div className="space-y-2 mb-4">
        {positions.map((pos, i) => (
          <div key={i} className="grid grid-cols-8 gap-2 items-end">
            <div>
              <label className="text-xs text-gray-400">Spot</label>
              <input type="number" step="0.5" value={pos.S}
                onChange={(e) => updatePosition(i, 'S', e.target.value)}
                className="w-full bg-[#1E1E1E] text-white px-2 py-1 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Strike</label>
              <input type="number" step="0.5" value={pos.K}
                onChange={(e) => updatePosition(i, 'K', e.target.value)}
                className="w-full bg-[#1E1E1E] text-white px-2 py-1 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400">T (yrs)</label>
              <input type="number" step="0.01" value={pos.T}
                onChange={(e) => updatePosition(i, 'T', e.target.value)}
                className="w-full bg-[#1E1E1E] text-white px-2 py-1 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400">IV</label>
              <input type="number" step="0.01" value={pos.sigma}
                onChange={(e) => updatePosition(i, 'sigma', e.target.value)}
                className="w-full bg-[#1E1E1E] text-white px-2 py-1 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Type</label>
              <select value={pos.option_type}
                onChange={(e) => updatePosition(i, 'option_type', e.target.value)}
                className="w-full bg-[#1E1E1E] text-white px-2 py-1 rounded text-sm">
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">Qty</label>
              <input type="number" value={pos.qty}
                onChange={(e) => updatePosition(i, 'qty', e.target.value)}
                className="w-full bg-[#1E1E1E] text-white px-2 py-1 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Rate</label>
              <input type="number" step="0.01" value={pos.r}
                onChange={(e) => updatePosition(i, 'r', e.target.value)}
                className="w-full bg-[#1E1E1E] text-white px-2 py-1 rounded text-sm" />
            </div>
            <button onClick={() => removePosition(i)}
              className="px-2 py-1 bg-[#FF006E]/20 text-[#FF006E] rounded text-sm hover:bg-[#FF006E]/30">
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <button onClick={addPosition}
          className="px-4 py-2 bg-[#2D2D2D] border border-gray-600 text-white rounded-lg hover:bg-[#333]">
          + Add Position
        </button>
        <button onClick={calculateHedge} disabled={loading}
          className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg disabled:opacity-50">
          {loading ? 'Calculating...' : 'Calculate Hedge'}
        </button>
      </div>

      {error && <p className="text-[#FF006E] mb-4">{error}</p>}

      {result && (
        <div className="space-y-4">
          {/* Hedge Recommendation */}
          <div className={`bg-[#1E1E1E] rounded-lg p-4 border ${Math.abs(result.current_delta) > 50 ? 'border-[#FF006E]/50' : 'border-[#00C805]/50'}`}>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500">Current Delta</p>
                <p className={`text-xl font-bold ${Math.abs(result.current_delta) > 50 ? 'text-[#FF006E]' : 'text-[#00C805]'}`}>
                  {result.current_delta.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Hedge Action</p>
                <p className="text-xl font-bold text-[#FFD700]">
                  {result.hedge_direction} {Math.abs(result.hedge_shares)} shares
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Hedge Notional</p>
                <p className="text-xl font-bold">${result.hedge_notional.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Target Delta</p>
                <p className="text-xl font-bold text-[#00C805]">{result.target_delta}</p>
              </div>
            </div>
          </div>

          {/* Portfolio Greeks */}
          <div className="grid grid-cols-5 gap-3">
            {(['total_delta', 'total_gamma', 'total_vega', 'total_theta', 'total_rho'] as const).map((key) => (
              <div key={key} className="bg-[#1E1E1E] rounded-lg p-3">
                <p className="text-xs text-gray-500">{key.replace('total_', '').toUpperCase()}</p>
                <p className="text-lg font-bold">{result.portfolio_greeks[key].toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
