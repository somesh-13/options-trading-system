"""P6 tests — replay engine math, strategy resolution, aggregation."""

import math
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND_SRC = Path(__file__).resolve().parent.parent / "src"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))


def _fake_ohlcv(days: int = 200, seed: int = 7) -> pd.DataFrame:
    """Build a deterministic OHLCV frame with mild drift + volatility."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(end=pd.Timestamp.today(), periods=days, freq="B")
    rets = rng.normal(loc=0.0005, scale=0.02, size=days)
    price = 100 * np.exp(np.cumsum(rets))
    return pd.DataFrame(
        {"Open": price, "High": price * 1.01, "Low": price * 0.99, "Close": price, "Volume": 1_000_000},
        index=idx,
    )


def test_keltner_position_boundaries():
    from replay.engine import ReplayEngine

    assert ReplayEngine._keltner_position(100, 100, 120) == "BOTTOM"   # at lower band
    assert ReplayEngine._keltner_position(110, 100, 120) == "MIDDLE"
    assert ReplayEngine._keltner_position(120, 100, 120) == "TOP"
    assert ReplayEngine._keltner_position(100, 100, 100) == "MIDDLE"  # degenerate bands


def test_bs_premium_sanity():
    from replay.engine import ReplayEngine

    call = ReplayEngine._bs_premium(100, 100, 30 / 365, 0.25, "call")
    put = ReplayEngine._bs_premium(100, 100, 30 / 365, 0.25, "put")
    # ATM option premium should be positive and roughly equal for call/put at-the-money.
    assert call > 0
    assert put > 0
    assert abs(call - put) < 1.0


def test_resolve_trade_payoffs():
    from replay.engine import ReplayEngine

    eng = ReplayEngine()
    csp = {"strategy": "SELL_CSP", "strike": 100, "entry_price": 105, "premium": 2.0}
    assert eng._resolve_trade(csp, final_price=110) == pytest.approx(2.0 * 100)
    assert eng._resolve_trade(csp, final_price=95) == pytest.approx((2.0 - 5.0) * 100)

    leap = {"strategy": "BUY_LEAP", "strike": 100, "entry_price": 95, "premium": 3.0}
    assert eng._resolve_trade(leap, final_price=115) == pytest.approx((15 - 3) * 100)
    assert eng._resolve_trade(leap, final_price=90) == pytest.approx(-3.0 * 100)


def test_run_returns_metrics_shape(monkeypatch):
    from replay import engine as replay_mod

    # Monkey-patch the yfinance fetch so we don't hit the network.
    monkeypatch.setattr(replay_mod.ReplayEngine, "_fetch_ohlcv", lambda self, ticker, start, end: _fake_ohlcv())

    eng = replay_mod.ReplayEngine()
    result = eng.run("NVDA", date.today() - timedelta(days=100), date.today())
    assert result.ticker == "NVDA"
    assert isinstance(result.timeline, list)
    assert len(result.timeline) > 0
    metrics = result.metrics
    assert "total_pnl" in metrics
    assert "by_confluence_bucket" in metrics
    assert set(metrics["by_confluence_bucket"].keys()) == {"low", "mid", "high"}
    # Coaching always falls back to a string, even without Gemini credentials.
    assert isinstance(result.coaching, str) and len(result.coaching) > 0
