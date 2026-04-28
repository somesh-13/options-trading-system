// 07 — Cross-cutting recommendations
window.__VE_PAGES.push({
  id: 'cross',
  nav: 'Cross-cutting',
  group: 'cross',
  render: () => `
    <div class="page-head">
      <div><div class="breadcrumb">System · applies to every page</div><h1>Cross-cutting recommendations</h1></div>
      <div class="meta">design tokens · typography · empty states · motion</div>
    </div>

    <p class="lede">
      These apply across all 15 pages. Treat them as the design-system layer the revamps above rely on — they also catch the pages I didn't mock (Vol surface, Risk, Strategy builder, NLP sentiment, Backtest, Trade journal, Live trading, Positions, VegaEdge agent, API docs).
    </p>

    <div class="critique">
      <h3>1 · Semantic color tokens</h3>
      <p>Today <code>#FFD700</code> is overloaded. Lock to one meaning per color:</p>
      <div class="token-grid">
        <div class="tok"><span class="sw" style="background:#00C805;"></span><b>green · buy / healthy</b><div>long signals, approved trades, positive P&L, normal regime, within-limit</div></div>
        <div class="tok"><span class="sw" style="background:#FFD700;"></span><b>gold · sell premium / caution</b><div>short-vol signals, rate-limit approaching, high-vol regime</div></div>
        <div class="tok"><span class="sw" style="background:#FF006E;"></span><b>pink · risk / danger</b><div>negative P&L, breach, crash regime, HALT, live-account</div></div>
        <div class="tok"><span class="sw" style="background:#3A8DFF;"></span><b>blue · info / neutral</b><div>ATM, current selection, expected/modeled values, links</div></div>
        <div class="tok"><span class="sw" style="background:#808080;"></span><b>mute · secondary</b><div>labels, timestamps, low-importance meta, hit counts</div></div>
        <div class="tok"><span class="sw" style="background:#0d0e11;border:1px solid #1f2228;"></span><b>surface · card</b><div>paper trade: same background with a 2px gold border ring</div></div>
      </div>
    </div>

    <div class="critique">
      <h3>2 · Type scale for dense data</h3>
      <div class="type-scale">
        <div><div class="lbl">display · 20/28</div><div style="font-size:20px;font-weight:600;">Portfolio · $142,080</div></div>
        <div><div class="lbl">h3 section · 13/20</div><div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Top opportunities</div></div>
        <div><div class="lbl">body · 12/18</div><div style="font-size:12px;">Cipher Mining short 16 call, 24-day, IV 72% · mid $0.82</div></div>
        <div><div class="lbl">mono data · 11.5/16</div><div style="font-size:11.5px;font-family:'JetBrains Mono';">CIFR 240517C16.00  1.45x  $82</div></div>
        <div><div class="lbl">meta · 10/14</div><div style="font-size:10px;color:var(--ink-mute);font-family:'JetBrains Mono';">12:08:42 · paper · regime high-vol</div></div>
      </div>
      <p class="note">All data-bearing columns use <b>JetBrains Mono</b> so digits align. Labels/copy use Inter. This is the single most effective change for a dense quant UI.</p>
    </div>

    <div class="critique">
      <h3>3 · Empty, loading, and error states</h3>
      <p>Most pages flash "Loading..." or nothing, then reflow when data arrives.</p>
      <div class="rv-grid-3">
        <div class="rv-card">
          <div class="rv-card-head"><h3>Loading — skeleton</h3></div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div style="height:10px;background:var(--line);border-radius:2px;width:60%;"></div>
            <div style="height:10px;background:var(--line);border-radius:2px;width:90%;"></div>
            <div style="height:10px;background:var(--line);border-radius:2px;width:75%;"></div>
            <div style="height:10px;background:var(--line);border-radius:2px;width:85%;"></div>
          </div>
          <div class="rv-sub" style="margin-top:8px;">Matches the final layout — no reflow.</div>
        </div>
        <div class="rv-card">
          <div class="rv-card-head"><h3>Empty — instructive</h3></div>
          <div style="text-align:center;padding:12px 8px;">
            <div style="font-size:28px;color:var(--ink-mute);line-height:1;">◎</div>
            <div style="font-size:12px;font-weight:600;margin-top:8px;">No positions yet</div>
            <div class="rv-sub" style="margin-top:2px;">Open the scanner and pick a signal above EV $50.</div>
            <span class="rv-btn ghost" style="font-size:11px;margin-top:8px;display:inline-block;">open scanner →</span>
          </div>
        </div>
        <div class="rv-card" style="border-color:rgba(255,0,110,.3);">
          <div class="rv-card-head"><h3 style="color:var(--pink);">Error — actionable</h3></div>
          <div class="rv-sub">Alpaca paper API timeout</div>
          <div style="font-size:11px;font-family:'JetBrains Mono';color:var(--ink-dim);margin-top:4px;">504 · 10.2s · /v2/orders</div>
          <div style="display:flex;gap:6px;margin-top:10px;">
            <span class="rv-btn ghost" style="font-size:11px;">retry</span>
            <span class="rv-btn ghost" style="font-size:11px;">view logs</span>
          </div>
        </div>
      </div>
    </div>

    <div class="critique">
      <h3>4 · Global shell as a component</h3>
      <ol>
        <li>Extract the left rail + top bar into a <code>&lt;AppShell&gt;</code> layout that wraps every page. Today each page re-renders its own "← Back to Dashboard" — inconsistent and wastes pixels.</li>
        <li>The top bar owns: paper/live, regime, 1-day VaR, daily P&L, command palette, HALT-ALL. These are global — they don't belong in page cards.</li>
        <li>The left rail groups by workflow (Trade / Monitor / Research / Automation) — not flat alphabetical.</li>
        <li><code>⌘K</code> command palette: ticker, actions ("buy CIFR", "halt engine", "regime status"), pages. Fuzzy search. This is the feature that removes the need for the 17-button dashboard grid entirely.</li>
      </ol>
    </div>

    <div class="critique">
      <h3>5 · Motion</h3>
      <ol>
        <li>Numbers that change live (P&L, Greeks, NAV) should <b>count-up</b> over ~400ms, not flash-replace. Preserves context.</li>
        <li>Rows entering the scanner from a new scan should <b>slide in with a brief gold highlight</b> (1s) so the user notices without it being distracting.</li>
        <li>Chart updates should ease, never jump. Popmotion or framer-motion at 150ms cubic-out.</li>
        <li>No decorative animation. The HMM regime dot's pulse is <i>semantic</i> (live feed active) — keep those; cut everything else.</li>
      </ol>
    </div>

    <div class="critique">
      <h3>6 · Pages not mocked — apply the same playbook</h3>
      <ol>
        <li><b>Vol surface (/vol-surface)</b> — fine as-is, but inline a small version on the pricing page and link from the chain.</li>
        <li><b>Risk dashboard (/risk-management)</b> — merge with <b>Portfolio</b>. VaR, position limits, and portfolio Greeks belong together.</li>
        <li><b>Strategy builder (/strategy)</b> — make it a <b>modal</b> opened from the chain's ticket "suggested structures", not a standalone route.</li>
        <li><b>NLP sentiment (/nlp-sentiment)</b> — add a per-ticker sentiment column to the scanner; keep the standalone for deep-dive.</li>
        <li><b>Backtest (/backtesting)</b> — OK as standalone. Add a "run this strategy on the backtester" shortcut from the strategy builder.</li>
        <li><b>Trade journal (/trade-journal)</b> — filter by tag (auto-engine, manual, paper, live). Attach Greek contribution to each closed trade.</li>
        <li><b>Live trading (/live-trading)</b> — the paper/live toggle belongs in the top bar. This page becomes "broker connection status + order fills".</li>
        <li><b>Positions (/positions)</b> — dedupe with Portfolio's open-positions table. Keep one.</li>
        <li><b>VegaEdge agent (/agent)</b> — keep, but anchor it to the command palette: <code>⌘K</code> → type a question → the agent answers inline.</li>
        <li><b>API docs (/api-docs)</b> — move into the help/about menu. Shouldn't be a top-level nav item.</li>
      </ol>
    </div>

    <div class="footnotes">
      <h4>Next steps</h4>
      <p style="font-size:13px;line-height:1.6;">Pick the 3–4 moves that land first. My priorities:</p>
      <ol style="font-size:13px;line-height:1.7;">
        <li><b>Global shell + command palette</b> — biggest navigation win, unblocks everything else. ~1 week.</li>
        <li><b>Scanner revamp (deep-links into chain)</b> — biggest flow win, cuts trade-placement clicks by 3×. ~1 week.</li>
        <li><b>Option chain densification + inline ticket</b> — the trade surface has to be tight. ~1.5 weeks.</li>
        <li><b>Portfolio single-viewport with P&L attribution</b> — the monitor that runs during market hours needs to work in one glance. ~1 week.</li>
      </ol>
      <p style="font-size:13px;margin-top:10px;">Happy to push any of these to hi-fi React using your existing Tailwind v4 tokens and <code>pnpm dev</code> stack.</p>
    </div>

    <style>
      .token-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
      .token-grid .tok { background: #0d0e11; border: 1px solid var(--line); border-radius: 5px; padding: 10px; font-size: 11.5px; line-height: 1.5; }
      .token-grid .tok b { display: block; color: var(--ink); margin-bottom: 2px; }
      .token-grid .tok > div { color: var(--ink-mute); }
      .token-grid .sw { display: inline-block; width: 16px; height: 16px; border-radius: 3px; vertical-align: middle; margin-right: 6px; }
      .type-scale { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 10px; }
      .type-scale .lbl { font-size: 10px; color: var(--ink-mute); font-family: 'JetBrains Mono'; margin-bottom: 4px; }
      .note { font-size: 12px; color: var(--ink-mute); margin-top: 10px; padding: 8px 10px; border-left: 2px solid var(--blue); background: rgba(58,141,255,.04); }
    </style>
  `
});
