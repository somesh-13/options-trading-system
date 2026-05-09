"""EarningsAgent — days-to-earnings + expected move + IV-crush flag.

Pulls upcoming earnings date from yfinance (free); estimates expected move
from ATM straddle IV; flags IV crush risk when earnings are within 7 days.
"""

from __future__ import annotations

import asyncio
import math
from datetime import datetime
from typing import Optional

from agents.base import AgentSignal, AnalysisContext, BaseAgent
from data.market_data import detect_mispricing
from data.market_provider import get_earnings_calendar


class EarningsAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            agent_id="earnings",
            name="EarningsAgent",
            domain="Earnings calendar",
            weight=0.15,
        )

    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        payload = await asyncio.to_thread(self._compute, ticker)

        dte = payload["days_to_earnings"]
        crush_risk = payload["iv_crush_risk"]
        confidence = 0.85 if crush_risk else (0.65 if dte is not None and dte <= 21 else 0.45)

        if dte is None:
            phase = "NO_UPCOMING_DATE"
        elif dte <= 7:
            phase = "IMMINENT"
        elif dte <= 21:
            phase = "NEAR"
        else:
            phase = "FAR"

        reasoning = (
            f"Earnings phase={phase}; dte={dte}; "
            f"expected move ±{payload['expected_move_pct']:.1f}%; "
            f"IV crush risk={'YES' if crush_risk else 'no'}."
        )

        return self._signal(
            ticker=ticker,
            signal_type="EARNINGS_WINDOW",
            confidence=confidence,
            reasoning=reasoning,
            data_sources=["yfinance.calendar", "market_data.detect_mispricing"],
            metadata={
                "days_to_earnings": dte,
                "expected_move_pct": payload["expected_move_pct"],
                "iv_crush_risk": crush_risk,
                "phase": phase,
            },
        )

    @staticmethod
    def _compute(ticker: str) -> dict:
        dte = EarningsAgent._days_to_earnings(ticker)
        mis = detect_mispricing(ticker)

        iv = float(mis["implied_vol_atm"])
        spot = float(mis["spot_price"])
        strike = float(mis["atm_strike"])
        atm_price = float(mis["atm_call_price"])

        # Straddle-based expected move: 2 * ATM call price / spot (heuristic).
        # Falls back to IV * sqrt(dte/365) when dte is available.
        if dte is not None and dte > 0:
            t = max(dte, 1) / 365.0
            expected_move_pct = iv * math.sqrt(t) * 100.0
        else:
            expected_move_pct = (2.0 * atm_price / spot) * 100.0 if spot > 0 else 0.0

        crush_risk = (dte is not None) and (dte <= 7) and iv > 0.4

        return {
            "days_to_earnings": dte,
            "expected_move_pct": round(expected_move_pct, 2),
            "iv_crush_risk": bool(crush_risk),
            "strike": strike,
        }

    @staticmethod
    def _days_to_earnings(ticker: str) -> Optional[int]:
        try:
            cal = get_earnings_calendar(ticker)
        except Exception:
            return None
        if cal.next_earnings_date is None:
            return None
        delta = (cal.next_earnings_date - datetime.utcnow().date()).days
        return int(delta) if delta >= 0 else None
