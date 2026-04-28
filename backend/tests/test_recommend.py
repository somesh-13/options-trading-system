"""Smoke tests for the recommend package.

Exercises the ranker + response model without hitting the network. The end-
to-end engine path is not tested here because it requires the full agent
stack + Alpaca; that's covered by manual verification in the plan.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from recommend.models import (
    MispricingSnapshot,
    RecommendationResponse,
    StrategyBlock,
)
from recommend.ranking import rank_candidates
from recommend.webhook import DEFAULT_WATCHLIST, load_webhook_config
from vegaedge.trade_rec import STRATEGY_TABLE, _normalize_snapshot


def _fake_put_chain():
    """Three CIFR put strikes, ~35 DTE — one inside the -0.30 band, one
    outside the band on each side."""
    today = datetime.utcnow().date()
    exp = today + timedelta(days=35)
    yymmdd = exp.strftime("%y%m%d")
    return {
        "snapshots": {
            f"CIFR{yymmdd}P00004000": {
                "latestQuote": {"bp": 0.18, "ap": 0.22},
                "greeks": {"delta": -0.28, "theta": -0.01},
                "impliedVolatility": 0.85,
            },
            f"CIFR{yymmdd}P00003500": {
                "latestQuote": {"bp": 0.06, "ap": 0.10},
                "greeks": {"delta": -0.12, "theta": -0.005},
                "impliedVolatility": 0.80,
            },
            f"CIFR{yymmdd}P00005000": {
                "latestQuote": {"bp": 0.60, "ap": 0.70},
                "greeks": {"delta": -0.55, "theta": -0.02},
                "impliedVolatility": 0.95,
            },
        }
    }


def test_ranker_filters_by_delta_band_and_dte():
    contracts = _normalize_snapshot(_fake_put_chain())
    spec = STRATEGY_TABLE["SELL_CSP"]
    ranked = rank_candidates(contracts, spec, spot=4.21, delta_band=0.10, top_n=3)

    assert len(ranked) == 1, "only the -0.28 delta strike should pass the band filter"
    cand = ranked[0]
    assert cand.delta == pytest.approx(-0.28)
    assert cand.dte == 35
    assert cand.annualized_return > 0
    assert "annualized" in cand.rank_reason


def test_response_round_trips_through_model_dump():
    contracts = _normalize_snapshot(_fake_put_chain())
    ranked = rank_candidates(
        contracts, STRATEGY_TABLE["SELL_CSP"], spot=4.21, delta_band=0.10
    )

    resp = RecommendationResponse(
        ticker="CIFR",
        spot=4.21,
        verdict="SELL",
        confluence_score=0.74,
        confluence_strategy="SELL_CSP",
        mispricing=MispricingSnapshot(
            iv=0.85, hv=0.61, iv_hv_ratio=1.39, keltner_position="BOTTOM"
        ),
        strategies=[
            StrategyBlock(
                strategy="SELL_CSP",
                actionable=True,
                gate_reason="Keltner BOTTOM + IV/HV=1.39",
                candidates=ranked,
            )
        ],
        notes=[],
    )

    dumped = resp.model_dump(mode="json")
    assert dumped["verdict"] == "SELL"
    assert dumped["mispricing"]["keltner_position"] == "BOTTOM"
    assert len(dumped["strategies"][0]["candidates"]) == 1
    # `expiry` and `asof` must be JSON-serializable strings (date / datetime)
    assert isinstance(dumped["asof"], str)
    assert isinstance(dumped["strategies"][0]["candidates"][0]["expiry"], str)


def test_webhook_config_unset_returns_none(monkeypatch):
    monkeypatch.delenv("REMOTE_AGENT_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("REMOTE_AGENT_WEBHOOK_TOKEN", raising=False)
    assert load_webhook_config() is None


def test_webhook_config_loads_from_env(monkeypatch):
    monkeypatch.setenv("REMOTE_AGENT_WEBHOOK_URL", "http://localhost:9999/recv")
    monkeypatch.setenv("REMOTE_AGENT_WEBHOOK_TOKEN", "test-secret")
    cfg = load_webhook_config()
    assert cfg is not None
    assert cfg.remote_url == "http://localhost:9999/recv"
    assert cfg.bearer_token == "test-secret"
    assert cfg.only_actionable is True
    assert cfg.watchlist == DEFAULT_WATCHLIST


def test_webhook_only_actionable_can_be_disabled(monkeypatch):
    monkeypatch.setenv("REMOTE_AGENT_WEBHOOK_URL", "http://localhost:9999/recv")
    monkeypatch.setenv("REMOTE_AGENT_WEBHOOK_TOKEN", "test-secret")
    monkeypatch.setenv("REMOTE_AGENT_ONLY_ACTIONABLE", "false")
    cfg = load_webhook_config()
    assert cfg is not None
    assert cfg.only_actionable is False
