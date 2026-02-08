'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000';

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
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [positions, setPositions] = useState<Array<Record<string, string>>>([]);
  const [orders, setOrders] = useState<Array<Record<string, string>>>([]);
  const [loading, setLoading] = useState(true);

  // Order form
  const [symbol, setSymbol] = useState('CIFR');
  const [qty, setQty] = useState(10);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState<number | undefined>();
  const [orderResult, setOrderResult] = useState<string>('');

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
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
  };

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

  const isConfigured = account && account.status !== 'not_configured' && account.status !== 'error';

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-gray-400 hover:text-white">&larr; Dashboard</Link>
          <h1 className="text-3xl font-bold">Live Trading Execution</h1>
          <span className="px-3 py-1 bg-[#FFD700]/20 text-[#FFD700] rounded text-sm font-bold">PAPER</span>
        </div>
        <p className="text-gray-400 mb-6">
          Phase 7: Alpaca paper trading integration for order execution, position management, and P&L tracking.
        </p>

        {loading ? (
          <div className="text-gray-400">Loading account data...</div>
        ) : (
          <div className="space-y-6">
            {/* Account Info */}
            <div className="bg-[#2D2D2D] rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">Account</h3>
              {!isConfigured ? (
                <div className="bg-[#1E1E1E] rounded-lg p-4 border border-[#FFD700]/30">
                  <p className="text-[#FFD700] font-bold mb-2">Alpaca Not Configured</p>
                  <p className="text-gray-400 text-sm">
                    Add ALPACA_API_KEY and ALPACA_SECRET_KEY to backend/.env to enable live trading.
                    Orders will be simulated until credentials are provided.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Equity</p>
                    <p className="text-xl font-bold text-[#00C805]">${parseFloat(account?.equity || '0').toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Buying Power</p>
                    <p className="text-xl font-bold">${parseFloat(account?.buying_power || '0').toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Cash</p>
                    <p className="text-xl font-bold">${parseFloat(account?.cash || '0').toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Status</p>
                    <p className="text-xl font-bold text-[#00C805]">{account?.status}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Order Form */}
            <div className="bg-[#2D2D2D] rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">Submit Order</h3>
              <div className="grid grid-cols-5 gap-3 mb-4">
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

            {/* Positions */}
            <div className="bg-[#2D2D2D] rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Open Positions ({positions.length})</h3>
                <button onClick={fetchAll} className="px-4 py-1 bg-[#2D2D2D] border border-gray-600 rounded text-sm hover:bg-[#333]">
                  Refresh
                </button>
              </div>
              {positions.length === 0 ? (
                <p className="text-gray-500">No open positions</p>
              ) : (
                <table className="w-full text-sm">
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
                    {positions.map((pos, i) => (
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
              )}
            </div>

            {/* Orders */}
            <div className="bg-[#2D2D2D] rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">Open Orders ({orders.length})</h3>
              {orders.length === 0 ? (
                <p className="text-gray-500">No open orders</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="text-left pb-2">Symbol</th>
                      <th className="text-left pb-2">Side</th>
                      <th className="text-right pb-2">Qty</th>
                      <th className="text-left pb-2">Type</th>
                      <th className="text-left pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((ord, i) => (
                      <tr key={i} className="border-t border-gray-700">
                        <td className="py-2 font-bold">{ord.symbol}</td>
                        <td className={`py-2 ${ord.side === 'buy' ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>{ord.side}</td>
                        <td className="py-2 text-right">{ord.qty}</td>
                        <td className="py-2">{ord.type}</td>
                        <td className="py-2 text-[#FFD700]">{ord.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
