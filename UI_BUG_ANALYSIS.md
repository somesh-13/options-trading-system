# UI Bug Analysis — Stock Detail Overview (WVFI screenshot)

Source screenshot: `IMG_8502_ui_bugs.jpg` (this folder).

## What the screenshot shows

Right column of the stock-detail page is collapsed to near-empty:
- **Key Statistics** card shows only "Open" — Previous Close, Day High/Low, 52W High/Low missing.
- **Trading Info** card shows only the heading — Volume, Avg Volume, Market Cap, P/E missing.
- **Quick Actions** card shows only "Options Chain" — Pricing Calculator button missing.

Left column:
- **Price chart (Candles mode)** renders as 5–6 huge solid green/magenta rectangles with no visible wicks. Looks more like fat volume bars than OHLC candles.

## Root causes

### 1. Sidebar cards clipped — `ResizableCard` persists too-small heights
File: `src/components/ui/ResizableCard.tsx`

The card body uses `overflow: 'auto'` plus a persisted `height` from `localStorage` (key prefix `RESIZE_LOCALSTORAGE_PREFIX + cardId`). When the persisted height is smaller than the natural content height, the card silently clips the rows below and only shows the first child. No scrollbar is visible at the rendered scale, so it looks like the panel data itself is missing.

Card IDs of the affected panels (from `StockDetailClient.tsx` → `PanelHost cardId={`stock-detail:${panelId}`}`):
- `stock-detail:key-statistics`
- `stock-detail:trading-info`
- `stock-detail:quick-actions`

Why heights end up wrong:
- The `ResizeObserver` debounces a save 250 ms after any size change, including transient sizes during initial mount / data load. If the card briefly renders short (before async data populates `StatRow`s), the short size gets persisted and locks the card on subsequent reloads.
- There is no `min-height` floor, so a one-time stray drag-resize permanently shrinks the card with no recovery path other than dragging it back.

### 2. Candle chart — wicks invisible, bodies too fat
File: `src/components/charts/StockPriceChart.tsx` (candles branch around L278–L330)

- Wick dataset uses `barPercentage: 0.08` with `categoryPercentage: 1`. At typical chart widths with few candles, the wick width rounds to sub-pixel and disappears entirely.
- Body dataset uses `barPercentage: 0.7, categoryPercentage: 1`. With only a handful of aggregated candles (the chart shows ~5–6 bars), each body occupies ~70% of a very wide category slot, producing the "huge brick" appearance.
- Volume bars on the hidden `yVol` axis use `rgba(…, 0.45)` colors and `barPercentage: 0.7`. They overlap the body bars beneath the same category and visually merge into the bodies on a small monitor at a distance.
- `yVol.max = maxVolume * 4.5` keeps volumes nominally in the bottom ~22% of the chart, but it does not stop them visually colliding with bodies when bodies are short on the price scale.

## Fix plan (concrete, file-scoped)

### Fix A — sidebar card clipping
1. In `src/components/ui/ResizableCard.tsx`:
   - Add a `minHeight` floor in the merged style (e.g. `minHeight: 120`) so a too-small persisted value cannot hide content.
   - Only persist after the user actually drags. Skip the first `ResizeObserver` callback and gate saves behind a `pointerdown`/`pointerup` flag on the host div — never save sizes during the initial mount/data-load reflow.
   - Optionally: change `overflow: 'auto'` to `overflow: 'visible'` for the height axis (`overflowX: 'auto'`, `overflowY: 'visible'`) so vertical content never gets clipped; the resize handle still works.
2. Ship a one-time cleanup: in the same file's mount effect, if `persisted.h` exists but is smaller than the element's `scrollHeight`, ignore it and `localStorage.removeItem` the entry. This unsticks any users (including this screenshot's session) without manual intervention.

### Fix B — candles look correct
In `src/components/charts/StockPriceChart.tsx` candles branch:
1. Wick visibility: bump `barPercentage` for the wick dataset from `0.08` to `~0.15`, and set `borderWidth: 0` explicitly to avoid antialiasing eating thin bars. Consider `minBarLength: 1` so a zero-range candle still shows a hairline.
2. Body width: lower body `barPercentage` from `0.7` to `0.55` so bodies don't dominate when there are few candles. Also clamp candle count: if `aggregated.length < 10`, set `categoryPercentage` to `0.6` to keep bodies visually proportionate.
3. Volume / body separation: drop volume `barPercentage` to `0.55` (matches new body width) and lift `yVol.max` to `maxVolume * 6` so volume bars sit firmly in the bottom band.
4. (Optional) Switch volume to its own muted color (e.g. `rgba(120,120,135,0.35)`) instead of green/pink — currently it shares the up/down palette which makes volume and body bars indistinguishable on a glance.

### Fix C — verification
After both fixes:
- Hard-refresh `/stock/WVFI` with `localStorage.clear()` for the `rv-card-size:` prefix and confirm Key Statistics, Trading Info, Quick Actions all render their full row set.
- Switch the chart between Line and Candles on 1M/3M/1Y. Confirm wicks are visible and bodies have clear separation from volume bars.

## Files to touch
- `src/components/ui/ResizableCard.tsx` (Fix A)
- `src/components/charts/StockPriceChart.tsx` (Fix B, candles branch L278–L330 and options block L418+)
- No data-shape changes required — `STOCK_OVERVIEW_PANELS` in `src/app/stock/[ticker]/panels.tsx` already populates all rows; the rows aren't missing, they're being clipped.
