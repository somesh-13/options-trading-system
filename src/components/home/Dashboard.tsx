import Link from 'next/link';
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

function signalChipClass(s: Signal): string {
  return s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : 'neutral';
}
function regimeChipClass(r: Regime): string {
  return r === 'high-vol' ? 'warn' : r === 'normal' ? 'buy' : 'neutral';
}

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function Dashboard() {
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
            <span className="on">My watchlist</span>
            <span>Mag 7</span>
            <span>Mispriced</span>
            <span>+ filter</span>
          </div>
        </div>
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
            {OPPORTUNITIES.map((o, i) => (
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
            ))}
          </tbody>
        </table>
      </div>

      <div className="rv-grid-2" style={{ marginTop: 14 }}>
        <div className="rv-card">
          <div className="rv-card-head">
            <h3>Portfolio Greeks — live</h3>
            <div className="tools"><span className="on">Aggregate</span><span>By ticker</span></div>
          </div>
          <div className="rv-greeks" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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
        </div>

        <div className="rv-card">
          <div className="rv-card-head">
            <h3>Recent signals — from auto-engine</h3>
            <div className="tools"><span>all</span><span className="on">exec + signal</span></div>
          </div>
          <div className="rv-log">
            <div className="row"><span className="t">12:08:42</span><span className="ev exec">EXEC</span><span className="sym">CIFR</span><span className="msg">SELL 3x CIFR240517C00016000 @ $0.82</span></div>
            <div className="row"><span className="t">11:54:01</span><span className="ev signal">SIGNAL</span><span className="sym">WULF</span><span className="msg">IV/HV = 1.33 · EV $64 · approved</span></div>
            <div className="row"><span className="t">11:31:15</span><span className="ev skip">SKIP</span><span className="sym">HOOD</span><span className="msg">EV $18 below threshold $50</span></div>
            <div className="row"><span className="t">11:05:22</span><span className="ev scan">SCAN</span><span className="sym">—</span><span className="msg">8 tickers · 2 signals · 1 exec</span></div>
          </div>
        </div>
      </div>
    </>
  );
}
