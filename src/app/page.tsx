'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  getOptionsContracts,
  getOptionsChainSnapshot,
  getMispricing,
  getPortfolioSummary,
  submitOptionsOrder,
} from '@/lib/pricing-api';
import ChainControls from '@/components/options-chain/ChainControls';
import IVHVPanel from '@/components/options-chain/IVHVPanel';
import ChainTable, { buildChainRows, ChainRow } from '@/components/options-chain/ChainTable';
import TradePanel from '@/components/options-chain/TradePanel';

const PRESET_TICKERS = ['CIFR', 'AAPL', 'SPY', 'TSLA', 'NVDA', 'AMD', 'QQQ', 'AMZN', 'META', 'MSFT'];

function NavGroup({ title, icon, defaultOpen = false, collapsed = false, children }: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  collapsed?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        title={collapsed ? title : undefined}
        className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-[#2D2D2D] rounded-lg text-sm font-semibold text-gray-300 transition-colors"
      >
        <span className="text-base shrink-0">{icon}</span>
        {!collapsed && <span className="flex-1 truncate">{title}</span>}
        {!collapsed && (
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {!collapsed && (
        <div
          className={`grid transition-all duration-200 ease-in-out ${open ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-0.5 pl-7">
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const navLinkClass = "block px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-[#2D2D2D] rounded transition-colors truncate";

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ticker, setTicker] = useState('CIFR');
  const [customTicker, setCustomTicker] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chainLoading, setChainLoading] = useState(false);
  const [error, setError] = useState('');

  const [spotPrice, setSpotPrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [priceChangePct, setPriceChangePct] = useState(0);
  const [iv, setIv] = useState(0);
  const [hv, setHv] = useState(0);
  const [ivHvRatio, setIvHvRatio] = useState(0);
  const [signal, setSignal] = useState('NEUTRAL');

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [optionType, setOptionType] = useState<'call' | 'put'>('call');
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExp, setSelectedExp] = useState('');
  const [chainRows, setChainRows] = useState<ChainRow[]>([]);

  const [selectedOCC, setSelectedOCC] = useState('');
  const [orderQty, setOrderQty] = useState(1);
  const [orderType, setOrderType] = useState<'market' | 'limit'>('limit');
  const [limitPrice, setLimitPrice] = useState<number | undefined>();
  const [orderResult, setOrderResult] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [buyingPower, setBuyingPower] = useState(0);
  const [now, setNow] = useState(0);

  const loadInitialData = useCallback(async (t: string) => {
    setLoading(true);
    setError('');
    setNow(Date.now());
    try {
      const [mispricingResp, summaryResp, contractsResp] = await Promise.allSettled([
        getMispricing(t),
        getPortfolioSummary(),
        getOptionsContracts(t),
      ]);

      if (mispricingResp.status === 'fulfilled') {
        const m = mispricingResp.value;
        setSpotPrice(m.spot_price);
        setIv(m.implied_vol_atm);
        setHv(m.historical_vol);
        setIvHvRatio(m.iv_hv_ratio);
        setSignal(m.signal);
        setPriceChange(0);
        setPriceChangePct(0);
      }

      if (summaryResp.status === 'fulfilled') {
        setBuyingPower(parseFloat(summaryResp.value.account?.buying_power || '0'));
      }

      if (contractsResp.status === 'fulfilled') {
        const data = contractsResp.value;
        const contracts = (data as Record<string, unknown>).option_contracts || (data as Record<string, unknown>).contracts || [];
        const exps = [...new Set((contracts as Array<Record<string, string>>).map((c) => c.expiration_date))] as string[];
        exps.sort();
        setExpirations(exps);
        if (exps.length > 0) {
          setSelectedExp(exps[0]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChain = useCallback(async () => {
    if (!selectedExp || !ticker) return;
    setChainLoading(true);
    try {
      const data = await getOptionsChainSnapshot(ticker, {
        expiration_date: selectedExp,
      });
      const rows = buildChainRows(data as Record<string, unknown>, spotPrice);
      setChainRows(rows);
    } catch {
      setChainRows([]);
    } finally {
      setChainLoading(false);
    }
  }, [selectedExp, ticker, spotPrice]);

  useEffect(() => {
    loadInitialData(ticker);
  }, [ticker, loadInitialData]);

  useEffect(() => {
    if (selectedExp) loadChain();
  }, [selectedExp, loadChain]);

  const handleTickerSelect = (value: string) => {
    if (value === '__custom__') {
      setUseCustom(true);
      return;
    }
    setUseCustom(false);
    setTicker(value);
    setExpirations([]);
    setSelectedExp('');
    setChainRows([]);
    setSelectedOCC('');
  };

  const handleCustomTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = customTicker.trim().toUpperCase();
    if (t) {
      setTicker(t);
      setUseCustom(false);
      setCustomTicker('');
      setExpirations([]);
      setSelectedExp('');
      setChainRows([]);
      setSelectedOCC('');
    }
  };

  const handleSelect = (occ: string, price: number) => {
    setSelectedOCC(occ);
    setLimitPrice(price || undefined);
    setOrderType('limit');
  };

  const handleSubmitOrder = async () => {
    if (!selectedOCC) return;
    setSubmitting(true);
    try {
      const result = await submitOptionsOrder({
        symbol: selectedOCC,
        qty: orderQty,
        side,
        order_type: orderType,
        limit_price: orderType === 'limit' ? limitPrice : undefined,
      });
      setOrderResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setOrderResult(e instanceof Error ? e.message : 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExpirationChange = (exp: string) => {
    setSelectedExp(exp);
    setSelectedOCC('');
  };

  const sidebarLinks = (
    <Link
      href="/options-chain"
      className={navLinkClass + ' flex items-center gap-2'}
    >
      <span className="shrink-0">&#x26D3;</span>
      {sidebarOpen && <span>Option Chain</span>}
    </Link>
  );

  const sidebarAgentLink = (
    <Link
      href="/agent"
      className={navLinkClass + ' flex items-center gap-2'}
    >
      <span className="shrink-0">&#x1F916;</span>
      {sidebarOpen && <span>VegaEdge Agent</span>}
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-[#1E1E1E] text-white">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-30 h-screen bg-[#1A1A1A] border-r border-gray-700/50
          overflow-y-auto overflow-x-hidden
          transition-all duration-200 ease-in-out shrink-0
          ${sidebarOpen ? 'w-60' : 'w-12'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Sidebar header */}
        <div className="flex items-center gap-2 px-3 py-4 border-b border-gray-700/50">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 hover:bg-[#2D2D2D] rounded transition-colors shrink-0"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {sidebarOpen && (
            <span className="text-lg font-bold text-white truncate">VegaEdge</span>
          )}
        </div>

        {/* Primary links */}
        <div className="px-2 py-3 space-y-1 border-b border-gray-700/50">
          {sidebarLinks}
          {sidebarAgentLink}
        </div>

        {/* Nav Groups */}
        <div className="px-2 py-3 space-y-1">
          <NavGroup title="Analytics" icon="&#x1F4CA;" defaultOpen collapsed={!sidebarOpen}>
            <Link href="/pricing" className={navLinkClass}>Pricing Calculator</Link>
            <Link href="/vol-surface" className={navLinkClass}>Vol Surface</Link>
            <Link href="/scanner" className={navLinkClass}>Scanner</Link>
          </NavGroup>

          <NavGroup title="Strategy & Backtesting" icon="&#x1F3AF;" collapsed={!sidebarOpen}>
            <Link href="/strategy" className={navLinkClass}>Strategy & Hedging</Link>
            <Link href="/backtest" className={navLinkClass}>Backtesting</Link>
            <Link href="/sentiment" className={navLinkClass}>NLP Sentiment</Link>
          </NavGroup>

          <NavGroup title="Risk" icon="&#x1F6E1;&#xFE0F;" collapsed={!sidebarOpen}>
            <Link href="/risk" className={navLinkClass}>Risk & P&L</Link>
            <Link href="/risk-mgmt" className={navLinkClass}>Risk Management</Link>
          </NavGroup>

          <NavGroup title="Trading & Execution" icon="&#x26A1;" collapsed={!sidebarOpen}>
            <Link href="/execution" className={navLinkClass}>Live Trading</Link>
            <Link href="/auto-engine" className={navLinkClass}>Auto Engine</Link>
            <Link href="/positions" className={navLinkClass}>Positions</Link>
            <Link href="/portfolio" className={navLinkClass}>Portfolio Monitor</Link>
          </NavGroup>

          <NavGroup title="Tools" icon="&#x1F527;" collapsed={!sidebarOpen}>
            <Link href="/journal" className={navLinkClass}>Trade Journal</Link>
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noopener noreferrer"
              className={navLinkClass}
            >
              API Docs &#x2197;
            </a>
          </NavGroup>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Mobile hamburger (visible when sidebar is collapsed on small screens) */}
          <div className="lg:hidden mb-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 hover:bg-[#2D2D2D] rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

          {/* Ticker + Price Header */}
          <div className="flex items-center gap-4 mb-6 flex-wrap">
            <select
              value={useCustom ? '__custom__' : ticker}
              onChange={(e) => handleTickerSelect(e.target.value)}
              className="bg-[#2D2D2D] text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805] text-lg font-bold"
            >
              {PRESET_TICKERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="__custom__">Custom...</option>
            </select>
            {useCustom && (
              <form onSubmit={handleCustomTickerSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={customTicker}
                  onChange={(e) => setCustomTicker(e.target.value.toUpperCase())}
                  placeholder="e.g. GOOG"
                  autoFocus
                  className="w-28 bg-[#2D2D2D] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805] text-sm"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors text-sm"
                >
                  Go
                </button>
              </form>
            )}
            {!loading && (
              <>
                <span className="text-3xl font-bold">${spotPrice.toFixed(2)}</span>
                <span className={`text-lg font-semibold ${priceChange >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                  {priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} ({priceChange >= 0 ? '+' : ''}{priceChangePct.toFixed(2)}%)
                </span>
              </>
            )}
          </div>

          {error && <div className="text-[#FF006E] mb-4">{error}</div>}

          {loading ? (
            <div className="bg-[#2D2D2D] rounded-lg p-6 animate-pulse">
              <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-700 rounded"></div>
                <div className="h-4 bg-gray-700 rounded w-5/6"></div>
              </div>
            </div>
          ) : (
            <div className="flex gap-6">
              {/* Chain Column */}
              <div className="flex-1 min-w-0" style={{ flex: '0 0 68%' }}>
                <IVHVPanel iv={iv} hv={hv} ratio={ivHvRatio} signal={signal} />

                <ChainControls
                  side={side}
                  onSideChange={setSide}
                  optionType={optionType}
                  onOptionTypeChange={setOptionType}
                  expirations={expirations}
                  selectedExpiration={selectedExp}
                  onExpirationChange={handleExpirationChange}
                  loading={chainLoading}
                  now={now}
                />

                <ChainTable
                  rows={chainRows}
                  optionType={optionType}
                  side={side}
                  onSelect={handleSelect}
                  hv={hv}
                  spotPrice={spotPrice}
                />
              </div>

              {/* Trade Column */}
              <div style={{ flex: '0 0 29%' }}>
                <TradePanel
                  selectedOCC={selectedOCC}
                  side={side}
                  qty={orderQty}
                  onQtyChange={setOrderQty}
                  orderType={orderType}
                  onOrderTypeChange={setOrderType}
                  limitPrice={limitPrice}
                  onLimitPriceChange={setLimitPrice}
                  onSubmit={handleSubmitOrder}
                  orderResult={orderResult}
                  buyingPower={buyingPower}
                  submitting={submitting}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
