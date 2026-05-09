"""Tests for the market_provider adapter.

Two layers:
1. Contract tests using a FakeProvider — verifies the public dispatch
   functions delegate correctly and the cache decorator works as designed.
2. Shape tests for YFinanceProvider — patches `yfinance.Ticker` with mocked
   pandas DataFrames and asserts the dataclass output is well-formed.

The cache decorator's stale-cache + negative-cache behavior is the most
intricate piece; it gets dedicated tests because it's the only thing that
isolates downstream callers from yfinance flakiness.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data import market_provider
from data.market_provider import (
    CompanyInfo,
    EarningsCalendar,
    FinancialStatement,
    InsiderHolder,
    InsiderTransaction,
    InstitutionalHolder,
    MarketProvider,
    NewsItem,
    OHLCBar,
    OptionChain,
    OptionContract,
    Quote,
    ShortInterestRaw,
    YFinanceProvider,
    cached_method,
    get_provider,
    set_provider,
)


# ---------------------------------------------------------------------------
# FakeProvider — confirms the Protocol is satisfiable by something other than
# YFinanceProvider, and lets us exercise the dispatch layer without yfinance.
# ---------------------------------------------------------------------------

class FakeProvider:
    def __init__(self):
        self.calls: List[str] = []

    def get_quote(self, symbol: str) -> Quote:
        self.calls.append(f"get_quote:{symbol}")
        return Quote(
            symbol=symbol.upper(), price=100.0, change=1.0, change_percent=1.0,
            open=99.0, high=101.0, low=98.0, previous_close=99.0,
            volume=1_000_000, last_updated="2026-05-09",
        )

    def get_history(self, symbol, *, period=None, interval="1d", start=None, end=None):
        self.calls.append(f"get_history:{symbol}:{period}:{interval}")
        return [OHLCBar(date=date(2026, 5, 8), open=99, high=101, low=98, close=100, volume=1_000_000)]

    def get_company_info(self, symbol):
        self.calls.append(f"get_company_info:{symbol}")
        return CompanyInfo(symbol=symbol.upper(), long_name="Acme", short_name="ACME",
                           sector=None, industry=None, market_cap=1e9, trailing_pe=15.0,
                           forward_pe=14.0, beta=1.1, dividend_yield=0.02, shares_outstanding=1e7,
                           held_pct_institutions=0.6, held_pct_insiders=0.05, total_revenue=5e8,
                           operating_margins=0.2, profit_margins=0.15, revenue_growth=0.05,
                           total_debt=1e8, total_cash=2e8, ebitda=1.5e8, target_mean_price=120.0,
                           quote_type="EQUITY", currency="USD", raw={})

    def get_option_expirations(self, symbol): return ["2026-06-19", "2026-07-17"]
    def get_option_chain(self, symbol, expiration):
        return OptionChain(symbol=symbol.upper(), expiration=expiration, calls=[], puts=[])
    def get_income_statement(self, symbol, *, quarterly=False):
        return FinancialStatement(symbol=symbol.upper(), quarterly=quarterly, periods=[], rows={})
    def get_balance_sheet(self, symbol, *, quarterly=False):
        return FinancialStatement(symbol=symbol.upper(), quarterly=quarterly, periods=[], rows={})
    def get_cash_flow(self, symbol, *, quarterly=False):
        return FinancialStatement(symbol=symbol.upper(), quarterly=quarterly, periods=[], rows={})
    def get_earnings_calendar(self, symbol):
        return EarningsCalendar(symbol=symbol.upper(), next_earnings_date=None,
                                earnings_estimate=None, revenue_estimate=None)
    def get_news(self, symbol, limit=20): return []
    def get_institutional_holders(self, symbol): return []
    def get_insider_holders(self, symbol): return []
    def get_insider_transactions(self, symbol): return []
    def get_etf_profile(self, symbol):
        from data.market_provider import EtfProfile
        return EtfProfile(symbol=symbol.upper(), long_name=None, quote_type="ETF",
                          currency="USD", nav_price=None, expense_ratio=None,
                          total_assets=None, top_holdings=[], sector_weights={})
    def get_short_interest_raw(self, symbol):
        return ShortInterestRaw(shares_short=None, short_ratio=None,
                                short_percent_of_float=None, short_percent_outstanding=None,
                                shares_short_prior_month=None, date_short_interest=None,
                                shares_outstanding=None)
    def get_fx_spot(self, pair): return 7.25


@pytest.fixture
def fake_provider():
    """Swap the active provider for a FakeProvider; restore after the test."""
    original = get_provider()
    fake = FakeProvider()
    set_provider(fake)
    try:
        yield fake
    finally:
        set_provider(original)


# ---------------------------------------------------------------------------
# Dispatch + Protocol contract
# ---------------------------------------------------------------------------

def test_protocol_satisfied_by_fakeprovider(fake_provider):
    p: MarketProvider = fake_provider  # static-typed assignment compiles
    assert p.get_quote("aapl").symbol == "AAPL"


def test_module_dispatch_calls_active_provider(fake_provider):
    market_provider.get_quote("aapl")
    market_provider.get_history("aapl", period="1mo")
    market_provider.get_company_info("aapl")
    assert fake_provider.calls == [
        "get_quote:aapl",
        "get_history:aapl:1mo:1d",
        "get_company_info:aapl",
    ]


def test_set_provider_round_trip():
    original = get_provider()
    fake = FakeProvider()
    set_provider(fake)
    assert get_provider() is fake
    set_provider(original)
    assert get_provider() is original


# ---------------------------------------------------------------------------
# Cache decorator behavior
# ---------------------------------------------------------------------------

def test_cached_method_positive_cache_returns_same_value():
    calls = {"n": 0}

    class Box:
        @cached_method(ttl=10)
        def fetch(self, x):
            calls["n"] += 1
            return x * 2

    b = Box()
    assert b.fetch(5) == 10
    assert b.fetch(5) == 10
    assert calls["n"] == 1, "second call should hit cache"


def test_cached_method_stale_fallback_serves_old_value_on_failure():
    calls = {"n": 0}

    class Box:
        @cached_method(ttl=0.01, stale_after=10)
        def fetch(self, x):
            calls["n"] += 1
            if calls["n"] == 1:
                return x * 2
            raise RuntimeError("upstream down")

        # expose for clearing
        def reset(self): self.fetch._cache.clear(); self.fetch._negative_cache.clear()  # type: ignore

    b = Box()
    assert b.fetch(5) == 10
    import time as _time
    _time.sleep(0.02)  # exceed positive TTL
    # second call: upstream raises, but stale fallback kicks in
    assert b.fetch(5) == 10
    assert calls["n"] == 2


def test_cached_method_does_not_cache_empty_results():
    """Empty results (yfinance hiccups returning empty DataFrames) must not
    pin a transient failure into the cache — next call should retry upstream."""
    calls = {"n": 0}

    class Box:
        @cached_method(ttl=10)
        def fetch(self, x):
            calls["n"] += 1
            # First call returns empty (transient failure simulation),
            # second call returns real data.
            return [] if calls["n"] == 1 else [1, 2, 3]

    b = Box()
    assert b.fetch("AAPL") == []
    assert b.fetch("AAPL") == [1, 2, 3]
    assert calls["n"] == 2, "empty result should not have been cached"
    # Now a real result is cached — third call hits cache.
    assert b.fetch("AAPL") == [1, 2, 3]
    assert calls["n"] == 2


def test_cached_method_negative_cache_short_circuits():
    calls = {"n": 0}

    class Box:
        @cached_method(ttl=10, negative_ttl=10)
        def fetch(self, x):
            calls["n"] += 1
            raise RuntimeError("bad ticker")

    b = Box()
    with pytest.raises(RuntimeError):
        b.fetch("ZZZ")
    # second call should NOT invoke upstream — negative cache fires.
    with pytest.raises(ValueError, match="negative-cached"):
        b.fetch("ZZZ")
    assert calls["n"] == 1


# ---------------------------------------------------------------------------
# YFinanceProvider shape tests (mocked yfinance.Ticker)
# ---------------------------------------------------------------------------

def _hist_df(rows):
    """Build a yfinance-shaped history DataFrame (DatetimeIndex + OHLCV cols)."""
    df = pd.DataFrame(rows, columns=["Open", "High", "Low", "Close", "Volume"])
    df.index = pd.to_datetime([r["date"] for r in rows] if isinstance(rows[0], dict) and "date" in rows[0]
                              else pd.date_range("2026-05-01", periods=len(rows), freq="D"))
    return df


def test_yfinance_provider_get_quote_shape():
    fake_hist = pd.DataFrame(
        {"Open": [99, 100], "High": [101, 102], "Low": [98, 99], "Close": [100, 101], "Volume": [1_000_000, 1_100_000]},
        index=pd.to_datetime(["2026-05-08", "2026-05-09"]),
    )
    fake_ticker = MagicMock()
    fake_ticker.history.return_value = fake_hist
    fake_ticker.info = {"longName": "Acme Corp"}

    with patch("data.market_provider.yf.Ticker", return_value=fake_ticker):
        # Use a fresh provider so the class-level cache is empty.
        prov = YFinanceProvider()
        q = prov.get_quote("aapl")

    assert isinstance(q, Quote)
    assert q.symbol == "AAPL"
    assert q.price == 101.0
    assert q.change == 1.0
    assert q.change_percent == 1.0  # 1/100 * 100
    assert q.volume == 1_100_000
    assert q.previous_close == 100.0


def test_yfinance_provider_get_history_returns_ohlcbar_list():
    fake_hist = pd.DataFrame(
        {"Open": [10, 11], "High": [12, 13], "Low": [9, 10], "Close": [11, 12], "Volume": [100, 200]},
        index=pd.to_datetime(["2026-05-08", "2026-05-09"]),
    )
    fake_ticker = MagicMock()
    fake_ticker.history.return_value = fake_hist

    with patch("data.market_provider.yf.Ticker", return_value=fake_ticker):
        bars = YFinanceProvider().get_history("AAPL", period="5d")

    assert len(bars) == 2
    assert all(isinstance(b, OHLCBar) for b in bars)
    assert bars[0].close == 11.0
    assert bars[1].close == 12.0


def test_yfinance_provider_get_history_returns_empty_on_empty_df():
    fake_ticker = MagicMock()
    fake_ticker.history.return_value = pd.DataFrame()

    with patch("data.market_provider.yf.Ticker", return_value=fake_ticker):
        bars = YFinanceProvider().get_history("ZZZZ", period="5d")

    assert bars == []


def test_yfinance_provider_get_company_info_handles_missing_fields():
    fake_ticker = MagicMock()
    fake_ticker.info = {"longName": "Acme", "marketCap": 1e9}

    with patch("data.market_provider.yf.Ticker", return_value=fake_ticker):
        info = YFinanceProvider().get_company_info("AAPL")

    assert info.long_name == "Acme"
    assert info.market_cap == 1e9
    assert info.beta is None  # not provided → None, not 0
    assert info.trailing_pe is None


def test_yfinance_provider_get_company_info_tolerates_info_exception():
    fake_ticker = MagicMock()
    type(fake_ticker).info = property(lambda self: (_ for _ in ()).throw(RuntimeError("rate limited")))

    with patch("data.market_provider.yf.Ticker", return_value=fake_ticker):
        info = YFinanceProvider().get_company_info("AAPL")

    assert info.long_name is None
    assert info.market_cap is None


def test_yfinance_provider_get_quote_rejects_zero_close():
    fake_hist = pd.DataFrame(
        {"Open": [99], "High": [101], "Low": [98], "Close": [0.0], "Volume": [1_000_000]},
        index=pd.to_datetime(["2026-05-09"]),
    )
    fake_ticker = MagicMock()
    fake_ticker.history.return_value = fake_hist
    fake_ticker.info = {}

    with patch("data.market_provider.yf.Ticker", return_value=fake_ticker):
        with pytest.raises(ValueError, match="invalid Close"):
            YFinanceProvider().get_quote("BAD")


def test_yfinance_provider_get_option_expirations():
    fake_ticker = MagicMock()
    fake_ticker.options = ("2026-06-19", "2026-07-17")

    with patch("data.market_provider.yf.Ticker", return_value=fake_ticker):
        exps = YFinanceProvider().get_option_expirations("AAPL")

    assert exps == ["2026-06-19", "2026-07-17"]
