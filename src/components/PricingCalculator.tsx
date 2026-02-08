'use client';

import { useState } from 'react';
import { calculatePriceAndGreeks, type OptionParams, type PricingResponse } from '@/lib/pricing-api';

export default function PricingCalculator() {
  const [params, setParams] = useState<OptionParams>({
    S: 15.50,
    K: 16,
    T: 0.0822,  // ~30 days
    r: 0.05,
    sigma: 0.8,
    option_type: 'call',
  });

  const [result, setResult] = useState<PricingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await calculatePriceAndGreeks(params);
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h2 className="text-2xl font-bold mb-6">Black-Scholes Pricing Calculator</h2>
      
      {/* Input Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-gray-400 mb-2">Spot Price (S)</label>
          <input
            type="number"
            step="0.01"
            value={params.S}
            onChange={(e) => setParams({ ...params, S: parseFloat(e.target.value) || 0 })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Strike Price (K)</label>
          <input
            type="number"
            step="0.01"
            value={params.K}
            onChange={(e) => setParams({ ...params, K: parseFloat(e.target.value) || 0 })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Time to Expiration (years)</label>
          <input
            type="number"
            step="0.001"
            value={params.T}
            onChange={(e) => setParams({ ...params, T: parseFloat(e.target.value) || 0 })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <p className="text-xs text-gray-500 mt-1">≈ {Math.round(params.T * 365)} days</p>
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Risk-Free Rate (r)</label>
          <input
            type="number"
            step="0.001"
            value={params.r}
            onChange={(e) => setParams({ ...params, r: parseFloat(e.target.value) || 0 })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <p className="text-xs text-gray-500 mt-1">{(params.r * 100).toFixed(1)}%</p>
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Volatility (σ)</label>
          <input
            type="number"
            step="0.01"
            value={params.sigma}
            onChange={(e) => setParams({ ...params, sigma: parseFloat(e.target.value) || 0 })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <p className="text-xs text-gray-500 mt-1">{(params.sigma * 100).toFixed(0)}%</p>
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Option Type</label>
          <select
            value={params.option_type}
            onChange={(e) => setParams({ ...params, option_type: e.target.value as 'call' | 'put' })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          >
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleCalculate}
        disabled={loading}
        className="w-full bg-[#00C805] hover:bg-[#00A004] text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Calculating...' : 'Calculate Price & Greeks'}
      </button>

      {error && (
        <div className="mt-4 bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          {/* Option Price */}
          <div className="bg-[#1E1E1E] rounded-lg p-6">
            <p className="text-sm text-gray-400 mb-2">Option Price</p>
            <p className="text-4xl font-bold text-[#00C805]">
              ${result.price.toFixed(4)}
            </p>
          </div>

          {/* First-Order Greeks */}
          <div className="bg-[#1E1E1E] rounded-lg p-6">
            <h3 className="text-lg font-bold mb-4">First-Order Greeks</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Delta (Δ)</p>
                <p className="text-xl font-bold">{result.greeks.delta.toFixed(4)}</p>
                <p className="text-xs text-gray-500 mt-1">$/share</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Gamma (Γ)</p>
                <p className="text-xl font-bold">{result.greeks.gamma.toFixed(4)}</p>
                <p className="text-xs text-gray-500 mt-1">Δ/share</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Vega (ν)</p>
                <p className="text-xl font-bold">{result.greeks.vega.toFixed(4)}</p>
                <p className="text-xs text-gray-500 mt-1">$/1%vol</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Theta (Θ)</p>
                <p className="text-xl font-bold">{result.greeks.theta.toFixed(4)}</p>
                <p className="text-xs text-gray-500 mt-1">$/day</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Rho (ρ)</p>
                <p className="text-xl font-bold">{result.greeks.rho.toFixed(4)}</p>
                <p className="text-xs text-gray-500 mt-1">$/1%rate</p>
              </div>
            </div>
          </div>

          {/* Second-Order Greeks */}
          {result.greeks.vanna !== undefined && (
            <div className="bg-[#1E1E1E] rounded-lg p-6">
              <h3 className="text-lg font-bold mb-4">Second-Order Greeks</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Vanna</p>
                  <p className="text-xl font-bold">{result.greeks.vanna.toFixed(6)}</p>
                  <p className="text-xs text-gray-500 mt-1">∂Δ/∂σ</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Charm</p>
                  <p className="text-xl font-bold">{result.greeks.charm?.toFixed(6) || '0'}</p>
                  <p className="text-xs text-gray-500 mt-1">∂Δ/∂t (per day)</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Volga</p>
                  <p className="text-xl font-bold">{result.greeks.volga?.toFixed(8) || '0'}</p>
                  <p className="text-xs text-gray-500 mt-1">∂ν/∂σ</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
