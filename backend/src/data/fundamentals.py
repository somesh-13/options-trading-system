"""
Accurate ticker fundamentals for the DCF valuation page.

`yf.Ticker().info` is fast but noisy — its `operatingMargins` can be off by
100x for crypto miners, and `sharesOutstanding` occasionally lags issuances.
This module pulls the full income statement / cashflow / balance-sheet DataFrames
and derives each DCF input from the underlying line items, falling back to
`.info` only when the statements don't carry a value.

Returns a single flat dict per ticker suitable for direct consumption by the
Next.js DCF component.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .sec_edgar import extract_sec_fundamentals
from .market_provider import (
    get_balance_sheet,
    get_cash_flow,
    get_company_info,
    get_history,
    get_income_statement,
    statement_to_dataframe,
)

log = logging.getLogger(__name__)

# Candidate row names (yfinance sometimes renames between tickers). First hit wins.
_REVENUE_ROWS = ["Total Revenue", "Operating Revenue"]
_OPINC_ROWS = ["Operating Income", "Total Operating Income As Reported", "EBIT"]
_TAX_ROWS = ["Tax Provision", "Income Tax Expense"]
_PRETAX_ROWS = ["Pretax Income", "Income Before Tax"]
_CAPEX_ROWS = ["Capital Expenditure", "Capital Expenditures"]
_FCF_ROWS = ["Free Cash Flow"]
_NETDEBT_ROWS = ["Net Debt"]
_TOTALDEBT_ROWS = ["Total Debt"]
_CASH_ROWS = ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"]
_SHARES_ROWS = ["Ordinary Shares Number", "Share Issued"]

# Simple 10-minute in-memory cache. yfinance statements calls are ~2s; the DCF
# page happily hits this endpoint on every tab open.
_CACHE_TTL_SEC = 600
_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def _coerce_float(info: Dict[str, Any], key: str) -> Optional[float]:
    """Pull a key from `info` and return it as a finite float, else None."""
    raw = info.get(key)
    if raw is None:
        return None
    try:
        fv = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(fv):
        return None
    return fv


def _first_row(df: pd.DataFrame, names: List[str]) -> Optional[pd.Series]:
    if df is None or df.empty:
        return None
    for name in names:
        if name in df.index:
            row = df.loc[name]
            # Some tickers duplicate rows; drop NaNs and keep non-null slices.
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            return row
    return None


def _latest_value(row: Optional[pd.Series]) -> Optional[float]:
    if row is None:
        return None
    # Columns are Timestamps; most recent first if we sort descending.
    sorted_row = row.sort_index(ascending=False)
    for v in sorted_row.tolist():
        if v is None:
            continue
        try:
            fv = float(v)
            if math.isfinite(fv):
                return fv
        except (TypeError, ValueError):
            continue
    return None


def _history_series(row: Optional[pd.Series]) -> List[Tuple[str, float]]:
    """Return oldest→newest list of (year, value) pairs, filtering NaNs."""
    if row is None:
        return []
    series = row.sort_index(ascending=True)
    out: List[Tuple[str, float]] = []
    for col, val in series.items():
        try:
            fv = float(val)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(fv):
            continue
        year = col.strftime("%Y") if hasattr(col, "strftime") else str(col)[:4]
        out.append((year, fv))
    return out


def _cagr(pairs: List[Tuple[str, float]]) -> Optional[float]:
    """CAGR between oldest and newest non-zero points. Returns decimal (0.15 = 15%)."""
    clean = [(y, v) for y, v in pairs if v > 0]
    if len(clean) < 2:
        return None
    first_year, first_val = clean[0]
    last_year, last_val = clean[-1]
    try:
        span = max(1, int(last_year) - int(first_year))
    except ValueError:
        span = len(clean) - 1
    if span <= 0 or first_val <= 0:
        return None
    return (last_val / first_val) ** (1 / span) - 1


def _safe_tax_rate(tax: Optional[pd.Series], pretax: Optional[pd.Series]) -> Optional[float]:
    if tax is None or pretax is None:
        return None
    tax_sorted = tax.sort_index(ascending=False)
    pretax_sorted = pretax.sort_index(ascending=False)
    for i in range(min(len(tax_sorted), len(pretax_sorted))):
        try:
            t = float(tax_sorted.iloc[i])
            p = float(pretax_sorted.iloc[i])
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(t) and math.isfinite(p)):
            continue
        if p <= 0:
            # Negative pretax means the company had a loss; effective tax is noisy.
            continue
        return max(0.0, min(0.40, t / p))
    return None


def _roll_to_ttm_with_8k(
    *,
    ticker: str,
    yf_revenue_annual: Optional[float],
    yf_op_income_annual: Optional[float],
    yf_op_margin_annual: Optional[float],
    sources: Dict[str, str],
) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[Dict[str, Any]]]:
    """Roll DCF inputs forward to TTM when an 8-K reports a fresher quarter.

    yfinance's annual ``income_stmt`` lags by 1-12 months — when a Q1 8-K
    has been filed, ``revenue`` returned here is still last fiscal year's
    number. The Financials tab already prepends the 8-K's quarter onto the
    quarterly history; here we sum the most-recent four quarters to get a
    TTM with the new period included, and use that for the DCF inputs.

    Returns ``(revenue, op_income, op_margin, latest_quarter_reported)``
    where the first three are USD-absolute (matching the existing schema)
    and ``latest_quarter_reported`` is a small provenance dict the UI can
    show, or ``None`` if no rollup was applied.

    Conservative: only overrides when (1) an 8-K newer than yfinance's
    annual exists, (2) all four trailing quarters resolve to non-null
    revenue, and (3) the resulting TTM is sensibly larger (≥80%) than
    yfinance's annual. Mismatched units / parser hiccups should fail this
    check rather than write a wrong DCF input.
    """
    try:
        from .earnings_extract import get_latest_earnings_release  # local import — avoids cycle
    except Exception:
        return yf_revenue_annual, yf_op_income_annual, yf_op_margin_annual, None
    extract = get_latest_earnings_release(ticker)
    if not extract or not extract.get("period_end"):
        return yf_revenue_annual, yf_op_income_annual, yf_op_margin_annual, None

    # Quarterly history with the 8-K column prepended (cached internally).
    try:
        quarterly = get_income_statement_history(ticker, periods=5, quarterly=True)
    except Exception:
        return yf_revenue_annual, yf_op_income_annual, yf_op_margin_annual, None
    if (quarterly.get("years_source") or [""])[0] not in ("8-K", "6-K"):
        # No fresh-quarter prepend → yfinance is the latest; nothing to roll.
        return yf_revenue_annual, yf_op_income_annual, yf_op_margin_annual, None

    by_key = {r["key"]: r for r in (quarterly.get("rows") or [])}
    rev_row = by_key.get("total_revenues")
    op_row = by_key.get("operating_profit")
    if not rev_row or len(rev_row.get("values") or []) < 4:
        return yf_revenue_annual, yf_op_income_annual, yf_op_margin_annual, None

    # Sum the four most recent quarters. If any of those is missing, abort —
    # a partial sum would understate revenue and silently corrupt the DCF.
    rev_q4 = rev_row["values"][:4]
    if any(v is None for v in rev_q4):
        return yf_revenue_annual, yf_op_income_annual, yf_op_margin_annual, None
    ttm_revenue_M = float(sum(rev_q4))

    op_q4 = (op_row.get("values") or [])[:4] if op_row else []
    ttm_op_income_M: Optional[float] = None
    if op_q4 and not any(v is None for v in op_q4):
        ttm_op_income_M = float(sum(op_q4))

    # quarterly history is in $M — convert to absolute to match the existing
    # schema (yfinance's `revenue` is in absolute dollars).
    ttm_revenue_abs = ttm_revenue_M * 1_000_000
    ttm_op_income_abs = ttm_op_income_M * 1_000_000 if ttm_op_income_M is not None else None

    # Sanity gate: TTM should be at least 80% of yfinance's annual. A wildly
    # smaller number means the unit-detection or 8-K extraction misfired.
    if yf_revenue_annual and ttm_revenue_abs < 0.8 * yf_revenue_annual:
        log.warning(
            "8-K TTM rollup rejected for %s: TTM $%.0fM vs annual $%.0fM",
            ticker, ttm_revenue_abs / 1e6, yf_revenue_annual / 1e6,
        )
        return yf_revenue_annual, yf_op_income_annual, yf_op_margin_annual, None

    # Override DCF inputs and update sources.
    sources["revenue"] = "sec_edgar_8k_ttm"
    new_op_margin = yf_op_margin_annual
    if ttm_op_income_abs is not None and ttm_revenue_abs > 0:
        new_op_margin = ttm_op_income_abs / ttm_revenue_abs
        sources["operatingIncome"] = "sec_edgar_8k_ttm"
        sources["operatingMargin"] = "sec_edgar_8k_ttm"

    latest_quarter_reported = {
        "period_end": extract.get("period_end"),
        "fiscal_period": extract.get("fiscal_period"),
        "filing_form": extract.get("filing_form"),
        "filing_date": extract.get("filing_date"),
        "accession": extract.get("accession"),
        "source": extract.get("source"),
        "ttm_revenue_M": round(ttm_revenue_M, 2),
        "ttm_operating_income_M": round(ttm_op_income_M, 2) if ttm_op_income_M is not None else None,
    }

    return (
        ttm_revenue_abs,
        ttm_op_income_abs if ttm_op_income_abs is not None else yf_op_income_annual,
        new_op_margin,
        latest_quarter_reported,
    )


def get_ticker_fundamentals(ticker: str) -> Dict[str, Any]:
    """
    Deep fundamentals extraction for the DCF page. Returns:
      {
        ticker, name, currentPrice, currency,
        revenue, revenueHistory, revenueCagr, revenueGrowth1y,
        operatingIncome, operatingMargin,
        taxRate,
        capex, freeCashFlow,
        totalDebt, totalCash, netDebt,
        sharesOutstanding, marketCap,
        beta,
        sources,   # which path supplied each field
        asOf,
      }
    """
    key = ticker.upper()
    now = time.time()
    cached = _cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return cached[1]

    sources: Dict[str, str] = {}

    # SEC EDGAR is authoritative for the load-bearing DCF inputs (shares, debt,
    # cash, revenue, capex). The market provider is the fallback and the source
    # for enrichment fields SEC doesn't expose (analyst targets, P/E, beta).
    sec_data: Dict[str, Any] = {}
    try:
        sec_data = extract_sec_fundamentals(key) or {}
    except Exception as exc:
        log.warning("SEC EDGAR lookup failed for %s: %s", key, exc)
        sec_data = {}

    def _pick(field: str, yf_val: Optional[float], yf_label: str) -> Optional[float]:
        """Prefer SEC-provided value when finite, else provider. Records source."""
        sec_val = sec_data.get(field)
        if sec_val is not None:
            try:
                fv = float(sec_val)
                if math.isfinite(fv):
                    sources[field] = "sec_edgar"
                    return fv
            except (TypeError, ValueError):
                pass
        if yf_val is not None:
            sources[field] = yf_label
        return yf_val

    try:
        info: Dict[str, Any] = get_company_info(key).raw or {}
    except Exception:
        info = {}

    try:
        income = statement_to_dataframe(get_income_statement(key))
    except Exception:
        income = pd.DataFrame()
    try:
        cashflow = statement_to_dataframe(get_cash_flow(key))
    except Exception:
        cashflow = pd.DataFrame()
    try:
        balance = statement_to_dataframe(get_balance_sheet(key))
    except Exception:
        balance = pd.DataFrame()

    # Revenue — yfinance income_stmt is the fallback path; SEC TTM is preferred.
    rev_row = _first_row(income, _REVENUE_ROWS)
    yf_revenue = _latest_value(rev_row)
    yf_revenue_label = "income_stmt"
    if yf_revenue is None and info.get("totalRevenue") is not None:
        yf_revenue = float(info["totalRevenue"])
        yf_revenue_label = "info"
    revenue = _pick("revenue", yf_revenue, yf_revenue_label)

    # Revenue history — prefer SEC annual 10-K series when ≥2 fiscal years are
    # available; otherwise fall back to yfinance.
    sec_rev_hist = sec_data.get("revenueHistory") or []
    if len(sec_rev_hist) >= 2:
        rev_hist = [(item["year"], float(item["revenue"])) for item in sec_rev_hist]
    else:
        rev_hist = _history_series(rev_row)

    # Operating income + derived margin. yfinance income_stmt is more accurate
    # than info.operatingMargins (which can be an order of magnitude off for
    # loss-making companies); SEC TTM beats both.
    opinc_row = _first_row(income, _OPINC_ROWS)
    yf_op_income = _latest_value(opinc_row)
    yf_op_margin: Optional[float] = None
    yf_op_margin_label = "income_stmt"
    if yf_op_income is not None and yf_revenue and yf_revenue > 0:
        yf_op_margin = yf_op_income / yf_revenue
    elif info.get("operatingMargins") is not None:
        raw = float(info["operatingMargins"])
        if -1.5 < raw < 1.5:
            yf_op_margin = raw
            yf_op_margin_label = "info"
    op_income = _pick("operatingIncome", yf_op_income, "income_stmt")
    op_margin = _pick("operatingMargin", yf_op_margin, yf_op_margin_label)

    # Tax rate
    tax_row = _first_row(income, _TAX_ROWS)
    pretax_row = _first_row(income, _PRETAX_ROWS)
    yf_tax_rate = _safe_tax_rate(tax_row, pretax_row)
    tax_rate = _pick("taxRate", yf_tax_rate, "income_stmt")

    # Revenue growth
    rev_cagr = _cagr(rev_hist)
    if rev_cagr is not None:
        sources["revenueCagr"] = "sec_edgar" if len(sec_rev_hist) >= 2 else "income_stmt_multiyear"
    rev_growth_1y: Optional[float] = None
    if len(rev_hist) >= 2 and rev_hist[-2][1] > 0:
        rev_growth_1y = (rev_hist[-1][1] - rev_hist[-2][1]) / rev_hist[-2][1]
        sources["revenueGrowth1y"] = "sec_edgar" if len(sec_rev_hist) >= 2 else "income_stmt"
    elif info.get("revenueGrowth") is not None:
        rev_growth_1y = float(info["revenueGrowth"])
        sources.setdefault("revenueGrowth1y", "info")

    # CAPEX (cashflow sign is negative for outflow; return absolute)
    capex_row = _first_row(cashflow, _CAPEX_ROWS)
    capex_latest = _latest_value(capex_row)
    yf_capex_abs = abs(capex_latest) if capex_latest is not None else None
    capex_abs = _pick("capex", yf_capex_abs, "cashflow")

    # Free Cash Flow (yfinance only — SEC doesn't expose a single FCF concept)
    fcf_row = _first_row(cashflow, _FCF_ROWS)
    fcf_ttm = _latest_value(fcf_row)
    if fcf_ttm is not None:
        sources["freeCashFlow"] = "cashflow"

    # Debt / cash / net debt
    net_debt_row = _first_row(balance, _NETDEBT_ROWS)
    total_debt_row = _first_row(balance, _TOTALDEBT_ROWS)
    cash_row = _first_row(balance, _CASH_ROWS)

    yf_total_debt = _latest_value(total_debt_row)
    yf_total_cash = _latest_value(cash_row)
    if yf_total_cash is None and info.get("totalCash") is not None:
        yf_total_cash = float(info["totalCash"])

    total_debt = _pick("totalDebt", yf_total_debt, "balance_sheet")
    total_cash = _pick("totalCash", yf_total_cash, "balance_sheet")

    yf_net_debt = _latest_value(net_debt_row)
    if yf_net_debt is None and yf_total_debt is not None:
        yf_net_debt = yf_total_debt - (yf_total_cash or 0.0)
    yf_net_debt_label = "balance_sheet" if _latest_value(net_debt_row) is not None else "balance_sheet_derived"
    net_debt = _pick("netDebt", yf_net_debt, yf_net_debt_label)

    # Shares outstanding — prefer SEC dei:EntityCommonStockSharesOutstanding,
    # then yfinance balance-sheet, then info.
    shares_row = _first_row(balance, _SHARES_ROWS)
    yf_shares = _latest_value(shares_row)
    yf_shares_label = "balance_sheet"
    if yf_shares is None and info.get("sharesOutstanding") is not None:
        yf_shares = float(info["sharesOutstanding"])
        yf_shares_label = "info"
    shares = _pick("sharesOutstanding", yf_shares, yf_shares_label)

    # Current price
    current_price: Optional[float] = None
    try:
        bars = get_history(key, period="1d")
        if bars:
            current_price = float(bars[-1].close)
    except Exception:
        pass
    if current_price is None and info.get("regularMarketPrice"):
        current_price = float(info["regularMarketPrice"])

    market_cap = None
    if info.get("marketCap") is not None:
        market_cap = float(info["marketCap"])
    elif current_price is not None and shares is not None:
        market_cap = current_price * shares

    # Price multiples — all come from the same `info` dict already loaded above,
    # so they cost no extra upstream calls.
    trailing_pe = _coerce_float(info, "trailingPE")
    forward_pe = _coerce_float(info, "forwardPE")
    price_to_book = _coerce_float(info, "priceToBook")
    peg_ratio = _coerce_float(info, "pegRatio")
    ev_to_ebitda = _coerce_float(info, "enterpriseToEbitda")
    price_to_sales = _coerce_float(info, "priceToSalesTrailing12Months")
    enterprise_value = _coerce_float(info, "enterpriseValue")
    for name, val in [
        ("trailingPE", trailing_pe),
        ("forwardPE", forward_pe),
        ("priceToBook", price_to_book),
        ("pegRatio", peg_ratio),
        ("evToEbitda", ev_to_ebitda),
        ("priceToSales", price_to_sales),
        ("enterpriseValue", enterprise_value),
    ]:
        if val is not None:
            sources[name] = "info"

    # Profitability — yfinance occasionally returns already-percent values for
    # loss-making companies. Drop anything outside [-3, 3] (i.e. -300%..+300%).
    def _margin(key: str) -> Optional[float]:
        v = _coerce_float(info, key)
        if v is None or not (-3.0 <= v <= 3.0):
            return None
        return v

    return_on_equity = _margin("returnOnEquity")
    return_on_assets = _margin("returnOnAssets")
    gross_margins = _margin("grossMargins")
    ebitda_margins = _margin("ebitdaMargins")
    profit_margins = _margin("profitMargins")
    earnings_growth = _coerce_float(info, "earningsGrowth")
    for name, val in [
        ("returnOnEquity", return_on_equity),
        ("returnOnAssets", return_on_assets),
        ("grossMargins", gross_margins),
        ("ebitdaMargins", ebitda_margins),
        ("profitMargins", profit_margins),
        ("earningsGrowth", earnings_growth),
    ]:
        if val is not None:
            sources[name] = "info"

    # Analyst targets
    target_mean = _coerce_float(info, "targetMeanPrice")
    target_high = _coerce_float(info, "targetHighPrice")
    target_low = _coerce_float(info, "targetLowPrice")
    target_median = _coerce_float(info, "targetMedianPrice")
    num_analysts = _coerce_float(info, "numberOfAnalystOpinions")
    recommendation_mean = _coerce_float(info, "recommendationMean")
    recommendation_key = info.get("recommendationKey") if isinstance(info.get("recommendationKey"), str) else None
    for name, val in [
        ("targetMeanPrice", target_mean),
        ("targetHighPrice", target_high),
        ("targetLowPrice", target_low),
        ("targetMedianPrice", target_median),
        ("numberOfAnalystOpinions", num_analysts),
        ("recommendationMean", recommendation_mean),
    ]:
        if val is not None:
            sources[name] = "info"
    if recommendation_key:
        sources["recommendationKey"] = "info"

    analyst_upside_pct: Optional[float] = None
    if target_mean is not None and current_price is not None and current_price > 0 and target_mean > 0:
        analyst_upside_pct = (target_mean - current_price) / current_price
        sources["analystUpsidePct"] = "derived"

    # ── 8-K / 6-K TTM rollup ──────────────────────────────────────────────
    # If the latest earnings release reports a quarter newer than yfinance's
    # most recent annual, replace the DCF inputs with a trailing-twelve-month
    # number that includes the new quarter. yfinance's annual `revenue` here
    # represents the most recently completed fiscal year — that's already
    # 1-12 months stale by the time a Q1 8-K is out.
    latest_quarter_reported: Optional[Dict[str, Any]] = None
    try:
        revenue, op_income, op_margin, latest_quarter_reported = _roll_to_ttm_with_8k(
            ticker=key,
            yf_revenue_annual=revenue,
            yf_op_income_annual=op_income,
            yf_op_margin_annual=op_margin,
            sources=sources,
        )
    except Exception as exc:
        log.warning("8-K TTM rollup failed for %s: %s", key, exc)

    result = {
        "ticker": key,
        "name": info.get("longName") or info.get("shortName") or key,
        "currentPrice": current_price,
        "currency": info.get("currency") or "USD",
        "revenue": revenue,
        "revenueHistory": [{"year": y, "revenue": v} for y, v in rev_hist],
        "revenueCagr": rev_cagr,
        "revenueGrowth1y": rev_growth_1y,
        "operatingIncome": op_income,
        "operatingMargin": op_margin,
        "taxRate": tax_rate,
        "latestQuarterReported": latest_quarter_reported,
        "capex": capex_abs,
        "freeCashFlow": fcf_ttm,
        "totalDebt": total_debt,
        "totalCash": total_cash,
        "netDebt": net_debt,
        "sharesOutstanding": shares,
        "marketCap": market_cap,
        "beta": float(info["beta"]) if info.get("beta") is not None else None,
        "trailingPE": trailing_pe,
        "forwardPE": forward_pe,
        "priceToBook": price_to_book,
        "pegRatio": peg_ratio,
        "evToEbitda": ev_to_ebitda,
        "priceToSales": price_to_sales,
        "enterpriseValue": enterprise_value,
        "returnOnEquity": return_on_equity,
        "returnOnAssets": return_on_assets,
        "grossMargins": gross_margins,
        "ebitdaMargins": ebitda_margins,
        "profitMargins": profit_margins,
        "earningsGrowth": earnings_growth,
        "targetMeanPrice": target_mean,
        "targetHighPrice": target_high,
        "targetLowPrice": target_low,
        "targetMedianPrice": target_median,
        "numberOfAnalystOpinions": int(num_analysts) if num_analysts is not None else None,
        "recommendationKey": recommendation_key,
        "recommendationMean": recommendation_mean,
        "analystUpsidePct": analyst_upside_pct,
        "sources": sources,
        "asOf": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
        "asOfFiling": sec_data.get("asOfFiling"),
    }

    _cache[key] = (now, result)
    return result


# ---------------------------------------------------------------------------
# Annual income statement history (for the Financials tab)
# ---------------------------------------------------------------------------

# Map our internal row keys to candidate yfinance row labels. yfinance varies
# the exact label across tickers; first hit wins. Anything missing renders as
# None on the frontend (em-dash). Don't fabricate values.
_INCOME_STMT_ROW_MAP: Dict[str, List[str]] = {
    "total_revenues": ["Total Revenue", "Operating Revenue"],
    "cost_of_sales": ["Cost Of Revenue", "Cost Of Goods Sold", "Reconciled Cost Of Revenue"],
    "gross_profit": ["Gross Profit"],
    "sga": [
        "Selling General And Administration",
        "Selling General Administrative",
        "General And Administrative Expense",
    ],
    "da": [
        "Reconciled Depreciation",
        "Depreciation Amortization Depletion",
        "Depreciation And Amortization In Income Statement",
    ],
    "rd": ["Research And Development"],
    "other_opex": ["Other Operating Expenses", "Other Special Charges"],
    "operating_profit": ["Operating Income", "Total Operating Income As Reported", "EBIT"],
    "interest_expense": ["Interest Expense", "Interest Expense Non Operating"],
    "non_operating_income": [
        "Other Non Operating Income Expenses",
        "Other Income Expense",
    ],
    "total_non_operating": ["Total Other Finance Cost", "Net Non Operating Interest Income Expense"],
    "pretax_income": ["Pretax Income", "Income Before Tax"],
    "tax_provision": ["Tax Provision", "Income Tax Expense"],
    "consolidated_ni": ["Net Income From Continuing And Discontinued Operation", "Net Income"],
    "minority_interest": ["Minority Interests", "Net Income Including Noncontrolling Interests"],
    "discontinued_ops": ["Net Income Discontinued Operations", "Discontinued Operations"],
    "ni_to_common": ["Net Income Common Stockholders", "Net Income Applicable To Common Shares"],
    "eps_basic": ["Basic EPS"],
    "eps_diluted": ["Diluted EPS"],
    "shares_basic_was": ["Basic Average Shares"],
    "shares_diluted_was": ["Diluted Average Shares"],
    "ebitda": ["EBITDA", "Normalized EBITDA"],
}

# Display metadata (label, format hint, hierarchy hints) for each row. Rendered
# in this order on the frontend; bold/italic flags drive the table styling.
_INCOME_STMT_ROW_META: List[Dict[str, Any]] = [
    {"key": "total_revenues",          "label": "Total Revenues",                                            "format": "money",      "bold": True},
    {"key": "total_revenues_chg",      "label": "Total Revenues %Chg",                                       "format": "pct",        "italic": True, "derived": True},
    {"key": "cost_of_sales",           "label": "Cost of Sales",                                             "format": "money"},
    {"key": "gross_profit",            "label": "Gross Profit",                                              "format": "money",      "bold": True},
    {"key": "gross_margin",            "label": "Gross Profit Margin",                                       "format": "pct",        "italic": True, "derived": True},
    {"key": "sga",                     "label": "Selling, General & Administrative Expenses",                "format": "money"},
    {"key": "da",                      "label": "Depreciation & Amortization Expenses",                      "format": "money"},
    {"key": "rd",                      "label": "Research & Development Expenses",                           "format": "money"},
    {"key": "other_opex",              "label": "Other Operating Expenses",                                  "format": "money"},
    {"key": "operating_profit",        "label": "Operating Profit",                                          "format": "money",      "bold": True},
    {"key": "operating_margin",        "label": "Operating Margin",                                          "format": "pct",        "italic": True, "derived": True},
    {"key": "interest_expense",        "label": "Interest Expense",                                          "format": "money"},
    {"key": "non_operating_income",    "label": "Non-Operating Income",                                      "format": "money"},
    {"key": "total_non_operating",     "label": "Total Non-Operating Income",                                "format": "money",      "bold": True},
    {"key": "pretax_income",           "label": "Income Before Provision for Income Taxes",                  "format": "money",      "bold": True},
    {"key": "tax_provision",           "label": "Provision for Income Taxes",                                "format": "money"},
    {"key": "consolidated_ni",         "label": "Consolidated Net Income",                                   "format": "money",      "bold": True},
    {"key": "minority_interest",       "label": "Net Income Attributable to Minority Interests and Other",   "format": "money"},
    {"key": "discontinued_ops",        "label": "Net Income Attributable to Discontinued Operations",        "format": "money"},
    {"key": "ni_to_common",            "label": "Net Income Attributable to Common Shareholders",            "format": "money",      "bold": True},
    {"key": "eps_basic",               "label": "Basic EPS",                                                 "format": "per_share"},
    {"key": "eps_diluted",             "label": "Diluted EPS",                                               "format": "per_share"},
    {"key": "shares_basic_was",        "label": "Basic Weighted Average Shares Outstanding",                 "format": "money"},
    {"key": "shares_outstanding_total","label": "Total Shares Outstanding",                                  "format": "money",      "derived": True},
    {"key": "shares_diluted_was",      "label": "Diluted Weighted Average Shares Outstanding",               "format": "money"},
    {"key": "shares_outstanding",      "label": "Shares Outstanding",                                        "format": "money",      "derived": True},
    {"key": "ebitda",                  "label": "EBITDA",                                                    "format": "money"},
    {"key": "effective_tax_rate",     "label": "Effective Tax Rate",                                        "format": "pct",        "italic": True, "derived": True},
]


def _format_year_label(col: Any) -> str:
    """yfinance column → 'Dec '25' style label."""
    try:
        return col.strftime("%b '%y")
    except Exception:
        s = str(col)
        return s[:7] if len(s) >= 7 else s


def _row_values_in_unit(
    row: Optional[pd.Series],
    columns: List[Any],
    unit_divisor: float,
) -> List[Optional[float]]:
    """Pick this row's values aligned to ``columns``, scaled by ``unit_divisor``.

    yfinance returns absolute dollars; the frontend currently shows millions
    only, so the divisor is 1e6 by default. EPS rows are per-share and pass
    divisor=1.
    """
    if row is None:
        return [None] * len(columns)
    out: List[Optional[float]] = []
    for col in columns:
        if col not in row.index:
            out.append(None)
            continue
        raw = row.loc[col]
        if isinstance(raw, pd.Series):
            raw = raw.iloc[0]
        try:
            fv = float(raw)
        except (TypeError, ValueError):
            out.append(None)
            continue
        if not math.isfinite(fv):
            out.append(None)
            continue
        out.append(round(fv / unit_divisor, 4))
    return out


def _safe_div(numer: Optional[float], denom: Optional[float]) -> Optional[float]:
    if numer is None or denom is None:
        return None
    if not math.isfinite(numer) or not math.isfinite(denom) or denom == 0:
        return None
    return numer / denom


def get_income_statement_history(
    ticker: str,
    periods: int = 11,
    quarterly: bool = False,
) -> Dict[str, Any]:
    """Return ~28 standard income-statement rows × N periods from yfinance.

    The frontend's Financials tab consumes this directly. Missing values are
    ``None`` so the table can render an em-dash; never fabricated.

    When ``quarterly=True`` the source is ``tk.quarterly_income_stmt`` and
    columns are quarter-end dates ("Mar '26") instead of fiscal years.
    """
    key = ticker.upper()
    period_kind = "quarterly" if quarterly else "annual"
    cache_key = f"income_statement::{key}::{periods}::{period_kind}"
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return cached[1]

    try:
        info: Dict[str, Any] = get_company_info(key).raw or {}
    except Exception:
        info = {}

    try:
        income = statement_to_dataframe(get_income_statement(key, quarterly=quarterly))
    except Exception:
        income = pd.DataFrame()

    if income is None or income.empty:
        result = {
            "ticker": key,
            "currency": info.get("currency") or "USD",
            "unit": "M",
            "period": period_kind,
            "years": [],
            "rows": [],
            "error": "no_income_statement",
            "message": f"yfinance returned no {period_kind} income statement for this ticker.",
        }
        _cache[cache_key] = (now, result)
        return result

    # Most-recent year first, capped at `periods`.
    columns_desc = sorted(income.columns, reverse=True)[:periods]
    years = [_format_year_label(col) for col in columns_desc]

    # Mask columns whose period-end is strictly before the company's first
    # trade date. yfinance occasionally returns pre-IPO/pre-spin rows with
    # fabricated values (e.g., SNDK's FY2024/FY2023 before its 2025-02-13
    # spin-off from WDC are the parent's pre-spin numbers). Honor this
    # function's "never fabricated" contract.
    ipo_ts: Optional[pd.Timestamp] = None
    first_trade_ms = info.get("firstTradeDateMilliseconds")
    if first_trade_ms is not None:
        try:
            ipo_ts = pd.Timestamp(int(first_trade_ms), unit="ms")
        except (TypeError, ValueError):
            ipo_ts = None
    pre_ipo_mask: List[bool] = []
    for col in columns_desc:
        if ipo_ts is None:
            pre_ipo_mask.append(False)
            continue
        try:
            pre_ipo_mask.append(pd.Timestamp(col) < ipo_ts)
        except Exception:
            pre_ipo_mask.append(False)

    # Pull each candidate row by name (first hit wins).
    raw_rows: Dict[str, Optional[pd.Series]] = {}
    for our_key, candidates in _INCOME_STMT_ROW_MAP.items():
        raw_rows[our_key] = _first_row(income, candidates)

    # Convert each row to aligned, unit-scaled values.
    by_key: Dict[str, List[Optional[float]]] = {}
    for our_key, row in raw_rows.items():
        is_per_share = our_key in ("eps_basic", "eps_diluted")
        divisor = 1.0 if is_per_share else 1_000_000.0
        by_key[our_key] = _row_values_in_unit(row, columns_desc, divisor)

    # Apply the pre-IPO mask before derived metrics so %Chg/margins/ETR
    # null-propagate naturally to both the masked column and the adjacent
    # period whose comparator just disappeared.
    if any(pre_ipo_mask):
        for k in by_key:
            by_key[k] = [
                None if pre_ipo_mask[i] else v for i, v in enumerate(by_key[k])
            ]

    # Derived: %Chg between adjacent (most-recent-first) revenue values.
    rev = by_key.get("total_revenues") or [None] * len(years)
    rev_chg: List[Optional[float]] = []
    for i, v in enumerate(rev):
        prev = rev[i + 1] if i + 1 < len(rev) else None
        if v is None or prev is None or prev == 0:
            rev_chg.append(None)
        else:
            rev_chg.append(round((v - prev) / abs(prev), 4))
    by_key["total_revenues_chg"] = rev_chg

    # Derived margins.
    gp = by_key.get("gross_profit") or [None] * len(years)
    op = by_key.get("operating_profit") or [None] * len(years)
    tx = by_key.get("tax_provision") or [None] * len(years)
    pt = by_key.get("pretax_income") or [None] * len(years)
    by_key["gross_margin"] = [
        _safe_div(g, r) and round(_safe_div(g, r), 4) for g, r in zip(gp, rev)
    ]
    by_key["operating_margin"] = [
        _safe_div(o, r) and round(_safe_div(o, r), 4) for o, r in zip(op, rev)
    ]
    # ETR is undefined when pretax is non-positive; surface 0% there to match
    # what most analytics platforms show (the cash tax expense doesn't divide
    # cleanly into a loss).
    etr_out: List[Optional[float]] = []
    for t, p in zip(tx, pt):
        if t is None or p is None:
            etr_out.append(None)
        elif p <= 0:
            etr_out.append(0.0)
        else:
            etr_out.append(round(t / p, 4))
    by_key["effective_tax_rate"] = etr_out

    # Shares-outstanding total: yfinance income_stmt has WAS but not the
    # period-end share count. Use info.sharesOutstanding for the latest period
    # and leave older years as None — accurate is better than a fabricated
    # series.
    shares_now = _coerce_float(info, "sharesOutstanding")
    shares_total = [None] * len(years)
    if shares_now is not None and len(shares_total) > 0:
        shares_total[0] = round(shares_now / 1_000_000.0, 4)
    by_key["shares_outstanding_total"] = shares_total
    by_key["shares_outstanding"] = list(shares_total)

    # Assemble the output rows in display order, attaching metadata.
    rows_out: List[Dict[str, Any]] = []
    for meta in _INCOME_STMT_ROW_META:
        values = by_key.get(meta["key"])
        if values is None:
            values = [None] * len(years)
        rows_out.append({
            **{k: v for k, v in meta.items() if k != "derived"},
            "values": values,
        })

    # Default sourcing: every column came from yfinance.
    years_source: List[str] = ["yfinance"] * len(years)

    # If we're in quarterly mode and a recent 8-K reports a quarter newer than
    # yfinance's most recent column, prepend that quarter so the Financials tab
    # reflects same-day earnings releases.
    if quarterly:
        latest_yf_period = columns_desc[0] if columns_desc else None
        rows_out, years, years_source = _maybe_prepend_8k_quarter(
            ticker=key,
            rows_out=rows_out,
            years=years,
            years_source=years_source,
            latest_yf_period=latest_yf_period,
        )

    result = {
        "ticker": key,
        "currency": info.get("currency") or "USD",
        "unit": "M",
        "period": period_kind,
        "years": years,
        "years_source": years_source,
        "rows": rows_out,
        "asOf": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    _cache[cache_key] = (now, result)
    return result


def _maybe_prepend_8k_quarter(
    *,
    ticker: str,
    rows_out: List[Dict[str, Any]],
    years: List[str],
    years_source: List[str],
    latest_yf_period: Any,
) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
    """Prepend a quarter sourced from the latest 8-K Exhibit 99.1 if it's newer.

    If yfinance hasn't yet ingested the just-filed quarter (typical 1-3 day
    lag), the 8-K's press release already has the headline numbers. We map a
    handful of fields onto the existing row keys; everything else stays None
    for that column.
    """
    try:
        from .earnings_extract import (  # local import to avoid cycle
            get_latest_earnings_release,
            has_10q_for_period,
        )
    except Exception:  # pragma: no cover — extractor failures shouldn't break the tab
        return rows_out, years, years_source
    try:
        extract = get_latest_earnings_release(ticker, include_body=True)
    except Exception as exc:
        log.warning("get_latest_earnings_release failed for %s: %s", ticker, exc)
        return rows_out, years, years_source
    if not extract or not extract.get("period_end"):
        return rows_out, years, years_source

    try:
        new_period = datetime.strptime(extract["period_end"], "%Y-%m-%d")
    except (TypeError, ValueError):
        return rows_out, years, years_source

    # If yfinance already has this quarter (or newer), no merge needed.
    if latest_yf_period is not None:
        try:
            yf_dt = pd.Timestamp(latest_yf_period).to_pydatetime()
            if yf_dt >= new_period:
                return rows_out, years, years_source
        except Exception:
            pass

    # Step 1: regex-derived field map (fast, deterministic, no API cost).
    field_map: Dict[str, Optional[float]] = {
        "total_revenues": extract.get("revenue_M"),
        "operating_profit": extract.get("operating_income_M"),
        "consolidated_ni": extract.get("net_income_M"),
        "ni_to_common": extract.get("net_income_M"),
        "eps_basic": extract.get("eps_basic"),
        "eps_diluted": extract.get("eps_diluted"),
    }
    # Need at least one populated field to be worth prepending.
    if not any(v is not None for v in field_map.values()):
        return rows_out, years, years_source

    # Step 2: count how many of the standard income-statement rows would
    # remain *empty in the new 8-K column* after regex extraction. Regex
    # only fills ~4–6 of the ~17 standard rows; everything else stays None
    # unless the LLM fills it. When the 10-Q for this period hasn't yet
    # been filed (so yfinance won't catch up soon either), augment with
    # one Gemini call so the new column doesn't show a wall of em-dashes.
    llm_augmented_keys: List[str] = []
    llm_meta: Optional[Dict[str, Any]] = None
    if extract.get("_body"):
        missing_in_new_col = sum(
            1 for k in _AUGMENTABLE_ROW_KEYS if field_map.get(k) is None
        )
        ten_q_present = False
        try:
            ten_q_present = has_10q_for_period(ticker, new_period)
        except Exception:
            ten_q_present = False
        if missing_in_new_col >= 5 and not ten_q_present:
            try:
                from .earnings_llm_extract import (
                    llm_extract_income_statement,
                    llm_field_value,
                )
                parsed_llm = llm_extract_income_statement(
                    ticker=ticker,
                    body=extract["_body"],
                    period_end=extract["period_end"],
                    accession=extract.get("accession") or "",
                    filing_form=extract.get("filing_form") or "8-K",
                )
            except Exception as exc:
                log.warning("LLM earnings extract import/run failed for %s: %s", ticker, exc)
                parsed_llm = None
            if parsed_llm:
                llm_meta = {
                    "model": parsed_llm.get("_model"),
                    "company_specific_notes": parsed_llm.get("company_specific_notes", ""),
                }
                # LLM keys → row-map keys. The only rename is operating_income
                # ↔ operating_profit (everything else aligns 1:1).
                _LLM_TO_ROW_KEY = {
                    "total_revenues": "total_revenues",
                    "cost_of_sales": "cost_of_sales",
                    "gross_profit": "gross_profit",
                    "gross_margin": "gross_margin",
                    "sga": "sga",
                    "rd": "rd",
                    "da": "da",
                    "other_opex": "other_opex",
                    "operating_income": "operating_profit",
                    "operating_margin": "operating_margin",
                    "interest_expense": "interest_expense",
                    "non_operating_income": "non_operating_income",
                    "total_non_operating": "total_non_operating",
                    "pretax_income": "pretax_income",
                    "tax_provision": "tax_provision",
                    "consolidated_ni": "consolidated_ni",
                    "ni_to_common": "ni_to_common",
                    "eps_basic": "eps_basic",
                    "eps_diluted": "eps_diluted",
                }
                for llm_key, row_key in _LLM_TO_ROW_KEY.items():
                    # Regex wins ties — only fill keys still empty after step 1.
                    if field_map.get(row_key) is not None:
                        continue
                    v = llm_field_value(parsed_llm, llm_key)
                    if v is not None:
                        field_map[row_key] = v
                        llm_augmented_keys.append(row_key)

    new_label = _format_year_label(pd.Timestamp(new_period))
    years = [new_label] + years
    # The press-release source is whichever filing form the issuer uses
    # (8-K for domestic, 6-K for foreign private issuers).
    form_source = extract.get("filing_form") or "8-K"
    years_source = [form_source] + years_source

    new_rows: List[Dict[str, Any]] = []
    for row in rows_out:
        key = row["key"]
        new_value = field_map.get(key)
        # Derived rows are recomputed below — start them as None to avoid
        # bringing forward a stale value from the row schema's default list.
        if key in ("total_revenues_chg", "effective_tax_rate"):
            new_value = None
        new_rows.append({**row, "values": [new_value] + list(row["values"])})

    # Derive % change for revenues, plus the margin/effective-rate cells the
    # LLM may not have populated (gross_margin / operating_margin /
    # effective_tax_rate). We re-derive even when the LLM gave a value, to
    # keep the new column internally consistent — a margin computed from the
    # populated revenue / op-income / etc. is more trustworthy than one we
    # might have hallucinated.
    _derive_new_column(new_rows, field_map)

    return new_rows, years, years_source


# Rows the LLM augmenter is allowed to fill — must mirror the keys we map
# from the LLM response. Used to count "would still be empty after regex"
# coverage for the gate.
_AUGMENTABLE_ROW_KEYS = (
    "total_revenues",
    "cost_of_sales",
    "gross_profit",
    "sga",
    "rd",
    "da",
    "other_opex",
    "operating_profit",
    "interest_expense",
    "non_operating_income",
    "total_non_operating",
    "pretax_income",
    "tax_provision",
    "consolidated_ni",
    "ni_to_common",
    "eps_basic",
    "eps_diluted",
)


def _derive_new_column(
    new_rows: List[Dict[str, Any]],
    field_map: Dict[str, Optional[float]],
) -> None:
    """Fill the four derived-row column-0 cells in place.

    These four (total_revenues_chg, gross_margin, operating_margin,
    effective_tax_rate) are computed from other cells, not extracted
    directly. Computing them here keeps the new column internally consistent
    even when the LLM gives partial coverage.
    """
    by_key = {r["key"]: r for r in new_rows}

    def _set(key: str, value: Optional[float]) -> None:
        row = by_key.get(key)
        if row and row.get("values"):
            row["values"][0] = value

    rev_row = by_key.get("total_revenues")
    if rev_row and len(rev_row["values"]) >= 2:
        new_rev = rev_row["values"][0]
        prev_rev = rev_row["values"][1]
        if new_rev is not None and prev_rev not in (None, 0):
            _set(
                "total_revenues_chg",
                round((new_rev - prev_rev) / abs(prev_rev), 4),
            )

    rev = field_map.get("total_revenues")
    gp = field_map.get("gross_profit")
    op = field_map.get("operating_profit")
    pt = field_map.get("pretax_income")
    tx = field_map.get("tax_provision")

    if gp is not None and rev not in (None, 0):
        _set("gross_margin", round(gp / rev, 4))
    if op is not None and rev not in (None, 0):
        _set("operating_margin", round(op / rev, 4))
    if tx is not None and pt not in (None, 0) and pt is not None:
        # ETR convention: undefined for negative pretax income (loss-makers
        # produce nonsensical rates). Match the earlier annual-build logic.
        if pt <= 0:
            _set("effective_tax_rate", 0.0)
        else:
            _set("effective_tax_rate", round(tx / pt, 4))
