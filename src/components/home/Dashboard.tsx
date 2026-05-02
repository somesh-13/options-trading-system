'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { IvHvScale } from '@/components/charts/IvHvScale';

/**
 * Home dashboard — port of `dashboardAfter()` from the design source.
 *
 * Currently uses mock data inline. Data wiring (next pass):
 *   KPIs           ← /api/portfolio  +  /api/risk/var  +  /api/auto-engine/state
 *   Opportunities  ← POST /api/strategy/ev/scan  ({ tickers: watchlist })
 *   Greeks         ← /api/portfolio (aggregate)
 *   Recent signals ← /api/auto-engine/events?limit=4&kinds=exec,signal
 */

type Signal = 'BUY' | 'SELL' | 'NEUTRAL';
type Regime = 'normal' | 'high-vol' | 'crash';

type Opportunity = {
  ticker: string;
  spot: number;
  iv: number;
  hv: number;
  ratio: number;
  signal: Signal;
  regime: Regime;
  ev: number;
  hitRate: number;
};

const OPPORTUNITIES: Opportunity[] = [
  { ticker: 'CIFR', spot: 15.50,  iv: 0.724, hv: 0.498, ratio: 1.45, signal: 'SELL',    regime: 'high-vol', ev: 82, hitRate: 0.61 },
  { ticker: 'WULF', spot:  8.22,  iv: 0.681, hv: 0.512, ratio: 1.33, signal: 'SELL',    regime: 'high-vol', ev: 64, hitRate: 0.58 },
  { ticker: 'HOOD', spot: 21.40,  iv: 0.412, hv: 0.381, ratio: 1.08, signal: 'NEUTRAL', regime: 'normal',   ev: 18, hitRate: 0.51 },
  { ticker: 'MARA', spot: 19.85,  iv: 0.922, hv: 0.610, ratio: 1.51, signal: 'SELL',    regime: 'high-vol', ev: 94, hitRate: 0.66 },
  { ticker: 'PYPL', spot: 68.20,  iv: 0.281, hv: 0.352, ratio: 0.80, signal: 'BUY',     regime: 'normal',   ev: 41, hitRate: 0.55 },
  { ticker: 'RIOT', spot: 11.10,  iv: 0.711, hv: 0.918, ratio: 0.77, signal: 'BUY',     regime: 'high-vol', ev: 52, hitRate: 0.57 },
  { ticker: 'COIN', spot: 182.40, iv: 0.505, hv: 0.488, ratio: 1.04, signal: 'NEUTRAL', regime: 'normal',   ev: 12, hitRate: 0.49 },
  { ticker: 'GRAB', spot:  4.85,  iv: 0.322, hv: 0.421, ratio: 0.76, signal: 'BUY',     regime: 'normal',   ev: 28, hitRate: 0.54 },
];

const MAG7 = new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA']);

type OppFilter = 'watchlist' | 'mag7' | 'mispriced';

function filterOpportunities(opps: Opportunity[], f: OppFilter): Opportunity[] {
  if (f === 'mag7') return opps.filter((o) => MAG7.has(o.ticker));
  if (f === 'mispriced') return opps.filter((o) => o.ratio > 1.3 || o.ratio < 0.8);
  return opps;
}

type SignalRow = {
  time: string;
  kind: 'EXEC' | 'SIGNAL' | 'SKIP' | 'SCAN';
  cls: 'exec' | 'signal' | 'skip' | 'scan';
  sym: string;
  msg: string;
};

const SIGNAL_ROWS: SignalRow[] = [
  { time: '12:08:42', kind: 'EXEC',   cls: 'exec',   sym: 'CIFR', msg: 'SELL 3x CIFR240517C00016000 @ $0.82' },
  { time: '11:54:01', kind: 'SIGNAL', cls: 'signal', sym: 'WULF', msg: 'IV/HV = 1.33 · EV $64 · approved' },
  { time: '11:31:15', kind: 'SKIP',   cls: 'skip',   sym: 'HOOD', msg: 'EV $18 below threshold $50' },
  { time: '11:05:22', kind: 'SCAN',   cls: 'scan',   sym: '—',    msg: '8 tickers · 2 signals · 1 exec' },
];

type SignalFilter = 'all' | 'exec-signal';

type GreeksMode = 'aggregate' | 'by-ticker';

// Per-ticker Greek contributions for the by-ticker view.
// Stays consistent with the aggregate totals (sums approximately to the aggregate).
type PerTickerGreeks = { ticker: string; delta: number; gamma: number; theta: number; vega: number };

const BY_TICKER: PerTickerGreeks[] = [
  { ticker: 'CIFR', delta:  +96.2, gamma:  +6.1, theta:  +112, vega:   -640 },
  { ticker: 'MARA', delta:  +82.7, gamma:  +5.4, theta:   +98, vega:   -510 },
  { ticker: 'WULF', delta:  +52.1, gamma:  +3.0, theta:   +61, vega:   -380 },
  { ticker: 'PYPL', delta:  +33.4, gamma:  +2.1, theta:   +28, vega:   -180 },
  { ticker: 'HOOD', delta:  +20.0, gamma:  +1.6, theta:   +13, vega:   -130 },
];

function signalChipClass(s: Signal): string {
  return s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : 'neutral';
}
function regimeChipClass(r: Regime): string {
  return r === 'high-vol' ? 'warn' : r === 'normal' ? 'buy' : 'neutral';
}

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const chipBtnStyle: React.CSSProperties = {
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'inherit',
};

export function Dashboard() {
  const [oppFilter, setOppFilter] = useState<OppFilter>('watchlist');
  const [greeksMode, setGreeksMode] = useState<GreeksMode>('aggregate');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('exec-signal');

  const visibleOpps = useMemo(() => filterOpportunities(OPPORTUNITIES, oppFilter), [oppFilter]);

  const visibleSignals = useMemo(() => {
    if (signalFilter === 'all') return SIGNAL_ROWS;
    return SIGNAL_ROWS.filter((r) => r.kind === 'EXEC' || r.kind === 'SIGNAL');
  }, [signalFilter]);

  return (
    <>
      <h2 className="rv-h1">Today</h2>
      <div className="rv-sub">
        {TODAY} · opportunities ranked by expected value · regime-aware
      </div>

      <div className="rv-grid-4" style={{ marginBottom: 14 }}>
        <div className="rv-kpi">
          <div className="k">NAV</div>
          <div className="v">$142,080</div>
          <div className="d up">+$1,240 · +0.88%</div>
        </div>
        <div className="rv-kpi">
          <div className="k">Day P&amp;L</div>
          <div className="v rv-up">+$1,240</div>
          <div className="d">23 positions · 5 new</div>
        </div>
        <div className="rv-kpi">
          <div className="k">1-day VaR 95%</div>
          <div className="v">$2,840</div>
          <div className="d">2.0% NAV · within limits</div>
        </div>
        <div className="rv-kpi">
          <div className="k">Daily trades</div>
          <div className="v">4 / 10</div>
          <div className="d">loss $120 / $1,000 cap</div>
        </div>
      </div>

      <div className="rv-card">
        <div className="rv-card-head">
          <h3>Top opportunities — ranked by EV</h3>
          <div className="tools">
            <button
              type="button"
              style={chipBtnStyle}
              className={oppFilter === 'watchlist' ? 'on' : ''}
              onClick={() => setOppFilter('watchlist')}
            >
              My watchlist
            </button>
            <button
              type="button"
              style={chipBtnStyle}
              className={oppFilter === 'mag7' ? 'on' : ''}
              onClick={() => setOppFilter('mag7')}
            >
              Mag 7
            </button>
            <button
              type="button"
              style={chipBtnStyle}
              className={oppFilter === 'mispriced' ? 'on' : ''}
              onClick={() => setOppFilter('mispriced')}
            >
              Mispriced
            </button>
          </div>
        </div>
        <div className="rv-table-wrap">
        <table className="rv-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="r">Spot</th>
              <th>IV / HV</th>
              <th className="r">Ratio</th>
              <th>Signal</th>
              <th>Regime</th>
              <th className="r">EV / contract</th>
              <th className="r">Hit rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleOpps.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 14, color: 'var(--ink-mute)', fontSize: 12 }}>
                  no opportunities match this filter
                </td>
              </tr>
            ) : (
              visibleOpps.map((o, i) => (
                <tr key={o.ticker} className={i === 3 ? 'sel' : ''}>
                  <td>
                    <Link href={`/stock/${o.ticker}`} prefetch className="rv-ticker-link">
                      {o.ticker}
                    </Link>
                  </td>
                  <td className="r">{o.spot.toFixed(2)}</td>
                  <td><IvHvScale iv={o.iv} hv={o.hv} ratio={o.ratio} /></td>
                  <td className={`r ${o.ratio > 1.3 ? 'rv-up' : o.ratio < 0.8 ? 'rv-dn' : ''}`}>
                    {o.ratio.toFixed(2)}x
                  </td>
                  <td><span className={`rv-chip ${signalChipClass(o.signal)}`}>{o.signal}</span></td>
                  <td>
                    <span className={`rv-chip ${regimeChipClass(o.regime)}`} style={{ background: 'transparent' }}>
                      {o.regime}
                    </span>
                  </td>
                  <td className="r"><b>${o.ev}</b></td>
                  <td className="r">{(o.hitRate * 100).toFixed(0)}%</td>
                  <td>
                    <Link
                      href={`/options-chain?ticker=${o.ticker}`}
                      className="rv-btn ghost"
                      style={{ fontSize: 11, padding: '3px 8px', textDecoration: 'none' }}
                    >
                      chain →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="rv-grid-2" style={{ marginTop: 14 }}>
        <div className="rv-card">
          <div className="rv-card-head">
            <h3>Portfolio Greeks — live</h3>
            <div className="tools">
              <button
                type="button"
                style={chipBtnStyle}
                className={greeksMode === 'aggregate' ? 'on' : ''}
                onClick={() => setGreeksMode('aggregate')}
              >
                Aggregate
              </button>
              <button
                type="button"
                style={chipBtnStyle}
                className={greeksMode === 'by-ticker' ? 'on' : ''}
                onClick={() => setGreeksMode('by-ticker')}
              >
                By ticker
              </button>
            </div>
          </div>
          {greeksMode === 'aggregate' ? (
            <>
              <div className="rv-greeks cols-4">
                <div className="rv-greek">
                  <div className="sym">Δ<span className="ord">1</span></div>
                  <div className="val">+284.4</div>
                  <div className="sub">$ delta = $44.2k</div>
                </div>
                <div className="rv-greek">
                  <div className="sym">Γ<span className="ord">1</span></div>
                  <div className="val">+18.2</div>
                  <div className="sub">per $1 move</div>
                </div>
                <div className="rv-greek">
                  <div className="sym">Θ<span className="ord">1</span></div>
                  <div className="val rv-up">+$312</div>
                  <div className="sub">/ day</div>
                </div>
                <div className="rv-greek">
                  <div className="sym">V<span className="ord">1</span></div>
                  <div className="val rv-dn">−$1,840</div>
                  <div className="sub">per 1 vol pt</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
                net short vol · long theta · mild delta long
              </div>
            </>
          ) : (
            <table className="rv-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="r">Δ</th>
                  <th className="r">Γ</th>
                  <th className="r">Θ ($/d)</th>
                  <th className="r">V ($/vol pt)</th>
                </tr>
              </thead>
              <tbody>
                {BY_TICKER.map((g) => (
                  <tr key={g.ticker}>
                    <td>
                      <Link href={`/stock/${g.ticker}`} prefetch className="rv-ticker-link">
                        {g.ticker}
                      </Link>
                    </td>
                    <td className="r">{g.delta.toFixed(1)}</td>
                    <td className="r">{g.gamma.toFixed(1)}</td>
                    <td className={`r ${g.theta >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {g.theta >= 0 ? '+' : ''}{g.theta}
                    </td>
                    <td className={`r ${g.vega >= 0 ? 'rv-up' : 'rv-dn'}`}>
                      {g.vega >= 0 ? '+' : ''}{g.vega}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rv-card">
          <div className="rv-card-head">
            <h3>Recent signals — from auto-engine</h3>
            <div className="tools">
              <button
                type="button"
                style={chipBtnStyle}
                className={signalFilter === 'all' ? 'on' : ''}
                onClick={() => setSignalFilter('all')}
              >
                all
              </button>
              <button
                type="button"
                style={chipBtnStyle}
                className={signalFilter === 'exec-signal' ? 'on' : ''}
                onClick={() => setSignalFilter('exec-signal')}
              >
                exec + signal
              </button>
            </div>
          </div>
          <div className="rv-log">
            {visibleSignals.map((row) => (
              <div className="row" key={`${row.time}-${row.kind}`}>
                <span className="t">{row.time}</span>
                <span className={`ev ${row.cls}`}>{row.kind}</span>
                <span className="sym">{row.sym}</span>
                <span className="msg">{row.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
