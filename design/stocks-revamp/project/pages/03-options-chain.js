// 03 — Option chain (/options-chain)
window.__VE_PAGES.push({
  id: 'chain',
  nav: 'Option chain',
  group: 'core',
  render: () => `
    <div class="page-head">
      <div><div class="breadcrumb">Core flow · trade surface</div><h1>Option chain <span class="route">/options-chain</span></h1></div>
      <div class="meta"><b>src/app/options-chain/page.tsx</b><br/>68/32 split · OptionsChain + sidebar</div>
    </div>
    <p class="lede">
      The chain is where trades get built, so it needs to pack the most information per row. Current layout wastes 32% of horizontal space on a right sidebar containing "Market Status", "Expiration Info", and four nav links — none of which help you pick a strike. The revamp collapses the sidebar into the top bar, reclaims the space for strike density, and exposes Greeks (including 2nd-order) <b>inline</b>.
    </p>

    <div class="critique">
      <h3>What's wrong</h3>
      <ol>
        <li><span class="tag crit">Layout</span>The 68/32 split means on a 1440px window you get ~880px for the chain itself — barely enough for 10 columns. And the sidebar is static text + links. Kill it.</li>
        <li><span class="tag crit">Greeks</span>Chain shows Δ, Θ, Γ, Vega only when you click a row. They should be <b>always visible</b> as columns (you have the data from <code>/api/options/greeks</code>).</li>
        <li><span class="tag">Density</span>Row padding is 12px vertical — feels like a marketing table, not a trading screen. Drop to 4px.</li>
        <li><span class="tag">Moneyness</span>No visual spot-strike indicator. User has to read the strike column to find ATM.</li>
        <li><span class="tag">Expirations</span>Expiration picker is a dropdown. Replace with a horizontal strip (7d, 14d, 30d, 45d, 60d, custom) showing term structure at a glance.</li>
        <li><span class="tag">Ticket</span>Clicking a row should open an inline order ticket on the right, pre-filled with strategy suggestions from your EV scanner.</li>
      </ol>
    </div>

    <div class="ba">
      <div class="frame">
        <div class="frame-head"><span class="label before">Before</span><span class="title">68/32 split with sidebar</span></div>
        <div class="frame-body">
          <div class="screen legacy">
            <div style="font-size:11px;color:#a0a0a0;margin-bottom:6px;">← Back to Dashboard</div>
            <h2 style="display:flex;align-items:center;gap:10px;">📊 Options Chain <span class="pill-g" style="font-size:10px;">Live Market Data</span></h2>
            <div style="display:grid;grid-template-columns:68% 32%;gap:14px;">
              <div class="card" style="padding:10px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                  <div><b>CIFR</b> <span class="muted">$15.50</span></div>
                  <select class="input" style="width:auto;"><option>May 17, 2024 (24d)</option></select>
                </div>
                <table class="table" style="font-size:10px;">
                  <thead><tr>
                    <th colspan="4" style="text-align:center;color:var(--green);">CALLS</th>
                    <th rowspan="2" class="r">Strike</th>
                    <th colspan="4" style="text-align:center;color:var(--pink);">PUTS</th>
                  </tr><tr>
                    <th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Vol</th>
                    <th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Vol</th>
                  </tr></thead>
                  <tbody>
                    ${[13,14,15,16,17].map(k => {
                      const itm = k < 15.5;
                      return `<tr ${k===16?'style="background:rgba(255,215,0,.05);"':''}>
                        <td class="r">${(Math.max(0,15.5-k)+1.2).toFixed(2)}</td>
                        <td class="r">${(Math.max(0,15.5-k)+1.4).toFixed(2)}</td>
                        <td class="r">${(72+(15-k)*2).toFixed(0)}%</td>
                        <td class="r">${(120-Math.abs(k-15)*20)}</td>
                        <td class="r" style="${itm?'background:rgba(0,200,5,.06);':''}"><b>${k.toFixed(2)}</b></td>
                        <td class="r">${(Math.max(0,k-15.5)+0.8).toFixed(2)}</td>
                        <td class="r">${(Math.max(0,k-15.5)+1.0).toFixed(2)}</td>
                        <td class="r">${(70+(k-15)*2).toFixed(0)}%</td>
                        <td class="r">${(90-Math.abs(k-15)*15)}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div>
                <div class="card" style="margin-bottom:10px;">
                  <div style="font-size:12px;font-weight:700;margin-bottom:6px;">Market Status</div>
                  <div class="muted" style="font-size:11px;">🟢 Market Open<br/>Last update: 12:08:42</div>
                </div>
                <div class="card" style="margin-bottom:10px;">
                  <div style="font-size:12px;font-weight:700;margin-bottom:6px;">Expiration Info</div>
                  <div class="muted" style="font-size:11px;">DTE: 24 days<br/>Friday close</div>
                </div>
                <div class="card">
                  <div style="font-size:12px;font-weight:700;margin-bottom:6px;">Navigation</div>
                  <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
                    <a style="color:var(--green);">📈 Pricing Calculator</a>
                    <a style="color:var(--gold);">🔍 Scanner</a>
                    <a style="color:var(--pink);">⚠️ Risk Dashboard</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="frame">
        <div class="frame-head"><span class="label after">After</span><span class="title">Dense chain + inline Greeks + ticket</span></div>
        <div class="frame-body">
          ${RV.shell({ page: 'Option Chain', crumb: 'Home · Scanner · CIFR Chain', content: chainAfter() })}
        </div>
      </div>
    </div>

    <div class="critique">
      <h3>What changed</h3>
      <ol>
        <li><span class="tag">Layout</span>Sidebar removed. <b>Ticket opens inline</b> when a strike is clicked — otherwise chain fills the width.</li>
        <li><span class="tag">Greeks</span>Δ, Γ, Θ, V are now columns. <b>2nd-order Greeks (Vanna, Charm, Volga)</b> available via "more Greeks" toggle. Clearly marked as 2ⁿᵈ-order.</li>
        <li><span class="tag">Expirations</span>Horizontal expiration strip with <b>ATM IV per expiration</b> — shows term structure at a glance. Can spot calendar skew.</li>
        <li><span class="tag">Moneyness</span>Spot line is a horizontal rule across the table. ITM rows get a subtle left border.</li>
        <li><span class="tag">EV</span>Each strike row gets an EV badge (if the scanner flagged it), so the trader knows what the engine thinks.</li>
      </ol>
    </div>
  `
});

function chainAfter() {
  const spot = 15.50;
  const strikes = [13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18];
  const row = (k) => {
    const callItm = k < spot;
    const putItm = k > spot;
    const atm = Math.abs(k - spot) < 0.3;
    const flag = k === 16 ? 'SELL' : k === 14.5 ? 'BUY' : null;
    return `
      <tr class="${atm?'atm':''} ${k===16?'sel':''}">
        <td class="r ${callItm?'itm':''}">${(Math.max(0,spot-k)+1.2).toFixed(2)}</td>
        <td class="r ${callItm?'itm':''}">${(Math.max(0,spot-k)+1.4).toFixed(2)}</td>
        <td class="r">${(72+(15-k)*2).toFixed(0)}</td>
        <td class="r">${(0.92-Math.max(0,(k-spot))*0.3).toFixed(2)}</td>
        <td class="r">${(0.08-Math.abs(k-spot)*0.01).toFixed(3)}</td>
        <td class="r">−${(0.02+Math.abs(k-spot)*0.003).toFixed(3)}</td>
        <td class="r">${(0.04-Math.abs(k-spot)*0.005).toFixed(3)}</td>
        <td class="r strike"><b>${k.toFixed(2)}</b>${atm?'<span class="rv-chip" style="background:rgba(58,141,255,.15);color:var(--blue);padding:1px 4px;margin-left:4px;font-size:9px;">ATM</span>':''}</td>
        <td class="r ${putItm?'itm':''}">${(Math.max(0,k-spot)+0.8).toFixed(2)}</td>
        <td class="r ${putItm?'itm':''}">${(Math.max(0,k-spot)+1.0).toFixed(2)}</td>
        <td class="r">${(70+(k-15)*2).toFixed(0)}</td>
        <td class="r">−${(0.08+Math.max(0,(k-spot))*0.3).toFixed(2)}</td>
        <td>${flag?`<span class="rv-chip ${flag==='BUY'?'buy':'sell'}">${flag} · $${flag==='SELL'?82:41}</span>`:''}</td>
      </tr>
    `;
  };

  return `
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:2px;">
      <h2 class="rv-h1" style="margin:0;">CIFR</h2>
      <span style="font-family:'JetBrains Mono';font-size:18px;">15.50</span>
      <span class="rv-chip buy">+2.4%</span>
      <span class="rv-sub" style="margin:0;">Cipher Mining · high-vol regime · 7 flagged strikes</span>
    </div>

    <div class="rv-expstrip" style="margin:10px 0 12px;">
      ${[
        ['7d','Apr 26',0.68,12],
        ['14d','May 03',0.71,18],
        ['24d','May 17',0.724,44],
        ['45d','Jun 07',0.69,22],
        ['80d','Jul 12',0.62,14],
        ['170d','Oct 11',0.55,8],
      ].map(([d,dt,iv,oi],i)=>`
        <div class="rv-exp ${i===2?'on':''}">
          <div class="dte">${d}</div>
          <div class="date">${dt}</div>
          <div class="iv">ATM IV ${(iv*100).toFixed(0)}%</div>
          <div class="oi">${oi}k OI</div>
        </div>`).join('')}
    </div>

    <div class="rv-chain-wrap">
      <div class="rv-card" style="padding:0;">
        <table class="rv-table rv-chain">
          <thead>
            <tr class="head2">
              <th colspan="7" style="text-align:center;color:var(--green);border-right:1px solid var(--line);">CALLS</th>
              <th rowspan="2" class="r" style="vertical-align:bottom;">Strike</th>
              <th colspan="5" style="text-align:center;color:var(--pink);">PUTS</th>
              <th rowspan="2">EV signal</th>
            </tr>
            <tr>
              <th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th>
              <th class="r">Δ¹</th><th class="r">Γ¹</th><th class="r">Θ¹</th><th class="r" style="border-right:1px solid var(--line);">V¹</th>
              <th class="r">Bid</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Δ¹</th>
            </tr>
          </thead>
          <tbody>${strikes.map(row).join('')}</tbody>
        </table>
      </div>

      <div class="rv-card rv-ticket">
        <div class="rv-card-head"><h3>Order ticket</h3><span class="rv-chip sell">SELL PREMIUM</span></div>
        <div class="rv-ticket-line">CIFR <b>240517C16.00</b></div>
        <div class="rv-ticket-line sub">Short 24-day 16 call · mid 0.82 · IV 74%</div>

        <div class="rv-ticket-row"><span>Side</span><span><b class="rv-dn">SELL</b> to open</span></div>
        <div class="rv-ticket-row"><span>Qty</span><span><b>3</b> contracts · $4,650 max risk</span></div>
        <div class="rv-ticket-row"><span>Limit</span><span><b>0.82</b> <span style="color:var(--ink-mute);">(mid)</span></span></div>
        <div class="rv-ticket-row"><span>TIF</span><span>DAY</span></div>

        <div style="border-top:1px dashed var(--line);margin:10px 0;padding-top:10px;">
          <div class="rv-ticket-row"><span>Max profit</span><span class="rv-up"><b>+$246</b></span></div>
          <div class="rv-ticket-row"><span>Max loss</span><span class="rv-dn"><b>unlimited</b> (naked)</span></div>
          <div class="rv-ticket-row"><span>Breakeven</span><span>$16.82</span></div>
          <div class="rv-ticket-row"><span>POP</span><span><b>64%</b> (HMM-adjusted)</span></div>
          <div class="rv-ticket-row"><span>EV / contract</span><span class="rv-up"><b>+$82</b></span></div>
        </div>

        <div style="border-top:1px dashed var(--line);padding-top:10px;">
          <div style="font-size:10.5px;color:var(--ink-mute);font-family:'JetBrains Mono';margin-bottom:6px;">Suggested structures</div>
          <div class="rv-alt">Bear call spread 16/17 · max loss $180 · <span class="rv-up">EV $58</span></div>
          <div class="rv-alt">Iron condor 14/15/16/17 · max loss $140 · <span class="rv-up">EV $44</span></div>
        </div>

        <div style="display:flex;gap:6px;margin-top:12px;">
          <span class="rv-btn" style="flex:1;background:var(--pink);color:#000;text-align:center;font-weight:700;">SELL 3× @ 0.82</span>
          <span class="rv-btn ghost">simulate</span>
        </div>
        <div style="font-size:10px;color:var(--ink-mute);margin-top:6px;text-align:center;">paper account · click to review</div>
      </div>
    </div>
  `;
}
