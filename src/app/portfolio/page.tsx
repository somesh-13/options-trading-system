'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePolling } from '@/hooks/usePolling';
import { useAlerts } from '@/hooks/useAlerts';
import {
  getPortfolioSummary,
  getPositionsWithGreeks,
  getEquityHistory,
  getMarketStatus,
  type PortfolioSummaryResponse,
  type PositionsGreeksResponse,
  type EquityHistoryResponse,
  type MarketStatus,
} from '@/lib/pricing-api';

import PortfolioHealthCard from '@/components/portfolio/PortfolioHealthCard';
import GreeksSummaryPanel from '@/components/portfolio/GreeksSummaryPanel';
import EquityChart from '@/components/portfolio/EquityChart';
import LivePositionsTable from '@/components/portfolio/LivePositionsTable';
import RecentTradesPanel from '@/components/portfolio/RecentTradesPanel';
import AlertSettings from '@/components/portfolio/AlertSettings';
import Toast from '@/components/portfolio/Toast';

const INTERVAL_KEY = 'portfolio-refresh-interval';
const INTERVALS = [
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
  { label: 'Off', value: 0 },
];

function loadInterval(): number {
  if (typeof window === 'undefined') return 30000;
  try {
    const stored = localStorage.getItem(INTERVAL_KEY);
    if (stored) return parseInt(stored);
  } catch {}
  return 30000;
}

const MARKET_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-[#00C805]/20', text: 'text-[#00C805]', label: 'OPEN' },
  extended: { bg: 'bg-[#FFD700]/20', text: 'text-[#FFD700]', label: 'EXTENDED' },
  closed: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'CLOSED' },
};

export default function PortfolioPage() {
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [equityPeriod, setEquityPeriod] = useState('1M');

  useEffect(() => {
    setRefreshInterval(loadInterval());
  }, []);

  const handleIntervalChange = (val: number) => {
    setRefreshInterval(val);
    localStorage.setItem(INTERVAL_KEY, String(val));
  };

  const fetchEquity = useCallback(
    () => getEquityHistory(equityPeriod, equityPeriod === '1D' ? '5Min' : '1D'),
    [equityPeriod]
  );

  const summary = usePolling<PortfolioSummaryResponse>(getPortfolioSummary, {
    interval: refreshInterval,
  });

  const positions = usePolling<PositionsGreeksResponse>(getPositionsWithGreeks, {
    interval: refreshInterval,
  });

  const equity = usePolling<EquityHistoryResponse>(fetchEquity, {
    interval: refreshInterval > 0 ? Math.max(refreshInterval, 60000) : 0,
  });

  const marketStatus = usePolling<MarketStatus>(getMarketStatus, {
    interval: 60000,
  });

  const { alerts, config, updateConfig, dismissAlert } = useAlerts(
    summary.data,
    positions.data?.positions ?? null
  );

  const handleRefreshAll = () => {
    summary.refetch();
    positions.refetch();
    equity.refetch();
    marketStatus.refetch();
  };

  const lastUpdated = summary.lastUpdated || positions.lastUpdated;
  const isConnected = !summary.error && !positions.error && (summary.data !== null || positions.data !== null);

  const msStyle = MARKET_STATUS_STYLES[marketStatus.data?.status || 'closed'];

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">
              &larr;
            </Link>
            <h1 className="text-3xl font-bold">Portfolio Monitor</h1>
            <span className="text-xs px-2 py-1 bg-[#FFD700]/20 text-[#FFD700] rounded font-medium">
              PAPER
            </span>
            {marketStatus.data && (
              <span className={`text-xs px-2 py-1 ${msStyle.bg} ${msStyle.text} rounded font-medium`}>
                {msStyle.label}
                <span className="ml-1 opacity-70">{marketStatus.data.current_time_et}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Refresh Interval Selector */}
            <div className="flex items-center gap-1 bg-[#2D2D2D] rounded-lg p-1">
              {INTERVALS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleIntervalChange(opt.value)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    refreshInterval === opt.value
                      ? 'bg-[#00C805] text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleRefreshAll}
              className="px-4 py-2 bg-[#2D2D2D] hover:bg-[#333333] rounded-lg text-sm transition-colors"
            >
              Refresh All
            </button>

            {lastUpdated && (
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    isConnected ? 'bg-[#00C805]' : 'bg-[#FF006E]'
                  }`}
                />
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* Error banners */}
        {summary.error && (
          <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg mb-4">
            Summary: {summary.error}
          </div>
        )}
        {positions.error && (
          <div className="bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg mb-4">
            Positions: {positions.error}
          </div>
        )}

        {/* Portfolio Health */}
        <PortfolioHealthCard data={summary.data} loading={summary.loading} />

        {/* Greeks Summary */}
        <GreeksSummaryPanel
          greeks={summary.data?.portfolio_greeks || positions.data?.portfolio_greeks || null}
        />

        {/* Equity Chart */}
        <EquityChart
          data={equity.data}
          period={equityPeriod}
          onPeriodChange={setEquityPeriod}
          loading={equity.loading}
        />

        {/* Positions Table */}
        <LivePositionsTable
          positions={positions.data?.positions || null}
          portfolioGreeks={positions.data?.portfolio_greeks || null}
          loading={positions.loading}
        />

        {/* Recent Trades */}
        <RecentTradesPanel refreshInterval={refreshInterval} />

        {/* Alert Settings */}
        <AlertSettings config={config} onUpdate={updateConfig} />

        {/* Toast notifications */}
        <Toast alerts={alerts} onDismiss={dismissAlert} />
      </div>
    </main>
  );
}
