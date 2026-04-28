// 02 — Scanner (/scanner)
window.__VE_PAGES.push({
  id: 'scanner',
  nav: 'Scanner',
  group: 'core',
  render: () => `
    <div class="page-head">
      <div><div class="breadcrumb">Core flow · entry to every trade</div><h1>Scanner <span class="route">/scanner</span></h1></div>
      <div class="meta"><b>src/app/scanner/page.tsx</b><br/>manual ticker chips + scan-all button</div>
    </div>
    <p class="lede">
      The scanner is the most important screen — <b>every trade idea starts here</b> — but right now it's a manual chip-list that requires pressing "Scan All" each time and only shows 7 columns (Spot, IV, HV, IV/HV, Signal, Volume). Missing: <b>EV per contract</b>, <b>regime</b>, <b>hit rate</b>, and one-click route into the chain.
    </p>

    <div class="critique">
      <h3>What's wrong</h3>
      <ol>
        <li><span class="tag crit">Flow</span><b>Results don't deep-link anywhere useful.</b> Ticker cells link to <code>/?ticker=X</code> (back to the analyzer widget) instead of <code>/options-chain?ticker=X&exp=…</code>. Every row should be "here's the trade" not "here's more research".</li>
        <li><span class="tag crit">Missing signal</span>Your system has an <b>EV Opportunity Scanner</b> endpoint (<code>POST /api/strategy/ev/scan</code>) — this UI doesn't use it. It only shows IV/HV. Surface EV per contract, probability of profit, and the implied trade (sell call / sell put / buy call).</li>
        <li><span class="tag">Regime</span>No regime column. Your HMM says CIFR is in "high vol" — that matters for a sell-premium signal. Add a column; color by regime.</li>
        <li><span class="tag">Manual</span>User types tickers one at a time via an input. Add watchlist presets (Mag 7, CIFR set, custom) and paste-multiple support.</li>
        <li><span class="tag">Sorting</span>Only 4 columns are sortable. Make every column sortable; remember last sort in localStorage.</li>
        <li><span class="tag">Refresh</span>No auto-refresh. Scanner should poll at the same interval as auto-engine scan (default 5 min) so the list doesn't go stale.</li>
        <li><span class="tag">Sparks</span>No price context — user can't see if the signal is forming or fading. Add a 30-day spark and IV/HV divergence mini-chart per row.</li>
      </ol>
    </div>

    <div class="ba">
      <div class="frame">
        <div class="frame-head"><span class="label before">Before</span><span class="title">Current scanner</span></div>
        <div class="frame-body">
          <div class="screen legacy">
            <div style="display:flex;gap:10px;font-size:11px;color:#a0a0a0;margin-bottom:4px;">Dashboard / <span style="color:#fff;">Multi-Ticker Scanner</span></div>
            <h2>Multi-Ticker Scanner</h2>
            <div class="muted">Scan multiple tickers for IV/HV mispricing opportunities</div>
            <div class="card">
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
                ${['CIFR','MARA','RIOT','COIN'].map(t => `
                  <span style="background:var(--bg-legacy);padding:4px 10px;border-radius:999px;font-size:11px;">${t} <span style="color:#666;">×</span></span>
                `).join('')}
              </div>
              <div style="display:flex;gap:8px;">
                <input class="input" placeholder="Add ticker"/>
                <button style="background:var(--card-legacy);color:#fff;border:1px solid #555;padding:7px 12px;border-radius:8px;font-size:11px;">Add</button>
                <button class="btn-g">Scan All</button>
              </div>
            </div>
            <div class="card" style="padding:0;overflow:hidden;">
              <table class="table">
                <thead><tr>
                  <th>Ticker</th><th class="r">Spot ↓</th><th class="r">IV</th><th class="r">HV</th>
                  <th class="r">IV/HV</th><th style="text-align:center;">Signal</th><th class="r">Volume</th>
                </tr></thead>
                <tbody>
                  ${[
                    ['CIFR',15.50,72.4,49.8,1.45,'SELL',184200],
                    ['MARA',19.85,92.2,61.0,1.51,'SELL',421800],
                    ['RIOT',11.10,71.1,91.8,0.77,'BUY',  98400],
                    ['COIN',182.40,50.5,48.8,1.04,'NEUTRAL',712000],
                  ].map(([t,s,iv,hv,r,sig,v]) => `
                    <tr>
                      <td><span class="pill-g">${t}</span></td>
                      <td class="r">$${s.toFixed(2)}</td>
                      <td class="r">${iv.toFixed(1)}%</td>
                      <td class="r">${hv.toFixed(1)}%</td>
                      <td class="r">${r.toFixed(2)}x</td>
                      <td style="text-align:center;" class="${sig==='SELL'?'pill-y':sig==='BUY'?'pill-g':''}">${sig}</td>
                      <td class="r">${v.toLocaleString()}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="frame">
        <div class="frame-head"><span class="label after">After</span><span class="title">EV-ranked, regime-aware scanner</span></div>
        <div class="frame-body">
          ${RV.shell({ page: 'Scanner', crumb: 'Home · Scanner', content: scannerAfter() })}
        </div>
      </div>
    </div>

    <div class="critique">
      <h3>What changed</h3>
      <ol>
        <li><span class="tag">Flow</span>Every row has <b>chain →</b> and <b>build →</b> buttons that deep-link to the chain with ticker + best expiration preselected, or to the strategy builder.</li>
        <li><span class="tag">EV</span>Added <b>EV / contract</b> as a bar (negative = red left, positive = green right) and <b>hit rate</b>. Both come from <code>POST /api/strategy/ev/scan</code>, which you already have.</li>
        <li><span class="tag">Regime</span>Regime column colored by HMM state. You can filter to "only tickers in high-vol regime" to focus on sell-premium plays.</li>
        <li><span class="tag">Presets</span>Watchlist tabs at the top: <b>My list</b>, <b>Mag 7</b>, <b>Mispriced</b> (auto-computed from full universe), <b>Custom</b>.</li>
        <li><span class="tag">Density</span>Row height halved, sparkline added, IV/HV scale replaces raw number. No information lost; 2× rows visible.</li>
        <li><span class="tag">Hotkeys</span><code>/</code> filter, <code>j/k</code> navigate rows, <code>⏎</code> open chain. Quant users will live here.</li>
      </ol>
    </div>
  `
});

function scannerAfter() {
  const rows = [
    ['MARA', 19.85, 0.922, 0.610, 1.51, 'SELL', 'high-vol',  94, 0.66, 3],
    ['CIFR', 15.50, 0.724, 0.498, 1.45, 'SELL', 'high-vol',  82, 0.61, 2],
    ['WULF',  8.22, 0.681, 0.512, 1.33, 'SELL', 'high-vol',  64, 0.58, 4],
    ['PYPL', 68.20, 0.281, 0.352, 0.80, 'BUY',  'normal',    41, 0.55, 5],
    ['GRAB',  4.85, 0.322, 0.421, 0.76, 'BUY',  'normal',    28, 0.54, 6],
    ['RIOT', 11.10, 0.711, 0.918, 0.77, 'BUY',  'high-vol',  52, 0.57, 7],
    ['HOOD', 21.40, 0.412, 0.381, 1.08, 'NEUTRAL','normal',  18, 0.51, 8],
    ['COIN',182.40, 0.505, 0.488, 1.04, 'NEUTRAL','normal',  12, 0.49, 9],
  ];
  return `
    <h2 class="rv-h1">Scanner</h2>
    <div class="rv-sub">Live scan · 8 of 112 watchlist tickers showing · next auto-scan in 2m 14s</div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div style="display:flex;gap:6px;">
        <span class="rv-btn" style="background:var(--line);">My list · 8</span>
        <span class="rv-btn ghost">Mag 7</span>
        <span class="rv-btn ghost">Mispriced · 23</span>
        <span class="rv-btn ghost">+ custom</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="font-size:11px;color:var(--ink-mute);font-family:'JetBrains Mono';">filter:</span>
        <span class="rv-btn ghost" style="font-size:11px;">regime = high-vol</span>
        <span class="rv-btn ghost" style="font-size:11px;">|ratio| &gt; 1.2 × EV &gt; $50</span>
        <span class="rv-btn ghost" style="font-size:11px;">+</span>
      </div>
    </div>

    <div class="rv-card" style="padding:0;">
      <table class="rv-table" style="font-size:11.5px;">
        <thead><tr>
          <th></th><th>Ticker</th><th>Spark 30d</th><th class="r">Spot</th>
          <th>IV / HV</th><th class="r">Ratio ↓</th>
          <th>Signal</th><th>Regime</th>
          <th style="min-width:110px;">EV / contract</th>
          <th class="r">Hit</th><th class="r">Vol</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map(([t,p,iv,hv,r,sig,reg,ev,hr,seed],i) => {
            const evMax = 100;
            const evPct = Math.min(100, Math.abs(ev)/evMax*50);
            const evBar = `
              <div class="rv-ev-bar">
                ${ev>=0
                  ? `<i class="pos" style="width:${evPct}%;"></i>`
                  : `<i class="neg" style="width:${evPct}%;"></i>`}
              </div>`;
            const regClass = reg==='high-vol'?'warn':reg==='normal'?'buy':'neutral';
            return `
              <tr class="${i===0?'sel':''}">
                <td class="r" style="color:var(--ink-mute);font-size:10px;">${i+1}</td>
                <td><b>${t}</b></td>
                <td style="width:60px;">${RV.spark(seed, sig==='BUY'?'var(--green)':sig==='SELL'?'var(--gold)':'var(--ink-mute)', sig==='BUY')}</td>
                <td class="r">${p.toFixed(2)}</td>
                <td>${RV.ivhvScale(iv,hv,r)}</td>
                <td class="r ${r>1.3?'rv-up':r<0.8?'rv-dn':''}"><b>${r.toFixed(2)}x</b></td>
                <td><span class="rv-chip ${sig==='BUY'?'buy':sig==='SELL'?'sell':'neutral'}">${sig}</span></td>
                <td><span class="rv-chip ${regClass}" style="background:transparent;">${reg}</span></td>
                <td style="min-width:110px;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    ${evBar}
                    <span style="font-family:'JetBrains Mono';font-size:10px;color:${ev>=0?'var(--green)':'var(--pink)'};min-width:30px;text-align:right;"><b>$${ev}</b></span>
                  </div>
                </td>
                <td class="r">${(hr*100).toFixed(0)}%</td>
                <td class="r" style="color:var(--ink-mute);">${(Math.abs(Math.sin(seed))*600|0)}k</td>
                <td style="display:flex;gap:4px;">
                  <span class="rv-btn ghost" style="font-size:10px;padding:2px 6px;">chain</span>
                  <span class="rv-btn ghost" style="font-size:10px;padding:2px 6px;">build</span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:10.5px;color:var(--ink-mute);font-family:'JetBrains Mono';">
      <div style="display:flex;gap:10px;align-items:center;">
        <span>8 of 112 shown · sort: ratio desc</span>
        <span class="rv-kbd">/</span> filter
        <span class="rv-kbd">j/k</span> row
        <span class="rv-kbd">⏎</span> open chain
        <span class="rv-kbd">b</span> build trade
      </div>
      <div>auto-refresh: 5m · last: 12:08:42</div>
    </div>
  `;
}
