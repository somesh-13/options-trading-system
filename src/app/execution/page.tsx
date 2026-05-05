'use client';

// Execution = Alpaca paper-trading (stocks + Alpaca options chain).
// For the live yfinance options chain that ties into Robinhood orders, see
// /options-chain. The two pages are intentionally separate because they wrap
// different brokers and chain data sources.

import { useState, useEffect, useCallback } from 'react';
import { parseOCC, formatOCCReadable } from '@/lib/utils';
import { PRICING_API_URL as API_URL } from '@/lib/pricing-api';

interface AccountInfo {
  status?: string;
  equity?: string;
  buying_power?: string;
  cash?: string;
  portfolio_value?: string;
  message?: string;
  paper_trading?: boolean;
}

export default function ExecutionPage() {
  const [activeTab, setActiveTab] = useState<'stocks' | 'options'>('stocks');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [positions, setPositions] = useState<Array<Record<string, string>>>([]);
  const [orders, setOrders] = useState<Array<Record<string, string>>>([]);
  const [loading, setLoading] = useState(true);

  // Stock order form
  const [symbol, setSymbol] = useState('CIFR');
  const [qty, setQty] = useState(10);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState<number | undefined>();
  const [orderResult, setOrderResult] = useState<string>('');

  // Options chain state
  const [optUnderlying, setOptUnderlying] = useState('CIFR');
  const [optExpirations, setOptExpirations] = useState<string[]>([]);
  const [optSelectedExp, setOptSelectedExp] = useState<string>('');
  const [chainData, setChainData] = useState<Record<string, unknown> | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState('');

  // Options order form
  const [optSymbol, setOptSymbol] = useState('');
  const [optQty, setOptQty] = useState(1);
  const [optSide, setOptSide] = useState<'buy' | 'sell'>('buy');
  const [optOrderType, setOptOrderType] = useState<'market' | 'limit'>('limit');
  const [optLimitPrice, setOptLimitPrice] = useState<number | undefined>();
  const [optOrderResult, setOptOrderResult] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [accResp, posResp, ordResp] = await Promise.all([
        fetch(`${API_URL}/api/execution/account`),
        fetch(`${API_URL}/api/execution/positions`),
        fetch(`${API_URL}/api/execution/orders`),
      ]);
      setAccount(await accResp.json());
      const posData = await posResp.json();
      setPositions(posData.positions || []);
      const ordData = await ordResp.json();
      setOrders(ordData.orders || []);
    } catch {
      setAccount({ status: 'error', message: 'Failed to connect to backend' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const submitOrder = async () => {
    try {
      const body: Record<string, unknown> = { symbol, qty, side, order_type: orderType, time_in_force: 'day' };
      if (orderType === 'limit' && limitPrice) body.limit_price = limitPrice;

      const resp = await fetch(`${API_URL}/api/execution/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      setOrderResult(JSON.stringify(result, null, 2));
      fetchAll();
    } catch (e) {
      setOrderResult(e instanceof Error ? e.message : 'Order failed');
    }
  };

  // Load expirations from contracts endpoint
  const loadExpirations = async () => {
    setChainError('');
    setChainLoading(true);
    try {
      const resp = await fetch(
        `${API_URL}/api/execution/options/contracts?underlying_symbol=${optUnderlying.toUpperCase()}`
      );
      const data = await resp.json();
      if (data.error) {
        setChainError(data.error);
        setChainLoading(false);
        return;
      }
      // Extract unique expiration dates from contracts
      const contracts = data.option_contracts || data.contracts || [];
      const exps = [...new Set(contracts.map((c: Record<string, string>) => c.expiration_date))] as string[];
      exps.sort();
      setOptExpirations(exps);
      if (exps.length > 0 && !optSelectedExp) {
        setOptSelectedExp(exps[0]);
      }
    } catch (e) {
      setChainError(e instanceof Error ? e.message : 'Failed to load expirations');
    } finally {
      setChainLoading(false);
    }
  };

  // Load options chain for selected expiration
  const loadChain = async () => {
    if (!optSelectedExp) return;
    setChainLoading(true);
    setChainError('');
    try {
      const params = new URLSearchParams({ expiration_date: optSelectedExp });
      const resp = await fetch(
        `${API_URL}/api/execution/options/chain/${optUnderlying.toUpperCase()}?${params}`
      );
      const data = await resp.json();
      if (data.error) {
        setChainError(data.detail || data.error);
      } else {
        setChainData(data);
      }
    } catch (e) {
      setChainError(e instanceof Error ? e.message : 'Failed to load chain');
    } finally {
      setChainLoading(false);
    }
  };

  // Submit options order
  const submitOptionsOrder = async () => {
    if (!optSymbol) return;
    try {
      const body: Record<string, unknown> = {
        symbol: optSymbol,
        qty: optQty,
        side: optSide,
        order_type: optOrderType,
      };
      if (optOrderType === 'limit' && optLimitPrice) body.limit_price = optLimitPrice;

      const resp = await fetch(`${API_URL}/api/execution/options/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      setOptOrderResult(JSON.stringify(result, null, 2));
      fetchAll();
    } catch (e) {
      setOptOrderResult(e instanceof Error ? e.message : 'Options order failed');
    }
  };

  // Exercise an option position
  const handleExercise = async (sym: string) => {
    try {
      const resp = await fetch(`${API_URL}/api/execution/options/exercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol_or_contract_id: sym }),
      });
      const result = await resp.json();
      setOptOrderResult(JSON.stringify(result, null, 2));
      fetchAll();
    } catch (e) {
      setOptOrderResult(e instanceof Error ? e.message : 'Exercise failed');
    }
  };

  // Close an option position
  const handleCloseOption = async (sym: string) => {
    try {
      const resp = await fetch(`${API_URL}/api/execution/options/position/${encodeURIComponent(sym)}`, {
        method: 'DELETE',
      });
      const result = await resp.json();
      setOptOrderResult(JSON.stringify(result, null, 2));
      fetchAll();
    } catch (e) {
      setOptOrderResult(e instanceof Error ? e.message : 'Close failed');
    }
  };

  // Cancel an order
  const handleCancelOrder = async (orderId: string) => {
    try {
      await fetch(`${API_URL}/api/execution/order/${orderId}`, { method: 'DELETE' });
      fetchAll();
    } catch {
      // ignore
    }
  };

  const isConfigured = account && account.status !== 'not_configured' && account.status !== 'error';

  // Filter positions/orders by asset class
  const stockPositions = positions.filter((p) => p.asset_class !== 'us_option');
  const optionPositions = positions.filter((p) => p.asset_class === 'us_option');
  const stockOrders = orders.filter((o) => !parseOCC(o.symbol || ''));
  const optionOrders = orders.filter((o) => !!parseOCC(o.symbol || ''));

  // Build chain table from snapshot data
  const buildChainRows = () => {
    if (!chainData) return [];
    const snapshots = (chainData.snapshots || {}) as Record<string, Record<string, unknown>>;
    const rows: Array<{
      occ: string;
      strike: number;
      type: string;
      bid: number;
      ask: number;
      last: number;
      iv: number;
      delta: number;
      volume: number;
    }> = [];

    for (const [occ, snap] of Object.entries(snapshots)) {
      const parsed = parseOCC(occ);
      if (!parsed) continue;
      const quote = (snap.latestQuote || {}) as Record<string, number>;
      const trade = (snap.latestTrade || {}) as Record<string, number>;
      const greeks = (snap.greeks || {}) as Record<string, number>;
      rows.push({
        occ,
        strike: parsed.strike,
        type: parsed.type,
        bid: quote.bp || quote.bidPrice || 0,
        ask: quote.ap || quote.askPrice || 0,
        last: trade.p || trade.price || 0,
        iv: greeks.impliedVolatility || greeks.iv || 0,
        delta: greeks.delta || 0,
        volume: (trade as Record<string, number>).s || 0,
      });
    }
    rows.sort((a, b) => a.strike - b.strike || (a.type === 'Call' ? -1 : 1));
    return rows;
  };

  const chainRows = buildChainRows();
  const callRows = chainRows.filter((r) => r.type === 'Call');
  const putRows = chainRows.filter((r) => r.type === 'Put');
  const strikes = [...new Set(chainRows.map((r) => r.strike))].sort((a, b) => a - b);

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-1">
          <h2 className="rv-h1">Live Trading Execution</h2>
          <span className="px-2 py-0.5 sm:px-3 sm:py-1 bg-[#FFD700]/20 text-[#FFD700] rounded text-xs sm:text-sm font-bold">PAPER</span>
        </div>
        <div className="rv-sub">
          Alpaca paper trading integration for stocks and options execution.
        </div>

        {loading ? (
          <div className="text-gray-400">Loading account data...</div>
        ) : (
          <div className="space-y-6">
            {/* Account Info */}
            <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
              <h3 className="text-lg sm:text-xl font-bold mb-4">Account</h3>
              {!isConfigured ? (
                <div className="bg-[#1E1E1E] rounded-lg p-4 border border-[#FFD700]/30">
                  <p className="text-[#FFD700] font-bold mb-2">Alpaca Not Configured</p>
                  <p className="text-gray-400 text-sm">
                    Add ALPACA_API_KEY and ALPACA_SECRET_KEY to backend/.env to enable live trading.
                    Orders will be simulated until credentials are provided.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Equity</p>
                    <p className="text-base sm:text-xl font-bold text-[#00C805] break-all">${parseFloat(account?.equity || '0').toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Buying Power</p>
                    <p className="text-base sm:text-xl font-bold break-all">${parseFloat(account?.buying_power || '0').toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Cash</p>
                    <p className="text-base sm:text-xl font-bold break-all">${parseFloat(account?.cash || '0').toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Status</p>
                    <p className="text-base sm:text-xl font-bold text-[#00C805]">{account?.status}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Tab System */}
            <div className="flex gap-1 bg-[#2D2D2D] rounded-lg p-1 w-fit">
              <button
                onClick={() => setActiveTab('stocks')}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
                  activeTab === 'stocks' ? 'bg-[#00C805] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Stocks
              </button>
              <button
                onClick={() => setActiveTab('options')}
                className={`px-6 py-2 rounded-lg font-bold text-sm transition-colors ${
                  activeTab === 'options' ? 'bg-[#00C805] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Options
              </button>
            </div>

            {/* ===== STOCKS TAB ===== */}
            {activeTab === 'stocks' && (
              <div className="space-y-6">
                {/* Stock Order Form */}
                <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold mb-4">Submit Stock Order</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3 mb-4">
                    <div>
                      <label className="text-xs text-gray-400">Symbol</label>
                      <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Quantity</label>
                      <input type="number" value={qty} onChange={(e) => setQty(parseInt(e.target.value))}
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Side</label>
                      <select value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg">
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Type</label>
                      <select value={orderType} onChange={(e) => setOrderType(e.target.value as 'market' | 'limit')}
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg">
                        <option value="market">Market</option>
                        <option value="limit">Limit</option>
                      </select>
                    </div>
                    {orderType === 'limit' && (
                      <div>
                        <label className="text-xs text-gray-400">Limit Price</label>
                        <input type="number" step="0.01" value={limitPrice || ''}
                          onChange={(e) => setLimitPrice(parseFloat(e.target.value))}
                          className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
                      </div>
                    )}
                  </div>
                  <button onClick={submitOrder}
                    className={`px-6 py-2 font-bold rounded-lg ${side === 'buy' ? 'bg-[#00C805] hover:bg-[#00A004]' : 'bg-[#FF006E] hover:bg-[#CC0058]'} text-white`}>
                    {side === 'buy' ? 'Buy' : 'Sell'} {qty} {symbol}
                  </button>
                  {orderResult && (
                    <pre className="mt-3 bg-[#1E1E1E] rounded p-3 text-xs text-gray-300 overflow-x-auto">{orderResult}</pre>
                  )}
                </div>

                {/* Stock Positions */}
                <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg sm:text-xl font-bold">Stock Positions ({stockPositions.length})</h3>
                    <button onClick={fetchAll} className="px-4 py-1 bg-[#2D2D2D] border border-gray-600 rounded text-xs sm:text-sm hover:bg-[#333]">
                      Refresh
                    </button>
                  </div>
                  {stockPositions.length === 0 ? (
                    <p className="text-gray-500">No open stock positions</p>
                  ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm min-w-[500px]">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left pb-2">Symbol</th>
                          <th className="text-right pb-2">Qty</th>
                          <th className="text-right pb-2">Entry</th>
                          <th className="text-right pb-2">Current</th>
                          <th className="text-right pb-2">P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockPositions.map((pos, i) => (
                          <tr key={i} className="border-t border-gray-700">
                            <td className="py-2 font-bold">{pos.symbol}</td>
                            <td className="py-2 text-right">{pos.qty}</td>
                            <td className="py-2 text-right">${parseFloat(pos.avg_entry_price || '0').toFixed(2)}</td>
                            <td className="py-2 text-right">${parseFloat(pos.current_price || '0').toFixed(2)}</td>
                            <td className={`py-2 text-right ${parseFloat(pos.unrealized_pl || '0') >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                              ${parseFloat(pos.unrealized_pl || '0').toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>

                {/* Stock Orders */}
                <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold mb-4">Stock Orders ({stockOrders.length})</h3>
                  {stockOrders.length === 0 ? (
                    <p className="text-gray-500">No open stock orders</p>
                  ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm min-w-[500px]">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left pb-2">Symbol</th>
                          <th className="text-left pb-2">Side</th>
                          <th className="text-right pb-2">Qty</th>
                          <th className="text-left pb-2">Type</th>
                          <th className="text-left pb-2">Status</th>
                          <th className="text-right pb-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockOrders.map((ord, i) => (
                          <tr key={i} className="border-t border-gray-700">
                            <td className="py-2 font-bold">{ord.symbol}</td>
                            <td className={`py-2 ${ord.side === 'buy' ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>{ord.side}</td>
                            <td className="py-2 text-right">{ord.qty}</td>
                            <td className="py-2">{ord.type}</td>
                            <td className="py-2 text-[#FFD700]">{ord.status}</td>
                            <td className="py-2 text-right">
                              <button onClick={() => handleCancelOrder(ord.id)}
                                className="text-xs px-2 py-1 bg-[#FF006E]/20 text-[#FF006E] rounded hover:bg-[#FF006E]/30">
                                Cancel
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== OPTIONS TAB ===== */}
            {activeTab === 'options' && (
              <div className="space-y-4 sm:space-y-6">
                {/* Options Chain Lookup */}
                <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold mb-4">Options Chain Lookup</h3>
                  <div className="flex flex-wrap gap-2 sm:gap-3 items-end mb-4">
                    <div>
                      <label className="text-xs text-gray-400">Underlying</label>
                      <input
                        type="text"
                        value={optUnderlying}
                        onChange={(e) => setOptUnderlying(e.target.value.toUpperCase())}
                        className="w-32 bg-[#1E1E1E] text-white px-3 py-2 rounded-lg"
                      />
                    </div>
                    <button
                      onClick={loadExpirations}
                      disabled={chainLoading}
                      className="px-4 py-2 bg-[#2D2D2D] border border-gray-600 rounded-lg text-sm hover:bg-[#333] disabled:opacity-50"
                    >
                      {chainLoading ? 'Loading...' : 'Load Expirations'}
                    </button>
                    {optExpirations.length > 0 && (
                      <>
                        <div>
                          <label className="text-xs text-gray-400">Expiration</label>
                          <select
                            value={optSelectedExp}
                            onChange={(e) => setOptSelectedExp(e.target.value)}
                            className="w-44 bg-[#1E1E1E] text-white px-3 py-2 rounded-lg"
                          >
                            {optExpirations.map((exp) => (
                              <option key={exp} value={exp}>{exp}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={loadChain}
                          disabled={chainLoading}
                          className="px-4 py-2 bg-[#00C805] hover:bg-[#00A004] rounded-lg text-sm font-bold disabled:opacity-50"
                        >
                          Load Chain
                        </button>
                      </>
                    )}
                  </div>

                  {chainError && (
                    <div className="text-[#FF006E] text-sm mb-4">{chainError}</div>
                  )}

                  {/* Options Chain Table */}
                  {strikes.length > 0 && (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                      <table className="w-full text-xs min-w-[640px]">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="text-right pb-2 px-2">Delta</th>
                            <th className="text-right pb-2 px-2">IV</th>
                            <th className="text-right pb-2 px-2">Bid</th>
                            <th className="text-right pb-2 px-2">Ask</th>
                            <th className="text-center pb-2 px-2 bg-[#1E1E1E] text-[#FFD700] font-bold">Strike</th>
                            <th className="text-right pb-2 px-2">Bid</th>
                            <th className="text-right pb-2 px-2">Ask</th>
                            <th className="text-right pb-2 px-2">IV</th>
                            <th className="text-right pb-2 px-2">Delta</th>
                          </tr>
                          <tr>
                            <th colSpan={4} className="text-center pb-1 text-[#00C805] text-xs font-normal">CALLS</th>
                            <th className="bg-[#1E1E1E]"></th>
                            <th colSpan={4} className="text-center pb-1 text-[#FF006E] text-xs font-normal">PUTS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {strikes.map((strike) => {
                            const call = callRows.find((r) => r.strike === strike);
                            const put = putRows.find((r) => r.strike === strike);
                            return (
                              <tr key={strike} className="border-t border-gray-700/50 hover:bg-[#333] cursor-pointer">
                                {/* Call side */}
                                <td
                                  className="py-1.5 px-2 text-right text-gray-300"
                                  onClick={() => call && selectChainRow(call.occ, call.ask)}
                                >
                                  {call ? call.delta.toFixed(3) : '-'}
                                </td>
                                <td
                                  className="py-1.5 px-2 text-right text-gray-300"
                                  onClick={() => call && selectChainRow(call.occ, call.ask)}
                                >
                                  {call ? (call.iv * 100).toFixed(1) + '%' : '-'}
                                </td>
                                <td
                                  className="py-1.5 px-2 text-right text-[#00C805]"
                                  onClick={() => call && selectChainRow(call.occ, call.bid)}
                                >
                                  {call ? call.bid.toFixed(2) : '-'}
                                </td>
                                <td
                                  className="py-1.5 px-2 text-right text-[#FF006E]"
                                  onClick={() => call && selectChainRow(call.occ, call.ask)}
                                >
                                  {call ? call.ask.toFixed(2) : '-'}
                                </td>
                                {/* Strike */}
                                <td className="py-1.5 px-2 text-center bg-[#1E1E1E] font-bold text-[#FFD700]">
                                  ${strike.toFixed(2)}
                                </td>
                                {/* Put side */}
                                <td
                                  className="py-1.5 px-2 text-right text-[#00C805]"
                                  onClick={() => put && selectChainRow(put.occ, put.bid)}
                                >
                                  {put ? put.bid.toFixed(2) : '-'}
                                </td>
                                <td
                                  className="py-1.5 px-2 text-right text-[#FF006E]"
                                  onClick={() => put && selectChainRow(put.occ, put.ask)}
                                >
                                  {put ? put.ask.toFixed(2) : '-'}
                                </td>
                                <td
                                  className="py-1.5 px-2 text-right text-gray-300"
                                  onClick={() => put && selectChainRow(put.occ, put.ask)}
                                >
                                  {put ? (put.iv * 100).toFixed(1) + '%' : '-'}
                                </td>
                                <td
                                  className="py-1.5 px-2 text-right text-gray-300"
                                  onClick={() => put && selectChainRow(put.occ, put.ask)}
                                >
                                  {put ? put.delta.toFixed(3) : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Options Order Form */}
                <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold mb-4">Options Order</h3>
                  {optSymbol && (
                    <div className="mb-3 bg-[#1E1E1E] rounded-lg p-3 border border-[#00C805]/30">
                      <p className="text-xs text-gray-400">Selected Contract</p>
                      <p className="text-base sm:text-lg font-bold text-[#00C805] break-all">{formatOCCReadable(optSymbol)}</p>
                      <p className="text-xs text-gray-500 break-all">{optSymbol}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3 mb-4">
                    <div>
                      <label className="text-xs text-gray-400">OCC Symbol</label>
                      <input
                        type="text"
                        value={optSymbol}
                        onChange={(e) => setOptSymbol(e.target.value.toUpperCase())}
                        placeholder="CIFR260220C00016000"
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Contracts</label>
                      <input
                        type="number"
                        value={optQty}
                        min={1}
                        onChange={(e) => setOptQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Side</label>
                      <select
                        value={optSide}
                        onChange={(e) => setOptSide(e.target.value as 'buy' | 'sell')}
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg"
                      >
                        <option value="buy">Buy to Open</option>
                        <option value="sell">Sell to Open</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Type</label>
                      <select
                        value={optOrderType}
                        onChange={(e) => setOptOrderType(e.target.value as 'market' | 'limit')}
                        className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg"
                      >
                        <option value="limit">Limit</option>
                        <option value="market">Market</option>
                      </select>
                    </div>
                    {optOrderType === 'limit' && (
                      <div>
                        <label className="text-xs text-gray-400">Limit Price</label>
                        <input
                          type="number"
                          step="0.01"
                          value={optLimitPrice || ''}
                          onChange={(e) => setOptLimitPrice(parseFloat(e.target.value))}
                          className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg"
                        />
                      </div>
                    )}
                  </div>
                  {optOrderType === 'limit' && optLimitPrice && optQty && (
                    <p className="text-sm text-gray-400 mb-3">
                      Total cost: <span className="text-white font-bold">${(optLimitPrice * optQty * 100).toFixed(2)}</span>
                      <span className="text-gray-500 ml-1">({optQty} contract{optQty > 1 ? 's' : ''} x 100 shares x ${optLimitPrice.toFixed(2)})</span>
                    </p>
                  )}
                  <button
                    onClick={submitOptionsOrder}
                    disabled={!optSymbol}
                    className={`px-6 py-2 font-bold rounded-lg ${
                      optSide === 'buy' ? 'bg-[#00C805] hover:bg-[#00A004]' : 'bg-[#FF006E] hover:bg-[#CC0058]'
                    } text-white disabled:opacity-50`}
                  >
                    {optSide === 'buy' ? 'Buy' : 'Sell'} {optQty} Contract{optQty > 1 ? 's' : ''}
                  </button>
                  {optOrderResult && (
                    <pre className="mt-3 bg-[#1E1E1E] rounded p-3 text-xs text-gray-300 overflow-x-auto">{optOrderResult}</pre>
                  )}
                </div>

                {/* Options Positions */}
                <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg sm:text-xl font-bold">Options Positions ({optionPositions.length})</h3>
                    <button onClick={fetchAll} className="px-4 py-1 bg-[#2D2D2D] border border-gray-600 rounded text-xs sm:text-sm hover:bg-[#333]">
                      Refresh
                    </button>
                  </div>
                  {optionPositions.length === 0 ? (
                    <p className="text-gray-500">No open options positions</p>
                  ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm min-w-[600px]">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left pb-2">Contract</th>
                          <th className="text-right pb-2">Qty</th>
                          <th className="text-right pb-2">Entry</th>
                          <th className="text-right pb-2">Current</th>
                          <th className="text-right pb-2">P&L</th>
                          <th className="text-right pb-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionPositions.map((pos, i) => (
                          <tr key={i} className="border-t border-gray-700">
                            <td className="py-2">
                              <span className="font-bold">{formatOCCReadable(pos.symbol)}</span>
                              <br />
                              <span className="text-xs text-gray-500">{pos.symbol}</span>
                            </td>
                            <td className="py-2 text-right">{pos.qty}</td>
                            <td className="py-2 text-right">${parseFloat(pos.avg_entry_price || '0').toFixed(2)}</td>
                            <td className="py-2 text-right">${parseFloat(pos.current_price || '0').toFixed(2)}</td>
                            <td className={`py-2 text-right ${parseFloat(pos.unrealized_pl || '0') >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                              ${parseFloat(pos.unrealized_pl || '0').toFixed(2)}
                            </td>
                            <td className="py-2 text-right space-x-2 whitespace-nowrap">
                              <button
                                onClick={() => handleExercise(pos.symbol)}
                                className="text-xs px-2 py-1 bg-[#FFD700]/20 text-[#FFD700] rounded hover:bg-[#FFD700]/30"
                              >
                                Exercise
                              </button>
                              <button
                                onClick={() => handleCloseOption(pos.symbol)}
                                className="text-xs px-2 py-1 bg-[#FF006E]/20 text-[#FF006E] rounded hover:bg-[#FF006E]/30"
                              >
                                Close
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>

                {/* Options Orders */}
                <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold mb-4">Options Orders ({optionOrders.length})</h3>
                  {optionOrders.length === 0 ? (
                    <p className="text-gray-500">No open options orders</p>
                  ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm min-w-[700px]">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left pb-2">Contract</th>
                          <th className="text-left pb-2">Side</th>
                          <th className="text-right pb-2">Qty</th>
                          <th className="text-left pb-2">Type</th>
                          <th className="text-right pb-2">Limit</th>
                          <th className="text-left pb-2">Status</th>
                          <th className="text-right pb-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionOrders.map((ord, i) => (
                          <tr key={i} className="border-t border-gray-700">
                            <td className="py-2">
                              <span className="font-bold">{formatOCCReadable(ord.symbol)}</span>
                              <br />
                              <span className="text-xs text-gray-500">{ord.symbol}</span>
                            </td>
                            <td className={`py-2 ${ord.side === 'buy' ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>{ord.side}</td>
                            <td className="py-2 text-right">{ord.qty}</td>
                            <td className="py-2">{ord.type}</td>
                            <td className="py-2 text-right">{ord.limit_price ? `$${parseFloat(ord.limit_price).toFixed(2)}` : '-'}</td>
                            <td className="py-2 text-[#FFD700]">{ord.status}</td>
                            <td className="py-2 text-right">
                              <button
                                onClick={() => handleCancelOrder(ord.id)}
                                className="text-xs px-2 py-1 bg-[#FF006E]/20 text-[#FF006E] rounded hover:bg-[#FF006E]/30"
                              >
                                Cancel
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );

  // Helper to select a chain row into the order form
  function selectChainRow(occ: string, price: number) {
    setOptSymbol(occ);
    setOptLimitPrice(price || undefined);
    setOptOrderType('limit');
  }
}
