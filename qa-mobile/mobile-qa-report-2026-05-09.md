# Mobile QA Report — 2026-05-09

## Scope

- **Target**: VegaEdge trading dashboard at `/home/jarvis/tst/trading-dashboard-app`
- **Method**: **Live browser** with Playwright 1.59.1 (Chromium engine, iOS UA, `isMobile: true`, `hasTouch: true`). Distinct from the 2026-05-03 report which fell back to static analysis because Playwright wouldn't install.
- **Viewport**: iPhone SE 375×667 (the smallest iPhone viewport — most overflow regressions surface here first)
- **Servers**: Next.js dev at `http://localhost:3000` (status 200), FastAPI backend at `http://localhost:8000` (status 200)
- **Test driver**: `/home/jarvis/playwright-js/tests/mobile-qa-iphone-se.spec.ts` — separate from the dashboard's own `node_modules` (root-owned, write-locked)
- **Routes covered (21)**: `/`, `/robinhood`, `/scanner`, `/risk-mgmt`, `/auto-engine`, `/portfolio`, `/positions`, `/options-chain`, `/pricing`, `/backtest`, `/sentiment`, `/strategy`, `/execution`, `/stock/CIFR`, `/stock/HOOD`, `/stock/RDW`, `/agent`, `/glossary`, `/journal`, `/replay`, `/vol-surface`
- **Per-route actions**: navigate → screenshot top → fullPage screenshot → scroll to bottom → screenshot bottom → click every `[role="tab"]` / `.rv-tabstrip [role="tab"]` (with screenshot per tab) → record `pageerror` events, console errors, and `document.scrollWidth`
- **Artifacts**: `qa-mobile/screenshots-2026-05-09/<route>/*.png` and `<route>/finding.json`

---

## Executive summary

- **Total issues**: 9 (live-browser-confirmed)
- **Critical**: 2 (pageerror crash + viewport overflow)
- **High**: 4
- **Medium**: 2
- **Low**: 1
- **Prior report (05-03) status**: F1 (`/options-chain` chain-wrap collapse) **fixed** ✅. F2 (`/pricing`) and F3 (`/auto-engine`) **partly fixed** (CSS collapse rules added at globals.css:655–659) but **header rows still overflow** because the in-page flex toolbar is unrelated to the grid. F4–F6 (table-wrap) **partly verified** — Scanner/Positions tables not visible to confirm; new `/stock/<ticker>` instance found.
- **Mobile readiness**: **Needs fixes** — `/positions` is fully broken (Next.js error overlay), `/scanner` and `/auto-engine` headers clip primary actions on iPhone SE, and `/` Dashboard's MarketsRow merges adjacent ticker labels into garbled text ("ETHEREUMGOLD").

---

## Findings table

| ID | Severity | Page | Component | Issue | User impact | Likely root cause | Suggested fix |
|----|----------|------|-----------|-------|-------------|-------------------|---------------|
| N1 | Critical | `/positions` | `TickerHeader.tsx:19` | Pageerror: `Cannot read properties of undefined (reading 'toFixed')` — Next.js error overlay covers the whole page | Page completely unusable on every viewport — not mobile-specific but iPhone SE renders the overlay first | Backend returned 500; `price`/`change` props are `undefined`; `price.toFixed(2)` throws. No null/undefined guard | Default props to `0` or render skeleton when undefined |
| N2 | Critical | `/auto-engine` | header flex row at `auto-engine/page.tsx:134` | Top toolbar (title + STOPPED chip + START + dry-run + HALT-ALL) does not wrap; HALT-ALL clipped past right edge on 375px | Cannot tap HALT ALL or read engine state on iPhone SE | `<div style={{ display: 'flex', ... }}>` has no `flexWrap: 'wrap'` and no `min-width: 0` on children | Add `flexWrap: 'wrap'` and `rowGap: 6` to the header div |
| N3 | High | `/` (Dashboard) | `MarketsRow` (visible at top of `/`) | 6-column grid renders on 375px without collapse: "ETHEREUM" and "GOLD" labels merge into "ETHEREUMGOLD"; "unavailable" labels overlap each other in adjacent cells | Dashboard's primary KPIs unreadable | `MarketsRow` grid template column count fixed at 6 with no media-query collapse, or column-gap insufficient | Collapse to 2-col below 640px; add ellipsis or word-break to label spans |
| N4 | High | `/` (Dashboard) | header date subtitle in `Dashboard.tsx` | Hydration mismatch: server rendered `Fri, May 8`, client rendered `Sat, May 9`. React throws and re-renders on the client, but the throw shows in `[1 Issue]` overlay | Console noise, slight UI flash, breaks SSR cache; would fail strict-mode hydration | Date computed in render with no SSR-stable source — server's TZ ≠ client's TZ at render boundary | Compute date in `useEffect` and store in state, OR pass server-rendered ISO string and format on client only |
| N5 | High | `/scanner` | header (search bar) + LLM-Scanner submit row | Submit button + example-prompt chips push content beyond 375px viewport (scrollWidth ≈ 750–848 in capture, depending on dev tools state) | Submit and several example queries unreachable without horizontal scroll | LLM Scanner card uses fixed-width Submit button + `flex` row that doesn't wrap | Wrap Submit row and chip row with `flex-wrap: wrap`; mark Submit `flex: 0 0 auto` and prompt input `flex: 1 1 100%` |
| N6 | High | `/stock/CIFR`, `/stock/HOOD`, `/stock/RDW` | "YOUR POSITION" `<table>` (Overview tab) | Table columns clip past right edge: `$1,404.72` truncated to `$1,404.7…`; same on Roth IRA row | Cost-basis values invisible on phone | `<table>` rendered without `<div className="rv-table-wrap">` wrapper that provides `overflow-x: auto` | Wrap the position table in `rv-table-wrap` (matches the fix pattern in F4–F6 from the 05-03 report) |
| N7 | Medium | `/journal` | initial page load | First navigation timed out at 30s waiting for `domcontentloaded`; subsequent visit succeeded with "Failed to fetch P&L summary" banner. Inconsistent first-paint | Slow / flaky load on phone | Likely backend `/api/journal/summary` slow or blocking SSR | Move backend fetch off the SSR critical path; render skeleton + lazy-fetch |
| N8 | Medium | `/pricing` | header row at `pricing/page.tsx:347` | Title `CIFR` + ticker input + Load button + price chip render in a single flex row. On 375px the dash-placeholder ("—") sits where Greeks header should be; `Solve for: Price/IV` chip is far right of an empty zone, suggesting the layout is collapsed but Greeks are shifting | Confusing visual hierarchy on phone | Inline flex row OK, but the next section's `gridTemplateColumns: '1fr 1fr'` at `pricing/page.tsx:482` collapses correctly; the visual gap is from missing CIFR data, not a layout bug per se. Confirmed grid-collapse rules at globals.css:657 are in place. | Tighten the empty-state for missing price data; not a true layout bug |
| N9 | Low | many routes | console | Backend 404s for `/api/markets/quote`, 500s for option/IR endpoints. Surfaced as console errors but caught by UI. | Empty-state UI shown — acceptable on dev | Yfinance / IR scrapers return errors for some tickers | Document as a backend reliability item; not a UI bug |

---

## Cross-reference to prior report (2026-05-03)

| Prior ID | Status | Evidence |
|----------|--------|----------|
| F1 `/options-chain` chain-wrap | **Fixed** ✅ | globals.css:425+656 has the collapse rule. Screenshot `08-options-chain/01-top.png` shows correctly stacked layout — no horizontal overflow |
| F2 `/pricing` inline grid | **Mostly fixed** | `rv-pricing-grid` class with collapse at globals.css:657; visible layout collapses correctly. New issue is data-driven empty state, not the inline override |
| F3 `/auto-engine` inline grid | **Fixed at body** but **N2 in header** | Body uses `rv-engine-grid` with collapse at globals.css:658. Header overflow is a separate flex-wrap bug — see N2 |
| F4 `/scanner` ScannerTable wrap | **Indeterminate** | Backend returned no rows so the table rendered empty. Cannot confirm wrap fix from screenshots |
| F5 `/portfolio` PositionsTable wrap | **Indeterminate** | `/portfolio` redirects to `/robinhood`; PositionsTable not visible in our SE captures |
| F6 `/` Dashboard Greeks-by-ticker table | **Indeterminate** | Empty backend → table not present in the screenshots |
| F7 IRRow expand button tap target | **Untested** | IR panel did not load due to backend 500 |
| F8 `/options-chain` rv-greeks 8-col | **Likely fixed** by F1 cascade |
| F9 EventStream span chips tap target | **Indeterminate** | Engine STOPPED, EventStream rendered no chips |
| F10 IR chips wrap on 320 | **Untested** | 320 viewport not in this run; SE 375 only |
| F11 IR card-head wrap | **Untested** | (same — IR did not load) |
| F12 Scanner FilterChips description text | **Confirmed cosmetic** | Visible in `03-scanner/01-top.png` — not an overflow, just dense text |

---

## Detailed findings

### N1 — `/positions`: Runtime TypeError on TickerHeader (Critical)

- **Severity**: Critical
- **Route**: `/positions`
- **Reproduction**: Open `/positions`. Next.js dev overlay shows immediately with `Runtime TypeError — Cannot read properties of undefined (reading 'toFixed') at TickerHeader (src/components/positions/TickerHeader.tsx:19:54)`.
- **Root cause**: `TickerHeader.tsx:19` calls `${price.toFixed(2)}` but `price` is `undefined` because the upstream fetch returned 500. There is no fallback or guard.
- **Why mobile-specific**: It isn't — desktop crashes too. Surfaces here because every iPhone SE user reaching `/positions` cannot use the page.
- **Fix**:
  ```tsx
  // src/components/positions/TickerHeader.tsx
  export default function TickerHeader({ ticker, price = 0, change = 0, changePct = 0 }: TickerHeaderProps) {
  ```
  And/or render a skeleton when `price == null`.
- **Evidence**: `qa-mobile/screenshots-2026-05-09/07-positions/01-top.png` (Next.js error overlay)

---

### N2 — `/auto-engine`: Header toolbar clips HALT ALL on 375px (Critical)

- **Severity**: Critical
- **Route**: `/auto-engine`
- **Reproduction**: Open `/auto-engine` on iPhone SE (375×667). Top toolbar shows: title `Auto engine` · `STOPPED` chip · `never started` · ▶ START · `dry run: OFF` · ■ HALT ALL — but HALT ALL is clipped past the right edge.
- **Root cause**: `src/app/auto-engine/page.tsx:134` — `<div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>` has no `flexWrap`. The right group `<span style={{ marginLeft: 'auto', ... }}>` (line 153) holds three buttons with no min-width-0, so the row total exceeds 375px.
- **Fix**:
  ```diff
  - <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
  + <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, rowGap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
  ```
- **Evidence**: `qa-mobile/screenshots-2026-05-09/05-auto-engine/01-top.png`

---

### N3 — `/` Dashboard: MarketsRow word-merge ("ETHEREUMGOLD") (High)

- **Severity**: High
- **Route**: `/`
- **Reproduction**: Open `/`. The Markets card shows 6 columns (S&P 500, QQQ, BITCOIN, ETHEREUM, GOLD, CRUDE OIL). On iPhone SE the columns are too narrow; "ETHEREUM" and "GOLD" labels visually merge into `ETHEREUMGOLD` because there's no horizontal padding or word-break between cells. The "unavailable" status text in adjacent cells also overlaps.
- **Why it matters**: The Markets row is the first KPI on the dashboard. Garbled labels are a credibility hit for a trading product.
- **Likely root cause**: `MarketsRow` component uses `repeat(6, 1fr)` or similar without responsive collapse. Cell padding insufficient when each cell shrinks below ~62px.
- **Fix candidates**:
  - Collapse to `repeat(3, 1fr)` at ≤640px and `repeat(2, 1fr)` at ≤375px
  - Or convert to a horizontally scrollable strip on phone widths
- **Evidence**: `qa-mobile/screenshots-2026-05-09/01-dashboard/01-top.png` and `03-bottom.png`

---

### N4 — `/`: Server/client hydration mismatch on date subtitle (High)

- **Severity**: High
- **Route**: `/`
- **Reproduction**: Pageerror captured by Playwright: hydration mismatch — server rendered `Fri, May 8`, client rendered `Sat, May 9` (today is 2026-05-09 Saturday).
- **Root cause**: `Dashboard` component formats a date in render. The dev server was started while it was still 2026-05-08 (or the server's TZ thinks it is); the client formats `new Date()` at hydration and gets the next day.
- **Fix**: Render the date in a `useEffect` after mount, or pass a server-stable timestamp from a route handler. Don't compute "today" inline during SSR.
- **Evidence**: `qa-mobile/screenshots-2026-05-09/01-dashboard/finding.json` → `pageErrors[0]`

---

### N5 — `/scanner`: LLM Scanner header overflows 375px (High)

- **Severity**: High
- **Route**: `/scanner`
- **Reproduction**: Open `/scanner`. The "LLM SCANNER" card has a flex row `[textarea | Submit button]` where Submit pushes past the right edge; the example-prompt chips below also extend off-screen.
- **Fix**: Make the Submit row wrap; chips already have `flex-wrap` but their inline content (long example prompts) don't ellipsize. Either truncate prompts or set `min-width: 0` on the chips.
- **Evidence**: `qa-mobile/screenshots-2026-05-09/03-scanner/01-top.png`

---

### N6 — `/stock/<TICKER>`: YOUR POSITION table clips on right (High)

- **Severity**: High
- **Routes**: `/stock/CIFR`, `/stock/HOOD`, `/stock/RDW`
- **Reproduction**: Overview tab, "YOUR POSITION · CIFR" card. Table columns: ACCOUNT / QTY / AVG COST / COST BASIS / (more). At 375px, COST BASIS column shows `$1,404.72` truncated to `$1,404.7…`.
- **Root cause**: `<table>` rendered directly inside the card without an `rv-table-wrap` wrapper providing `overflow-x: auto`.
- **Fix**: Wrap the table in `<div className="rv-table-wrap">` (matches the fix pattern documented in 05-03 F4–F6).
- **Evidence**: `qa-mobile/screenshots-2026-05-09/14-stock-CIFR/01-top.png`, `15-stock-HOOD/01-top.png`, `16-stock-RDW/01-top.png`

---

### N7 — `/journal`: First-load timeout (Medium)

- **Severity**: Medium
- **Route**: `/journal`
- **Reproduction**: First `page.goto('/journal')` exceeded 30s waiting for `domcontentloaded`. Page subsequently rendered with "Failed to fetch P&L summary" banner.
- **Fix**: Move blocking backend fetches off the SSR/initial render path. Render skeleton + lazy-fetch.
- **Evidence**: `qa-mobile/screenshots-2026-05-09/19-journal/finding.json` → `notes`, plus `01-top.png` from re-run

---

## Methodology + reproducibility

To re-run this QA pass:

```bash
# Dev server + backend already running (3000 + 8000)
cd /home/jarvis/playwright-js
npx playwright test --project=iphone-se
# Outputs to /home/jarvis/tst/trading-dashboard-app/qa-mobile/screenshots-2026-05-09/
```

The spec file `tests/mobile-qa-iphone-se.spec.ts` is parameterized over routes; add or remove entries in the `ROUTES` array to scope coverage.

---

## After-fix verification (2026-05-09 — same session)

Re-ran the spec on the affected routes after applying fixes. Output written to `qa-mobile/screenshots-2026-05-09-after/`. All 5 fixed-route tests pass with zero pageerrors.

| Finding | Fix | File:line | Verified by screenshot |
|---------|-----|-----------|-----------------------|
| N1 `/positions` toFixed crash | Default props to `0`, render `—` when undefined | `src/components/positions/TickerHeader.tsx:1-29` | `screenshots-2026-05-09-after/07-positions/01-top.png` — page renders cleanly with `—` price placeholder; no error overlay |
| N2 `/auto-engine` HALT clipped | Add `flexWrap: 'wrap'` and `rowGap: 6` to header div | `src/app/auto-engine/page.tsx:134` | `screenshots-2026-05-09-after/05-auto-engine/01-top.png` — toolbar wraps to 2 rows, HALT ALL fully visible |
| N3 `/` MarketsRow word-merge | `repeat(auto-fit, minmax(110px, 1fr))` + uniform borders + label `text-overflow: ellipsis` | `src/components/home/MarketSnapshot.tsx:136-202` | `screenshots-2026-05-09-after/01-dashboard/01-top.png` — clean 3×2 grid; "ETHEREUM" / "GOLD" properly separated |
| N4 `/` hydration mismatch | Compute date in `useEffect`; `suppressHydrationWarning` on date subtitle | `src/components/home/Dashboard.tsx:27-33,55-61,98-100` | `screenshots-2026-05-09-after/01-dashboard/finding.json` — `pageErrors: []`, subtitle reads "Sat, May 9" |
| N5 `/scanner` chip overflow | Allow `whiteSpace: 'normal'` and `maxWidth: 100%` on example chips | `src/components/scanner/NLScannerBar.tsx:243-262` | **Partial** — chips no longer enforce nowrap, but the page still reports `scrollWidth=848` on the empty-data state. Root cause is page-level (likely `PremiumPicksOverlay.tsx:295` `minWidth: 720` or similar) — requires deeper investigation, deferred |
| N8 (new) `/stock/<TICKER>` price card distorted when quote unavailable | When `price` is not finite, render dedicated "Quote unavailable" card with muted dash; suppress the "$0.00 today · 0.00%" zero-move row when change/changePct are unknown | `src/components/QuoteSummary.tsx:203-274` | `screenshots-2026-05-09-after/14-stock-CIFR/02-fullpage.png` — clean `$ —` + "Quote unavailable" subtitle replaces the previous garbled placeholder |
| N6 `/stock/<TICKER>` position table | Already wrapped in `overflowX: 'auto'` at `StockPositionCard.tsx:295` — table is scrollable, just lacks visible scroll affordance | (no code change) | Polish-only; deferred |
| N7 `/journal` first-load timeout | Backend issue, not a UI bug | (no code change) | Deferred |

**Net result of this pass**:
- 2 Critical + 2 High fully fixed and verified ✅
- 1 High partially fixed (N5)
- 2 deferred as polish or backend (N6, N7)

---

## Coverage gaps / known limitations

- **WebKit not run** — host machine missing `libevent`, `libgstreamer-plugins-bad`, `libavif16` etc., and there's no passwordless sudo. Layout bugs are CSS-driven so Chromium-engine-with-iOS-UA-and-mobile-flag is sufficient for what we measured, but Safari-only quirks (e.g., `overflow: hidden` in scroll containers) would not be caught.
- **Single viewport** — only iPhone SE 375×667 was tested (per user request). Pixel 7 / iPhone 14 / 320-stress not covered.
- **Backend data unavailability** — 404/500 responses on quote, IR, and journal endpoints prevented full validation of F4–F11 from the prior report (tables couldn't render data, chips couldn't appear).
- **Single-tab dwell** — tabs are clicked sequentially with 500ms settle, no deeper interaction (sliders dragged, forms submitted, etc.).
