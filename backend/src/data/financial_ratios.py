"""
Derived financial ratios over the same period grid as the three statements.

All inputs come from ``sec_statements`` (income, balance, cash-flow). Ratios
that need a current market price (P/E, P/B, EV/EBITDA, dividend yield) are
intentionally NOT computed here — they belong on the Overview tab where the
live spot is already fetched. This module produces only the structural
ratios that derive from filings alone.

Output shape matches ``FinancialStatementHistory`` so the frontend's
``StatementPanel`` renders ratios with the same chart + chip + table.
"""

from __future__ import annotations

import json
import logging
import math
import time
from typing import Any, Dict, List, Optional

from data.sec_edgar import atomic_write_json, get_cik_for_ticker
from data.sec_statements import (
    Period,
    STATEMENTS_CACHE_DIR,
    STATEMENTS_TTL_SEC,
    get_balance_sheet,
    get_cash_flow,
    get_income_statement,
)

log = logging.getLogger(__name__)


def _row_lookup(stmt: Dict[str, Any]) -> Dict[str, List[Optional[float]]]:
    return {row["key"]: row["values"] for row in stmt.get("rows", [])}


def _safe_div(numer: Optional[float], denom: Optional[float]) -> Optional[float]:
    if numer is None or denom is None:
        return None
    if not math.isfinite(numer) or not math.isfinite(denom) or denom == 0:
        return None
    return numer / denom


def _avg(curr: Optional[float], prev: Optional[float]) -> Optional[float]:
    """Two-point average for balance-sheet items in ratios that mix flow ÷ stock.

    Returns None when the prior period is missing, by design — single-point
    sampling would bias upward / downward depending on growth direction.
    """
    if curr is None or prev is None:
        return None
    if not math.isfinite(curr) or not math.isfinite(prev):
        return None
    return (curr + prev) / 2.0


# Ratio metadata: (key, label, format, bold)
# Format: "pct" for margins/returns/yields, "x" for ratios, "days" for cycle metrics.
RATIO_ROWS_META: List[Dict[str, Any]] = [
    # Profitability
    {"key": "gross_margin", "label": "Gross Margin", "format": "pct", "bold": True},
    {"key": "operating_margin", "label": "Operating Margin", "format": "pct", "bold": True},
    {"key": "net_margin", "label": "Net Margin", "format": "pct", "bold": True},
    {"key": "ebitda_margin", "label": "EBITDA Margin", "format": "pct"},
    {"key": "roa", "label": "Return on Assets", "format": "pct"},
    {"key": "roe", "label": "Return on Equity", "format": "pct"},
    {"key": "roic", "label": "Return on Invested Capital", "format": "pct"},
    # Liquidity
    {"key": "current_ratio", "label": "Current Ratio", "format": "x"},
    {"key": "quick_ratio", "label": "Quick Ratio", "format": "x"},
    {"key": "cash_ratio", "label": "Cash Ratio", "format": "x"},
    # Leverage
    {"key": "debt_to_equity", "label": "Debt / Equity", "format": "x"},
    {"key": "debt_to_assets", "label": "Debt / Assets", "format": "x"},
    {"key": "debt_to_ebitda", "label": "Debt / EBITDA", "format": "x"},
    {"key": "interest_coverage", "label": "Interest Coverage", "format": "x"},
    {"key": "net_debt_to_ebitda", "label": "Net Debt / EBITDA", "format": "x"},
    # Efficiency
    {"key": "asset_turnover", "label": "Asset Turnover", "format": "x"},
    {"key": "inventory_days", "label": "Inventory Days", "format": "days"},
    {"key": "dso", "label": "Days Sales Outstanding", "format": "days"},
    {"key": "dpo", "label": "Days Payable Outstanding", "format": "days"},
    {"key": "cash_conversion_cycle", "label": "Cash Conversion Cycle", "format": "days"},
    # Cash quality
    {"key": "fcf_margin", "label": "FCF / Revenue", "format": "pct"},
    {"key": "fcf_to_ni", "label": "FCF / Net Income", "format": "x"},
    {"key": "capex_to_revenue", "label": "Capex / Revenue", "format": "pct"},
]


def _compute_per_period(
    inc: Dict[str, List[Optional[float]]],
    bal: Dict[str, List[Optional[float]]],
    cfs: Dict[str, List[Optional[float]]],
    i: int,
    prev_i: Optional[int],
) -> Dict[str, Optional[float]]:
    """All ratios for column i. ``prev_i`` is the next index in the most-recent-first
    list (i.e., the *previous* fiscal period chronologically), or None for the
    earliest column.
    """
    def at(d: Dict[str, List[Optional[float]]], key: str, idx: int) -> Optional[float]:
        arr = d.get(key)
        if arr is None or idx is None or idx < 0 or idx >= len(arr):
            return None
        return arr[idx]

    # ---- statement values for this period ----
    revenue = at(inc, "revenue", i)
    cost_rev = at(inc, "cost_of_revenue", i)
    gross = at(inc, "gross_profit", i)
    op_income = at(inc, "operating_income", i)
    net_income = at(inc, "net_income", i)
    interest_exp = at(inc, "interest_expense", i)
    tax = at(inc, "tax_provision", i)
    pretax = at(inc, "pretax_income", i)
    da_inc = at(inc, "da", i)
    da_cf = at(cfs, "cf_da", i)
    da = da_inc if da_inc is not None else da_cf  # prefer income-statement reported D&A

    cash = at(bal, "cash", i)
    sti = at(bal, "short_term_investments", i)
    receivables = at(bal, "receivables", i)
    inventory = at(bal, "inventory", i)
    ap = at(bal, "accounts_payable", i)
    cur_assets = at(bal, "total_current_assets", i)
    cur_liab = at(bal, "total_current_liabilities", i)
    total_assets = at(bal, "total_assets", i)
    total_equity = at(bal, "total_equity", i)
    lt_debt = at(bal, "lt_debt", i)
    st_debt = at(bal, "st_debt", i)
    cur_lt_debt = at(bal, "current_portion_lt_debt", i)
    total_debt = sum(v for v in (lt_debt, st_debt, cur_lt_debt) if v is not None) if any(
        v is not None for v in (lt_debt, st_debt, cur_lt_debt)
    ) else None

    cfo = at(cfs, "cf_from_operations", i)
    capex = at(cfs, "cf_capex", i)
    fcf = (cfo - capex) if (cfo is not None and capex is not None) else None

    # Two-point averages where the ratio mixes flow ÷ stock.
    avg_assets = _avg(total_assets, at(bal, "total_assets", prev_i)) if prev_i is not None else None
    avg_equity = _avg(total_equity, at(bal, "total_equity", prev_i)) if prev_i is not None else None
    avg_inv = _avg(inventory, at(bal, "inventory", prev_i)) if prev_i is not None else None
    avg_ar = _avg(receivables, at(bal, "receivables", prev_i)) if prev_i is not None else None
    avg_ap = _avg(ap, at(bal, "accounts_payable", prev_i)) if prev_i is not None else None

    # EBITDA = operating income + D&A. Fall back to operating income alone
    # only if D&A is unknown (better to under- than to misreport).
    ebitda: Optional[float] = None
    if op_income is not None:
        ebitda = op_income + (da or 0)

    # Effective tax rate (only used downstream for ROIC NOPAT).
    eff_tax = _safe_div(tax, pretax) if (pretax is not None and pretax > 0) else None
    if eff_tax is not None:
        eff_tax = max(0.0, min(0.40, eff_tax))
    nopat = (op_income * (1 - (eff_tax or 0))) if op_income is not None else None
    invested_capital = None
    if total_debt is not None and total_equity is not None:
        invested_capital = total_debt + total_equity - (cash or 0)

    out: Dict[str, Optional[float]] = {
        # Profitability
        "gross_margin": _safe_div(gross, revenue),
        "operating_margin": _safe_div(op_income, revenue),
        "net_margin": _safe_div(net_income, revenue),
        "ebitda_margin": _safe_div(ebitda, revenue),
        "roa": _safe_div(net_income, avg_assets),
        "roe": _safe_div(net_income, avg_equity),
        "roic": _safe_div(nopat, invested_capital),
        # Liquidity
        "current_ratio": _safe_div(cur_assets, cur_liab),
        "quick_ratio": _safe_div(
            (cur_assets - inventory) if (cur_assets is not None and inventory is not None) else None,
            cur_liab,
        ),
        "cash_ratio": _safe_div(
            (cash + sti) if (cash is not None and sti is not None) else cash,
            cur_liab,
        ),
        # Leverage
        "debt_to_equity": _safe_div(total_debt, total_equity),
        "debt_to_assets": _safe_div(total_debt, total_assets),
        "debt_to_ebitda": _safe_div(total_debt, ebitda),
        "interest_coverage": _safe_div(op_income, interest_exp),
        "net_debt_to_ebitda": _safe_div(
            (total_debt - (cash or 0)) if total_debt is not None else None,
            ebitda,
        ),
        # Efficiency
        "asset_turnover": _safe_div(revenue, avg_assets),
        "inventory_days": _safe_div(365 * (avg_inv or 0), cost_rev) if avg_inv is not None and cost_rev is not None else None,
        "dso": _safe_div(365 * (avg_ar or 0), revenue) if avg_ar is not None and revenue is not None else None,
        "dpo": _safe_div(365 * (avg_ap or 0), cost_rev) if avg_ap is not None and cost_rev is not None else None,
        "cash_conversion_cycle": None,  # filled in below
        # Cash quality
        "fcf_margin": _safe_div(fcf, revenue),
        "fcf_to_ni": _safe_div(fcf, net_income),
        "capex_to_revenue": _safe_div(capex, revenue),
    }

    inv_d, dso, dpo = out["inventory_days"], out["dso"], out["dpo"]
    if all(v is not None for v in (inv_d, dso, dpo)):
        out["cash_conversion_cycle"] = (dso or 0) + (inv_d or 0) - (dpo or 0)

    # Format adjustments: pct values come back as decimals (0.32 = 32%); the
    # frontend's pct formatter expects this. "x" / "days" stay raw.
    return out


def _format_value(key: str, raw: Optional[float], fmt: str) -> Optional[float]:
    if raw is None or not math.isfinite(raw):
        return None
    if fmt == "pct":
        return round(raw, 6)
    if fmt == "days":
        return round(raw, 1)
    if fmt == "x":
        return round(raw, 4)
    return round(raw, 4)


def _ratios_cache_path(cik: str, period: Period):
    return STATEMENTS_CACHE_DIR / f"CIK{cik}-ratios-{period}.json"


def _read_cached(cik: str, period: Period) -> Optional[Dict[str, Any]]:
    path = _ratios_cache_path(cik, period)
    if not path.exists():
        return None
    age = time.time() - path.stat().st_mtime
    if age >= STATEMENTS_TTL_SEC:
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def get_ratios(ticker: str, period: Period = "annual", *, force: bool = False) -> Dict[str, Any]:
    ticker_u = ticker.upper()
    cik = get_cik_for_ticker(ticker_u)
    if cik is not None and not force:
        cached = _read_cached(cik, period)
        if cached is not None:
            return cached

    inc = get_income_statement(ticker_u, period, force=force)
    bal = get_balance_sheet(ticker_u, period, force=force)
    cfs = get_cash_flow(ticker_u, period, force=force)

    # All three should share the canonical period grid (sec_statements uses the
    # income-statement-derived period set for all three). Defensively inner-join
    # on year_ends in case of any future drift.
    inc_ends = inc.get("year_ends") or []
    bal_ends = bal.get("year_ends") or []
    cf_ends = cfs.get("year_ends") or []
    common = [e for e in inc_ends if e in bal_ends and e in cf_ends]

    if not common:
        return {
            "ticker": ticker_u,
            "currency": "USD",
            "unit": "M",
            "period": period,
            "years": [],
            "years_source": [],
            "year_ends": [],
            "rows": [],
            "asOf": inc.get("asOf"),
            "source": "sec-edgar",
            "message": "Insufficient overlap between statements to compute ratios",
        }

    inc_idx = {e: inc_ends.index(e) for e in common}
    bal_idx = {e: bal_ends.index(e) for e in common}
    cf_idx = {e: cf_ends.index(e) for e in common}

    inc_lu = _row_lookup(inc)
    bal_lu = _row_lookup(bal)
    cf_lu = _row_lookup(cfs)

    # Re-index lookups onto the common period order (most-recent-first by
    # construction since common preserves inc_ends order).
    def reindex(lookup, idx_map):
        return {k: [arr[idx_map[e]] for e in common] for k, arr in lookup.items()}

    inc_r = reindex(inc_lu, inc_idx)
    bal_r = reindex(bal_lu, bal_idx)
    cf_r = reindex(cf_lu, cf_idx)

    # Build out_rows.
    out_rows: List[Dict[str, Any]] = []
    n = len(common)
    # Pre-compute per-period dicts.
    per_period: List[Dict[str, Optional[float]]] = []
    for i in range(n):
        # prev_i is the *next* index because common is most-recent-first.
        prev_i = i + 1 if (i + 1) < n else None
        per_period.append(_compute_per_period(inc_r, bal_r, cf_r, i, prev_i))

    for meta in RATIO_ROWS_META:
        key = meta["key"]
        fmt = meta["format"]
        values = [_format_value(key, p.get(key), fmt) for p in per_period]
        out_rows.append({
            "key": key,
            "label": meta["label"],
            "format": fmt,
            "bold": meta.get("bold", False),
            "italic": meta.get("italic", False),
            "values": values,
        })

    result = {
        "ticker": ticker_u,
        "currency": "USD",
        "unit": "M",
        "period": period,
        "years": [_label_for_end(e) for e in common],
        "years_source": ["sec-edgar"] * len(common),
        "year_ends": common,
        "rows": out_rows,
        "asOf": inc.get("asOf"),
        "source": "sec-edgar",
    }

    if cik is not None:
        try:
            STATEMENTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            atomic_write_json(_ratios_cache_path(cik, period), result)
        except Exception as exc:
            log.warning("ratios cache write failed for %s/%s: %s", ticker_u, period, exc)

    return result


def _label_for_end(end: str) -> str:
    from datetime import date as _date
    try:
        return _date.fromisoformat(end).strftime("%b '%y")
    except Exception:
        return end


# ---------------------------------------------------------------------------
# Valuation snapshot — multiples that mix live spot with filed financials
# ---------------------------------------------------------------------------
#
# Unlike the statement-internal ratios above, these need today's share price
# to compute. They're a *snapshot*: only the latest period's revenue / NI /
# equity / FCF is used; we intentionally don't backfill historical multiples
# because we don't have period-end share prices. The frontend renders these
# as tiles above the Ratios table.


def _latest_value(rows: List[Dict[str, Any]], key: str) -> Optional[float]:
    for r in rows:
        if r.get("key") == key:
            vals = r.get("values") or []
            return vals[0] if vals and isinstance(vals[0], (int, float)) else None
    return None


def get_valuation_snapshot(ticker: str, *, force: bool = False) -> Dict[str, Any]:
    """Compute P/E, P/S, P/B, P/FCF, EV/EBITDA, EV/Sales for the latest annual
    period using the current spot from ``get_ticker_price``.

    All money inputs from sec_statements are denominated in millions; the
    multiples are unitless so the scaling cancels. Market cap and enterprise
    value are returned in millions.
    """
    from data.market_data import get_ticker_price  # local import: avoid cycles

    ticker_u = ticker.upper().strip().replace(".", "-")
    inc = get_income_statement(ticker_u, "annual", force=force)
    bal = get_balance_sheet(ticker_u, "annual", force=force)
    cfs = get_cash_flow(ticker_u, "annual", force=force)

    # If a filer is foreign or there's no SEC data at all, surface a clean
    # empty payload instead of NaN-laden multiples.
    if not inc.get("rows") or not bal.get("rows"):
        return {
            "ticker": ticker_u,
            "spot": None,
            "asof_period": None,
            "market_cap_m": None,
            "enterprise_value_m": None,
            "multiples": {},
            "message": inc.get("message") or "No SEC statements for ticker",
        }

    try:
        spot = get_ticker_price(ticker_u)
    except Exception as exc:
        log.warning("spot lookup failed for %s: %s", ticker_u, exc)
        spot = None

    if spot is None or not math.isfinite(spot) or spot <= 0:
        return {
            "ticker": ticker_u,
            "spot": None,
            "asof_period": (inc.get("years") or [None])[0],
            "market_cap_m": None,
            "enterprise_value_m": None,
            "multiples": {},
            "message": "Spot price unavailable",
        }

    inc_rows = inc.get("rows", [])
    bal_rows = bal.get("rows", [])
    cf_rows = cfs.get("rows", [])

    revenue = _latest_value(inc_rows, "revenue")
    net_income = _latest_value(inc_rows, "net_income")
    operating_income = _latest_value(inc_rows, "operating_income")
    da = _latest_value(inc_rows, "da")
    shares = _latest_value(inc_rows, "shares_diluted_was") or _latest_value(inc_rows, "shares_basic_was")
    total_equity = _latest_value(bal_rows, "total_equity")
    cash = _latest_value(bal_rows, "cash") or 0.0
    lt_debt = _latest_value(bal_rows, "lt_debt") or 0.0
    st_debt = _latest_value(bal_rows, "st_debt") or 0.0
    cfo = _latest_value(cf_rows, "cf_from_operations")
    capex = _latest_value(cf_rows, "cf_capex")

    # Market cap: spot ($/share) × shares (in millions) → result in millions.
    if shares is None or shares <= 0:
        return {
            "ticker": ticker_u,
            "spot": spot,
            "asof_period": (inc.get("years") or [None])[0],
            "market_cap_m": None,
            "enterprise_value_m": None,
            "multiples": {},
            "message": "Shares outstanding unavailable",
        }
    market_cap_m = spot * shares
    total_debt = lt_debt + st_debt
    ev_m = market_cap_m + total_debt - cash

    # FCF = CFO − |Capex|. abs() guards against either sign convention since
    # the XBRL `PaymentsToAcquirePropertyPlantAndEquipment` is sometimes
    # extracted positive (a payment) and sometimes negated.
    fcf = (cfo - abs(capex)) if cfo is not None and capex is not None else None
    # EBITDA = Operating Income + D&A. Fall back to None if either missing.
    ebitda = (operating_income + da) if operating_income is not None and da is not None else None

    def _safe(num: Optional[float], den: Optional[float]) -> Optional[float]:
        if num is None or den is None or den == 0:
            return None
        v = num / den
        return v if math.isfinite(v) else None

    multiples = {
        "pe": {
            "label": "P/E",
            "value": _safe(market_cap_m, net_income if (net_income is not None and net_income > 0) else None),
            "tooltip": "Market cap ÷ net income · negative earnings → not meaningful",
        },
        "ps": {
            "label": "P/S",
            "value": _safe(market_cap_m, revenue if (revenue is not None and revenue > 0) else None),
            "tooltip": "Market cap ÷ revenue",
        },
        "pb": {
            "label": "P/B",
            "value": _safe(market_cap_m, total_equity if (total_equity is not None and total_equity > 0) else None),
            "tooltip": "Market cap ÷ total stockholders' equity",
        },
        "p_fcf": {
            "label": "P/FCF",
            "value": _safe(market_cap_m, fcf if (fcf is not None and fcf > 0) else None),
            "tooltip": "Market cap ÷ free cash flow (CFO − Capex)",
        },
        "ev_ebitda": {
            "label": "EV/EBITDA",
            "value": _safe(ev_m, ebitda if (ebitda is not None and ebitda > 0) else None),
            "tooltip": "(Market cap + total debt − cash) ÷ (Operating Income + D&A)",
        },
        "ev_sales": {
            "label": "EV/Sales",
            "value": _safe(ev_m, revenue if (revenue is not None and revenue > 0) else None),
            "tooltip": "(Market cap + total debt − cash) ÷ revenue",
        },
    }

    return {
        "ticker": ticker_u,
        "spot": spot,
        "asof_period": (inc.get("years") or [None])[0],
        "market_cap_m": market_cap_m,
        "enterprise_value_m": ev_m,
        "shares_diluted_m": shares,
        "multiples": multiples,
    }
