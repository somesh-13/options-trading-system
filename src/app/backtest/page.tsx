'use client';

import { useState } from 'react';
import BacktestPanel from '@/components/BacktestPanel';
import MultiBacktestPanel from '@/components/MultiBacktestPanel';
import WheelResultsTable from '@/components/WheelResultsTable';

export default function BacktestPage() {
  const [mode, setMode] = useState<'single' | 'comparison' | 'wheel'>('comparison');
  const [ticker, setTicker] = useState('CIFR');
  const [inputTicker, setInputTicker] = useState('CIFR');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputTicker.trim()) setTicker(inputTicker.trim().toUpperCase());
  };

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="rv-h1">Backtesting Framework</h2>
        <div className="rv-sub">
          Regime-aware walk-forward backtesting with bias mitigation.
          Tests volatility arbitrage strategies on historical data with comprehensive performance metrics.
        </div>

        {/* Mode toggle */}
        <div className="flex flex-wrap gap-2 mb-4 sm:mb-6">
          <button onClick={() => setMode('comparison')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              mode === 'comparison'
                ? 'bg-[#00C805] text-white'
                : 'bg-[#2D2D2D] text-gray-400 hover:text-white'
            }`}>
            Multi-Strategy Comparison
          </button>
          <button onClick={() => setMode('single')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              mode === 'single'
                ? 'bg-[#00C805] text-white'
                : 'bg-[#2D2D2D] text-gray-400 hover:text-white'
            }`}>
            Single Strategy
          </button>
          <button onClick={() => setMode('wheel')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              mode === 'wheel'
                ? 'bg-[#00C805] text-white'
                : 'bg-[#2D2D2D] text-gray-400 hover:text-white'
            }`}>
            Wheel (CSP + CC)
          </button>
        </div>

        {mode === 'comparison' ? (
          <MultiBacktestPanel />
        ) : mode === 'wheel' ? (
          <WheelResultsTable />
        ) : (
          <>
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:mb-6">
              <input type="text" value={inputTicker}
                onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
                className="w-full sm:w-40 bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]" />
              <button type="submit"
                className="w-full sm:w-auto px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg">
                Set Ticker
              </button>
            </form>
            <BacktestPanel ticker={ticker} />
          </>
        )}
      </div>
    </main>
  );
}
