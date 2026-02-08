'use client';

import { useState } from 'react';
import SentimentPanel from '@/components/SentimentPanel';
import Link from 'next/link';

export default function SentimentPage() {
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
          <h1 className="text-3xl font-bold">NLP Sentiment Pipeline</h1>
        </div>
        <p className="text-gray-400 mb-6">
          Phase 2: Alternative data pipeline using NLP sentiment extraction with Bayesian fair value updates.
          Analyzes news articles and IR data to generate alpha factors.
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

        <SentimentPanel ticker={ticker} />

        <div className="mt-6 bg-[#2D2D2D] rounded-lg p-4">
          <h3 className="font-bold text-[#FFD700] mb-2">How It Works</h3>
          <ul className="text-sm text-gray-300 space-y-1">
            <li>1. Scrapes Yahoo Finance news + SEC EDGAR filings for the ticker</li>
            <li>2. Extracts NLP features: Sentiment, Dilution Risk, Guidance Changes, Competitive Threats</li>
            <li>3. Runs Bayesian update: Posterior = Prior x (1 + sentiment x weight)</li>
            <li>4. Generates trading signal based on adjusted fair value vs market price</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
