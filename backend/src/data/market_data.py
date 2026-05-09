"""
Generic Market Data Module

Generalized version of cifr_data.py that works with any ticker.
Keeps cifr_data.py for backward compatibility.
"""

import math
import time

import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Optional, Tuple

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from data.cifr_data import get_historical_volatility, get_options_chain_yahoo
from data.market_provider import (
    get_company_info,
    get_history,
    get_insider_holders,
    get_insider_transactions,
    get_institutional_holders,
    get_option_chain,
    get_option_expirations,
    get_quote,
    get_short_interest_raw,
    history_to_dataframe,
)


# Quote-detail cache. yfinance `.history(5d) + .info` is ~1-3s and frequently
# rate-limited; without this, every Stock-detail page load hits yfinance fresh
# and the 2026-05-09 mobile QA pass surfaced multiple 404 cascades.
#
# 60s is short enough that intraday users still see fresh ticks on the next
# tab/refresh, long enough that a burst of page loads (sidebar + tabs + chart)
# doesn't multiply the upstream call count.
_DETAIL_CACHE_TTL_SEC = 60
# Stale-cache fallback. If a yfinance call fails AND we have a cached payload
# newer than this, serve it (with a `stale: True` flag) instead of raising.
# Keeps a transient yfinance hiccup from rendering "Quote unavailable" when we
# had valid data 4 minutes ago.
_DETAIL_STALE_FALLBACK_SEC = 300
# Negative-cache. If a ticker has no prior cache and yfinance fails (delisted,
# invalid symbol, sustained timeout), remember that failure for this many
# seconds so we fail fast instead of re-hitting upstream every page load.
_DETAIL_NEGATIVE_CACHE_SEC = 30
_detail_cache: Dict[str, Tuple[float, Dict]] = {}
_detail_negative_cache: Dict[str, Tuple[float, str]] = {}


def get_ticker_price(ticker: str) -> float:
    """
    Get current stock price for any ticker.
    """
    bars = get_history(ticker, period="1d")
    if not bars:
        raise ValueError(f"Unable to fetch price for {ticker}")
    return float(bars[-1].close)


def get_ticker_detail(ticker: str) -> Dict:
    """
    Rich ticker snapshot for the stock detail page: price, day/52w range,
    volume, market cap, P/E, company name. Tolerant of yfinance flakiness —
    missing fields come back as None rather than raising.

    Cached for 60s; on yfinance failure within the next 5 min, falls back to
    the last-good payload with `stale: True` rather than 404-ing the UI.
    """
    key = ticker.upper()
    now = time.time()
    cached = _detail_cache.get(key)
    if cached and (now - cached[0]) < _DETAIL_CACHE_TTL_SEC:
        return cached[1]

    neg = _detail_negative_cache.get(key)
    if neg and (now - neg[0]) < _DETAIL_NEGATIVE_CACHE_SEC and not cached:
        raise ValueError(f"yfinance recently failed for {ticker} ({neg[1]}); negative-cached")

    try:
        result = _fetch_ticker_detail(ticker)
    except Exception as e:
        if cached and (now - cached[0]) < _DETAIL_STALE_FALLBACK_SEC:
            stale = dict(cached[1])
            stale['stale'] = True
            return stale
        _detail_negative_cache[key] = (now, str(e)[:80])
        raise

    _detail_cache[key] = (now, result)
    _detail_negative_cache.pop(key, None)
    return result


def _fetch_ticker_detail(ticker: str) -> Dict:
    """Uncached fetch — split out so the cache wrapper above stays readable.
    Anything raising here triggers stale-cache fallback in the caller."""
    bars = get_history(ticker, period="5d")
    if not bars:
        raise ValueError(f"Unable to fetch price for {ticker}")

    hist = history_to_dataframe(bars)
    last = hist.iloc[-1]
    prev_close = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else float(last['Open'])
    price = float(last['Close'])
    # Refuse to leak a bogus 0 / NaN price: provider occasionally returns a
    # row with NaN Close (rate-limited, delisted, or stale-cache). The DCF
    # page does `currentPrice.toFixed(2)` and would otherwise render "$0.00",
    # which the user reads as "this stock is worthless." Better to 5xx here so
    # the frontend can show a clean error / loading state.
    if not math.isfinite(price) or price <= 0:
        raise ValueError(
            f"provider returned an invalid Close ({price!r}) for {ticker}; refusing to surface as $0"
        )
    change = price - prev_close
    change_pct = (change / prev_close * 100.0) if prev_close else 0.0

    info: Dict = {}
    try:
        info = get_company_info(ticker).raw or {}
    except Exception:
        info = {}

    def _f(key):
        v = info.get(key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    def _i(key):
        v = info.get(key)
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    market_cap_raw = info.get('marketCap')
    market_cap_str = _format_market_cap(market_cap_raw) if market_cap_raw else "—"

    # DCF-friendly fundamentals. All in absolute dollars (not $M) so the client
    # can decide its own display units. Any missing field stays as None so the
    # frontend can fall back to a sensible default.
    total_debt = _f('totalDebt')
    total_cash = _f('totalCash') or _f('totalCashPerShare')
    net_debt_abs = None
    if total_debt is not None:
        net_debt_abs = total_debt - (total_cash or 0.0)

    fundamentals = {
        'revenue':          _f('totalRevenue'),        # TTM revenue ($)
        'operatingMargin':  _f('operatingMargins'),    # decimal (0.25 = 25%)
        'profitMargin':     _f('profitMargins'),       # decimal
        'sharesOutstanding': _f('sharesOutstanding'),  # shares, not millions
        'totalDebt':        total_debt,
        'totalCash':        total_cash,
        'netDebt':          net_debt_abs,
        'ebitda':           _f('ebitda'),
        'revenueGrowth':    _f('revenueGrowth'),       # decimal YoY
        'beta':             _f('beta'),
    }

    return {
        'ticker': ticker.upper(),
        'name': info.get('longName') or info.get('shortName') or ticker.upper(),
        'price': round(price, 4),
        'change': round(change, 4),
        'changePercent': round(change_pct, 4),
        'volume': int(last['Volume']) if not pd.isna(last['Volume']) else 0,
        'marketCap': market_cap_str,
        'marketCapValue': _f('marketCap'),
        'dayHigh': round(float(last['High']), 4),
        'dayLow': round(float(last['Low']), 4),
        'open': round(float(last['Open']), 4),
        'previousClose': round(prev_close, 4),
        'pe': _f('trailingPE'),
        'yearHigh': _f('fiftyTwoWeekHigh'),
        'yearLow': _f('fiftyTwoWeekLow'),
        'avgVolume': _i('averageVolume'),
        'lastUpdated': str(hist.index[-1]),
        'fundamentals': fundamentals,
    }


def _safe_float(v) -> Optional[float]:
    """Coerce to float, treating None/NaN/non-numeric as None."""
    try:
        if v is None:
            return None
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> Optional[int]:
    """Coerce to int, treating None/NaN/non-numeric as None."""
    try:
        if v is None:
            return None
        f = float(v)
        if not math.isfinite(f):
            return None
        return int(f)
    except (TypeError, ValueError):
        return None


def _to_epoch_ms(v) -> Optional[int]:
    """Best-effort conversion of yfinance date fields to epoch milliseconds.

    Accepts: Unix-seconds ints (yfinance info), pandas Timestamps (DataFrame
    cells), datetime objects, or ISO strings. NaN/None -> None.
    """
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (int, float)):
        f = float(v)
        if not math.isfinite(f):
            return None
        # yfinance info dates are Unix seconds; assume seconds if < year 3000.
        return int(f * 1000) if f < 1e11 else int(f)
    try:
        ts = pd.Timestamp(v)
        if pd.isna(ts):
            return None
        return int(ts.timestamp() * 1000)
    except (TypeError, ValueError, OverflowError):
        return None


def get_short_interest(ticker: str) -> Dict:
    """Short-interest snapshot from yfinance.info plus FINRA bi-monthly history.

    yfinance gives the freshest current+prior values for the headline tiles.
    FINRA's `consolidatedShortInterest` dataset gives bi-monthly settlement
    history (~4y back) for the bar chart. FINRA returns [] for OTC-only or
    non-listed tickers, in which case `history` is empty and the UI falls
    back to a 2-bar prior/current view.
    """
    from data.finra_short_interest import get_short_interest_history

    try:
        info = get_company_info(ticker.upper()).raw or {}
    except Exception:
        info = {}

    history: list = []
    try:
        # 12 quarters ≈ 36 months ≈ 72 bi-monthly settlements. Pull a bit
        # more (78) to absorb the occasional missing settlement and let the
        # chart still display 12+ quarters of bars after any client-side
        # filtering.
        history = get_short_interest_history(ticker.upper(), limit=78)
    except Exception:  # pragma: no cover — never block the snapshot on enrichment
        history = []

    return {
        'ticker': ticker.upper(),
        'sharesShort': _safe_int(info.get('sharesShort')),
        'sharesShortPriorMonth': _safe_int(info.get('sharesShortPriorMonth')),
        'shortPercentOfFloat': _safe_float(info.get('shortPercentOfFloat')),
        'shortRatio': _safe_float(info.get('shortRatio')),
        'floatShares': _safe_int(info.get('floatShares')),
        'sharesOutstanding': _safe_int(info.get('sharesOutstanding')),
        'asOf': _to_epoch_ms(info.get('dateShortInterest')),
        'priorAsOf': _to_epoch_ms(
            info.get('sharesShortPreviousMonthDate')
            or info.get('sharesShortPriorMonthDate')
        ),
        'history': history,  # newest first; [] when ticker isn't NMS or FINRA unreachable
    }


def _df_col_finder(df):
    """Return a closure for case-insensitive substring column lookup.

    yfinance column names drift across versions; this hides the noise.
    """
    cols = {str(c).strip().lower(): c for c in df.columns}

    def find(*needles):
        for needle in needles:
            for lower, original in cols.items():
                if needle in lower:
                    return original
        return None

    return find


def _holders_df_to_list(df, shares_outstanding: Optional[int] = None) -> list:
    """Coerce a yfinance institutional_holders DataFrame to a JSON-clean list.

    When `shares_outstanding` is known, derive `pctHeld` as
    sharesHeld / sharesOutstanding so our percentages share a consistent
    denominator with the rest of the response. yfinance's `% Out` column
    sometimes uses a stale share base; falling back to it only when our
    derivation is null.
    """
    if df is None:
        return []
    try:
        if df.empty:
            return []
    except AttributeError:
        return []

    find = _df_col_finder(df)
    col_holder = find('holder')
    col_shares = find('shares')
    col_date = find('date reported', 'date')
    col_pct_out = find('% out', 'pctheld', 'pct held', '% held')
    col_value = find('value')
    col_pct_change = find('% change', 'pctchange', 'change')

    out = []
    for _, row in df.iterrows():
        shares_held = _safe_int(row[col_shares]) if col_shares is not None else None
        derived_pct = (
            (shares_held / shares_outstanding)
            if shares_held is not None and shares_outstanding
            else None
        )
        yfinance_pct = _safe_float(row[col_pct_out]) if col_pct_out is not None else None
        out.append({
            'holder': str(row[col_holder]) if col_holder is not None else None,
            'sharesHeld': shares_held,
            'dateReported': _to_epoch_ms(row[col_date]) if col_date is not None else None,
            'pctHeld': derived_pct if derived_pct is not None else yfinance_pct,
            'value': _safe_float(row[col_value]) if col_value is not None else None,
            'pctChange': _safe_float(row[col_pct_change]) if col_pct_change is not None else None,
        })
    return out


def _roster_df_to_list(df, shares_outstanding: Optional[int] = None) -> list:
    """Coerce yfinance `insider_roster_holders` to a JSON-clean list.

    Columns observed: Name, Position, URL, Most Recent Transaction,
    Latest Transaction Date, Position Direct Date, Shares Owned Directly,
    Position Indirect Date, Shares Owned Indirectly.
    """
    if df is None:
        return []
    try:
        if df.empty:
            return []
    except AttributeError:
        return []

    find = _df_col_finder(df)
    col_name = find('name')
    col_position = find('position')  # also matches 'Position Direct Date' — ok, we look up direct shares separately
    col_direct = find('shares owned directly', 'directly', 'direct')
    col_indirect = find('shares owned indirectly', 'indirectly', 'indirect')
    col_last_tx = find('most recent transaction', 'recent transaction')
    col_last_tx_date = find('latest transaction date', 'transaction date')

    out = []
    for _, row in df.iterrows():
        direct = _safe_int(row[col_direct]) if col_direct is not None else None
        indirect = _safe_int(row[col_indirect]) if col_indirect is not None else None
        total = None
        if direct is not None or indirect is not None:
            total = (direct or 0) + (indirect or 0)
        pct_so = (total / shares_outstanding) if total and shares_outstanding else None
        out.append({
            'name': str(row[col_name]) if col_name is not None else None,
            'position': str(row[col_position]) if col_position is not None else None,
            'sharesDirect': direct,
            'sharesIndirect': indirect,
            'totalShares': total,
            'pctOfSharesOutstanding': pct_so,
            'latestTransaction': str(row[col_last_tx]) if col_last_tx is not None else None,
            'latestTransactionDate': _to_epoch_ms(row[col_last_tx_date]) if col_last_tx_date is not None else None,
        })
    out.sort(key=lambda r: (r['totalShares'] or 0), reverse=True)
    return out


def _trades_df_to_list(df, limit: int = 30) -> list:
    """Coerce yfinance `insider_transactions` to a JSON-clean list.

    Columns observed: Start Date, Insider, Position, URL, Transaction, Text,
    Shares, Value, Ownership.
    Sorted by date desc, capped at `limit`. `ownership` is "D" (direct) or
    "I" (indirect/entity vehicle); we keep it as-is so the UI can pill it.
    """
    if df is None:
        return []
    try:
        if df.empty:
            return []
    except AttributeError:
        return []

    find = _df_col_finder(df)
    col_date = find('start date', 'date')
    col_insider = find('insider')
    col_position = find('position')
    col_transaction = find('transaction')
    col_text = find('text')
    col_shares = find('shares')
    col_value = find('value')
    col_ownership = find('ownership')

    out = []
    for _, row in df.iterrows():
        out.append({
            'date': _to_epoch_ms(row[col_date]) if col_date is not None else None,
            'insider': str(row[col_insider]) if col_insider is not None else None,
            'position': str(row[col_position]) if col_position is not None else None,
            'transaction': str(row[col_transaction]) if col_transaction is not None else None,
            'text': str(row[col_text]) if col_text is not None else None,
            'shares': _safe_int(row[col_shares]) if col_shares is not None else None,
            'value': _safe_float(row[col_value]) if col_value is not None else None,
            'ownership': str(row[col_ownership]) if col_ownership is not None else None,
        })
    # Keep newest first, drop rows with no date last so they don't crowd the head.
    out.sort(key=lambda r: (r['date'] is None, -(r['date'] or 0)))
    return out[:limit]


def get_ownership(ticker: str) -> Dict:
    """Ownership snapshot from yfinance.

    institutional/insider % come from info; retail = max(0, 1 - inst - insider).
    Top holders come from Ticker.institutional_holders (top 10 by yfinance default).
    Insider roster + transactions come from Ticker.insider_roster_holders /
    insider_transactions; the roster is also used to compute a "direct
    insider %" that excludes 13D/G beneficial-owner vehicles.
    """
    try:
        info = get_company_info(ticker.upper()).raw or {}
    except Exception:
        info = {}

    inst_pct = _safe_float(info.get('heldPercentInstitutions'))
    insider_pct = _safe_float(info.get('heldPercentInsiders'))
    retail_pct = None
    if inst_pct is not None or insider_pct is not None:
        retail_pct = max(0.0, 1.0 - (inst_pct or 0.0) - (insider_pct or 0.0))

    shares_outstanding = _safe_int(info.get('sharesOutstanding'))

    holders = []
    try:
        for h in get_institutional_holders(ticker.upper()):
            derived_pct = (h.shares / shares_outstanding) if h.shares and shares_outstanding else None
            holders.append({
                'holder': h.holder,
                'sharesHeld': h.shares,
                'dateReported': int(datetime.combine(h.date_reported, datetime.min.time()).timestamp() * 1000) if h.date_reported else None,
                'pctHeld': derived_pct if derived_pct is not None else h.percent_held,
                'value': h.value,
                'pctChange': None,
            })
    except Exception:
        holders = []

    roster = []
    try:
        for r in get_insider_holders(ticker.upper()):
            direct = r.shares_directly_owned
            indirect = r.shares_indirectly_owned
            total = (direct or 0) + (indirect or 0) if (direct is not None or indirect is not None) else None
            pct_so = (total / shares_outstanding) if total and shares_outstanding else None
            roster.append({
                'name': r.name,
                'position': r.position,
                'sharesDirect': direct,
                'sharesIndirect': indirect,
                'totalShares': total,
                'pctOfSharesOutstanding': pct_so,
                'latestTransaction': None,
                'latestTransactionDate': None,
            })
        roster.sort(key=lambda x: (x['totalShares'] or 0), reverse=True)
    except Exception:
        roster = []

    direct_insider_pct = None
    if roster and shares_outstanding:
        direct_total = sum((r.get('sharesDirect') or 0) for r in roster)
        if direct_total > 0:
            direct_insider_pct = direct_total / shares_outstanding

    trades = []
    try:
        for t in get_insider_transactions(ticker.upper())[:30]:
            trades.append({
                'date': int(datetime.combine(t.transaction_date, datetime.min.time()).timestamp() * 1000) if t.transaction_date else None,
                'insider': t.insider,
                'transaction': t.transaction_type,
                'text': t.transaction_type,
                'shares': t.shares,
                'value': t.value,
                'ownership': None,
            })
    except Exception:
        trades = []

    return {
        'ticker': ticker.upper(),
        'breakdown': {
            'institutionalPct': inst_pct,
            'insiderPct': insider_pct,
            'retailPct': retail_pct,
        },
        'floatShares': _safe_int(info.get('floatShares')),
        'sharesOutstanding': shares_outstanding,
        'topHolders': holders,
        'insiders': {
            'yahooInsiderPct': insider_pct,
            'directInsiderPct': direct_insider_pct,
            'roster': roster,
        },
        'trades': trades,
    }


def _format_market_cap(value: float) -> str:
    """Format market cap as $1.23T / $45.6B / $123M / $45K."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "—"
    abs_v = abs(v)
    if abs_v >= 1e12:
        return f"${v / 1e12:.2f}T"
    if abs_v >= 1e9:
        return f"${v / 1e9:.2f}B"
    if abs_v >= 1e6:
        return f"${v / 1e6:.2f}M"
    if abs_v >= 1e3:
        return f"${v / 1e3:.2f}K"
    return f"${v:.2f}"


def detect_mispricing(ticker: str) -> Dict:
    """
    Detect IV vs HV mispricing for any ticker.
    Generalized version of detect_mispricing_cifr().
    """
    # Pull a 5d window so we get spot + prev close in one provider call.
    # Falls back to today's open if we only have a single bar (first listing
    # day, holiday-adjacent windows). Mirrors get_ticker_detail's logic.
    bars = get_history(ticker, period="5d")
    if not bars:
        raise ValueError(f"Unable to fetch price for {ticker}")
    last = bars[-1]
    spot = float(last.close)
    prev_close = float(bars[-2].close) if len(bars) >= 2 else float(last.open)
    change = spot - prev_close
    change_pct = (change / prev_close * 100.0) if prev_close else 0.0

    hv = get_historical_volatility(ticker, window=30)
    options = get_options_chain_yahoo(ticker)

    # Find ATM call
    calls = options[options['type'] == 'call'].copy()
    calls['distance_to_atm'] = abs(calls['strike'] - spot)
    atm_call = calls.loc[calls['distance_to_atm'].idxmin()]

    iv = atm_call['impliedVolatility']
    iv_hv_ratio = iv / hv if hv > 0 else 0

    if iv_hv_ratio > 1.3:
        signal = "SELL"
    elif iv_hv_ratio < 0.8:
        signal = "BUY"
    else:
        signal = "NEUTRAL"

    return {
        'ticker': ticker,
        'spot_price': float(spot),
        'previous_close': round(prev_close, 4),
        'change': round(change, 4),
        'change_percent': round(change_pct, 4),
        'historical_vol': float(hv),
        'implied_vol_atm': float(iv),
        'iv_hv_ratio': float(iv_hv_ratio),
        'signal': signal,
        'expiration': str(atm_call['expiration']),
        'atm_strike': float(atm_call['strike']),
        'atm_call_price': float(atm_call['mid_price']),
        'bid': float(atm_call['bid']),
        'ask': float(atm_call['ask']),
        'volume': int(atm_call['volume']) if not pd.isna(atm_call['volume']) else 0,
        'open_interest': int(atm_call['openInterest']) if not pd.isna(atm_call['openInterest']) else 0
    }


def get_options_chain(ticker: str, expiration_index: int = 0) -> Dict:
    """
    Get options chain for any ticker.

    Returns dict with calls, puts DataFrames and metadata.
    """
    expirations = get_option_expirations(ticker)

    if not expirations:
        raise ValueError(f"No options data for {ticker}")

    if expiration_index >= len(expirations):
        expiration_index = len(expirations) - 1

    exp_date = expirations[expiration_index]
    chain = get_option_chain(ticker, exp_date)

    def _contract_to_dict(c):
        return {
            'strike': c.strike,
            'lastPrice': c.last_price,
            'bid': c.bid,
            'ask': c.ask,
            'impliedVolatility': c.implied_volatility,
            'openInterest': c.open_interest,
            'volume': c.volume,
            'inTheMoney': c.in_the_money,
        }

    return {
        'ticker': ticker,
        'expiration': exp_date,
        'expirations_available': list(expirations),
        'calls': [_contract_to_dict(c) for c in chain.calls],
        'puts': [_contract_to_dict(c) for c in chain.puts],
    }


def get_tca_data(ticker: str) -> Dict:
    """
    Transaction Cost Analysis using bid/ask spread data.
    """
    spot = get_ticker_price(ticker)
    options = get_options_chain_yahoo(ticker)

    calls = options[options['type'] == 'call'].copy()
    calls['distance_to_atm'] = abs(calls['strike'] - spot)
    atm_call = calls.loc[calls['distance_to_atm'].idxmin()]

    bid = float(atm_call['bid'])
    ask = float(atm_call['ask'])
    mid = (bid + ask) / 2
    spread = ask - bid
    spread_pct = (spread / mid * 100) if mid > 0 else 0

    # Estimate slippage (half the spread for market orders)
    slippage = spread / 2

    # Total estimated TCA per contract
    tca_per_contract = spread * 100  # 100 shares per contract

    # Get IV and HV for edge comparison
    hv = get_historical_volatility(ticker, window=30)
    iv = float(atm_call['impliedVolatility'])
    edge = abs(iv - hv)

    # Convert edge to dollar terms (approximate via vega)
    # Edge survives if dollar edge > TCA
    edge_in_dollars = edge * mid * 100  # rough approximation
    edge_survives = edge_in_dollars > tca_per_contract

    return {
        'ticker': ticker,
        'bid': round(bid, 4),
        'ask': round(ask, 4),
        'mid': round(mid, 4),
        'spread': round(spread, 4),
        'spread_pct': round(spread_pct, 2),
        'slippage_estimate': round(slippage, 4),
        'tca_per_contract': round(tca_per_contract, 2),
        'iv': round(iv, 4),
        'hv': round(hv, 4),
        'edge_dollars': round(edge_in_dollars, 2),
        'edge_survives_tca': edge_survives,
        'atm_strike': float(atm_call['strike']),
        'expiration': str(atm_call['expiration'])
    }


def get_price_history(ticker: str, period: str = "1M", interval: str = "1D") -> dict:
    """
    Get OHLCV price history for any ticker.

    Args:
        ticker: Stock symbol
        period: 1D, 5D, 1W, 1M, 3M, 6M, 1Y, 2Y, 5Y, ALL
        interval: Auto-mapped from period if not specified
    """
    period_map = {
        "1D": "1d", "5D": "5d", "1W": "5d",
        "1M": "1mo", "3M": "3mo", "6M": "6mo",
        "1Y": "1y", "2Y": "2y", "5Y": "5y", "ALL": "max",
    }
    interval_map = {
        "1D": "5m", "5D": "30m", "1W": "30m",
        "1M": "1d", "3M": "1d", "6M": "1d",
        "1Y": "1d", "2Y": "1wk", "5Y": "1wk", "ALL": "1wk",
    }

    yf_period = period_map.get(period.upper(), "1mo")
    yf_interval = interval_map.get(period.upper(), "1d")

    bars = get_history(ticker, period=yf_period, interval=yf_interval)
    if not bars:
        raise ValueError(f"No price history for {ticker}")

    records = []
    for b in bars:
        ts_ns = int(pd.Timestamp(b.date).value)
        records.append({
            "timestamp": int(ts_ns // 1_000_000),
            "date": b.date.isoformat(),
            "open": round(b.open, 4),
            "high": round(b.high, 4),
            "low": round(b.low, 4),
            "close": round(b.close, 4),
            "volume": int(b.volume),
        })

    return {
        "ticker": ticker,
        "period": period.upper(),
        "interval": yf_interval,
        "data": records,
    }


def detect_mispricing_alpaca(ticker: str) -> Dict:
    """
    Detect IV vs HV mispricing using Alpaca's real-time options data.
    
    More accurate than Yahoo Finance version - uses live greeks and IV.
    """
    from execution.alpaca_client import get_options_chain_snapshot
    
    # Get spot price from Yahoo (still free and reliable)
    spot = get_ticker_price(ticker)
    
    # Get historical volatility
    hv = get_historical_volatility(ticker, window=30)
    
    # Get Alpaca options chain snapshot
    chain_data = get_options_chain_snapshot(ticker, option_type='call')
    
    if 'error' in chain_data:
        raise ValueError(f"Alpaca options data unavailable: {chain_data.get('error')}")
    
    snapshots = chain_data.get('snapshots', {})
    if not snapshots:
        raise ValueError(f"No options data for {ticker}")
    
    # Find ATM call with IV data
    best_atm = None
    min_distance = float('inf')
    
    for symbol, data in snapshots.items():
        # Extract strike from OCC symbol (e.g., CIFR260220C00017000 -> $17.00)
        try:
            strike_str = symbol[-8:]  # Last 8 chars = strike price in cents
            strike = float(strike_str) / 1000.0
        except:
            continue
            
        if 'impliedVolatility' not in data or data['impliedVolatility'] is None:
            continue
            
        distance = abs(strike - spot)
        if distance < min_distance:
            min_distance = distance
            best_atm = {
                'symbol': symbol,
                'strike': strike,
                'iv': data['impliedVolatility'],
                'greeks': data.get('greeks', {}),
                'quote': data.get('latestQuote', {}),
            }
    
    if not best_atm:
        raise ValueError(f"No ATM options with IV data found for {ticker}")
    
    iv = best_atm['iv']
    iv_hv_ratio = iv / hv if hv > 0 else 0
    
    if iv_hv_ratio > 1.3:
        signal = "SELL"
    elif iv_hv_ratio < 0.8:
        signal = "BUY"
    else:
        signal = "NEUTRAL"
    
    quote = best_atm['quote']
    bid = quote.get('bp', 0)
    ask = quote.get('ap', 0)
    mid = (bid + ask) / 2 if bid > 0 and ask > 0 else 0
    
    # Extract expiration from symbol (e.g., CIFR260220C00017000 -> 2026-02-20)
    symbol = best_atm['symbol']
    exp_year = 2000 + int(symbol[4:6])
    exp_month = int(symbol[6:8])
    exp_day = int(symbol[8:10])
    expiration = f"{exp_year}-{exp_month:02d}-{exp_day:02d}"
    
    return {
        'ticker': ticker,
        'spot_price': float(spot),
        'historical_vol': float(hv),
        'implied_vol_atm': float(iv),
        'iv_hv_ratio': float(iv_hv_ratio),
        'signal': signal,
        'expiration': expiration,
        'atm_strike': best_atm['strike'],
        'atm_call_price': mid,
        'bid': bid,
        'ask': ask,
        'greeks': best_atm['greeks'],
        'occ_symbol': symbol,
        'data_source': 'alpaca',
    }


def get_option_expirations_summary(ticker: str) -> Optional[Dict]:
    """Available expirations for a ticker, each with DTE, ATM IV, and total OI.

    Lifted from the inline body of `routes.get_option_expirations` so multiple
    callers (the route handler + the vol-term-spike detector) can share the
    yfinance round-trips.

    Returns None on error — callers should treat that as "no data available"
    and skip the ticker rather than raising.
    """
    from datetime import date as _date

    sym = ticker.upper()
    try:
        expiries = get_option_expirations(sym)
        if not expiries:
            return {"ticker": sym, "spot": None, "expirations": []}

        spot_bars = get_history(sym, period="1d")
        spot = float(spot_bars[-1].close) if spot_bars else None

        out = []
        today = _date.today()
        for exp_str in expiries:
            try:
                exp_d = _date.fromisoformat(exp_str)
            except ValueError:
                continue
            dte = (exp_d - today).days
            atm_iv: Optional[float] = None
            total_oi = 0
            try:
                chain = get_option_chain(sym, exp_str)
                # ATM IV from the call whose strike is closest to spot.
                if spot is not None and chain.calls:
                    closest = min(chain.calls, key=lambda c: abs(c.strike - spot))
                    if closest.implied_volatility is not None:
                        atm_iv = float(closest.implied_volatility)
                for leg in (chain.calls, chain.puts):
                    total_oi += sum((c.open_interest or 0) for c in leg)
            except Exception:
                pass
            out.append({
                "expiration": exp_str,
                "dte": dte,
                "atm_iv": round(atm_iv, 4) if atm_iv is not None else None,
                "total_oi": total_oi,
            })
        return {"ticker": sym, "spot": spot, "expirations": out}
    except Exception:
        return None
