'use client';

import { useEffect, useState } from 'react';
import { getMispricing, type MispricingData } from '@/lib/pricing-api';
import HVConfidenceDisplay from '@/components/HVConfidenceDisplay';
import RegimeIndicator from '@/components/RegimeIndicator';

interface MispricingDetectorProps {
  ticker: string;
}

export default function MispricingDetector({ ticker }: MispricingDetectorProps) {
  const [data, setData] = useState<MispricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = async () => {
    try {
      setError(null);
      setLoading(true);
      const mispricingData = await getMispricing(ticker);
      setData(mispricingData);
      setLastUpdate(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [ticker]);

  if (loading && !data) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6 animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          <div className="h-4 bg-gray-700 rounded"></div>
          <div className="h-4 bg-gray-700 rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6">
        <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg">
          Error loading {ticker} data: {error}
        </div>
        <button onClick={fetchData} className="mt-4 px-4 py-2 bg-[#00C805] hover:bg-[#00A004] text-white rounded-lg transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const signalColor: Record<string, string> = {
    'SELL': 'bg-[#FFD700] text-black',
    'BUY': 'bg-[#00C805] text-white',
    'NEUTRAL': 'bg-gray-600 text-white'
  };

  const isOpportunity = data.iv_hv_ratio > 1.3;

  return (
    <div className={`rounded-lg p-6 border-2 ${isOpportunity ? 'bg-[#2D2D2D] border-[#00C805]' : 'bg-[#2D2D2D] border-gray-700'}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-3xl font-bold mb-1">{ticker} Mispricing Detector</h2>
          <p className="text-sm text-gray-400">Last updated: {lastUpdate.toLocaleTimeString()}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`px-4 py-2 rounded-full font-bold ${signalColor[data.signal] || 'bg-gray-600 text-white'}`}>
            {data.signal}
          </span>
          <RegimeIndicator ticker={ticker} />
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Spot Price</p>
          <p className="text-2xl font-bold">${data.spot_price.toFixed(2)}</p>
        </div>
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Historical Vol</p>
          <p className="text-2xl font-bold">{(data.historical_vol * 100).toFixed(1)}%</p>
          <p className="text-xs text-gray-500 mt-1">30-day realized</p>
        </div>
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Implied Vol (ATM)</p>
          <p className="text-2xl font-bold">{(data.implied_vol_atm * 100).toFixed(1)}%</p>
          <p className="text-xs text-gray-500 mt-1">Market pricing</p>
        </div>
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">IV/HV Ratio</p>
          <p className={`text-2xl font-bold ${isOpportunity ? 'text-[#00C805]' : 'text-white'}`}>
            {data.iv_hv_ratio.toFixed(2)}x
          </p>
        </div>
      </div>

      {/* HV Confidence */}
      <div className="mb-6">
        <HVConfidenceDisplay ticker={ticker} />
      </div>

      {/* ATM Call Details */}
      <div className="bg-[#1E1E1E] rounded-lg p-6 mb-6">
        <h3 className="text-lg font-bold mb-4">ATM Call Option</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-400">Strike</p>
            <p className="text-xl font-bold">${data.atm_strike}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Mid Price</p>
            <p className="text-xl font-bold">${data.atm_call_price.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Bid/Ask</p>
            <p className="text-xl font-bold">${data.bid.toFixed(2)} / ${data.ask.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400">Expiration</p>
            <p className="text-xl font-bold">{new Date(data.expiration).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* Volume & OI */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-sm text-gray-400 mb-1">Volume</p>
          <p className="text-2xl font-bold">{data.volume.toLocaleString()}</p>
        </div>
        <div className="bg-[#1E1E1E] rounded-lg p-4">
          <p className="text-sm text-gray-400 mb-1">Open Interest</p>
          <p className="text-2xl font-bold">{data.open_interest.toLocaleString()}</p>
        </div>
      </div>

      {isOpportunity && (
        <div className="bg-[#00C805] bg-opacity-10 border border-[#00C805] rounded-lg p-4">
          <h4 className="font-bold text-[#00C805] mb-2">Trading Opportunity Detected</h4>
          <p className="text-sm text-gray-300">
            IV is {((data.iv_hv_ratio - 1) * 100).toFixed(0)}% above HV. Consider selling options to capture vol premium.
          </p>
        </div>
      )}

      <button onClick={fetchData} className="mt-4 w-full px-4 py-2 bg-[#1E1E1E] hover:bg-[#333333] text-gray-300 rounded-lg transition-colors text-sm">
        Refresh Data
      </button>
    </div>
  );
}
