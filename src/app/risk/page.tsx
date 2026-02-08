'use client';

import { useState } from 'react';
import GreeksPnLChart from '@/components/GreeksPnLChart';
import TCAMonitor from '@/components/TCAMonitor';
import StressTestPanel from '@/components/StressTestPanel';
import Link from 'next/link';

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
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">Dashboard</Link>
            <span className="text-gray-600">/</span>
            <h1 className="text-4xl font-bold">Risk & P&L Analysis</h1>
          </div>
          <p className="text-gray-400">Greeks attribution, stress testing, and transaction cost analysis</p>
        </header>

        {/* Ticker selector */}
        <form onSubmit={handleTickerChange} className="flex gap-3 mb-8">
          <input
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            className="w-32 bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <button type="submit" className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors">
            Update
          </button>
        </form>

        <div className="space-y-8">
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
