'use client';

// Positions = per-ticker position-management view (chart + market value cards +
// option legs + trade ticket). For the fundamentals-heavy stock view (DCF, IR
// filings, mispricing, sector context), navigate to /stock/[ticker] via the
// header link. The two pages share a ticker but render different angles.

import { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  getPortfolioSummary,
  getPriceHistory,
  getMispricing,
  PriceHistoryPoint,
  PositionWithGreeks,
  PortfolioGreeks,
} from '@/lib/pricing-api';
import {
  getRobinhoodHoldings,
  type RobinhoodHolding,
  type RobinhoodOption,
} from '@/lib/robinhood-api';
import TickerHeader from '@/components/positions/TickerHeader';
import PriceChart from '@/components/positions/PriceChart';
import MarketValueCards from '@/components/positions/MarketValueCards';
import OptionPositionsList from '@/components/positions/OptionPositionsList';
import TradeSidebar from '@/components/positions/TradeSidebar';

// Build an OCC-format symbol (e.g. "AMKR251115C00050000") from Robinhood's split fields.
function buildOccSymbol(o: RobinhoodOption): string {
  const yymmdd = o.expiry.replace(/-/g, '').slice(2); // 2028-01-21 → 280121
  const cp = o.side === 'Call' ? 'C' : 'P';
  const strike8 = String(Math.round(o.strike * 1000)).padStart(8, '0');
  return `${o.underlying.toUpperCase()}${yymmdd}${cp}${strike8}`;
}

// Adapt Robinhood holdings (real broker positions) to the PositionWithGreeks shape
// the existing positions UI components expect. Greeks aren't returned by the
// Robinhood holdings endpoint, so they default to 0 — the per-ticker UI still
// renders correctly, and the Portfolio Greeks card on this page is driven
// separately by the Alpaca summary fetch below.
function robinhoodToPositions(
  ticker: string,
  equities: RobinhoodHolding[],
  options: RobinhoodOption[],
): PositionWithGreeks[] {
  const T = ticker.toUpperCase();
  const out: PositionWithGreeks[] = [];

  // Aggregate equity rows across accounts for this ticker.
  const eqRows = equities.filter((e) => e.symbol.toUpperCase() === T);
  if (eqRows.length > 0) {
    const totalQty = eqRows.reduce((s, r) => s + r.quantity, 0);
    const totalCost = eqRows.reduce((s, r) => s + r.cost_basis, 0);
    const hasMV = eqRows.some((r) => r.market_value != null);
    const totalMV = hasMV ? eqRows.reduce((s, r) => s + (r.market_value ?? 0), 0) : 0;
    const hasUn = eqRows.some((r) => r.unrealized_pnl != null);
    const totalUn = hasUn ? eqRows.reduce((s, r) => s + (r.unrealized_pnl ?? 0), 0) : 0;
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
    const currentPrice = totalQty > 0 && totalMV > 0 ? totalMV / totalQty : 0;
    const plPct = totalCost > 0 ? totalUn / totalCost : 0;
    out.push({
      symbol: T,
      qty: String(totalQty),
      market_value: String(totalMV),
      unrealized_pl: String(totalUn),
      unrealized_plpc: String(plPct),
      current_price: String(currentPrice),
      avg_entry_price: String(avgCost),
      asset_class: 'us_equity',
      parsed_symbol: T,
      position_type: 'stock',
      greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 },
      bs_price: null,
      bs_params: null,
    });
  }

  // Each option leg becomes its own row.
  options
    .filter((o) => o.underlying.toUpperCase() === T)
    .forEach((o) => {
      const signedQty = o.position === 'short' ? -o.quantity : o.quantity;
      const mv = o.market_value ?? 0;
      const un = o.unrealized_pnl ?? 0;
      const cost = Math.abs(o.cost_basis);
      const plPct = cost > 0 ? un / cost : 0;
      const perContractEntry = o.quantity > 0 ? Math.abs(o.avg_cost) / o.quantity : 0;
      const perContractCurrent = o.quantity > 0 ? Math.abs(mv) / o.quantity : 0;
      out.push({
        symbol: buildOccSymbol(o),
        qty: String(signedQty),
        market_value: String(mv),
        unrealized_pl: String(un),
        unrealized_plpc: String(plPct),
        current_price: String(perContractCurrent),
        avg_entry_price: String(perContractEntry),
        asset_class: 'us_option',
        parsed_symbol: buildOccSymbol(o),
        position_type: 'option',
        greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 },
        bs_price: null,
        bs_params: null,
      });
    });

  return out;
}

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
      const [summaryResp, holdingsResp, mispricingResp] = await Promise.allSettled([
        getPortfolioSummary(),
        getRobinhoodHoldings(true, 'all', 'live'),
        getMispricing(t),
      ]);

      if (summaryResp.status === 'fulfilled') {
        const summary = summaryResp.value;
        setBuyingPower(parseFloat(summary.account?.buying_power || '0'));
        setEquity(parseFloat(summary.account?.equity || '0'));
        setPortfolioValue(parseFloat(summary.account?.portfolio_value || '0'));
        setPortfolioGreeks(summary.portfolio_greeks);
      }

      if (holdingsResp.status === 'fulfilled') {
        const { equities, options } = holdingsResp.value;
        setPositions(robinhoodToPositions(t, equities, options));
      } else {
        setPositions([]);
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
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="rv-h1" style={{ margin: 0 }}>Positions</h2>
          <Link
            href={`/stock/${ticker}`}
            className="rv-btn ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            title={`Open ${ticker} fundamentals (DCF · IR filings · mispricing)`}
          >
            View {ticker} fundamentals →
          </Link>
        </div>
        <div className="rv-sub">Per-ticker position detail with chart, market value, and trade ticket.</div>

        {/* Ticker Search */}
        <form onSubmit={handleTickerChange} className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:mb-6">
          <input
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            placeholder="Enter ticker"
            className="w-full sm:w-40 bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          />
          <button
            type="submit"
            className="w-full sm:w-auto px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors"
          >
            View
          </button>
        </form>

        {error && <div className="text-[#FF006E] mb-4">{error}</div>}

        {loading ? (
          <div className="text-gray-400">Loading positions data...</div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            {/* Left Column (65%) */}
            <div className="flex-1 min-w-0 w-full lg:w-[65%]">
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

              <OptionPositionsList positions={tickerPositions} />

              {/* Portfolio Greeks Summary */}
              {portfolioGreeks && (
                <div className="bg-[#2D2D2D] rounded-lg p-4 mt-4">
                  <h3 className="text-sm font-bold text-gray-400 mb-3">Portfolio Greeks</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3 text-xs sm:text-sm">
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
            <div className="w-full lg:w-[32%] lg:flex-none">
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
