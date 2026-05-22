"""LLM-driven contract extractor for the contract-aware DCF tab.

Reads recent 8-K Exhibit 99.1 press releases plus IR news headlines for a
single ticker, runs them through the configured LLM (Gemini today, Claude
when ANTHROPIC_API_KEY is set), and returns typed Contract objects with
counterparty, capacity (MW), term, energization date, and stated/estimated
annual revenue.

The /stock/[ticker] DCF tab uses these to bake a per-year contract revenue
layer on top of the existing TTM × (1+CAGR)^t projection — so a CIFR
fair-value reflects the 4.3 GW of disclosed AWS / Google leases instead of
just extrapolating last quarter's revenue.

Disk cache key includes the latest 8-K accession so it invalidates
automatically when a new filing arrives. Mirrors the cache layout in
``earnings_llm_extract.py`` and the LLM-selector pattern in
``scanner/regime_shift.py``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import pathlib
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

# Re-exported for the FastAPI route's 503 path.
from llm.anthropic_client import AnthropicNotConfigured  # noqa: F401
from llm.gemini_client import GeminiQuotaExceeded  # noqa: F401

log = logging.getLogger(__name__)

# v1 uses Flash (not Flash-Lite) — multi-document reasoning across long
# press-release prose is denser than the tabular earnings extractor.
_DEFAULT_GEMINI_MODEL = os.getenv("CONTRACT_LLM_MODEL", "gemini-2.5-flash")
_LOOKBACK_DAYS = 1095  # 36 months — covers CIFR's full HPC pivot history.
_DEFAULT_REV_PER_MW_M = 2.0  # HPC industry baseline when $ figure absent.
_MAX_PROMPT_CHARS = 250_000  # cumulative budget — Gemini Flash handles 1M ctx.
# Per-filing cap. Earnings 8-Ks run 30-50 KB; contract-announcement 8-Ks
# (Item 1.01 / 7.01) run 5-15 KB. Capping each ~10 KB lets ~25 filings fit
# in the budget — enough to span CIFR's full 36-month HPC pivot history.
_MAX_BODY_CHARS_PER_FILING = 10_000
_NEWS_HEADLINE_LIMIT = 15
_FILINGS_FETCH_LIMIT = 80
_CACHE_TTL_SEC = 30 * 60

# Lightweight signals to skip pure earnings press releases — those are
# tabular financial statements, not contract prose, and they crowd out the
# real contract announcements we care about. A press release is "earnings"
# if the body has at least 3 of these tokens AND lacks any of the
# contract-signal tokens.
_EARNINGS_TOKENS = (
    "GAAP", "diluted EPS", "operating expenses", "net income",
    "non-GAAP", "consolidated statements", "comprehensive income",
    "cash flow", "balance sheet",
)
_CONTRACT_SIGNAL_TOKENS = (
    "MW", "megawatt", "gigawatt", "lease", "tenant", "hyperscale",
    "data center", "datacenter", "AI", "HPC", "GPU", "AWS", "Amazon",
    "Google", "Microsoft", "Oracle", "Anthropic", "OpenAI", "CoreWeave",
    "PPA", "purchase agreement", "energization", "go-live",
    "ready for service", "commencement", "executed",
)

_VALID_CONTRACT_TYPES = {
    "hpc_hosting", "hpc_lease", "ppa", "colocation",
    "btc_hosting", "energy_supply", "joint_venture", "other",
}
_VALID_CONFIDENCE = {"high", "medium", "low"}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ContractSource(BaseModel):
    accession: Optional[str] = None
    filing_form: Optional[str] = None
    filing_date: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None


class Contract(BaseModel):
    id: str
    counterparty: Optional[str] = None
    contract_type: str = "other"
    capacity_mw: Optional[float] = None
    term_years: Optional[float] = None
    energization_date: Optional[str] = None
    annual_revenue_M_stated: Optional[float] = None
    annual_revenue_M_estimated: Optional[float] = None
    currency: Optional[str] = "USD"
    confidence: str = "low"
    notes: Optional[str] = None
    source: ContractSource = Field(default_factory=ContractSource)


class ContractExtractResult(BaseModel):
    ticker: str
    contracts: List[Contract] = Field(default_factory=list)
    data_gaps: List[str] = Field(default_factory=list)
    model: Optional[str] = None
    as_of: str = ""
    inputs_echo: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You extract signed commercial contracts from SEC 8-K press releases and IR news headlines for a single issuer. Focus on revenue-generating commitments that are SIGNED (not LOIs, MOUs, term sheets, or "evaluating") and DISCLOSED with quantitative terms.

For each distinct contract, return these fields:
- counterparty: the customer / lessee name. Strip "Inc.", "LLC". Use the parent brand when both appear (e.g. "AWS" -> "Amazon Web Services").
- contract_type: one of "hpc_hosting", "hpc_lease", "ppa", "colocation", "btc_hosting", "energy_supply", "joint_venture", "other".
    hpc_hosting   = issuer hosts customer's GPUs/servers in their facility
    hpc_lease     = issuer leases datacenter capacity to customer (long-term)
    ppa           = power purchase agreement (issuer sells electricity)
    colocation    = traditional colo / rack space
    btc_hosting   = bitcoin-mining hosting for a third party
    energy_supply = issuer is buyer of electricity under contract
    joint_venture = equity-bearing partnership
- capacity_mw: total contracted capacity in MEGAWATTS. Convert gigawatts (x1000). For ranges, use the midpoint.
- term_years: contract duration. For "10 + two 5-year extension options", return 10.
- energization_date: when revenue STARTS. Look for "online", "energization", "delivery", "go-live", "commencement", "ready for service", "first power". Format YYYY-MM-DD if exact, YYYY-MM if month only, YYYY if year only. If already energized or unclear, return null.
- annual_revenue_M_stated: ONLY if a per-year revenue figure is explicitly stated in millions of the contract currency. Do NOT divide a stated total contract value by term unless the press release shows that math itself.
- currency: ISO 4217. Default "USD".
- confidence: "high" if all numbers verbatim; "medium" if any were derived from nearby sentences (e.g. MW pulled from a "400 MW datacenter" mention near the deal); "low" if you're inferring from indirect language.
- notes: one or two sentences on what you saw and any caveats.
- source_accession: the accession number of the 8-K this came from (use the exact value provided in the input). Omit when the only source is a news headline.

Deduplication: if the same deal appears in both an 8-K and a news headline, return ONE entry and prefer the 8-K. Same deal = same counterparty AND same capacity within 10% AND filing dates within 14 days. If a deal is later expanded (e.g. "expand from 100 MW to 200 MW"), emit TWO contracts so the user sees the expansion.

Multi-phase: a "400 MW phased over 2027-2029" deal should be emitted as separate contract objects per phase when the press release breaks them out, OR a single contract with energization_date = midpoint year when it doesn't.

Exclude (do NOT return): equipment purchases, ATM offerings, debt issuance, stock buybacks, BTC sales, employment agreements, vendor terms, generic credit facilities.

Return a JSON object with exactly two top-level keys:
  "contracts": array of contract objects (empty if none qualify)
  "data_gaps": array of short strings describing relevant deals you saw but couldn't classify cleanly

Return ONLY the JSON object. No prose, no code fences."""


# ---------------------------------------------------------------------------
# Disk cache
# ---------------------------------------------------------------------------

def _cache_dir() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[2] / ".cache" / "sec" / "contract_extracts"


def _cache_path(ticker: str, latest_accession_clean: str) -> pathlib.Path:
    return _cache_dir() / f"{ticker.upper()}_{latest_accession_clean or 'no8k'}.json"


def _read_cache(path: pathlib.Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _write_cache(path: pathlib.Path, payload: Dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, default=str))
        tmp.replace(path)
    except Exception as exc:  # pragma: no cover
        log.warning("contract-extract cache write failed for %s: %s", path.name, exc)


# ---------------------------------------------------------------------------
# In-memory TTL cache (per-ticker)
# ---------------------------------------------------------------------------

_cache: Dict[str, Tuple[float, ContractExtractResult]] = {}


# ---------------------------------------------------------------------------
# Input gathering
# ---------------------------------------------------------------------------

def _within_lookback(filing_date: str, days: int = _LOOKBACK_DAYS) -> bool:
    if not filing_date:
        return False
    try:
        dt = datetime.fromisoformat(filing_date)
    except ValueError:
        return False
    cutoff = datetime.now(tz=dt.tzinfo) if dt.tzinfo else datetime.now()
    return (cutoff - dt) <= timedelta(days=days)


def _gather_inputs(ticker: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[str]]:
    """Pull recent 8-Ks (with full press-release bodies) + news headlines.

    Returns ``(prompt_payload, sources_meta, gaps)`` where:
      - ``prompt_payload`` is the structured dict serialized into the user
        message (filings list with bodies + headlines).
      - ``sources_meta`` is the parallel list of full filing dicts (with
        accession, link, etc.) that the post-processor uses to attach
        ContractSource to LLM rows by accession.
      - ``gaps`` accumulates explicit caveats we want the user to see in the UI.
    """
    # Local imports — keep startup graph lean for environments that don't use
    # the contract scanner.
    from data.sec_exhibits import fetch_recent_filings, fetch_exhibit_991_full_text
    from data.ir_scraper import scrape_yahoo_news

    gaps: List[str] = [
        "8-K Item 1.01 / 7.01 full body not parsed (v1 reads exhibit 99.1 only)",
    ]

    # Pull a generous slice of recent filings; we'll filter to 8-K + lookback.
    try:
        all_filings = fetch_recent_filings(ticker, forms=("8-K", "6-K"), limit=_FILINGS_FETCH_LIMIT)
    except Exception as exc:
        log.warning("fetch_recent_filings failed for %s: %s", ticker, exc)
        gaps.append(f"SEC filings fetch failed: {type(exc).__name__}")
        all_filings = []

    eligible = [
        f for f in all_filings
        if f.get("form") in ("8-K", "6-K") and _within_lookback(f.get("filing_date") or "")
    ]
    if not eligible:
        gaps.append(f"No 8-K/6-K filings in last {_LOOKBACK_DAYS} days")

    def _looks_like_earnings(body: str) -> bool:
        if not body:
            return False
        sample = body[:8000]  # only look at the head — earnings tables sit there
        earnings_hits = sum(1 for tok in _EARNINGS_TOKENS if tok in sample)
        contract_hits = sum(1 for tok in _CONTRACT_SIGNAL_TOKENS if tok in sample)
        # 3+ earnings tokens AND fewer than 2 contract signals → drop.
        return earnings_hits >= 3 and contract_hits < 2

    # Walk newest-first; attach exhibit 99.1 body and add to the prompt under
    # a cumulative character budget.
    prompt_filings: List[Dict[str, Any]] = []
    sources_meta: List[Dict[str, Any]] = []
    chars_used = 0
    skipped_by_budget = 0
    for filing in eligible:
        try:
            body = fetch_exhibit_991_full_text(filing) or ""
        except Exception as exc:
            log.warning(
                "exhibit-99.1 full fetch failed for %s/%s: %s",
                ticker, filing.get("accession"), exc,
            )
            body = ""
        # Skip filings without any press-release body — pure 8-Ks (e.g. just
        # a Form 4 attachment) won't contain contract prose.
        if not body:
            continue
        # Skip pure earnings press releases — they crowd out the actual
        # contract-announcement 8-Ks we care about.
        if _looks_like_earnings(body):
            continue
        budget_remaining = _MAX_PROMPT_CHARS - chars_used
        if budget_remaining <= 1000:
            skipped_by_budget += 1
            continue
        # Per-filing cap: earnings 8-Ks would otherwise consume the entire
        # cumulative budget, crowding out the contract-announcement 8-Ks.
        body_for_prompt = body[: min(_MAX_BODY_CHARS_PER_FILING, budget_remaining)]
        chars_used += len(body_for_prompt)
        prompt_filings.append({
            "accession": filing.get("accession"),
            "filing_date": filing.get("filing_date"),
            "form": filing.get("form"),
            "title": filing.get("title"),
            "body": body_for_prompt,
        })
        sources_meta.append(filing)
    if skipped_by_budget:
        gaps.append(
            f"{skipped_by_budget} older 8-K(s) skipped due to {_MAX_PROMPT_CHARS}-char prompt budget"
        )

    # Top-N news headlines for cross-referencing.
    try:
        news = scrape_yahoo_news(ticker, max_articles=_NEWS_HEADLINE_LIMIT) or []
    except Exception as exc:
        log.warning("yahoo news fetch failed for %s: %s", ticker, exc)
        news = []
    headlines = [
        {
            "title": n.get("title") or "",
            "date": str(n.get("published") or ""),
            "publisher": n.get("publisher") or "",
        }
        for n in news[:_NEWS_HEADLINE_LIMIT]
        if n.get("title")
    ]

    payload = {
        "ticker": ticker,
        "filings": prompt_filings,
        "news_headlines": headlines,
        "lookback_days": _LOOKBACK_DAYS,
    }
    return payload, sources_meta, gaps


# ---------------------------------------------------------------------------
# LLM call + post-processing
# ---------------------------------------------------------------------------

def _build_user_prompt(payload: Dict[str, Any]) -> str:
    return (
        f"Ticker: {payload['ticker']}\n"
        f"Lookback window: {payload['lookback_days']} days\n\n"
        "Filings (each item has accession, filing_date, form, title, body):\n"
        f"```json\n{json.dumps(payload['filings'], indent=2, default=str)}\n```\n\n"
        "Recent news headlines (cross-reference only):\n"
        f"```json\n{json.dumps(payload['news_headlines'], indent=2, default=str)}\n```\n"
    )


def _stable_id(counterparty: Optional[str], capacity_mw: Optional[float], filing_date: Optional[str]) -> str:
    raw = f"{(counterparty or '').strip().lower()}|{capacity_mw or ''}|{filing_date or ''}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _coerce_contract_type(t: Any) -> str:
    if isinstance(t, str) and t.strip().lower() in _VALID_CONTRACT_TYPES:
        return t.strip().lower()
    return "other"


def _coerce_confidence(c: Any) -> str:
    if isinstance(c, str) and c.strip().lower() in _VALID_CONFIDENCE:
        return c.strip().lower()
    return "low"


def _coerce_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN check


def _attach_source(raw: Dict[str, Any], sources_meta: List[Dict[str, Any]]) -> ContractSource:
    """Map LLM-emitted ``source_accession`` to the full filing dict."""
    accession = raw.get("source_accession") or raw.get("accession")
    if accession:
        for f in sources_meta:
            if f.get("accession") == accession:
                return ContractSource(
                    accession=accession,
                    filing_form=f.get("form"),
                    filing_date=f.get("filing_date"),
                    url=f.get("link"),
                    title=f.get("title"),
                )
    return ContractSource(
        accession=accession,
        filing_form="news" if not accession else None,
    )


def _dedup_contracts(contracts: List[Contract]) -> List[Contract]:
    """Belt-and-braces server-side dedup: same counterparty + capacity within
    10% (rounded to 50 MW buckets) + filing dates within 14 days collapse
    to one. Prefer 8-K source over news.
    """
    if len(contracts) <= 1:
        return contracts

    def _bucket(c: Contract) -> Tuple[str, int]:
        cp = (c.counterparty or "").strip().lower()
        mw = round((c.capacity_mw or 0) / 50) * 50
        return (cp, mw)

    def _date(c: Contract) -> Optional[datetime]:
        d = c.source.filing_date
        if not d:
            return None
        try:
            return datetime.fromisoformat(d.replace("Z", "+00:00"))
        except ValueError:
            return None

    keep: List[Contract] = []
    for c in contracts:
        merged = False
        for i, existing in enumerate(keep):
            if _bucket(c) != _bucket(existing):
                continue
            d1, d2 = _date(c), _date(existing)
            if d1 and d2 and abs((d1 - d2).days) > 14:
                continue
            # Prefer the entry whose source is an 8-K.
            if c.source.filing_form == "8-K" and existing.source.filing_form != "8-K":
                keep[i] = c
            merged = True
            break
        if not merged:
            keep.append(c)
    return keep


def _run_llm(
    payload: Dict[str, Any],
    sources_meta: List[Dict[str, Any]],
) -> Tuple[List[Contract], List[str], str]:
    """Invoke the configured LLM and post-process its output.

    Returns ``(contracts, llm_data_gaps, model_name)``.
    """
    from scanner.regime_shift import _select_llm
    complete_json, default_model = _select_llm()
    # Contracts need denser-prose reasoning than the regime-shift rubric, so
    # we override the per-call model. Passing model= keeps the Anthropic path
    # working too (Anthropic's complete_json also accepts a model kwarg) —
    # only Gemini uses CONTRACT_LLM_MODEL today.
    is_gemini = "gemini" in (default_model or "").lower()
    model_name = _DEFAULT_GEMINI_MODEL if is_gemini else default_model
    user_prompt = _build_user_prompt(payload)
    raw = complete_json(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        model=model_name,
        max_tokens=4096,
    )

    raw_contracts = raw.get("contracts") if isinstance(raw, dict) else None
    if not isinstance(raw_contracts, list):
        raw_contracts = []
    llm_gaps_raw = raw.get("data_gaps") if isinstance(raw, dict) else None
    llm_gaps: List[str] = (
        [str(g) for g in llm_gaps_raw if g] if isinstance(llm_gaps_raw, list) else []
    )

    contracts: List[Contract] = []
    for r in raw_contracts:
        if not isinstance(r, dict):
            continue
        counterparty = (r.get("counterparty") or "").strip() or None
        capacity_mw = _coerce_float(r.get("capacity_mw"))
        term_years = _coerce_float(r.get("term_years"))
        rev_stated = _coerce_float(r.get("annual_revenue_M_stated"))
        # If MW disclosed but no $ figure, fill the estimate from the default.
        rev_est: Optional[float] = None
        if rev_stated is None and capacity_mw is not None:
            rev_est = round(capacity_mw * _DEFAULT_REV_PER_MW_M, 2)

        source = _attach_source(r, sources_meta)
        # If LLM didn't emit source_accession but news headlines were the
        # only mention, mark the source form as "news" for UI clarity.
        if source.filing_form is None:
            source = ContractSource(filing_form="news")

        contract_id = _stable_id(counterparty, capacity_mw, source.filing_date)
        contracts.append(Contract(
            id=contract_id,
            counterparty=counterparty,
            contract_type=_coerce_contract_type(r.get("contract_type")),
            capacity_mw=capacity_mw,
            term_years=term_years,
            energization_date=(r.get("energization_date") or None),
            annual_revenue_M_stated=rev_stated,
            annual_revenue_M_estimated=rev_est,
            currency=(r.get("currency") or "USD")[:3].upper() if r.get("currency") else "USD",
            confidence=_coerce_confidence(r.get("confidence")),
            notes=(r.get("notes") or None),
            source=source,
        ))

    contracts = _dedup_contracts(contracts)
    return contracts, llm_gaps, model_name


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def extract_contracts(ticker: str, *, force: bool = False) -> ContractExtractResult:
    """Run the full extractor pipeline. ``force=True`` bypasses both caches.

    Raises ``AnthropicNotConfigured`` when neither ANTHROPIC_API_KEY nor
    GEMINI_API_KEY is set, so the FastAPI route can return a clean 503.
    """
    ticker_u = ticker.upper()
    now = time.time()

    if not force:
        mem = _cache.get(ticker_u)
        if mem and (now - mem[0]) < _CACHE_TTL_SEC:
            return mem[1]

    payload, sources_meta, gaps = _gather_inputs(ticker_u)
    latest_accession = (sources_meta[0].get("_accession_clean") if sources_meta else "") or ""

    disk = _cache_path(ticker_u, latest_accession)
    if not force:
        cached = _read_cache(disk)
        if cached:
            try:
                result = ContractExtractResult.model_validate(cached)
                _cache[ticker_u] = (now, result)
                return result
            except Exception as exc:
                log.warning("disk-cache parse failed for %s: %s", disk.name, exc)

    # No filings → return early with empty contracts and the gap notes.
    if not payload["filings"]:
        result = ContractExtractResult(
            ticker=ticker_u,
            contracts=[],
            data_gaps=gaps,
            model=None,
            as_of=datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
            inputs_echo={
                "filings_considered": 0,
                "news_headlines_considered": len(payload["news_headlines"]),
                "lookback_days": _LOOKBACK_DAYS,
            },
        )
        _cache[ticker_u] = (now, result)
        if latest_accession:
            _write_cache(disk, result.model_dump())
        return result

    try:
        contracts, llm_gaps, model_name = _run_llm(payload, sources_meta)
    except (AnthropicNotConfigured, GeminiQuotaExceeded):
        raise
    except Exception as exc:
        log.warning("contract LLM call failed for %s: %s", ticker_u, exc)
        contracts = []
        llm_gaps = [f"Contract extraction LLM call failed: {type(exc).__name__}"]
        model_name = _DEFAULT_GEMINI_MODEL

    result = ContractExtractResult(
        ticker=ticker_u,
        contracts=contracts,
        data_gaps=gaps + llm_gaps,
        model=model_name,
        as_of=datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        inputs_echo={
            "filings_considered": len(payload["filings"]),
            "news_headlines_considered": len(payload["news_headlines"]),
            "lookback_days": _LOOKBACK_DAYS,
            "default_revenue_per_mw_M": _DEFAULT_REV_PER_MW_M,
        },
    )

    _cache[ticker_u] = (now, result)
    _write_cache(disk, result.model_dump())
    return result


__all__ = [
    "AnthropicNotConfigured",
    "Contract",
    "ContractExtractResult",
    "ContractSource",
    "extract_contracts",
]
