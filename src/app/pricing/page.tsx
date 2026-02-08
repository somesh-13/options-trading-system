'use client';

import { useState } from 'react';
import PricingCalculator from '@/components/PricingCalculator';
import IVSolverToggle from '@/components/IVSolverToggle';
import HedgeStabilityWidget from '@/components/HedgeStabilityWidget';
import Link from 'next/link';

export default function PricingPage() {
  const [params] = useState({
    S: 15.50,
    K: 16,
    T: 0.0822,
    r: 0.05,
    sigma: 0.8,
    option_type: 'call' as const,
  });

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">Dashboard</Link>
            <span className="text-gray-600">/</span>
            <h1 className="text-4xl font-bold">Options Pricing Engine</h1>
          </div>
          <p className="text-gray-400">Black-Scholes Model with Real-Time Greeks</p>
          <Link href="/vol-surface" className="text-sm text-[#00C805] hover:underline mt-1 inline-block">
            View 3D Volatility Surface →
          </Link>
        </header>

        <PricingCalculator />

        {/* IV Solver Comparison */}
        <IVSolverToggle S={params.S} K={params.K} T={params.T} r={params.r} option_type={params.option_type} />

        {/* Hedge Stability */}
        <HedgeStabilityWidget params={params} />

        {/* Theory Section */}
        <div className="mt-12 bg-[#2D2D2D] rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">Black-Scholes Model</h3>
          <p className="text-gray-300 mb-4">
            The Black-Scholes model prices European options by assuming log-normal stock price
            distribution, constant volatility, and no transaction costs.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-bold mb-2 text-[#00C805]">First-Order Greeks:</h4>
              <ul className="space-y-1 text-gray-300 text-sm">
                <li><strong>Delta:</strong> Price sensitivity to underlying</li>
                <li><strong>Gamma:</strong> Rate of delta change</li>
                <li><strong>Vega:</strong> Sensitivity to volatility</li>
                <li><strong>Theta:</strong> Time decay per day</li>
                <li><strong>Rho:</strong> Rate sensitivity</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-2 text-[#FFD700]">Second-Order Greeks:</h4>
              <ul className="space-y-1 text-gray-300 text-sm">
                <li><strong>Vanna:</strong> Delta sensitivity to vol</li>
                <li><strong>Charm:</strong> Delta decay over time</li>
                <li><strong>Volga:</strong> Vega convexity</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
