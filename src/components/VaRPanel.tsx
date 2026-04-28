'use client';

import { useState } from 'react';
import { PRICING_API_URL as API_URL } from '@/lib/pricing-api';

interface VaRMethodResult {
  method: string;
  var_pct: number;
  var_dollars: number;
  cvar_pct: number;
  cvar_dollars: number;
  error?: string;
}

interface VaRData {
  ticker: string;
  portfolio_value: number;
  confidence: number;
  historical: VaRMethodResult;
  parametric: VaRMethodResult;
  monte_carlo: VaRMethodResult;
  summary: {
    avg_var_dollars: number;
    max_var_dollars: number;
    recommendation: string;
  };
}

export default function VaRPanel({ ticker }: { ticker: string }) {
  const [data, setData] = useState<VaRData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [portfolioValue, setPortfolioValue] = useState(100000);
  const [confidence, setConfidence] = useState(0.95);

  const fetchVaR = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(
        `${API_URL}/api/risk/var/${ticker}?portfolio_value=${portfolioValue}&confidence=${confidence}&method=all`
      );
      if (!resp.ok) throw new Error('VaR calculation failed');
      setData(await resp.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const renderMethodCard = (result: VaRMethodResult, label: string) => {
    if (result.error) {
      return (
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <h4 className="text-sm font-bold text-gray-400 mb-2">{label}</h4>
          <p className="text-[#FF006E] text-sm">{result.error}</p>
        </div>
      );
    }
    return (
      <div className="bg-[#1E1E1E] rounded-lg p-4">
        <h4 className="text-sm font-bold text-gray-400 mb-3">{label}</h4>
        <div className="space-y-2">
          <div>
            <p className="text-xs text-gray-500">VaR ({(confidence * 100).toFixed(0)}%)</p>
            <p className="text-xl font-bold text-[#FF006E]">${result.var_dollars.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{result.var_pct.toFixed(2)}% of portfolio</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">CVaR (Expected Shortfall)</p>
            <p className="text-lg font-bold text-[#FF006E]">${result.cvar_dollars.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{result.cvar_pct.toFixed(2)}% of portfolio</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-xl font-bold mb-4">Value at Risk (VaR)</h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-400">Portfolio Value ($)</label>
          <input type="number" value={portfolioValue} onChange={(e) => setPortfolioValue(parseInt(e.target.value))}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
        <div>
          <label className="text-xs text-gray-400">Confidence Level</label>
          <select value={confidence} onChange={(e) => setConfidence(parseFloat(e.target.value))}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg">
            <option value={0.95}>95%</option>
            <option value={0.99}>99%</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={fetchVaR} disabled={loading}
            className="w-full px-4 py-2 bg-[#FF006E] hover:bg-[#CC0058] text-white font-bold rounded-lg disabled:opacity-50">
            {loading ? 'Calculating...' : 'Calculate VaR'}
          </button>
        </div>
      </div>

      {error && <p className="text-[#FF006E] mb-4">{error}</p>}

      {data && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-[#1E1E1E] rounded-lg p-4 border border-[#FF006E]/30">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-500">Max Daily VaR (Conservative)</p>
                <p className="text-2xl font-bold text-[#FF006E]">${data.summary.max_var_dollars.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Avg Across Methods</p>
                <p className="text-lg font-bold text-[#FFD700]">${data.summary.avg_var_dollars.toLocaleString()}</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">{data.summary.recommendation}</p>
          </div>

          {/* Method Comparison */}
          <div className="grid grid-cols-3 gap-4">
            {renderMethodCard(data.historical, 'Historical VaR')}
            {renderMethodCard(data.parametric, 'Parametric VaR')}
            {renderMethodCard(data.monte_carlo, 'Monte Carlo VaR')}
          </div>
        </div>
      )}

      {!data && !loading && (
        <p className="text-gray-500 text-sm">Calculate Value at Risk using three methods: Historical, Parametric, and Monte Carlo simulation</p>
      )}
    </div>
  );
}
