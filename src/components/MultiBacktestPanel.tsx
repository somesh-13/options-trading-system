'use client';

import { useState } from 'react';
import { PRICING_API_URL } from '@/lib/pricing-api';

const ALL_TICKERS = ['CIFR', 'WULF', 'ONDS', 'HOOD', 'CLSK'];
const STRATEGY_LABELS: Record<string, string> = {
  iv_hv_arbitrage: 'IV/HV Arbitrage',
  ev_filtered: 'EV-Filtered',
  mean_reversion: 'Mean Reversion',
};

interface StrategyMetrics {
  strategy: string;
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_pnl: number;
  final_equity: number;
}

interface Trade {
  entry_date: string;
  exit_date: string;
  ticker: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  iv_hv_ratio: number;
  holding_days: number;
  exit_reason: string;
}

interface StrategyResult {
  strategy: string;
  metrics: Record<string, number>;
  trades: Trade[];
  per_ticker: Record<string, { trades: number; final_capital: number }>;
}

interface CompareResult {
  config: Record<string, unknown>;
  comparison: StrategyMetrics[];
  strategies: Record<string, StrategyResult>;
}

export default function MultiBacktestPanel() {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('iv_hv_arbitrage');

  // Config state
  const [tickers, setTickers] = useState<string[]>([...ALL_TICKERS]);
  const [startDate, setStartDate] = useState('2022-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [sellThreshold, setSellThreshold] = useState(1.15);
  const [buyThreshold, setBuyThreshold] = useState(0.85);
  const [evThreshold, setEvThreshold] = useState(25);
  const [zEntry, setZEntry] = useState(1.0);
  const [zExit, setZExit] = useState(0.3);

  const toggleTicker = (t: string) => {
    setTickers(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  };

  const runComparison = async () => {
    if (tickers.length === 0) { setError('Select at least one ticker'); return; }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${PRICING_API_URL}/api/backtest/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers,
          start_date: startDate,
          end_date: endDate,
          initial_capital: 100000,
          strategies: ['iv_hv_arbitrage', 'ev_filtered', 'mean_reversion'],
          iv_hv_sell_threshold: sellThreshold,
          iv_hv_buy_threshold: buyThreshold,
          ev_threshold: evThreshold,
          mean_reversion_z_entry: zEntry,
          mean_reversion_z_exit: zExit,
        }),
      });
      if (!resp.ok) throw new Error('Comparative backtest failed');
      const data = await resp.json();
      setResult(data);
      if (data.comparison?.length > 0) {
        setActiveTab(data.comparison[0].strategy);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const metricColor = (val: number, goodPositive = true) => {
    if (goodPositive) return val > 0 ? 'text-[#00C805]' : 'text-[#FF006E]';
    return val < 10 ? 'text-[#00C805]' : 'text-[#FF006E]';
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-xl font-bold mb-4">Multi-Strategy Comparison</h3>

      {/* Config Form */}
      <div className="space-y-3 mb-4">
        {/* Ticker checkboxes */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Tickers</label>
          <div className="flex flex-wrap gap-2">
            {ALL_TICKERS.map(t => (
              <button key={t} onClick={() => toggleTicker(t)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                  tickers.includes(t)
                    ? 'bg-[#00C805] text-white'
                    : 'bg-[#1E1E1E] text-gray-400 hover:text-white'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Date range + thresholds */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-gray-400">Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="text-xs text-gray-400">End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Sell Threshold</label>
            <input type="number" step="0.05" value={sellThreshold}
              onChange={e => setSellThreshold(parseFloat(e.target.value))}
              className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Buy Threshold</label>
            <input type="number" step="0.05" value={buyThreshold}
              onChange={e => setBuyThreshold(parseFloat(e.target.value))}
              className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
          </div>
          <div className="flex items-end">
            <button onClick={runComparison} disabled={loading}
              className="w-full px-4 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg disabled:opacity-50">
              {loading ? 'Running...' : 'Compare Strategies'}
            </button>
          </div>
        </div>

        {/* Strategy-specific params */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-400">EV Threshold ($/contract)</label>
            <input type="number" step="5" value={evThreshold}
              onChange={e => setEvThreshold(parseFloat(e.target.value))}
              className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Z-Score Entry</label>
            <input type="number" step="0.1" value={zEntry}
              onChange={e => setZEntry(parseFloat(e.target.value))}
              className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Z-Score Exit</label>
            <input type="number" step="0.1" value={zExit}
              onChange={e => setZExit(parseFloat(e.target.value))}
              className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
          </div>
        </div>
      </div>

      {error && <p className="text-[#FF006E] mb-4">{error}</p>}

      {result && result.comparison && (
        <div className="space-y-4">
          {/* Comparison Table */}
          <div className="bg-[#1E1E1E] rounded-lg p-4">
            <h4 className="text-sm text-gray-400 mb-3">Strategy Comparison</h4>
            <table className="w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-left pb-2">Strategy</th>
                  <th className="text-right pb-2">Return</th>
                  <th className="text-right pb-2">Sharpe</th>
                  <th className="text-right pb-2">Max DD</th>
                  <th className="text-right pb-2">Win Rate</th>
                  <th className="text-right pb-2">Profit Factor</th>
                  <th className="text-right pb-2">Trades</th>
                </tr>
              </thead>
              <tbody>
                {result.comparison.map(row => (
                  <tr key={row.strategy} className="border-t border-gray-700">
                    <td className="py-2 font-medium">{STRATEGY_LABELS[row.strategy] || row.strategy}</td>
                    <td className={`py-2 text-right ${metricColor(row.total_return_pct)}`}>
                      {row.total_return_pct > 0 ? '+' : ''}{row.total_return_pct.toFixed(2)}%
                    </td>
                    <td className={`py-2 text-right ${row.sharpe_ratio > 1 ? 'text-[#00C805]' : 'text-[#FFD700]'}`}>
                      {row.sharpe_ratio.toFixed(2)}
                    </td>
                    <td className={`py-2 text-right ${metricColor(row.max_drawdown_pct, false)}`}>
                      -{row.max_drawdown_pct.toFixed(2)}%
                    </td>
                    <td className={`py-2 text-right ${row.win_rate > 50 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                      {row.win_rate.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right text-[#FFD700]">{row.profit_factor.toFixed(2)}</td>
                    <td className="py-2 text-right">{row.total_trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Strategy Detail Tabs */}
          <div className="flex gap-2 mb-2">
            {result.comparison.map(row => (
              <button key={row.strategy} onClick={() => setActiveTab(row.strategy)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === row.strategy
                    ? 'bg-[#00C805] text-white'
                    : 'bg-[#1E1E1E] text-gray-400 hover:text-white'
                }`}>
                {STRATEGY_LABELS[row.strategy] || row.strategy}
              </button>
            ))}
          </div>

          {/* Active strategy detail */}
          {result.strategies[activeTab] && (() => {
            const strat = result.strategies[activeTab];
            const m = strat.metrics;
            return (
              <div className="space-y-3">
                {/* Key metrics */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Total Return</p>
                    <p className={`text-xl font-bold ${metricColor(m.total_return_pct)}`}>
                      {m.total_return_pct > 0 ? '+' : ''}{m.total_return_pct?.toFixed(2)}%
                    </p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Sharpe Ratio</p>
                    <p className={`text-xl font-bold ${m.sharpe_ratio > 1 ? 'text-[#00C805]' : 'text-[#FFD700]'}`}>
                      {m.sharpe_ratio?.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Final Equity</p>
                    <p className="text-xl font-bold text-[#FFD700]">
                      ${m.final_equity?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#1E1E1E] rounded-lg p-3">
                    <p className="text-xs text-gray-500">Avg P&L / Trade</p>
                    <p className={`text-xl font-bold ${metricColor(m.avg_pnl)}`}>
                      ${m.avg_pnl?.toFixed(0)}
                    </p>
                  </div>
                </div>

                {/* Per-ticker breakdown */}
                <div className="bg-[#1E1E1E] rounded-lg p-4">
                  <h4 className="text-sm text-gray-400 mb-2">Per-Ticker Breakdown</h4>
                  <div className="grid grid-cols-5 gap-3">
                    {Object.entries(strat.per_ticker).map(([ticker, info]) => (
                      <div key={ticker} className="bg-[#2D2D2D] rounded-lg p-2 text-center">
                        <p className="text-sm font-bold">{ticker}</p>
                        <p className="text-xs text-gray-400">{info.trades} trades</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trade list */}
                <div className="bg-[#1E1E1E] rounded-lg p-4">
                  <h4 className="text-sm text-gray-400 mb-2">
                    Trade History ({strat.trades.length} trades)
                  </h4>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left pb-2">Ticker</th>
                          <th className="text-left pb-2">Entry</th>
                          <th className="text-left pb-2">Exit</th>
                          <th className="text-left pb-2">Type</th>
                          <th className="text-right pb-2">P&L</th>
                          <th className="text-right pb-2">IV/HV</th>
                          <th className="text-left pb-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strat.trades.map((trade, i) => (
                          <tr key={i} className="border-t border-gray-700">
                            <td className="py-1 font-medium">{trade.ticker}</td>
                            <td className="py-1">{trade.entry_date}</td>
                            <td className="py-1">{trade.exit_date}</td>
                            <td className="py-1">{trade.direction}</td>
                            <td className={`py-1 text-right ${trade.pnl > 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                              ${trade.pnl.toFixed(0)}
                            </td>
                            <td className="py-1 text-right">{trade.iv_hv_ratio.toFixed(2)}</td>
                            <td className="py-1 text-gray-400">{trade.exit_reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {!result && !loading && (
        <p className="text-gray-500 text-sm">
          Configure parameters and click &quot;Compare Strategies&quot; to run all three strategies across selected tickers.
        </p>
      )}
    </div>
  );
}
