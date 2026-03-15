'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getOptionsContracts,
  getOptionsChainSnapshot,
  getMispricing,
  getPortfolioSummary,
  submitOptionsOrder,
} from '@/lib/pricing-api';
import TickerHeader from '@/components/positions/TickerHeader';
import ChainControls from '@/components/options-chain/ChainControls';
import IVHVPanel from '@/components/options-chain/IVHVPanel';
import ChainTable, { buildChainRows, ChainRow } from '@/components/options-chain/ChainTable';
import TradePanel from '@/components/options-chain/TradePanel';

export default function OptionsChainPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#1E1E1E] text-white p-6"><div className="text-gray-400">Loading...</div></div>}>
      <OptionsChainInner />
    </Suspense>
  );
}

function OptionsChainInner() {
  const searchParams = useSearchParams();
  const initialTicker = searchParams.get('ticker') || 'CIFR';

  const [ticker, setTicker] = useState(initialTicker);
  const [inputTicker, setInputTicker] = useState(initialTicker);
  const [loading, setLoading] = useState(true);
  const [chainLoading, setChainLoading] = useState(false);
  const [error, setError] = useState('');

  // Market data
  const [spotPrice, setSpotPrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [priceChangePct, setPriceChangePct] = useState(0);
  const [iv, setIv] = useState(0);
  const [hv, setHv] = useState(0);
  const [ivHvRatio, setIvHvRatio] = useState(0);
  const [signal, setSignal] = useState('NEUTRAL');

  // Chain state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [optionType, setOptionType] = useState<'call' | 'put'>('call');
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExp, setSelectedExp] = useState('');
  const [chainRows, setChainRows] = useState<ChainRow[]>([]);

  // Order state
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
        // Estimate today's change from mispricing data
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
      const rows = buildChainRows(data as Record<string, unknown>);
      setChainRows(rows);
    } catch {
      setChainRows([]);
    } finally {
      setChainLoading(false);
    }
  }, [selectedExp, ticker]);

  useEffect(() => {
    loadInitialData(ticker);
  }, [ticker, loadInitialData]);

  useEffect(() => {
    if (selectedExp) loadChain();
  }, [selectedExp, loadChain]);

  const handleTickerChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputTicker.trim()) {
      const t = inputTicker.trim().toUpperCase();
      setTicker(t);
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

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-gray-400 hover:text-white">&larr; Dashboard</Link>
          <h1 className="text-3xl font-bold">Option Chain</h1>
          <Link href={`/positions?ticker=${ticker}`} className="text-sm text-[#00C805] hover:underline ml-auto">
            View Positions
          </Link>
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
            Load Chain
          </button>
        </form>

        {error && <div className="text-[#FF006E] mb-4">{error}</div>}

        {loading ? (
          <div className="text-gray-400">Loading options data...</div>
        ) : (
          <div className="flex gap-6">
            {/* Left Column (70%) */}
            <div className="flex-1 min-w-0" style={{ flex: '0 0 68%' }}>
              <TickerHeader
                ticker={ticker}
                price={spotPrice}
                change={priceChange}
                changePct={priceChangePct}
              />

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

              <IVHVPanel iv={iv} hv={hv} ratio={ivHvRatio} signal={signal} />

              <ChainTable
                rows={chainRows}
                optionType={optionType}
                side={side}
                onSelect={handleSelect}
              />
            </div>

            {/* Right Column (30%) */}
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
  );
}
