"""
SEC EDGAR XBRL full-history financial-statement extraction.

Where ``sec_edgar.py`` produces a TTM digest of the load-bearing DCF inputs,
this module produces row × period grids for the three GAAP statements:
Income Statement, Balance Sheet, and Cash Flow. Output shape matches the
``FinancialStatementHistory`` wire contract consumed by the frontend
``StatementPanel`` component.

Source: cached XBRL ``companyfacts`` JSON via ``sec_edgar.fetch_company_facts``.
Cache: extracted statements are written to ``backend/.cache/sec/statements/``
with a 24h TTL (matches the underlying companyfacts TTL — derived data can't
be fresher than its input).

Sign convention: rows whose XBRL value is reported negative but conventionally
displayed positive (capex, dividends, buybacks) carry ``"sign": "negate"`` in
their row metadata; the extraction multiplies by -1 after the value is picked.
"""

from __future__ import annotations

import json
import logging
import math
import pathlib
import time
from datetime import date
from typing import Any, Dict, List, Literal, Optional, Tuple

from data.sec_edgar import (
    CACHE_DIR,
    atomic_write_json,
    fetch_company_facts,
    get_cik_for_ticker,
    _facts_section,
    _normalize_filing_entries,
    _units_for,
)

log = logging.getLogger(__name__)

Period = Literal["annual", "quarterly"]
StatementName = Literal["income", "balance", "cash-flow"]

STATEMENTS_CACHE_DIR = CACHE_DIR / "statements"
STATEMENTS_TTL_SEC = 24 * 3600

# Bump when the rendered row schema changes so old cache files are auto-discarded
# rather than served stale. v2 added the four derived pct rows on the income
# statement (revenue %Chg, gross/operating margin, effective tax rate).
SCHEMA_VERSION = 2

# Frontend display unit — backend always returns millions. Per-share rows are
# left raw (no divisor applied beyond `per_share`).
UNIT_DIVISOR = 1_000_000.0
EPSILON_M = 0.5  # below 0.5M of magnitude on a derived Q4, treat as zero

# ---------------------------------------------------------------------------
# Row metadata: ~80 GAAP line items × candidate XBRL tag groups
# ---------------------------------------------------------------------------
#
# Schema for each entry:
#   key:            stable identifier used in the wire format & frontend
#   label:          human label shown in the table
#   format:         "money" | "per_share" | "pct"  (frontend formatting hint)
#   bold/italic:    optional display flags
#   tags:           ordered list of us-gaap concept names; first non-empty wins
#   sign:           "natural" (default) or "negate" — multiply extracted val by -1
#   instant:        True for balance-sheet items (no start, just end)
#   namespace:      "us-gaap" (default) or "dei" for share counts


def _row(
    key: str,
    label: str,
    fmt: str,
    tags: List[str],
    *,
    bold: bool = False,
    italic: bool = False,
    sign: str = "natural",
    instant: bool = False,
    namespace: str = "us-gaap",
) -> Dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "format": fmt,
        "bold": bold,
        "italic": italic,
        "tags": tags,
        "sign": sign,
        "instant": instant,
        "namespace": namespace,
    }


_INCOME_ROWS: List[Dict[str, Any]] = [
    _row("revenue", "Total Revenues", "money", [
        # `Revenues` is the most-consolidated us-gaap concept — when a filer
        # reports BOTH `Revenues` and `RevenueFromContractWithCustomer*`, it's
        # because non-contract sources (lease income, royalties, etc.) are
        # rolled into `Revenues` but excluded from the contracts tag. WULF is
        # the canonical example: contracts revenue $151.6M + operating-lease
        # income $16.9M = total $168.5M (filed under `Revenues`). Putting
        # `Revenues` first matches Fiscal.ai's "Total Revenues" line.
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
    ], bold=True),
    _row("cost_of_revenue", "Cost of Revenue", "money", [
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold",
        "CostOfGoodsSold",
        "CostOfServices",
    ]),
    _row("gross_profit", "Gross Profit", "money", ["GrossProfit"], bold=True),
    _row("rd", "Research & Development", "money", [
        "ResearchAndDevelopmentExpense",
        "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
    ]),
    _row("sga", "Selling, General & Administrative", "money", [
        "SellingGeneralAndAdministrativeExpense",
        "GeneralAndAdministrativeExpense",
    ]),
    _row("marketing", "Selling & Marketing", "money", [
        "SellingAndMarketingExpense",
        "MarketingExpense",
    ]),
    _row("da", "Depreciation & Amortization", "money", [
        "DepreciationAndAmortization",
        "DepreciationDepletionAndAmortization",
        "DepreciationAmortizationAndAccretionNet",
        "Depreciation",
    ]),
    _row("restructuring", "Restructuring Charges", "money", [
        "RestructuringCharges",
        "BusinessCombinationAcquisitionRelatedCosts",
    ]),
    _row("other_opex", "Other Operating Expenses", "money", [
        "OtherOperatingIncomeExpenseNet",
        "OtherCostAndExpenseOperating",
    ]),
    _row("operating_income", "Operating Income", "money",
         ["OperatingIncomeLoss"], bold=True),
    _row("interest_expense", "Interest Expense", "money", [
        "InterestExpense",
        "InterestExpenseDebt",
    ]),
    _row("interest_income", "Interest Income", "money", [
        "InvestmentIncomeInterest",
        "InterestIncomeOperating",
        "InterestAndDividendIncomeOperating",
    ]),
    _row("other_non_operating", "Other Non-Operating Income", "money", [
        "NonoperatingIncomeExpense",
        "OtherNonoperatingIncomeExpense",
    ]),
    _row("pretax_income", "Pretax Income", "money", [
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
        "IncomeLossBeforeIncomeTaxes",
    ], bold=True),
    _row("tax_provision", "Income Tax Provision", "money",
         ["IncomeTaxExpenseBenefit"]),
    _row("net_income", "Net Income", "money", [
        "NetIncomeLoss",
        "ProfitLoss",
    ], bold=True),
    _row("minority_interest", "Net Income to Minority Interest", "money", [
        "NetIncomeLossAttributableToNoncontrollingInterest",
    ]),
    _row("preferred_dividends", "Preferred Dividends", "money", [
        "PreferredStockDividendsAndOtherAdjustments",
        "DividendsPreferredStock",
    ]),
    _row("net_income_to_common", "Net Income to Common", "money", [
        "NetIncomeLossAvailableToCommonStockholdersBasic",
    ], bold=True),
    _row("eps_basic", "EPS (Basic)", "per_share", [
        "EarningsPerShareBasic",
        "IncomeLossFromContinuingOperationsPerBasicShare",
    ]),
    _row("eps_diluted", "EPS (Diluted)", "per_share", [
        "EarningsPerShareDiluted",
        "IncomeLossFromContinuingOperationsPerDilutedShare",
    ]),
    _row("shares_basic_was", "Weighted Avg Shares (Basic)", "money", [
        "WeightedAverageNumberOfSharesOutstandingBasic",
    ]),
    _row("shares_diluted_was", "Weighted Avg Shares (Diluted)", "money", [
        "WeightedAverageNumberOfDilutedSharesOutstanding",
    ]),
]


_BALANCE_ROWS: List[Dict[str, Any]] = [
    _row("cash", "Cash & Equivalents", "money",
         ["CashAndCashEquivalentsAtCarryingValue", "Cash"], instant=True),
    _row("short_term_investments", "Short-Term Investments", "money", [
        "ShortTermInvestments",
        "AvailableForSaleSecuritiesCurrent",
        "MarketableSecuritiesCurrent",
    ], instant=True),
    _row("receivables", "Receivables", "money", [
        "AccountsReceivableNetCurrent",
        "ReceivablesNetCurrent",
    ], instant=True),
    _row("inventory", "Inventory", "money", ["InventoryNet"], instant=True),
    _row("prepaid_expenses", "Prepaid Expenses", "money", [
        "PrepaidExpenseAndOtherAssetsCurrent",
        "PrepaidExpenseCurrent",
    ], instant=True),
    _row("other_current_assets", "Other Current Assets", "money", [
        "OtherAssetsCurrent",
    ], instant=True),
    _row("total_current_assets", "Total Current Assets", "money",
         ["AssetsCurrent"], instant=True, bold=True),
    _row("ppe_gross", "PP&E (Gross)", "money", [
        "PropertyPlantAndEquipmentGross",
    ], instant=True),
    _row("accumulated_depreciation", "Accumulated Depreciation", "money", [
        "AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment",
    ], instant=True),
    _row("ppe_net", "PP&E (Net)", "money", [
        "PropertyPlantAndEquipmentNet",
    ], instant=True),
    _row("goodwill", "Goodwill", "money", ["Goodwill"], instant=True),
    _row("intangibles", "Intangible Assets", "money", [
        "IntangibleAssetsNetExcludingGoodwill",
        "FiniteLivedIntangibleAssetsNet",
    ], instant=True),
    _row("lt_investments", "Long-Term Investments", "money", [
        "LongTermInvestments",
        "AvailableForSaleSecuritiesNoncurrent",
        "MarketableSecuritiesNoncurrent",
    ], instant=True),
    _row("other_lt_assets", "Other Long-Term Assets", "money", [
        "OtherAssetsNoncurrent",
    ], instant=True),
    _row("total_assets", "Total Assets", "money", ["Assets"],
         instant=True, bold=True),
    _row("accounts_payable", "Accounts Payable", "money", [
        "AccountsPayableCurrent",
    ], instant=True),
    _row("accrued_liabilities", "Accrued Liabilities", "money", [
        "AccruedLiabilitiesCurrent",
        "EmployeeRelatedLiabilitiesCurrent",
    ], instant=True),
    _row("st_debt", "Short-Term Borrowings", "money", [
        "ShortTermBorrowings",
        "CommercialPaper",
    ], instant=True),
    _row("current_portion_lt_debt", "Current Portion of LT Debt", "money", [
        "LongTermDebtCurrent",
    ], instant=True),
    _row("deferred_revenue_current", "Deferred Revenue (Current)", "money", [
        "ContractWithCustomerLiabilityCurrent",
        "DeferredRevenueCurrent",
    ], instant=True),
    _row("other_current_liabilities", "Other Current Liabilities", "money", [
        "OtherLiabilitiesCurrent",
    ], instant=True),
    _row("total_current_liabilities", "Total Current Liabilities", "money",
         ["LiabilitiesCurrent"], instant=True, bold=True),
    _row("lt_debt", "Long-Term Debt", "money", [
        "LongTermDebtNoncurrent",
        "LongTermDebt",
    ], instant=True),
    _row("deferred_tax_lt", "Deferred Tax Liabilities (LT)", "money", [
        "DeferredIncomeTaxLiabilitiesNoncurrent",
        "DeferredTaxLiabilitiesNoncurrent",
    ], instant=True),
    _row("other_lt_liabilities", "Other Long-Term Liabilities", "money", [
        "OtherLiabilitiesNoncurrent",
    ], instant=True),
    _row("total_liabilities", "Total Liabilities", "money",
         ["Liabilities"], instant=True, bold=True),
    _row("common_stock", "Common Stock", "money", [
        "CommonStockValue",
    ], instant=True),
    _row("retained_earnings", "Retained Earnings", "money", [
        "RetainedEarningsAccumulatedDeficit",
    ], instant=True),
    _row("treasury_stock", "Treasury Stock", "money", [
        "TreasuryStockValue",
        "TreasuryStockCommonValue",
    ], instant=True),
    _row("aoci", "Accumulated OCI", "money", [
        "AccumulatedOtherComprehensiveIncomeLossNetOfTax",
    ], instant=True),
    _row("minority_interest_eq", "Minority Interest", "money", [
        "MinorityInterest",
    ], instant=True),
    _row("total_equity", "Total Stockholders' Equity", "money", [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ], instant=True, bold=True),
    _row("total_liab_and_equity", "Total Liabilities & Equity", "money",
         ["LiabilitiesAndStockholdersEquity"], instant=True, bold=True),
]


_CASH_FLOW_ROWS: List[Dict[str, Any]] = [
    _row("cf_net_income", "Net Income (CF)", "money", [
        "NetIncomeLoss",
        "ProfitLoss",
    ]),
    _row("cf_da", "Depreciation & Amortization", "money", [
        "DepreciationDepletionAndAmortization",
        "DepreciationAndAmortization",
        "DepreciationAmortizationAndAccretionNet",
        "Depreciation",
    ]),
    _row("cf_sbc", "Stock-Based Compensation", "money", [
        "ShareBasedCompensation",
    ]),
    _row("cf_deferred_taxes", "Deferred Income Taxes", "money", [
        "DeferredIncomeTaxExpenseBenefit",
        "DeferredIncomeTaxesAndTaxCredits",
    ]),
    _row("cf_ar_change", "Change in Receivables", "money", [
        "IncreaseDecreaseInAccountsReceivable",
    ]),
    _row("cf_inventory_change", "Change in Inventory", "money", [
        "IncreaseDecreaseInInventories",
    ]),
    _row("cf_ap_change", "Change in Payables", "money", [
        "IncreaseDecreaseInAccountsPayable",
    ]),
    _row("cf_other_operating", "Other Operating Activities", "money", [
        "OtherOperatingActivitiesCashFlowStatement",
        "OtherNoncashIncomeExpense",
    ]),
    _row("cf_from_operations", "Cash from Operations", "money", [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ], bold=True),
    _row("cf_capex", "Capital Expenditures", "money", [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ]),
    _row("cf_acquisitions", "Acquisitions", "money", [
        "PaymentsToAcquireBusinessesNetOfCashAcquired",
        "PaymentsForBusinessAcquisitionsNetOfCashAcquired",
    ]),
    _row("cf_investments_change", "Change in Investments", "money", [
        "PaymentsToAcquireInvestments",
    ]),
    _row("cf_other_investing", "Other Investing Activities", "money", [
        "PaymentsForProceedsFromOtherInvestingActivities",
        "OtherInvestingActivitiesCashFlowStatement",
    ]),
    _row("cf_from_investing", "Cash from Investing", "money", [
        "NetCashProvidedByUsedInInvestingActivities",
        "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations",
    ], bold=True),
    _row("cf_debt_issuance", "Debt Issuance", "money", [
        "ProceedsFromIssuanceOfLongTermDebt",
        "ProceedsFromIssuanceOfDebt",
        "ProceedsFromIssuanceOfShortTermDebt",
        "ProceedsFromShortTermDebt",
    ]),
    _row("cf_debt_repayment", "Debt Repayment", "money", [
        "RepaymentsOfLongTermDebt",
        "RepaymentsOfDebt",
        "RepaymentsOfShortTermDebt",
    ]),
    _row("cf_buybacks", "Stock Buybacks", "money", [
        "PaymentsForRepurchaseOfCommonStock",
    ]),
    _row("cf_dividends", "Dividends Paid", "money", [
        "PaymentsOfDividends",
        "PaymentsOfDividendsCommonStock",
    ]),
    _row("cf_other_financing", "Other Financing Activities", "money", [
        "ProceedsFromPaymentsForOtherFinancingActivities",
        "OtherFinancingActivitiesCashFlowStatement",
    ]),
    _row("cf_from_financing", "Cash from Financing", "money", [
        "NetCashProvidedByUsedInFinancingActivities",
        "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
    ], bold=True),
    _row("cf_fx_effect", "FX Effect on Cash", "money", [
        "EffectOfExchangeRateOnCashAndCashEquivalents",
        "EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ]),
    _row("cf_net_change_in_cash", "Net Change in Cash", "money", [
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
        "CashAndCashEquivalentsPeriodIncreaseDecrease",
    ], bold=True),
]


STATEMENT_LINE_ITEMS: Dict[StatementName, List[Dict[str, Any]]] = {
    "income": _INCOME_ROWS,
    "balance": _BALANCE_ROWS,
    "cash-flow": _CASH_FLOW_ROWS,
}


# ---------------------------------------------------------------------------
# Period indexing & extraction
# ---------------------------------------------------------------------------


def _is_quarterly_window(start: Optional[str], end: Optional[str]) -> bool:
    """True when a flow entry covers ~1 quarter (80–100 days)."""
    if not start or not end:
        return False
    try:
        ds = date.fromisoformat(start)
        de = date.fromisoformat(end)
        days = (de - ds).days
        return 80 <= days <= 100
    except Exception:
        return False


def _is_annual_window(start: Optional[str], end: Optional[str]) -> bool:
    """True when a flow entry covers ~1 year (340–380 days)."""
    if not start or not end:
        return False
    try:
        ds = date.fromisoformat(start)
        de = date.fromisoformat(end)
        days = (de - ds).days
        return 340 <= days <= 380
    except Exception:
        return False


def _ytd_months(start: Optional[str], end: Optional[str]) -> Optional[int]:
    """Months covered by a YTD flow entry (used for CF YTD math)."""
    if not start or not end:
        return None
    try:
        ds = date.fromisoformat(start)
        de = date.fromisoformat(end)
        days = (de - ds).days
        # 90, 180, 270, 365 → 3, 6, 9, 12 months
        if 80 <= days <= 100:
            return 3
        if 170 <= days <= 195:
            return 6
        if 260 <= days <= 285:
            return 9
        if 340 <= days <= 380:
            return 12
        return None
    except Exception:
        return None


def _label_for_end(end: str) -> str:
    """'2024-06-30' → 'Jun \\'24'."""
    try:
        d = date.fromisoformat(end)
        return d.strftime("%b '%y")
    except Exception:
        return end


def _entries_merged(facts: dict, namespace: str, tags: List[str]) -> List[dict]:
    """Merge entries across all candidate tags into one list.

    Some filers switch concepts mid-history (MSFT moved from CostOfRevenue to
    CostOfGoodsAndServicesSold around FY2019). The original
    ``_units_for(facts, ...)`` picks the first tag with *any* usable USD
    entries, which silently masks coverage gaps in the recent period when the
    older tag still has stale rows. Merging is safe because XBRL entries are
    period-tagged via ``end`` + ``form`` + ``fp``; we just collect candidates
    and let the per-period picker resolve duplicates the same way it does for
    a single tag (latest filed wins on a (end, form, fp) collision).
    """
    section = _facts_section(facts, namespace)
    out: List[dict] = []
    for tag in tags:
        node = section.get(tag)
        if not node:
            continue
        units = node.get("units") or {}
        for unit_key in ("USD", "USD/shares", "shares"):
            arr = units.get(unit_key)
            if arr:
                out.extend(arr)
                break
    return out


def _pick_annual_value(
    entries: List[dict],
    fy_end: str,
    instant: bool,
) -> Optional[float]:
    """For annual mode: pick the FY value ending on ``fy_end``.

    Instant rows: balance at ``fy_end``; prefer 10-K, fall back to a 10-Q
    closing balance at the same date if needed.
    Flow rows: 12-month flow ending at ``fy_end``, fp=FY, form=10-K.
    """
    cleaned = _normalize_filing_entries(entries)
    if not cleaned:
        return None

    if instant:
        # latest-filed wins among entries whose end == fy_end
        candidates = [e for e in cleaned if e.get("end") == fy_end]
        if not candidates:
            return None
        # prefer 10-K, then latest filed
        candidates.sort(key=lambda e: (e.get("form", "") == "10-K", e.get("filed", "")), reverse=True)
        try:
            return float(candidates[0]["val"])
        except (KeyError, TypeError, ValueError):
            return None

    # Flow row: prefer FY 10-K covering ~1 year ending at fy_end.
    fy_candidates = [
        e for e in cleaned
        if e.get("end") == fy_end
        and e.get("fp") == "FY"
        and e.get("form", "").startswith("10-K")
        and _is_annual_window(e.get("start"), fy_end)
    ]
    if fy_candidates:
        fy_candidates.sort(key=lambda e: e.get("filed", ""), reverse=True)
        try:
            return float(fy_candidates[0]["val"])
        except (KeyError, TypeError, ValueError):
            return None
    # Some filers tag "frame": "CY2023" or use 10-Q YTD-12 — last-resort match
    # any entry covering an annual window ending at fy_end.
    for e in cleaned:
        if e.get("end") == fy_end and _is_annual_window(e.get("start"), fy_end):
            try:
                return float(e["val"])
            except (KeyError, TypeError, ValueError):
                continue
    return None


def _pick_quarterly_value(
    entries: List[dict],
    q_end: str,
    instant: bool,
    fy_ends: List[str],
    is_cash_flow: bool,
) -> Optional[float]:
    """For quarterly mode: pick the 3-month value ending at ``q_end``.

    - Instant rows: balance at ``q_end``.
    - Income/expense flow rows: prefer entries with start..end ≈ 90 days.
      For Q4 (q_end ∈ fy_ends), derive FY − (Q1+Q2+Q3) when no direct quarterly
      entry exists.
    - Cash-flow rows: 10-Q reports YTD only. Subtract prior YTD from current
      YTD to get the 3-month flow. For Q4, FY − YTD9M.
    """
    cleaned = _normalize_filing_entries(entries)
    if not cleaned:
        return None

    if instant:
        candidates = [e for e in cleaned if e.get("end") == q_end]
        if not candidates:
            return None
        candidates.sort(key=lambda e: e.get("filed", ""), reverse=True)
        try:
            return float(candidates[0]["val"])
        except (KeyError, TypeError, ValueError):
            return None

    # Flow: try direct quarterly window first.
    if not is_cash_flow:
        direct = [
            e for e in cleaned
            if e.get("end") == q_end and _is_quarterly_window(e.get("start"), q_end)
        ]
        if direct:
            direct.sort(key=lambda e: e.get("filed", ""), reverse=True)
            try:
                return float(direct[0]["val"])
            except (KeyError, TypeError, ValueError):
                pass

    # Q4 synthesis path: Q4 = FY − (sum of YTD9M or Q1+Q2+Q3).
    if q_end in fy_ends:
        fy_val = _pick_annual_value(entries, q_end, instant=False)
        if fy_val is None:
            return None
        # Find the YTD9M entry ending in the same fiscal year.
        same_fy = [
            e for e in cleaned
            if (e.get("end") or "")[:4] == q_end[:4]
            and _ytd_months(e.get("start"), e.get("end")) == 9
        ]
        if same_fy:
            same_fy.sort(key=lambda e: e.get("end", ""), reverse=True)
            try:
                ytd9 = float(same_fy[0]["val"])
                v = fy_val - ytd9
                if abs(v) < EPSILON_M * UNIT_DIVISOR:
                    return 0.0
                return v
            except (KeyError, TypeError, ValueError):
                return None
        # Fall back to summing 3 quarterly entries from earlier in the FY.
        if not is_cash_flow:
            qs = [
                e for e in cleaned
                if (e.get("end") or "")[:4] == q_end[:4]
                and _is_quarterly_window(e.get("start"), e.get("end"))
                and (e.get("end") or "") < q_end
            ]
            if len(qs) >= 3:
                try:
                    qsum = sum(float(e["val"]) for e in sorted(qs, key=lambda x: x.get("end", ""))[:3])
                    v = fy_val - qsum
                    if abs(v) < EPSILON_M * UNIT_DIVISOR:
                        return 0.0
                    return v
                except (KeyError, TypeError, ValueError):
                    return None
        return None

    # Cash-flow YTD math: 3-month = current_YTD − prior_YTD within the same fiscal year.
    if is_cash_flow:
        # Find an entry ending at q_end whose start is the FY-start.
        ytd_now = next(
            (e for e in cleaned if e.get("end") == q_end
             and _ytd_months(e.get("start"), q_end) is not None),
            None,
        )
        if ytd_now is None:
            return None
        months_now = _ytd_months(ytd_now.get("start"), q_end)
        if months_now == 3:
            try:
                return float(ytd_now["val"])
            except (KeyError, TypeError, ValueError):
                return None
        # Need prior YTD with months_now − 3 months ending in the same FY.
        prior_months = (months_now or 0) - 3
        prior = [
            e for e in cleaned
            if (e.get("end") or "")[:4] == q_end[:4]
            and (e.get("end") or "") < q_end
            and _ytd_months(e.get("start"), e.get("end")) == prior_months
        ]
        if not prior:
            return None
        prior.sort(key=lambda e: e.get("end", ""), reverse=True)
        try:
            v = float(ytd_now["val"]) - float(prior[0]["val"])
            if abs(v) < EPSILON_M * UNIT_DIVISOR:
                return 0.0
            return v
        except (KeyError, TypeError, ValueError):
            return None

    return None


def _canonical_periods(facts: dict, period: Period) -> Tuple[List[str], Optional[str]]:
    """Period-end discovery driven by the *income statement* flow rows only.

    Balance-sheet rows are all instant (no ``start``) so we can't validate
    annual/quarterly windows from them. Cash-flow rows are all flows but
    they're a smaller, more sparsely tagged set than income (fewer filers
    report every line). The income statement is the authoritative source —
    every public filer reports revenue or net income, both as 12-month/3-month
    flows with consistent tagging.
    """
    return _enumerate_periods(facts, _INCOME_ROWS, period)


def _enumerate_periods(
    facts: dict,
    rows: List[Dict[str, Any]],
    period: Period,
) -> Tuple[List[str], Optional[str]]:
    """Return ([fiscal-period-end-dates desc], asOf-filing-date).

    Period-end discovery uses *flow* rows only — flow tags carry both ``start``
    and ``end`` so we can require a true 12-month (annual) or ~3-month
    (quarterly) window. Without this filter, prior-period comparison entries
    inside 10-Q filings (where fp="FY" appears with a quarterly window for
    the prior year) would inflate the period set with non-canonical dates.

    Annual: 12-month flow ending dates from 10-K + fp=FY filings.
    Quarterly: 3-month flow ending dates from 10-Q filings + the FY-ends (Q4
    is synthesised).
    """
    fy_ends: set = set()
    q_ends: set = set()
    latest_filed: Optional[str] = None

    for row in rows:
        # Skip instant (balance-sheet) rows for period discovery — they don't
        # carry a `start`, so we can't validate the window length. Their
        # values are looked up at FY-/Q-ends sourced from flow rows.
        if row.get("instant"):
            ns = row.get("namespace", "us-gaap")
            node = _units_for(facts, ns, row["tags"])
            if node:
                for e in _normalize_filing_entries(node[1]):
                    filed = e.get("filed") or ""
                    if filed > (latest_filed or ""):
                        latest_filed = filed
            continue

        ns = row.get("namespace", "us-gaap")
        node = _units_for(facts, ns, row["tags"])
        if not node:
            continue
        cleaned = _normalize_filing_entries(node[1])
        for e in cleaned:
            form = e.get("form", "")
            end = e.get("end")
            start = e.get("start")
            if not end:
                continue
            filed = e.get("filed") or ""
            if filed > (latest_filed or ""):
                latest_filed = filed
            if (
                form.startswith("10-K")
                and e.get("fp") == "FY"
                and _is_annual_window(start, end)
            ):
                fy_ends.add(end)
            elif (
                form.startswith("10-Q")
                and _is_quarterly_window(start, end)
            ):
                q_ends.add(end)

    if period == "annual":
        ends = sorted(fy_ends, reverse=True)
    else:
        ends = sorted(q_ends | fy_ends, reverse=True)

    return ends, latest_filed


def _scale_value(
    raw: Optional[float],
    fmt: str,
    sign: str,
) -> Optional[float]:
    if raw is None:
        return None
    if not math.isfinite(raw):
        return None
    if sign == "negate":
        raw = -raw
    if fmt == "per_share":
        return round(raw, 4)
    return round(raw / UNIT_DIVISOR, 4)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _statement_cache_path(cik: str, statement: StatementName, period: Period) -> pathlib.Path:
    return STATEMENTS_CACHE_DIR / f"CIK{cik}-{statement}-{period}.json"


def _read_cached(cik: str, statement: StatementName, period: Period) -> Optional[Dict[str, Any]]:
    path = _statement_cache_path(cik, statement, period)
    if not path.exists():
        return None
    age = time.time() - path.stat().st_mtime
    if age >= STATEMENTS_TTL_SEC:
        return None
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return None
    # Treat older-schema cache files as misses so a fresh extraction runs.
    if not isinstance(payload, dict) or payload.get("_schema_version") != SCHEMA_VERSION:
        return None
    return payload


def _safe_div(num: Optional[float], den: Optional[float]) -> Optional[float]:
    if num is None or den is None or den == 0:
        return None
    return num / den


def _inject_income_derived_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Insert YoY %Chg + margin + effective-tax-rate rows into the income statement.

    Mirrors the derived rows the legacy yfinance income statement displayed
    (see fundamentals.py:_INCOME_STMT_ROW_META). Rows are inserted directly
    after their anchor so the table reads naturally:

        Revenue              123.4   100.0
        Total Revenues %Chg   23.4%    —     (anchor: revenue)
        Gross Profit          50.0    40.0
        Gross Profit Margin   40.5%   40.0%  (anchor: gross_profit)
        ...

    Values arrive most-recent-first; the YoY change at index i uses index i+1
    as the prior period (so the oldest column is always None).
    """
    by_key: Dict[str, List[Optional[float]]] = {r["key"]: r["values"] for r in rows}

    def _get(k: str) -> List[Optional[float]]:
        return by_key.get(k, [])

    revenue = _get("revenue")
    gross_profit = _get("gross_profit")
    operating_income = _get("operating_income")
    pretax_income = _get("pretax_income")
    tax_provision = _get("tax_provision")

    revenue_chg: List[Optional[float]] = []
    for i, v in enumerate(revenue):
        prior = revenue[i + 1] if (i + 1) < len(revenue) else None
        revenue_chg.append((v / prior - 1) if (v is not None and prior not in (None, 0)) else None)

    gross_margin = [_safe_div(g, r) for g, r in zip(gross_profit, revenue)]
    operating_margin = [_safe_div(o, r) for o, r in zip(operating_income, revenue)]
    effective_tax_rate = [_safe_div(t, p) for t, p in zip(tax_provision, pretax_income)]

    def _derived(key: str, label: str, values: List[Optional[float]]) -> Dict[str, Any]:
        return {
            "key": key,
            "label": label,
            "format": "pct",
            "bold": False,
            "italic": True,
            "values": values,
        }

    insert_after: Dict[str, Dict[str, Any]] = {
        "revenue": _derived("revenue_growth", "Total Revenues %Chg", revenue_chg),
        "gross_profit": _derived("gross_margin", "Gross Profit Margin", gross_margin),
        "operating_income": _derived("operating_margin", "Operating Margin", operating_margin),
        "tax_provision": _derived("effective_tax_rate", "Effective Tax Rate", effective_tax_rate),
    }

    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(r)
        if r["key"] in insert_after:
            out.append(insert_after[r["key"]])
    return out


def _empty_response(ticker: str, period: Period, message: str) -> Dict[str, Any]:
    return {
        "ticker": ticker.upper(),
        "currency": "USD",
        "unit": "M",
        "period": period,
        "years": [],
        "years_source": [],
        "rows": [],
        "asOf": None,
        "source": "sec-edgar",
        "message": message,
    }


def _extract_statement(
    ticker: str,
    statement: StatementName,
    period: Period,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    ticker_u = ticker.upper()
    cik = get_cik_for_ticker(ticker_u)
    if cik is None:
        return _empty_response(ticker_u, period, "No SEC CIK for ticker (foreign filer or unknown)")

    if not force:
        cached = _read_cached(cik, statement, period)
        if cached is not None:
            return cached

    facts = fetch_company_facts(cik, force=force)
    if not facts:
        return _empty_response(ticker_u, period, "SEC companyfacts unavailable")

    # Determine reporting currency from any USD/non-USD presence — for now we
    # only support USD filers (the value-pickers all use USD via _units_for).
    rows_meta = STATEMENT_LINE_ITEMS[statement]
    # Period set comes from the income statement flow rows (canonical),
    # not from this statement's own rows — BS rows are all instant and can't
    # supply the start..end window check we need to filter out 10-Q
    # prior-period comparisons that XBRL records as fp=FY.
    period_ends, latest_filed = _canonical_periods(facts, period)

    if not period_ends:
        return _empty_response(ticker_u, period, "No 10-K/10-Q periods found")

    fy_ends_for_q4: List[str] = []
    if period == "quarterly":
        annual_ends, _ = _canonical_periods(facts, "annual")
        fy_ends_for_q4 = list(set(annual_ends))

    # Build the rows.
    is_cash_flow_stmt = (statement == "cash-flow")
    out_rows: List[Dict[str, Any]] = []
    for row in rows_meta:
        ns = row.get("namespace", "us-gaap")
        entries = _entries_merged(facts, ns, row["tags"])
        values: List[Optional[float]] = []
        for end in period_ends:
            if not entries:
                values.append(None)
                continue
            if period == "annual":
                raw = _pick_annual_value(entries, end, instant=row["instant"])
            else:
                raw = _pick_quarterly_value(
                    entries,
                    end,
                    instant=row["instant"],
                    fy_ends=fy_ends_for_q4,
                    is_cash_flow=is_cash_flow_stmt,
                )
            values.append(_scale_value(raw, row["format"], row["sign"]))
        out_rows.append({
            "key": row["key"],
            "label": row["label"],
            "format": row["format"],
            "bold": row["bold"],
            "italic": row["italic"],
            "values": values,
        })

    if statement == "income":
        out_rows = _inject_income_derived_rows(out_rows)

    result: Dict[str, Any] = {
        "ticker": ticker_u,
        "currency": "USD",
        "unit": "M",
        "period": period,
        "years": [_label_for_end(e) for e in period_ends],
        "years_source": ["sec-edgar"] * len(period_ends),
        "year_ends": period_ends,  # raw ISO dates for downstream consumers (ratios, splice)
        "rows": out_rows,
        "asOf": latest_filed,
        "source": "sec-edgar",
        "_schema_version": SCHEMA_VERSION,
    }

    try:
        STATEMENTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        atomic_write_json(_statement_cache_path(cik, statement, period), result)
    except Exception as exc:
        log.warning("statement cache write failed for %s/%s/%s: %s", ticker_u, statement, period, exc)

    return result


def get_income_statement(ticker: str, period: Period = "annual", *, force: bool = False) -> Dict[str, Any]:
    return _extract_statement(ticker, "income", period, force=force)


def get_balance_sheet(ticker: str, period: Period = "annual", *, force: bool = False) -> Dict[str, Any]:
    return _extract_statement(ticker, "balance", period, force=force)


def get_cash_flow(ticker: str, period: Period = "annual", *, force: bool = False) -> Dict[str, Any]:
    return _extract_statement(ticker, "cash-flow", period, force=force)
