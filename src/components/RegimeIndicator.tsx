'use client';

import { useState, useEffect } from 'react';
import { getRegime, type RegimeData } from '@/lib/pricing-api';

interface RegimeIndicatorProps {
  ticker: string;
}

export default function RegimeIndicator({ ticker }: RegimeIndicatorProps) {
  const [data, setData] = useState<RegimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRegime = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getRegime(ticker);
        setData(result);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    };
    fetchRegime();
  }, [ticker]);

  if (loading) {
    return <span className="px-3 py-1 bg-gray-700 rounded-full text-sm animate-pulse">Loading regime...</span>;
  }

  if (error || !data) {
    return <span className="px-3 py-1 bg-gray-700 rounded-full text-sm text-gray-400">Regime unavailable</span>;
  }

  const regimeColors: Record<string, string> = {
    'Low Vol': 'bg-[#00C805] text-white',
    'Medium Vol': 'bg-[#FFD700] text-black',
    'High Vol': 'bg-[#FF006E] text-white',
  };

  const colorClass = regimeColors[data.regime] || 'bg-gray-600 text-white';

  return (
    <div className="inline-flex items-center gap-2">
      <span className={`px-3 py-1 rounded-full text-sm font-bold ${colorClass}`}>
        {data.regime}
      </span>
      <span className="text-sm text-gray-400">
        {(data.probability * 100).toFixed(0)}% confident
      </span>
    </div>
  );
}
