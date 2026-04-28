# VegaEdge UI Revamp — Claude Code Implementation Brief

**Repo:** `somesh-13/options-trading-system` · **Branch:** `iaac-poc`
**Stack:** Next.js 16 (App Router), React 19, Tailwind v4, TypeScript, Chart.js, Plotly, Alpaca SDK.
**Goal:** Implement the UI revamp documented in `VegaEdge UI Revamp.html` (sibling design file). Do not rewrite the backend — only frontend, styles, and routing.

---

## 0 · How to use this document

This is a sequential, file-by-file implementation plan. Each **Phase** is independently shippable — do not start Phase N+1 until Phase N is merged, passing typecheck, and looks right in `pnpm dev`. Each **Task** is a single commit's worth of work.

When in doubt about a visual detail, open the design file and inspect the corresponding "After" frame:
- `VegaEdge UI Revamp.html#dashboard` → Phase 2
- `VegaEdge UI Revamp.html#scanner`   → Phase 3
- `VegaEdge UI Revamp.html#chain`     → Phase 4
- etc.

**Non-goals (do not do):**
- Do not touch `src/lib/pricing/*`, `src/lib/regime/*`, `src/lib/strategy/*`, or any API route under `src/app/api/**`. Backend is correct — we're only changing how it's presented.
- Do not add a new design-system package. Stay inside Tailwind v4 tokens.
- Do not introduce shadcn/ui, Radix, or a new icon library if one already exists — check `package.json` first.

**Preserve:**
- Existing color tokens: `#00C805` (green), `#FFD700` (gold), `#FF006E` (pink). These are the brand.
- All existing API contracts and hook signatures.
- Dark-theme-only. Do not add a light-mode toggle.

---

## 1 · Phase 0 · Tokens and type scale

**Why first:** every later phase consumes these. Adding them now means everything else just references them.

### Task 0.1 — Semantic color tokens

Edit `tailwind.config.ts` (or `app/globals.css` if Tailwind v4 CSS-first config):

```css
@theme {
  /* Existing brand — preserve */
  --color-ve-green: #00C805;
  --color-ve-gold:  #FFD700;
  --color-ve-pink:  #FF006E;

  /* New semantic tokens — prefer these in components */
  --color-signal-buy:     var(--color-ve-green);  /* long / healthy / approved */
  --color-signal-sell:    var(--color-ve-gold);   /* short premium / caution */
  --color-signal-risk:    var(--color-ve-pink);   /* breach / danger / halt */
  --color-signal-info:    #3A8DFF;                /* ATM, selection, info */

  /* Surface scale (dark) */
  --color-bg:        #0a0b0d;
  --color-surface-1: #0d0e11;
  --color-surface-2: #111217;
  --color-line:      #1f2228;
  --color-line-soft: #16181d;

  /* Ink scale */
  --color-ink:       #e7e9ec;
  --color-ink-dim:   #b6bac2;
  --color-ink-mute:  #6e7580;
}
```

**Rule of thumb for consumers:**
- `signal-buy` = BUY signal, positive P&L, healthy regime, within-limit guards.
- `signal-sell` = SELL-premium signal, high-vol regime, rate-limit approaching.
- `signal-risk` = negative P&L, breach, crash regime, HALT button, live-account badge.
- `signal-info` = ATM markers, current selection, modeled/expected values, links.
- `ink-mute` = timestamps, labels, counts, low-importance meta.

Replace ad-hoc usage of `text-green-500`, `text-yellow-400`, etc., with the semantic classes as you touch each file in later phases. **Do not do a repo-wide replace in this task** — it'll conflict with every other PR.

### Task 0.2 — Mono font for data

The spec uses JetBrains Mono for all numeric/data cells so digits tabular-align.

1. Add to `app/layout.tsx`:
   ```tsx
   import { JetBrains_Mono, Inter } from 'next/font/google'
   const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
   const mono  = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
   // apply both variables to <html className={`${inter.variable} ${mono.variable}`}>
   ```
2. In the Tailwind config, wire `font-sans` and `font-mono` to those variables (Tailwind v4 picks up CSS vars automatically if you use `@theme`).
3. Convention: prose uses default sans; any cell rendering a number, ticker symbol, timestamp, or Greek value uses `font-mono`.

### Task 0.3 — Type scale utilities

Add to `globals.css`:

```css
.text-display   { font-size: 20px; line-height: 28px; font-weight: 600; }
.text-section   { font-size: 13px; line-height: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-ink-dim); }
.text-body      { font-size: 12px; line-height: 18px; }
.text-data      { font-size: 11.5px; line-height: 16px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.text-meta      { font-size: 10px; line-height: 14px; font-family: var(--font-mono); color: var(--color-ink-mute); }
```

**Acceptance:** you can visit any existing page and the mono font is active on any `<span className="text-data">`.

---

## 2 · Phase 1 · Global app shell

**Why second:** once the shell exists, every page you touch later drops its own "← Back to Dashboard" header. Net code reduction.

### Task 1.1 — Create `src/components/shell/AppShell.tsx`

Layout: fixed left rail (56px), fixed top bar (48px), scrollable content area below.

**Top bar contents (left → right):**
1. Logo (`vega` in sans + `Edge` in mono-gold).
2. Breadcrumbs (derive from `usePathname()`, join with " · ").
3. Command palette button (see Task 1.3) — flex-1, with `⌘K` hint.
4. Pills (in order): regime · VaR · paper/live · live-data dot.
5. HALT-ALL button (only visible if auto-engine is running; see Task 5.x).

**Left rail contents:**
Groups with thin separators. Use icons only; tooltips on hover with the label.

| Group      | Icon | Label       | Route                 |
|------------|------|-------------|-----------------------|
| Trade      | `◎`  | Home        | `/`                   |
|            | `⊞`  | Scanner     | `/scanner`            |
|            | `≣`  | Chain       | `/options-chain`      |
|            | `ƒ`  | Pricing     | `/pricing`            |
| Monitor    | `⊟`  | Portfolio   | `/portfolio`          |
|            | `◫`  | Positions   | `/positions`          |
|            | `△`  | Risk        | `/risk-management`    |
| Automation | `⟳`  | Auto engine | `/auto-engine`        |
|            | `⊿`  | Backtest    | `/backtesting`        |
|            | `∿`  | NLP         | `/nlp-sentiment`      |
|            | `◉`  | Agent       | `/agent`              |

**Icons:** if `lucide-react` is already installed, prefer lucide glyphs (`Home`, `Search`, `Layers`, `Function`, `PieChart`, `Target`, `Triangle`, `RotateCcw`, `BarChart3`, `Activity`, `Sparkles`). If not, use the Unicode glyphs above — do **not** add a new icon library.

Active state: highlight with a 2px left-border in `--color-signal-info` and filled icon background.

### Task 1.2 — Wrap every page in the shell

Edit `src/app/layout.tsx`. Wrap `{children}` in `<AppShell>`. Every page currently renders its own "← Back to Dashboard" link and page title — **delete those** from:

- `src/app/page.tsx`
- `src/app/scanner/page.tsx`
- `src/app/options-chain/page.tsx`
- `src/app/pricing/page.tsx`
- `src/app/portfolio/page.tsx`
- `src/app/risk-management/page.tsx`
- `src/app/live-trading/page.tsx`
- `src/app/auto-engine/page.tsx`
- `src/app/nlp-sentiment/page.tsx`
- `src/app/backtesting/page.tsx`
- `src/app/strategy/page.tsx`
- `src/app/trade-journal/page.tsx`
- `src/app/vol-surface/page.tsx`
- `src/app/positions/page.tsx`
- `src/app/agent/page.tsx`

Each page should now start with a small `<h2 className="text-display">` + optional sub-line, not a giant H1 with a breadcrumb.

### Task 1.3 — Command palette (`⌘K`)

New component `src/components/shell/CommandPalette.tsx`.

**Action types (union):**
```ts
type PaletteAction =
  | { kind: 'nav'; label: string; path: string }
  | { kind: 'ticker'; symbol: string; spot?: number }  // → /options-chain?ticker=SYM
  | { kind: 'action'; label: string; run: () => void | Promise<void> }  // halt engine, rehedge, etc.
```

**Sources:**
- `nav` — hardcoded list matching the left rail.
- `ticker` — fuzzy-match against the user's watchlist (read from wherever watchlists live; if not persisted yet, use a static list of Mag 7 + BTC miners).
- `action` — hardcoded set: `halt engine`, `resume engine`, `rehedge to Δ 0`, `switch to live`, `switch to paper`.

**Behavior:**
- Open on `⌘K` / `Ctrl+K`, `Esc` closes. Use `useEffect` keydown listener on `window`.
- Fuzzy search with a tiny local matcher — do **not** add a new dependency for this. A lowercased `indexOf` on a combined "label symbol kind" string is fine.
- Selecting a `nav` calls `router.push(path)`. `ticker` routes to chain. `action` runs and closes.
- Remove the old 17-button dashboard grid in `src/app/page.tsx`. The palette replaces it.

**Acceptance:** press `⌘K` anywhere, type "cifr", hit enter, land on `/options-chain?ticker=CIFR`.

### Task 1.4 — Persistent state pills

Top-bar pills read live data and are always current.

Create `src/components/shell/StatusPills.tsx` with four subcomponents:

1. `<RegimePill />` — subscribes to HMM regime endpoint (whatever `useRegime()` returns; if no hook exists, create one that calls the existing regime API on a 30s interval). Classes: `normal` → info blue, `high-vol` → gold, `crash` → pink.
2. `<VarPill />` — 1-day 95% VaR. Hits `/api/risk/var` on same 30s cadence.
3. `<PaperLivePill />` — reads `process.env.NEXT_PUBLIC_ALPACA_MODE` or a context. Clicking it opens a modal: "Switch to LIVE? Type LIVE to confirm." Only after the user types "LIVE" does the context flip. In paper mode, pill is gold; live mode, pill is pink.
4. `<LiveDataPill />` — green pulsing dot if market data websocket is connected, grey if disconnected.

---

## 3 · Phase 2 · Home (`/`) → "Today"

### Task 2.1 — Delete the link-grid

`src/app/page.tsx` currently renders ~17 link-buttons and a `<MispricingDetector>`. Delete the link-grid and the "System Architecture" card entirely. The nav is handled by the shell now.

### Task 2.2 — KPI strip component

New `src/components/home/KpiStrip.tsx`. 4 columns (`grid-cols-4`), each cell:

```tsx
<KpiCell
  label="NAV"
  value="$142,080"
  delta="+$1,240 · +0.88%"
  tone="up" // 'up' | 'down' | 'neutral'
/>
```

Data sources:
- NAV → existing portfolio hook (`usePortfolio()` or equivalent).
- Day P&L → same.
- 1-day VaR 95% → `/api/risk/var`.
- Daily trades / loss budget → `/api/auto-engine/limits` (create this endpoint if it doesn't exist; should return `{ tradesToday, tradesCap, lossToday, lossCap }` from the auto-engine state).

### Task 2.3 — Top opportunities table

New `src/components/home/OpportunityTable.tsx`. Columns:

| Column       | Source                                                     |
|--------------|------------------------------------------------------------|
| Ticker       | symbol                                                     |
| Spot         | latest quote                                               |
| IV/HV scale  | `<IvHvScale iv hv ratio />` — see Task 2.4                 |
| Ratio        | `iv/hv`, colored by threshold (`<0.8` green, `>1.3` gold)  |
| Signal       | `BUY` / `SELL` / `NEUTRAL` chip                            |
| Regime       | from HMM, colored chip                                     |
| EV / contract| from `POST /api/strategy/ev/scan`                          |
| Hit rate     | from same                                                  |
| → chain      | `<Link href={\`/options-chain?ticker=${sym}\`}>chain →</Link>` |

Data fetch:
- Fetch all watchlist tickers' EV, regime, IV/HV in parallel (`Promise.all` on the existing per-ticker endpoints).
- Sort by `ev` descending.
- Auto-refresh every 60s; show "next refresh in Ns" in a subtle corner.

Filter tabs above the table: `My list`, `Mag 7`, `Mispriced` (pre-filter to `|ratio - 1| > 0.25`), `+ filter` (opens a filter popover — stub for now, just the tabs).

### Task 2.4 — `<IvHvScale>` component

Shared component, also used by Scanner (Phase 3). New file `src/components/charts/IvHvScale.tsx`.

```tsx
export function IvHvScale({ iv, hv, ratio }: { iv: number; hv: number; ratio: number }) {
  const min = 0.5, max = 2.0;
  const pct = Math.max(0, Math.min(1, (ratio - min) / (max - min))) * 100;
  // Layout spec:
  //   110×10 rail, 1px border, #0c0d10 bg.
  //   Shaded BUY zone 0.5→0.8 (translucent green).
  //   Shaded SELL zone 1.3→2.0 (translucent gold).
  //   Center tick at 1.0 (muted).
  //   Current marker at `pct` (2px white bar).
  //   Side label: "${iv*100|0}/${hv*100|0}" in mono mute.
}
```

See the "After" frames on Dashboard/Scanner in the design file for exact styling.

### Task 2.5 — Portfolio Greeks + recent signals (bottom row)

Two cards side-by-side:
- **Aggregate Greeks** — reuse `<GreekCell>` primitive (Task 4.3). Shows Δ Γ Θ V. Each with a sub-line ("$ delta = $44.2k", "/ day", etc.).
- **Recent signals** — tail of the auto-engine event stream. Reuse `<EventRow>` (Task 5.4). Filter to `exec + signal` by default.

**Acceptance:** `/` loads in under 2s with real data, no flashes of empty state (use skeletons from Phase 7), ranks 8+ tickers by EV, every row has a working `chain →` link.

---

## 4 · Phase 3 · Scanner (`/scanner`)

### Task 3.1 — Delete the chip-input form

In `src/app/scanner/page.tsx`, delete the "Add ticker" input + "Add" button + "Scan All" button. Replace with watchlist tabs (same preset set as Home). The scanner should scan automatically on mount and on a 5-min interval.

### Task 3.2 — Reuse the Opportunity Table

Move `OpportunityTable` from `src/components/home/` to `src/components/scanner/` (or keep in home and import — your call; prefer a shared module if you rename it `SignalTable`).

The scanner version adds 2 extra columns:
- **Spark 30d** — inline SVG sparkline. Create `<Sparkline data={number[]} color tone="up|down" />` in `src/components/charts/Sparkline.tsx`. Use plain SVG, no Chart.js — it needs to render in table rows and Chart.js is too heavy for 8 inlined charts.
- **EV bar** — horizontal bar centered at 0, negative = left red, positive = right green. Create `<EvBar ev={number} max={100} />` in `src/components/charts/EvBar.tsx`.

### Task 3.3 — Hotkeys

Add a `useKeyboardNav` hook that lets the scanner table respond to:
- `/` → focus the filter input
- `j` / `k` → move selection down / up
- `Enter` → navigate to `/options-chain?ticker=${selected.symbol}&exp=${selected.bestExpiration}`
- `b` → navigate to the strategy builder with the ticker preloaded

Visually, the selected row gets the `sel` treatment (gold-tinted bg, left border in gold).

### Task 3.4 — Filter chips

Above the table, a row of toggle chips: `regime = high-vol`, `|ratio| > 1.2`, `EV > $50`, `hit > 55%`. These are additive AND filters. Clicking a chip removes it; `+` opens a popover with all other columns as filter candidates. Store active filters in URL params so refresh preserves them.

**Acceptance:** scanner auto-scans on mount, ranks by EV desc, `⏎` on any row deep-links to the chain with ticker + best expiration preselected.

---

## 5 · Phase 4 · Option chain (`/options-chain`)

### Task 4.1 — Kill the sidebar

`src/app/options-chain/page.tsx` currently splits 68/32 with "Market Status / Expiration Info / Navigation" sidebar cards on the right. Delete the sidebar entirely. Market status moves into the top bar's `<LiveDataPill>` (already in Phase 1). Expiration info goes into the expiration strip (Task 4.2). Navigation is handled by the shell.

### Task 4.2 — Expiration strip

New `src/components/chain/ExpirationStrip.tsx`. Horizontal grid of 6 cells, each:

```
24d
May 17
ATM IV 72%
44k OI
```

Fetches list of expirations from your existing options endpoint. Selected cell gets a gold border. Clicking selects.

### Task 4.3 — Dense chain table

New `src/components/chain/ChainTable.tsx`. Split header with CALLS (left) and PUTS (right), strike column in the middle.

**Columns (left to right):**
CALLS: Bid, Ask, IV, Δ¹, Γ¹, Θ¹, V¹ → **Strike** → PUTS: Bid, Ask, IV, Δ¹ → EV signal

`¹` superscript denotes first-order Greek. Add a "more Greeks" toggle above the table that swaps to second-order (Vanna, Charm, Volga) — re-using `GreekCell` (below).

**Row styling:**
- ATM row: `border-top` and `border-bottom` in `--color-signal-info` (2px) with tinted bg.
- ITM cells: slight lift (`bg-white/[.02]`).
- Strike cell: darker background, font-weight 600.
- Selected row (when user clicks for ticket): gold tint.

**Row click:** populates the order ticket (Task 4.4), does not navigate.

Row density target: 22px row height. Do not exceed 24px.

### Task 4.4 — Inline order ticket

New `src/components/chain/OrderTicket.tsx`. 340px fixed-width card, right of the table (CSS grid `grid-template-columns: 1fr 340px`).

Ticket shows (read the design file for exact layout):
- Contract line: `CIFR 240517C16.00`
- Subline: `Short 24-day 16 call · mid 0.82 · IV 74%`
- Editable: Side (BUY/SELL), Qty, Limit (default = mid), TIF
- Computed: Max profit, Max loss, Breakeven, POP (HMM-adjusted), EV / contract
- Suggested structures: bear call spread, iron condor (from `POST /api/strategy/ev/scan` response)
- Primary button: colored by side (SELL = pink, BUY = green), text = `${SIDE} ${qty}× @ ${limit}`
- Secondary: `simulate` (opens backtest modal with just this trade, Phase 6)
- Footer: "paper account · click to review" (or "LIVE · confirm required" in red on live).

`GreekCell` primitive (reused by Pricing page too): `src/components/chain/GreekCell.tsx`. Renders a symbol (Δ/Γ/Θ/V/etc.) with a superscript order (1 or 2), a value, an optional unit sub-line. Second-order variant has a gold-tinted background + border.

**Acceptance:** click a strike in the chain → ticket populates → Qty editable → max profit/loss/EV recompute locally. No actual order placement in this phase.

---

## 6 · Phase 5 · Pricing (`/pricing`)

### Task 5.1 — Split inputs vs outputs

Current page has inputs left, 8 equal Greek cards right. Restructure to a 320px input column + rest.

Input column contains:
- Read-only data grid (Spot, Strike, Type, r).
- Two sliders for σ and T (new `<Slider label current min max />` component).
- Big "theoretical price" readout at the bottom.

### Task 5.2 — Grouped Greek grid

In the right column:
- Section: "First-order Greeks" — 5 `<GreekCell>` in a row (Δ Γ Θ V ρ).
- Section: "Second-order Greeks · your edge" — 3 `<GreekCell ord={2} />` for Vanna, Charm, Volga, with gold accent per Task 4.3.

Each `<GreekCell>` embeds a mini `<Sparkline>` showing the Greek curve vs spot. Generate the curve client-side by calling your existing Black-Scholes with spot in a ±25% range around the current — the math is already in `src/lib/pricing/`.

### Task 5.3 — Inline vol surface

Below the Greek grid, a compact 7×9 heatmap of IV vs (strike × DTE). New `src/components/pricing/MiniVolSurface.tsx`:

```tsx
// grid-cols-7, each cell aspect-2/1, bg gold with opacity = normalized IV, value shown inside
```

Click a cell → repopulate inputs with that strike + DTE.

### Task 5.4 — Mode toggle

Top-right of the page:
- `Price from IV` (default) — current behavior.
- `IV from price` — σ slider becomes disabled, add a "market price" input, "theoretical price" becomes "solved IV".

**Acceptance:** move the σ slider — all 5 first-order Greeks, their sparklines, the price readout, and the vol surface's ATM column all animate smoothly.

---

## 7 · Phase 6 · Portfolio (`/portfolio`)

### Task 6.1 — Single-viewport top row

Two columns, 1.4fr + 1fr:
- **Left (1.4fr):** NAV + equity curve (use existing Chart.js setup; you do not need to replace it). Period tabs: 1D / MTD / 3M / 1Y. 4 metrics row below: Day, MTD, Sharpe, Max DD.
- **Right (1fr):** Aggregate Greeks (`<GreekCell>` ×4) + Day P&L attribution stacked bar + Suggested hedge card.

### Task 6.2 — P&L attribution bar

New `src/components/portfolio/PnlAttribution.tsx`. Takes `{ delta, gamma, theta, vega, residual }` and renders a horizontal stacked bar with labels underneath. Colors:
- Δ → green
- Γ → lighter green
- V → info blue
- Θ → info blue variant
- residual → mute grey
- negative contributions → pink

If you don't already compute attribution, add `src/lib/portfolio/attribution.ts`: `attribute(prevGreeks, nextGreeks, dS, dSigma, dt) → { delta, gamma, theta, vega, residual }`.

### Task 6.3 — Hedge suggestion card

New `src/components/portfolio/HedgeCard.tsx`. Appears when `abs(portfolioDelta) > threshold` (start with threshold = 50).

Content: `Δ drift +284 · suggested hedge` / `sell 2.8 SPY ES futures · Δ → 0 · Γ unchanged`. The suggestion comes from your existing `/api/strategy/hedging` endpoint.

Clicking opens the Order Ticket (Phase 4) with the hedge pre-filled.

### Task 6.4 — Positions table with Greek contribution

Full-width card below the top row. Columns: Position, Structure (chip), Qty, Entry, Mark, P&L, Δ contrib, Γ contrib, Θ contrib, V contrib, actions (close).

Per-position Greek contribution = position size × per-contract Greek. You have the data; just multiply.

---

## 8 · Phase 7 · Auto engine (`/auto-engine`)

### Task 7.1 — Header with HALT-ALL

Replace "Stop Engine" button at bottom with a prominent HALT-ALL in the page header (and mirrored in the top bar when the engine is running). Pink bg, white text, `■` glyph.

Status chip next to title: green pulsing dot if running, grey if stopped. Show uptime and next-scan countdown.

Also in the header: `dry run` toggle. When dry-run is on, engine runs its scanner + signal logic but flips every `EXEC` to `WOULD-EXEC` (log only, no actual order). Add a `DRY RUN` banner across the top of the content area.

### Task 7.2 — Guardrail card

Replace the "Configuration" form with a `<Guardrails />` card showing each limit as a `<LimitBar>`:

```tsx
<LimitBar label="Daily loss" used={340} cap={1000} unit="$" />
```

Bar: height 6px, fills with green if under 70%, gold if 70–90%, pink if over 90%.

Show 4 bars minimum: Open positions, Daily loss, Trades today, Exposure.

Below, an "Entry conditions" section showing the static config (min EV, min hit rate, max σ, size, regime req, scan interval) as a 2-column read-only mono grid.

Below that, a "Session stats" section: scans, signals, executed, skipped, errors, session P&L.

(Editing config moves to a modal opened from a gear icon. Most users don't edit often; the live state is what matters.)

### Task 7.3 — Event stream

New `src/components/auto/EventStream.tsx`. Replace the plain-text activity log with a color-coded stream of `<EventRow>`.

`EventRow` props: `{ time, kind: 'scan'|'signal'|'exec'|'skip'|'error', symbol?, message, trace? }`.

Layout: grid `90px 70px 50px 1fr` for time / kind / symbol / message. Kind is uppercase mono, colored by type. Clicking a row with a `trace` expands it inline (show the decision tree: spot · IV · ratio · EV · hit · regime · decision · reason).

Filter chips above: `all`, `exec`, `signal`, `skip`, `error`. Default `all`.

Server side: if your existing auto-engine doesn't emit a "reason" field on SKIP events, add one — the hooks are already there, you just need to include which guard fired.

**Acceptance:** enable dry-run, let it scan once, see a visible scan/signal/skip/exec cascade in the stream. Click HALT-ALL → engine stops in <2s, next scan countdown freezes.

---

## 9 · Phase 8 · Cross-cutting

### Task 8.1 — Skeleton components

New `src/components/state/Skeleton.tsx`. Generic pulse-animated rectangle. Every page that waits on data should render skeletons in the same layout as the final content — not "Loading...", not blank. The pages to update are the same list as Task 1.2. For each, identify the top-level data-dependent block(s) and render a skeleton-shaped mirror during `isLoading`.

### Task 8.2 — Empty states

New `src/components/state/EmptyState.tsx`. Props: `{ icon, title, sub, action?: { label, onClick } }`. Use on:
- Portfolio with 0 open positions
- Scanner with 0 watchlist tickers
- Trade journal with 0 closed trades
- Agent with no prior conversations

Every empty state must instruct the user on the next action and include a button that performs it.

### Task 8.3 — Error boundary

New `src/components/state/ErrorCard.tsx`. Use in React error boundaries around each page's data-fetching block. Shows: error title, structured detail (status · duration · endpoint), and two buttons: `retry`, `view logs`.

Also add a root error boundary in `src/app/error.tsx` (Next.js App Router convention).

### Task 8.4 — Motion

Install `framer-motion` if not already. Apply minimally:
- Numbers that change (P&L, NAV, Greeks, VaR) use a `<CountUp>` component that animates from previous to current over 400ms. Preserves context.
- New rows in the scanner fade in with a 1s gold background highlight that decays. Use `layout` animations from framer-motion.
- Chart data updates: 150ms `cubic-out` ease — configure via Chart.js `animation.duration` and easing.
- **Do not** add decorative page-transition animations. Every motion must be semantic.

### Task 8.5 — Pages not mocked (apply playbook)

Bring these into the new shell and style system but don't restructure beyond that:
- `/vol-surface` — leave as-is, just fits into shell.
- `/risk-management` — **merge into `/portfolio`** as a tab. Delete the route. Update links.
- `/strategy` — **convert to a modal** opened from the chain's ticket. Delete the route.
- `/nlp-sentiment` — leave as standalone, but add a `sentiment` column to the scanner (read from the existing NLP endpoint; color `+` green, `−` pink).
- `/backtesting` — leave as-is, new shell only.
- `/trade-journal` — leave as-is, add a filter-chip row (`auto-engine`, `manual`, `paper`, `live`).
- `/live-trading` — **rename to `/broker`**, repurpose as broker connection + fills page. The paper/live toggle moves into the top bar (Task 1.4).
- `/positions` — **merge into `/portfolio`**. Delete the route.
- `/agent` — keep, but wire `⌘K` to also accept free-form questions and route them here.
- `/api-docs` — demote: remove from nav, keep reachable from a help menu in the top-bar overflow.

Run a link-check after to catch dead routes.

---

## 10 · Commit and PR convention

One PR per **Phase**, branched from `iaac-poc`. Title format:
- `feat(ui): phase 0 — design tokens and type scale`
- `feat(ui): phase 1 — app shell + command palette`
- …

Each PR must include:
1. Screenshots of every page the PR touches, before and after.
2. A checklist ticking off every Task in this doc's phase.
3. A note on any deviation from this doc and why.

Do not merge Phase N+1 before Phase N is on `iaac-poc`.

---

## 11 · Definition of done (whole project)

- [ ] Every page in the app renders inside `<AppShell>`.
- [ ] `⌘K` works on every page, routes + actions + ticker search functional.
- [ ] No page shows a 17-button link grid or a "← Back to Dashboard" link.
- [ ] Scanner and Home both use the shared `SignalTable` with working deep-links.
- [ ] Chain is one-screen dense; ticket populates on row click.
- [ ] Pricing shows 1st- and 2nd-order Greeks as visually distinct groups.
- [ ] Portfolio fits in one viewport with attribution + hedge suggestion.
- [ ] Auto engine shows guardrails as bars, has dry-run mode, and has a prominent HALT-ALL.
- [ ] All data cells use `font-mono` with tabular numerals.
- [ ] No use of raw `text-green-500` / `text-yellow-400` / `text-red-500` in components touched — use semantic tokens.
- [ ] Every page has skeletons, empty states, and error cards.
- [ ] `pnpm typecheck` and `pnpm lint` pass.
- [ ] `pnpm dev` starts without console errors on any page.

---

## Appendix A · Component inventory (to create)

Shared primitives:
- `components/shell/AppShell.tsx`
- `components/shell/TopBar.tsx`
- `components/shell/LeftRail.tsx`
- `components/shell/CommandPalette.tsx`
- `components/shell/StatusPills.tsx` (exports `RegimePill`, `VarPill`, `PaperLivePill`, `LiveDataPill`)
- `components/charts/IvHvScale.tsx`
- `components/charts/Sparkline.tsx`
- `components/charts/EvBar.tsx`
- `components/chain/GreekCell.tsx` (used by Chain + Pricing + Portfolio)
- `components/state/Skeleton.tsx`
- `components/state/EmptyState.tsx`
- `components/state/ErrorCard.tsx`
- `components/motion/CountUp.tsx`

Page-specific:
- `components/home/KpiStrip.tsx`
- `components/home/OpportunityTable.tsx` (or rename to `components/signals/SignalTable.tsx` if sharing with scanner)
- `components/scanner/FilterChips.tsx`
- `components/chain/ExpirationStrip.tsx`
- `components/chain/ChainTable.tsx`
- `components/chain/OrderTicket.tsx`
- `components/pricing/Slider.tsx`
- `components/pricing/MiniVolSurface.tsx`
- `components/portfolio/PnlAttribution.tsx`
- `components/portfolio/HedgeCard.tsx`
- `components/auto/Guardrails.tsx` (uses internal `LimitBar`)
- `components/auto/EventStream.tsx` (uses internal `EventRow`)

---

## Appendix B · API assumptions

These endpoints are assumed to exist (from reading the `iaac-poc` branch). If any are missing, add them as thin wrappers over the existing lib code — do not duplicate the math.

- `GET  /api/quote?ticker=SYM` → `{ spot, change, changePct }`
- `GET  /api/options/chain?ticker=SYM&expiration=YYYY-MM-DD` → chain with Greeks
- `GET  /api/options/greeks?ticker=SYM&strike&expiration&type` → `{ delta, gamma, theta, vega, rho, vanna, charm, volga }`
- `POST /api/strategy/ev/scan` body `{ tickers: string[] }` → array of `{ ticker, ev, hitRate, signal, iv, hv, ratio, bestExpiration, bestStrike, suggestedStructures }`
- `GET  /api/regime` → `{ state: 'normal'|'high-vol'|'crash', confidence }`
- `GET  /api/risk/var?horizon=1d&conf=0.95` → `{ var, method: 'historical'|'parametric'|'mc' }`
- `GET  /api/portfolio` → `{ nav, dayPnl, positions[], greeks, equityCurve }`
- `GET  /api/portfolio/attribution?period=1d` → `{ delta, gamma, theta, vega, residual }`
- `POST /api/strategy/hedging` body `{}` → `{ suggestedHedge: { instrument, qty, resultingDelta, resultingGamma } }`
- `GET  /api/auto-engine/state` → `{ running, uptime, nextScanIn, limits, sessionStats }`
- `GET  /api/auto-engine/events?limit=100&kinds[]=exec&kinds[]=signal` → event stream
- `POST /api/auto-engine/halt`
- `POST /api/auto-engine/dry-run` body `{ enabled: boolean }`

If an endpoint returns a shape that doesn't match what a component expects, add a thin mapper in `src/lib/adapters/` — do **not** reshape endpoints. Backend contracts stay stable.

---

Reference design file: `VegaEdge UI Revamp.html` in the `somesh-13` design project. Each phase above has a visual "After" frame in that file; open the matching page tab for pixel-level guidance.
