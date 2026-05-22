# Mobile QA report — /robinhood — 2026-05-12

## Scope

- **Target:** VegaEdge trading dashboard, `/robinhood` page
- **Viewport:** iPhone SE (375×667), Chromium engine, iOS user agent, `isMobile: true`
- **Frontend:** `http://localhost:3000` (Next.js dev server, already running)
- **Backend:** `http://localhost:8000` (FastAPI / uvicorn) — initial state: **DOWN**
- **Method:** Live Playwright pass; capture screenshots, page errors, `/api/*` request status, viewport overflow. No mocks. Two passes — broken (backend down) and fixed (backend up) — for direct comparison.
- **User question being answered:** "why is the Robinhood page down?"

## Executive summary

**The page is not down — the backend is.** `/robinhood` itself returns `200` from Next.js and the React shell renders. The page is *unusable* because every `/api/robinhood/*` and `/api/notifications` call is proxied via `next.config.ts` rewrites to `http://localhost:8000`, and that uvicorn process was not running. The Next dev server logs were saturated with `ECONNRESET` / `socket hang up` and returned `500` to the browser for each proxied request.

Starting the backend with `make start-be` restored every proxied endpoint (`200`) and re-introduced the visual cues that were missing (session pill in topbar, notification badge on the bell). No frontend code change required.

| Severity | Count |
| --- | --- |
| Critical | 1 (root cause: backend down) |
| High | 0 |
| Medium | 0 |
| Low | 0 |

**Verdict:** Resolved in this session by starting the backend. No code defect on the `/robinhood` page itself.

## Findings

| ID | Severity | Page | Component | Issue | Cause | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Critical | `/robinhood` | Next rewrites → FastAPI | All `/api/robinhood/*` + `/api/notifications` return 500; topbar missing "rh:" session pill and notification count | uvicorn (`backend/src/api/routes.py`) on `:8000` was not running; Next rewrite target unreachable, dev log floods with `ECONNRESET` | `cd /home/jarvis/tst/trading-dashboard-app && make start-be` (or run `uvicorn src.api.routes:app --host :: --port 8000 --reload` from `backend/`) |

## F1 — detailed finding

### Reproduction

1. With backend stopped: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/docs` → `000` (connection refused).
2. `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/robinhood` → `200` (page shell renders).
3. `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/robinhood/session` → `500`.
4. Open `/robinhood` on iPhone SE viewport: password gate visible, topbar shows only the `live data` chip — no `rh: logged out` pill, no number on the notification bell.
5. Tail dev-server log: `Failed to proxy http://localhost:8000/api/robinhood/holdings ... ECONNRESET` repeating for every poller.

### Root cause

`next.config.ts` declares Next.js rewrites for `BACKEND_PROXY_PREFIXES` (lines 22–40):

```ts
async rewrites() {
  return BACKEND_PROXY_PREFIXES.map((prefix) => ({
    source: `/api/${prefix}/:path*`,
    destination: `http://localhost:8000/api/${prefix}/:path*`,
  }));
}
```

`robinhood` and `notifications` are both in the prefix list. The `/robinhood` client component (`src/app/robinhood/page.tsx`) wires three SWR-style pollers (`SYNC_STATUS_INTERVAL=60s`, `HOLDINGS_INTERVAL=30s`, `AUTO_SYNC_INTERVAL=5min`) plus a one-shot session/notifications fetch. With the backend offline every one of those rewrite destinations errors out; the Next dev server surfaces `500` to the browser and logs `ECONNRESET` server-side.

The page never crashes (`pageErrors: []` in both states), so the symptom presents as "page loads but is missing data and has no error UI" — easy to mistake for a frontend regression.

### Fix

The fix is operational, not code:

```bash
cd /home/jarvis/tst/trading-dashboard-app && make start-be
# wait until http://localhost:8000/docs returns 200, then refresh the page
```

After `make start-be`:

| Endpoint | Before | After |
| --- | --- | --- |
| `GET /api/robinhood/session` | 500 | 200 |
| `GET /api/robinhood/summary` | 500 | 200 |
| `GET /api/notifications` | 500 | 200 |
| Topbar `rh:` pill | absent | shows `rh: logged out` |
| Bell badge | absent | shows `35` |

### Suggested follow-ups (frontend hardening)

Out of scope for "fix it now" but worth a ticket — the page silently degrades when the backend is unreachable. None of these are required:

1. **Surface a banner when `/api/robinhood/session` returns 500.** Right now a user just sees "Enter password" with no hint that data fetches are dead. A top-of-page "Backend unreachable — retrying…" pill would short-circuit support tickets.
2. **Tighten the proxy error.** Next currently returns `500` on rewrite failure. Returning `503` + a JSON body (`{"error":"backend_unreachable"}`) would let `lib/robinhood-api.ts` distinguish "backend down" from "backend errored on this query".
3. **`make status` in CI / pre-flight.** The Makefile already has `make status` — wiring it into the dev-server start would catch the "frontend up, backend down" footgun before the user hits `/robinhood`.

### Screenshots

| State | Top of page | Topbar zoom (read manually from `01-top.png`) |
| --- | --- | --- |
| Broken (backend down) | `qa-mobile/screenshots-2026-05-12-broken/01-top.png` | only `live data` chip, plain bell |
| Fixed (backend up) | `qa-mobile/screenshots-2026-05-12-fixed/01-top.png` | `live data` + `rh: logged out` pill, bell shows `35` |

Full-page + bottom shots and per-state `finding.json` are in the same directories.

## Findings inside the gate (follow-up pass)

Re-ran with gate password (`1769`, hardcoded in `src/components/robinhood/RobinhoodPasswordGate.tsx:6`). Walked all 3 view tabs (Portfolio / Analytics / Reports) and 4 of 5 account tabs (All / Brokerage / Roth IRA / Crypto). **Global: 0 page errors, 0 console errors, 0 horizontal overflow on any view.** Screenshots in `qa-mobile/screenshots-2026-05-12-gated/`.

| ID | Severity | Page | Component | Issue | Cause | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| F2 | High | `/robinhood` | Account tab strip | **SoFi tab unreachable on iPhone SE (375px).** Only 4 of 5 tabs render in the visible strip; `playwright.scrollIntoViewIfNeeded` times out on `account-tab-sofi`. Source declares `TAB_ORDER = ['all','brokerage','roth_ira','crypto','sofi']` (page.tsx:38) but the 5th is clipped or hidden. | 4 tabs at current sizing already span 375px; the strip neither scrolls horizontally nor wraps SoFi to a second row. | Make the strip horizontally scrollable (`overflow-x: auto`, `scroll-snap`) or wrap to two rows below ~380px width. |
| F3 | Medium | `/robinhood` → Crypto → Portfolio | `CryptoTable` | Right edge of the holdings table is clipped on iPhone SE — "CURRENT VALUE" column header shows as `CU` and dollar values like `$81,38…` are cut at the viewport edge. No scroll affordance hinted. | Table renders at intrinsic width inside a card with no `overflow-x` container; on 375px the rightmost column overflows the card's clip region (note: this overflow is not on `<html>` so `scrollWidth - innerWidth` reads 0 and didn't trip the heuristic — anti-pattern flagged in the QA skill). | Wrap the table in a `div` with `overflow-x: auto` + visible scrollbar styling, OR collapse Avg Cost / Cur Value into a stacked sub-cell at mobile widths. Same `HoldingsTable` likely needs the same fix; worth checking explicitly. |
| F4 | Low | `/robinhood` (all views) | Sync freshness badge | `LIVE • 1496m ago` (~25 hours) renders in green next to a `LIVE` label that suggests fresh data. Stale-banner exists in DOM (`data-testid="stale-banner"`) but didn't activate at 25h. | The `LIVE` chip color isn't bound to `minutesAgo()`; only the separate stale-banner is, and its threshold is higher than 25h. | Cross fade the `LIVE` chip to yellow/red when `minutesAgo > 60` (or whatever the product threshold is), or lower the stale-banner threshold. |

### Anti-pattern note

The 2026-05-09 report's clean `overflow = 0` on Robinhood would *not* have caught F3 — `isMobile: true` makes `document.documentElement.scrollWidth - window.innerWidth` read 0 even when an inner element clips. Future passes should also probe `el.scrollWidth > el.clientWidth` on every `.rv-card table` and assert visually.

### Screenshots — gated pass

- `screenshots-2026-05-12-gated/01-unlocked.png` — top of page after `1769` (shows 4-tab strip; SoFi missing)
- `screenshots-2026-05-12-gated/21-account-crypto-fullpage.png` — F3 clipping visible on `CryptoTable`
- `screenshots-2026-05-12-gated/{20,21}-account-{all,brokerage,roth_ira,crypto}-*.png` — each account state
- `screenshots-2026-05-12-gated/{10,11,12}-view-{portfolio,analytics,reports}-*.png` — each view state
- `screenshots-2026-05-12-gated/finding.json` — per-step error/overflow capture

### Re-run command

```bash
cd /home/jarvis/playwright-js \
  && QA_OUT_DIR=/home/jarvis/tst/trading-dashboard-app/qa-mobile/screenshots-2026-05-12-gated \
     QA_ROBINHOOD_PASSWORD=1769 \
     npx playwright test --project=iphone-se --reporter=line --workers=1 \
     robinhood-gated.iphone-se.spec.ts
```

## Coverage gaps

- **SoFi account tab not exercised** — it's the very thing F2 flags as unreachable, so we couldn't capture its inside views. Manually scrolling the tab strip in DevTools should reveal SoFi-specific holdings.
- **No data mutation tested** — `Sync RH` button, dry-run Buy/Sell on Crypto Order Panel, `Run all` on Analytics. Allow-list guards intentionally avoided clicking these.
- **Only iPhone SE.** Pixel 7 (412×915) and 320×568 stress not run.
- **Live-prices toggle off.** Polling cadence of holdings/sync-status not stressed; only initial-load behaviour observed.

## Methodology / reproducibility

One-shot to re-run the broken/fixed comparison:

```bash
# Broken pass (stop backend first if running)
cd /home/jarvis/tst/trading-dashboard-app && make stop-be
cd /home/jarvis/playwright-js \
  && QA_OUT_DIR=/home/jarvis/tst/trading-dashboard-app/qa-mobile/screenshots-2026-05-12-broken \
     npx playwright test --project=iphone-se --reporter=line --workers=1 \
     robinhood-down-probe.iphone-se.spec.ts

# Fixed pass
cd /home/jarvis/tst/trading-dashboard-app && make start-be
until curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/docs | grep -q 200; do sleep 2; done
cd /home/jarvis/playwright-js \
  && QA_OUT_DIR=/home/jarvis/tst/trading-dashboard-app/qa-mobile/screenshots-2026-05-12-fixed \
     npx playwright test --project=iphone-se --reporter=line --workers=1 \
     robinhood-down-probe.iphone-se.spec.ts
```

Spec source: `/home/jarvis/playwright-js/tests/robinhood-down-probe.iphone-se.spec.ts` (no assertions — evidence-gathering only; writes `finding.json` per pass).

## Cross-reference

Prior reports in this directory: `mobile-qa-report-2026-05-02.md`, `mobile-qa-report-2026-05-03.md`, `mobile-qa-report-2026-05-09.md`. None covered the "backend offline" failure mode — they all assumed `:8000` was up. The 2026-05-03 report was also flagged in the skill for being static-analysis only; this one is live-render evidence.
