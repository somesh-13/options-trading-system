"""P2 unit tests for strike selection + risk-metric math.

These run without hitting Alpaca — the Alpaca snapshot is mocked.
"""

from datetime import date, timedelta

import pytest

from vegaedge.trade_rec import (
    STRATEGY_TABLE,
    compute_risk_metrics,
    select_strike,
    _normalize_snapshot,
)


def _chain_snapshot(today: date) -> dict:
    """Fake Alpaca snapshot with calls and puts at several deltas + DTEs."""

    def occ(expiry: date, cp: str, strike: float) -> str:
        return (
            f"NVDA{expiry.strftime('%y%m%d')}{cp}{int(round(strike * 1000)):08d}"
        )

    dte30 = today + timedelta(days=30)
    dte75 = today + timedelta(days=75)

    def snap(cp: str, strike: float, delta: float, mid: float) -> tuple:
        expiry = dte30 if cp == "P" else dte75 if delta > 0.5 else dte30
        sym = occ(expiry, cp, strike)
        return sym, {
            "latestQuote": {"bp": mid - 0.05, "ap": mid + 0.05},
            "greeks": {"delta": delta, "theta": -0.03},
            "impliedVolatility": 0.45,
        }

    entries = [
        snap("P", 850, -0.20, 3.0),
        snap("P", 870, -0.30, 4.20),
        snap("P", 880, -0.40, 5.5),
        snap("C", 1000, 0.70, 25.0),  # LEAP target
        snap("C", 1050, 0.55, 18.0),
        snap("C", 920, 0.30, 6.8),    # CC target (30 DTE)
    ]
    return {"snapshots": dict(entries)}


def test_normalize_and_select_sell_csp():
    today = date(2026, 4, 13)
    contracts = _normalize_snapshot(_chain_snapshot(today))
    pick = select_strike(contracts, STRATEGY_TABLE["SELL_CSP"], today=today)
    assert pick is not None
    assert pick["option_type"] == "put"
    assert pick["strike"] == 870  # delta -0.30 is closest to -0.30 target


def test_select_buy_leap():
    today = date(2026, 4, 13)
    contracts = _normalize_snapshot(_chain_snapshot(today))
    pick = select_strike(contracts, STRATEGY_TABLE["BUY_LEAP"], today=today)
    assert pick is not None
    assert pick["option_type"] == "call"
    assert pick["strike"] == 1000


def test_select_sell_covered_call():
    today = date(2026, 4, 13)
    contracts = _normalize_snapshot(_chain_snapshot(today))
    pick = select_strike(contracts, STRATEGY_TABLE["SELL_COVERED_CALL"], today=today)
    assert pick is not None
    assert pick["strike"] == 920  # +0.30 delta, 30 DTE inside 21-35 window


def test_no_candidates_returns_none():
    today = date(2026, 4, 13)
    pick = select_strike([], STRATEGY_TABLE["BUY_LEAP"], today=today)
    assert pick is None


def test_risk_metrics_sell_csp():
    today = date(2026, 4, 13)
    contract = {
        "strike": 100.0,
        "mid": 2.50,
        "delta": -0.30,
        "expiry": today + timedelta(days=30),
    }
    m = compute_risk_metrics("SELL_CSP", contract, spot=105.0, today=today)
    assert m["max_profit"] == pytest.approx(250.0)       # $2.50 × 100
    assert m["max_loss"] == pytest.approx((100 - 2.5) * 100)
    assert m["breakeven"] == pytest.approx(97.5)
    assert m["pop"] == pytest.approx(0.70)               # 1 - |delta|
    assert m["dte"] == 30
    # Annualized return: (2.50 / (100 - 2.5)) * (365/30)
    expected = (2.5 / (100 - 2.5)) * (365 / 30)
    assert m["annualized_return"] == pytest.approx(round(expected, 4))


def test_risk_metrics_buy_leap_capped_loss():
    today = date(2026, 4, 13)
    contract = {
        "strike": 100.0,
        "mid": 5.0,
        "delta": 0.70,
        "expiry": today + timedelta(days=75),
    }
    m = compute_risk_metrics("BUY_LEAP", contract, spot=95.0, today=today)
    assert m["max_loss"] == pytest.approx(500.0)  # premium paid × 100
    assert m["breakeven"] == pytest.approx(105.0)
    assert m["pop"] == pytest.approx(0.70)
    assert m["max_profit"] == float("inf")


def test_risk_metrics_sell_covered_call():
    today = date(2026, 4, 13)
    contract = {
        "strike": 110.0,
        "mid": 2.0,
        "delta": 0.30,
        "expiry": today + timedelta(days=30),
    }
    m = compute_risk_metrics("SELL_COVERED_CALL", contract, spot=105.0, today=today)
    # Upside capped: (strike - spot + premium) × 100 = (110 - 105 + 2) × 100 = 700
    assert m["max_profit"] == pytest.approx(700.0)
    assert m["breakeven"] == pytest.approx(103.0)  # spot - premium
    assert m["pop"] == pytest.approx(0.70)


def test_unknown_strategy_rejected():
    today = date(2026, 4, 13)
    contract = {"strike": 100, "mid": 1, "delta": 0, "expiry": today + timedelta(days=10)}
    with pytest.raises(ValueError):
        compute_risk_metrics("SPREADING_BUTTERFLY", contract, spot=100, today=today)
