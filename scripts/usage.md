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
| `notes` | string[] | Warnings / context (e.g. "no candidates within DTE window") |

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

Captured response (`asof` 2026-04-26):

```json
{
  "ticker": "CIFR",
  "spot": 18.20,
  "regime": {
    "regime": "Low Vol",
    "probability": 0.9999,
    "regime_probs": [0.9999, 0.0001, 0.0001],
    "regime_labels": ["Low Vol", "Medium Vol", "High Vol"],
    "n_regimes": 3,
    "lookback_days": 120
  },
  "mispricing": {
    "iv": 1.176,
    "hv": 0.937,
    "iv_hv_ratio": 1.255,
    "iv_percentile": null,
    "keltner_position": "MIDDLE"
  },
  "verdict": "HOLD",
  "confluence_score": 0.6501,
  "top_contract": null,
  "top_candidates": {
    "SELL_CSP": null,
    "SELL_COVERED_CALL": null,
    "BUY_LEAP": null
  },
  "strategy_window": {
    "strategy": null,
    "gate": {},
    "gate_status": "HOLD - no active gate"
  },
  "notes": [
    "SELL_CSP: no candidates within 30-45 DTE and delta target -0.30 (±0.10).",
    "SELL_COVERED_CALL: no candidates within 21-35 DTE and delta target +0.30 (±0.10).",
    "BUY_LEAP: no candidates within 60-90 DTE and delta target +0.70 (±0.10)."
  ]
}
```

How to read this:

- HMM is 99.99% confident CIFR is in **Low Vol** — the calmest of the three states.
- Options are rich (`iv_hv_ratio = 1.26`) but price sits in the middle of the
  Keltner band, so neither the "sell premium at the top" nor the "buy leaps
  at the bottom" gate fires.
- Verdict is `HOLD`, so `top_contract` and every `top_candidates` entry are
  `null`. The `notes` explain the candidate-selection misses (the chain just
  didn't have contracts inside the target DTE/delta windows today).

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
