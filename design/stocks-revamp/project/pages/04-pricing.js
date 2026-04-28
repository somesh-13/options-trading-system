// 04 — Pricing / Greeks (/pricing)
window.__VE_PAGES.push({
  id: 'pricing',
  nav: 'Pricing / Greeks',
  group: 'core',
  render: () => `
    <div class="page-head">
      <div><div class="breadcrumb">Research · theoretical pricing</div><h1>Pricing <span class="route">/pricing</span></h1></div>
      <div class="meta"><b>src/app/pricing/page.tsx</b><br/>Black-Scholes + 8 Greeks · IV solver</div>
    </div>
    <p class="lede">
      This is the page that should <b>show off</b> the quant engine — Black-Scholes with Δ, Γ, Θ, V, ρ <i>plus</i> 2nd-order Vanna, Charm, Volga. Today it's a two-column calculator: inputs on the left, a stack of 8 Greek cards on the right. The 2nd-order Greeks are visually identical to 1st-order, so a user can't tell at a glance which ones are the differentiator.
    </p>

    <div class="critique">
      <h3>What's wrong</h3>
      <ol>
        <li><span class="tag crit">Greeks</span><b>1st and 2nd order Greeks are rendered identically</b> — same card, same size, same font. The whole point of having Vanna/Charm/Volga is that they catch risk 1st-order misses. Visually separate them.</li>
        <li><span class="tag crit">Static</span>Results are numbers, not shapes. A Greek is a <i>curve</i> — surface the curve. Show Δ-vs-spot, Γ-vs-spot, Θ-vs-time as inline sparks.</li>
        <li><span class="tag">Inputs</span>Six number fields stacked vertically. Spot + strike + T + r + σ + type is better as a compact grid, with <b>sliders for σ and T</b> so you can see the curves move.</li>
        <li><span class="tag">IV solver</span>"Solve for IV from market price" is a separate button that replaces the output. Should be a tab or mode toggle, not an overwrite.</li>
        <li><span class="tag">No surface</span>You have a <code>/vol-surface</code> page but it's a separate route. Inline a mini vol surface here — the whole smile + term structure at once is more useful than single-point pricing.</li>
      </ol>
    </div>

    <div class="ba">
      <div class="frame">
        <div class="frame-head"><span class="label before">Before</span><span class="title">Calculator + 8 equal cards</span></div>
        <div class="frame-body">
          <div class="screen legacy">
            <div style="font-size:11px;color:#a0a0a0;margin-bottom:6px;">← Back</div>
            <h2>Options Pricing Calculator</h2>
            <div class="muted" style="margin-bottom:10px;">Black-Scholes with 8 Greeks · CIFR · 2024-05-17</div>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px;">
              <div class="card">
                <div style="font-size:12px;font-weight:700;margin-bottom:8px;">Inputs</div>
                ${[['Spot','15.50'],['Strike','16.00'],['T (years)','0.0658'],['r','0.045'],['σ (vol)','0.724'],['Type','Call']].map(([l,v])=>`
                  <div style="margin-bottom:6px;"><div class="muted" style="font-size:10px;">${l}</div><input class="input" value="${v}" style="font-size:12px;"/></div>
                `).join('')}
                <button class="btn-g" style="width:100%;margin-top:6px;">Calculate</button>
                <button style="width:100%;margin-top:6px;background:transparent;border:1px solid #555;color:#fff;padding:7px;border-radius:6px;font-size:11px;">Solve for IV</button>
              </div>
              <div>
                <div class="card" style="margin-bottom:8px;"><b>Theoretical Price: $0.82</b></div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                  ${[
                    ['Delta','0.412'],['Gamma','0.078'],['Theta','−0.024'],['Vega','0.038'],
                    ['Rho','0.011'],['Vanna','0.142'],['Charm','−0.008'],['Volga','0.047'],
                  ].map(([n,v])=>`
                    <div class="card" style="padding:8px;">
                      <div class="muted" style="font-size:10px;">${n}</div>
                      <div style="font-size:16px;font-weight:700;">${v}</div>
                    </div>`).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="frame">
        <div class="frame-head"><span class="label after">After</span><span class="title">Curves, not numbers</span></div>
        <div class="frame-body">
          ${RV.shell({ page: 'Pricing', crumb: 'Home · Pricing · CIFR 240517C16', content: pricingAfter() })}
        </div>
      </div>
    </div>

    <div class="critique">
      <h3>What changed</h3>
      <ol>
        <li><span class="tag">Greeks</span>Grouped into <b>1st-order</b> (Δ Γ Θ V ρ) and <b>2nd-order</b> (Vanna Charm Volga). 2nd-order cards have a distinct badge and description ("cross-Greek: how Δ moves with σ") so traders learn what they mean.</li>
        <li><span class="tag">Curves</span>Every Greek card has an inline <b>curve vs spot</b> with the current point marked. You're not looking at a value, you're looking at where you are on the curve.</li>
        <li><span class="tag">Surface</span>A compact vol surface (strike × DTE) lives right here. Click a cell → load it into the calculator.</li>
        <li><span class="tag">Solver</span>Mode toggle at top: <b>Price from IV</b> / <b>IV from price</b>. Same layout, different locked input.</li>
        <li><span class="tag">Sliders</span>σ and T are sliders; all curves animate. Teaches intuition quickly.</li>
      </ol>
    </div>
  `
});

function pricingAfter() {
  const greek = (sym, ord, name, val, desc, color, seed) => `
    <div class="rv-greek-big ${ord===2?'ord2':''}">
      <div class="hd">
        <div class="sym">${sym}<span class="ord">${ord}</span></div>
        <div class="nm">${name}${ord===2?' · cross':''}</div>
      </div>
      <div class="val">${val}</div>
      <div class="spark">${RV.spark(seed, color, true)}</div>
      <div class="desc">${desc}</div>
    </div>
  `;
  return `
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:10px;">
      <h2 class="rv-h1" style="margin:0;">CIFR 240517 C 16</h2>
      <span class="rv-sub" style="margin:0;">Black-Scholes · 24d · σ = 72.4% · r = 4.5%</span>
      <span style="margin-left:auto;display:flex;gap:4px;">
        <span class="rv-btn" style="font-size:11px;">Price from IV</span>
        <span class="rv-btn ghost" style="font-size:11px;">IV from price</span>
      </span>
    </div>

    <div class="rv-grid-2" style="grid-template-columns:320px 1fr;">
      <div class="rv-card">
        <div class="rv-card-head"><h3>Inputs</h3></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;font-family:'JetBrains Mono';font-size:12px;">
          <div><div class="rv-sub" style="margin:0;">Spot</div><div>15.50</div></div>
          <div><div class="rv-sub" style="margin:0;">Strike</div><div>16.00</div></div>
          <div><div class="rv-sub" style="margin:0;">Type</div><div>CALL</div></div>
          <div><div class="rv-sub" style="margin:0;">r</div><div>4.50%</div></div>
        </div>
        <div style="margin-top:12px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;"><span class="rv-sub" style="margin:0;">σ (volatility)</span><span style="font-family:'JetBrains Mono';">72.4%</span></div>
          <div class="rv-slider"><i style="left:62%;"></i></div>
        </div>
        <div style="margin-top:8px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;"><span class="rv-sub" style="margin:0;">T (days)</span><span style="font-family:'JetBrains Mono';">24</span></div>
          <div class="rv-slider"><i style="left:22%;"></i></div>
        </div>
        <div style="border-top:1px dashed var(--line);margin:14px 0 10px;padding-top:10px;">
          <div style="font-size:10.5px;color:var(--ink-mute);">Theoretical price</div>
          <div style="font-size:26px;font-weight:700;font-family:'JetBrains Mono';">$0.82</div>
          <div style="font-size:10.5px;color:var(--ink-mute);">market 0.82 · mispriced <span class="rv-chip neutral">0.0%</span></div>
        </div>
      </div>

      <div>
        <div class="rv-sub" style="margin-bottom:6px;">First-order Greeks</div>
        <div class="rv-greek-grid">
          ${greek('Δ',1,'Delta','0.412','per $1 spot','var(--green)',2)}
          ${greek('Γ',1,'Gamma','0.078','Δ per $1 spot','var(--green)',3)}
          ${greek('Θ',1,'Theta','−0.024','per day','var(--pink)',5)}
          ${greek('V',1,'Vega','0.038','per vol pt','var(--blue)',7)}
          ${greek('ρ',1,'Rho','0.011','per rate pt','var(--ink-dim)',9)}
        </div>
        <div class="rv-sub" style="margin:14px 0 6px;">Second-order Greeks <span style="color:var(--gold);">· your edge</span></div>
        <div class="rv-greek-grid">
          ${greek('∂Δ/∂σ',2,'Vanna','0.142','Δ moves when vol moves','var(--gold)',11)}
          ${greek('∂Δ/∂t',2,'Charm','−0.008','Δ decay over time','var(--gold)',13)}
          ${greek('∂V/∂σ',2,'Volga','0.047','Vega of Vega','var(--gold)',15)}
        </div>

        <div class="rv-card" style="margin-top:14px;">
          <div class="rv-card-head"><h3>Vol surface · CIFR</h3><div class="tools"><span>smile</span><span class="on">heatmap</span></div></div>
          <div class="rv-surface">
            ${[60,65,70,72,75,78,82,88,95].map((iv,i)=>
              Array.from({length:7},(_,j)=>{
                const v = iv + j*3 - Math.abs(i-4)*2 + Math.abs(j-3)*4;
                const norm = Math.max(0, Math.min(1, (v-55)/50));
                return `<div class="c" style="background:rgba(255,215,0,${norm.toFixed(2)});">${v.toFixed(0)}</div>`;
              }).join('')
            ).join('')}
          </div>
          <div class="rv-surface-axes">
            <span>strike →</span><span>← DTE ↓</span>
          </div>
        </div>
      </div>
    </div>
  `;
}
