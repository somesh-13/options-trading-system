'use client';

import EVCalculator from '@/components/EVCalculator';
import HedgingPanel from '@/components/HedgingPanel';
import Link from 'next/link';

export default function StrategyPage() {
  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-gray-400 hover:text-white">&larr; Dashboard</Link>
          <h1 className="text-3xl font-bold">Strategy & Hedging</h1>
        </div>
        <p className="text-gray-400 mb-6">
          Phase 5: Expected Value calculator and Dynamic Delta-Gamma hedging engine.
          Only execute trades with positive EV above threshold, maintain market-neutral portfolio.
        </p>

        <div className="space-y-6">
          <EVCalculator />
          <HedgingPanel />
        </div>
      </div>
    </main>
  );
}
