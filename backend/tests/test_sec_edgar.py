"""
Offline tests for the SEC EDGAR companyfacts extractor.

Uses a trimmed fixture (RDW, CIK 0001819810) committed under
tests/fixtures/sec/. No network access required.
"""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

# Make backend/src importable when pytest is launched from backend/.
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from data import sec_edgar  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "sec" / "CIK0001819810.json"


@pytest.fixture
def patched_sec(monkeypatch):
    """Stub out SEC HTTP calls and the ticker→CIK map so tests run offline."""
    monkeypatch.setattr(
        sec_edgar,
        "_load_ticker_cik_map",
        lambda: {"RDW": "0001819810", "AAPL": "0000320193"},
    )

    payload = json.loads(FIXTURE.read_text())

    def fake_fetch(cik: str):
        if cik == "0001819810":
            return payload
        return None

    monkeypatch.setattr(sec_edgar, "fetch_company_facts", fake_fetch)
    # Reset cached map so the patched lookup is hit.
    sec_edgar._TICKER_CIK_MAP = None
    yield


def test_get_cik_unknown_ticker_returns_none(patched_sec):
    assert sec_edgar.get_cik_for_ticker("ZZZZZ") is None


def test_get_cik_padded_to_10_digits(patched_sec):
    cik = sec_edgar.get_cik_for_ticker("RDW")
    assert cik == "0001819810"
    assert len(cik) == 10


def test_extract_returns_none_for_foreign_filer(patched_sec, monkeypatch):
    # Override fetch to return None (simulates 404 / non-filer).
    monkeypatch.setattr(sec_edgar, "fetch_company_facts", lambda _cik: None)
    monkeypatch.setattr(sec_edgar, "_load_ticker_cik_map", lambda: {})
    sec_edgar._TICKER_CIK_MAP = None
    assert sec_edgar.extract_sec_fundamentals("TSM") is None


def test_extract_rdw_shares_matches_latest_10k(patched_sec):
    """RDW's most recent 10-K (FY 2025) reports ~191.97M shares outstanding."""
    out = sec_edgar.extract_sec_fundamentals("RDW")
    assert out is not None
    shares = out["sharesOutstanding"]
    assert shares is not None, "expected a shares value from dei:EntityCommonStockSharesOutstanding"
    # Loose bound — allows the fixture to be regenerated against future filings.
    assert 150e6 < shares < 250e6, f"shares={shares}"


def test_extract_rdw_total_debt_from_lt_components(patched_sec):
    """LongTermDebtNoncurrent + LongTermDebtCurrent should sum cleanly."""
    out = sec_edgar.extract_sec_fundamentals("RDW")
    assert out is not None
    total_debt = out["totalDebt"]
    assert total_debt is not None and total_debt > 0
    # Per RDW's FY-2025 10-K: 80.0M + 5.2M ≈ 85M.
    assert 50e6 < total_debt < 250e6, f"totalDebt={total_debt}"


def test_extract_rdw_revenue_ttm_positive(patched_sec):
    out = sec_edgar.extract_sec_fundamentals("RDW")
    assert out is not None
    assert out["revenue"] is not None and out["revenue"] > 0
    # TTM revenue should be in the hundreds of millions for RDW.
    assert 100e6 < out["revenue"] < 1e9


def test_extract_rdw_revenue_history_has_multiple_years(patched_sec):
    out = sec_edgar.extract_sec_fundamentals("RDW")
    assert out is not None
    history = out.get("revenueHistory") or []
    assert len(history) >= 2
    # Sorted oldest → newest.
    years = [row["year"] for row in history]
    assert years == sorted(years)
    # Every entry must have a positive revenue figure.
    for row in history:
        assert row["revenue"] > 0


def test_extract_rdw_net_debt_is_consistent(patched_sec):
    """netDebt should equal totalDebt - totalCash when both are present."""
    out = sec_edgar.extract_sec_fundamentals("RDW")
    assert out is not None
    total_debt = out["totalDebt"]
    total_cash = out["totalCash"] or 0.0
    expected = total_debt - total_cash
    assert abs(out["netDebt"] - expected) < 1.0


def test_extract_rdw_as_of_filing_is_iso_date(patched_sec):
    out = sec_edgar.extract_sec_fundamentals("RDW")
    assert out is not None
    as_of = out["asOfFiling"]
    assert as_of is not None
    # Format: YYYY-MM-DD
    assert len(as_of) == 10 and as_of[4] == "-" and as_of[7] == "-"


def test_extract_rdw_operating_margin_is_decimal(patched_sec):
    """operatingMargin should be a small decimal, not a percent."""
    out = sec_edgar.extract_sec_fundamentals("RDW")
    assert out is not None
    om = out["operatingMargin"]
    assert om is not None
    # RDW is loss-making — expect strongly negative, but bounded.
    assert -2.0 < om < 0.0
