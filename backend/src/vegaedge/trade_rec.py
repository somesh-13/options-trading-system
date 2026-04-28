"""P2 — Trade Recommendation Tool.

Given a ticker and (optionally) a strategy override, runs the ConfluenceEngine
to pick a strategy, fetches the live options chain from Alpaca, selects a
strike by delta target within a DTE window, computes full risk metrics, and
returns a typed ``TradeRecommendation`` the voice agent can speak naturally.

Strike selection rules (roadmap §4.2)::

    SELL_CSP            -0.30 delta   30-45 DTE (puts)
    BUY_LEAP            +0.70 delta   60-90 DTE (calls)
    SELL_COVERED_CALL   +0.30 delta   21-35 DTE (calls)
"""

from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from execution.alpaca_client import get_options_chain_snapshot

# ---------------------------------------------------------------------------
# Strategy table
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StrategySpec:
    strategy: str
    option_type: str  # "call" | "put"
    delta_target: float
    dte_min: int
    dte_max: int


STRATEGY_TABLE: Dict[str, StrategySpec] = {
    "SELL_CSP": StrategySpec("SELL_CSP", "put", -0.30, 30, 45),
    "BUY_LEAP": StrategySpec("BUY_LEAP", "call", 0.70, 60, 90),
    "SELL_COVERED_CALL": StrategySpec("SELL_COVERED_CALL", "call", 0.30, 21, 35),
}


# ---------------------------------------------------------------------------
# Pydantic output
# ---------------------------------------------------------------------------


class TradeRecommendation(BaseModel):
    ticker: str
    strategy: str = Field(..., description="SELL_CSP | BUY_LEAP | SELL_COVERED_CALL")
    expiry: date
    strike: float
    bid: float
    ask: float
    mid: float
    delta: float
    theta: float
    iv: float
    max_profit: float
    max_loss: float
    breakeven: float
    pop: float = Field(..., ge=0.0, le=1.0, description="Probability of profit (≈ |delta|)")
    annualized_return: float = Field(..., description="Return annualized from DTE")
    confluence_score: float = Field(..., ge=0.0, le=1.0)
    reasoning: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    occ_symbol: Optional[str] = None


# ---------------------------------------------------------------------------
# Chain normalization
# ---------------------------------------------------------------------------


_OCC_RE = re.compile(r"^(?P<root>[A-Z.]+)(?P<yy>\d{2})(?P<mm>\d{2})(?P<dd>\d{2})(?P<cp>[CP])(?P<strike>\d{8})$")


def _parse_occ(symbol: str) -> Optional[dict]:
    m = _OCC_RE.match(symbol.strip())
    if not m:
        return None
    expiry = date(2000 + int(m["yy"]), int(m["mm"]), int(m["dd"]))
    strike = int(m["strike"]) / 1000.0
    return {
        "root": m["root"],
        "expiry": expiry,
        "option_type": "call" if m["cp"] == "C" else "put",
        "strike": strike,
    }


def _normalize_snapshot(snapshot: Dict[str, Any]) -> List[dict]:
    """Flatten Alpaca's ``{"snapshots": {OCC: {...}}}`` into a list of contracts."""
    out: List[dict] = []
    raw = snapshot.get("snapshots") or {}
    for symbol, data in raw.items():
        parsed = _parse_occ(symbol)
        if parsed is None:
            continue
        quote = data.get("latestQuote") or {}
        greeks = data.get("greeks") or {}
        iv = data.get("impliedVolatility")
        bid = float(quote.get("bp", 0) or 0)
        ask = float(quote.get("ap", 0) or 0)
        mid = (bid + ask) / 2.0 if bid and ask else float(quote.get("ap") or quote.get("bp") or 0)
        out.append(
            {
                "symbol": symbol,
                **parsed,
                "bid": bid,
                "ask": ask,
                "mid": mid,
                "delta": float(greeks.get("delta", 0) or 0),
                "theta": float(greeks.get("theta", 0) or 0),
                "iv": float(iv or 0),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def _within_window(expiry: date, dte_min: int, dte_max: int, today: Optional[date] = None) -> bool:
    today = today or datetime.utcnow().date()
    dte = (expiry - today).days
    return dte_min <= dte <= dte_max


def select_strike(
    contracts: List[dict],
    spec: StrategySpec,
    today: Optional[date] = None,
) -> Optional[dict]:
    """Pick the contract whose delta is closest to the spec's target within the DTE window."""
    candidates = [
        c
        for c in contracts
        if c["option_type"] == spec.option_type and _within_window(c["expiry"], spec.dte_min, spec.dte_max, today)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda c: abs(c["delta"] - spec.delta_target))


# ---------------------------------------------------------------------------
# Risk metrics
# ---------------------------------------------------------------------------


def compute_risk_metrics(
    strategy: str,
    contract: dict,
    spot: float,
    today: Optional[date] = None,
) -> Dict[str, float]:
    """Compute max_profit, max_loss, breakeven, POP, annualized_return.

    Formulas are the standard textbook payoffs for short puts (CSP), long calls
    (LEAP), and short calls (CC). LEAP max_loss defaults to premium paid
    (long call exposure is capped at debit).
    """
    strike = float(contract["strike"])
    mid = float(contract["mid"])
    delta = float(contract["delta"])
    expiry: date = contract["expiry"]
    dte = (expiry - (today or datetime.utcnow().date())).days
    dte = max(dte, 1)

    if strategy == "SELL_CSP":
        max_profit = mid * 100
        max_loss = (strike - mid) * 100  # if stock goes to $0
        breakeven = strike - mid
        pop = min(1.0, max(0.0, 1.0 - abs(delta)))
        capital = (strike - mid) * 100
    elif strategy == "BUY_LEAP":
        max_profit = float("inf")
        max_loss = mid * 100
        breakeven = strike + mid
        pop = min(1.0, max(0.0, abs(delta)))
        capital = mid * 100
    elif strategy == "SELL_COVERED_CALL":
        # Premium captured; upside capped at strike - spot + premium per share
        max_profit = (max(strike - spot, 0) + mid) * 100
        max_loss = float("inf")  # unlimited on naked call; capped when covered — caller hedges
        breakeven = spot - mid
        pop = min(1.0, max(0.0, 1.0 - abs(delta)))
        capital = spot * 100  # cost of the 100 shares covering the call
    else:
        raise ValueError(f"Unsupported strategy: {strategy}")

    # Annualized return: premium / capital scaled to a year
    if capital > 0 and math.isfinite(max_profit):
        period_return = (mid * 100) / capital
        annualized = period_return * (365.0 / dte)
    else:
        annualized = 0.0

    return {
        "max_profit": max_profit,
        "max_loss": max_loss,
        "breakeven": round(breakeven, 2),
        "pop": round(pop, 4),
        "annualized_return": round(annualized, 4),
        "capital": round(capital, 2),
        "dte": dte,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def get_trade_recommendation(
    ticker: str,
    strategy_override: Optional[str] = None,
) -> TradeRecommendation:
    """Main P2 entry — returns a full TradeRecommendation for the voice agent."""
    from agents.service import get_service  # local import to avoid circular at module import

    ticker = ticker.upper().strip()
    svc = get_service()
    confluence = await svc.analyze(ticker)

    strategy = strategy_override or confluence.recommended_strategy or "HOLD"
    if strategy == "HOLD" or strategy not in STRATEGY_TABLE:
        raise ValueError(
            f"No tradable strategy for {ticker} "
            f"(confluence={confluence.confluence_score:.2f}, strategy={strategy})"
        )

    spec = STRATEGY_TABLE[strategy]
    snapshot = await asyncio.to_thread(
        get_options_chain_snapshot,
        ticker,
        None,  # expiration_date — we filter locally by DTE window
        spec.option_type,
    )
    if "error" in snapshot:
        raise RuntimeError(f"Alpaca chain fetch failed: {snapshot['error']}")

    contracts = _normalize_snapshot(snapshot)
    contract = select_strike(contracts, spec)
    if contract is None:
        raise RuntimeError(
            f"No {spec.option_type} contracts in {spec.dte_min}-{spec.dte_max} DTE window for {ticker}"
        )

    # Pull spot from the volatility agent's signal (already in the confluence result).
    vol_sig = next((s for s in confluence.agent_signals if s.agent_id == "volatility"), None)
    spot = float(vol_sig.metadata.get("spot_price", 0.0)) if vol_sig else 0.0

    metrics = compute_risk_metrics(strategy, contract, spot)

    return TradeRecommendation(
        ticker=ticker,
        strategy=strategy,
        expiry=contract["expiry"],
        strike=float(contract["strike"]),
        bid=float(contract["bid"]),
        ask=float(contract["ask"]),
        mid=float(contract["mid"]),
        delta=float(contract["delta"]),
        theta=float(contract["theta"]),
        iv=float(contract["iv"]),
        max_profit=float(metrics["max_profit"]) if math.isfinite(metrics["max_profit"]) else -1.0,
        max_loss=float(metrics["max_loss"]) if math.isfinite(metrics["max_loss"]) else -1.0,
        breakeven=float(metrics["breakeven"]),
        pop=float(metrics["pop"]),
        annualized_return=float(metrics["annualized_return"]),
        confluence_score=float(confluence.confluence_score),
        reasoning=_format_reasoning(ticker, strategy, contract, metrics, confluence.confluence_score),
        occ_symbol=contract["symbol"],
    )


def _format_reasoning(
    ticker: str,
    strategy: str,
    contract: dict,
    metrics: Dict[str, float],
    score: float,
) -> str:
    return (
        f"For {ticker}, I recommend {strategy.replace('_', ' ').lower()} at the "
        f"${contract['strike']:.2f} strike expiring {contract['expiry'].strftime('%b %-d')} "
        f"for ${contract['mid']:.2f} premium. That's a "
        f"{metrics['annualized_return'] * 100:.1f}% annualized return in "
        f"{metrics['dte']} days with a {metrics['pop'] * 100:.0f}% probability of profit, "
        f"based on a {score:.2f} confluence score."
    )
