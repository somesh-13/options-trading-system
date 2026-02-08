'use client';

import { useState } from 'react';
import BacktestPanel from '@/components/BacktestPanel';
import Link from 'next/link';

export default function BacktestPage() {
  const [ticker, setTicker] = useState('CIFR');
  const [inputTicker, setInputTicker] = useState('CIFR');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputTicker.trim()) setTicker(inputTicker.trim().toUpperCase());
  };

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-gray-400 hover:text-white">&larr; Dashboard</Link>
          <h1 className="text-3xl font-bold">Backtesting Framework</h1>
        </div>
        <p className="text-gray-400 mb-6">
          Phase 3: Regime-aware walk-forward backtesting with bias mitigation.
          Tests volatility arbitrage strategy on historical data with comprehensive performance metrics.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-3 mb-6">
          <input type="text" value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            className="w-32 bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]" />
          <button type="submit"
            className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg">
            Set Ticker
          </button>
        </form>

        <BacktestPanel ticker={ticker} />
      </div>
    </main>
  );
}
