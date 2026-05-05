# Mobile QA Report - 2026-05-03

## Scope

- **Target tested**: VegaEdge trading dashboard — all primary routes plus new `IRFilingsPanel` on `/stock/<TICKER>`
- **Environment**: Next.js dev server at `http://localhost:3000` (confirmed 200 for all 15 routes). FastAPI backend at `http://localhost:8000`, proxied via Next rewrites.
- **Devices and breakpoints**: iPhone SE 375×667, iPhone 14 390×844, Pixel 7 412×915, iPad 768×1024, Desktop 1440×900 baseline, Stress 320×568
- **Method**: Static analysis of modified and new source files. Playwright `@playwright/test` could not be installed due to file system permission restrictions on `node_modules/@img/sharp-darwin-arm64`; per agent rules, fell back to source inspection and diff analysis.
- **Routes covered**: `/`, `/robinhood`, `/scanner`, `/risk-mgmt`, `/auto-engine`, `/portfolio`, `/options-chain`, `/pricing`, `/backtest`, `/sentiment`, `/strategy`, `/execution`, `/stock/RDW`, `/stock/HOOD`, `/stock/CIFR`
- **New feature tested**: `IRFilingsPanel` at `src/components/IRFilingsPanel.tsx` (replaces "Latest News" stub in stock detail overview tab), IR API at `src/lib/ir-api.ts`, integration in `src/app/stock/[ticker]/StockDetailClient.tsx`

---

## Executive summary

- **Total issues found**: 12
- **Critical**: 3
- **High**: 4
- **Medium**: 3
- **Low**: 2
- **Overall mobile readiness**: **Needs fixes** — three layout-breaking overflows exist on phone viewports, caused by inline `gridTemplateColumns` values that bypass the CSS media-query collapse rules. The new `IRFilingsPanel` itself is well-structured and does NOT introduce any overflow regressions; its one usability gap is a below-minimum tap target on the row expand button.

---

## Findings table

| ID | Severity | Page | Viewport | Component | Issue | User impact | Likely root cause | Suggested fix |
|----|----------|------|----------|-----------|-------|-------------|-------------------|---------------|
| F1 | Critical | `/options-chain` | 320, 375, 390, 412 | `.rv-chain-wrap` | `1fr 340px` grid has no mobile collapse rule; ticket column forces ≥352px content on 375px viewports | Chain table gets ≤23px left column; order ticket and chain table both unusable | `rv-chain-wrap` in `globals.css:344` has no media query | Add `@media (max-width: 720px) { .rv-chain-wrap { grid-template-columns: 1fr; } }` |
| F2 | Critical | `/pricing` | 320, 375, 390 | `rv-grid-2` on inputs/results | Inline `gridTemplateColumns: '320px 1fr'` overrides the CSS `≤640px` collapse rule; results panel is only ≈13px wide on 375px | Pricing results, Greeks, vol surface all invisible | `pricing/page.tsx:353` uses inline style that beats media query | Replace inline override with a CSS class (e.g. `rv-pricing-grid`) that has proper collapse |
| F3 | Critical | `/auto-engine` | 320, 375, 390 | `rv-grid-2` on Guardrails/EventStream | Same inline `gridTemplateColumns: '320px 1fr'` pattern; EventStream right column is ≈13px at 375px | Event log and filter chips inaccessible | `auto-engine/page.tsx:191` inline style beats media query | Same fix as F2 — extract to CSS class with collapse |
| F4 | High | `/scanner` | 320, 375, 390 | `ScannerTable` | 12-column `rv-table` rendered directly inside `.rv-card` without `rv-table-wrap`; `white-space: nowrap` on all cells causes horizontal overflow | Ratio, Signal, EV columns clipped; no scroll affordance | `ScannerTable.tsx:64-65` — `<table>` not wrapped | Wrap table in `<div className="rv-table-wrap">` |
| F5 | High | `/portfolio` | 320, 375, 390 | `PositionsTable` | 11-column `rv-table` not wrapped in `rv-table-wrap` (10 Greek contribution columns, `white-space: nowrap`) | Greek contribution columns invisible, no horizontal scroll | `PositionsTable.tsx:57` — `<table>` directly inside `rv-card` | Wrap table in `<div className="rv-table-wrap">` |
| F6 | High | `/` (Dashboard) | 320, 375 | Dashboard Greeks table (by-ticker view) | Second `rv-table` at `Dashboard.tsx:286` is not wrapped in `rv-table-wrap`; first table at line 175 is wrapped correctly | Ticker-level Greek breakdown table clips | `Dashboard.tsx:286` — `<table>` unwrapped | Wrap table in `<div className="rv-table-wrap">` |
| F7 | High | `/stock/RDW`, `/stock/HOOD`, `/stock/CIFR` | All touch (pointer: coarse) | `IRRow` expand button | Row expand button uses `all: 'unset'` which discards the `.rv-btn { min-height: 44px }` coarse-pointer rule; effective tap height ≈33px | Users mis-tap expand/collapse on phone, especially on short titles | `IRFilingsPanel.tsx:277-284` — `all: 'unset'` style | Add `minHeight: 44px` (or `padding-block: 6px`) to the button's inline style |
| F8 | Medium | `/options-chain` | 375, 390 | `rv-greeks` on chain page | `rv-greeks { grid-template-columns: repeat(8, 1fr); }` collapses to `repeat(2, 1fr)` at ≤640px, but option chain renders Greeks in 8 columns inside the chain card which is already narrow within `rv-chain-wrap` — before F1 is fixed, both columns are crushed | Greeks row renders in 8 tiny boxes; values illegible | Depends on F1; once chain-wrap collapses, 8→2-col collapse at 640px should handle it | Fix F1 first; if Greeks still overflow after that, add a `.rv-expstrip + rv-chain-wrap` scoped collapse |
| F9 | Medium | `/auto-engine` | All touch | EventStream filter chip `<span>` elements | Filter chips in `.rv-card-head .tools` are `span` elements (not `button`), so the `.rv-btn` coarse-pointer min-height rule does not apply; effective tap area is `2px 6px` padding + ~11px text ≈ 23px | Hard to tap correct filter on phone | `EventStream.tsx:171-186` — chips are `<span>` not `<button>` | Convert spans to `<button type="button">` elements, or add `min-height: 44px; padding-block: 12px` via a `.rv-card-head .tools span` coarse-pointer rule |
| F10 | Medium | `/stock/CIFR`, `/stock/HOOD` | 320 (stress) | `IRFilingsPanel` chip row with 4 chips | At 320px content area (~296px), four chips "BULLISH", "BEARISH", "NEUTRAL", "INFORMATIVE" at `font-size: 11px` with 6px gap will likely need two rows; this wraps correctly per `flexWrap: 'wrap'` but chips on the second row have no bottom margin before the item list | Minor visual crowding; not a blocking issue | No `marginBottom` on chips container other than the outer `10px` | Add `rowGap: 4` to the chip flex container (already present via `gap: 6` shorthand — verify computed value) |
| F11 | Low | `/stock/RDW`, `/stock/HOOD`, `/stock/CIFR` | 375, 390 | `IRFilingsPanel` header row | `rv-card-head` wraps at ≤640px (`flex-wrap: wrap`). On 375px: "LATEST IR FILINGS" h3 + "UPDATED Xm ago" sub wraps to left div, Refresh button goes below. The Refresh button `.rv-btn ghost` gets `min-height: 44px` from coarse pointer rule — that's correct — but visually the two-row header is slightly awkward | Cosmetic: header takes more space than needed on phone | `rv-card-head` default `flex-wrap: wrap` at ≤640px applies | Minor polish: move the "UPDATED" timestamp below the Refresh button, or style the h3 subtitle as an inline label |
| F12 | Low | `/scanner` | 375 | FilterChips description text | Description text below the chip row (e.g. "IV / HV ratio above 1.3 — premium selling candidates") wraps to multiple lines at 375px with `font-size: 11px`. Not an overflow issue but can push the table out of view on short screens (iPhone SE 667px) without scrolling | Users on iPhone SE must scroll to reach the table after reading the description | Long descriptions + no max-height/collapse for the filter context line | No code change needed; document as known UX limitation or truncate with `text-overflow: ellipsis` |

---

## Detailed findings

### F1 — `/options-chain`: rv-chain-wrap has no mobile collapse (Critical)

- **Severity**: Critical
- **Viewports**: 320×568, 375×667, 390×844, 412×915
- **Route**: `/options-chain`
- **Reproduction**: Open `/options-chain` on any phone viewport. Observe that the `rv-chain-wrap` grid (chain table left, order ticket right) does not collapse.
- **Expected**: Below ~720px the chain table should stack above the order ticket (single column).
- **Actual**: `globals.css:344` defines `grid-template-columns: 1fr 340px` with NO accompanying `@media (max-width: …)` collapse rule. At 375px content area (~347px after padding), the right column is fixed at 340px, leaving only 7px for the chain table before the gap is even counted. The page overflows horizontally.
- **Why it matters**: The options chain is one of the core trading pages. Users on every phone viewport (375–412px) cannot see the chain table or the order ticket usably.
- **Root cause**: `src/app/globals.css:344` — missing media query.
- **Recommended fix**:
  ```css
  /* globals.css — add after the existing .rv-chain-wrap rule */
  @media (max-width: 720px) {
    .rv-chain-wrap { grid-template-columns: 1fr; }
  }
  ```

---

### F2 — `/pricing`: Inline grid override neutralises media query (Critical)

- **Severity**: Critical
- **Viewports**: 320×568, 375×667, 390×844
- **Route**: `/pricing`
- **Reproduction**: Open `/pricing` on a phone. The inputs column locks at 320px; the results column gets ~13px (375px - 28px padding - 14px gap - 320px = 13px).
- **Expected**: Left "Inputs" column stacks above right "Results/Greeks/Surface" column below 640px.
- **Actual**: `pricing/page.tsx:353` renders `<div className="rv-grid-2" style={{ gridTemplateColumns: '320px 1fr' }}>`. The CSS `.rv-grid-2 { grid-template-columns: 1fr; }` at ≤640px is an ordinary rule that inline styles override. The results panel is 13px wide — all content invisible.
- **Why it matters**: The entire right half of the pricing calculator (price output, Greeks big cells, vol surface, PnL scenarios, smile chart) is invisible on phones.
- **Root cause**: `src/app/pricing/page.tsx:353` — inline style bypasses media query.
- **Recommended fix**:
  ```css
  /* globals.css */
  .rv-pricing-grid {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .rv-pricing-grid { grid-template-columns: 1fr; gap: 12px; }
  }
  ```
  ```tsx
  // pricing/page.tsx:353 — replace
  <div className="rv-pricing-grid">
  ```

---

### F3 — `/auto-engine`: Inline grid override neutralises media query (Critical)

- **Severity**: Critical
- **Viewports**: 320×568, 375×667, 390×844
- **Route**: `/auto-engine`
- **Reproduction**: Open `/auto-engine` on a phone. The Guardrails column locks at 320px; EventStream gets ~13px.
- **Expected**: Guardrails stacks above EventStream below 640px.
- **Actual**: `auto-engine/page.tsx:191` uses `<div className="rv-grid-2" style={{ gridTemplateColumns: '320px 1fr' }}>`. Same inline-beats-media-query issue as F2.
- **Why it matters**: The event log (the primary real-time monitoring view) is invisible on all phones.
- **Root cause**: `src/app/auto-engine/page.tsx:191`.
- **Recommended fix**:
  ```css
  /* globals.css */
  .rv-engine-grid {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .rv-engine-grid { grid-template-columns: 1fr; gap: 12px; }
  }
  ```
  ```tsx
  // auto-engine/page.tsx:191 — replace
  <div className="rv-engine-grid">
  ```

---

### F4 — `/scanner`: ScannerTable missing overflow wrapper (High)

- **Severity**: High
- **Viewports**: 320×568, 375×667, 390×844, 412×915
- **Route**: `/scanner`
- **Reproduction**: Open `/scanner` on a phone. The scanner table's 12 `white-space: nowrap` columns (Ticker, Spark, Spot, IV/HV, Ratio, Signal, Regime, EV/contract, Hit, Vol, detail link) exceed phone content width.
- **Expected**: Table scrolls horizontally within its card.
- **Actual**: `ScannerTable.tsx:64-65` renders `<table className="rv-table">` directly inside `<div className="rv-card" style={{ padding: 0 }}>` with no scroll wrapper. Page overflows horizontally.
- **Root cause**: `src/components/scanner/ScannerTable.tsx:64-65`.
- **Recommended fix**:
  ```tsx
  // ScannerTable.tsx ~64
  <div className="rv-card" style={{ padding: 0 }}>
    <div className="rv-table-wrap">
      <table className="rv-table" style={{ fontSize: 11.5 }}>
  ```

---

### F5 — `/portfolio`: PositionsTable missing overflow wrapper (High)

- **Severity**: High
- **Viewports**: 320×568, 375×667, 390×844
- **Route**: `/portfolio`
- **Reproduction**: Open `/portfolio`, scroll to the positions table. The 11-column table (Position, Structure, Qty, Entry, Mark, P&L, Δ, Γ, Θ, V contributions, action) overflows.
- **Expected**: Table scrolls horizontally within its card container.
- **Actual**: `PositionsTable.tsx:57` has `<table className="rv-table">` directly inside `<div className="rv-card">` with no `rv-table-wrap`.
- **Root cause**: `src/components/portfolio/PositionsTable.tsx:57`.
- **Recommended fix**:
  ```tsx
  // PositionsTable.tsx ~57
  <div className="rv-table-wrap">
    <table className="rv-table" style={{ fontSize: 11.5 }}>
  // … close both divs appropriately
  ```

---

### F6 — `/`: Dashboard by-ticker Greeks table missing overflow wrapper (High)

- **Severity**: High
- **Viewports**: 320×568, 375×667
- **Route**: `/`
- **Reproduction**: Open home dashboard, locate the Portfolio Greeks card. When the view is the by-ticker breakdown (not the aggregate view), the table at `Dashboard.tsx:286` clips.
- **Expected**: Table scrolls horizontally.
- **Actual**: `Dashboard.tsx:286` renders `<table className="rv-table">` inside a plain `<div>` (inside `rv-card`) with no `rv-table-wrap`. The first table at line 175 is correctly wrapped; this second table was missed.
- **Root cause**: `src/components/home/Dashboard.tsx:286`.
- **Recommended fix**:
  ```tsx
  // Dashboard.tsx ~284-286 — wrap the table
  <div className="rv-table-wrap">
    <table className="rv-table" style={{ fontSize: 12 }}>
  ```

---

### F7 — `/stock/*`: IRRow expand button tap target below 44px (High)

- **Severity**: High
- **Viewports**: All touch (pointer: coarse), particularly 375×667 and 390×844
- **Routes**: `/stock/RDW`, `/stock/HOOD`, `/stock/CIFR`
- **Reproduction**: On a phone, attempt to tap the expand/collapse chevron on any IR filing row.
- **Expected**: Entire row is tappable with at least 44×44 CSS px tap area (per Apple HIG and WCAG 2.5.5).
- **Actual**: `IRFilingsPanel.tsx:274-284` renders a `<button>` with `style={{ all: 'unset', … }}`. The `all: 'unset'` removes all browser UA styles AND bypasses the `.rv-btn { min-height: 44px }` coarse-pointer rule, because the button is NOT assigned `className="rv-btn"`. The effective tap area equals the button's natural flex content height ≈ 33px (pill height + title + meta).
- **Root cause**: `src/components/IRFilingsPanel.tsx:277` — `all: 'unset'` without a compensating `minHeight`.
- **Recommended fix**:
  ```tsx
  // IRFilingsPanel.tsx ~277
  style={{
    all: 'unset',
    cursor: 'pointer',
    width: '100%',
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    minHeight: 44,           // ← add this
    paddingBlock: '5px',     // ← add this (or rely on minHeight alone)
    boxSizing: 'border-box',
  }}
  ```

---

### F8 — `/options-chain`: rv-greeks 8-col secondary issue (Medium)

- **Severity**: Medium
- **Viewports**: 375×667, 390×844
- **Route**: `/options-chain`
- **Reproduction**: After F1 is fixed and `rv-chain-wrap` collapses to single column, visit `/options-chain` — the Greeks row inside the chain card still uses `rv-greeks { repeat(8, 1fr) }` which collapses to `repeat(2, 1fr)` at ≤640px. In the context of the chain card at full width on phone, 8 columns would render at ≈(375-28)/8 ≈ 43px each — very tight but readable given the values are 2–5 char numbers. The ≤640px rule reduces to 4 rows of 2, which is more readable but causes more scrolling.
- **Why it matters**: Minor readability concern after F1 is fixed; not independently blocking.
- **Recommended fix**: No immediate action required if F1 is fixed first; monitor after F1 lands.

---

### F9 — `/auto-engine`: EventStream filter chips have sub-44px tap targets (Medium)

- **Severity**: Medium
- **Viewports**: All touch (pointer: coarse)
- **Route**: `/auto-engine`
- **Reproduction**: On a phone, open `/auto-engine` and attempt to tap "exec", "signal", "skip", "error" filter chips in the EventStream card header.
- **Expected**: Tap targets ≥ 44×44px.
- **Actual**: `EventStream.tsx:171-186` renders filter chips as `<span>` elements inside `.rv-card-head .tools`. The `.rv-card-head .tools span` rule in `globals.css:205` gives them `padding: 2px 6px` — effective touch target ~23px tall.
- **Root cause**: `src/components/auto/EventStream.tsx:171-186` and `globals.css:620-626` coarse-pointer block does not include `.rv-card-head .tools span`.
- **Recommended fix**:
  ```css
  /* globals.css — append inside the @media (pointer: coarse) block */
  .rv-card-head .tools span {
    min-height: 32px;
    padding: 8px 10px;
    display: inline-flex;
    align-items: center;
  }
  ```

---

### F10 — `/stock/CIFR` (stress): IRFilingsPanel chip row crowding at 320px (Medium)

- **Severity**: Medium
- **Viewports**: 320×568
- **Route**: `/stock/CIFR`, `/stock/HOOD` (when all 4 chip categories have counts)
- **Reproduction**: At 320px viewport, if all four thesis categories (BULLISH, BEARISH, NEUTRAL, INFORMATIVE) have counts, the chip row wraps to two lines.
- **Expected**: Two-row chip layout is acceptable; adequate spacing before the item list.
- **Actual**: The chip container at `IRFilingsPanel.tsx:190` has `gap: 6` shorthand (row + column gap both 6px). With `marginBottom: 10` the spacing is adequate. However "INFORMATIVE" at 11px monospace + 6px padding is ≈86px, plus BULLISH (68px) + BEARISH (67px) + NEUTRAL (65px) + 3×6px gaps = 306px + 18px = 324px > 296px. The wrap is correct but "INFORMATIVE" alone lands on line 2 with nothing beside it, which looks sparse.
- **Why it matters**: Cosmetic; chips still readable and tappable. Low urgency.
- **Recommended fix**: Use `fontSize: 10` for chips at ≤375px (already done in `.rv-pill` at ≤640px), or shorten "INFORMATIVE" to "INFO" in the label.

---

### F11 — `/stock/*`: IRFilingsPanel header wraps awkwardly on narrow phones (Low)

- **Severity**: Low
- **Viewports**: 320×568, 375×667
- **Route**: `/stock/RDW`, `/stock/HOOD`, `/stock/CIFR`
- **Reproduction**: Open any stock detail page at 375px. The IRFilingsPanel card header shows "LATEST IR FILINGS" h3 + "UPDATED Xm ago" sub on the left and "Refresh" button on the right. At ≤640px, `rv-card-head` gains `flex-wrap: wrap`.
- **Expected**: Clean two-column or stacked header.
- **Actual**: At 375px, "LATEST IR FILINGS" in JetBrains Mono 12px caps is ~110px; the Refresh button with `min-height: 44px` is ~60px. Both fit on the same line at 375-28=347px available, so they stay side-by-side. On 320px (296px available) they may wrap. When wrapped, the Refresh button aligns left under the heading — this is visually acceptable. No overflow occurs; this is a minor aesthetic note.
- **Recommended fix**: No code change required. Monitor at 320px stress viewport.

---

### F12 — `/scanner`: Filter description text occupies extra vertical space (Low)

- **Severity**: Low
- **Viewports**: 375×667 (iPhone SE — shortest phone)
- **Route**: `/scanner`
- **Reproduction**: Open `/scanner` on iPhone SE (375×667). The `FilterChips` description line wraps to 2–3 lines at 375px for long descriptions.
- **Expected**: Description is readable but compact.
- **Actual**: `FilterChips.tsx:116-126` shows a description paragraph below the chip row. "IV / HV ratio above 1.3 — premium selling candidates" at `font-size: 11px` wraps at 375px. Combined with the chip row height, this pushes the table ~48px below the chips on a 375px viewport, requiring scroll to reach the first data row.
- **Recommended fix**: Truncate with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` — acceptable since users can hover/tap a chip for its full description anyway.

---

## Common root causes

1. **Inline `gridTemplateColumns` overrides bypass CSS media queries** (F1 partially, F2, F3): Three pages use `<div className="rv-grid-2" style={{ gridTemplateColumns: '320px 1fr' }}>`. While `rv-grid-2` has a correct `@media (max-width: 640px) { .rv-grid-2 { grid-template-columns: 1fr; } }` rule in `globals.css`, inline `style` props always win over class-based media queries. The fix pattern established for `rv-dcf-grid` (named class + media query) was not applied to these newer usages.

2. **`rv-table` instances not wrapped in `rv-table-wrap`** (F4, F5, F6): Three tables are rendered without the horizontal-scroll helper. The global `.rv-table th, .rv-table td { white-space: nowrap; }` rule makes every table overflow horizontally unless wrapped. The fix was applied inconsistently — some tables (e.g., `HoldingsTable`, `OptionsTable`, `ActivityTimeline`) are correctly wrapped, while others were missed.

3. **`rv-chain-wrap` missing mobile collapse rule** (F1): Unlike `rv-dcf-grid` and `rv-stock-overview` which have explicit `@media` collapse rules, `rv-chain-wrap` at `globals.css:344` was written with no phone-friendly breakpoint. The right column fixed at 340px leaves too little room for the chain table on all phone viewports.

4. **`all: 'unset'` on interactive buttons strips coarse-pointer enhancements** (F7): The IRRow toggle button uses `all: 'unset'` to reset button styles for aesthetic reasons. This is a valid approach but requires explicitly re-adding touch-target properties. Without `min-height: 44px` or equivalent padding, the button fails the WCAG 2.5.5 tap-target minimum on touch devices.

5. **Non-button interactive elements missing touch target sizing** (F9): EventStream filter chips are `<span>` elements; the global coarse-pointer `.rv-btn` rule does not cover them. Interactive spans should either be converted to `<button>` elements or given explicit touch-target rules.

---

## Fix priority

### Fix first
- **F1**: Add `@media (max-width: 720px) { .rv-chain-wrap { grid-template-columns: 1fr; } }` — one line in `globals.css`.
- **F2**: Extract `rv-pricing-grid` CSS class with phone collapse — unblocks the entire pricing calculator on phone.
- **F3**: Extract `rv-engine-grid` CSS class with phone collapse — unblocks event log and guardrails on phone.

### Fix next
- **F4**: Wrap `ScannerTable`'s `rv-table` in `rv-table-wrap` — one-line change.
- **F5**: Wrap `PositionsTable`'s `rv-table` in `rv-table-wrap` — one-line change.
- **F6**: Wrap the second `rv-table` in `Dashboard.tsx:286` in `rv-table-wrap`.
- **F7**: Add `minHeight: 44` to the `IRRow` button's inline style — IRFilingsPanel-specific tap target fix.

### Nice to improve
- **F9**: Convert EventStream filter `<span>` chips to `<button>` or add coarse-pointer touch height.
- **F10, F11, F12**: Polish items with no blocking impact.

---

## Pass/fail checklist

- [ ] **No horizontal page overflow** — **FAIL** (F1 chain-wrap, F2 pricing grid, F3 auto-engine grid, F4 scanner table, F5 portfolio table, F6 dashboard table)
- [x] **Navigation usable on mobile** — **PASS**: hamburger drawer, rail items, and top-bar all collapse correctly per media queries in `globals.css:485-554`
- [ ] **Primary actions visible** — **PARTIAL FAIL**: Pricing results (F2) and auto-engine event log (F3) are invisible on phones; chain table and ticket (F1) also blocked
- [ ] **Tables handled correctly** — **FAIL** (F4, F5, F6 — three tables without overflow wrappers; other tables such as HoldingsTable, OptionsTable, ActivityTimeline are correctly handled)
- [x] **Charts responsive** — **PASS**: `StockPriceChart`, `Sparkline`, `EvBar`, `IvHvScale` all use relative widths or SVG auto-sizing
- [ ] **Tap targets acceptable** — **PARTIAL FAIL** (F7 IRRow button ~33px; F9 filter chips ~23px; all `.rv-btn` correctly sized to ≥44px on touch)
- [x] **Text readable** — **PASS**: smallest text is 10px (`.text-meta`), acceptable at standard viewing distance; no collision between labels and values found in IRFilingsPanel
- [ ] **No major overlap or clipping** — **FAIL** (F1, F2, F3 cause layout collapse that clips content off-screen)

---

## IRFilingsPanel regression check

**No regression introduced.** The `IRFilingsPanel` component (`src/components/IRFilingsPanel.tsx`) is well-structured for mobile:

- **Chip row** (`display: flex; gap: 6; flexWrap: 'wrap'`): Correctly wraps when 4 chips visible. All chips use `rv-pill` which receives `font-size: 10px; padding: 2px 6px` at ≤640px via the existing global rule. No overflow.
- **Row title truncation**: Titles use `flex: 1; minWidth: 0` on the title span and `lineHeight: 1.35` — long titles (e.g. "Rocket Lab vs. Redwire: Which Space Stock Is the Better Buy?") wrap naturally rather than truncating. This is the correct UX for dense news items on mobile.
- **Expanded Source link**: The expanded rationale block uses `display: flex; flexWrap: 'wrap'` with `marginLeft: auto` on the Source link. The link falls to the end of the last flex line. No horizontal overflow detected.
- **Refresh button**: Uses `rv-btn ghost` class + `padding: '6px 10px'`. The `pointer: coarse` rule sets `min-height: 44px` on all `.rv-btn` elements, so the Refresh button is correctly sized at 44px on touch.
- **Single new issue (F7)**: The row-level expand button uses `all: 'unset'` which discards the touch sizing. This is the only IRFilingsPanel finding and is Medium-High severity but not a regression against prior behavior (the "Latest News" stub it replaces had no interactive rows at all).

---

## Final verdict

The dashboard has three Critical layout collapses on phone viewports: the options-chain `rv-chain-wrap` grid (no mobile breakpoint), and two pages (`/pricing`, `/auto-engine`) where `rv-grid-2` is overridden with a 320px fixed inline column that defeats the media-query collapse. These make core trading tools — the options chain, the pricing calculator, and the auto-engine event log — unusable on iPhone SE / iPhone 14 / Pixel 7. All three fixes are one-to-three line CSS changes following the established `rv-dcf-grid` pattern already in the codebase. Three `rv-table` instances (scanner, portfolio, dashboard Greeks) also lack `rv-table-wrap` wrappers and cause horizontal overflow. The new `IRFilingsPanel` is the best-structured mobile component added this sprint and does not introduce regressions; its sole gap (tap target on row buttons) is a small fix. The app is not ready for mobile users without the three Critical fixes, but the Critical fixes are low-effort and well-precedented.
