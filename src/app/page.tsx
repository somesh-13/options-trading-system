'use client';

import { useState } from 'react';
import MispricingDetector from '@/components/MispricingDetector';
import Link from 'next/link';

export default function Dashboard() {
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
          <h1 className="text-4xl font-bold mb-2">Options Trading Dashboard</h1>
          <p className="text-gray-400">Quantitative Volatility Arbitrage System</p>
        </header>

        {/* Navigation */}
        <div className="flex flex-wrap gap-3 mb-8">
          <Link href="/pricing" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors">
            Pricing Calculator
          </Link>
          <Link href="/vol-surface" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors">
            Vol Surface
          </Link>
          <Link href="/risk" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors">
            Risk & P&L
          </Link>
          <Link href="/scanner" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors">
            Scanner
          </Link>
          <Link href="/sentiment" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#00C805]/30">
            NLP Sentiment
          </Link>
          <Link href="/backtest" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#FFD700]/30">
            Backtesting
          </Link>
          <Link href="/strategy" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#FFD700]/30">
            Strategy & Hedging
          </Link>
          <Link href="/risk-mgmt" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#FF006E]/30">
            Risk Management
          </Link>
          <Link href="/portfolio" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#00C805]/30">
            Portfolio Monitor
          </Link>
          <Link href="/execution" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#FF006E]/30">
            Live Trading
          </Link>
          <Link href="/journal" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#00C805]/30">
            Trade Journal
          </Link>
          <Link href="/auto-engine" className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors border border-[#FF006E]/30">
            Auto Engine
          </Link>
          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-3 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg transition-colors"
          >
            API Docs
          </a>
        </div>

        {/* Ticker Selector */}
        <form onSubmit={handleTickerChange} className="flex gap-3 mb-8">
          <input
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            placeholder="Enter ticker symbol"
            className="w-32 bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors"
          >
            Analyze
          </button>
        </form>

        {/* Main Detector */}
        <MispricingDetector ticker={ticker} />

        {/* System Overview */}
        <div className="mt-8 bg-[#2D2D2D] rounded-lg p-6">
          <h2 className="text-2xl font-bold mb-4">System Architecture</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <h3 className="font-bold text-[#00C805] mb-2">Pricing Engine (Phase 1)</h3>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>Black-Scholes pricing</li>
                <li>8 Greeks (incl. Vanna/Charm/Volga)</li>
                <li>IV solver (NR + Bisection)</li>
                <li>HMM Regime Detection</li>
                <li>Vol Surface Generation</li>
                <li>Stress Testing & P&L Attribution</li>
              </ul>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <h3 className="font-bold text-[#FFD700] mb-2">Strategy (Phase 2-5)</h3>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>NLP Sentiment Pipeline (Bayesian)</li>
                <li>Expected Value Calculator</li>
                <li>Dynamic Delta-Gamma Hedging</li>
                <li>Regime-aware Backtesting</li>
                <li>Transaction Cost Analysis</li>
                <li>EV Opportunity Scanner</li>
              </ul>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <h3 className="font-bold text-[#FF006E] mb-2">Risk & Execution (Phase 6-7)</h3>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>VaR (Historical/Parametric/MC)</li>
                <li>Position Limits & Drawdown</li>
                <li>Portfolio Greeks Aggregation</li>
                <li>Alpaca Paper Trading</li>
                <li>Order Execution Engine</li>
                <li>P&L Tracking</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
