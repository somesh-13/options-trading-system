'use client';

import { useState } from 'react';

interface BacktestMetrics {
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  calmar_ratio: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  avg_pnl: number;
  max_win: number;
  max_loss: number;
  avg_holding_days: number;
  final_equity: number;
}

interface BacktestTrade {
  entry_date: string;
  exit_date: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  iv_hv_ratio: number;
  holding_days: number;
  exit_reason: string;
}

interface BacktestResult {
  config: Record<string, unknown>;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equity_curve: Array<{ date: string; equity: number }>;
  monthly_returns: Array<{ month: string; return_pct: number }>;
}

const API_URL = process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000';

export default function BacktestPanel({ ticker }: { ticker: string }) {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [threshold, setThreshold] = useState(1.2);

  const runBacktest = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${API_URL}/api/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          start_date: startDate,
          end_date: endDate,
          initial_capital: 100000,
          iv_hv_sell_threshold: threshold,
          iv_hv_buy_threshold: 1 / threshold,
        }),
      });
      if (!resp.ok) throw new Error('Backtest failed');
      setResult(await resp.json());
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
      <h3 className="text-xl font-bold mb-4">Backtesting Engine</h3>

      {/* Config */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-400">Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
        <div>
          <label className="text-xs text-gray-400">End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
        <div>
          <label className="text-xs text-gray-400">IV/HV Sell Threshold</label>
          <input type="number" step="0.1" value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded-lg" />
        </div>
        <div className="flex items-end">
          <button onClick={runBacktest} disabled={loading}
            className="w-full px-4 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg disabled:opacity-50">
            {loading ? 'Running...' : 'Run Backtest'}
          </button>
        </div>
      </div>

      {error && <p className="text-[#FF006E] mb-4">{error}</p>}

      {result && result.metrics && (
        <div className="space-y-4">
          {/* Performance Summary */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Total Return</p>
              <p className={`text-xl font-bold ${metricColor(result.metrics.total_return_pct)}`}>
                {result.metrics.total_return_pct > 0 ? '+' : ''}{result.metrics.total_return_pct.toFixed(2)}%
              </p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Sharpe Ratio</p>
              <p className={`text-xl font-bold ${result.metrics.sharpe_ratio > 1 ? 'text-[#00C805]' : 'text-[#FFD700]'}`}>
                {result.metrics.sharpe_ratio.toFixed(2)}
              </p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Max Drawdown</p>
              <p className={`text-xl font-bold ${metricColor(result.metrics.max_drawdown_pct, false)}`}>
                -{result.metrics.max_drawdown_pct.toFixed(2)}%
              </p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Win Rate</p>
              <p className={`text-xl font-bold ${result.metrics.win_rate > 50 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                {result.metrics.win_rate.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Additional Metrics */}
          <div className="grid grid-cols-5 gap-3">
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Trades</p>
              <p className="text-lg font-bold">{result.metrics.total_trades}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Profit Factor</p>
              <p className="text-lg font-bold text-[#FFD700]">{result.metrics.profit_factor.toFixed(2)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Calmar Ratio</p>
              <p className="text-lg font-bold">{result.metrics.calmar_ratio.toFixed(2)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Avg P&L</p>
              <p className={`text-lg font-bold ${metricColor(result.metrics.avg_pnl)}`}>
                ${result.metrics.avg_pnl.toFixed(0)}
              </p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Final Equity</p>
              <p className="text-lg font-bold text-[#FFD700]">${result.metrics.final_equity.toLocaleString()}</p>
            </div>
          </div>

          {/* Trade History */}
          <div className="bg-[#1E1E1E] rounded-lg p-4">
            <h4 className="text-sm text-gray-400 mb-2">Trade History ({result.trades.length} trades)</h4>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-500">
                  <tr>
                    <th className="text-left pb-2">Entry</th>
                    <th className="text-left pb-2">Exit</th>
                    <th className="text-left pb-2">Type</th>
                    <th className="text-right pb-2">P&L</th>
                    <th className="text-right pb-2">IV/HV</th>
                    <th className="text-left pb-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((trade, i) => (
                    <tr key={i} className="border-t border-gray-700">
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
      )}

      {!result && !loading && (
        <p className="text-gray-500 text-sm">Configure parameters and click &quot;Run Backtest&quot; to test the volatility arbitrage strategy on {ticker}</p>
      )}
    </div>
  );
}
