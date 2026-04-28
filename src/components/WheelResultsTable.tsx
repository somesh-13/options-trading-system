'use client';

import { useEffect, useState } from 'react';
import { PRICING_API_URL } from '@/lib/pricing-api';

interface WheelAggregates {
  csp_fires: number;
  csp_capped: number;
  cc_fires: number;
  cc_skipped_below_basis: number;
  csp_premium_usd: number;
  cc_premium_usd: number;
  realized_share_pnl_usd: number;
  unrealized_share_pnl_usd: number;
  final_spot: number;
  avg_cost_basis: number;
  max_capital_usd: number;
  total_return_usd: number;
  return_pct_of_max_cap: number;
}

interface TickerResult {
  ticker: string;
  trade_count: number;
  exercised_count: number;
  final_share_inventory: number;
  wheel?: WheelAggregates;
  error?: string;
}

interface WheelPayload {
  asof: string;
  strategy: string;
  timeframe: string;
  config: Record<string, unknown>;
  results: Record<string, TickerResult>;
}

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

export default function WheelResultsTable() {
  const [data, setData] = useState<WheelPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${PRICING_API_URL}/api/backtest/wheel`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-4 text-[#FF006E]">
        Failed to load wheel backtest: {error}
        <div className="text-gray-400 text-sm mt-1">
          Run <code>python scripts/covered_call_backtest.py --strategy wheel</code> to generate it.
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="text-gray-400">Loading wheel backtest…</div>;
  }

  const rows = Object.values(data.results);
  const totalReturn = rows.reduce((s, r) => s + (r.wheel?.total_return_usd ?? 0), 0);
  const totalCapital = rows.reduce((s, r) => s + (r.wheel?.max_capital_usd ?? 0), 0);
  const totalPremium = rows.reduce(
    (s, r) => s + (r.wheel?.csp_premium_usd ?? 0) + (r.wheel?.cc_premium_usd ?? 0),
    0,
  );
  const totalRlz = rows.reduce((s, r) => s + (r.wheel?.realized_share_pnl_usd ?? 0), 0);
  const totalUnrlz = rows.reduce((s, r) => s + (r.wheel?.unrealized_share_pnl_usd ?? 0), 0);

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-xl font-bold text-white">
          Wheel Backtest — {data.timeframe}, asof {data.asof}
        </h3>
        <div className="text-xs text-gray-400">
          IV/HV gate (CC): {String((data.config as { iv_hv_gate?: number }).iv_hv_gate ?? 1.3)} ·
          {' '}max shares/ticker: {String((data.config as { max_shares_per_ticker?: number }).max_shares_per_ticker ?? 500)} ·
          {' '}seed: {String((data.config as { seed?: number }).seed ?? 42)}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-gray-400 border-b border-[#404040]">
            <tr>
              <th className="py-2 pr-3">Ticker</th>
              <th className="py-2 px-2 text-right">CSP fires</th>
              <th className="py-2 px-2 text-right">CC fires</th>
              <th className="py-2 px-2 text-right">Trades</th>
              <th className="py-2 px-2 text-right">Premium</th>
              <th className="py-2 px-2 text-right">Realized share P&amp;L</th>
              <th className="py-2 px-2 text-right">Unrealized share P&amp;L</th>
              <th className="py-2 px-2 text-right">Total return</th>
              <th className="py-2 px-2 text-right">Max capital</th>
              <th className="py-2 px-2 text-right">Return %</th>
              <th className="py-2 pl-2 text-right">Final shares</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const w = r.wheel;
              if (!w) {
                return (
                  <tr key={r.ticker} className="border-b border-[#404040]/50">
                    <td className="py-2 pr-3 font-bold text-white">{r.ticker}</td>
                    <td colSpan={10} className="py-2 px-2 text-[#FF006E]">
                      {r.error ?? 'no wheel data'}
                    </td>
                  </tr>
                );
              }
              const ret = w.total_return_usd;
              const retCls = ret > 0 ? 'text-[#00C805]' : ret < 0 ? 'text-[#FF006E]' : 'text-gray-400';
              return (
                <tr key={r.ticker} className="border-b border-[#404040]/50">
                  <td className="py-2 pr-3 font-bold text-white">{r.ticker}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{w.csp_fires}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{w.cc_fires}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{r.trade_count}</td>
                  <td className="py-2 px-2 text-right text-gray-300">
                    {fmtUSD(w.csp_premium_usd + w.cc_premium_usd)}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-300">{fmtUSD(w.realized_share_pnl_usd)}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{fmtUSD(w.unrealized_share_pnl_usd)}</td>
                  <td className={`py-2 px-2 text-right font-bold ${retCls}`}>{fmtUSD(ret)}</td>
                  <td className="py-2 px-2 text-right text-gray-300">{fmtUSD(w.max_capital_usd)}</td>
                  <td className={`py-2 px-2 text-right ${retCls}`}>{fmtPct(w.return_pct_of_max_cap)}</td>
                  <td className="py-2 pl-2 text-right text-[#FFD700]">{r.final_share_inventory}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-[#404040] font-bold">
              <td className="py-2 pr-3 text-white">TOTAL</td>
              <td colSpan={3}></td>
              <td className="py-2 px-2 text-right text-white">{fmtUSD(totalPremium)}</td>
              <td className="py-2 px-2 text-right text-white">{fmtUSD(totalRlz)}</td>
              <td className="py-2 px-2 text-right text-white">{fmtUSD(totalUnrlz)}</td>
              <td
                className={`py-2 px-2 text-right ${
                  totalReturn > 0 ? 'text-[#00C805]' : totalReturn < 0 ? 'text-[#FF006E]' : 'text-gray-400'
                }`}
              >
                {fmtUSD(totalReturn)}
              </td>
              <td className="py-2 px-2 text-right text-white">{fmtUSD(totalCapital)}</td>
              <td className="py-2 px-2 text-right text-white">
                {fmtPct(totalCapital > 0 ? (totalReturn / totalCapital) * 100 : 0)}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-400 mt-3 leading-relaxed">
        <p>
          <span className="text-white font-semibold">Strategy:</span> CSP at Keltner=BOTTOM (assigned at expiry if ITM); CC at
          Keltner=TOP &amp; IV/HV&gt;1.3, only if strike &gt; cost basis. Hold to expiry both legs.
          Per-ticker share cap: {String((data.config as { max_shares_per_ticker?: number }).max_shares_per_ticker ?? 500)}.
        </p>
        <p className="mt-1">
          <span className="text-white font-semibold">Capital:</span> peak per-ticker (cash held back for open CSP + shares × cost basis).
          {' '}<span className="text-white font-semibold">IV model:</span> synthetic (rolling HV + noise) — premium decay is
          modeled, not observed.
        </p>
      </div>
    </div>
  );
}
