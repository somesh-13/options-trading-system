// 01 — Dashboard (/)
window.__VE_PAGES.push({
  id: 'dashboard',
  nav: 'Dashboard (home)',
  group: 'core',
  render: () => `
    <div class="page-head">
      <div>
        <div class="breadcrumb">Core flow · entry point</div>
        <h1>Dashboard <span class="route">/</span></h1>
      </div>
      <div class="meta">
        <b>src/app/page.tsx</b><br/>
        MispricingDetector + nav grid<br/>
        "Options Trading Dashboard"
      </div>
    </div>
    <p class="lede">
      The current home is a <b>17-button link grid</b> above a single-ticker mispricing widget. It forces every user — new or power — through a menu choice before anything useful happens. The revamp replaces it with a <b>Today's opportunities</b> surface: the scanner output is the home screen, with global context (regime, P&L, VaR) persistently visible.
    </p>

    <div class="critique">
      <h3>What's wrong</h3>
      <ol>
        <li><span class="tag crit">Nav</span><b>17 link-buttons in a wrap-grid</b>, colored by accent (<code>#00C805</code>/<code>#FFD700</code>/<code>#FF006E</code>) with no consistent meaning. Colors seem decorative. No grouping — "Portfolio Monitor" sits between "Risk Management" and "Live Trading".</li>
        <li><span class="tag crit">Hierarchy</span>The 4xl "Options Trading Dashboard" title + "Quantitative Volatility Arbitrage System" subtitle burn 100px before any data. On a 1080p viewport the ticker analyzer is already below the fold.</li>
        <li><span class="tag">Content</span>The <b>System Architecture</b> card at the bottom ("Phase 1 / Phase 2–5 / Phase 6–7") reads like a project roadmap, not a user surface. Belongs on a docs page, not the home.</li>
        <li><span class="tag">Flow</span>User lands here and must: (1) type a ticker → (2) press Analyze → (3) read one MispricingDetector widget → (4) click "Scanner" to compare. The scanner should <i>be</i> the home.</li>
        <li><span class="tag">Default</span>Hard-coded <code>CIFR</code> as default ticker. Fine for dev, wrong for prod — default should be "my watchlist" or "last viewed".</li>
      </ol>
    </div>

    <div class="ba">
      <div class="frame">
        <div class="frame-head"><span class="label before">Before</span><span class="title">Current dashboard</span></div>
        <div class="frame-body">
          <div class="screen legacy">
            <h2>Options Trading Dashboard</h2>
            <div class="muted">Quantitative Volatility Arbitrage System</div>
            <div class="link-row">
              <a>Pricing Calculator</a>
              <a>Vol Surface</a>
              <a>Risk &amp; P&amp;L</a>
              <a>Scanner</a>
              <a class="g">NLP Sentiment</a>
              <a class="y">Backtesting</a>
              <a class="y">Strategy &amp; Hedging</a>
              <a class="p">Risk Management</a>
              <a class="g">Portfolio Monitor</a>
              <a class="p">Live Trading</a>
              <a class="g">Trade Journal</a>
              <a class="p">Auto Engine</a>
              <a class="g">Positions</a>
              <a class="y">Option Chain</a>
              <a class="y">VegaEdge Live Agent</a>
              <a>API Docs</a>
            </div>
            <div style="display:flex;gap:10px;margin:10px 0 14px;">
              <input class="input" value="CIFR" readonly/>
              <button class="btn-g">Analyze</button>
            </div>
            <div class="card">
              <div class="muted" style="margin-bottom:8px;">&lt;MispricingDetector ticker="CIFR" /&gt;</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                <div><div class="muted">IV ATM</div><div style="font-size:18px;font-weight:700;">72.4%</div></div>
                <div><div class="muted">HV 30</div><div style="font-size:18px;font-weight:700;">49.8%</div></div>
                <div><div class="muted">IV/HV</div><div style="font-size:18px;font-weight:700;" class="pill-y">1.45x</div></div>
              </div>
              <div style="margin-top:8px;font-size:11px;"><span class="pill-y">SELL</span> — overpriced premium</div>
            </div>
            <div class="card" style="margin-top:10px;">
              <div style="font-size:14px;font-weight:700;margin-bottom:8px;">System Architecture</div>
              <div class="grid-3">
                <div class="arch-card">
                  <h4 style="color:var(--green);">Pricing Engine</h4>
                  <ul><li>Black-Scholes</li><li>8 Greeks</li><li>IV solver</li><li>HMM Regime</li></ul>
                </div>
                <div class="arch-card">
                  <h4 style="color:var(--gold);">Strategy</h4>
                  <ul><li>NLP Sentiment</li><li>EV Calculator</li><li>Δ-Γ Hedging</li><li>Backtesting</li></ul>
                </div>
                <div class="arch-card">
                  <h4 style="color:var(--pink);">Risk &amp; Exec</h4>
                  <ul><li>VaR H/P/MC</li><li>Position limits</li><li>Portfolio Greeks</li><li>Alpaca Paper</li></ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="frame">
        <div class="frame-head"><span class="label after">After</span><span class="title">Opportunity-led home</span></div>
        <div class="frame-body">
          ${RV.shell({ page: 'Today', crumb: 'Home · Today', content: dashboardAfter() })}
        </div>
      </div>
    </div>

    <div class="critique">
      <h3>What changed in the revamp</h3>
      <ol>
        <li><span class="tag">Nav</span><b>Persistent left rail</b> with icons + labels on hover. Groups: Trade (scanner, chain, ticket), Monitor (portfolio, positions, risk), Research (pricing, vol surface, backtest, sentiment), Automation (auto-engine, journal, agent). The dashboard link-grid is gone.</li>
        <li><span class="tag">Nav</span><b>Top bar</b> carries the global state: paper/live, regime (from HMM), 1-day VaR, daily P&L. Always visible, never drift.</li>
        <li><span class="tag">Flow</span><b>Home = today's opportunities</b>, ranked by EV with regime context, IV/HV, and a one-click "Open chain" per row. User arrives and sees work to do.</li>
        <li><span class="tag">Hierarchy</span>Page title is a small 20px label — the grid is the hero. KPI strip at the top: NAV, Day P&L, Open positions, VaR breach %.</li>
        <li><span class="tag">Data viz</span>IV/HV shown as a <b>position on a scale</b> with shaded BUY (&lt;0.8) / SELL (&gt;1.3) zones. No more reading "1.45x".</li>
        <li><span class="tag">Command</span><code>⌘K</code> command palette in top bar — type a ticker, an action ("buy CIFR", "scan Mag 7"), or a page name.</li>
      </ol>
    </div>
  `
});

function dashboardAfter() {
  return `
    <h2 class="rv-h1">Today</h2>
    <div class="rv-sub">Wed Apr 23 · opportunities ranked by expected value · regime-aware</div>

    <div class="rv-grid-4" style="margin-bottom:14px;">
      <div class="rv-kpi"><div class="k">NAV</div><div class="v">$142,080</div><div class="d up">+$1,240 · +0.88%</div></div>
      <div class="rv-kpi"><div class="k">Day P&L</div><div class="v rv-up">+$1,240</div><div class="d">23 positions · 5 new</div></div>
      <div class="rv-kpi"><div class="k">1-day VaR 95%</div><div class="v">$2,840</div><div class="d">2.0% NAV · within limits</div></div>
      <div class="rv-kpi"><div class="k">Daily trades</div><div class="v">4 / 10</div><div class="d">loss $120 / $1,000 cap</div></div>
    </div>

    <div class="rv-card">
      <div class="rv-card-head">
        <h3>Top opportunities — ranked by EV</h3>
        <div class="tools">
          <span class="on">My watchlist</span><span>Mag 7</span><span>Mispriced</span><span>+ filter</span>
        </div>
      </div>
      <table class="rv-table">
        <thead><tr>
          <th>Ticker</th><th class="r">Spot</th><th>IV / HV</th><th class="r">Ratio</th>
          <th>Signal</th><th>Regime</th><th class="r">EV / contract</th><th class="r">Hit rate</th><th></th>
        </tr></thead>
        <tbody>
          ${[
            ['CIFR', 15.50, 0.724, 0.498, 1.45, 'SELL', 'high-vol', 82, 0.61],
            ['WULF', 8.22, 0.681, 0.512, 1.33, 'SELL', 'high-vol', 64, 0.58],
            ['HOOD', 21.40, 0.412, 0.381, 1.08, 'NEUTRAL', 'normal', 18, 0.51],
            ['MARA', 19.85, 0.922, 0.610, 1.51, 'SELL', 'high-vol', 94, 0.66],
            ['PYPL', 68.20, 0.281, 0.352, 0.80, 'BUY', 'normal', 41, 0.55],
            ['RIOT', 11.10, 0.711, 0.918, 0.77, 'BUY', 'high-vol', 52, 0.57],
            ['COIN', 182.40, 0.505, 0.488, 1.04, 'NEUTRAL', 'normal', 12, 0.49],
            ['GRAB', 4.85, 0.322, 0.421, 0.76, 'BUY', 'normal', 28, 0.54],
          ].map(([t,p,iv,hv,r,sig,reg,ev,hr],i) => `
            <tr class="${i===3?'sel':''}">
              <td><b>${t}</b></td>
              <td class="r">${p.toFixed(2)}</td>
              <td>${RV.ivhvScale(iv,hv,r)}</td>
              <td class="r ${r>1.3?'rv-up':r<0.8?'rv-dn':''}">${r.toFixed(2)}x</td>
              <td><span class="rv-chip ${sig==='BUY'?'buy':sig==='SELL'?'sell':'neutral'}">${sig}</span></td>
              <td><span class="rv-chip ${reg==='high-vol'?'warn':reg==='normal'?'buy':'neutral'}" style="background:transparent;">${reg}</span></td>
              <td class="r"><b>$${ev}</b></td>
              <td class="r">${(hr*100).toFixed(0)}%</td>
              <td><span class="rv-btn ghost" style="font-size:11px;padding:3px 8px;">chain →</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="rv-grid-2" style="margin-top:14px;">
      <div class="rv-card">
        <div class="rv-card-head">
          <h3>Portfolio Greeks — live</h3>
          <div class="tools"><span class="on">Aggregate</span><span>By ticker</span></div>
        </div>
        <div class="rv-greeks" style="grid-template-columns:repeat(4,1fr);">
          <div class="rv-greek"><div class="sym">Δ<span class="ord">1</span></div><div class="val">+284.4</div><div class="sub">$ delta = $44.2k</div></div>
          <div class="rv-greek"><div class="sym">Γ<span class="ord">1</span></div><div class="val">+18.2</div><div class="sub">per $1 move</div></div>
          <div class="rv-greek"><div class="sym">Θ<span class="ord">1</span></div><div class="val rv-up">+$312</div><div class="sub">/ day</div></div>
          <div class="rv-greek"><div class="sym">V<span class="ord">1</span></div><div class="val rv-dn">−$1,840</div><div class="sub">per 1 vol pt</div></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--ink-mute);font-family:'JetBrains Mono';">net short vol · long theta · mild delta long</div>
      </div>

      <div class="rv-card">
        <div class="rv-card-head">
          <h3>Recent signals — from auto-engine</h3>
          <div class="tools"><span>all</span><span class="on">exec + signal</span></div>
        </div>
        <div class="rv-log">
          <div class="row"><span class="t">12:08:42</span><span class="ev exec">EXEC</span><span class="sym">CIFR</span><span class="msg">SELL 3x CIFR240517C00016000 @ $0.82</span></div>
          <div class="row"><span class="t">11:54:01</span><span class="ev signal">SIGNAL</span><span class="sym">WULF</span><span class="msg">IV/HV = 1.33 · EV $64 · approved</span></div>
          <div class="row"><span class="t">11:31:15</span><span class="ev skip">SKIP</span><span class="sym">HOOD</span><span class="msg">EV $18 below threshold $50</span></div>
          <div class="row"><span class="t">11:05:22</span><span class="ev scan">SCAN</span><span class="sym">—</span><span class="msg">8 tickers · 2 signals · 1 exec</span></div>
        </div>
      </div>
    </div>
  `;
}
