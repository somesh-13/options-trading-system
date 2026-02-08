'use client';

import { useState } from 'react';
import VaRPanel from '@/components/VaRPanel';
import Link from 'next/link';

export default function RiskManagementPage() {
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
          <h1 className="text-3xl font-bold">Risk Management</h1>
        </div>
        <p className="text-gray-400 mb-6">
          Phase 6: Multi-dimensional risk control with VaR (Historical, Parametric, Monte Carlo),
          position limits, and drawdown protection.
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

        <VaRPanel ticker={ticker} />

        <div className="mt-6 bg-[#2D2D2D] rounded-lg p-4">
          <h3 className="font-bold text-[#FFD700] mb-2">Risk Limits (SIG Standard)</h3>
          <div className="grid grid-cols-2 gap-4 text-sm text-gray-300">
            <ul className="space-y-1">
              <li>Max Portfolio Delta: +/- 10,000</li>
              <li>Max Single-Stock Delta: +/- 2,000</li>
              <li>Max Portfolio Gamma: +/- 500</li>
            </ul>
            <ul className="space-y-1">
              <li>Max Portfolio Vega: +/- 10,000</li>
              <li>Max Position Size: 10% of NAV</li>
              <li>Max Drawdown Trigger: 10%</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
