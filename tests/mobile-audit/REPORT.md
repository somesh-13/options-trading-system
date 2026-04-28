# Mobile UI Audit — 2026-04-19

Playwright walked every top-level route on four mobile viewports. Raw JSON
findings live in `report.json`; per-route full-page screenshots live in
`screenshots/`. The audit script is `audit.mjs`.

## Viewports tested

| Device | CSS viewport | Notes |
| --- | --- | --- |
| iPhone 16 Pro | 402 × 874 (DPR 3) | The user's reported device |
| iPhone SE | 375 × 667 | Smallest realistic phone |
| Pixel 7 | 412 × 915 | |
| Galaxy S9+ | 320 × 658 | Stress case for narrow widths |

## Summary

No console / page errors on any route. **Three components cause horizontal
overflow that pushes interactive controls off-screen on mobile**, plus one
table that requires horizontal scrolling to reach right-side columns.

Severity legend: 🔴 blocking (control unreachable), 🟠 affects usability
(tap target offscreen but nav still works), 🟡 minor / by-design.

---

## 🔴 P0 — `/strategy` (the user's reported page)

**File:** `src/components/EVCalculator.tsx:84-104`

The second control row uses `flex gap-3` with no wrap and four wide controls
(two `<select>`, one `w-24` numeric input, one `Calculate EV` button). The
combined width is ~484 px so on every mobile viewport tested:

- iPhone 16 Pro (402 px): `Calculate EV` clipped, button sits at `right=484`.
- iPhone SE / Galaxy S9+ (320–375 px): both the contracts input AND the
  `Calculate EV` button are off-screen (`right=353` / `right=484`).
- Page-level horizontal overflow: +82 px (iPhone 16 Pro) up to +164 px
  (Galaxy S9+).

Additionally the input row above it (`grid grid-cols-4 gap-3`) cramps four
labelled numeric inputs into 320–402 px — labels still render but inputs
become ~70 px wide and uncomfortable to tap.

**Fix direction:**
- Wrap the `flex gap-3` row with `flex-wrap` and let the button take full
  width on small screens (`w-full sm:w-auto`).
- Make the inputs grid responsive: `grid-cols-2 sm:grid-cols-4`.
- Same treatment for the result `grid-cols-3` / `grid-cols-4` blocks below
  (visually OK now but borderline at 320 px).

---

## 🟠 P1 — `/options-chain`

**File:** `src/components/options-chain/ChainTable.tsx:79-148`

The table has `min-w-[640px]` inside an `overflow-x-auto` wrapper. Page-level
overflow is fine (the wrapper absorbs it), but the right-most "+" action
button starts at `left=610` so on every mobile viewport the user must
horizontally scroll the table to discover and tap it.

This may be intentional — a wide options chain is hard to fit on a phone —
but at minimum:

- Add a visible scroll-affordance (right-edge fade gradient or pinned action
  column) so users know to scroll.
- Consider a card layout on `sm:` breakpoint instead of a wide table.

---

## 🟠 P1 — `/backtest`

**File:** `src/components/MultiBacktestPanel.tsx:123` (`flex gap-2` row of
ticker pills `CIFR / WULF / ONDS / HOOD / CLSK`)

At 320–375 px the last pill (`CLSK`) overflows by ~60 px. Page becomes
horizontally scrollable. Add `flex-wrap` to the pill row.

---

## 🟠 P1 — `/scanner`

**File:** `src/app/scanner/page.tsx:117-124`

The "Add" form is on `flex flex-col sm:flex-row` so it does stack at the
`sm` breakpoint — but the inner `<form>` uses `flex gap-2 flex-1 sm:w-28`
on the input + a fixed-width "Add" button. At 375 px the Add button is
clipped by ~9 px (right=329, viewport=320). A small width adjustment on
the input or wrapping the form fixes it.

---

## 🟠 P1 — `/vol-surface`

**File:** `src/app/vol-surface/page.tsx` (Load button row)

"Load" button overflows by ~15 px at 320 px wide. Same pattern as scanner —
`flex` with no wrap and a fixed-width input + button.

---

## ✅ Pages with no mobile issues

`/`, `/pricing`, `/portfolio`, `/positions`, `/journal`, `/replay`,
`/agent`, `/auto-engine`, `/execution`, `/risk`, `/risk-mgmt`,
`/sentiment`. These already use `flex-wrap`, responsive grids, or single-
column layouts on small screens.

---

## Common pattern to fix everywhere

Most issues come from the same anti-pattern:

```tsx
<div className="flex gap-3">
  <input className="..." />
  <input className="w-24 ..." />
  <button className="px-6 py-2 ...">Action</button>
</div>
```

Replace with:

```tsx
<div className="flex flex-wrap gap-3">
  <input className="flex-1 min-w-[120px] ..." />
  <input className="w-full sm:w-24 ..." />
  <button className="w-full sm:w-auto px-6 py-2 ...">Action</button>
</div>
```

Apply the same `grid-cols-2 sm:grid-cols-4` treatment to dense input grids
on `/strategy`.

---

## Artefacts

- `tests/mobile-audit/audit.mjs` — Playwright audit script.
- `tests/mobile-audit/report.json` — full per-route JSON findings.
- `tests/mobile-audit/screenshots/` — full-page PNGs, named
  `<device>__<route>.png` (e.g. `iphone-16-pro__strategy.png`).
