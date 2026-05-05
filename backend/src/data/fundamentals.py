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
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import yfinance as yf

from .sec_edgar import extract_sec_fundamentals

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

    tk = yf.Ticker(key)
    sources: Dict[str, str] = {}

    # SEC EDGAR is authoritative for the load-bearing DCF inputs (shares, debt,
    # cash, revenue, capex). yfinance is the fallback and the source for
    # enrichment fields SEC doesn't expose (analyst targets, P/E, beta, etc.).
    sec_data: Dict[str, Any] = {}
    try:
        sec_data = extract_sec_fundamentals(key) or {}
    except Exception as exc:
        log.warning("SEC EDGAR lookup failed for %s: %s", key, exc)
        sec_data = {}

    def _pick(field: str, yf_val: Optional[float], yf_label: str) -> Optional[float]:
        """Prefer SEC-provided value when finite, else yfinance. Records source."""
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
        info: Dict[str, Any] = tk.info or {}
    except Exception:
        info = {}

    try:
        income = tk.income_stmt
    except Exception:
        income = pd.DataFrame()
    try:
        cashflow = tk.cashflow
    except Exception:
        cashflow = pd.DataFrame()
    try:
        balance = tk.balance_sheet
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
        hist = tk.history(period="1d")
        if not hist.empty:
            current_price = float(hist["Close"].iloc[-1])
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
