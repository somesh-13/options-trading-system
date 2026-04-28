'use client';

import { useEffect, useState } from 'react';
import { getSignalWinRate, type WinRateResponse } from '@/lib/pricing-api';

interface BucketRow {
  key: 'low' | 'mid' | 'high';
  label: string;
  expected: string;
  color: string;
  tone: string;
}

const BUCKETS: BucketRow[] = [
  { key: 'low', label: '< 0.50', expected: '~45% (noise)', color: 'text-[#FF006E]', tone: 'No edge' },
  { key: 'mid', label: '0.50 – 0.65', expected: '~55% (marginal)', color: 'text-[#FFD700]', tone: 'Weak signal' },
  { key: 'high', label: '≥ 0.65', expected: '~70% (target)', color: 'text-[#00C805]', tone: 'Trade signal' },
];

export default function SignalAccuracyCard() {
  const [data, setData] = useState<WinRateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await getSignalWinRate(0.65);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load win rate');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Signal Accuracy</h3>
        {data && (
          <span className="text-xs text-gray-400">
            {data.resolved} resolved · threshold {data.min_confluence.toFixed(2)}
          </span>
        )}
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {error && <p className="text-[#FF006E] text-sm">{error}</p>}

      {data && (
        <div className="space-y-3">
          {BUCKETS.map((b) => {
            const row = data.buckets[b.key];
            const rate = row?.win_rate;
            const total = row?.total ?? 0;
            const resolved = row?.resolved ?? 0;
            return (
              <div key={b.key} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-gray-300 font-medium">{b.label}</p>
                  <p className="text-gray-500 text-xs">{b.expected}</p>
                </div>
                <div className="text-right">
                  <p className={`text-base font-semibold ${b.color}`}>
                    {rate != null ? `${(rate * 100).toFixed(1)}%` : '—'}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {resolved}/{total} resolved
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
