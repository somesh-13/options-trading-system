'use client';

import { useState } from 'react';
import { compareIVSolvers, type IVCompareResult } from '@/lib/pricing-api';

interface IVSolverToggleProps {
  S: number;
  K: number;
  T: number;
  r: number;
  option_type: 'call' | 'put';
}

export default function IVSolverToggle({ S, K, T, r, option_type }: IVSolverToggleProps) {
  const [marketPrice, setMarketPrice] = useState<number>(0);
  const [result, setResult] = useState<IVCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = async () => {
    if (marketPrice <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const data = await compareIVSolvers(marketPrice, S, K, T, r, option_type);
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6 mt-6">
      <h3 className="text-xl font-bold mb-4">IV Solver Comparison</h3>
      <p className="text-sm text-gray-400 mb-4">Compare Newton-Raphson vs Bisection convergence</p>

      <div className="flex gap-4 mb-4">
        <div className="flex-1">
          <label className="block text-sm text-gray-400 mb-2">Market Price</label>
          <input
            type="number"
            step="0.01"
            value={marketPrice || ''}
            onChange={(e) => setMarketPrice(parseFloat(e.target.value) || 0)}
            placeholder="Enter observed option price"
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={handleCompare}
            disabled={loading || marketPrice <= 0}
            className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Solving...' : 'Compare Solvers'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Newton-Raphson */}
          <div className="bg-[#1E1E1E] rounded-lg p-4">
            <h4 className="font-bold text-[#00C805] mb-3">Newton-Raphson</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">IV:</span>
                <span className="font-bold">
                  {result.newton_raphson.converged && result.newton_raphson.iv
                    ? `${(result.newton_raphson.iv * 100).toFixed(2)}%`
                    : 'Did not converge'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Iterations:</span>
                <span className="font-bold">{result.newton_raphson.iterations ?? 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Time:</span>
                <span className="font-bold">{result.newton_raphson.time_ms.toFixed(3)}ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span className={result.newton_raphson.converged ? 'text-[#00C805]' : 'text-[#FF006E]'}>
                  {result.newton_raphson.converged ? 'Converged' : 'Failed'}
                </span>
              </div>
            </div>
          </div>

          {/* Bisection */}
          <div className="bg-[#1E1E1E] rounded-lg p-4">
            <h4 className="font-bold text-[#FFD700] mb-3">Bisection</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">IV:</span>
                <span className="font-bold">
                  {result.bisection.converged && result.bisection.iv
                    ? `${(result.bisection.iv * 100).toFixed(2)}%`
                    : 'Did not converge'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Iterations:</span>
                <span className="font-bold">{result.bisection.iterations ?? 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Time:</span>
                <span className="font-bold">{result.bisection.time_ms.toFixed(3)}ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span className={result.bisection.converged ? 'text-[#00C805]' : 'text-[#FF006E]'}>
                  {result.bisection.converged ? 'Converged' : 'Failed'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
