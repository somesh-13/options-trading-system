"""Notification service — runs detectors against the current Robinhood book
and persists deduped alerts.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from . import database as db
from . import detectors

log = logging.getLogger(__name__)


def _gather_mispricing(tickers: List[str]) -> Dict[str, Dict[str, Any]]:
    """Bulk-fetch IV/HV mispricing for a list of tickers via the existing helper.

    `data.market_data.detect_mispricing` is the canonical source — same
    function the /scanner endpoints already use.
    """
    from data.market_data import detect_mispricing  # type: ignore

    out: Dict[str, Dict[str, Any]] = {}
    for sym in tickers:
        try:
            res = detect_mispricing(sym)
            if isinstance(res, dict):
                out[sym.upper()] = res
        except Exception as exc:
            log.warning("mispricing fetch failed for %s: %s", sym, exc)
    return out


def _gather_book(account: str = "all") -> Dict[str, Any]:
    """Pull the live Robinhood book — equity holdings, options, cash."""
    from robinhood.portfolio import (  # type: ignore
        compute_live_holdings,
        compute_live_options,
        compute_live_summary,
    )

    equities_raw = compute_live_holdings(account)
    options_raw = compute_live_options(account)
    summary = compute_live_summary(equities_raw, options_raw, account)

    equities = [{"symbol": e.symbol, "quantity": e.quantity} for e in equities_raw]
    short_calls: Dict[str, int] = {}
    for o in options_raw:
        if (o.side or "").lower().startswith("call") and (o.position or "").lower() == "short":
            sym = o.underlying.upper()
            short_calls[sym] = short_calls.get(sym, 0) + int(o.quantity or 0)

    return {
        "equities": equities,
        "short_calls": short_calls,
        "cash_balance": getattr(summary, "cash_balance", None),
        "tickers": sorted({e["symbol"] for e in equities}),
    }


def scan_now(account: str = "all") -> Dict[str, Any]:
    """Run every detector once. Persist new alerts (deduped per
    ``(ticker, alert_type)``); return a per-detector breakdown of how many
    candidates were generated and how many were inserted vs deduped.
    """
    db.init_db()

    book = _gather_book(account)
    universe = book["tickers"]
    if not universe:
        return {
            "scanned_tickers": 0,
            "candidates": 0,
            "inserted": 0,
            "deduped": 0,
            "by_detector": {},
            "message": "No live Robinhood holdings — nothing to scan.",
        }

    misp = _gather_mispricing(universe)

    candidates: List[Dict[str, Any]] = []
    by_detector: Dict[str, int] = {}

    high_iv = detectors.detect_high_iv(misp)
    by_detector["high_iv"] = len(high_iv)
    candidates.extend(high_iv)

    cc = detectors.detect_cc_opportunities(
        holdings_equities=book["equities"],
        mispricing_by_ticker=misp,
        existing_short_calls=book["short_calls"],
    )
    by_detector["cc_opportunity"] = len(cc)
    candidates.extend(cc)

    # CSP scan uses the same universe as the watchlist; this can be replaced
    # later with a dedicated user-defined watchlist.
    csp = detectors.detect_csp_opportunities(
        watchlist=universe,
        holdings_equities=book["equities"],
        mispricing_by_ticker=misp,
        cash_balance=book["cash_balance"],
    )
    by_detector["csp_opportunity"] = len(csp)
    candidates.extend(csp)

    # Vol-term-spike: front-month ATM IV >= 2x 30-DTE ATM IV. The structural
    # fingerprint of an imminent earnings binary. yfinance is the source.
    from data.market_data import get_option_expirations_summary

    def _terms(sym: str) -> List[Dict[str, Any]]:
        res = get_option_expirations_summary(sym) or {}
        return res.get("expirations") or []

    spike = detectors.detect_vol_term_spike(universe, _terms)
    by_detector["vol_term_spike"] = len(spike)
    candidates.extend(spike)

    inserted = 0
    deduped = 0
    for c in candidates:
        if db.has_active(c["ticker"], c["alert_type"]):
            deduped += 1
            continue
        db.insert(
            ticker=c["ticker"],
            alert_type=c["alert_type"],
            title=c["title"],
            body=c.get("body"),
            severity=c.get("severity", "info"),
            metadata=c.get("metadata"),
        )
        inserted += 1

    return {
        "scanned_tickers": len(universe),
        "candidates": len(candidates),
        "inserted": inserted,
        "deduped": deduped,
        "by_detector": by_detector,
    }


def list_active() -> List[Dict[str, Any]]:
    return db.list_active()


def dismiss(notification_id: int) -> bool:
    return db.dismiss(notification_id)


def dismiss_all() -> int:
    return db.dismiss_all()
