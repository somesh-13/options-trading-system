"""Parse Exhibit 99.1 earnings press releases into structured numbers.

Companies file detailed Q1/Q2/Q3 income statements as Exhibit 99.1 of an 8-K
on the day of their earnings call — typically 30+ days before yfinance's
``quarterly_income_stmt`` reflects the new quarter, and ahead of the 10-Q.
This module turns that exhibit's cleaned text into a small dict that can be
merged into ``fundamentals.get_income_statement_history`` so the Financials tab
shows fresh quarterly numbers immediately after release.

The parser is deliberately regex-based against the cleaned text already cached
on disk by ``sec_exhibits``. Earnings releases vary by issuer but the anchor
phrases ("Three Months Ended", "Net revenues", "Operating income",
"Net income (loss)", "Earnings per diluted share") are stable enough across
S&P 500 filers that a small set of patterns captures most of them. Failures
are non-fatal — we return None and the caller falls back to yfinance.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Dict, Optional, Tuple

from .sec_exhibits import fetch_exhibit_991_full_text, fetch_recent_filings

log = logging.getLogger(__name__)

# 30 minutes — earnings releases are immutable once filed but we still want a
# cap so a misclassified 8-K doesn't pin a stale value forever.
_CACHE_TTL_SEC = 30 * 60
_cache: Dict[str, Tuple[float, Optional[Dict]]] = {}

# Filings older than this aren't candidates for "latest earnings" — the user
# wants what was just released, not the same-quarter announcement from a year
# ago.
_MAX_FILING_AGE_DAYS = 120


_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def _parse_period_end(label: str) -> Optional[datetime]:
    """Parse 'March 31, 2026' → datetime(2026, 3, 31)."""
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})", label.strip())
    if not m:
        return None
    month = _MONTHS.get(m.group(1).lower())
    if not month:
        return None
    try:
        return datetime(int(m.group(3)), month, int(m.group(2)))
    except ValueError:
        return None


def _parse_money(raw: str) -> Optional[float]:
    """'$ 8,353' / '8,353' / '(123)' → 8353.0 / 8353.0 / -123.0."""
    s = raw.strip().replace(",", "").replace("$", "").strip()
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


_TABULAR_VALUE = re.compile(
    # A "table value" is one of:
    #   * $-prefixed:           "$ 8,353" / "$1.21"
    #   * comma-grouped:        "143,756" (≥1,000)
    #   * parens-loss ≥3 dig:   "(581)" / "(114,316)"
    #   * decimal:              "1.21"
    #   * bare 3+ digit int:    "382" (SHOP op income — year-filtered later)
    # Bare 1-2 digit ints are rejected so footnote markers like ``(1)`` and
    # cosmetic small numbers don't pollute the column list. 4-digit years
    # (1900–2099) are filtered post-match.
    # Paren variants allow a small amount of inner whitespace because the HTML
    # cleaner sometimes leaves a space before the closing paren (CLSK: the cell
    # ``(316,554 )`` survives _clean_html as ``(316,554 )``). Without the
    # tolerance, the bare-digit alternative matches ``316,554`` and the sign
    # gets dropped.
    r"(?:"
    r"\$\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?"          # $-prefixed
    r"|\(\s{0,3}\d{3,}(?:,\d{3})*(?:\.\d+)?\s{0,3}\)"   # parens-loss 3+ digits
    r"|\(\s{0,3}\d{1,3}(?:,\d{3})+(?:\.\d+)?\s{0,3}\)"  # parens-loss comma-grouped
    r"|\d{1,3}(?:,\d{3})+(?:\.\d+)?"               # comma-grouped
    r"|\d+\.\d+"                                    # decimal (EPS, etc.)
    r"|\d{3,}"                                      # bare 3+ digit int
    r")"
)

# Section delimiters — we stop scanning forward when we hit one, because a
# new section's first value should not be attributed to the prior label.
_ROW_BREAK = re.compile(
    r"\b(?:Cost of (?:revenues?|goods)|Total operating|Operating (?:income|expenses)|"
    r"Pretax|Provision for|Diluted|Basic earnings per|Earnings per|Loss per share|"
    r"Net (?:income|loss|earnings|revenues?|sales)|Compensation and benefits|"
    r"General and administrative|Depreciation|Research|Income before|Other income|"
    r"Interest expense|Interest income|Total non-operating|Three Months Ended|"
    r"Twelve Months Ended)\b",
    re.IGNORECASE,
)

# Words that, when sitting between a row label and the first numeric, signal
# we're reading prose — e.g. "Revenue of $35 million", "Revenue grew 34% to
# $3.17 billion". Tabular rows have only a category name or whitespace
# between label and value.
_PROSE_INTRO = re.compile(
    r"\b(?:of|to|was|were|is|are|by|at|grew|fell|reached|increased|decreased|"
    r"rose|dropped|climbed|surged|jumped|amounted)\b",
    re.IGNORECASE,
)


def _values_after(text: str, label_re: str, max_values: int = 4) -> list:
    """Return numeric tokens that follow ``label_re`` in a tabular row.

    Skips prose mentions like ``Net revenues increased 7% to $8.4 billion``
    by requiring the first numeric token to be a "real" tabular value
    (``$``-prefixed, comma-grouped, parens-loss with ≥3 digits, or a
    decimal). Allows category sublabels to sit between the row label and
    the first value — e.g. CIFR's ``Revenue - bitcoin mining $ 34,838`` and
    PYPL's ``Net revenues $ 8,353``.

    Earnings tables have rows like:
      * PYPL/MSFT: ``Net revenues $ 8,353 $ 7,791``
      * AAPL:      ``Total net sales (1) 143,756 124,300``
      * AMZN:      ``Net product sales $ 63,970 $ 71,304`` (cols are 2025 2026)
      * CIFR:      ``Revenue - bitcoin mining $ 34,838 $ 48,959``
      * SHOP:      ``Net loss (581) (682)``

    Stops scanning at the next section header (Cost of revenue, Net income,
    Total operating, etc.) to avoid bleeding into adjacent rows.
    """
    label_pat = re.compile(label_re, re.IGNORECASE)
    for m in label_pat.finditer(text):
        tail = text[m.end(): m.end() + 240]
        # Cut at the next section delimiter so a values scan can't bleed
        # into the next row.
        brk = _ROW_BREAK.search(tail)
        scan = tail[: brk.start()] if brk else tail
        # Find the first tabular value that ISN'T a year (1900–2099 bare ints
        # that drift in from header rows like "Three Months Ended ... 2026 2025").
        first_val = None
        for cand in _TABULAR_VALUE.finditer(scan):
            if not _is_year_bare(cand.group(0)):
                first_val = cand
                break
        if not first_val:
            continue
        # Reject prose mentions: if a stopword like "of"/"to"/"increased"
        # sits between the label and the first non-year value, this is text,
        # not a row. Done after year-filtering so a stray "2026" header
        # doesn't shorten the gap and let the prose pass through.
        gap = scan[: first_val.start()]
        if _PROSE_INTRO.search(gap):
            continue
        out: list[float] = []
        for tok in _TABULAR_VALUE.finditer(scan, first_val.start()):
            raw = tok.group(0).strip()
            if _is_year_bare(raw):
                continue
            v = _parse_money(raw)
            if v is None:
                continue
            out.append(v)
            if len(out) >= max_values:
                break
        if out:
            return out
    return []


def _is_year_bare(raw: str) -> bool:
    """True for bare 4-digit integers that fall in the 1900–2099 calendar
    range (likely a column-header year, not a value)."""
    clean = raw.replace("$", "").replace("(", "").replace(")", "").replace(",", "").replace(" ", "")
    if "." in clean:
        return False
    try:
        iv = int(clean)
    except ValueError:
        return False
    return 1900 <= iv <= 2099


def _first_money_after(text: str, label_re: str, prefer_index: int = 0) -> Optional[float]:
    """Pick a single numeric value following ``label_re``.

    ``prefer_index`` selects which of the row's columns to take — 0 for
    "current period is leftmost" (the common case), -1 for AMZN-style
    "current period is rightmost".
    """
    vals = _values_after(text, label_re, max_values=4)
    if not vals:
        return None
    if prefer_index < 0 or prefer_index >= len(vals):
        return vals[-1] if prefer_index == -1 else None
    return vals[prefer_index]


def _first_per_share(text: str, label_re: str, prefer_index: int = 0) -> Optional[float]:
    """Per-share values are formatted like '$ 1.21' (always two-decimal).

    Issuers with reverse column order (AMZN) need ``prefer_index=-1``.
    """
    pat = re.compile(label_re + r"\s*", re.IGNORECASE)
    m = pat.search(text)
    if not m:
        return None
    tail = text[m.end(): m.end() + 120]
    # Parens variant matched first so loss-position rows like ``$ (1.35 ) $ 0.85``
    # (CLSK; the HTML cleaner leaves a space before the closing paren) yield
    # ``(1.35 )`` as the first captured value, not the prior-year ``0.85``.
    vals = re.findall(r"\$?\s*(\(\s{0,3}\d+\.\d{2}\s{0,3}\)|\d+\.\d{2})", tail)
    if not vals:
        return None
    parsed = [_parse_money(v) for v in vals]
    parsed = [p for p in parsed if p is not None]
    if not parsed:
        return None
    if prefer_index < 0:
        return parsed[-1]
    return parsed[prefer_index] if prefer_index < len(parsed) else None


def _detect_currency(text: str) -> str:
    """Identify the reporting currency of the press release.

    Most filers report in USD. Chinese ADRs (BABA, JD, NIO, BIDU, PDD, …)
    report in RMB even though they trade as USD ADRs on US exchanges, and
    the press release sometimes provides a parallel USD column for ADR
    investors.

    Returns the ISO currency code ("USD" or "CNY"). Could be extended for
    EUR (SAP, ASML — though they file 6-Ks rarely), JPY, etc.
    """
    # Look for RMB/Renminbi/Chinese yuan in the income-table neighborhood,
    # not just buried in a footnote about exchange-rate sensitivity.
    period_idx = re.search(r"(?i)Three Months Ended", text)
    window_start = period_idx.start() if period_idx else 0
    window = text[window_start: window_start + 1500]
    rmb_in_table = re.search(r"\b(?:RMB|Renminbi|Chinese\s+yuan)\b", window, re.IGNORECASE)
    if rmb_in_table:
        return "CNY"
    return "USD"


# CNY/USD spot rate cache. Refreshed at most daily — quarterly statements
# are timestamped to a quarter-end date so the rate doesn't need to be
# minute-fresh, just within the right ~quarter.
_FX_CACHE: Dict[str, Tuple[float, float]] = {}
_FX_TTL_SEC = 24 * 3600


def _yfinance_cny_per_usd() -> Optional[float]:
    """Spot CNY-per-USD from yfinance ``USDCNY=X``. Cached daily.

    Returns ``None`` if yfinance is unreachable; the caller falls back to
    a sensible static rate so a network blip doesn't poison the pipeline.
    """
    cached = _FX_CACHE.get("CNY")
    now = time.time()
    if cached and (now - cached[0]) < _FX_TTL_SEC:
        return cached[1]
    try:
        from data.market_provider import get_fx_spot  # local import — avoids circular load
        rate = get_fx_spot("USDCNY=X")
        if rate and 5 < float(rate) < 12:  # plausible band for USD/CNY
            _FX_CACHE["CNY"] = (now, float(rate))
            return float(rate)
    except Exception as exc:
        log.warning("USDCNY=X fetch failed: %s", exc)
    return None


def _detect_inline_fx_rate(text: str) -> Optional[float]:
    """Issuers often disclose the exchange rate they used right in the press
    release: "convenience translation at the noon buying rate of RMB7.0688
    to US$1.00". Returns CNY-per-USD, or ``None`` if no disclosure.

    Using the issuer's own rate matches the parenthetical USD figures in
    the same release exactly, which makes the conversion trustworthy.
    """
    pat = re.compile(
        r"(?i)RMB\s*([\d.]+)\s*(?:=|to|per)\s*(?:US\$|USD|U\.S\.\s*\$)?\s*1\.0*\s*(?:US\$|USD|U\.S\.\s*\$)?",
    )
    m = pat.search(text)
    if not m:
        return None
    try:
        rate = float(m.group(1))
    except ValueError:
        return None
    if 5 < rate < 12:
        return rate
    return None


def _cny_to_usd_rate(text: str) -> Tuple[float, str]:
    """Return (CNY-per-USD, source) for converting issuer values into USD.

    Order of preference:
      1. The rate the issuer disclosed in this same press release.
      2. yfinance USDCNY=X spot, daily-cached.
      3. A static fallback so the pipeline never crashes — slightly stale
         is much better than failing the whole extract.
    """
    inline = _detect_inline_fx_rate(text)
    if inline:
        return inline, "press_release"
    spot = _yfinance_cny_per_usd()
    if spot:
        return spot, "yfinance_USDCNY"
    # Static fallback — current-era plausible rate. Refreshed when this
    # file is updated; pipeline-correctness over precision.
    return 7.10, "static_fallback"


def _detect_unit_divisor(text: str) -> float:
    """Return the divisor that converts raw values into millions.

    Most issuers (S&P 500) report ``In millions``. Smaller-cap companies
    sometimes report ``In thousands`` (CIFR, many bitcoin miners and
    biotechs). A handful of mega-caps with very small per-share components
    use ``In billions`` for headline rows.

    Captions usually appear adjacent to the relevant statement table —
    "STATEMENTS OF OPERATIONS (in thousands, except per share amounts)".
    Issuers don't typically mix units across statements in the same 8-K, so
    we search the entire body and return the first hit. Defaults to
    millions when ambiguous.
    """
    # Prefer captions that sit adjacent to "STATEMENTS OF OPERATIONS" — that
    # nails the income statement specifically. Fall back to any caption.
    operations_match = re.search(
        r"(?i)Statements?\s+of\s+Operations[^()]{0,80}\(\s*in\s+(thousands|millions|billions)",
        text,
    )
    if operations_match:
        unit = operations_match.group(1).lower()
        if unit == "thousands":
            return 1000.0
        if unit == "billions":
            return 0.001
        return 1.0
    if re.search(r"(?i)\(\s*in\s+thousands", text):
        return 1000.0
    if re.search(r"(?i)\(\s*in\s+billions", text):
        return 0.001
    return 1.0


def _quarter_label(period_end: datetime) -> str:
    """datetime(2026, 3, 31) → 'Q1 2026'. Calendar-quarter heuristic."""
    q = (period_end.month - 1) // 3 + 1
    return f"Q{q} {period_end.year}"


# Issuers with non-calendar fiscal years (CLSK fiscal year ends Sep 30; their
# Dec-31 quarter is fiscal Q1, not calendar Q4) usually announce the right
# label in the press-release title — "First Quarter Fiscal 2026 Results".
# When that's present, trust it; otherwise fall back to calendar.
_QNUM_FROM_WORD = {
    "first": 1, "second": 2, "third": 3, "fourth": 4,
    "1st": 1, "2nd": 2, "3rd": 3, "4th": 4,
    "q1": 1, "q2": 2, "q3": 3, "q4": 4,
}
_FISCAL_Q_TITLE = re.compile(
    r"(?i)\b(First|Second|Third|Fourth|1st|2nd|3rd|4th|Q1|Q2|Q3|Q4)\s+"
    r"Quarter\s+(?:of\s+)?Fiscal\s+(?:Year\s+)?(\d{4})\b"
)
_FISCAL_Q_ALT = re.compile(
    r"(?i)\bFiscal\s+(?:Year\s+)?(\d{4})\s+"
    r"(First|Second|Third|Fourth|Q1|Q2|Q3|Q4)\s+Quarter\b"
)


def _detect_fiscal_quarter_label(text: str) -> Optional[str]:
    """Returns 'Q1 FY2026' if the press release labels itself with a fiscal
    quarter. None when no fiscal-year wording is present — caller falls back
    to a calendar-quarter label."""
    m = _FISCAL_Q_TITLE.search(text)
    if m:
        q = _QNUM_FROM_WORD.get(m.group(1).lower())
        if q:
            return f"Q{q} FY{m.group(2)}"
    m = _FISCAL_Q_ALT.search(text)
    if m:
        q = _QNUM_FROM_WORD.get(m.group(2).lower())
        if q:
            return f"Q{q} FY{m.group(1)}"
    return None


def parse_earnings_release(text: str) -> Optional[Dict]:
    """Extract the structured headline numbers from a cleaned press release.

    Returns ``None`` if no period can be identified — that's the strongest
    signal that this exhibit isn't actually an earnings release (e.g. an 8-K
    announcing an acquisition or a dividend declaration). Individual fields
    may be ``None`` if the issuer uses non-standard labels; callers must
    null-check.
    """
    if not text:
        return None

    # Find all "Three Months Ended" anchors and take the most recent quarter-
    # end date. Most issuers (PYPL, MSFT, AAPL) list current-year first; AMZN
    # lists prior-year first. Match case-insensitively — SHOP uses
    # "Three months ended" (lowercase 'm').
    period_end: Optional[datetime] = None
    column_index = 0  # 0 = current period is leftmost; -1 = rightmost.
    for m in re.finditer(
        r"(?i)Three Months Ended\s+([A-Z][a-z]+\s+\d{1,2}),\s*((?:\d{4}\s+){0,3}\d{4})",
        text,
    ):
        month_day = m.group(1)
        years = [int(y) for y in re.findall(r"\d{4}", m.group(2))]
        if not years:
            continue
        max_year = max(years)
        d = _parse_period_end(f"{month_day}, {max_year}")
        if not d:
            continue
        if period_end is None or d > period_end:
            period_end = d
            # If the years are in ascending order (e.g. "2025 2026"),
            # current-period values are rightmost. Descending → leftmost.
            column_index = -1 if years == sorted(years) and len(years) > 1 else 0
    if not period_end:
        return None

    # Detect reporting currency. Chinese ADRs (BABA, JD, NIO, BIDU, PDD) report
    # in RMB but trade as USD ADRs in the US, so we normalize all output to USD
    # millions for downstream consumers (yfinance / FinancialsPanel).
    currency = _detect_currency(text)

    # Money-column index for value extraction. For BABA-style multi-currency
    # tables ("RMB RMB US$ %YoY") column 2 holds the issuer-converted USD
    # number — preferring it gives us the issuer's exact rate and matches
    # the parenthetical ``(US$X)`` summary numbers in the same release.
    money_col_index = column_index
    if currency == "CNY":
        money_col_index = 2  # default to the third numeric column (US$)

    def _money(*labels: str) -> Optional[float]:
        for label in labels:
            v = _first_money_after(text, label, money_col_index)
            if v is not None:
                return v
        # CNY-table fallback: when the issuer's table doesn't have a US$
        # column (NIO/JD-style RMB-only), retry at column_index and let the
        # FX conversion below adjust the magnitude.
        if currency == "CNY":
            for label in labels:
                v = _first_money_after(text, label, column_index)
                if v is not None:
                    return v
        return None

    def _eps(*labels: str) -> Optional[float]:
        for label in labels:
            v = _first_per_share(text, label, money_col_index)
            if v is not None:
                return v
        if currency == "CNY":
            for label in labels:
                v = _first_per_share(text, label, column_index)
                if v is not None:
                    return v
        return None

    revenue = _money(
        r"Total net sales",
        r"Total revenues?",
        r"Net revenues?",
        r"Total net revenues",
        # Bitcoin miners (CLSK, CIFR, RIOT, MARA, …) report top-line under
        # ``Bitcoin mining revenue, net`` rather than a generic ``Revenues``
        # row. Match the table label directly so prose mentions don't win.
        r"Bitcoin mining revenues?(?:,?\s*net)?",
        r"Mining revenues?(?:,?\s*net)?",
        r"Revenues?",
    )
    operating_income = _money(
        r"Operating income",
        r"Income from operations",
        r"\(Loss\)\s*income from operations",  # CLSK loss-position label
        r"Loss from operations",
        r"Operating profit",
    )
    # "Net income (loss)" is the standard GAAP-table label; loss-position
    # quarters use "Net loss" (SHOP Q1'26 was a $581M net loss). Prefer GAAP
    # variants over the plain "Net income" fallback, which can collide with
    # non-GAAP reconciliation rows. CLSK reverses the parens to
    # ``Net (loss) income``.
    net_income = _money(
        r"Net income\s*\(loss\)",
        r"Net\s*\(loss\)\s*income",
        r"Net loss",
        r"Net earnings",
        r"Net income",
    )

    # ADRs typically report ``Diluted earnings per ADS`` separately from per-
    # share — the per-ADS figure is what an ADR holder actually owns. Try ADS
    # variants first for CNY issuers; per-share for everyone else.
    if currency == "CNY":
        eps_diluted = _eps(
            r"Diluted earnings per ADS",
            r"Earnings per diluted ADS",
            r"Earnings per diluted share",
            r"Diluted earnings per share",
            r"Diluted",
        )
        eps_basic = _eps(
            r"Basic earnings per ADS",
            r"Earnings per basic ADS",
            r"Earnings per basic share",
            r"Basic earnings per share",
            r"Basic",
        )
    else:
        # CLSK-style row labels use "per common share - diluted/basic" or
        # "per share - diluted/basic"; bare "Diluted" / "Basic" is the
        # last-resort fallback and matches narrative prose too eagerly, so
        # the explicit "per (common )?share" patterns must come first.
        eps_diluted = _eps(
            r"Earnings per diluted share",
            r"Diluted earnings per share",
            r"per common share\s*-?\s*diluted",
            r"per share\s*-?\s*diluted",
            r"Diluted",
        )
        eps_basic = _eps(
            r"Earnings per basic share",
            r"Basic earnings per share",
            r"per common share\s*-?\s*basic",
            r"per share\s*-?\s*basic",
            r"Basic",
        )

    # Unit normalization: every consumer expects values in millions of dollars,
    # but smaller issuers (CIFR ≈ $35M revenue) report in thousands. Detect the
    # caption and rescale before validation. EPS is per-share, never scaled.
    unit_div = _detect_unit_divisor(text)
    if unit_div != 1.0:
        if revenue is not None:
            revenue = round(revenue / unit_div, 4)
        if operating_income is not None:
            operating_income = round(operating_income / unit_div, 4)
        if net_income is not None:
            net_income = round(net_income / unit_div, 4)

    # FX conversion for CNY-reported issuers. If we already pulled values from
    # the issuer's US$ column (money_col_index == 2 succeeded), the magnitudes
    # will look USD-correct and we skip the divide. If the values look RMB-
    # sized (BABA's revenue would be 280K, expected USD ~40K), divide by the
    # CNY/USD rate. EPS is also converted unless ADS-USD was extracted.
    fx_rate: Optional[float] = None
    fx_rate_source: Optional[str] = None
    if currency == "CNY":
        fx_rate, fx_rate_source = _cny_to_usd_rate(text)
        revenue = _maybe_fx_convert(revenue, fx_rate, kind="big")
        operating_income = _maybe_fx_convert(operating_income, fx_rate, kind="big")
        net_income = _maybe_fx_convert(net_income, fx_rate, kind="big")
        eps_basic = _maybe_fx_convert(eps_basic, fx_rate, kind="eps")
        eps_diluted = _maybe_fx_convert(eps_diluted, fx_rate, kind="eps")

    revenue, operating_income, net_income = _validate_money_fields(
        revenue, operating_income, net_income
    )

    return {
        "period_end": period_end.strftime("%Y-%m-%d"),
        "fiscal_period": _detect_fiscal_quarter_label(text) or _quarter_label(period_end),
        "revenue_M": revenue,
        "operating_income_M": operating_income,
        "net_income_M": net_income,
        "eps_basic": eps_basic,
        "eps_diluted": eps_diluted,
        "currency": currency,
        # Surfaced only when conversion actually happened, so USD-native
        # issuers have a clean response without misleading "USD/USD = 1.0".
        **({"fx_rate": fx_rate, "fx_rate_source": fx_rate_source} if currency != "USD" else {}),
    }


def _maybe_fx_convert(value: Optional[float], cny_per_usd: float, *, kind: str) -> Optional[float]:
    """Divide RMB values by the CNY/USD rate when their magnitude is RMB-sized.

    We can't unconditionally divide because the issuer's US$ column might
    already have been picked up (money_col_index=2 path), in which case the
    value is already USD. The two ranges don't overlap for any reasonable
    issuer — at CNY/USD ≈ 7.10, an RMB-sized revenue figure is 7× larger
    than the USD-sized one, which trips a simple magnitude check.

    ``kind="big"`` for $-millions (revenue / op income / net income).
    ``kind="eps"`` for per-share / per-ADS (much smaller threshold).
    """
    if value is None:
        return value
    if kind == "big":
        # Threshold derived from "USD revenue plausibly tops $500B/quarter"
        # (no public company is near this). If absolute value exceeds, the
        # number is most likely raw RMB and needs converting.
        if abs(value) > 500_000:
            return round(value / cny_per_usd, 2)
    elif kind == "eps":
        # USD EPS for any large company is well under $20/quarter even for
        # mega-caps. Anything above that — at the same row position — is
        # almost certainly an RMB per-share value (BABA ¥0.74, JD ¥10+).
        if abs(value) > 20:
            return round(value / cny_per_usd, 4)
    return value


# Hard cap: no public company has trillion-dollar quarterly figures (yet).
# A value above this is virtually always a parse error — two columns merged
# together (NFLX-style "12,249,757") or a thousands/millions unit mismatch.
_MAX_REASONABLE_QUARTER_VALUE = 5_000_000  # in millions ⇒ $5T cap


def _validate_money_fields(
    revenue: Optional[float],
    op_income: Optional[float],
    net_income: Optional[float],
) -> tuple:
    """Drop fields that fail basic sanity checks.

    Trips on:
      * Any value above ``_MAX_REASONABLE_QUARTER_VALUE`` (parse artefact).
      * Net income > 1.5x revenue (operating-leverage doesn't go that high
        — net income exceeding revenue by 50% is almost always a wrong-row
        match).
    """
    if revenue is not None and abs(revenue) > _MAX_REASONABLE_QUARTER_VALUE:
        revenue = None
    if op_income is not None and abs(op_income) > _MAX_REASONABLE_QUARTER_VALUE:
        op_income = None
    if net_income is not None and abs(net_income) > _MAX_REASONABLE_QUARTER_VALUE:
        net_income = None
    if (
        revenue is not None
        and net_income is not None
        and revenue > 0
        and net_income > revenue * 1.5
    ):
        net_income = None
    return revenue, op_income, net_income


def _looks_like_earnings_release(body: Optional[str]) -> bool:
    """Heuristic: distinguish a real earnings press release from the many
    other things issuers attach as Exhibit 99.1.

    6-K filings in particular cover board meetings, share-repurchase plans,
    AGM materials, etc. — all valid Exhibit 99.1s, none of them earnings
    releases. A short body with no revenue/income labels is almost certainly
    not what we want.

    Tuned conservatively: a real earnings release for any S&P 500 / FTSE 100
    issuer is well over 10KB and mentions a balance-sheet or cash-flow
    statement title. Smaller-cap real earnings releases are sometimes
    shorter (CIFR's was ~16KB), so we don't gate purely on size.
    """
    if not body:
        return False
    # SHOP / BABA use mixed casing ("Three months ended"); match insensitively.
    if not re.search(r"(?i)three\s+months\s+ended", body):
        return False
    # The income statement always has at least revenue + a profit line.
    has_revenue = bool(re.search(r"(?i)\b(?:revenues?|net sales|total net sales)\b", body))
    has_profit_line = bool(re.search(
        r"(?i)\b(?:net (?:income|loss|earnings|profit)|operating (?:income|loss)|"
        r"income (?:from|before) operations|loss from operations|loss per share)\b",
        body,
    ))
    if not (has_revenue and has_profit_line):
        return False
    # Reject filings whose body is too short to plausibly contain a full
    # income statement table (CIFR's was 16KB, a board-meeting notice is
    # usually under 5KB).
    if len(body) < 8000:
        return False
    return True


def has_10q_for_period(ticker: str, period_end: datetime, max_filings: int = 8) -> bool:
    """True if a 10-Q (or 10-K) covering ``period_end`` is already on EDGAR.

    Used to gate the LLM fallback: when the periodic report is filed,
    yfinance will ingest it within a day or two and the LLM call is wasted
    spend. The 10-Q's ``periodOfReport`` doesn't always match exactly (some
    issuers have fiscal periods that end mid-month), so we treat any 10-Q
    filed within ~21 days of the press-release period as "the corresponding
    one".
    """
    try:
        filings = fetch_recent_filings(
            ticker,
            forms=("10-Q", "10-K"),
            limit=max_filings,
        )
    except Exception:
        return False
    cutoff_lo = period_end
    for f in filings:
        try:
            d = datetime.strptime(f.get("filing_date") or "", "%Y-%m-%d")
        except (TypeError, ValueError):
            continue
        # 10-Q filed on or after the period_end is the one we care about.
        # Most issuers file 30-45 days after; a few file the same day as
        # the 8-K (SHOP did this for Q1 2026), so the lower bound is the
        # period itself.
        if d >= cutoff_lo:
            return True
    return False


def _is_recent(filing_date: str) -> bool:
    try:
        d = datetime.strptime(filing_date, "%Y-%m-%d")
    except ValueError:
        return False
    return (datetime.utcnow() - d).days <= _MAX_FILING_AGE_DAYS


def get_latest_earnings_release(
    ticker: str,
    max_filings: int = 8,
    *,
    include_body: bool = False,
) -> Optional[Dict]:
    """Find the most recent 8-K *or 6-K* whose Exhibit 99.1 is an earnings release.

    Domestic filers (PYPL, MSFT, AAPL, …) report earnings via 8-K Item 2.02.
    Foreign private issuers (GRAB, SHOP-historical, BABA, JD, NIO, SE, …)
    file a 6-K instead. Both forms attach the press release as Exhibit 99.1
    using identical naming conventions, so a single walker handles both.

    Strategy: pull recent filings of either form, sort newest-first, and
    return the first one whose Exhibit 99.1 parses as an earnings release.
    Returns ``None`` if none of the recent filings are earnings releases.

    When ``include_body=True``, the cleaned exhibit text is attached as
    ``_body``. Internal callers (the LLM augmenter) need this; public API
    consumers should pass ``include_body=False`` to keep the response small.
    """
    ticker = ticker.upper().strip()
    now = time.time()
    cached = _cache.get(ticker)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        # Cache stores the parsed dict without the heavy ``_body``. Re-attach
        # it from the disk-cached exhibit when the caller asks.
        result = cached[1]
        if include_body and result and result.get("accession"):
            return _attach_body(result)
        return result

    try:
        filings = fetch_recent_filings(
            ticker,
            forms=("8-K", "6-K"),
            limit=max_filings,
        )
    except Exception as exc:
        log.warning("fetch_recent_filings failed for %s: %s", ticker, exc)
        filings = []

    # The submissions API returns filings newest-first per form, but mixing
    # 8-K and 6-K means we should re-sort by filing_date so a slightly
    # newer 6-K out-priorities an older 8-K (e.g. dual-class issuers).
    filings = sorted(
        filings, key=lambda f: f.get("filing_date") or "", reverse=True
    )

    result: Optional[Dict] = None
    for f in filings:
        if not _is_recent(f.get("filing_date") or ""):
            continue
        try:
            body = fetch_exhibit_991_full_text(f)
        except Exception as exc:
            log.warning("exhibit fetch failed for %s/%s: %s", ticker, f.get("accession"), exc)
            continue
        if not _looks_like_earnings_release(body):
            continue
        parsed = parse_earnings_release(body)
        # Require at least revenue or EPS to call it a usable earnings release.
        if not parsed or (parsed.get("revenue_M") is None and parsed.get("eps_diluted") is None):
            continue
        form = f.get("form") or "8-K"
        parsed["ticker"] = ticker
        parsed["filing_form"] = form
        parsed["filing_date"] = f.get("filing_date")
        parsed["accession"] = f.get("accession")
        parsed["link"] = f.get("link")
        parsed["source"] = f"{form} Exhibit 99.1"
        result = parsed
        break

    _cache[ticker] = (now, result)
    if include_body and result and result.get("accession"):
        return _attach_body(result)
    return result


def _attach_body(extract: Dict) -> Dict:
    """Pull the cached exhibit text back from disk and attach as ``_body``.

    Returns a *copy* so the in-memory cache stays free of the heavy text
    payload — repeated ``include_body=True`` calls only pay the disk-read.
    """
    accession = extract.get("accession")
    if not accession:
        return extract
    try:
        # Reconstruct the minimal filing dict needed by fetch_exhibit_991_full_text.
        # The cik_num and accession_clean are derivable from accession but the
        # helper expects the keys it would have gotten from fetch_recent_filings,
        # so we recompute them here.
        accession_clean = accession.replace("-", "")
        # The first segment of the accession number is the filer's CIK.
        cik_num = accession.split("-")[0].lstrip("0")
        body = fetch_exhibit_991_full_text({
            "_cik_num": cik_num,
            "_accession_clean": accession_clean,
            "primary_doc": "",
        })
    except Exception:
        body = None
    if not body:
        return extract
    return {**extract, "_body": body}


# Back-compat alias — older callers used the 8-K-specific name even though
# the function now also walks 6-Ks for foreign private issuers.
get_latest_8k_earnings = get_latest_earnings_release
