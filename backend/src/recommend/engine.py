"""build_recommendation — assemble the full per-ticker recommendation.

Pulls the ConfluenceEngine verdict, fetches one Alpaca chain snapshot, runs
the strike ranker for SELL_CSP / SELL_COVERED_CALL / BUY_LEAP, and returns
a single RecommendationResponse the remote Claude agent can reason over.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from agents.service import get_service
from data.hmm_regime import detect_current_regime
from execution.alpaca_client import get_options_chain_snapshot
from vegaedge.trade_rec import STRATEGY_TABLE, StrategySpec, _normalize_snapshot

from recommend.models import (
    MispricingSnapshot,
    RankedCandidate,
    RecommendationResponse,
    RegimeSignalResponse,
    RegimeVerdict,
    StrategyBlock,
    StrategyWindow,
    TopContract,
    Verdict,
)
from recommend.ranking import rank_candidates, rank_covered_call_with_fallback

log = logging.getLogger(__name__)


async def build_recommendation(ticker: str) -> RecommendationResponse:
    ticker = ticker.upper().strip()
    if not ticker:
        raise ValueError("ticker is required")

    confluence = await get_service().analyze(ticker)

    spot, iv, hv, iv_hv, keltner = _extract_context(confluence.agent_signals)
    notes: List[str] = []

    call_contracts, call_note = await _fetch_chain(ticker, "call")
    put_contracts, put_note = await _fetch_chain(ticker, "put")
    if call_note:
        notes.append(call_note)
    if put_note:
        notes.append(put_note)

    contracts_by_type = {"call": call_contracts, "put": put_contracts}

    strategy_blocks: List[StrategyBlock] = []
    for name in ("SELL_CSP", "SELL_COVERED_CALL", "BUY_LEAP"):
        spec = STRATEGY_TABLE[name]
        actionable, gate_reason = _gate(name, iv_hv, keltner)
        if name == "SELL_COVERED_CALL":
            candidates, fallback_reason = rank_covered_call_with_fallback(
                contracts_by_type[spec.option_type], spec, spot,
            )
        else:
            candidates = rank_candidates(contracts_by_type[spec.option_type], spec, spot)
            fallback_reason = None
        if not candidates:
            if name == "SELL_COVERED_CALL" and fallback_reason:
                notes.append(f"SELL_COVERED_CALL: {fallback_reason}.")
            else:
                notes.append(
                    f"{name}: no candidates within {spec.dte_min}-{spec.dte_max} DTE "
                    f"and delta target {spec.delta_target:+.2f} (±0.10)."
                )
        elif fallback_reason:
            notes.append(f"SELL_COVERED_CALL: relaxed — {fallback_reason}.")
        strategy_blocks.append(
            StrategyBlock(
                strategy=name,
                actionable=actionable,
                gate_reason=gate_reason,
                candidates=candidates,
                fallback_reason=fallback_reason,
            )
        )

    verdict = _verdict_from_strategy(confluence.recommended_strategy)

    return RecommendationResponse(
        ticker=ticker,
        spot=spot,
        asof=datetime.utcnow(),
        verdict=verdict,
        confluence_score=float(confluence.confluence_score),
        confluence_strategy=confluence.recommended_strategy,
        mispricing=MispricingSnapshot(
            iv=iv,
            hv=hv,
            iv_hv_ratio=iv_hv,
            iv_percentile=None,
            keltner_position=keltner,
        ),
        strategies=strategy_blocks,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _extract_context(signals) -> Tuple[float, float, float, float, Optional[str]]:
    """Pull spot, IV, HV, IV/HV ratio, and Keltner position out of the agent
    metadata that ConfluenceEngine has already populated. Avoids re-fetching
    the same data via yfinance.
    """
    by_id = {s.agent_id: s for s in signals}
    vol = by_id.get("volatility")
    tech = by_id.get("technical")

    if vol is None or vol.signal_type == "ERROR":
        raise ValueError("volatility agent did not produce a signal — cannot recommend")

    md = vol.metadata
    spot = float(md.get("spot_price", 0.0))
    iv = float(md.get("implied_vol_atm", 0.0))
    hv = float(md.get("historical_vol", 0.0))
    iv_hv = float(md.get("iv_hv_ratio", 0.0))
    keltner = None
    if tech is not None and tech.signal_type != "ERROR":
        keltner = tech.metadata.get("keltner_position")

    return spot, iv, hv, iv_hv, keltner


async def _fetch_chain(ticker: str, option_type: str) -> Tuple[List[dict], Optional[str]]:
    """Fetch + normalize one option-type slice of the chain. Returns
    (contracts, note) where note is set if the fetch failed or returned empty.
    """
    try:
        snapshot = await asyncio.to_thread(
            get_options_chain_snapshot, ticker, None, option_type
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("chain fetch failed for %s %s", ticker, option_type)
        return [], f"Chain fetch error ({option_type}s): {exc}"

    if "error" in snapshot:
        return [], f"Alpaca {option_type} chain unavailable: {snapshot['error']}"

    contracts = _normalize_snapshot(snapshot)
    if not contracts:
        return [], f"No {option_type} contracts returned by Alpaca for {ticker}"
    return contracts, None


def _gate(strategy: str, iv_hv: float, keltner: Optional[str]) -> Tuple[bool, str]:
    """Mirror ConfluenceEngine._recommend_strategy thresholds (0.8 / 1.3)
    so the actionable flag is consistent with the verdict.
    """
    if strategy == "SELL_CSP":
        if keltner != "BOTTOM":
            return False, f"Need Keltner=BOTTOM, have {keltner}"
        if iv_hv <= 1.3:
            return False, f"Need IV/HV > 1.3, have {iv_hv:.2f}"
        return True, f"Keltner BOTTOM + IV/HV={iv_hv:.2f} (rich)"

    if strategy == "SELL_COVERED_CALL":
        if keltner != "TOP":
            return False, f"Need Keltner=TOP, have {keltner}"
        if iv_hv <= 1.3:
            return False, f"Need IV/HV > 1.3, have {iv_hv:.2f}"
        return True, f"Keltner TOP + IV/HV={iv_hv:.2f} (rich)"

    if strategy == "BUY_LEAP":
        if iv_hv >= 0.8:
            return False, f"Need IV/HV < 0.8, have {iv_hv:.2f}"
        return True, f"IV/HV={iv_hv:.2f} (cheap)"

    return False, f"Unknown strategy {strategy}"


def _verdict_from_strategy(recommended: Optional[str]) -> Verdict:
    """ConfluenceEngine returns SELL_CSP / SELL_COVERED_CALL / BUY_LEAP / HOLD,
    or None when score < threshold. Map to the 3-way verdict the user asked for.
    """
    if recommended == "BUY_LEAP":
        return "BUY"
    if recommended in {"SELL_CSP", "SELL_COVERED_CALL"}:
        return "SELL"
    return "HOLD"


# ---------------------------------------------------------------------------
# Regime signal — cron-facing bundle
# ---------------------------------------------------------------------------


_VERDICT_TO_STRATEGY = {
    "BUY": "BUY_LEAP",
    "SELL_PUT": "SELL_CSP",
    "SELL_COVERED_CALL": "SELL_COVERED_CALL",
}


def _regime_verdict_from_strategy(recommended: Optional[str]) -> RegimeVerdict:
    """4-way refinement of _verdict_from_strategy that keeps CSP and covered
    call distinct so a cron consumer can route the action without re-reading
    a second field.
    """
    if recommended == "BUY_LEAP":
        return "BUY"
    if recommended == "SELL_CSP":
        return "SELL_PUT"
    if recommended == "SELL_COVERED_CALL":
        return "SELL_COVERED_CALL"
    return "HOLD"


_GATE_DESCRIPTORS = {
    "SELL_CSP":          {"keltner": "BOTTOM", "iv_hv_ratio_gt": 1.3},
    "SELL_COVERED_CALL": {"keltner": "TOP",    "iv_hv_ratio_gt": 1.3},
    "BUY_LEAP":          {"iv_hv_ratio_lt": 0.8},
}


def _candidate_to_top(c: RankedCandidate, fallback_reason: Optional[str] = None) -> TopContract:
    return TopContract(
        occ_symbol=c.occ_symbol,
        expiry=c.expiry,
        dte=c.dte,
        strike=c.strike,
        mid=c.mid,
        delta=c.delta,
        iv=c.iv,
        pop=c.pop,
        annualized_return=c.annualized_return,
        capital=c.capital,
        fallback_reason=fallback_reason,
    )


def _pick_top_contract(
    verdict: RegimeVerdict,
    strategies: List[StrategyBlock],
) -> Optional[TopContract]:
    if verdict == "HOLD":
        return None
    target = _VERDICT_TO_STRATEGY.get(verdict)
    if target is None:
        return None
    block = next((b for b in strategies if b.strategy == target), None)
    if block is None or not block.actionable or not block.candidates:
        return None
    return _candidate_to_top(block.candidates[0], block.fallback_reason)


def _build_top_candidates(strategies: List[StrategyBlock]) -> dict:
    """Best contract for each strategy regardless of verdict — surfaces
    standby strikes a cron consumer can route to if regime flips.
    """
    out: dict = {"SELL_CSP": None, "SELL_COVERED_CALL": None, "BUY_LEAP": None}
    for block in strategies:
        if block.candidates:
            out[block.strategy] = _candidate_to_top(
                block.candidates[0], block.fallback_reason
            ).model_dump(mode="json")
    return out


def _build_strategy_window(
    verdict: RegimeVerdict,
    iv_hv: float,
    keltner: Optional[str],
) -> StrategyWindow:
    target = _VERDICT_TO_STRATEGY.get(verdict)
    if target is None:
        return StrategyWindow(
            strategy=None,
            delta_target=None,
            dte_min=None,
            dte_max=None,
            gate={},
            gate_status="HOLD - no active gate",
        )
    spec = STRATEGY_TABLE[target]
    actionable, reason = _gate(target, iv_hv, keltner)
    status = ("ACTIVE: " if actionable else "BLOCKED: ") + reason
    return StrategyWindow(
        strategy=target,
        delta_target=spec.delta_target,
        dte_min=spec.dte_min,
        dte_max=spec.dte_max,
        gate=_GATE_DESCRIPTORS.get(target, {}),
        gate_status=status,
    )


async def build_regime_signal(ticker: str) -> RegimeSignalResponse:
    """One-shot bundle of HMM regime + IV/HV mispricing + 4-way verdict +
    top-ranked contract. Reuses build_recommendation() for ConfluenceEngine
    + chain ranking; only the HMM call is added on top.
    """
    ticker = ticker.upper().strip()
    if not ticker:
        raise ValueError("ticker is required")

    rec = await build_recommendation(ticker)
    regime = await asyncio.to_thread(detect_current_regime, ticker)
    verdict = _regime_verdict_from_strategy(rec.confluence_strategy)
    top = _pick_top_contract(verdict, rec.strategies)
    top_candidates = _build_top_candidates(rec.strategies)
    strategy_window = _build_strategy_window(
        verdict,
        rec.mispricing.iv_hv_ratio,
        rec.mispricing.keltner_position,
    )

    return RegimeSignalResponse(
        ticker=rec.ticker,
        asof=rec.asof,
        spot=rec.spot,
        regime=regime,
        mispricing=rec.mispricing,
        verdict=verdict,
        confluence_score=rec.confluence_score,
        top_contract=top,
        top_candidates=top_candidates,
        strategy_window=strategy_window,
        notes=rec.notes,
    )
