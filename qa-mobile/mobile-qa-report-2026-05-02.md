# Mobile QA Report - 2026-05-02

## Scope
- **Target**: VegaEdge — `/stock/{ticker}` → **DCF Valuation** tab, scrolled below the fold
- **Routes**: `/stock/AMKR`, `/stock/AAPL`, `/stock/WULF` (WULF additionally exercises the Bitcoin-treasury accordion via `BTC_TREASURY_HOLDINGS`)
- **Environment**: Next.js 16 dev server at `http://localhost:3000`. Tailwind v4 + custom `.rv-*` design system in `src/app/globals.css`.
- **Method**: Static analysis of `src/components/DCFValuation.tsx` and `src/app/globals.css`. Playwright not installed (`node_modules/@playwright/test` missing); per agent rules, fell back to source inspection rather than burn the >5 min install/launch budget.
- **Viewports targeted**: 320×568 (stress), 375×667 (iPhone SE), 390×844 (iPhone 14), 768×1024 (iPad), 1440×900 (desktop baseline).

## Executive summary
- **Total issues found**: 8
- **Critical**: 1
- **High**: 3
- **Medium**: 3
- **Low**: 1
- **Overall mobile readiness**: **Needs fixes** — the DCF tab horizontally overflows on every phone viewport because the controls/results split is locked to a 618 px minimum without a phone-specific collapse rule.

## Findings table
| ID | Severity | Page | Viewport | Component | Issue | User impact | Likely root cause | Suggested fix |
|----|----------|------|----------|-----------|-------|-------------|-------------------|---------------|
| D1 | Critical | DCF tab | 320, 375, 390 | Controls/Results 2-col grid | Page horizontally overflows; right column clipped | Sliders unreachable, fair-price card bleeds off-screen, horizontal scroll | Hard `minmax(280px, 5fr) minmax(320px, 7fr)` with no `<=640px` collapse | Add `.rv-dcf-grid` class + media query collapsing to `1fr` ≤640 px |
| D2 | High | DCF tab | 320, 375, 390 | Breakdown `<table className="rv-table">` | Table overflows column (cells `white-space: nowrap`) once D1 is fixed | Right edge of "2030" column clipped, no scroll affordance | `<table>` not wrapped in `.rv-table-wrap` | Wrap table in `<div className="rv-table-wrap">` |
| D3 | High | DCF tab | All touch | `.rv-dcf-slider` thumb (16×16) | Thumb tap target only 16 px under `pointer: coarse` | Hard to grab/drag on phone, mis-taps select wrong value | No coarse-pointer override for slider thumb | Bump thumb to 28 px and add ≥44 px hit padding via `::-webkit-slider-thumb` + a label tap-zone |
| D4 | High | DCF tab | All touch | `AccordionSection` toggle `<button>` | Button height ≈37 px (12+13+12) — under 44 px | Fails Apple HIG / WCAG tap target on phones | Inline padding `12px 14px` + 13 px font with no min-height | Add `minHeight: 44` to the button or apply `.rv-btn` class |
| D5 | Medium | DCF tab | 375 (rotation/resize) | Cash-flow `<canvas>` | Bitmap stale after viewport resize/orientation change | Bars render at the *previous* width — squashed or cut off until a slider is touched | `useEffect` deps are `[results]` only; no `ResizeObserver` on canvas | Add a `ResizeObserver` on `canvasRef.current` that re-runs the draw, or include `window.innerWidth` in deps via a resize listener |
| D6 | Medium | DCF tab | 320, 375 | Fair-price hero (`fontSize: 72`) | 4-digit fair prices (e.g. `$1234.56`) push the green `$` and bottom delta pill — pill can wrap awkwardly | Visual breakage on high-priced stocks (BRK, NVR, etc.) | Fixed 72 px font in a column whose `minmax(320px, 7fr)` shrinks on phone | Use `clamp(40px, 14vw, 72px)` for the price font; allow the delta pill to wrap with `flex-wrap: wrap` and `text-align: center` on the pill row |
| D7 | Medium | DCF tab | 320, 375 | Yahoo snapshot `SnapshotRow` flex-row | Long values (e.g. `Target range: $123.45 – $456.78`) collide with label; no `min-width: 0` so label can be pushed but values don't wrap | Truncated label like "Target ran…" or value pushed off the right | `display: flex, justifyContent: space-between` with both spans free to expand | Add `min-width: 0` + `overflow: hidden, text-overflow: ellipsis` on the label span; allow value to wrap (`white-space: normal`) |
| D8 | Low | DCF tab | All | Header right-block "CURRENT MARKET PRICE" + value | After flex-wrap, the right-aligned price block left-aligns under the title — visually adrift | Inconsistent alignment after wrap | `textAlign: 'right'` not undone after wrap | When wrapped on phone, set `textAlign: left` (or remove the inline align and use `align-self: flex-start`) inside the `<=640px` media block |

## Detailed findings

### D1 — DCF page horizontally overflows on phone (Critical)
- **Viewport**: 320×568, 375×667, 390×844
- **Source**: `src/components/DCFValuation.tsx:718-725`
- **Reproduction**: Open `/stock/AMKR`, click **DCF Valuation**, scroll past the Yahoo snapshot card.
- **Expected**: Controls accordion stack stacks above results column at phone widths.
- **Actual**: The grid is hard-coded to two columns with floors of 280 px and 320 px plus an 18 px gap → minimum content width = **618 px**. On 375 px viewport (≈347 px content after 14 px content padding from `.rv-content` at line 536 of globals.css) the right column is clipped and the document scrolls horizontally.
- **Why it matters**: Every slider on the right and every cell on the breakdown table is partially or fully off-screen on phones. This is the headline failure of the tab.
- **Root cause**: Inline `gridTemplateColumns: 'minmax(280px, 5fr) minmax(320px, 7fr)'` with no media-query collapse and no class hook to target it.
- **Recommended fix**: Replace the inline grid with a class.
  ```tsx
  // DCFValuation.tsx ~718
  <div className="rv-dcf-grid">
  ```
  ```css
  /* globals.css */
  .rv-dcf-grid {
    display: grid;
    grid-template-columns: minmax(280px, 5fr) minmax(320px, 7fr);
    gap: 18px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .rv-dcf-grid { grid-template-columns: 1fr; gap: 12px; }
  }
  ```
  Note: collapse breakpoint is 720 px (not 640 px) so the iPad-portrait-ish 700–720 px stress band also collapses cleanly before the 618 px floor kicks in.

### D2 — Breakdown table clips on the right (High)
- **Viewport**: 320, 375, 390 (and any ≤500 px content column)
- **Source**: `src/components/DCFValuation.tsx:1042` — `<table className="rv-table">` direct child of `.rv-card`.
- **Globals**: `.rv-table th, .rv-table td { white-space: nowrap; }` (`globals.css:209`).
- **Expected**: Either horizontal scroll inside the card, or a stacked card layout.
- **Actual**: Once D1 is fixed and the tab actually fits at 375 px, the four-column table (Metric / 2026 / 2028 / 2030) still exceeds the card width because all cells nowrap; the "2030" column is cropped without scroll affordance.
- **Recommended fix**: Wrap the table in the existing helper.
  ```tsx
  <div className="rv-table-wrap">
    <table className="rv-table">…</table>
  </div>
  ```

### D3 — Slider thumb tap target too small (High)
- **Viewport**: any `pointer: coarse`
- **Source**: `src/app/globals.css:240-263` (`.rv-dcf-slider::-webkit-slider-thumb`, `::-moz-range-thumb`) — both 16×16 px.
- **Expected**: ≥44 px effective tap target.
- **Actual**: 16 px thumbs are below WCAG 2.5.5 / Apple HIG. Users mis-grab and accidentally tap the description text or another slider.
- **Recommended fix**: Add a coarse-pointer override.
  ```css
  /* globals.css — append inside the existing @media (pointer: coarse) block */
  .rv-dcf-slider { height: 8px; }
  .rv-dcf-slider::-webkit-slider-thumb { width: 28px; height: 28px; }
  .rv-dcf-slider::-moz-range-thumb     { width: 28px; height: 28px; }
  ```
  Optionally bump the input itself to `padding: 12px 0; touch-action: manipulation;` for a wider vertical hit zone.

### D4 — Accordion header tap target under 44 px (High)
- **Viewport**: any `pointer: coarse`
- **Source**: `src/components/DCFValuation.tsx:114-131` — `<button>` with `padding: '12px 14px'` and `fontSize: 13`. Effective height ≈37 px.
- **Recommended fix**: Add `minHeight: 44` (or apply `.rv-btn` so the existing `pointer: coarse` rule at `globals.css:572-577` catches it).
  ```tsx
  // DCFValuation.tsx ~117
  style={{ width: '100%', minHeight: 44, background: 'transparent', /* …rest unchanged */ }}
  ```

### D5 — Canvas chart bitmap stale after resize / orientation change (Medium)
- **Viewport**: 390×844 ↔ 844×390 rotation, or any DevTools resize
- **Source**: `src/components/DCFValuation.tsx:463-514` — drawing effect deps are `[results]`. The canvas reads its size via `getBoundingClientRect()` at draw time, but is never re-drawn on viewport change.
- **Actual**: After rotating phone or shrinking the column (e.g. once D1 ships), the bars are scaled to the previous width and look squashed/cropped until the user nudges any slider.
- **Recommended fix**: Add a `ResizeObserver`.
  ```tsx
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      // trigger a redraw — easiest is to bump a state var, or call the draw fn
      // extracted out of the existing effect.
      forceRedraw((n) => n + 1);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);
  ```
  Then move the existing draw body into a `useCallback` and depend on both `results` and the redraw counter.

### D6 — Fair-price hero overflows / pill wraps awkwardly with large prices (Medium)
- **Viewport**: 320, 375
- **Source**: `src/components/DCFValuation.tsx:980-1009`
- **Actual**: At `fontSize: 72` a 4-digit price (think `$1234.56`) plus the `$` prefix is wider than the right column floor (320 px). Below it the `▲ 12.3% vs market ($1234.56)` pill is a single non-wrapping span and gets clipped.
- **Recommended fix**:
  ```tsx
  // price number
  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 'clamp(40px, 14vw, 72px)', /* … */ }}
  // pill row — allow wrap inside, center it
  style={{ marginTop: 14, display: 'inline-flex', flexWrap: 'wrap',
           justifyContent: 'center', textAlign: 'center', /* …rest */ }}
  ```

### D7 — Snapshot rows: long values collide with labels (Medium)
- **Viewport**: 320, 375
- **Source**: `src/components/DCFValuation.tsx:226-249` (`SnapshotRow`) used at lines 658-714, especially `Target range` (`$123.45 – $456.78`) and `Recommendation` (`Strong Buy`).
- **Actual**: `display: flex, justifyContent: 'space-between'`, neither span has `min-width: 0`. Mono-font values can push the label, and label has no ellipsis.
- **Recommended fix**:
  ```tsx
  // label span
  <span style={{ color: 'var(--ink-dim)', minWidth: 0,
                 overflow: 'hidden', textOverflow: 'ellipsis',
                 whiteSpace: 'nowrap', flex: '0 1 auto', marginRight: 8 }}>
  // value span — allow wrap on phone
  <span style={{ /* existing */, textAlign: 'right', minWidth: 0,
                 wordBreak: 'break-word' }}>
  ```

### D8 — Header right-block alignment drifts after flex-wrap (Low)
- **Viewport**: 320, 375
- **Source**: `src/components/DCFValuation.tsx:573-628`
- **Actual**: The header parent has `flexWrap: 'wrap'`. On phone the right block (`textAlign: 'right'`) wraps to a new line but stays right-aligned, so the title is left-aligned and the price block hangs against the right edge — looks accidental.
- **Recommended fix**: When wrapped, switch to left-align. Cheapest is to remove the inline `textAlign: 'right'` and apply it via class only above 640 px:
  ```tsx
  <div className="rv-dcf-header-right" style={{ /* no textAlign */ }}>
  ```
  ```css
  .rv-dcf-header-right { text-align: left; }
  @media (min-width: 641px) { .rv-dcf-header-right { text-align: right; } }
  ```

## Common root causes
- **Inline grid templates with no media-query escape hatch** (D1) — repeats the pattern that the earlier fix worked around for `.rv-stock-overview`. The DCF grid was missed because it lives inline.
- **Tables not wrapped in `.rv-table-wrap`** (D2) — same root cause that has been fixed elsewhere; this instance was left out.
- **Touch-target sizing not extended to component-specific controls** (D3, D4) — the global `pointer: coarse` block only targets `.rv-btn`, not the DCF slider thumb or the accordion header.
- **Canvas redraw tied to data state, not size** (D5) — common Next.js mistake when the chart is hand-rolled rather than using a chart library that ships its own ResizeObserver.
- **Large display typography with no `clamp()`** (D6) — the 72 px hero number assumes a desktop-ish container.
- **Flex rows missing `min-width: 0` on children** (D7) — standard cause of flex children refusing to shrink.

## Fix priority
- **Fix first**: D1 (collapse the DCF grid on phone) and D2 (wrap the breakdown table). These two unblock the entire tab.
- **Fix next**: D3 and D4 (tap targets). D5 (canvas resize) once the grid collapses, otherwise it's hidden by D1.
- **Nice to improve**: D6, D7, D8 — polish for stocks with large prices / long Yahoo strings.

## Pass/fail checklist
- [ ] No horizontal page overflow — **FAIL** (D1)
- [x] Navigation usable on mobile — N/A within DCF tab; tabs strip itself is fine
- [ ] Primary actions visible — **FAIL** (right-column sliders clipped via D1)
- [ ] Tables handled correctly — **FAIL** (D2)
- [ ] Charts responsive — **PARTIAL** (renders, but stale after resize per D5)
- [ ] Tap targets acceptable — **FAIL** (D3 slider thumb, D4 accordion button)
- [x] Text readable — pass (smallest text is 10.5 px description, acceptable at viewing distance)
- [ ] No major overlap or clipping — **FAIL** (D1 driven; D6/D7 secondary)

## Final verdict
The DCF Valuation tab is **not shippable on phones** today. The two-column controls/results grid forces ~618 px of minimum width with no collapse rule, so on every phone viewport (320–390 px) the right column is clipped, the page scrolls horizontally, and the breakdown table compounds the overflow. The two highest-priority fixes (D1 + D2) are each a single-line change. After those land, address the touch-target gaps (D3, D4) and the canvas resize redraw (D5) for full mobile readiness.

/home/jarvis/tst/trading-dashboard-app/qa-mobile/mobile-qa-report-2026-05-02.md
