// 05 — Portfolio monitor (/portfolio)
window.__VE_PAGES.push({
  id: 'portfolio',
  nav: 'Portfolio monitor',
  group: 'risk',
  render: () => `
    <div class="page-head">
      <div><div class="breadcrumb">Monitor · live P&L</div><h1>Portfolio <span class="route">/portfolio</span></h1></div>
      <div class="meta"><b>src/app/portfolio/page.tsx</b><br/>stacked cards · vertical layout</div>
    </div>
    <p class="lede">
      Today the portfolio page stacks cards vertically — NAV card, P&L card, Portfolio Greeks card, Positions card — so you have to scroll to see the full picture. For a live-monitoring screen, the relevant info must fit in one viewport. The revamp is a <b>single-viewport dashboard</b> with NAV + equity curve up top, aggregate Greeks to the right, and the open positions table below.
    </p>

    <div class="critique">
      <h3>What's wrong</h3>
      <ol>
        <li><span class="tag crit">Layout</span>Cards stack. Equity curve is card-width (full width), but Greeks card below is also full width. User's eye moves <i>down</i> when the relationship between NAV and Greek exposure is <i>across</i>.</li>
        <li><span class="tag crit">Greeks</span>Portfolio Greeks show aggregate only. Missing: <b>per-position contribution</b>. A single position causing 80% of Vega should be obvious.</li>
        <li><span class="tag">P&L split</span>Real vs paper P&L is not visually separated — they stack as equal cards. Paper should be de-emphasized; real P&L is the headline.</li>
        <li><span class="tag">Hedging</span>You have <code>/api/strategy/hedging</code> (delta-gamma hedge) but the portfolio page doesn't suggest a hedge when delta drifts. Surface it here with one-click "rehedge to Δ = 0".</li>
        <li><span class="tag">No attribution</span>P&L isn't decomposed. For an options book, daily P&L = Δ·dS + ½Γ·dS² + Θ·dt + V·dσ + residual. Show it.</li>
      </ol>
    </div>

    <div class="ba">
      <div class="frame">
        <div class="frame-head"><span class="label before">Before</span><span class="title">Stacked cards</span></div>
        <div class="frame-body">
          <div class="screen legacy">
            <div style="font-size:11px;color:#a0a0a0;margin-bottom:4px;">← Back to Dashboard</div>
            <h2>Portfolio Monitor</h2>
            <div class="muted">Real-time portfolio Greeks and P&L</div>
            <div class="card">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span class="muted">NAV</span><b>$142,080</b></div>
              <div style="height:80px;background:linear-gradient(0deg,transparent,rgba(0,200,5,.15));border-bottom:1px solid var(--green);"></div>
              <div class="muted" style="font-size:11px;margin-top:4px;">Day P&L: <span style="color:var(--green);">+$1,240 (+0.88%)</span></div>
            </div>
            <div class="card">
              <div style="font-size:12px;font-weight:700;margin-bottom:8px;">Portfolio Greeks</div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:12px;">
                <div><div class="muted">Δ</div><b>+284.4</b></div>
                <div><div class="muted">Γ</div><b>+18.2</b></div>
                <div><div class="muted">Θ</div><b style="color:var(--green);">+$312</b></div>
                <div><div class="muted">V</div><b style="color:var(--pink);">−$1,840</b></div>
              </div>
            </div>
            <div class="card">
              <div style="font-size:12px;font-weight:700;margin-bottom:8px;">Open Positions (4)</div>
              <table class="table" style="font-size:11px;">
                <thead><tr><th>Symbol</th><th class="r">Qty</th><th class="r">P&L</th></tr></thead>
                <tbody>
                  <tr><td>CIFR 240517C16</td><td class="r">-3</td><td class="r" style="color:var(--green);">+$48</td></tr>
                  <tr><td>MARA 240517C22</td><td class="r">-5</td><td class="r" style="color:var(--green);">+$210</td></tr>
                  <tr><td>PYPL 240607C70</td><td class="r">+4</td><td class="r" style="color:var(--pink);">−$82</td></tr>
                  <tr><td>RIOT 240503P10</td><td class="r">+2</td><td class="r" style="color:var(--green);">+$34</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="frame">
        <div class="frame-head"><span class="label after">After</span><span class="title">Single viewport · attribution · hedges</span></div>
        <div class="frame-body">
          ${RV.shell({ page: 'Portfolio', crumb: 'Home · Portfolio', content: portfolioAfter() })}
        </div>
      </div>
    </div>

    <div class="critique">
      <h3>What changed</h3>
      <ol>
        <li><span class="tag">Layout</span>Top row: NAV + equity curve (60%) side-by-side with aggregate Greeks + hedge suggestion (40%).</li>
        <li><span class="tag">Attribution</span>Day P&L is decomposed into <b>Δ, Γ, Θ, V, residual</b> as a stacked bar — instantly tells you whether the day came from direction, gamma scalping, or vol.</li>
        <li><span class="tag">Per-position</span>Positions table shows per-position <b>Greek contribution</b> — you can see which trade is driving Vega risk.</li>
        <li><span class="tag">Hedge</span>Inline "suggested hedge" card: "Δ drift = +284 · sell 2.8 SPY ES futures = Δ 0". One click sends to ticket.</li>
      </ol>
    </div>
  `
});

function portfolioAfter() {
  const poss = [
    ['CIFR 240517C16','short call',-3,0.82,0.86,48,-123,-2.3,+18,-6],
    ['MARA 240517C22','short call',-5,1.20,1.16,210,-180,-3.1,+32,-12],
    ['PYPL 240607C70','long call', 4,1.80,1.60,-82, 164,+4.8,-14,+28],
    ['RIOT 240503P10','long put',  2,0.55,0.62, 34, -88,-2.4, -8,+12],
  ];
  return `
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:10px;">
      <h2 class="rv-h1" style="margin:0;">Portfolio</h2>
      <span class="rv-sub" style="margin:0;">4 open · 23 closed MTD · paper</span>
      <span style="margin-left:auto;"><span class="rv-btn" style="font-size:11px;">Rehedge to Δ 0</span></span>
    </div>

    <div class="rv-grid-2" style="grid-template-columns:1.4fr 1fr;margin-bottom:12px;">
      <div class="rv-card">
        <div class="rv-card-head">
          <h3>NAV · $142,080</h3>
          <div class="tools"><span>1D</span><span class="on">MTD</span><span>3M</span><span>1Y</span></div>
        </div>
        <div style="height:120px;">${RV.candles(3, 120)}</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px;font-family:'JetBrains Mono';">
          <div><div class="rv-sub" style="margin:0;">Day</div><div class="rv-up"><b>+$1,240</b></div><div class="rv-sub" style="margin:0;">+0.88%</div></div>
          <div><div class="rv-sub" style="margin:0;">MTD</div><div class="rv-up"><b>+$4,820</b></div><div class="rv-sub" style="margin:0;">+3.51%</div></div>
          <div><div class="rv-sub" style="margin:0;">Sharpe</div><div><b>1.84</b></div><div class="rv-sub" style="margin:0;">3M</div></div>
          <div><div class="rv-sub" style="margin:0;">Max DD</div><div class="rv-dn"><b>−2.1%</b></div><div class="rv-sub" style="margin:0;">3M</div></div>
        </div>
      </div>

      <div class="rv-card">
        <div class="rv-card-head"><h3>Aggregate Greeks</h3><span class="rv-chip warn">short vol</span></div>
        <div class="rv-greeks" style="grid-template-columns:repeat(4,1fr);">
          <div class="rv-greek"><div class="sym">Δ<span class="ord">1</span></div><div class="val">+284</div><div class="sub">$44.2k delta</div></div>
          <div class="rv-greek"><div class="sym">Γ<span class="ord">1</span></div><div class="val">+18.2</div><div class="sub">/ $1 move</div></div>
          <div class="rv-greek"><div class="sym">Θ<span class="ord">1</span></div><div class="val rv-up">+$312</div><div class="sub">/ day</div></div>
          <div class="rv-greek"><div class="sym">V<span class="ord">1</span></div><div class="val rv-dn">−$1,840</div><div class="sub">/ 1 vol pt</div></div>
        </div>
        <div style="border-top:1px dashed var(--line);margin:10px 0;padding-top:8px;">
          <div style="font-size:11px;color:var(--ink-mute);margin-bottom:6px;font-family:'JetBrains Mono';">Day P&L attribution</div>
          <div style="display:flex;height:16px;border:1px solid var(--line);border-radius:3px;overflow:hidden;">
            <div style="width:38%;background:var(--green);"></div>
            <div style="width:20%;background:#5fce5f;"></div>
            <div style="width:28%;background:var(--blue);"></div>
            <div style="width:6%;background:var(--pink);"></div>
            <div style="width:8%;background:var(--ink-mute);"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--ink-mute);font-family:'JetBrains Mono';margin-top:4px;">
            <span>Δ $476</span><span>Γ $248</span><span>Θ $352</span><span>V −$72</span><span>res $36</span>
          </div>
        </div>
        <div class="rv-card" style="background:rgba(255,215,0,.04);border-color:rgba(255,215,0,.2);padding:8px 10px;margin-top:6px;">
          <div style="font-size:11px;color:var(--gold);font-weight:600;">Δ drift +284 · suggested hedge</div>
          <div style="font-size:11px;color:var(--ink-dim);font-family:'JetBrains Mono';margin-top:2px;">sell 2.8 SPY ES futures · Δ → 0 · Γ unchanged</div>
        </div>
      </div>
    </div>

    <div class="rv-card">
      <div class="rv-card-head"><h3>Open positions — with Greek contribution</h3><div class="tools"><span class="on">4 open</span><span>23 closed</span></div></div>
      <table class="rv-table" style="font-size:11.5px;">
        <thead><tr>
          <th>Position</th><th>Structure</th><th class="r">Qty</th><th class="r">Entry</th>
          <th class="r">Mark</th><th class="r">P&L</th>
          <th class="r">Δ contrib</th><th class="r">Γ contrib</th><th class="r">Θ contrib</th><th class="r">V contrib</th><th></th>
        </tr></thead>
        <tbody>
          ${poss.map(([n,s,q,en,mk,pl,dc,gc,tc,vc])=>`
            <tr>
              <td><b>${n}</b></td>
              <td><span class="rv-chip ${q<0?'sell':'buy'}">${s}</span></td>
              <td class="r">${q>0?'+':''}${q}</td>
              <td class="r">${en.toFixed(2)}</td>
              <td class="r">${mk.toFixed(2)}</td>
              <td class="r ${pl>0?'rv-up':'rv-dn'}"><b>${pl>0?'+':''}$${pl}</b></td>
              <td class="r">${dc>0?'+':''}${dc}</td>
              <td class="r">${gc>0?'+':''}${gc.toFixed(1)}</td>
              <td class="r">${tc>0?'+':''}${tc}</td>
              <td class="r">${vc>0?'+':''}${vc}</td>
              <td><span class="rv-btn ghost" style="font-size:10px;padding:2px 6px;">close</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}
