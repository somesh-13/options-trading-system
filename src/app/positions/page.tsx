'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getPortfolioSummary,
  getPositionsWithGreeks,
  getPriceHistory,
  getMispricing,
  PriceHistoryPoint,
  PositionWithGreeks,
  PortfolioGreeks,
} from '@/lib/pricing-api';
import TickerHeader from '@/components/positions/TickerHeader';
import PriceChart from '@/components/positions/PriceChart';
import MarketValueCards from '@/components/positions/MarketValueCards';
import OptionPositionsList from '@/components/positions/OptionPositionsList';
import TradeSidebar from '@/components/positions/TradeSidebar';

export default function PositionsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#1E1E1E] text-white p-6"><div className="text-gray-400">Loading...</div></div>}>
      <PositionsInner />
    </Suspense>
  );
}

function PositionsInner() {
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get('ticker') || 'CIFR';

  const [ticker, setTicker] = useState(initialTicker);
  const [inputTicker, setInputTicker] = useState(initialTicker);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Data state
  const [spotPrice, setSpotPrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [priceChangePct, setPriceChangePct] = useState(0);
  const [chartData, setChartData] = useState<PriceHistoryPoint[]>([]);
  const [period, setPeriod] = useState('1M');
  const [positions, setPositions] = useState<PositionWithGreeks[]>([]);
  const [portfolioGreeks, setPortfolioGreeks] = useState<PortfolioGreeks | null>(null);
  const [buyingPower, setBuyingPower] = useState(0);
  const [equity, setEquity] = useState(0);
  const [portfolioValue, setPortfolioValue] = useState(0);

  // Derived position data for the selected ticker
  const tickerPositions = positions.filter((p) => {
    const sym = p.symbol.toUpperCase();
    return sym === ticker || sym.startsWith(ticker);
  });

  const stockPos = tickerPositions.find((p) => p.position_type === 'stock');
  const shares = stockPos ? parseInt(stockPos.qty || '0') : 0;
  const avgCost = stockPos ? parseFloat(stockPos.avg_entry_price || '0') : 0;
  const marketValue = stockPos ? parseFloat(stockPos.market_value || '0') : shares * spotPrice;
  const totalReturn = stockPos ? parseFloat(stockPos.unrealized_pl || '0') : 0;
  const totalReturnPct = stockPos ? parseFloat(stockPos.unrealized_plpc || '0') * 100 : 0;
  const todayReturn = priceChange * shares;
  const todayReturnPct = priceChangePct;

  const loadPriceHistory = useCallback(async (t: string, p: string) => {
    try {
      const history = await getPriceHistory(t, p);
      setChartData(history.data);
      if (history.data.length >= 2) {
        const first = history.data[0].close;
        const last = history.data[history.data.length - 1].close;
        setPriceChange(last - first);
        setPriceChangePct(first > 0 ? ((last - first) / first) * 100 : 0);
      }
    } catch {
      setChartData([]);
    }
  }, []);

  const loadData = useCallback(async (t: string) => {
    setLoading(true);
    setError('');
    try {
      const [summaryResp, positionsResp, mispricingResp] = await Promise.allSettled([
        getPortfolioSummary(),
        getPositionsWithGreeks(),
        getMispricing(t),
      ]);

      if (summaryResp.status === 'fulfilled') {
        const summary = summaryResp.value;
        setBuyingPower(parseFloat(summary.account?.buying_power || '0'));
        setEquity(parseFloat(summary.account?.equity || '0'));
        setPortfolioValue(parseFloat(summary.account?.portfolio_value || '0'));
        setPortfolioGreeks(summary.portfolio_greeks);
      }

      if (positionsResp.status === 'fulfilled') {
        setPositions(positionsResp.value.positions);
      }

      if (mispricingResp.status === 'fulfilled') {
        setSpotPrice(mispricingResp.value.spot_price);
      }

      await loadPriceHistory(t, period);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [period, loadPriceHistory]);

  useEffect(() => {
    loadData(ticker);
  }, [ticker, loadData]);

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    loadPriceHistory(ticker, p);
  };

  const handleTickerChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputTicker.trim()) {
      setTicker(inputTicker.trim().toUpperCase());
    }
  };

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-gray-400 hover:text-white">&larr; Dashboard</Link>
          <h1 className="text-3xl font-bold">Positions</h1>
        </div>

        {/* Ticker Search */}
        <form onSubmit={handleTickerChange} className="flex gap-3 mb-6">
          <input
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            placeholder="Enter ticker"
            className="w-32 bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors"
          >
            View
          </button>
        </form>

        {error && <div className="text-[#FF006E] mb-4">{error}</div>}

        {loading ? (
          <div className="text-gray-400">Loading positions data...</div>
        ) : (
          <div className="flex gap-6">
            {/* Left Column (65%) */}
            <div className="flex-1 min-w-0" style={{ flex: '0 0 65%' }}>
              <TickerHeader
                ticker={ticker}
                price={spotPrice}
                change={priceChange}
                changePct={priceChangePct}
              />

              <PriceChart
                data={chartData}
                period={period}
                onPeriodChange={handlePeriodChange}
              />

              <MarketValueCards
                marketValue={marketValue}
                todayReturn={todayReturn}
                todayReturnPct={todayReturnPct}
                totalReturn={totalReturn}
                totalReturnPct={totalReturnPct}
                avgCost={avgCost}
                shares={shares}
                portfolioValue={portfolioValue}
              />

              <OptionPositionsList positions={positions} />

              {/* Portfolio Greeks Summary */}
              {portfolioGreeks && (
                <div className="bg-[#2D2D2D] rounded-lg p-4 mt-4">
                  <h3 className="text-sm font-bold text-gray-400 mb-3">Portfolio Greeks</h3>
                  <div className="grid grid-cols-5 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Delta</p>
                      <p className="font-bold">{portfolioGreeks.total_delta.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Gamma</p>
                      <p className="font-bold">{portfolioGreeks.total_gamma.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Vega</p>
                      <p className="font-bold">{portfolioGreeks.total_vega.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Theta</p>
                      <p className="font-bold">{portfolioGreeks.total_theta.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Rho</p>
                      <p className="font-bold">{portfolioGreeks.total_rho.toFixed(4)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column (35%) */}
            <div style={{ flex: '0 0 32%' }}>
              <TradeSidebar
                ticker={ticker}
                buyingPower={buyingPower}
                equity={equity}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
