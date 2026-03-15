'use client';

import { useState } from 'react';

interface EVResult {
  ev: number;
  ev_per_contract: number;
  direction: string;
  option_type: string;
  premium: number;
  bs_theoretical: number;
  edge_dollars: number;
  prob_itm: number;
  prob_otm: number;
  max_profit: number;
  max_loss: number;
  transaction_costs: number;
  execute: boolean;
  signal: string;
  delta: number;
  gamma: number;
}

const API_URL = process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000';

export default function EVCalculator() {
  const [result, setResult] = useState<EVResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [params, setParams] = useState({
    S: 150, K: 155, T: 0.0833, r: 0.05, sigma: 0.3,
    option_type: 'call' as 'call' | 'put', direction: 'sell' as 'sell' | 'buy', contracts: 1,
  });

  const calculate = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${API_URL}/api/strategy/ev`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!resp.ok) throw new Error('EV calculation failed');
      setResult(await resp.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-xl font-bold mb-4">Expected Value Calculator</h3>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-400">Spot Price</label>
          <input type="number" step="0.5" value={params.S}
            onChange={(e) => setParams({ ...params, S: parseFloat(e.target.value) })}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
        <div>
          <label className="text-xs text-gray-400">Strike</label>
          <input type="number" step="0.5" value={params.K}
            onChange={(e) => setParams({ ...params, K: parseFloat(e.target.value) })}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
        <div>
          <label className="text-xs text-gray-400">Days to Expiry</label>
          <input type="number" value={Math.round(params.T * 365)}
            onChange={(e) => setParams({ ...params, T: parseInt(e.target.value) / 365 })}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
        <div>
          <label className="text-xs text-gray-400">IV (%)</label>
          <input type="number" step="1" value={Math.round(params.sigma * 100)}
            onChange={(e) => setParams({ ...params, sigma: parseInt(e.target.value) / 100 })}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <select value={params.direction}
          onChange={(e) => setParams({ ...params, direction: e.target.value as 'sell' | 'buy' })}
          className="bg-[#1E1E1E] text-white px-3 py-2 rounded-lg">
          <option value="sell">Sell (Short)</option>
          <option value="buy">Buy (Long)</option>
        </select>
        <select value={params.option_type}
          onChange={(e) => setParams({ ...params, option_type: e.target.value as 'call' | 'put' })}
          className="bg-[#1E1E1E] text-white px-3 py-2 rounded-lg">
          <option value="call">Call</option>
          <option value="put">Put</option>
        </select>
        <input type="number" min="1" value={params.contracts} placeholder="Contracts"
          onChange={(e) => setParams({ ...params, contracts: parseInt(e.target.value) || 1 })}
          className="w-24 bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        <button onClick={calculate} disabled={loading}
          className="px-6 py-2 bg-[#FFD700] hover:bg-[#E6C300] text-black font-bold rounded-lg disabled:opacity-50">
          {loading ? 'Calculating...' : 'Calculate EV'}
        </button>
      </div>

      {error && <p className="text-[#FF006E] mb-4">{error}</p>}

      {result && (
        <div className="space-y-4">
          {/* Main EV Signal */}
          <div className={`bg-[#1E1E1E] rounded-lg p-4 border ${result.execute ? 'border-[#00C805]/50' : 'border-[#FF006E]/50'}`}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-500">Expected Value</p>
                <p className={`text-3xl font-bold ${result.ev > 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                  ${result.ev.toFixed(2)}
                </p>
                <p className="text-sm text-gray-400">${result.ev_per_contract.toFixed(2)} per contract</p>
              </div>
              <div className={`px-4 py-2 rounded-lg text-lg font-bold ${result.execute ? 'bg-[#00C805]/20 text-[#00C805]' : 'bg-[#FF006E]/20 text-[#FF006E]'}`}>
                {result.signal}
              </div>
            </div>
          </div>

          {/* Probabilities & P&L */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">P(ITM)</p>
              <p className="text-lg font-bold text-[#FF006E]">{result.prob_itm.toFixed(1)}%</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">P(OTM)</p>
              <p className="text-lg font-bold text-[#00C805]">{result.prob_otm.toFixed(1)}%</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Edge</p>
              <p className={`text-lg font-bold ${result.edge_dollars > 0 ? 'text-[#00C805]' : 'text-[#FFD700]'}`}>
                ${result.edge_dollars.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Premium</p>
              <p className="text-lg font-bold">${result.premium.toFixed(2)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">BS Theoretical</p>
              <p className="text-lg font-bold text-[#FFD700]">${result.bs_theoretical.toFixed(2)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Delta</p>
              <p className="text-lg font-bold">{result.delta.toFixed(4)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Transaction Costs</p>
              <p className="text-lg font-bold text-gray-400">${result.transaction_costs.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
