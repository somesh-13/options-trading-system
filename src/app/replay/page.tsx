'use client';

import { useState } from 'react';
import { runReplay, replayPdfUrl, type ReplayResult } from '@/lib/pricing-api';

export default function ReplayPage() {
  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);

  const [ticker, setTicker] = useState('NVDA');
  const [start, setStart] = useState(oneYearAgo);
  const [end, setEnd] = useState(today);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await runReplay(ticker, start, end);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed');
    } finally {
      setLoading(false);
    }
  };

  const m = result?.metrics;

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="rv-h1">Historical Replay &amp; AI Coaching</h2>
        <div className="rv-sub">Walk-forward replay with daily P&amp;L attribution and AI coaching.</div>

        <div className="bg-[#2D2D2D] rounded-lg p-3 sm:p-5 mb-4 sm:mb-6 flex flex-wrap gap-2 sm:gap-3 items-end">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-28 bg-[#1E1E1E] text-white px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-[#00C805]"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Start</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="bg-[#1E1E1E] text-white px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-[#00C805]" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">End</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="bg-[#1E1E1E] text-white px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-[#00C805]" />
          </div>
          <button
            onClick={handleRun}
            disabled={loading}
            className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] disabled:bg-gray-600 text-white font-bold rounded-lg transition-colors"
          >
            {loading ? 'Running…' : 'Run Replay'}
          </button>
          {result && (
            <a
              href={replayPdfUrl(result.replay_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-[#2D2D2D] border border-[#FFD700]/50 hover:bg-[#333] rounded-lg text-[#FFD700] text-sm font-semibold"
            >
              Export PDF
            </a>
          )}
        </div>

        {error && <div className="text-[#FF006E] mb-4">{error}</div>}

        {m && result && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-4 sm:mb-6">
              <Card label="Total P&L" value={`${m.total_pnl >= 0 ? '+' : ''}$${m.total_pnl.toFixed(0)}`} color={m.total_pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'} />
              <Card label="Trades" value={String(m.trades)} />
              <Card label="Win Rate" value={m.win_rate != null ? `${(m.win_rate * 100).toFixed(1)}%` : '—'} />
              <Card label="Avg P&L" value={`$${m.avg_pnl.toFixed(0)}`} />
              <Card label="Max DD" value={`$${m.max_drawdown.toFixed(0)}`} color="text-[#FF006E]" />
              <Card label="Sharpe" value={m.sharpe != null ? m.sharpe.toFixed(2) : '—'} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
              <div className="lg:col-span-2 bg-[#2D2D2D] rounded-lg p-3 sm:p-5">
                <h2 className="text-base sm:text-lg font-semibold mb-3">Daily Timeline ({result.timeline.length} days)</h2>
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-xs min-w-[600px]">
                    <thead className="text-gray-400 sticky top-0 bg-[#2D2D2D]">
                      <tr>
                        <th className="text-left py-1 pr-3">Day</th>
                        <th className="text-right py-1 pr-3">Price</th>
                        <th className="text-right py-1 pr-3">IV/HV</th>
                        <th className="text-left py-1 pr-3">Keltner</th>
                        <th className="text-right py-1 pr-3">Conf.</th>
                        <th className="text-left py-1 pr-3">Strategy</th>
                        <th className="text-right py-1">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.timeline.map((d) => (
                        <tr key={d.day} className={`border-t border-gray-700/30 ${d.trade ? 'bg-[#1E1E1E]/40' : ''}`}>
                          <td className="py-1 pr-3">{d.day}</td>
                          <td className="py-1 pr-3 text-right">${d.price.toFixed(2)}</td>
                          <td className="py-1 pr-3 text-right">{d.iv_hv_ratio.toFixed(2)}</td>
                          <td className="py-1 pr-3">{d.keltner_position}</td>
                          <td className={`py-1 pr-3 text-right ${d.confluence_score >= 0.65 ? 'text-[#00C805]' : 'text-gray-400'}`}>
                            {d.confluence_score.toFixed(2)}
                          </td>
                          <td className="py-1 pr-3">{d.strategy ?? '—'}</td>
                          <td className={`py-1 text-right ${d.resolved_pnl == null ? 'text-gray-500' : d.resolved_pnl >= 0 ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
                            {d.resolved_pnl != null ? `${d.resolved_pnl >= 0 ? '+' : ''}${d.resolved_pnl.toFixed(0)}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-[#2D2D2D] rounded-lg p-3 sm:p-5">
                <h2 className="text-base sm:text-lg font-semibold mb-3">AI Coaching</h2>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{result.coaching}</p>

                <h3 className="text-md font-semibold mt-5 mb-2">Win Rate by Bucket</h3>
                <ul className="text-sm space-y-1">
                  {(['high', 'mid', 'low'] as const).map((b) => {
                    const row = m.by_confluence_bucket[b];
                    const rate = row.trades ? (row.wins / row.trades) * 100 : null;
                    const label = b === 'high' ? '≥ 0.65' : b === 'mid' ? '0.50–0.65' : '< 0.50';
                    return (
                      <li key={b} className="flex justify-between text-gray-300">
                        <span>{label}</span>
                        <span>{rate != null ? `${rate.toFixed(0)}%` : '—'} ({row.wins}/{row.trades})</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-lg font-bold ${color || 'text-white'}`}>{value}</p>
    </div>
  );
}
