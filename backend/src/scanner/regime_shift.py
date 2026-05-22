"""Fundamentals Regime-Shift Scanner — single-ticker LLM classifier.

Implements the 6-step rubric the user supplied (fundamental inflection,
strategic mix shift, guidance underestimation, tape confirmation,
classification, JSON output) by:

1. Aggregating already-wired data sources into a structured payload.
2. Sending the payload + the full rubric to Claude.
3. Parsing the strict JSON response into a Pydantic model.

Reuses (does not duplicate):
- data.fundamentals.get_income_statement_history (8q quarterly)
- data.fundamentals.get_ticker_fundamentals (TTM aggregates, gross margins,
  earnings growth, beta, recommendation)
- data.earnings_extract.get_latest_earnings_release (most recent 8-K actuals)
- data.market_data.get_price_history / detect_mispricing (52W highs, 6/12mo
  perf, IV/HV)
- data.hmm_regime.detect_current_regime (volatility regime context)
- data.ir_scraper.aggregate_ir_data (recent news/filings as text snippets)
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from llm.anthropic_client import AnthropicNotConfigured
from llm.gemini_client import GeminiNotConfigured

log = logging.getLogger(__name__)

# Cache classifications for ~15 min so tab-switching doesn't re-bill Claude.
_CACHE_TTL_SEC = 15 * 60
_cache: Dict[str, Tuple[float, "RegimeShiftResult"]] = {}


# ---------------------------------------------------------------------------
# Output schema (matches the user's exact spec, plus inputs_echo + data_gaps)
# ---------------------------------------------------------------------------

CLASSIFICATIONS = (
    "HIGH-CONVICTION REGIME SHIFT",
    "EARLY WATCHLIST CANDIDATE",
    "NO REGIME SHIFT DETECTED",
)


class RegimeShiftResult(BaseModel):
    ticker: str
    classification: str
    fundamental_inflection: bool
    strategic_mix_shift: bool
    guidance_underestimation: bool
    tape_confirmation: bool
    key_reasons: List[str]
    suggested_actions: List[str]
    # Provenance — not in the user's prompt schema, but the UI relies on these
    # to (a) show what was sent to the LLM and (b) flag weakly-supported
    # booleans driven by missing inputs.
    inputs_echo: Dict[str, Any] = Field(default_factory=dict)
    data_gaps: List[str] = Field(default_factory=list)
    model: Optional[str] = None
    as_of: Optional[str] = None


# ---------------------------------------------------------------------------
# System prompt — the user's rubric verbatim. Cached on the Anthropic side.
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an equity research assistant that scans one stock at a time
to find *early* signs of a large upside fundamental regime shift
(similar to SanDisk SNDK's datacenter/AI-driven explosion in 2025-2026).

You are given the following, all for a single ticker:

1. Quarterly fundamentals for the last 8 quarters:
   - Revenue
   - Gross margin %
   - Operating margin %
   - Segment breakdowns (e.g., datacenter, consumer, edge)
   - EPS (GAAP and non-GAAP if available)

2. Company guidance and actuals for the last 4 quarters:
   - Management revenue and EPS guidance ranges
   - Consensus (Street) estimates
   - Actual reported results

3. Key text snippets from earnings releases, call transcripts,
   investor day decks, and major news:
   - Management commentary about product/segment mix
   - Mentions of AI/datacenter/enterprise/long-term contracts/backlog
   - Comments on cyclicality, visibility, pricing power

4. Basic technical and options context:
   - Price trend (e.g., new 52-week highs or all-time highs)
   - 1-month and 3-month performance
   - Volume vs 3-month average
   - Options implied volatility and "expected move" into next earnings
   - Short interest (if provided)

Your goal: Decide if this ticker is in the early or middle stages of a
fundamental regime shift that could justify a very large move
(>100% over 6-18 months) and should trigger an alert.

Follow these steps carefully:

STEP 1 - Check for a FUNDAMENTAL INFLECTION
- Look for revenue growth re-accelerating over the last 2-4 quarters.
  Focus on:
  - QoQ growth turning positive and >10-15%, AND/OR
  - YoY growth turning from negative/low to >20-30%.
- Check whether gross margin % and operating margin %
  are rising at the same time.
- Mark **Fundamental Inflection = TRUE** if:
  - Revenue is growing >20% YoY OR >10-15% QoQ
    AND
  - Gross margin and operating margin have both improved
    by at least 300-500 bps over the last 2-4 quarters.

STEP 2 - Check for MIX SHIFT & STRATEGIC NARRATIVE
From the segment data and text snippets, determine:
- Is a higher-value segment (e.g., AI/datacenter/enterprise/long-term
  software-like contracts) growing much faster than the rest?
- Does management explicitly highlight:
  - AI/datacenter or other structural growth theme
  - Long-term or multi-year contracts
  - Contracted or guaranteed revenue
  - Large backlog (especially if quantified in multi-billion terms)
  - Reduced cyclicality / improved visibility
- Mark **Strategic Mix Shift = TRUE** if:
  - At least one high-value segment shows >50% YoY growth,
    OR has gone from small to meaningful share of revenue
    in <=4 quarters,
    AND
  - Management commentary repeatedly emphasizes that segment,
    long-term deals, backlog, or visibility.

STEP 3 - Check GUIDANCE VS ACTUALS VS STREET
Use the guidance and actuals:
- Count how many of the last 4 quarters:
  - Actual revenue > high end of company guidance.
  - Actual revenue > consensus estimates by >=10%.
- Note whether guidance has been raised multiple times.
- Mark **Guidance Underestimation = TRUE** if:
  - At least 2 of the last 4 quarters beat BOTH
    company guidance high end AND Street estimates by >=10%,
    OR
  - Management has raised guidance at least twice, and
    actuals still outperform the raised guidance.

STEP 4 - Check TAPE CONFIRMATION
From the technical data:
- Is the stock making new 52-week or all-time highs?
- Is recent performance strong (e.g., >50% in 6-12 months)?
- Has volume been elevated on up days vs the 3-month average?
- Is options implied volatility or the "expected move" expanding into
  upcoming earnings (indicating the market is starting to price a regime
  change rather than a small beat)?
- Mark **Tape Confirmation = TRUE** if:
  - The stock is near 52-week or all-time highs,
    AND
  - 6-12 month performance is >=50%,
    AND/OR
  - There is sustained above-average volume on up days.

STEP 5 - DECISION
Use the following decision rule:

- If Fundamental Inflection = TRUE
  AND Strategic Mix Shift = TRUE
  AND Guidance Underestimation = TRUE
  AND Tape Confirmation = TRUE:
    -> Classification: "HIGH-CONVICTION REGIME SHIFT"
    -> Action: Trigger an ALERT.

- If at least 2 of the above are TRUE, but others are weak/mixed:
    -> Classification: "EARLY WATCHLIST CANDIDATE"
    -> Action: Flag for monitoring, but no strong alert.

- Otherwise:
    -> Classification: "NO REGIME SHIFT DETECTED"
    -> Action: No alert.

STEP 6 - OUTPUT FORMAT
Return a compact JSON object with:
- "classification": one of
  ["HIGH-CONVICTION REGIME SHIFT",
   "EARLY WATCHLIST CANDIDATE",
   "NO REGIME SHIFT DETECTED"]
- "fundamental_inflection": true/false
- "strategic_mix_shift": true/false
- "guidance_underestimation": true/false
- "tape_confirmation": true/false
- "key_reasons": a short list of 3-6 bullet points
  (plain text) summarizing why you classified it this way,
  using specific numbers mentioned in the input where possible.
- "suggested_actions": a short list of 2-4 bullet points on what
  a trader or investor might do (e.g., "dig into backlog quality",
  "model FCF under new margin profile", "watch next earnings
  with call spreads", etc.).

Be strict. Only classify "HIGH-CONVICTION REGIME SHIFT"
when the evidence matches an extreme move similar to
SanDisk SNDK's 2025-2026 explosion in revenue and operating income.

Important implementation notes:
- Some inputs may be missing (e.g., explicit guidance ranges, segment
  splits, Street consensus). When a check's evidence is missing, lean
  FALSE for that check rather than guessing — and call out the data gap
  in key_reasons.
- Return ONLY the JSON object. No prose, no code fences, no commentary.
"""


# ---------------------------------------------------------------------------
# Input aggregation
# ---------------------------------------------------------------------------


def _safe_call(label: str, fn, gaps: List[str], *args, **kwargs):
    """Run `fn(*args, **kwargs)` and append a gap note on any failure.

    The aggregation step calls 6+ data sources — any one of which can flake
    out (yfinance hiccups, SEC throttling, etc.). A single failure shouldn't
    void the whole scan; we record what's missing and let the LLM handle it.
    """
    try:
        out = fn(*args, **kwargs)
        if out is None:
            gaps.append(f"{label}: no data returned")
        return out
    except Exception as exc:
        log.warning("regime_shift: %s failed: %s", label, exc)
        gaps.append(f"{label}: {type(exc).__name__}")
        return None


def _last_n(values: List[Any], n: int) -> List[Any]:
    return values[:n] if values else []


def _slim_quarterly(income_stmt: Dict[str, Any]) -> Dict[str, Any]:
    """Reduce the 28-row income statement to the rubric's 5 metrics × 8q.

    yfinance returns most-recent first; we keep the same order so column 0
    is the latest reported quarter.
    """
    if not income_stmt or not income_stmt.get("rows"):
        return {}
    by_key = {r["key"]: r.get("values") or [] for r in income_stmt["rows"]}
    years = _last_n(income_stmt.get("years") or [], 8)
    return {
        "periods": years,  # newest first; e.g. ["Mar '26", "Dec '25", ...]
        "revenue_M": _last_n(by_key.get("total_revenues") or [], 8),
        "revenue_yoy_chg": _last_n(by_key.get("total_revenues_chg") or [], 8),
        "gross_margin": _last_n(by_key.get("gross_margin") or [], 8),
        "operating_margin": _last_n(by_key.get("operating_margin") or [], 8),
        "eps_diluted": _last_n(by_key.get("eps_diluted") or [], 8),
        "operating_profit_M": _last_n(by_key.get("operating_profit") or [], 8),
    }


def _price_context(history_payload: Dict[str, Any]) -> Dict[str, Any]:
    """Derive 52W high/low, 6/12-month performance, volume-vs-avg from OHLCV.

    Frontend already does the same math elsewhere (charts/StockPriceChart);
    we redo it server-side so we send numbers — not raw bars — to the LLM.
    """
    if not history_payload or not history_payload.get("data"):
        return {}
    bars = history_payload["data"]
    if not bars:
        return {}

    closes = [b.get("close") for b in bars if b.get("close") is not None]
    volumes = [b.get("volume") for b in bars if b.get("volume") is not None]
    if not closes:
        return {}

    latest_close = closes[-1]
    yr_high = max(closes[-252:]) if len(closes) >= 5 else max(closes)
    yr_low = min(closes[-252:]) if len(closes) >= 5 else min(closes)
    pct_off_52w_high = (yr_high - latest_close) / yr_high if yr_high else None

    def _pct_from_lookback(days: int) -> Optional[float]:
        if len(closes) <= days:
            return None
        ref = closes[-(days + 1)]
        if not ref:
            return None
        return (latest_close - ref) / ref

    perf_1m = _pct_from_lookback(21)
    perf_3m = _pct_from_lookback(63)
    perf_6m = _pct_from_lookback(126)
    perf_12m = _pct_from_lookback(252)

    # Volume vs 3-month average (last ~63 trading days). Compare last 5 days
    # to the 3-month average — gives the LLM a "is current activity elevated"
    # signal without us having to identify up vs. down days here.
    vol_avg_3m = (sum(volumes[-63:]) / len(volumes[-63:])) if len(volumes) >= 63 else None
    recent_vol_avg = (sum(volumes[-5:]) / 5) if len(volumes) >= 5 else None
    vol_ratio = (
        recent_vol_avg / vol_avg_3m
        if vol_avg_3m and recent_vol_avg and vol_avg_3m > 0
        else None
    )

    return {
        "latest_close": round(latest_close, 4) if latest_close else None,
        "52w_high": round(yr_high, 4) if yr_high else None,
        "52w_low": round(yr_low, 4) if yr_low else None,
        "pct_off_52w_high": round(pct_off_52w_high, 4) if pct_off_52w_high is not None else None,
        "perf_1m": round(perf_1m, 4) if perf_1m is not None else None,
        "perf_3m": round(perf_3m, 4) if perf_3m is not None else None,
        "perf_6m": round(perf_6m, 4) if perf_6m is not None else None,
        "perf_12m": round(perf_12m, 4) if perf_12m is not None else None,
        "recent_volume_vs_3mo_avg_ratio": round(vol_ratio, 3) if vol_ratio is not None else None,
    }


def _slim_news(ir_data: Dict[str, Any], max_items: int = 8) -> List[Dict[str, str]]:
    """Reduce IR news payload to (date, title) pairs the LLM can scan quickly."""
    if not ir_data or not ir_data.get("news"):
        return []
    out: List[Dict[str, str]] = []
    for item in ir_data["news"][:max_items]:
        title = item.get("title") or ""
        if not title:
            continue
        out.append({
            "title": title,
            "date": str(item.get("publish_date") or item.get("publish_time") or ""),
            "publisher": str(item.get("publisher") or ""),
        })
    return out


def aggregate_inputs(ticker: str) -> Tuple[Dict[str, Any], List[str]]:
    """Pull every data source the rubric needs. Returns (payload, data_gaps)."""
    ticker_u = ticker.upper()
    gaps: List[str] = []

    # Local imports — avoids pulling these into the FastAPI startup graph
    # for environments that don't use the regime scanner.
    from data.fundamentals import (
        get_income_statement_history,
        get_ticker_fundamentals,
    )
    from data.earnings_extract import get_latest_earnings_release
    from data.market_data import get_price_history, detect_mispricing
    from data.hmm_regime import detect_current_regime
    from data.ir_scraper import aggregate_ir_data

    quarterly = _safe_call(
        "income_statement_quarterly",
        get_income_statement_history,
        gaps,
        ticker_u,
        periods=8,
        quarterly=True,
    ) or {}

    fundamentals = _safe_call(
        "ticker_fundamentals", get_ticker_fundamentals, gaps, ticker_u
    ) or {}

    latest_earnings = _safe_call(
        "latest_earnings_release",
        get_latest_earnings_release,
        gaps,
        ticker_u,
    ) or {}

    price_history = _safe_call(
        "price_history_1y", get_price_history, gaps, ticker_u, period="2Y"
    ) or {}

    mispricing = _safe_call(
        "iv_hv_mispricing", detect_mispricing, gaps, ticker_u
    ) or {}

    regime = _safe_call(
        "hmm_regime", detect_current_regime, gaps, ticker_u
    ) or {}

    ir = _safe_call("ir_aggregate", aggregate_ir_data, gaps, ticker_u) or {}

    # Surface known data gaps explicitly so the LLM (and the UI) can be
    # honest about what's missing in v1.
    if not quarterly.get("rows"):
        gaps.append("Quarterly income statement unavailable")
    if not latest_earnings:
        gaps.append("No recent 8-K/6-K earnings release parsed (last 120 days)")
    # Segment breakdowns and explicit guidance ranges are not yet wired —
    # always note these so the LLM doesn't conjure them.
    gaps.append("Segment-level revenue breakdown not parsed (10-Q segments TODO)")
    gaps.append(
        "Explicit management guidance ranges not parsed (only press-release headline numbers available)"
    )
    gaps.append("Street consensus estimates not wired (no analyst-estimate data source)")

    payload: Dict[str, Any] = {
        "ticker": ticker_u,
        "company_name": fundamentals.get("name"),
        "fundamentals_quarterly_8q": _slim_quarterly(quarterly),
        "ttm_aggregates": {
            "revenue": fundamentals.get("revenue"),
            "revenue_growth_1y": fundamentals.get("revenueGrowth1y"),
            "revenue_cagr": fundamentals.get("revenueCagr"),
            "operating_income": fundamentals.get("operatingIncome"),
            "operating_margin": fundamentals.get("operatingMargin"),
            "gross_margins": fundamentals.get("grossMargins"),
            "profit_margins": fundamentals.get("profitMargins"),
            "ebitda_margins": fundamentals.get("ebitdaMargins"),
            "earnings_growth": fundamentals.get("earningsGrowth"),
            "return_on_equity": fundamentals.get("returnOnEquity"),
            "forward_pe": fundamentals.get("forwardPE"),
            "trailing_pe": fundamentals.get("trailingPE"),
            "analyst_upside_pct": fundamentals.get("analystUpsidePct"),
            "recommendation": fundamentals.get("recommendationKey"),
        },
        "latest_earnings_release": {
            k: latest_earnings.get(k)
            for k in (
                "period_end",
                "fiscal_period",
                "filing_form",
                "filing_date",
                "revenue_M",
                "operating_income_M",
                "net_income_M",
                "eps_basic",
                "eps_diluted",
                "currency",
            )
            if latest_earnings.get(k) is not None
        },
        "price_context": _price_context(price_history),
        "iv_context": {
            "implied_vol_atm": mispricing.get("implied_vol_atm"),
            "historical_vol_30d": mispricing.get("historical_vol"),
            "iv_hv_ratio": mispricing.get("iv_hv_ratio"),
            "atm_strike": mispricing.get("atm_strike"),
            "expiration": mispricing.get("expiration"),
            "spot_price": mispricing.get("spot_price"),
            "regime": regime.get("regime"),
            "regime_probability": regime.get("probability"),
        },
        "news_headlines": _slim_news(ir),
    }

    return payload, gaps


# ---------------------------------------------------------------------------
# Prompt builder + classifier
# ---------------------------------------------------------------------------


def build_prompt(inputs: Dict[str, Any]) -> Tuple[str, str]:
    """Return (system_prompt, user_prompt). System is cached server-side."""
    import json
    user_prompt = (
        f"Ticker: {inputs.get('ticker')}\n"
        f"Company: {inputs.get('company_name') or '(unknown)'}\n\n"
        "Structured data follows. Apply the 6-step rubric and return ONLY the "
        "JSON object specified in STEP 6.\n\n"
        f"```json\n{json.dumps(inputs, indent=2, default=str)}\n```\n"
    )
    return SYSTEM_PROMPT, user_prompt


def _coerce_result(
    raw: Dict[str, Any],
    *,
    ticker: str,
    inputs_echo: Dict[str, Any],
    data_gaps: List[str],
    model: str,
) -> RegimeShiftResult:
    """Validate + sanitize the model's JSON response into our schema."""
    classification = str(raw.get("classification") or "").strip()
    if classification not in CLASSIFICATIONS:
        # Defensive: model occasionally adds punctuation or different casing.
        norm = classification.upper().rstrip(".")
        if norm in CLASSIFICATIONS:
            classification = norm
        else:
            classification = "NO REGIME SHIFT DETECTED"

    def _bool(name: str) -> bool:
        v = raw.get(name)
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ("true", "yes", "1")
        return False

    def _str_list(name: str) -> List[str]:
        v = raw.get(name)
        if isinstance(v, list):
            return [str(x) for x in v if x]
        if isinstance(v, str):
            return [v]
        return []

    return RegimeShiftResult(
        ticker=ticker,
        classification=classification,
        fundamental_inflection=_bool("fundamental_inflection"),
        strategic_mix_shift=_bool("strategic_mix_shift"),
        guidance_underestimation=_bool("guidance_underestimation"),
        tape_confirmation=_bool("tape_confirmation"),
        key_reasons=_str_list("key_reasons"),
        suggested_actions=_str_list("suggested_actions"),
        inputs_echo=inputs_echo,
        data_gaps=data_gaps,
        model=model,
        as_of=time.strftime("%Y-%m-%d %H:%M:%S"),
    )


def _select_llm():
    """Return ``(complete_json_fn, model_name)`` for the configured provider.

    Anthropic is preferred when ``ANTHROPIC_API_KEY`` is set; otherwise we
    fall back to Gemini if ``GEMINI_API_KEY`` (or ``GOOGLE_API_KEY``) is
    available. The two clients share the same ``complete_json(system, user)``
    signature so the caller doesn't branch.
    """
    import os

    if os.environ.get("ANTHROPIC_API_KEY"):
        from llm.anthropic_client import complete_json as anthropic_complete
        from llm.anthropic_client import DEFAULT_MODEL as anthropic_model
        return anthropic_complete, anthropic_model

    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        from llm.gemini_client import complete_json as gemini_complete
        from llm.gemini_client import _resolved_default_model
        # Re-read each call so .env model overrides take effect without a restart.
        return gemini_complete, _resolved_default_model()

    # Neither configured — surface the Anthropic-side error since that's the
    # primary path documented in .env.example.
    raise AnthropicNotConfigured(
        "Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set. "
        "Add one to backend/.env to enable the regime-shift scanner."
    )


def classify(ticker: str, *, force: bool = False) -> RegimeShiftResult:
    """Run the full pipeline. ``force=True`` bypasses the 15-min cache."""
    key = ticker.upper()
    now = time.time()
    if not force:
        cached = _cache.get(key)
        if cached and (now - cached[0]) < _CACHE_TTL_SEC:
            return cached[1]

    complete_json, model_name = _select_llm()
    inputs, gaps = aggregate_inputs(key)
    system, user = build_prompt(inputs)
    raw = complete_json(system=system, user=user)
    result = _coerce_result(
        raw, ticker=key, inputs_echo=inputs, data_gaps=gaps, model=model_name
    )
    _cache[key] = (now, result)
    return result


__all__ = [
    "AnthropicNotConfigured",
    "GeminiNotConfigured",
    "RegimeShiftResult",
    "aggregate_inputs",
    "build_prompt",
    "classify",
]
