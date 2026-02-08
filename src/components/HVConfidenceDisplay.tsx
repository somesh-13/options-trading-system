'use client';

import { useState, useEffect } from 'react';
import { getHVConfidence, type HVConfidenceData } from '@/lib/pricing-api';

interface HVConfidenceDisplayProps {
  ticker: string;
}

export default function HVConfidenceDisplay({ ticker }: HVConfidenceDisplayProps) {
  const [data, setData] = useState<HVConfidenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getHVConfidence(ticker);
        setData(result);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-[#1E1E1E] rounded-lg p-4 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-2/3 mb-2"></div>
        <div className="h-4 bg-gray-700 rounded w-1/2"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#1E1E1E] rounded-lg p-4">
        <p className="text-sm text-[#FF006E]">HV data unavailable</p>
      </div>
    );
  }

  const barWidth = data.ci_upper > 0 ? ((data.hv / data.ci_upper) * 100) : 50;
  const ciLowerPct = data.ci_upper > 0 ? ((data.ci_lower / data.ci_upper) * 100) : 0;

  return (
    <div className="bg-[#1E1E1E] rounded-lg p-4">
      <h4 className="text-sm font-bold text-gray-400 mb-2">HV Confidence ({data.window}-day)</h4>
      <p className="text-2xl font-bold mb-1">
        {(data.hv * 100).toFixed(1)}%
      </p>
      <p className="text-sm text-gray-400 mb-3">
        95% CI: {(data.ci_lower * 100).toFixed(1)}% - {(data.ci_upper * 100).toFixed(1)}%
      </p>

      {/* Visual confidence bar */}
      <div className="relative h-3 bg-gray-700 rounded-full mb-3">
        <div
          className="absolute h-full bg-[#FFD700] bg-opacity-30 rounded-full"
          style={{ left: `${ciLowerPct}%`, width: `${barWidth - ciLowerPct}%` }}
        ></div>
        <div
          className="absolute h-full w-1 bg-[#00C805] rounded-full"
          style={{ left: `${barWidth}%` }}
        ></div>
      </div>

      <div className="flex justify-between text-xs text-gray-500">
        <span>Parkinson HV: {(data.parkinson_hv * 100).toFixed(1)}%</span>
        <span className={data.reliable ? 'text-[#00C805]' : 'text-[#FF006E]'}>
          {data.reliable ? 'Reliable signal' : 'Wide CI - unreliable'}
        </span>
      </div>
    </div>
  );
}
