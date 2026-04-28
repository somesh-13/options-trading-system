// 00 — Overview
window.__VE_PAGES.push({
  id: 'overview',
  nav: 'Overview',
  group: 'overview',
  render: () => `
    <div class="page-head">
      <div>
        <div class="breadcrumb">VegaEdge · iaac-poc</div>
        <h1>UI Revamp · overview</h1>
      </div>
      <div class="meta">
        <b>15 pages reviewed</b><br/>
        Next.js 16 · React 19 · Tailwind v4<br/>
        Dark theme · Chart.js · Plotly
      </div>
    </div>

    <p class="lede">
      I read the <b>iaac-poc branch</b> of <b>somesh-13/options-trading-system</b> end-to-end.
      The backend is strong — Black-Scholes, HMM regime, NLP sentiment, VaR, delta-gamma hedging, EV scanner, Alpaca execution —
      but the UI hides that sophistication behind <b>disconnected pages</b>, <b>text-heavy link rails</b>, and <b>inconsistent component patterns</b>.
      The revamps below preserve your color tokens (<code>#00C805</code>, <code>#FF006E</code>, <code>#FFD700</code>) and stack, and propose targeted fixes — not a rewrite.
    </p>

    <div class="critique">
      <h3>Themes across all 15 pages</h3>
      <ol>
        <li><span class="tag crit">Nav</span><b>The dashboard is a wall of 17 link-buttons.</b> New users don't know where to start; power users click 3 times per task. Replace with a persistent left rail (icons + labels) and a <code>⌘K</code> command palette — your users are quants, they live on keyboards.</li>
        <li><span class="tag crit">Hierarchy</span><b>Every page starts with a giant H1 + back-arrow + redundant "Dashboard" crumb.</b> 40px headers eat the fold on a dense data app. Shrink to 20px, move state (PAPER / OPEN / regime / VaR) into a persistent top bar so it follows the user across pages.</li>
        <li><span class="tag crit">Greeks</span><b>Second-order Greeks (Vanna, Charm, Volga) are buried in theory footers.</b> They're a differentiator — surface them inline on pricing, chain, and positions, clearly labeled as <code>2ⁿᵈ</code> order so newcomers know what they're looking at.</li>
        <li><span class="tag">Density</span><b>Cards use 14–24px padding and 16px row heights everywhere.</b> On a quant platform you can tighten to 8–10px padding and 24px rows and fit 2× the information without it feeling crowded. Bloomberg-dense on request (Tweaks panel).</li>
        <li><span class="tag">Color</span><b>Gold <code>#FFD700</code> is used for PAPER badge, SELL signal, scanning state, AND warning borders.</b> Pick one meaning per color. I've reallocated: gold = SELL premium, pink = warning/risk, green = BUY/healthy, blue = info.</li>
        <li><span class="tag">Data viz</span><b>Mispricing/IV/HV is displayed as text ratios (e.g. "1.45x").</b> Show the ratio as a position on a scale (0.5–2.0) with BUY/SELL zones shaded — quants read position faster than numbers.</li>
        <li><span class="tag">Regime</span><b>HMM regime is a standalone component only shown on a few pages.</b> It conditions every decision — put it in the persistent top bar so the user always knows the market state.</li>
        <li><span class="tag info">Flow</span><b>Scanner → Chain → Ticket requires manual ticker re-entry.</b> Wire each hit in the scanner to deep-link the chain with ticker+expiration preselected. Cut clicks per trade from 6 to 2.</li>
        <li><span class="tag info">Empty states</span>Most pages render "Loading..." or blank until data arrives. Add skeletons matching the final layout so the UI doesn't flash-reflow.</li>
        <li><span class="tag info">Paper/live</span><b>PAPER badge is a tiny yellow chip.</b> Pros trade real money — the paper/live distinction should be more prominent, ideally a top-bar mode switch with a confirmation when flipping to live.</li>
      </ol>
    </div>

    <div class="critique">
      <h3>Recommendations — prioritized</h3>
      <ol>
        <li><b>P0 · Global shell:</b> persistent left rail + top bar with regime, VaR, paper/live. Removes the ugly dashboard link-grid and anchors the whole app.</li>
        <li><b>P0 · Scanner revamp:</b> it's the entry point to every trade. Make it the home screen post-login, with EV ranking, regime context, and one-click deep-link to chain.</li>
        <li><b>P1 · Option chain:</b> densify the table, add Greeks inline, strip to 2-column (chain + ticket) — the current 70/30 split wastes the right column when nothing is selected.</li>
        <li><b>P1 · Pricing page:</b> surface 2nd-order Greeks as peers, not footnotes. Add a live vol surface inline.</li>
        <li><b>P2 · Portfolio:</b> separate real P&L from portfolio Greeks — right now cards stack vertically and you can't see both in one viewport.</li>
        <li><b>P2 · Auto-engine:</b> replace the config form with a visual "trade guardrails" diagram, and make the activity log the star of the page.</li>
      </ol>
    </div>

    <div class="footnotes">
      <h4>How to read this document</h4>
      <div class="grid">
        <div>
          <div class="head">Before</div>
          Faithful recreation of the current UI from the source files (<code>src/app/*/page.tsx</code>). Not a screenshot — rendered HTML so we can annotate.
        </div>
        <div>
          <div class="head y">Critique</div>
          Per-page numbered list. Tags: <b>[Nav]</b> nav/flow, <b>[Hierarchy]</b> visual weight, <b>[Density]</b> spacing, <b>[Color]</b> semantic color, <b>[Greeks]</b> Greek surfacing, <b>[Data viz]</b> charts, <b>[Flow]</b> inter-page flow.
        </div>
        <div>
          <div class="head g">After</div>
          Concrete revamp sketch using your existing color tokens. Mid-fidelity: real labels, real numbers, real layout. Not a pixel-perfect mock — pick what resonates per page and we'll push to hi-fi.
        </div>
      </div>
    </div>
  `
});
