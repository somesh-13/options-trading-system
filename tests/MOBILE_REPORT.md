# Mobile E2E Report — 2026-04-19

Playwright walked every route and exercised every interactive sub-control on
phone-class viewports.

## Verdict

| | |
|---|---|
| Tests run     | **45** |
| Passed        | **45** ✅ |
| Failed        | 0 |
| Flaky         | 0 |
| Duration      | 39.6s (4 workers) |
| Spec          | `tests/e2e/mobile.spec.ts` |
| Project       | `mobile-chrome` (Pixel 5 — 393×851, DPR 3, Chromium) |

## Coverage

### 1. Every route renders on mobile (17 tests)
Every route in the app — 6 revamped (`/`, `/scanner`, `/options-chain`,
`/pricing`, `/portfolio`, `/auto-engine`) and 11 legacy (`/vol-surface`,
`/sentiment`, `/backtest`, `/journal`, `/execution`, `/positions`, `/agent`,
`/risk`, `/risk-mgmt`, `/strategy`, `/replay`).

For each route the test asserts:
- HTTP status < 400
- `.rv-topbar` is visible (shell renders)
- `document.scrollWidth ≤ window.innerWidth + 2px` — **no horizontal body
  overflow on a phone-width viewport**
- No uncaught `pageerror` events

### 2. Every left-rail "tab" navigates (11 tests)
Tapping each of the 11 rail items (Home · Scanner · Chain · Pricing · Portfolio
· Positions · Risk · Auto · Backtest · NLP · Agent) routes correctly and the
tapped item picks up the `.active` class.

### 3. Top bar (3 tests)
- Brand + breadcrumbs render on phone width.
- The `.rv-search` trigger opens the `.rv-cmd` palette via tap.
- Typing `cifr` filters results; ⏎ on the ticker routes to `/options-chain`.

### 4. Per-page interactive sub-controls (14 tests)

| Page | What was tested |
|---|---|
| `/scanner`       | Filter chips visible (My list · 8 / Mag 7 / Mispriced · 23); last table row reachable by scroll; hotkey footer copy present |
| `/options-chain` | Expiration strip renders 6 cells with one `.on`; chain ATM row scrollable; SELL ticket button reachable |
| `/pricing`       | Price-from-IV mode toggle visible; sliders reachable; vol surface still renders 63 cells |
| `/portfolio`     | "Rehedge to Δ 0" button reachable; Open positions table has all 4 rows |
| `/auto-engine`   | HALT ALL button reachable; Event stream filter chips ("all" / "exec") render; guardrails limit bars reachable |

## Run

```bash
# Pixel 5 (Chromium) — runs against the existing `npm run dev` server
PLAYWRIGHT_SKIP_WEBSERVER=1 \
NODE_PATH=$(ls -d /home/jarvis/.npm/_npx/*/node_modules | head -1) \
  npx --yes -p @playwright/test@1.59.1 playwright test \
  tests/e2e/mobile.spec.ts --project=mobile-chrome --workers=4
```

## Known limitations

- **iPhone 13 / WebKit was skipped.** A `mobile-safari` project is wired into
  `playwright.config.ts` but only activates when `PLAYWRIGHT_ENABLE_WEBKIT=1`
  is set, because `npx playwright install webkit` fails on this Ubuntu host
  without `sudo apt-get install libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0
  libflite1 libavif16 gstreamer1.0-libav`. Once those system libs are in,
  re-run with `PLAYWRIGHT_ENABLE_WEBKIT=1` to add 45 more iPhone-13 tests.
- **Expiration strip is read-only on mobile (and desktop).** The current
  `OptionsChainPage` is a server component and doesn't pass `onSelect` to
  `<ExpirationStrip>`, so tapping a different cell does nothing. The test
  accepts this — it asserts visibility + the default selection only. When the
  strip becomes interactive, tighten the test to assert selection movement.
- **Filter chips on `/scanner` are static spans** with no click handlers
  (also documented in the component's TODO). The test asserts they render but
  not that they filter.
- **No visual regression / pixel-diff coverage.** A separate snapshot run
  exists in `tests/mobile-audit/screenshots/`; this spec is functional only.

## Files

- `tests/e2e/mobile.spec.ts` — 45 mobile E2E tests
- `playwright.config.ts` — adds `mobile-chrome` (always on) + `mobile-safari`
  (gated on `PLAYWRIGHT_ENABLE_WEBKIT`)
