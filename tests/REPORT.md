# VegaEdge - UI Revamp Test Report

_Generated: 2026-04-19 22:04 UTC_  
_Runner: Playwright 1.59.1, chromium, 4 workers, base URL `http://localhost:3000`_

## Summary

| metric | value |
|---|---|
| Tests run | **63** |
| Passed    | **63** PASS |
| Failed    | **0** |
| Skipped   | 0 |
| Flaky     | 0 |
| Duration  | 56.2s |

## By spec file

| file | tests | passed | failed | duration |
|---|---|---|---|---|
| `pages.spec.ts` | 32 | 32 | 0 | 112.2s |
| `shell.spec.ts` | 14 | 14 | 0 | 50.3s |
| `smoke.spec.ts` | 17 | 17 | 0 | 34.1s |

## `pages.spec.ts`

| status | test | duration | notes |
|---|---|---|---|
| PASS | renders 4 KPI cells | 7949 ms |  |
| PASS | opportunity table has 8 rows | 7829 ms |  |
| PASS | every opportunity row has a chain → link | 7785 ms |  |
| PASS | aggregate Greeks card shows Δ Γ Θ V | 7950 ms |  |
| PASS | recent signals log has at least 4 rows | 3507 ms |  |
| PASS | table has 8 rows of mock opportunities | 3447 ms |  |
| PASS | first row has selection class | 3045 ms |  |
| PASS | rows contain inline sparkline SVG | 3152 ms |  |
| PASS | rows contain EV bar | 3227 ms |  |
| PASS | hotkey footer is visible | 3335 ms |  |
| PASS | expiration strip has 6 cells with one selected | 2912 ms |  |
| PASS | chain table has 11 strike rows | 2769 ms |  |
| PASS | one row is marked ATM | 2693 ms |  |
| PASS | order ticket renders SELL primary button | 2626 ms |  |
| PASS | ticket shows POP and EV computed metrics | 3020 ms |  |
| PASS | first-order Greeks section has 5 cells | 2695 ms |  |
| PASS | second-order Greeks section has 3 cells with ord2 styling | 3185 ms |  |
| PASS | inputs card shows σ and T sliders | 2992 ms |  |
| PASS | vol surface has a 7-column grid | 2354 ms |  |
| PASS | mode toggle buttons render | 2886 ms |  |
| PASS | NAV card shows $142,080 | 3416 ms |  |
| PASS | equity curve renders an SVG | 2934 ms |  |
| PASS | aggregate Greeks card has 4 cells | 3066 ms |  |
| PASS | hedge suggestion card shows Δ drift copy | 2644 ms |  |
| PASS | positions table has 4 rows | 2822 ms |  |
| PASS | rehedge button is visible in header | 2592 ms |  |
| PASS | RUNNING chip is visible | 2832 ms |  |
| PASS | HALT ALL button is prominent | 2579 ms |  |
| PASS | guardrails card shows 4 limit bars | 2425 ms |  |
| PASS | event stream shows at least 8 rows | 2578 ms |  |
| PASS | event stream filter chips render | 2597 ms |  |
| PASS | first event row is colored EXEC | 2392 ms |  |

## `shell.spec.ts`

| status | test | duration | notes |
|---|---|---|---|
| PASS | brand reads "vegaEdge" | 2804 ms |  |
| PASS | breadcrumbs reflect current route | 5024 ms |  |
| PASS | palette trigger button shows ⌘K hint | 2965 ms |  |
| PASS | all 4 status pills render | 2628 ms |  |
| PASS | renders 11 nav items + 2 separators | 3100 ms |  |
| PASS | every rail item has visible icon + label | 3016 ms |  |
| PASS | home item is active on / | 2966 ms |  |
| PASS | scanner item is active after navigation to /scanner | 3693 ms |  |
| PASS | clicking a rail item navigates | 5307 ms |  |
| PASS | opens with Ctrl+K, closes with Escape | 3465 ms |  |
| PASS | opens by clicking the search trigger | 3016 ms |  |
| PASS | typing filters items | 3381 ms |  |
| PASS | Enter on a ticker navigates to /options-chain | 3872 ms |  |
| PASS | Enter on a nav item navigates to that page | 5026 ms |  |

## `smoke.spec.ts`

| status | test | duration | notes |
|---|---|---|---|
| PASS | smoke / — shell renders, no uncaught errors | 1582 ms |  |
| PASS | smoke /scanner — shell renders, no uncaught errors | 2430 ms |  |
| PASS | smoke /options-chain — shell renders, no uncaught errors | 2790 ms |  |
| PASS | smoke /pricing — shell renders, no uncaught errors | 2645 ms |  |
| PASS | smoke /portfolio — shell renders, no uncaught errors | 2615 ms |  |
| PASS | smoke /auto-engine — shell renders, no uncaught errors | 2207 ms |  |
| PASS | smoke /vol-surface — shell renders, no uncaught errors | 2196 ms |  |
| PASS | smoke /sentiment — shell renders, no uncaught errors | 2330 ms |  |
| PASS | smoke /backtest — shell renders, no uncaught errors | 2659 ms |  |
| PASS | smoke /journal — shell renders, no uncaught errors | 1636 ms |  |
| PASS | smoke /execution — shell renders, no uncaught errors | 1087 ms |  |
| PASS | smoke /positions — shell renders, no uncaught errors | 1657 ms |  |
| PASS | smoke /agent — shell renders, no uncaught errors | 1301 ms |  |
| PASS | smoke /risk — shell renders, no uncaught errors | 1230 ms |  |
| PASS | smoke /risk-mgmt — shell renders, no uncaught errors | 1967 ms |  |
| PASS | smoke /strategy — shell renders, no uncaught errors | 1973 ms |  |
| PASS | smoke /replay — shell renders, no uncaught errors | 1792 ms |  |

## Coverage map

17 routes x shell + per-page features.

| Route | Phase | Smoke | Page features | Status |
|---|---|---|---|---|
| `/` | Phase 2 | PASS | 4 KPIs, table, Greeks, signals | live |
| `/scanner` | Phase 3 | PASS | 8-row table, sparkline, EV bar, hotkeys | live |
| `/options-chain` | Phase 4 | PASS | 6 expirations, 11 strikes, ATM, ticket | live |
| `/pricing` | Phase 5 | PASS | 5 + 3 Greek cells, sliders, vol surface | live |
| `/portfolio` | Phase 6 | PASS | NAV, equity curve, attribution, hedge, positions | live |
| `/auto-engine` | Phase 7 | PASS | RUNNING + HALT, 4 limit bars, event stream | live |
| `/vol-surface` | legacy | PASS | shell + cleaned header | untouched |
| `/sentiment` | legacy | PASS | shell + cleaned header | untouched |
| `/backtest` | legacy | PASS | shell + cleaned header | untouched |
| `/journal` | legacy | PASS | shell + cleaned header | untouched |
| `/execution` | legacy | PASS | shell + cleaned header | untouched |
| `/positions` | legacy | PASS | shell + cleaned header | untouched |
| `/agent` | legacy | PASS | shell + cleaned header | untouched |
| `/risk` | legacy | PASS | shell + cleaned header | untouched |
| `/risk-mgmt` | legacy | PASS | shell + cleaned header | untouched |
| `/strategy` | legacy | PASS | shell + cleaned header | untouched |
| `/replay` | legacy | PASS | shell + cleaned header | untouched |

## What's tested

### `smoke.spec.ts` (17 tests)
Each route returns < 400, the AppShell (`.rv-topbar` + `.rv-rail`) renders, no uncaught JS errors. Revamped pages additionally assert on the `<h2 className="rv-h1">` page title text. Console errors are captured into test annotations (visible in HTML report) but do not fail the test - backend-call console errors on legacy pages are out of scope for this UI suite.

### `shell.spec.ts` (13 tests)
Brand reads "vegaEdge"; breadcrumbs reflect route; CMD-K hint visible; 4 status pills (regime/VaR/PAPER/live) render; left rail has 11 nav items + 2 separators with visible icon + label; active state tracks the current route; clicking a rail item navigates; CMD-K opens palette / Escape closes; click trigger also opens; typing filters items; Enter on a ticker navigates to `/options-chain?ticker=...`; Enter on a nav item navigates.

### `pages.spec.ts` (33 tests)
- **Home (5):** 4 KPI cells, opportunity table = 8 rows, every row has a chain link, aggregate Greeks = 4 cells, >=4 recent-signals rows.
- **Scanner (5):** table = 8 rows, first row `.sel`, >=8 sparkline SVGs, >=8 EV bars, hotkey footer visible.
- **Chain (5):** 6 expiration cells with one `.on`, 11 strike rows, exactly 1 `.atm` row, ticket has `SELL ... 0.82` button, ticket shows POP + EV.
- **Pricing (5):** 5 first-order Greeks, 3 `.ord2` second-order Greeks, >=2 sliders, vol surface = 7x9 = 63 cells, mode toggle visible.
- **Portfolio (6):** NAV $142,080, equity curve SVG, 4 aggregate Greeks, "delta drift" hedge copy, 4 positions rows, "Rehedge to delta 0" button.
- **Auto-engine (6):** RUNNING chip, HALT ALL button, >=4 limit bars, >=8 event-stream rows, filter chips visible, first event row classed EXEC.

## Known gaps / future work

- **Data wiring not yet tested.** All revamped pages use mock data with `// TODO: wire <endpoint>` seams. Integration tests (real backend response shapes) belong in a follow-up suite once data wiring lands.
- **Console errors on legacy pages.** `/sentiment`, `/backtest`, etc. trigger backend calls that may 404 in dev. Captured as annotations only, not test failures.
- **Mobile / responsive.** Suite runs Desktop Chrome only. The existing `tests/mobile-audit/` is a separate scaffold; merging viewport-matrix testing here is a follow-up.
- **Visual regression.** No screenshot comparison yet. Worth adding for the dense `.rv-chain` table and the order ticket once the design is locked.
- **A11y.** No axe / contrast checks yet. Worth adding for the new shell + every revamped page.
- **WebSocket / `/ws/live`.** The Agent page WebSocket is not exercised; needs a separate spec with route mocking.

## How to run

```bash
# Skip auto-spawn since dev server is already running:
PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e

# Against the LAN IP or ngrok URL:
PLAYWRIGHT_BASE_URL=https://precision-comply-lavish.ngrok-free.dev \
  PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e

# HTML report:
npx playwright show-report
```