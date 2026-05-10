# `/api/regime/{ticker}` — Usage

Public read-only endpoint for the VegaEdge regime signal. Bundles HMM regime
detection, IV/HV mispricing, a 4-way verdict, the top-ranked option contract
for the chosen strategy, standby strikes for all three strategies, the active
gate explainer, and recommended polling cadence — in a single JSON response
designed for cron consumers.

## Endpoint

```
GET https://precision-comply-lavish.ngrok-free.dev/api/regime/{ticker}
```

| Item | Value |
|---|---|
| Method | `GET` only |
| Path param | `ticker` — matches `^[A-Za-z][A-Za-z0-9.\-]{0,9}$` (1–10 chars, must start with a letter; case-insensitive — proxy uppercases before forwarding) |
| Auth | None (path-restricted reverse proxy; only this route + `/` health are exposed) |
| Content-Type | `application/json` |

### Errors

| Status | Cause |
|---|---|
| `400` | Ticker fails the regex above |
| `405` | Method other than `GET` |
| `502` | Upstream backend unreachable |

## Quick start

```bash
curl -s https://precision-comply-lavish.ngrok-free.dev/api/regime/CIFR | jq
```

Health check:

```bash
curl -s https://precision-comply-lavish.ngrok-free.dev/
# -> "VegaEdge regime proxy. Try /api/regime/CIFR"
```

## Response schema

Top-level fields:

| Field | Type | Description |
|---|---|---|
| `ticker` | string | Uppercase symbol echoed back |
| `asof` | ISO-8601 datetime (UTC) | When the analysis was computed |
| `spot` | float | Current underlying price |
| `regime` | object | HMM regime detection — see below |
| `mispricing` | object | IV vs HV + Keltner band — see below |
| `verdict` | enum | `BUY` \| `SELL_PUT` \| `SELL_COVERED_CALL` \| `HOLD` |
| `confluence_score` | float `[0, 1]` | Confidence in the verdict |
| `top_contract` | object \| null | Top-ranked contract for the chosen strategy (null when `verdict=HOLD` or no actionable candidate) |
| `top_candidates` | object | Best contract for **each** strategy regardless of verdict |
| `strategy_window` | object \| null | Active strategy params + gate state |
| `polling_recommendation` | object | Suggested cron cadence |
| `notes` | string[] | Warnings / context. Two formats: `"<STRATEGY>: no candidates within …"` (strict window empty) or `"SELL_COVERED_CALL: relaxed — <reason>."` (a fallback tier produced the strike — see below). |

### `regime`

Passthrough of `detect_current_regime()`.

| Field | Type | Description |
|---|---|---|
| `ticker` | string | Echoed |
| `regime` | string | One of `regime_labels` — the most likely current state |
| `probability` | float `[0, 1]` | Posterior probability of the active regime |
| `regime_means` | float[] | Annualized mean returns per regime |
| `regime_vols` | float[] | Annualized volatilities per regime |
| `regime_probs` | float[] | Posterior probability for each regime |
| `regime_labels` | string[] | Always `["Low Vol", "Medium Vol", "High Vol"]` |
| `n_regimes` | int | `3` |
| `lookback_days` | int | `120` |

### `mispricing`

| Field | Type | Description |
|---|---|---|
| `iv` | float | ATM implied volatility (annualized) |
| `hv` | float | Realized historical volatility (annualized) |
| `iv_hv_ratio` | float | `iv / hv` — >1 means options rich, <1 means cheap |
| `iv_percentile` | float \| null | IV percentile vs trailing window (may be null) |
| `keltner_position` | enum \| null | `BOTTOM` (≤25th pct of Keltner band) \| `MIDDLE` (25–75) \| `TOP` (≥75) |

### `top_contract` / `top_candidates[*]`

Both use the same shape. `top_candidates` is a dict keyed by strategy name
(`SELL_CSP`, `SELL_COVERED_CALL`, `BUY_LEAP`) with values of the same shape
or `null`.

| Field | Type | Description |
|---|---|---|
| `occ_symbol` | string | OCC contract identifier |
| `expiry` | date | Expiration date |
| `dte` | int | Days to expiry |
| `strike` | float | Strike price |
| `mid` | float | Mid-market price |
| `delta` | float | Option delta |
| `iv` | float | Contract IV |
| `pop` | float `[0, 1]` | Probability of profit (~`|delta|`) |
| `annualized_return` | float | Annualized expected return |
| `capital` | float | Cash needed per contract: `SELL_CSP → strike*100`; `BUY_LEAP → mid*100`; `SELL_COVERED_CALL → 0` (shares already held) |
| `fallback_reason` | string \| null | Set only on `SELL_COVERED_CALL` when a relaxed tier was used (see "Covered-call fallback tiers" below). `null` for strict-tier picks and for the other two strategies. |

#### Covered-call fallback tiers

`SELL_COVERED_CALL` is treated as a "must-pick" when its gate fires — selling
premium against shares you already hold beats sitting on idle theta. So when
the strict window is empty the picker walks down two relaxed tiers before
giving up:

| Tier | Window | `fallback_reason` shape |
|---|---|---|
| 1 (strict) | 21–35 DTE, \|Δ−0.30\| ≤ 0.10 | `null` |
| 2 (widened) | 14–50 DTE, \|Δ−0.30\| ≤ 0.10 | `"DTE widened to 14-50; strict 21-35 was empty"` |
| 3 (nearest-delta) | OTM (strike ≥ spot), live mid > 0, 7–60 DTE | `"nearest-delta fallback: Δ=0.31, 12 DTE"` |

`SELL_CSP` and `BUY_LEAP` have **no** fallback — they return `null` if the
strict window is empty.

### `strategy_window`

| Field | Type | Description |
|---|---|---|
| `strategy` | string \| null | Active strategy name; `null` when `verdict=HOLD` |
| `delta_target` | float \| null | Target delta for candidate selection |
| `dte_min` / `dte_max` | int \| null | Acceptable DTE window |
| `gate` | object | Gate descriptor, e.g. `{"keltner": "TOP", "iv_hv_ratio_gt": 1.3}` |
| `gate_status` | string | `"ACTIVE: <reason>"` \| `"BLOCKED: <reason>"` \| `"HOLD - no active gate"` |

### `polling_recommendation`

Hard-coded guidance baked into every response so cron consumers don't need
to read this doc:

| Field | Value |
|---|---|
| `primary` | `"Once daily at 16:30 ET (post-close, Mon-Fri)."` |
| `optional_intraday` | `"Every 60-90 min during 09:30-16:00 ET if you want IV-spike sweeps."` |
| `note` | Polling more often than every ~60 min returns mostly identical results — Keltner uses EMA-20 of closes and HV is rolling daily, so the gate updates ~once per day. |

## Verdict semantics

| Verdict | Meaning | Maps to strategy |
|---|---|---|
| `BUY` | Buy long-dated calls (LEAPs) | `BUY_LEAP` |
| `SELL_PUT` | Sell cash-secured puts | `SELL_CSP` |
| `SELL_COVERED_CALL` | Sell covered calls against held shares | `SELL_COVERED_CALL` |
| `HOLD` | No action — no gate fired |  — |

`top_contract` is populated only when **all** of:

1. `verdict` ≠ `HOLD`
2. The matching strategy block is `actionable` (its gate fired today)
3. The block has at least one ranked candidate within the DTE / delta window

Otherwise `top_contract` is `null` — but `top_candidates[<strategy>]` may
still hold a standby strike useful for "what would I do if the regime
flipped?" planning.

## Worked example — CIFR

Captured response (`asof` 2026-05-10):

```json
{
  "ticker": "CIFR",
  "asof": "2026-05-10T05:01:23.736490",
  "spot": 20.55,
  "regime": {
    "ticker": "CIFR",
    "regime": "Low Vol",
    "probability": 0.9462,
    "regime_means": [-0.6768, -1.5423, 40.4158],
    "regime_vols": [0.9553, 1.0377, 1.1549],
    "regime_probs": [0.9462, 0.051, 0.0028],
    "regime_labels": ["Low Vol", "Medium Vol", "High Vol"],
    "n_regimes": 3,
    "lookback_days": 120
  },
  "mispricing": {
    "iv": 1.0625,
    "hv": 1.0140,
    "iv_hv_ratio": 1.0478,
    "iv_percentile": null,
    "keltner_position": "TOP"
  },
  "verdict": "HOLD",
  "confluence_score": 0.6965,
  "top_contract": null,
  "top_candidates": {
    "SELL_CSP": null,
    "SELL_COVERED_CALL": {
      "occ_symbol": "CIFR260522C00023000",
      "expiry": "2026-05-22",
      "dte": 12,
      "strike": 23.0,
      "mid": 0.7,
      "delta": 0.3087,
      "iv": 1.0474,
      "pop": 0.6913,
      "annualized_return": 1.0361,
      "capital": 2055.0,
      "fallback_reason": "nearest-delta fallback: Δ=0.31, 12 DTE"
    },
    "BUY_LEAP": null
  },
  "strategy_window": {
    "strategy": null,
    "delta_target": null,
    "dte_min": null,
    "dte_max": null,
    "gate": {},
    "gate_status": "HOLD - no active gate"
  },
  "polling_recommendation": {
    "primary": "Once daily at 16:30 ET (post-close, Mon-Fri).",
    "optional_intraday": "Every 60-90 min during 09:30-16:00 ET if you want IV-spike sweeps.",
    "note": "Polling more often than every ~60 min returns mostly identical results — Keltner uses EMA-20 of closes and HV is rolling daily, so the gate updates ~once per day."
  },
  "notes": [
    "SELL_CSP: no candidates within 30-45 DTE and delta target -0.30 (±0.10).",
    "SELL_COVERED_CALL: relaxed — nearest-delta fallback: Δ=0.31, 12 DTE.",
    "BUY_LEAP: no candidates within 60-90 DTE and delta target +0.70 (±0.10)."
  ]
}
```

How to read this:

- HMM puts CIFR in **Low Vol** with 94.6% confidence.
- Options are mildly rich (`iv_hv_ratio = 1.05`) and price is at the **TOP** of
  the Keltner band, but the covered-call gate needs `iv_hv_ratio > 1.3`, so the
  gate is **BLOCKED** — verdict drops to `HOLD`.
- `top_contract` is `null` (no gate fired), but `top_candidates.SELL_COVERED_CALL`
  is populated by the **Tier-3 nearest-delta fallback** — strict 21–35 DTE was
  empty, so the picker reached down to a 12-DTE OTM call so a consumer always
  has a "what would I do if the gate fired" strike on hand. `fallback_reason`
  documents the tier used; the matching `notes` entry uses the `"relaxed —"`
  prefix.
- `SELL_CSP` and `BUY_LEAP` have no fallback path, so their `top_candidates`
  entries are `null` and `notes` use the strict-empty wording.

## Architecture

```
client → ngrok ──────────► 127.0.0.1:8001 (regime_public_proxy.py)
                                   │
                                   │  validates ticker regex,
                                   │  uppercases, forwards GET
                                   ▼
                           127.0.0.1:8000 (FastAPI backend)
                              GET /api/regime/{TICKER}
```

The proxy (`scripts/regime_public_proxy.py`) exposes only this route plus
`GET /` — every other backend endpoint (trading, portfolio, agent routes)
stays unreachable from the public tunnel. Upstream URL is configurable via
the `VEGAEDGE_UPSTREAM` environment variable (default
`http://127.0.0.1:8000`).

Run locally:

```bash
venv/bin/uvicorn scripts.regime_public_proxy:app --host 127.0.0.1 --port 8001
ngrok http 8001
```
