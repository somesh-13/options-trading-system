'use client';

import { useState, useEffect } from 'react';
import { getTCA, type TCAData } from '@/lib/pricing-api';

interface TCAMonitorProps {
  ticker: string;
}

export default function TCAMonitor({ ticker }: TCAMonitorProps) {
  const [data, setData] = useState<TCAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTCA = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getTCA(ticker);
        setData(result);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    };
    fetchTCA();
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6 animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="h-32 bg-gray-700 rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6">
        <h3 className="text-xl font-bold mb-2">Transaction Cost Analysis</h3>
        <p className="text-sm text-[#FF006E]">TCA data unavailable for {ticker}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-xl font-bold mb-4">Transaction Cost Analysis — {ticker}</h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Bid/Ask</p>
          <p className="text-xl font-bold">${data.bid.toFixed(2)} / ${data.ask.toFixed(2)}</p>
        </div>
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Spread</p>
          <p className="text-xl font-bold">${data.spread.toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-1">{data.spread_pct.toFixed(1)}% of mid</p>
        </div>
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Slippage Est.</p>
          <p className="text-xl font-bold">${data.slippage_estimate.toFixed(2)}</p>
        </div>
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">TCA / Contract</p>
          <p className="text-xl font-bold">${data.tca_per_contract.toFixed(2)}</p>
        </div>
      </div>

      {/* Edge vs Cost */}
      <div className={`rounded-lg p-4 border ${data.edge_survives_tca ? 'bg-[#00C805] bg-opacity-10 border-[#00C805]' : 'bg-[#FF006E] bg-opacity-10 border-[#FF006E]'}`}>
        <div className="flex justify-between items-center">
          <div>
            <p className="font-bold mb-1">
              {data.edge_survives_tca ? 'Edge Survives Transaction Costs' : 'Edge Does NOT Survive Costs'}
            </p>
            <p className="text-sm text-gray-300">
              IV/HV edge: ${data.edge_dollars.toFixed(2)} vs TCA: ${data.tca_per_contract.toFixed(2)} per contract
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">IV: {(data.iv * 100).toFixed(1)}%</p>
            <p className="text-xs text-gray-400">HV: {(data.hv * 100).toFixed(1)}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}
