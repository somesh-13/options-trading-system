'use client';

import EVCalculator from '@/components/EVCalculator';
import HedgingPanel from '@/components/HedgingPanel';

export default function StrategyPage() {
  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="rv-h1">Strategy & Hedging</h2>
        <div className="rv-sub">
          Phase 5: Expected Value calculator and Dynamic Delta-Gamma hedging engine.
          Only execute trades with positive EV above threshold, maintain market-neutral portfolio.
        </div>

        <div className="space-y-4 sm:space-y-6">
          <EVCalculator />
          <HedgingPanel />
        </div>
      </div>
    </main>
  );
}
