'use client';

import type { SignalEntry } from '@/hooks/useVegaEdgeSession';

interface SignalPanelProps {
  signals: SignalEntry[];
}

function SignalBadge({ signal }: { signal?: string }) {
  const color =
    signal === 'BUY' ? 'bg-[#00C805]/20 text-[#00C805]'
    : signal === 'SELL' ? 'bg-[#FF006E]/20 text-[#FF006E]'
    : 'bg-gray-500/20 text-gray-400';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>
      {signal ?? 'NEUTRAL'}
    </span>
  );
}

export default function SignalPanel({ signals }: SignalPanelProps) {
  const reversed = [...signals].reverse();

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-[#00C805] uppercase tracking-wider mb-3">
        Signals ({signals.length})
      </h3>

      <div className="flex-1 overflow-y-auto max-h-[600px] space-y-3 pr-1">
        {signals.length === 0 && (
          <p className="text-gray-500 text-sm">Signals will appear as VegaEdge analyzes tickers...</p>
        )}

        {reversed.map((s, i) => (
          <div
            key={i}
            className={`rounded-lg p-3 border ${
              s.watchlist
                ? 'border-[#FFD700]/30 bg-[#FFD700]/5'
                : s.signal === 'SELL'
                  ? 'border-[#FF006E]/30 bg-[#FF006E]/5'
                  : s.signal === 'BUY'
                    ? 'border-[#00C805]/30 bg-[#00C805]/5'
                    : 'border-gray-600/30 bg-[#1E1E1E]'
            }`}
          >
            {s.watchlist ? (
              <>
                <p className="text-xs text-gray-400 mb-1">Watchlist Scan</p>
                <p className="text-sm text-gray-300 mb-2">{s.summary}</p>
                <div className="space-y-1">
                  {s.watchlist.slice(0, 5).map((w, j) => (
                    <div key={j} className="flex items-center justify-between text-xs">
                      <span className="font-mono font-bold text-gray-200">{w.ticker}</span>
                      <div className="flex items-center gap-2">
                        <SignalBadge signal={w.signal} />
                        {w.iv_hv_ratio != null && (
                          <span className="text-gray-500">{w.iv_hv_ratio.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-bold text-lg">{s.ticker ?? '---'}</span>
                  <SignalBadge signal={s.signal} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
                  {s.iv_hv_ratio != null && (
                    <span>IV/HV: <span className="text-gray-200">{s.iv_hv_ratio.toFixed(2)}</span></span>
                  )}
                  {s.spot_price != null && (
                    <span>Spot: <span className="text-gray-200">${s.spot_price.toFixed(2)}</span></span>
                  )}
                  {s.historical_vol != null && (
                    <span>HV: <span className="text-gray-200">{(s.historical_vol * 100).toFixed(1)}%</span></span>
                  )}
                  {s.implied_vol_atm != null && (
                    <span>IV: <span className="text-gray-200">{(s.implied_vol_atm * 100).toFixed(1)}%</span></span>
                  )}
                  {s.expiration && (
                    <span>Exp: <span className="text-gray-200">{s.expiration}</span></span>
                  )}
                  {s.atm_strike != null && (
                    <span>ATM: <span className="text-gray-200">${s.atm_strike.toFixed(0)}</span></span>
                  )}
                </div>
                {s.opportunity && (
                  <p className="mt-2 text-xs text-[#FFD700] font-medium">{s.opportunity}</p>
                )}
              </>
            )}
            {s.timestamp && (
              <p className="text-[10px] text-gray-600 mt-2">
                {s.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
