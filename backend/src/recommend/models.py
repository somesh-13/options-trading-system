"""Pydantic response shapes for /api/recommend/* endpoints.

The remote Claude agent consumes these as JSON; field names favor clarity
over brevity since another LLM is the reader.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


Verdict = Literal["BUY", "SELL", "HOLD"]
Strategy = Literal["SELL_CSP", "SELL_COVERED_CALL", "BUY_LEAP"]

RegimeVerdict = Literal["BUY", "SELL_PUT", "SELL_COVERED_CALL", "HOLD"]


class RankedCandidate(BaseModel):
    occ_symbol: str
    expiry: date
    dte: int
    strike: float
    bid: float
    ask: float
    mid: float
    delta: float
    theta: float
    iv: float
    max_profit: float = Field(..., description="Per contract; -1 sentinel = unbounded")
    max_loss: float = Field(..., description="Per contract; -1 sentinel = unbounded")
    breakeven: float
    pop: float = Field(..., ge=0.0, le=1.0)
    annualized_return: float
    capital: float = Field(..., description="Cash needed per contract to take the trade")
    rank_reason: str


class StrategyBlock(BaseModel):
    strategy: Strategy
    actionable: bool = Field(..., description="True if lib/channel_signals gate fired today")
    gate_reason: str
    candidates: List[RankedCandidate] = Field(default_factory=list)
    fallback_reason: Optional[str] = Field(
        None,
        description="Set when the strict DTE/delta window was empty and a relaxed tier was used (SELL_COVERED_CALL only).",
    )


class MispricingSnapshot(BaseModel):
    iv: float
    hv: float
    iv_hv_ratio: float
    iv_percentile: Optional[float] = None
    keltner_position: Optional[Literal["BOTTOM", "MIDDLE", "TOP"]] = None


class RecommendationResponse(BaseModel):
    ticker: str
    spot: float
    asof: datetime = Field(default_factory=datetime.utcnow)
    verdict: Verdict
    confluence_score: float = Field(..., ge=0.0, le=1.0)
    confluence_strategy: Optional[str] = Field(
        None,
        description="Raw recommended_strategy from ConfluenceEngine (may be None / HOLD)",
    )
    mispricing: MispricingSnapshot
    strategies: List[StrategyBlock]
    notes: List[str] = Field(default_factory=list)


class TopContract(BaseModel):
    occ_symbol: str
    expiry: date
    dte: int
    strike: float
    mid: float
    delta: float
    iv: float
    pop: float = Field(..., ge=0.0, le=1.0)
    annualized_return: float
    capital: float = Field(
        ...,
        description=(
            "Cash needed per contract: SELL_CSP -> strike*100; BUY_LEAP -> mid*100; "
            "SELL_COVERED_CALL -> 0 (shares already held)."
        ),
    )
    fallback_reason: Optional[str] = Field(
        None,
        description="Set when strict DTE/delta window was empty and a relaxed tier was used.",
    )


class StrategyWindow(BaseModel):
    """Why the verdict is what it is, plus the contract window the engine targets."""
    strategy: Optional[str] = Field(
        None, description="Active strategy name; None when verdict=HOLD"
    )
    delta_target: Optional[float] = None
    dte_min: Optional[int] = None
    dte_max: Optional[int] = None
    gate: dict = Field(
        default_factory=dict,
        description='Gate descriptor, e.g. {"keltner": "TOP", "iv_hv_ratio_gt": 1.3}',
    )
    gate_status: str = Field(
        ...,
        description=(
            'Human-readable gate state: "ACTIVE: <reason>" or "BLOCKED: <reason>" '
            'or "HOLD - no active gate".'
        ),
    )


class PollingRecommendation(BaseModel):
    """Cadence guidance, baked into the response so cron consumers don't need a doc."""
    primary: str = Field(
        "Once daily at 16:30 ET (post-close, Mon-Fri).",
        description="Authoritative regime update — daily Keltner/HV/post-close IV.",
    )
    optional_intraday: str = Field(
        "Every 60-90 min during 09:30-16:00 ET if you want IV-spike sweeps.",
        description="Catches earnings/news IV pops between the daily settlement.",
    )
    note: str = Field(
        "Polling more often than every ~60 min returns mostly identical results — "
        "Keltner uses EMA-20 of closes and HV is rolling daily, so the gate updates ~once per day."
    )


class RegimeSignalResponse(BaseModel):
    """Cron-friendly bundle: HMM regime + IV/HV + 4-way verdict + top contract +
    standby strikes for all 3 strategies + gate explainer + polling guidance."""
    ticker: str
    asof: datetime = Field(default_factory=datetime.utcnow)
    spot: float
    regime: dict = Field(..., description="Passthrough of detect_current_regime() output")
    mispricing: MispricingSnapshot
    verdict: RegimeVerdict
    confluence_score: float = Field(..., ge=0.0, le=1.0)
    top_contract: Optional[TopContract] = Field(
        None,
        description="Top-ranked contract for the chosen strategy; None when verdict=HOLD or no actionable candidate",
    )
    top_candidates: dict = Field(
        default_factory=dict,
        description=(
            "Best contract for EACH of SELL_CSP / SELL_COVERED_CALL / BUY_LEAP, regardless "
            "of verdict. Keys are strategy names, values are TopContract or null. Lets a "
            "consumer see standby strikes if regime flips."
        ),
    )
    strategy_window: Optional[StrategyWindow] = Field(
        None,
        description="DTE/delta window + gate descriptor + gate_status for the active strategy.",
    )
    polling_recommendation: PollingRecommendation = Field(
        default_factory=PollingRecommendation,
        description="Suggested cron cadence for this endpoint.",
    )
    notes: List[str] = Field(default_factory=list)
