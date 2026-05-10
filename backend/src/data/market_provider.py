"""
Market-data provider adapter.

Single seam for every yfinance call in the backend. The rest of the codebase
imports the module-level functions (`get_quote`, `get_history`, ...) and never
touches yfinance directly. To swap providers, set `MARKET_PROVIDER=fmp` (or
similar) and add an `FmpProvider` class that satisfies the `MarketProvider`
Protocol.

Caching is uniform: a single `@cached_method` decorator with per-method TTLs
applies positive cache + stale-cache fallback + negative cache. This replaces
four bespoke cache dicts that had grown across `market_data.py`,
`fundamentals.py`, `earnings_extract.py`, and `robinhood_api.py`.
"""

from __future__ import annotations

import functools
import math
import os
import time
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Optional, Protocol, Tuple

import pandas as pd
import yfinance as yf


# ---------------------------------------------------------------------------
# Normalized return shapes
# ---------------------------------------------------------------------------

@dataclass
class Quote:
    symbol: str
    price: Optional[float]
    change: Optional[float]
    change_percent: Optional[float]
    open: Optional[float]
    high: Optional[float]
    low: Optional[float]
    previous_close: Optional[float]
    volume: Optional[int]
    last_updated: str  # ISO timestamp


@dataclass
class OHLCBar:
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass
class CompanyInfo:
    symbol: str
    long_name: Optional[str]
    short_name: Optional[str]
    sector: Optional[str]
    industry: Optional[str]
    market_cap: Optional[float]
    trailing_pe: Optional[float]
    forward_pe: Optional[float]
    beta: Optional[float]
    dividend_yield: Optional[float]
    shares_outstanding: Optional[float]
    held_pct_institutions: Optional[float]
    held_pct_insiders: Optional[float]
    total_revenue: Optional[float]
    operating_margins: Optional[float]
    profit_margins: Optional[float]
    revenue_growth: Optional[float]
    total_debt: Optional[float]
    total_cash: Optional[float]
    ebitda: Optional[float]
    target_mean_price: Optional[float]
    quote_type: Optional[str]
    currency: Optional[str]
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OptionContract:
    strike: float
    last_price: Optional[float]
    bid: Optional[float]
    ask: Optional[float]
    implied_volatility: Optional[float]
    open_interest: Optional[int]
    volume: Optional[int]
    in_the_money: bool


@dataclass
class OptionChain:
    symbol: str
    expiration: str  # ISO date
    calls: List[OptionContract]
    puts: List[OptionContract]


@dataclass
class FinancialStatement:
    symbol: str
    quarterly: bool
    periods: List[str]                          # column headers (period-end dates ISO)
    rows: Dict[str, List[Optional[float]]]      # {row_label: values aligned with periods}


@dataclass
class EarningsCalendar:
    symbol: str
    next_earnings_date: Optional[date]
    earnings_estimate: Optional[float]
    revenue_estimate: Optional[float]


@dataclass
class NewsItem:
    title: str
    summary: Optional[str]
    publisher: Optional[str]
    published_at: Optional[datetime]
    url: Optional[str]


@dataclass
class InstitutionalHolder:
    holder: str
    shares: Optional[int]
    date_reported: Optional[date]
    percent_held: Optional[float]
    value: Optional[float]


@dataclass
class InsiderHolder:
    name: str
    position: Optional[str]
    shares_directly_owned: Optional[int]
    shares_indirectly_owned: Optional[int]


@dataclass
class InsiderTransaction:
    insider: str
    transaction_date: Optional[date]
    transaction_type: Optional[str]
    shares: Optional[int]
    value: Optional[float]


@dataclass
class EtfTopHolding:
    symbol: str
    name: str
    weight: Optional[float]


@dataclass
class EtfProfile:
    symbol: str
    long_name: Optional[str]
    quote_type: Optional[str]
    currency: Optional[str]
    nav_price: Optional[float]
    expense_ratio: Optional[float]
    total_assets: Optional[float]
    top_holdings: List[EtfTopHolding]
    sector_weights: Dict[str, float]
    raw_info: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ShortInterestRaw:
    """The fields from `.info` consumed by `market_data.get_short_interest`. The
    caller projects these onto its public payload."""
    shares_short: Optional[int]
    short_ratio: Optional[float]
    short_percent_of_float: Optional[float]
    short_percent_outstanding: Optional[float]
    shares_short_prior_month: Optional[int]
    date_short_interest: Optional[int]  # epoch ms
    shares_outstanding: Optional[int]


# ---------------------------------------------------------------------------
# Coercion helpers (lifted from market_data.py — same behavior; one home)
# ---------------------------------------------------------------------------

def _safe_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _safe_int(v: Any) -> Optional[int]:
    try:
        if v is None:
            return None
        f = float(v)
        if not math.isfinite(f):
            return None
        return int(f)
    except (TypeError, ValueError):
        return None


def _safe_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


# ---------------------------------------------------------------------------
# Cache decorator
# ---------------------------------------------------------------------------

@dataclass
class _CacheEntry:
    ts: float
    value: Any


# Each decorated method gets its own cache + negative-cache, keyed by
# (symbol, frozen-kwargs).
def _is_empty_result(value: Any) -> bool:
    """Treat empties as transient — they're usually a yfinance hiccup, not a
    legitimate "this ticker has no history" answer. Caching them poisons the
    next 60s of requests even after the upstream recovers, so we bypass the
    positive cache for empties and let the next call retry."""
    if value is None:
        return True
    if isinstance(value, (list, tuple, dict, str)) and len(value) == 0:
        return True
    return False


def cached_method(
    *,
    ttl: float,
    stale_after: Optional[float] = None,
    negative_ttl: Optional[float] = None,
):
    """Per-method positive cache + optional stale-cache fallback + optional
    negative cache. The wrapped method must take `self, symbol, ...` as its
    leading args; all kwargs are folded into the cache key.

    Empty results (None, [], {}, "") are NOT cached — they'd otherwise pin a
    transient upstream failure into the cache for the full TTL window."""

    def decorator(fn: Callable):
        cache: Dict[Tuple, _CacheEntry] = {}
        negative: Dict[Tuple, _CacheEntry] = {}

        @functools.wraps(fn)
        def wrapped(self, *args, **kwargs):
            # Build a deterministic key from instance id + args + sorted kwargs.
            # Including id(self) keeps caches from leaking across provider
            # instances (production has a singleton; tests instantiate fresh
            # providers per case and must not see prior state).
            try:
                key = (id(self), args, tuple(sorted(kwargs.items())))
            except TypeError:
                # Unhashable kwarg — bypass cache.
                return fn(self, *args, **kwargs)

            now = time.time()
            hit = cache.get(key)
            if hit and (now - hit.ts) < ttl:
                return hit.value

            neg = negative.get(key)
            if (
                negative_ttl is not None
                and neg is not None
                and (now - neg.ts) < negative_ttl
                and hit is None
            ):
                raise ValueError(f"Recently failed; negative-cached: {neg.value}")

            try:
                result = fn(self, *args, **kwargs)
            except Exception as e:
                if (
                    stale_after is not None
                    and hit is not None
                    and (now - hit.ts) < stale_after
                ):
                    return hit.value
                if negative_ttl is not None:
                    negative[key] = _CacheEntry(ts=now, value=str(e)[:120])
                raise

            if not _is_empty_result(result):
                cache[key] = _CacheEntry(ts=now, value=result)
                negative.pop(key, None)
            return result

        # Expose for tests / introspection.
        wrapped._cache = cache  # type: ignore[attr-defined]
        wrapped._negative_cache = negative  # type: ignore[attr-defined]
        return wrapped

    return decorator


# ---------------------------------------------------------------------------
# Provider Protocol
# ---------------------------------------------------------------------------

class MarketProvider(Protocol):
    def get_quote(self, symbol: str) -> Quote: ...
    def get_history(
        self,
        symbol: str,
        *,
        period: Optional[str] = None,
        interval: str = "1d",
        start: Optional[date] = None,
        end: Optional[date] = None,
    ) -> List[OHLCBar]: ...
    def get_company_info(self, symbol: str) -> CompanyInfo: ...
    def get_option_expirations(self, symbol: str) -> List[str]: ...
    def get_option_chain(self, symbol: str, expiration: str) -> OptionChain: ...
    def get_income_statement(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement: ...
    def get_balance_sheet(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement: ...
    def get_cash_flow(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement: ...
    def get_earnings_calendar(self, symbol: str) -> EarningsCalendar: ...
    def get_news(self, symbol: str, limit: int = 20) -> List[NewsItem]: ...
    def get_institutional_holders(self, symbol: str) -> List[InstitutionalHolder]: ...
    def get_insider_holders(self, symbol: str) -> List[InsiderHolder]: ...
    def get_insider_transactions(self, symbol: str) -> List[InsiderTransaction]: ...
    def get_etf_profile(self, symbol: str) -> EtfProfile: ...
    def get_short_interest_raw(self, symbol: str) -> ShortInterestRaw: ...
    def get_fx_spot(self, pair: str) -> Optional[float]: ...


# ---------------------------------------------------------------------------
# YFinanceProvider — the only place yfinance is imported.
# ---------------------------------------------------------------------------

class YFinanceProvider:
    """
    yfinance-backed MarketProvider. Translates yfinance's pandas/dict outputs
    into the normalized dataclasses defined above. Tolerant of missing fields
    — they come back as None instead of raising — to preserve the prior
    "tolerant of yfinance flakiness" contract from `market_data.py:39`.
    """

    # ---- Quote / history ----

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_quote(self, symbol: str) -> Quote:
        sym = symbol.upper()
        stock = yf.Ticker(sym)
        hist = stock.history(period="5d")

        if hist.empty:
            raise ValueError(f"Unable to fetch price for {sym}")

        last = hist.iloc[-1]
        prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else float(last["Open"])
        price = float(last["Close"])
        # Refuse to surface a bogus 0/NaN price — see comment block at
        # market_data.py:_fetch_ticker_detail for the rationale.
        if not math.isfinite(price) or price <= 0:
            raise ValueError(f"yfinance returned invalid Close ({price!r}) for {sym}")

        change = price - prev_close
        change_pct = (change / prev_close * 100.0) if prev_close else 0.0

        return Quote(
            symbol=sym,
            price=round(price, 4),
            change=round(change, 4),
            change_percent=round(change_pct, 4),
            open=_safe_float(last.get("Open")),
            high=_safe_float(last.get("High")),
            low=_safe_float(last.get("Low")),
            previous_close=round(prev_close, 4) if math.isfinite(prev_close) else None,
            volume=_safe_int(last.get("Volume")),
            last_updated=str(hist.index[-1]),
        )

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_history(
        self,
        symbol: str,
        *,
        period: Optional[str] = None,
        interval: str = "1d",
        start: Optional[date] = None,
        end: Optional[date] = None,
    ) -> List[OHLCBar]:
        sym = symbol.upper()
        kwargs: Dict[str, Any] = {"interval": interval}
        if start is not None or end is not None:
            if start is not None:
                kwargs["start"] = start.isoformat() if isinstance(start, (date, datetime)) else start
            if end is not None:
                kwargs["end"] = end.isoformat() if isinstance(end, (date, datetime)) else end
        elif period is not None:
            kwargs["period"] = period
        else:
            kwargs["period"] = "1mo"

        df = yf.Ticker(sym).history(**kwargs)
        if df is None or df.empty:
            return []

        bars: List[OHLCBar] = []
        for ts, row in df.iterrows():
            try:
                d = ts.date() if hasattr(ts, "date") else date.fromisoformat(str(ts)[:10])
            except Exception:
                continue
            try:
                bars.append(OHLCBar(
                    date=d,
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=int(row["Volume"]) if pd.notna(row.get("Volume")) else 0,
                ))
            except (TypeError, ValueError, KeyError):
                continue
        return bars

    # ---- Company info ----

    @cached_method(ttl=600, stale_after=1800, negative_ttl=60)
    def get_company_info(self, symbol: str) -> CompanyInfo:
        sym = symbol.upper()
        try:
            info = yf.Ticker(sym).info or {}
        except Exception:
            info = {}

        return CompanyInfo(
            symbol=sym,
            long_name=_safe_str(info.get("longName")),
            short_name=_safe_str(info.get("shortName")),
            sector=_safe_str(info.get("sector")),
            industry=_safe_str(info.get("industry")),
            market_cap=_safe_float(info.get("marketCap")),
            trailing_pe=_safe_float(info.get("trailingPE")),
            forward_pe=_safe_float(info.get("forwardPE")),
            beta=_safe_float(info.get("beta")),
            dividend_yield=_safe_float(info.get("dividendYield")),
            shares_outstanding=_safe_float(info.get("sharesOutstanding")),
            held_pct_institutions=_safe_float(info.get("heldPercentInstitutions")),
            held_pct_insiders=_safe_float(info.get("heldPercentInsiders")),
            total_revenue=_safe_float(info.get("totalRevenue")),
            operating_margins=_safe_float(info.get("operatingMargins")),
            profit_margins=_safe_float(info.get("profitMargins")),
            revenue_growth=_safe_float(info.get("revenueGrowth")),
            total_debt=_safe_float(info.get("totalDebt")),
            total_cash=_safe_float(info.get("totalCash")) or _safe_float(info.get("totalCashPerShare")),
            ebitda=_safe_float(info.get("ebitda")),
            target_mean_price=_safe_float(info.get("targetMeanPrice")),
            quote_type=_safe_str(info.get("quoteType")),
            currency=_safe_str(info.get("currency")),
            raw=dict(info),
        )

    # ---- Options ----

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_option_expirations(self, symbol: str) -> List[str]:
        sym = symbol.upper()
        opts = yf.Ticker(sym).options or []
        return list(opts)

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_option_chain(self, symbol: str, expiration: str) -> OptionChain:
        sym = symbol.upper()
        ch = yf.Ticker(sym).option_chain(expiration)

        def _row_to_contract(row) -> OptionContract:
            return OptionContract(
                strike=float(row.get("strike")) if pd.notna(row.get("strike")) else 0.0,
                last_price=_safe_float(row.get("lastPrice")),
                bid=_safe_float(row.get("bid")),
                ask=_safe_float(row.get("ask")),
                implied_volatility=_safe_float(row.get("impliedVolatility")),
                open_interest=_safe_int(row.get("openInterest")),
                volume=_safe_int(row.get("volume")),
                in_the_money=bool(row.get("inTheMoney", False)),
            )

        calls = [_row_to_contract(r) for _, r in ch.calls.iterrows()] if ch.calls is not None and not ch.calls.empty else []
        puts = [_row_to_contract(r) for _, r in ch.puts.iterrows()] if ch.puts is not None and not ch.puts.empty else []
        return OptionChain(symbol=sym, expiration=expiration, calls=calls, puts=puts)

    # ---- Fundamentals ----

    def _statement_from_df(self, sym: str, df: Any, quarterly: bool) -> FinancialStatement:
        if df is None or (hasattr(df, "empty") and df.empty):
            return FinancialStatement(symbol=sym, quarterly=quarterly, periods=[], rows={})
        # yfinance returns rows = line-items, columns = period-end dates.
        periods = [str(c)[:10] for c in df.columns]
        rows: Dict[str, List[Optional[float]]] = {}
        for label, series in df.iterrows():
            rows[str(label)] = [_safe_float(v) for v in series.tolist()]
        return FinancialStatement(symbol=sym, quarterly=quarterly, periods=periods, rows=rows)

    @cached_method(ttl=600, stale_after=1800, negative_ttl=60)
    def get_income_statement(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        sym = symbol.upper()
        tk = yf.Ticker(sym)
        df = tk.quarterly_income_stmt if quarterly else tk.income_stmt
        return self._statement_from_df(sym, df, quarterly)

    @cached_method(ttl=600, stale_after=1800, negative_ttl=60)
    def get_balance_sheet(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        sym = symbol.upper()
        tk = yf.Ticker(sym)
        df = tk.quarterly_balance_sheet if quarterly else tk.balance_sheet
        return self._statement_from_df(sym, df, quarterly)

    @cached_method(ttl=600, stale_after=1800, negative_ttl=60)
    def get_cash_flow(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        sym = symbol.upper()
        tk = yf.Ticker(sym)
        df = tk.quarterly_cashflow if quarterly else tk.cashflow
        return self._statement_from_df(sym, df, quarterly)

    # ---- Earnings calendar / news ----

    @cached_method(ttl=1800, stale_after=3600, negative_ttl=120)
    def get_earnings_calendar(self, symbol: str) -> EarningsCalendar:
        sym = symbol.upper()
        cal = yf.Ticker(sym).calendar
        next_date: Optional[date] = None
        eps: Optional[float] = None
        rev: Optional[float] = None

        if cal is None:
            return EarningsCalendar(symbol=sym, next_earnings_date=None, earnings_estimate=None, revenue_estimate=None)

        # yfinance returns either a dict or a DataFrame depending on version.
        if isinstance(cal, dict):
            ed = cal.get("Earnings Date") or cal.get("earningsDate")
            if isinstance(ed, list) and ed:
                ed = ed[0]
            if isinstance(ed, (date, datetime)):
                next_date = ed.date() if isinstance(ed, datetime) else ed
            eps = _safe_float(cal.get("Earnings Average") or cal.get("earningsAverage"))
            rev = _safe_float(cal.get("Revenue Average") or cal.get("revenueAverage"))
        elif hasattr(cal, "loc") and not getattr(cal, "empty", False):
            try:
                ed_val = cal.loc["Earnings Date"].iloc[0] if "Earnings Date" in cal.index else None
                if pd.notna(ed_val):
                    next_date = ed_val.date() if hasattr(ed_val, "date") else None
            except Exception:
                pass

        return EarningsCalendar(
            symbol=sym,
            next_earnings_date=next_date,
            earnings_estimate=eps,
            revenue_estimate=rev,
        )

    @cached_method(ttl=300, stale_after=1800, negative_ttl=60)
    def get_news(self, symbol: str, limit: int = 20) -> List[NewsItem]:
        sym = symbol.upper()
        raw = yf.Ticker(sym).news or []
        out: List[NewsItem] = []
        for n in raw[:limit]:
            # yfinance changed the news shape in late 2025: the fields now live
            # under `content.{title,summary,pubDate,...}` rather than at the top
            # level. Try both shapes for forward/back compatibility.
            content = n.get("content") if isinstance(n, dict) else None
            src = content if isinstance(content, dict) else (n if isinstance(n, dict) else {})
            title = _safe_str(src.get("title") or src.get("headline"))
            if not title:
                continue
            pub_at_raw = src.get("pubDate") or src.get("providerPublishTime") or src.get("published_at")
            pub_at: Optional[datetime] = None
            if isinstance(pub_at_raw, (int, float)):
                try:
                    pub_at = datetime.fromtimestamp(int(pub_at_raw))
                except Exception:
                    pub_at = None
            elif isinstance(pub_at_raw, str):
                try:
                    pub_at = datetime.fromisoformat(pub_at_raw.replace("Z", "+00:00"))
                except Exception:
                    pub_at = None
            url = None
            click = src.get("clickThroughUrl") or src.get("canonicalUrl")
            if isinstance(click, dict):
                url = _safe_str(click.get("url"))
            elif isinstance(click, str):
                url = click
            else:
                url = _safe_str(src.get("link"))
            out.append(NewsItem(
                title=title,
                summary=_safe_str(src.get("summary") or src.get("description")),
                publisher=_safe_str(src.get("publisher") or (src.get("provider", {}) or {}).get("displayName")),
                published_at=pub_at,
                url=url,
            ))
        return out

    # ---- Ownership ----

    @cached_method(ttl=1800, stale_after=3600, negative_ttl=120)
    def get_institutional_holders(self, symbol: str) -> List[InstitutionalHolder]:
        sym = symbol.upper()
        df = yf.Ticker(sym).institutional_holders
        if df is None or df.empty:
            return []
        out: List[InstitutionalHolder] = []
        for _, row in df.iterrows():
            d = row.get("Date Reported")
            try:
                dr = d.date() if hasattr(d, "date") else None
            except Exception:
                dr = None
            out.append(InstitutionalHolder(
                holder=_safe_str(row.get("Holder")) or "—",
                shares=_safe_int(row.get("Shares")),
                date_reported=dr,
                percent_held=_safe_float(row.get("pctHeld") or row.get("% Out")),
                value=_safe_float(row.get("Value")),
            ))
        return out

    @cached_method(ttl=1800, stale_after=3600, negative_ttl=120)
    def get_insider_holders(self, symbol: str) -> List[InsiderHolder]:
        sym = symbol.upper()
        df = yf.Ticker(sym).insider_roster_holders
        if df is None or df.empty:
            return []
        out: List[InsiderHolder] = []
        for _, row in df.iterrows():
            out.append(InsiderHolder(
                name=_safe_str(row.get("Name")) or "—",
                position=_safe_str(row.get("Position") or row.get("Most Recent Transaction")),
                shares_directly_owned=_safe_int(row.get("Shares Owned Directly")),
                shares_indirectly_owned=_safe_int(row.get("Shares Owned Indirectly")),
            ))
        return out

    @cached_method(ttl=1800, stale_after=3600, negative_ttl=120)
    def get_insider_transactions(self, symbol: str) -> List[InsiderTransaction]:
        sym = symbol.upper()
        df = yf.Ticker(sym).insider_transactions
        if df is None or df.empty:
            return []
        out: List[InsiderTransaction] = []
        for _, row in df.iterrows():
            d = row.get("Start Date")
            try:
                td = d.date() if hasattr(d, "date") else None
            except Exception:
                td = None
            out.append(InsiderTransaction(
                insider=_safe_str(row.get("Insider")) or "—",
                transaction_date=td,
                transaction_type=_safe_str(row.get("Transaction") or row.get("Text")),
                shares=_safe_int(row.get("Shares")),
                value=_safe_float(row.get("Value")),
            ))
        return out

    # ---- ETF ----

    @cached_method(ttl=600, stale_after=1800, negative_ttl=60)
    def get_etf_profile(self, symbol: str) -> EtfProfile:
        sym = symbol.upper()
        tk = yf.Ticker(sym)
        try:
            info = tk.info or {}
        except Exception:
            info = {}

        top_holdings: List[EtfTopHolding] = []
        sector_weights: Dict[str, float] = {}

        try:
            funds = tk.funds_data
        except Exception:
            funds = None

        if funds is not None:
            try:
                th = funds.top_holdings
                if th is not None and hasattr(th, "iterrows") and not th.empty:
                    for ticker_sym, row in th.iterrows():
                        top_holdings.append(EtfTopHolding(
                            symbol=str(ticker_sym),
                            name=_safe_str(row.get("Name")) or str(ticker_sym),
                            weight=_safe_float(row.get("Holding Percent") or row.get("% of Net Assets")),
                        ))
            except Exception:
                pass
            try:
                sw = funds.sector_weightings
                if isinstance(sw, dict):
                    sector_weights = {str(k): float(v) for k, v in sw.items() if _safe_float(v) is not None}
            except Exception:
                pass

        return EtfProfile(
            symbol=sym,
            long_name=_safe_str(info.get("longName")),
            quote_type=_safe_str(info.get("quoteType")),
            currency=_safe_str(info.get("currency")),
            nav_price=_safe_float(info.get("navPrice")),
            expense_ratio=_safe_float(info.get("expenseRatio") or info.get("annualReportExpenseRatio")),
            total_assets=_safe_float(info.get("totalAssets")),
            top_holdings=top_holdings,
            sector_weights=sector_weights,
            raw_info=dict(info),
        )

    # ---- Specialty ----

    @cached_method(ttl=1800, stale_after=3600, negative_ttl=120)
    def get_short_interest_raw(self, symbol: str) -> ShortInterestRaw:
        sym = symbol.upper()
        try:
            info = yf.Ticker(sym).info or {}
        except Exception:
            info = {}
        return ShortInterestRaw(
            shares_short=_safe_int(info.get("sharesShort")),
            short_ratio=_safe_float(info.get("shortRatio")),
            short_percent_of_float=_safe_float(info.get("shortPercentOfFloat")),
            short_percent_outstanding=_safe_float(info.get("sharesPercentSharesOut")),
            shares_short_prior_month=_safe_int(info.get("sharesShortPriorMonth")),
            date_short_interest=_safe_int(info.get("dateShortInterest")),
            shares_outstanding=_safe_int(info.get("sharesOutstanding")),
        )

    @cached_method(ttl=1800, stale_after=3600, negative_ttl=120)
    def get_fx_spot(self, pair: str) -> Optional[float]:
        """For Yahoo FX symbols like 'USDCNY=X'. Falls back to last close from
        a 5d history if `fast_info` doesn't expose `last_price`."""
        sym = pair.upper()
        tk = yf.Ticker(sym)
        try:
            fast = tk.fast_info
            if fast is not None:
                lp = getattr(fast, "last_price", None) or (fast.get("last_price") if isinstance(fast, dict) else None)
                v = _safe_float(lp)
                if v is not None and v > 0:
                    return v
        except Exception:
            pass
        try:
            hist = tk.history(period="5d")
            if hist is not None and not hist.empty:
                v = _safe_float(hist["Close"].iloc[-1])
                return v if v and v > 0 else None
        except Exception:
            pass
        return None


# ---------------------------------------------------------------------------
# RobinhoodProvider — implements the methods Robinhood exposes natively
# (quote, history ≤5y, company info, option expirations + chain). Anything
# Robinhood doesn't carry raises NotImplementedError so CompositeProvider
# can fall through to yfinance.
# ---------------------------------------------------------------------------

# Mapping from yfinance-style `period=` strings to Robinhood `(span, interval)`.
# RH's get_stock_historicals supports spans {day, week, month, 3month, year, 5year}
# and intervals {5minute, 10minute, hour, day, week}. Anything outside this set
# (custom date ranges, multi-year horizons, intraday > 5y) drops back to yfinance.
_RH_PERIOD_MAP: Dict[str, Tuple[str, str]] = {
    "1d":  ("day",    "5minute"),
    "5d":  ("week",   "day"),
    "1wk": ("week",   "day"),
    "1mo": ("month",  "day"),
    "30d": ("month",  "day"),
    "60d": ("3month", "day"),
    "3mo": ("3month", "day"),
    "6mo": ("year",   "day"),  # RH has no 6-month span; year + day works
    "1y":  ("year",   "day"),
    "ytd": ("year",   "day"),
    "5y":  ("5year",  "day"),
}


class RobinhoodProvider:
    """robin_stocks-backed MarketProvider for the calls Robinhood exposes
    cleanly. Authenticated → much higher rate limits than yfinance.

    Anything Robinhood doesn't expose (financial statements, ownership,
    insider, ETF profile, news, >5y history, FX) raises NotImplementedError;
    CompositeProvider catches that and routes to yfinance.
    """

    # ---- Login plumbing (delegated to brokers.robinhood_api) ----

    def _ensure_login(self) -> bool:
        """Force authentication so subsequent rh.X() calls have a token."""
        try:
            from brokers.robinhood_api import login as _rh_login
            return _rh_login()
        except Exception:
            return False

    def _rh(self):
        """Lazy-import the robin_stocks namespace, after ensuring login."""
        if not self._ensure_login():
            raise RuntimeError("Robinhood not configured / login failed")
        import robin_stocks.robinhood as rh
        return rh

    # ---- Quote / history ----

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_quote(self, symbol: str) -> Quote:
        sym = symbol.upper()
        rh = self._rh()
        from brokers.robinhood_api import _call_with_reauth

        quotes = _call_with_reauth(rh.stocks.get_quotes, [sym]) or []
        q = quotes[0] if quotes else None
        if not q:
            raise ValueError(f"Robinhood returned no quote for {sym}")

        last_px = _safe_float(q.get("last_trade_price") or q.get("last_extended_hours_trade_price"))
        prev_close = _safe_float(q.get("previous_close") or q.get("adjusted_previous_close"))
        if last_px is None or last_px <= 0:
            raise ValueError(f"Robinhood returned invalid last_trade_price for {sym}")

        change = (last_px - prev_close) if prev_close is not None else 0.0
        change_pct = (change / prev_close * 100.0) if prev_close else 0.0

        return Quote(
            symbol=sym,
            price=round(last_px, 4),
            change=round(change, 4),
            change_percent=round(change_pct, 4),
            open=None,
            high=None,
            low=None,
            previous_close=round(prev_close, 4) if prev_close is not None else None,
            volume=None,
            last_updated=str(q.get("updated_at") or ""),
        )

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_history(
        self,
        symbol: str,
        *,
        period: Optional[str] = None,
        interval: str = "1d",
        start: Optional[date] = None,
        end: Optional[date] = None,
    ) -> List[OHLCBar]:
        # Custom date ranges aren't supported by RH directly — punt to yfinance.
        if start is not None or end is not None:
            raise NotImplementedError("Robinhood does not support custom date ranges")

        period_key = (period or "1mo").lower()
        if period_key not in _RH_PERIOD_MAP:
            raise NotImplementedError(f"Robinhood does not support period={period!r}")

        sym = symbol.upper()
        span, rh_interval = _RH_PERIOD_MAP[period_key]
        rh = self._rh()
        from brokers.robinhood_api import _call_with_reauth

        rows = _call_with_reauth(
            rh.stocks.get_stock_historicals,
            [sym],
            interval=rh_interval,
            span=span,
        ) or []

        bars: List[OHLCBar] = []
        for row in rows:
            if not row:
                continue
            try:
                bd_raw = row.get("begins_at") or ""
                # Robinhood timestamps come back as ISO datetimes; we only need the date.
                d = date.fromisoformat(bd_raw[:10])
                bars.append(OHLCBar(
                    date=d,
                    open=float(row.get("open_price") or 0.0),
                    high=float(row.get("high_price") or 0.0),
                    low=float(row.get("low_price") or 0.0),
                    close=float(row.get("close_price") or 0.0),
                    volume=int(float(row.get("volume") or 0)),
                ))
            except (TypeError, ValueError, KeyError):
                continue
        return bars

    # ---- Company info ----

    @cached_method(ttl=600, stale_after=1800, negative_ttl=60)
    def get_company_info(self, symbol: str) -> CompanyInfo:
        sym = symbol.upper()
        rh = self._rh()
        from brokers.robinhood_api import _call_with_reauth

        # rh.stocks.get_fundamentals returns a list[dict] with one entry per symbol.
        fund_list = _call_with_reauth(rh.stocks.get_fundamentals, [sym]) or []
        fund = fund_list[0] if fund_list and isinstance(fund_list, list) else {}

        # Pull instrument data for the long/short name + share count.
        try:
            inst_list = _call_with_reauth(rh.stocks.get_instruments_by_symbols, [sym]) or []
            inst = inst_list[0] if inst_list and isinstance(inst_list, list) else {}
        except Exception:
            inst = {}

        market_cap = _safe_float(fund.get("market_cap"))
        pe = _safe_float(fund.get("pe_ratio"))
        div_yield_pct = _safe_float(fund.get("dividend_yield"))
        # Robinhood reports dividend yield as a percentage already (e.g. 1.45 = 1.45%);
        # callers expect a decimal (0.0145), so divide by 100.
        div_yield = (div_yield_pct / 100.0) if div_yield_pct is not None else None

        long_name = _safe_str(inst.get("name") or inst.get("simple_name"))

        return CompanyInfo(
            symbol=sym,
            long_name=long_name,
            short_name=_safe_str(inst.get("simple_name") or long_name),
            sector=_safe_str(fund.get("sector")),
            industry=_safe_str(fund.get("industry")),
            market_cap=market_cap,
            trailing_pe=pe,
            forward_pe=None,
            beta=None,
            dividend_yield=div_yield,
            shares_outstanding=_safe_float(fund.get("shares_outstanding")),
            held_pct_institutions=None,
            held_pct_insiders=None,
            total_revenue=None,
            operating_margins=None,
            profit_margins=None,
            revenue_growth=None,
            total_debt=None,
            total_cash=None,
            ebitda=None,
            target_mean_price=None,
            quote_type="EQUITY",
            currency="USD",
            raw=dict(fund),
        )

    # ---- Options ----

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_option_expirations(self, symbol: str) -> List[str]:
        sym = symbol.upper()
        rh = self._rh()
        from brokers.robinhood_api import _call_with_reauth

        chains = _call_with_reauth(rh.options.get_chains, sym) or {}
        exps = chains.get("expiration_dates") or []
        return [str(e) for e in exps if e]

    @cached_method(ttl=60, stale_after=300, negative_ttl=30)
    def get_option_chain(self, symbol: str, expiration: str) -> OptionChain:
        sym = symbol.upper()
        rh = self._rh()
        from brokers.robinhood_api import _call_with_reauth

        def _fetch(side: str) -> List[OptionContract]:
            raw = _call_with_reauth(
                rh.options.find_options_by_expiration,
                sym,
                expirationDate=expiration,
                optionType=side,
            ) or []
            out: List[OptionContract] = []
            for opt in raw:
                if not opt:
                    continue
                out.append(OptionContract(
                    strike=float(opt.get("strike_price") or 0.0),
                    last_price=_safe_float(opt.get("last_trade_price")),
                    bid=_safe_float(opt.get("bid_price")),
                    ask=_safe_float(opt.get("ask_price")),
                    implied_volatility=_safe_float(opt.get("implied_volatility")),
                    open_interest=_safe_int(opt.get("open_interest")),
                    volume=_safe_int(opt.get("volume")),
                    in_the_money=False,  # RH doesn't expose this; computed downstream from spot
                ))
            return out

        return OptionChain(
            symbol=sym,
            expiration=expiration,
            calls=_fetch("call"),
            puts=_fetch("put"),
        )

    # ---- Methods Robinhood does NOT expose — let composite fall through ----

    def get_income_statement(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        raise NotImplementedError("Robinhood does not expose financial statements")

    def get_balance_sheet(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        raise NotImplementedError("Robinhood does not expose financial statements")

    def get_cash_flow(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        raise NotImplementedError("Robinhood does not expose financial statements")

    def get_earnings_calendar(self, symbol: str) -> EarningsCalendar:
        raise NotImplementedError("Robinhood does not expose forward earnings dates")

    def get_news(self, symbol: str, limit: int = 20) -> List[NewsItem]:
        raise NotImplementedError("Robinhood news coverage is too sparse to use")

    def get_institutional_holders(self, symbol: str) -> List[InstitutionalHolder]:
        raise NotImplementedError("Robinhood does not expose 13F holders")

    def get_insider_holders(self, symbol: str) -> List[InsiderHolder]:
        raise NotImplementedError("Robinhood does not expose insider holders")

    def get_insider_transactions(self, symbol: str) -> List[InsiderTransaction]:
        raise NotImplementedError("Robinhood does not expose Form 4 filings")

    def get_etf_profile(self, symbol: str) -> EtfProfile:
        raise NotImplementedError("Robinhood does not expose ETF profile data")

    def get_short_interest_raw(self, symbol: str) -> ShortInterestRaw:
        raise NotImplementedError("Robinhood does not expose short interest")

    def get_fx_spot(self, pair: str) -> Optional[float]:
        raise NotImplementedError("Robinhood does not expose FX")


# ---------------------------------------------------------------------------
# CompositeProvider — RH primary, yfinance fallback. Used when the user wants
# the speed/rate-limit advantages of authenticated RH calls without losing
# the long-tail data only yfinance carries.
# ---------------------------------------------------------------------------

class CompositeProvider:
    """Try Robinhood first; on NotImplementedError or any other failure, fall
    back to the yfinance provider. Caching lives on each underlying provider
    (so a successful RH call is cached as RH; a fall-through to yf is cached
    as yf), which lets us correctly attribute and debug per-call sources.
    """

    def __init__(self, rh: "RobinhoodProvider", yf: "YFinanceProvider"):
        self._rh = rh
        self._yf = yf

    def _try_rh(self, method: str, *args, **kwargs):
        fn = getattr(self._rh, method)
        try:
            return fn(*args, **kwargs)
        except NotImplementedError:
            raise  # signal to caller: RH genuinely doesn't carry this
        except Exception:
            # Any other error (auth, network, schema mismatch): fall through.
            return None

    def _delegate(self, method: str, *args, **kwargs):
        """RH-primary, yf-fallback dispatcher for methods both sides implement."""
        try:
            result = self._try_rh(method, *args, **kwargs)
        except NotImplementedError:
            result = None
        if result is not None:
            return result
        # RH errored or returned None — fall back to yfinance.
        return getattr(self._yf, method)(*args, **kwargs)

    # ---- RH-supported methods (try RH first) ----

    def get_quote(self, symbol: str) -> Quote:
        return self._delegate("get_quote", symbol)

    def get_history(
        self,
        symbol: str,
        *,
        period: Optional[str] = None,
        interval: str = "1d",
        start: Optional[date] = None,
        end: Optional[date] = None,
    ) -> List[OHLCBar]:
        return self._delegate(
            "get_history",
            symbol,
            period=period,
            interval=interval,
            start=start,
            end=end,
        )

    def get_company_info(self, symbol: str) -> CompanyInfo:
        return self._delegate("get_company_info", symbol)

    def get_option_expirations(self, symbol: str) -> List[str]:
        return self._delegate("get_option_expirations", symbol)

    def get_option_chain(self, symbol: str, expiration: str) -> OptionChain:
        return self._delegate("get_option_chain", symbol, expiration)

    # ---- yfinance-only methods (skip RH; it raises NotImplementedError) ----

    def get_income_statement(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        return self._yf.get_income_statement(symbol, quarterly=quarterly)

    def get_balance_sheet(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        return self._yf.get_balance_sheet(symbol, quarterly=quarterly)

    def get_cash_flow(self, symbol: str, *, quarterly: bool = False) -> FinancialStatement:
        return self._yf.get_cash_flow(symbol, quarterly=quarterly)

    def get_earnings_calendar(self, symbol: str) -> EarningsCalendar:
        return self._yf.get_earnings_calendar(symbol)

    def get_news(self, symbol: str, limit: int = 20) -> List[NewsItem]:
        return self._yf.get_news(symbol, limit=limit)

    def get_institutional_holders(self, symbol: str) -> List[InstitutionalHolder]:
        return self._yf.get_institutional_holders(symbol)

    def get_insider_holders(self, symbol: str) -> List[InsiderHolder]:
        return self._yf.get_insider_holders(symbol)

    def get_insider_transactions(self, symbol: str) -> List[InsiderTransaction]:
        return self._yf.get_insider_transactions(symbol)

    def get_etf_profile(self, symbol: str) -> EtfProfile:
        return self._yf.get_etf_profile(symbol)

    def get_short_interest_raw(self, symbol: str) -> ShortInterestRaw:
        return self._yf.get_short_interest_raw(symbol)

    def get_fx_spot(self, pair: str) -> Optional[float]:
        return self._yf.get_fx_spot(pair)


# ---------------------------------------------------------------------------
# Provider selection (env-driven) + module-level dispatch functions
# ---------------------------------------------------------------------------

_PROVIDER_NAME = os.environ.get("MARKET_PROVIDER", "yfinance").lower()

_provider: MarketProvider
if _PROVIDER_NAME == "yfinance":
    _provider = YFinanceProvider()
elif _PROVIDER_NAME in ("rh", "robinhood"):
    _provider = RobinhoodProvider()
elif _PROVIDER_NAME == "composite":
    _provider = CompositeProvider(RobinhoodProvider(), YFinanceProvider())
else:
    raise RuntimeError(
        f"Unknown MARKET_PROVIDER={_PROVIDER_NAME!r}. "
        "Supported: 'yfinance', 'rh', 'composite'."
    )


def get_provider() -> MarketProvider:
    """Test seam — lets unit tests swap the provider at runtime."""
    return _provider


def set_provider(p: MarketProvider) -> None:
    """Test seam — overrides the active provider. Production code should not
    call this; use the MARKET_PROVIDER env var instead."""
    global _provider
    _provider = p


# Public API — every backend module imports these.

def get_quote(symbol: str) -> Quote:
    return _provider.get_quote(symbol)


def get_history(
    symbol: str,
    *,
    period: Optional[str] = None,
    interval: str = "1d",
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> List[OHLCBar]:
    return _provider.get_history(symbol, period=period, interval=interval, start=start, end=end)


def get_company_info(symbol: str) -> CompanyInfo:
    return _provider.get_company_info(symbol)


def get_option_expirations(symbol: str) -> List[str]:
    return _provider.get_option_expirations(symbol)


def get_option_chain(symbol: str, expiration: str) -> OptionChain:
    return _provider.get_option_chain(symbol, expiration)


def get_income_statement(symbol: str, *, quarterly: bool = False) -> FinancialStatement:
    return _provider.get_income_statement(symbol, quarterly=quarterly)


def get_balance_sheet(symbol: str, *, quarterly: bool = False) -> FinancialStatement:
    return _provider.get_balance_sheet(symbol, quarterly=quarterly)


def get_cash_flow(symbol: str, *, quarterly: bool = False) -> FinancialStatement:
    return _provider.get_cash_flow(symbol, quarterly=quarterly)


def get_earnings_calendar(symbol: str) -> EarningsCalendar:
    return _provider.get_earnings_calendar(symbol)


def get_news(symbol: str, limit: int = 20) -> List[NewsItem]:
    return _provider.get_news(symbol, limit=limit)


def get_institutional_holders(symbol: str) -> List[InstitutionalHolder]:
    return _provider.get_institutional_holders(symbol)


def get_insider_holders(symbol: str) -> List[InsiderHolder]:
    return _provider.get_insider_holders(symbol)


def get_insider_transactions(symbol: str) -> List[InsiderTransaction]:
    return _provider.get_insider_transactions(symbol)


def get_etf_profile(symbol: str) -> EtfProfile:
    return _provider.get_etf_profile(symbol)


def get_short_interest_raw(symbol: str) -> ShortInterestRaw:
    return _provider.get_short_interest_raw(symbol)


def get_fx_spot(pair: str) -> Optional[float]:
    return _provider.get_fx_spot(pair)


# Helper: translate FinancialStatement back to a pandas DataFrame in the same
# row=line-item / column=period shape that yfinance's `.income_stmt` returns.
# Lets callers with deep pandas integrations (e.g. fundamentals.py) consume
# the adapter without a full rewrite.
def statement_to_dataframe(stmt: FinancialStatement) -> "pd.DataFrame":
    if not stmt.rows or not stmt.periods:
        return pd.DataFrame()
    df = pd.DataFrame(stmt.rows, index=stmt.periods).T
    df.columns = stmt.periods
    return df


# Helper: translate OHLCBar list back to a pandas DataFrame for callers that
# really do need DataFrame semantics (regression-light migration; to be phased
# out once callers consume OHLCBar objects directly).
def history_to_dataframe(bars: List[OHLCBar]) -> "pd.DataFrame":
    if not bars:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    df = pd.DataFrame(
        {
            "Open": [b.open for b in bars],
            "High": [b.high for b in bars],
            "Low": [b.low for b in bars],
            "Close": [b.close for b in bars],
            "Volume": [b.volume for b in bars],
        },
        index=pd.to_datetime([b.date for b in bars]),
    )
    return df


__all__ = [
    # dataclasses
    "Quote", "OHLCBar", "CompanyInfo",
    "OptionContract", "OptionChain",
    "FinancialStatement",
    "EarningsCalendar", "NewsItem",
    "InstitutionalHolder", "InsiderHolder", "InsiderTransaction",
    "EtfTopHolding", "EtfProfile",
    "ShortInterestRaw",
    # protocol + providers
    "MarketProvider", "YFinanceProvider",
    "get_provider", "set_provider",
    # public API
    "get_quote", "get_history", "get_company_info",
    "get_option_expirations", "get_option_chain",
    "get_income_statement", "get_balance_sheet", "get_cash_flow",
    "get_earnings_calendar", "get_news",
    "get_institutional_holders", "get_insider_holders", "get_insider_transactions",
    "get_etf_profile", "get_short_interest_raw", "get_fx_spot",
    # legacy bridge
    "history_to_dataframe",
    "statement_to_dataframe",
]
