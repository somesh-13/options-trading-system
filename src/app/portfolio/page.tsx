import { Candles } from '@/components/portfolio/Candles';
import { PnlAttribution } from '@/components/portfolio/PnlAttribution';
import { HedgeCard } from '@/components/portfolio/HedgeCard';
import { PositionsTable } from '@/components/portfolio/PositionsTable';

/**
 * Portfolio page — port of `portfolioAfter()` from the design source
 * (`design/stocks-revamp/project/pages/05-portfolio.js`).
 *
 * Single-viewport dashboard: NAV + equity curve top-left, aggregate Greeks
 * + hedge suggestion top-right, open positions table below.
 *
 * Data wiring (next pass):
 *   NAV / equity / Greeks / positions  ← TODO: wire GET /api/portfolio
 *   Day P&L attribution                ← TODO: wire GET /api/portfolio/attribution
 *   "Rehedge to Δ 0" action            ← TODO: wire POST /api/strategy/hedging
 */
export default function PortfolioPage() {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <h2 className="rv-h1" style={{ margin: 0 }}>Portfolio</h2>
        <span className="rv-sub" style={{ margin: 0 }}>
          4 open · 23 closed MTD · paper
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {/* TODO: wire POST /api/strategy/hedging — rebalance to Δ = 0 */}
          <span className="rv-btn ghost" style={{ fontSize: 11 }}>
            Rehedge to Δ 0
          </span>
        </span>
      </div>

      <div
        className="rv-grid-2"
        style={{ gridTemplateColumns: '1.4fr 1fr', marginBottom: 12 }}
      >
        {/* Left: NAV + equity curve + 4-metric strip */}
        <div className="rv-card">
          <div className="rv-card-head">
            <h3>NAV · $142,080</h3>
            <div className="tools">
              <span>1D</span>
              <span className="on">MTD</span>
              <span>3M</span>
              <span>1Y</span>
            </div>
          </div>
          <div style={{ height: 120 }}>
            <Candles seed={3} height={120} />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              marginTop: 8,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div>
              <div className="rv-sub" style={{ margin: 0 }}>Day</div>
              <div className="rv-up"><b>+$1,240</b></div>
              <div className="rv-sub" style={{ margin: 0 }}>+0.88%</div>
            </div>
            <div>
              <div className="rv-sub" style={{ margin: 0 }}>MTD</div>
              <div className="rv-up"><b>+$4,820</b></div>
              <div className="rv-sub" style={{ margin: 0 }}>+3.51%</div>
            </div>
            <div>
              <div className="rv-sub" style={{ margin: 0 }}>Sharpe</div>
              <div><b>1.84</b></div>
              <div className="rv-sub" style={{ margin: 0 }}>3M</div>
            </div>
            <div>
              <div className="rv-sub" style={{ margin: 0 }}>Max DD</div>
              <div className="rv-dn"><b>&minus;2.1%</b></div>
              <div className="rv-sub" style={{ margin: 0 }}>3M</div>
            </div>
          </div>
        </div>

        {/* Right: Aggregate Greeks + attribution + hedge suggestion */}
        <div className="rv-card">
          <div className="rv-card-head">
            <h3>Aggregate Greeks</h3>
            <span className="rv-chip warn">short vol</span>
          </div>
          <div
            className="rv-greeks"
            style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
          >
            <div className="rv-greek">
              <div className="sym">Δ<span className="ord">1</span></div>
              <div className="val">+284</div>
              <div className="sub">$44.2k delta</div>
            </div>
            <div className="rv-greek">
              <div className="sym">Γ<span className="ord">1</span></div>
              <div className="val">+18.2</div>
              <div className="sub">/ $1 move</div>
            </div>
            <div className="rv-greek">
              <div className="sym">Θ<span className="ord">1</span></div>
              <div className="val rv-up">+$312</div>
              <div className="sub">/ day</div>
            </div>
            <div className="rv-greek">
              <div className="sym">V<span className="ord">1</span></div>
              <div className="val rv-dn">&minus;$1,840</div>
              <div className="sub">/ 1 vol pt</div>
            </div>
          </div>

          <div
            style={{
              borderTop: '1px dashed var(--line)',
              margin: '10px 0',
              paddingTop: 8,
            }}
          >
            <PnlAttribution
              delta={476}
              gamma={248}
              theta={352}
              vega={-72}
              residual={36}
            />
          </div>

          <HedgeCard
            delta={284}
            suggestion="sell 2.8 SPY ES futures · Δ → 0 · Γ unchanged"
          />
        </div>
      </div>

      <PositionsTable />
    </>
  );
}
