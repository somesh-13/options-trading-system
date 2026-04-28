'use client';

import { useState } from 'react';
import GreeksPnLChart from '@/components/GreeksPnLChart';
import TCAMonitor from '@/components/TCAMonitor';
import StressTestPanel from '@/components/StressTestPanel';

export default function RiskPage() {
  const [ticker, setTicker] = useState('CIFR');
  const [inputTicker, setInputTicker] = useState('CIFR');

  const handleTickerChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputTicker.trim()) {
      setTicker(inputTicker.trim().toUpperCase());
    }
  };

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 sm:mb-8">
          <h2 className="rv-h1">Risk & P&L Analysis</h2>
          <div className="rv-sub">Greeks attribution, stress testing, and transaction cost analysis</div>
        </header>

        {/* Ticker selector */}
        <form onSubmit={handleTickerChange} className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-6 sm:mb-8">
          <input
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            className="w-full sm:w-40 bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <button type="submit" className="w-full sm:w-auto px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors">
            Update
          </button>
        </form>

        <div className="space-y-6 sm:space-y-8">
          {/* P&L Attribution */}
          <GreeksPnLChart S={15.50} K={16} T={0.0822} r={0.05} sigma={0.8} option_type="call" qty={10} />

          {/* TCA */}
          <TCAMonitor ticker={ticker} />

          {/* Stress Testing */}
          <StressTestPanel />
        </div>
      </div>
    </main>
  );
}
