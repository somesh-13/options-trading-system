"""Alert detectors. Each function takes the current portfolio context and
returns a list of candidate alert dicts (no DB writes — the service layer
owns persistence and dedupe).

Alert dict shape:
    {
      "ticker": str,
      "alert_type": str,         # 'high_iv' | 'cc_opportunity' | 'csp_opportunity' |
                                 # 'vol_term_spike' | 'oi_buildup' | 'premium_flow' |
                                 # 'iv_rank_spike'
      "severity": "info" | "warn" | "critical",
      "title": str,              # short headline
      "body": Optional[str],     # one-line elaboration
      "metadata": Optional[dict],
    }
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Iterable, List, Optional

log = logging.getLogger(__name__)

# Thresholds — exposed so the service layer can override per-call if you ever
# want a "stricter scan" mode. Values in plain ratio form (1.5 = IV is 1.5×
# realized HV).
HIGH_IV_RATIO_CRITICAL = 1.7
HIGH_IV_RATIO_WARN = 1.4
CC_OPPORTUNITY_MIN_RATIO = 1.3
CC_OPPORTUNITY_MIN_SHARES = 100  # one round lot — needed to write a CC
CSP_OPPORTUNITY_MIN_RATIO = 1.4

# Vol-term-spike thresholds. The signal: a binary event (almost always
# earnings) compresses dealer hedging into the front-month expiration, so
# front-month ATM IV separates from the rest of the curve.
VOL_TERM_SPIKE_RATIO_WARN = 2.0       # 2× front-vs-30d → warn
VOL_TERM_SPIKE_RATIO_CRITICAL = 3.0   # 3× → critical
VOL_TERM_FRONT_MAX_DTE = 7            # "front month" cutoff
VOL_TERM_REF_DTE_LO = 25              # 30d reference window
VOL_TERM_REF_DTE_HI = 45

# Flow detector thresholds — calibrated to be conservative on a daily-snapshot
# cadence. Real-time per-trade trackers run more aggressive thresholds because
# they see every print; we only see EOD aggregates.
OI_BUILDUP_VOL_OI_RATIO = 1.0         # today's volume ≥ yesterday's OI = mostly opens
OI_BUILDUP_MIN_VOLUME = 500           # contracts (filters out the long tail of OTM/illiquid)
OI_BUILDUP_RATIO_CRITICAL = 3.0       # vol/OI ≥ 3 → critical

PREMIUM_FLOW_MIN_DOLLARS = 1_000_000  # $1M of option premium across the chain today
PREMIUM_FLOW_VS_AVG_MULTIPLIER = 3.0  # AND ≥ 3× the trailing 5-day average

IV_RANK_SPIKE_THRESHOLD = 0.80        # ATM IV crosses 80th percentile of trailing 30d
IV_RANK_MIN_HISTORY = 14              # need ≥ 14 days before percentile is meaningful


def _classify_iv_severity(ratio: float) -> str:
    if ratio >= HIGH_IV_RATIO_CRITICAL:
        return "critical"
    if ratio >= HIGH_IV_RATIO_WARN:
        return "warn"
    return "info"


def detect_high_iv(mispricing_by_ticker: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """``mispricing_by_ticker[ticker]`` is the response from
    `data.market_data.detect_mispricing()` — at minimum it has
    ``iv_hv_ratio`` and ``signal``.
    """
    out: List[Dict[str, Any]] = []
    for ticker, m in mispricing_by_ticker.items():
        ratio = m.get("iv_hv_ratio")
        if ratio is None:
            continue
        try:
            ratio = float(ratio)
        except (TypeError, ValueError):
            continue
        if ratio < HIGH_IV_RATIO_WARN:
            continue
        sev = _classify_iv_severity(ratio)
        iv = m.get("implied_vol_atm")
        hv = m.get("historical_vol")
        out.append({
            "ticker": ticker,
            "alert_type": "high_iv",
            "severity": sev,
            "title": f"{ticker}: IV/HV {ratio:.2f}× — premium is rich",
            "body": (
                f"Implied vol {iv * 100:.0f}% vs realized {hv * 100:.0f}% — "
                f"selling premium pays well at this level."
                if iv is not None and hv is not None
                else None
            ),
            "metadata": {
                "iv_hv_ratio": round(ratio, 4),
                "iv": iv,
                "hv": hv,
                "signal": m.get("signal"),
                "spot": m.get("spot_price"),
            },
        })
    return out


def detect_cc_opportunities(
    holdings_equities: List[Dict[str, Any]],
    mispricing_by_ticker: Dict[str, Dict[str, Any]],
    existing_short_calls: Optional[Dict[str, int]] = None,
) -> List[Dict[str, Any]]:
    """Covered-call opportunities: user holds ≥100 shares AND IV/HV is rich.
    Skips tickers where the user already has a short call open against the
    underlying (``existing_short_calls[ticker] > 0``).
    """
    short_calls = existing_short_calls or {}
    # Aggregate share counts across accounts.
    shares_by_ticker: Dict[str, float] = {}
    for h in holdings_equities:
        sym = (h.get("symbol") or "").upper()
        if not sym:
            continue
        shares_by_ticker[sym] = shares_by_ticker.get(sym, 0.0) + float(h.get("quantity") or 0)

    out: List[Dict[str, Any]] = []
    for sym, shares in shares_by_ticker.items():
        if shares < CC_OPPORTUNITY_MIN_SHARES:
            continue
        if short_calls.get(sym, 0) > 0:
            continue  # already covered
        m = mispricing_by_ticker.get(sym)
        if not m:
            continue
        ratio = m.get("iv_hv_ratio")
        try:
            ratio = float(ratio) if ratio is not None else None
        except (TypeError, ValueError):
            ratio = None
        if ratio is None or ratio < CC_OPPORTUNITY_MIN_RATIO:
            continue
        contracts = int(shares // 100)
        out.append({
            "ticker": sym,
            "alert_type": "cc_opportunity",
            "severity": "warn" if ratio >= HIGH_IV_RATIO_WARN else "info",
            "title": f"{sym}: covered call opportunity — IV/HV {ratio:.2f}×",
            "body": (
                f"You hold {int(shares)} shares (~{contracts} contract{'s' if contracts != 1 else ''} "
                f"available). IV is {ratio:.2f}× realized — selling OTM calls "
                f"earns above-trend premium."
            ),
            "metadata": {
                "iv_hv_ratio": round(ratio, 4),
                "shares_held": int(shares),
                "contracts_available": contracts,
                "spot": m.get("spot_price"),
            },
        })
    return out


def detect_csp_opportunities(
    watchlist: List[str],
    holdings_equities: List[Dict[str, Any]],
    mispricing_by_ticker: Dict[str, Dict[str, Any]],
    cash_balance: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Cash-secured put opportunities on watchlist names with rich IV. Only
    surfaces when there's *some* cash on hand — the user can decide if it's
    enough to size the trade.
    """
    held = {(h.get("symbol") or "").upper() for h in holdings_equities}
    out: List[Dict[str, Any]] = []
    for sym in watchlist:
        s = sym.upper()
        m = mispricing_by_ticker.get(s)
        if not m:
            continue
        ratio = m.get("iv_hv_ratio")
        try:
            ratio = float(ratio) if ratio is not None else None
        except (TypeError, ValueError):
            ratio = None
        if ratio is None or ratio < CSP_OPPORTUNITY_MIN_RATIO:
            continue
        spot = m.get("spot_price")
        cash_ok = cash_balance is None or cash_balance > 0
        title_suffix = " (you already own shares)" if s in held else ""
        out.append({
            "ticker": s,
            "alert_type": "csp_opportunity",
            "severity": "info",
            "title": f"{s}: CSP candidate — IV/HV {ratio:.2f}×{title_suffix}",
            "body": (
                f"Implied vol is rich vs realized. Selling a 25-30Δ OTM put "
                f"collects above-trend premium; assignment leaves you long {s}"
                + (f" near spot {spot:.2f}." if spot is not None else ".")
                + ("" if cash_ok else " (no free cash detected — review buying power.)")
            ),
            "metadata": {
                "iv_hv_ratio": round(ratio, 4),
                "spot": spot,
                "already_held": s in held,
                "cash_balance": cash_balance,
            },
        })
    return out


def detect_vol_term_spike(
    universe: Iterable[str],
    get_terms: Callable[[str], List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """Flags tickers whose front-month ATM IV is >= 2x the 30-DTE ATM IV.

    The structural fingerprint of an imminent earnings binary (or other one-off
    event): dealer hedging compresses into the front, so the term structure
    breaks at the very front while the back stays at typical levels.

    ``get_terms(sym)`` should return a list of dicts with keys ``expiration``
    (YYYY-MM-DD), ``dte`` (int), and ``atm_iv`` (float or None). The service
    layer wires this to ``data.market_data.get_option_expirations_summary``.
    """
    out: List[Dict[str, Any]] = []
    for sym in universe:
        try:
            terms = get_terms(sym) or []
        except Exception as exc:
            log.warning("vol-term-spike fetch failed for %s: %s", sym, exc)
            continue
        front = next(
            (e for e in terms if 0 < (e.get("dte") or 0) <= VOL_TERM_FRONT_MAX_DTE and e.get("atm_iv")),
            None,
        )
        ref_candidates = [
            e for e in terms
            if VOL_TERM_REF_DTE_LO <= (e.get("dte") or 0) <= VOL_TERM_REF_DTE_HI and e.get("atm_iv")
        ]
        if not front or not ref_candidates:
            continue
        ref = min(ref_candidates, key=lambda e: abs((e.get("dte") or 0) - 30))
        front_iv = float(front["atm_iv"])
        ref_iv = float(ref["atm_iv"])
        if ref_iv <= 0:
            continue
        ratio = front_iv / ref_iv
        if ratio < VOL_TERM_SPIKE_RATIO_WARN:
            continue
        sev = "critical" if ratio >= VOL_TERM_SPIKE_RATIO_CRITICAL else "warn"
        out.append({
            "ticker": sym,
            "alert_type": "vol_term_spike",
            "severity": sev,
            "title": f"{sym}: front IV {ratio:.1f}x 30d — earnings event likely",
            "body": (
                f"ATM IV {front_iv * 100:.0f}% on {front['expiration']} ({front['dte']}d) "
                f"vs {ref_iv * 100:.0f}% at {ref['dte']}d. Selling front-month premium "
                f"captures the spike."
            ),
            "metadata": {
                "front_iv": round(front_iv, 4),
                "ref_iv": round(ref_iv, 4),
                "ratio": round(ratio, 4),
                "front_expiration": front["expiration"],
                "front_dte": front["dte"],
                "ref_expiration": ref["expiration"],
                "ref_dte": ref["dte"],
            },
        })
    return out


# ---------------------------------------------------------------------------
# Flow detectors — fed by the option_chain_snapshot table.
# Each takes already-loaded rows so the function stays pure and testable.
# ---------------------------------------------------------------------------


def _contract_key(c: Dict[str, Any]) -> tuple:
    """Stable key for matching today's vs yesterday's row of the same contract."""
    return (
        (c.get("expiration") or "").strip(),
        float(c.get("strike") or 0.0),
        (c.get("side") or "").lower(),
    )


def detect_oi_buildup(
    *,
    ticker: str,
    today_chain: List[Dict[str, Any]],
    prior_chain: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Flag contracts where today's volume ≥ prior-day OI — the canonical
    fingerprint of new positions opening rather than existing ones being
    rolled or closed. Returns at most one alert per ticker (the loudest
    contract); the leaderboard endpoint shows the long tail separately.
    """
    if not today_chain or not prior_chain:
        return []

    prior_oi: Dict[tuple, int] = {}
    for c in prior_chain:
        prior_oi[_contract_key(c)] = int(c.get("oi") or 0)

    best: Optional[Dict[str, Any]] = None
    best_ratio = 0.0
    for c in today_chain:
        vol = int(c.get("volume") or 0)
        if vol < OI_BUILDUP_MIN_VOLUME:
            continue
        prior = prior_oi.get(_contract_key(c), 0)
        if prior <= 0:
            # Brand-new contract today is also a buildup, but normalize against
            # vol so it doesn't always rank top.
            ratio = float(vol) / max(vol, 1)  # always 1.0
        else:
            ratio = vol / float(prior)
        if ratio < OI_BUILDUP_VOL_OI_RATIO:
            continue
        if ratio > best_ratio:
            best_ratio = ratio
            best = c

    if best is None:
        return []

    sev = "critical" if best_ratio >= OI_BUILDUP_RATIO_CRITICAL else "warn"
    side = (best.get("side") or "").lower()
    strike = float(best.get("strike") or 0.0)
    exp = best.get("expiration") or ""
    return [{
        "ticker": ticker,
        "alert_type": "oi_buildup",
        "severity": sev,
        "title": f"{ticker}: OI buildup — {side.upper()} {strike:g} {exp}",
        "body": (
            f"Today's volume {int(best.get('volume') or 0):,} vs prior OI "
            f"{prior_oi.get(_contract_key(best), 0):,} — vol/OI {best_ratio:.1f}×. "
            f"Most of today's print is new positioning, not closes."
        ),
        "metadata": {
            "expiration": exp,
            "strike": strike,
            "side": side,
            "volume": int(best.get("volume") or 0),
            "prior_oi": int(prior_oi.get(_contract_key(best), 0)),
            "vol_oi_ratio": round(best_ratio, 3),
            "iv": best.get("iv"),
            "spot": best.get("spot"),
        },
    }]


def chain_premium_dollars(chain: List[Dict[str, Any]]) -> float:
    """Sum `volume × mid × 100` across a chain. The contract multiplier (100)
    converts mid-quote to per-contract notional in dollars."""
    total = 0.0
    for c in chain:
        vol = c.get("volume") or 0
        mid = c.get("mid")
        if mid is None or vol <= 0:
            continue
        try:
            total += float(vol) * float(mid) * 100.0
        except (TypeError, ValueError):
            continue
    return total


def detect_premium_flow(
    *,
    ticker: str,
    today_chain: List[Dict[str, Any]],
    prior_chains: List[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """Flag tickers where total option premium today exceeds $1M AND is at
    least 3× the trailing 5-day mean. ``prior_chains`` is a list of prior
    daily snapshots (most-recent-first); empty list ⇒ skip the multiplier
    check (we still alert on raw $1M floor)."""
    if not today_chain:
        return []

    today_premium = chain_premium_dollars(today_chain)
    if today_premium < PREMIUM_FLOW_MIN_DOLLARS:
        return []

    prior_means: List[float] = [chain_premium_dollars(c) for c in prior_chains if c]
    avg_prior = (sum(prior_means) / len(prior_means)) if prior_means else 0.0

    if prior_means and avg_prior > 0:
        if today_premium < PREMIUM_FLOW_VS_AVG_MULTIPLIER * avg_prior:
            return []

    multiplier = (today_premium / avg_prior) if avg_prior > 0 else None
    sev = "critical" if today_premium >= 5 * PREMIUM_FLOW_MIN_DOLLARS else "warn"

    body_parts = [f"${today_premium / 1e6:.1f}M of option premium traded today"]
    if multiplier is not None:
        body_parts.append(f"({multiplier:.1f}× the trailing {len(prior_means)}-day average)")
    body_parts.append("— heavy directional flow.")

    return [{
        "ticker": ticker,
        "alert_type": "premium_flow",
        "severity": sev,
        "title": f"{ticker}: ${today_premium / 1e6:.1f}M option premium today",
        "body": " ".join(body_parts),
        "metadata": {
            "today_premium_dollars": round(today_premium, 0),
            "avg_prior_premium_dollars": round(avg_prior, 0) if avg_prior else None,
            "multiplier": round(multiplier, 2) if multiplier is not None else None,
            "prior_days_used": len(prior_means),
        },
    }]


def detect_iv_rank_spike(
    *,
    ticker: str,
    iv_history: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Flag tickers whose latest ATM IV crosses the 80th percentile of the
    trailing 30-snapshot window. ``iv_history`` is most-recent-first; the
    head (index 0) is "today" and the tail is the historical window.

    Needs ≥ ``IV_RANK_MIN_HISTORY`` snapshots; otherwise returns an empty
    list so we don't spam alerts during the warm-up period.
    """
    if not iv_history or len(iv_history) < IV_RANK_MIN_HISTORY:
        return []

    today_iv = iv_history[0].get("atm_iv")
    if today_iv is None:
        return []

    # Build the trailing series from index 1 onward.
    series = [
        float(r.get("atm_iv"))
        for r in iv_history[1:]
        if r.get("atm_iv") is not None
    ]
    if len(series) < IV_RANK_MIN_HISTORY - 1:
        return []

    sorted_series = sorted(series)
    # IV percentile = fraction of historical observations at or below today.
    below_or_equal = sum(1 for v in sorted_series if v <= today_iv)
    percentile = below_or_equal / len(sorted_series)

    if percentile < IV_RANK_SPIKE_THRESHOLD:
        return []

    sev = "critical" if percentile >= 0.95 else "warn"
    return [{
        "ticker": ticker,
        "alert_type": "iv_rank_spike",
        "severity": sev,
        "title": f"{ticker}: IV rank {percentile * 100:.0f}",
        "body": (
            f"ATM IV {today_iv * 100:.1f}% — top {(1 - percentile) * 100:.0f}% "
            f"of the trailing {len(series) + 1} snapshots. Premium is unusually "
            f"rich; consider selling structures."
        ),
        "metadata": {
            "today_iv": round(today_iv, 4),
            "iv_percentile": round(percentile, 3),
            "series_length": len(series) + 1,
            "min_iv": round(min(series), 4) if series else None,
            "max_iv": round(max(series), 4) if series else None,
        },
    }]
