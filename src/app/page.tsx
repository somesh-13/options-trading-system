'use client';

import { useState } from 'react';
import MispricingDetector from '@/components/MispricingDetector';
import Link from 'next/link';

function NavGroup({ title, icon, defaultOpen = false, children }: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-4 py-2.5 bg-[#252525] hover:bg-[#2D2D2D] rounded-lg text-sm font-semibold text-gray-300 transition-colors"
      >
        <span className="text-base">{icon}</span>
        <span className="flex-1">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${open ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-wrap gap-2 pl-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

const navLinkClass = "px-4 py-2 bg-[#2D2D2D] hover:bg-[#383838] rounded-md text-sm transition-colors";

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

        {/* Primary Actions */}
        <div className="flex gap-4 mb-6">
          <Link
            href="/options-chain"
            className="px-6 py-3 bg-[#2D2D2D] hover:bg-[#383838] rounded-lg border border-[#FFD700]/40 font-semibold transition-colors flex items-center gap-2"
          >
            <span>⛓</span> Option Chain
          </Link>
          <Link
            href="/agent"
            className="px-6 py-3 bg-[#2D2D2D] hover:bg-[#383838] rounded-lg border border-[#00C805]/50 font-semibold transition-colors flex items-center gap-2"
          >
            <span>🤖</span> VegaEdge Live Agent
          </Link>
        </div>

        {/* Collapsible Navigation Groups */}
        <div className="mb-8 space-y-2">
          <NavGroup title="Analytics" icon="📊" defaultOpen>
            <Link href="/pricing" className={navLinkClass}>Pricing Calculator</Link>
            <Link href="/vol-surface" className={navLinkClass}>Vol Surface</Link>
            <Link href="/scanner" className={navLinkClass}>Scanner</Link>
          </NavGroup>

          <NavGroup title="Strategy & Backtesting" icon="🎯">
            <Link href="/strategy" className={navLinkClass}>Strategy & Hedging</Link>
            <Link href="/backtest" className={navLinkClass}>Backtesting</Link>
            <Link href="/sentiment" className={navLinkClass}>NLP Sentiment</Link>
          </NavGroup>

          <NavGroup title="Risk" icon="🛡️">
            <Link href="/risk" className={navLinkClass}>Risk & P&L</Link>
            <Link href="/risk-mgmt" className={navLinkClass}>Risk Management</Link>
          </NavGroup>

          <NavGroup title="Trading & Execution" icon="⚡">
            <Link href="/execution" className={navLinkClass}>Live Trading</Link>
            <Link href="/auto-engine" className={navLinkClass}>Auto Engine</Link>
            <Link href="/positions" className={navLinkClass}>Positions</Link>
            <Link href="/portfolio" className={navLinkClass}>Portfolio Monitor</Link>
          </NavGroup>

          <NavGroup title="Tools" icon="🔧">
            <Link href="/journal" className={navLinkClass}>Trade Journal</Link>
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noopener noreferrer"
              className={navLinkClass}
            >
              API Docs ↗
            </a>
          </NavGroup>
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
      </div>
    </main>
  );
}
