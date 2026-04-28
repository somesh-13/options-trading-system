// 06 — Auto engine (/auto-engine)
window.__VE_PAGES.push({
  id: 'engine',
  nav: 'Auto engine',
  group: 'risk',
  render: () => `
    <div class="page-head">
      <div><div class="breadcrumb">Automation · guardrailed execution</div><h1>Auto engine <span class="route">/auto-engine</span></h1></div>
      <div class="meta"><b>src/app/auto-engine/page.tsx</b><br/>config form + activity log</div>
    </div>
    <p class="lede">
      The auto-engine is the most <b>responsible</b> screen — it's the one actually placing trades without you. Today it's a config form (min EV, max positions, max loss, scan interval) followed by a plain-text activity log. The revamp treats this like a trading desk control panel: <b>guardrails are a visual budget</b> (bars showing how close to the limit), and the log becomes the hero — a live, colored event stream.
    </p>

    <div class="critique">
      <h3>What's wrong</h3>
      <ol>
        <li><span class="tag crit">Risk visibility</span><b>The "max loss $1,000" config field is just a number.</b> It should show you've used $340 of $1,000 today. Guardrails without progress are blind guardrails.</li>
        <li><span class="tag crit">Kill switch</span>No prominent stop. A user who realizes the engine is misbehaving should be able to halt everything in 1 click without leaving this page. Today you'd click "Stop Engine" which is bottom-right of a form.</li>
        <li><span class="tag">Log</span>Activity log is plain text rows. No color coding of event types (SCAN vs SIGNAL vs EXEC vs SKIP vs ERROR), no filtering, no search.</li>
        <li><span class="tag">Decision trace</span>When the engine skips a trade, log says "Skipped". Why? Was it below EV threshold? Did regime say no? Did daily loss trigger? Surface the <b>reason</b>.</li>
        <li><span class="tag">No simulation</span>No "dry run" toggle. Let me turn on the engine in sim mode for 24 hours and watch what it <i>would have</i> done before letting it fire real orders.</li>
      </ol>
    </div>

    <div class="ba">
      <div class="frame">
        <div class="frame-head"><span class="label before">Before</span><span class="title">Config form + plain log</span></div>
        <div class="frame-body">
          <div class="screen legacy">
            <div style="font-size:11px;color:#a0a0a0;margin-bottom:4px;">← Back</div>
            <h2>Auto Trading Engine</h2>
            <div class="muted" style="margin-bottom:10px;">Automated scanner + executor · <span class="pill-g">RUNNING</span></div>
            <div class="card">
              <div style="font-size:12px;font-weight:700;margin-bottom:8px;">Configuration</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                ${[['Min EV ($)','50'],['Max open positions','5'],['Max daily loss ($)','1000'],['Scan interval (s)','300'],['Min hit rate (%)','55'],['Position size (contracts)','3']].map(([l,v])=>`
                  <div><div class="muted" style="font-size:10px;">${l}</div><input class="input" value="${v}"/></div>`).join('')}
              </div>
              <div style="display:flex;gap:8px;margin-top:10px;">
                <button class="btn-g">Save</button>
                <button style="background:transparent;border:1px solid var(--pink);color:var(--pink);padding:7px 12px;border-radius:6px;font-size:11px;">Stop Engine</button>
              </div>
            </div>
            <div class="card">
              <div style="font-size:12px;font-weight:700;margin-bottom:8px;">Activity log</div>
              <div style="font-family:'JetBrains Mono';font-size:10.5px;line-height:1.7;">
                <div>12:08:42 EXEC CIFR SELL 3 @ 0.82</div>
                <div>11:54:01 SIGNAL WULF EV $64</div>
                <div>11:31:15 SKIP HOOD</div>
                <div>11:05:22 SCAN 8 tickers</div>
                <div>10:58:11 EXEC MARA SELL 5 @ 1.20</div>
                <div>10:42:03 SKIP COIN</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="frame">
        <div class="frame-head"><span class="label after">After</span><span class="title">Visual guardrails · decision trace</span></div>
        <div class="frame-body">
          ${RV.shell({ page: 'Auto Engine', crumb: 'Home · Auto Engine', content: engineAfter() })}
        </div>
      </div>
    </div>

    <div class="critique">
      <h3>What changed</h3>
      <ol>
        <li><span class="tag">Guardrails</span>Each limit is a <b>bar with used / total</b>. Daily loss: $340 of $1,000. Positions: 4 of 5. Visually obvious how close to the rails you are.</li>
        <li><span class="tag">Kill switch</span>Top-bar-anchored <b>HALT ALL</b> button — red, always visible, 1 click pauses intake + cancels pending orders.</li>
        <li><span class="tag">Mode</span><b>Dry run / Live</b> toggle with banner. In dry run, "EXEC" events become "WOULD-EXEC" — same log format, no real orders.</li>
        <li><span class="tag">Log</span>Event stream with color-coded types, click-to-expand decision trace (spot · IV · EV · regime · decision · reason).</li>
        <li><span class="tag">Filter</span>Filter chips: scan / signal / exec / skip / error. Search by ticker.</li>
      </ol>
    </div>
  `
});

function engineAfter() {
  const limit = (label, used, cap, unit='') => {
    const pct = Math.min(100, used/cap*100);
    const warn = pct > 70;
    return `
      <div class="rv-limit">
        <div class="hd"><span>${label}</span><span><b>${unit}${used.toLocaleString()}</b> / ${unit}${cap.toLocaleString()}</span></div>
        <div class="bar"><i style="width:${pct}%;background:${warn?'var(--gold)':'var(--green)'};"></i></div>
      </div>
    `;
  };
  return `
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:10px;">
      <h2 class="rv-h1" style="margin:0;">Auto engine</h2>
      <span class="rv-chip buy"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:4px;animation:pulse 1.5s infinite;"></span>RUNNING</span>
      <span class="rv-sub" style="margin:0;">started 08:00:00 · 4h 8m uptime · next scan in 2m 14s</span>
      <span style="margin-left:auto;display:flex;gap:6px;">
        <span class="rv-btn ghost" style="font-size:11px;">dry run</span>
        <span class="rv-btn" style="font-size:11px;background:var(--pink);color:#fff;font-weight:700;">■ HALT ALL</span>
      </span>
    </div>

    <div class="rv-grid-2" style="grid-template-columns:320px 1fr;">
      <div class="rv-card">
        <div class="rv-card-head"><h3>Guardrails · today</h3></div>
        ${limit('Open positions', 4, 5)}
        ${limit('Daily loss',     340, 1000, '$')}
        ${limit('Trades today',   7, 10)}
        ${limit('Exposure',       48200, 100000, '$')}
        <div style="border-top:1px dashed var(--line);margin:10px 0;padding-top:10px;">
          <div class="rv-sub" style="margin-bottom:6px;">Entry conditions</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;font-family:'JetBrains Mono';font-size:11px;">
            <div>min EV</div><div>$50 ✓</div>
            <div>min hit rate</div><div>55% ✓</div>
            <div>max σ</div><div>1.50x</div>
            <div>size</div><div>3 contracts</div>
            <div>regime req</div><div>any</div>
            <div>scan every</div><div>5 min</div>
          </div>
        </div>
        <div style="border-top:1px dashed var(--line);margin:10px 0;padding-top:10px;">
          <div class="rv-sub" style="margin-bottom:6px;">Session stats</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;font-family:'JetBrains Mono';font-size:11px;">
            <div>scans</div><div>49</div>
            <div>signals</div><div>11</div>
            <div>executed</div><div>7</div>
            <div>skipped</div><div>4</div>
            <div>errors</div><div>0</div>
            <div>P&L (session)</div><div class="rv-up">+$428</div>
          </div>
        </div>
      </div>

      <div class="rv-card" style="padding:0;">
        <div class="rv-card-head" style="padding:10px 14px;">
          <h3>Event stream</h3>
          <div class="tools">
            <span class="on">all</span><span>exec</span><span>signal</span><span>skip</span><span>error</span>
          </div>
        </div>
        <div class="rv-log" style="max-height:480px;overflow:auto;">
          ${[
            ['12:08:42','EXEC','exec','CIFR','SELL 3x CIFR240517C16.00 @ $0.82 · order OID-8811 · filled', '<div class="trace">spot 15.50 · IV 72.4 · ratio 1.45x · EV $82 · hit 61% · regime high-vol · decision: approved · all guards passed</div>'],
            ['12:06:18','SIGNAL','signal','CIFR','IV/HV 1.45 · EV $82 · approved',''],
            ['11:54:01','EXEC','exec','MARA','SELL 5x MARA240517C22.00 @ $1.20 · order OID-8810 · filled',''],
            ['11:53:40','SIGNAL','signal','MARA','IV/HV 1.51 · EV $94 · approved',''],
            ['11:31:15','SKIP','skip','HOOD','EV $18 < threshold $50','<div class="trace">IV 41.2 · HV 38.1 · ratio 1.08 · signal NEUTRAL · no edge</div>'],
            ['11:29:02','SKIP','skip','COIN','hit rate 49% < threshold 55%',''],
            ['11:05:22','SCAN','scan','—','scan #7 · 8 tickers · 2 signals · 1 exec',''],
            ['10:58:11','EXEC','exec','PYPL','BUY 4x PYPL240607C70.00 @ $1.80 · order OID-8808 · filled',''],
            ['10:42:03','SKIP','skip','GRAB','position limit reached (4/5)',''],
            ['10:30:22','SCAN','scan','—','scan #6 · 8 tickers · 1 signal · 1 exec',''],
            ['10:05:22','SCAN','scan','—','scan #5 · 8 tickers · 0 signals',''],
          ].map(([t,lbl,cls,sym,msg,trace])=>`
            <div class="row">
              <span class="t">${t}</span>
              <span class="ev ${cls}">${lbl}</span>
              <span class="sym">${sym}</span>
              <span class="msg">${msg}${trace||''}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <style>
      @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.4;} }
      .rv-limit { margin-bottom: 10px; }
      .rv-limit .hd { display: flex; justify-content: space-between; font-size: 11px; font-family: 'JetBrains Mono'; margin-bottom: 3px; }
      .rv-limit .bar { height: 6px; background: #0c0d10; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
      .rv-limit .bar > i { display: block; height: 100%; }
      .rv-log .row .trace { font-size: 10px; color: var(--ink-mute); margin-top: 3px; padding-left: 0; font-style: italic; }
    </style>
  `;
}
