"""FastAPI Routes for Options Pricing Engine"""

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from pricing.black_scholes import black_scholes
from pricing.greeks import calculate_greeks
from datetime import datetime
from pricing.implied_vol import implied_volatility
from pricing.second_order_greeks import calculate_all_second_order_greeks
from data.cifr_data import detect_mispricing_cifr, get_cifr_price, get_historical_volatility
from pricing.implied_vol import implied_volatility_compare
from pricing.vol_surface import generate_vol_surface
from pricing.hedge_stability import forecast_delta_decay, forecast_vol_shock, rehedge_recommendation
from pricing.pnl_attribution import greeks_pnl_attribution, stress_test_position, stress_test_portfolio
from data.market_data import get_ticker_price, detect_mispricing, get_tca_data, get_price_history, get_ticker_detail
from data.earnings_extract import get_latest_8k_earnings
from data.fundamentals import get_ticker_fundamentals, get_income_statement_history
from scanner.nl_parser import parse_nl_query
from scanner.regime_shift import (
    classify as classify_regime_shift,
    AnthropicNotConfigured as _AnthropicNotConfigured,
)
from data.hmm_regime import detect_current_regime
from stats.hv_confidence import hv_with_confidence
from api.models import (
    OptionParams,
    ImpliedVolParams,
    PricingResponse,
    GreeksResponse,
    ImpliedVolResponse,
    HedgeForecastRequest,
    HedgeForecastResponse,
    StressTestRequest,
    StressTestResponse,
    PnLAttributionRequest,
    PnLAttributionResponse,
    SentimentRequest,
    BacktestRequest,
    HedgeRequest,
    RebalanceTriggerRequest,
    EVRequest,
    EVScanRequest,
    VaRRequest,
    RiskCheckRequest,
    OrderRequest,
    OptionsOrderRequest,
    ExerciseRequest,
    EngineConfigRequest,
    MultiBacktestRequest,
    PositionGreeksResponse,
    PortfolioSummaryResponse,
    EquityHistoryResponse,
    RobinhoodHolding,
    RobinhoodOption,
    RobinhoodHoldingsResponse,
    RobinhoodSummary,
    RobinhoodActivityRow,
    RobinhoodIngestResponse,
    RobinhoodAccountsResponse,
    RobinhoodSyncResponse,
    RobinhoodSyncStatus,
    CryptoHoldingResponse,
    CryptoQuoteResponse,
    CryptoOrderRequest,
    CryptoOrderResponse,
    CRYPTO_ORDER_NOTIONAL_CAP_USD,
    EquityOrderRequest,
    EquityOrderResponse,
    EQUITY_ORDER_NOTIONAL_CAP_USD,
    OptionOrderRequest,
    OptionOrderResponse,
    OPTION_ORDER_NOTIONAL_CAP_USD,
    AnalyticsRunCreateRequest,
    AnalyticsRunCreateResponse,
    AnalyticsRunMeta,
    AnalyticsRunFull,
    IRFilingItem,
    IRFilingListResponse,
    IRFilingRefreshResponse,
    IRFilingCountsResponse,
)

# Robinhood activity ingestion + portfolio derivation.
from robinhood import database as rh_db
from robinhood import portfolio as rh_portfolio
from robinhood import analytics as rh_analytics

# Trade Journal
from journal.database import (
    init_db, get_trades, get_trade, get_pnl_summary,
    get_trade_stats_by_signal, get_engine_logs,
)
from journal.sync import sync_order_statuses

# Auto Engine
from engine.executor import get_engine

# Phase 2: NLP Pipeline
from data.ir_scraper import aggregate_ir_data
from data.nlp_extractor import analyze_news_batch
from data.bayesian_update import bayesian_update_for_ticker
from data.ir_ingest import refresh_ir_for_ticker

# Phase 3: Backtesting
from backtest.engine import run_backtest, BacktestConfig
from backtest.multi_engine import run_multi_backtest

# Phase 5: Hedging & EV
from strategy.hedging import compute_hedge_ratio, check_rebalance_triggers, optimal_rebalance_schedule, aggregate_portfolio_greeks

# Portfolio monitoring helpers
from api.portfolio_helpers import _parse_occ_symbol, _get_spot_price, _estimate_sigma, _build_greeks_input
from strategy.ev_calculator import calculate_trade_ev, scan_opportunities

# Phase 6: Risk Management
from risk.var import historical_var, parametric_var, monte_carlo_var, comprehensive_var
from risk.limits import check_position_limits, check_drawdown, RiskLimits

# Phase 7: Execution
from execution.alpaca_client import (
    get_account, get_positions, get_orders, submit_order, cancel_order, get_portfolio_history,
    get_options_contracts, get_options_chain_snapshot, submit_option_order, exercise_option, close_option_position,
)

# Initialize FastAPI app
app = FastAPI(
    title="Options Pricing API",
    description="Black-Scholes pricing engine with Greeks calculation for CIFR and other stocks",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware — configurable via ALLOWED_ORIGINS env var (comma-separated)
origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^http://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}):3000$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# VegaEdge Live Agent WebSocket
from api.ws_routes import router as ws_router
app.include_router(ws_router)


@app.on_event("startup")
def startup():
    """Initialize trade journal database + scheduler + observability on startup."""
    # Structured JSON logging (roadmap §11.4). Call first so other startup logs are JSON.
    try:
        from infra.observability import configure_json_logging
        configure_json_logging()
    except Exception:
        pass

    init_db()

    # Broker activity table + idempotent ingest from `hood reports/` (Robinhood)
    # and `sofi reports/` (SoFi). Rows live in the same `robinhood_activity`
    # table tagged by `account` — the table name is legacy.
    try:
        rh_db.ensure_schema()
        from pathlib import Path as _Path
        import sys as _sys

        _scripts = _Path(__file__).parent.parent.parent / "scripts"
        if str(_scripts) not in _sys.path:
            _sys.path.insert(0, str(_scripts))
        from ingest_robinhood import ingest as _rh_ingest  # type: ignore
        from ingest_sofi import ingest as _sofi_ingest  # type: ignore

        app_root = _Path(__file__).parent.parent.parent.parent
        rh_reports = app_root / "hood reports"
        if rh_reports.exists():
            _rh_ingest(rh_reports)
        sofi_reports = app_root / "sofi reports"
        if sofi_reports.exists():
            _sofi_ingest(sofi_reports)
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).warning("Broker ingest skipped: %s", exc)

    # APScheduler — non-fatal if startup fails (tests / CI may not want jobs running).
    try:
        from engine.scheduler import start_scheduler
        start_scheduler()
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).warning("Scheduler failed to start: %s", exc)


# Correlation-ID + latency middleware (§11.4)
@app.middleware("http")
async def _observability_mw(request, call_next):
    from infra.observability import get_correlation_id, metrics, set_correlation_id
    import logging
    import time as _time

    cid = request.headers.get("x-correlation-id") or set_correlation_id()
    if request.headers.get("x-correlation-id"):
        set_correlation_id(cid)

    start = _time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (_time.perf_counter() - start) * 1000

    metrics().incr(f"http_requests_total{{method=\"{request.method}\"}}", 1.0)
    metrics().observe("http_request_duration_ms", elapsed_ms)

    response.headers["x-correlation-id"] = cid
    logging.getLogger("http").info(
        "request",
        extra={
            "cid": cid,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(elapsed_ms, 2),
        },
    )
    return response


@app.get("/metrics")
def metrics_endpoint():
    from fastapi.responses import PlainTextResponse
    from infra.observability import metrics

    return PlainTextResponse(metrics().render_text(), media_type="text/plain")


@app.on_event("shutdown")
def shutdown():
    try:
        from engine.scheduler import stop_scheduler
        stop_scheduler()
    except Exception:
        pass


@app.get("/")
def root():
    """API root endpoint"""
    return {
        "message": "Options Pricing API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "pricing": "/api/pricing/calculate",
            "greeks": "/api/pricing/greeks",
            "implied_vol": "/api/pricing/implied-vol"
        }
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "pricing-engine"}


@app.post("/api/pricing/calculate", response_model=PricingResponse)
def calculate_price(params: OptionParams):
    """
    Calculate option price using Black-Scholes formula.
    
    Example:
        POST /api/pricing/calculate
        {
            "S": 100,
            "K": 100,
            "T": 1,
            "r": 0.05,
            "sigma": 0.2,
            "option_type": "call"
        }
    """
    try:
        price = black_scholes(
            S=params.S,
            K=params.K,
            T=params.T,
            r=params.r,
            sigma=params.sigma,
            option_type=params.option_type
        )
        
        return PricingResponse(
            price=float(price),
            parameters=params
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pricing calculation failed: {str(e)}")


@app.post("/api/pricing/greeks", response_model=GreeksResponse)
def calculate_option_greeks(params: OptionParams):
    """
    Calculate option price and all Greeks (Delta, Gamma, Vega, Theta, Rho).
    
    Example:
        POST /api/pricing/greeks
        {
            "S": 15.50,
            "K": 16,
            "T": 0.0822,
            "r": 0.05,
            "sigma": 0.8,
            "option_type": "call"
        }
    """
    try:
        # Calculate price
        price = black_scholes(
            S=params.S,
            K=params.K,
            T=params.T,
            r=params.r,
            sigma=params.sigma,
            option_type=params.option_type
        )
        
        # Calculate first-order Greeks
        greeks = calculate_greeks(
            S=params.S,
            K=params.K,
            T=params.T,
            r=params.r,
            sigma=params.sigma,
            option_type=params.option_type
        )
        
        # Calculate second-order Greeks
        second_order = calculate_all_second_order_greeks(
            S=params.S,
            K=params.K,
            T=params.T,
            r=params.r,
            sigma=params.sigma,
            option_type=params.option_type
        )
        
        # Combine all Greeks
        all_greeks = {**greeks, **second_order}
        
        return GreeksResponse(
            price=float(price),
            greeks=all_greeks,
            parameters=params
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Greeks calculation failed: {str(e)}")


@app.post("/api/pricing/implied-vol", response_model=ImpliedVolResponse)
def solve_implied_vol(params: ImpliedVolParams):
    """
    Solve for implied volatility from market price using Newton-Raphson method.
    
    Example:
        POST /api/pricing/implied-vol
        {
            "market_price": 0.47,
            "S": 15.50,
            "K": 16,
            "T": 0.0822,
            "r": 0.05,
            "option_type": "call"
        }
    """
    try:
        iv = implied_volatility(
            market_price=params.market_price,
            S=params.S,
            K=params.K,
            T=params.T,
            r=params.r,
            option_type=params.option_type
        )
        
        if iv is None:
            raise HTTPException(
                status_code=400,
                detail="IV solver did not converge. Check if market price is within arbitrage bounds."
            )
        
        return ImpliedVolResponse(
            implied_volatility=float(iv),
            market_price=params.market_price,
            parameters=params
        )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IV solver failed: {str(e)}")


@app.get("/api/mispricing/cifr")
def get_cifr_mispricing():
    """
    Detect IV vs HV mispricing opportunities for CIFR.
    
    Returns real-time analysis of implied volatility vs historical volatility
    to identify options selling/buying opportunities.
    
    Example Response:
        {
            "ticker": "CIFR",
            "spot_price": 14.73,
            "historical_vol": 1.0971,
            "implied_vol_atm": 1.2793,
            "iv_hv_ratio": 1.17,
            "signal": "NEUTRAL",
            "atm_strike": 14.5,
            "atm_call_price": 1.08
        }
    """
    try:
        mispricing_data = detect_mispricing_cifr()
        return mispricing_data
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mispricing detection failed: {str(e)}")


@app.get("/api/market/cifr/price")
def get_current_cifr_price():
    """Get current CIFR stock price"""
    try:
        price = get_cifr_price()
        return {"ticker": "CIFR", "price": price}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Price fetch failed: {str(e)}")


@app.get("/api/market/cifr/volatility")
def get_cifr_volatility(window: int = 30):
    """
    Get historical volatility for CIFR.
    
    Args:
        window: Rolling window in days (default: 30)
    """
    try:
        hv = get_historical_volatility("CIFR", window=window)
        return {
            "ticker": "CIFR",
            "window_days": window,
            "historical_volatility": hv
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Volatility calculation failed: {str(e)}")


@app.post("/api/pricing/implied-vol/compare")
def compare_iv_solvers(params: ImpliedVolParams):
    """Compare Newton-Raphson and Bisection IV solvers."""
    try:
        result = implied_volatility_compare(
            market_price=params.market_price,
            S=params.S,
            K=params.K,
            T=params.T,
            r=params.r,
            option_type=params.option_type
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IV comparison failed: {str(e)}")


@app.get("/api/pricing/vol-surface/{ticker}")
def get_vol_surface(ticker: str):
    """Generate volatility surface for a ticker."""
    try:
        surface = generate_vol_surface(ticker.upper())
        return surface
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vol surface generation failed: {str(e)}")


@app.post("/api/pricing/hedge-forecast", response_model=HedgeForecastResponse)
def get_hedge_forecast(params: HedgeForecastRequest):
    """Forecast hedge stability over time and under vol shocks."""
    try:
        delta_decay = forecast_delta_decay(
            S=params.S, K=params.K, T=params.T,
            r=params.r, sigma=params.sigma,
            option_type=params.option_type, days=params.days
        )
        vol_shock = forecast_vol_shock(
            S=params.S, K=params.K, T=params.T,
            r=params.r, sigma=params.sigma,
            option_type=params.option_type
        )
        rehedge = rehedge_recommendation(
            S=params.S, K=params.K, T=params.T,
            r=params.r, sigma=params.sigma,
            option_type=params.option_type
        )
        return HedgeForecastResponse(
            delta_decay=delta_decay,
            vol_shock=vol_shock,
            rehedge=rehedge
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Hedge forecast failed: {str(e)}")


@app.get("/api/market/{ticker}/price")
def get_current_ticker_price(ticker: str):
    """Get current spot price for any ticker via Yahoo Finance."""
    try:
        price = get_ticker_price(ticker.upper())
        return {"ticker": ticker.upper(), "price": price}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Price fetch failed: {str(e)}")


@app.get("/api/market/{ticker}/mispricing")
def get_ticker_mispricing(ticker: str):
    """Detect IV vs HV mispricing for any ticker.

    Returns 200 with `{ticker, error}` when yfinance can't price the symbol
    (delisted ADRs like FRCB, sanctioned tickers like OGZPY/SBRCY, alt-class
    shares like BRK.A) so the browser console doesn't log a 500 for every
    bad ticker in the Dashboard's per-position fan-out. Callers should check
    for the `error` field before reading other keys.
    """
    try:
        return detect_mispricing(ticker.upper())
    except Exception as e:
        return {"ticker": ticker.upper(), "error": f"Mispricing unavailable: {str(e)}"}


@app.get("/api/market/{ticker}/detail")
def get_ticker_detail_endpoint(ticker: str):
    """Rich ticker snapshot for the stock detail page."""
    try:
        return get_ticker_detail(ticker.upper())
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Detail fetch failed for {ticker}: {str(e)}")


@app.get("/api/market/{ticker}/fundamentals")
def get_ticker_fundamentals_endpoint(ticker: str):
    """Smart router. Returns the ETF digest for funds (AUM, NAV, expense ratio,
    top holdings, sector weights) and the operating-company DCF digest for
    everything else. The `quoteType` field on the response distinguishes them.
    """
    from data.etf_fundamentals import get_etf_fundamentals, is_etf
    ticker_u = ticker.upper()
    try:
        if is_etf(ticker_u):
            return get_etf_fundamentals(ticker_u)
        result = get_ticker_fundamentals(ticker_u)
        if isinstance(result, dict) and "quoteType" not in result:
            result["quoteType"] = "EQUITY"
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fundamentals fetch failed for {ticker}: {str(e)}")


@app.get("/api/market/{ticker}/latest-earnings")
def get_ticker_latest_earnings_endpoint(ticker: str):
    """Headline numbers from the most recent 8-K Exhibit 99.1 earnings release.

    Useful when yfinance hasn't yet ingested the just-filed quarter (typical
    1-3 day lag). Returns ``{"ticker": ..., "available": false}`` when no
    parseable earnings release was filed in the last 120 days.
    """
    try:
        extract = get_latest_8k_earnings(ticker.upper())
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Latest earnings fetch failed for {ticker}: {str(e)}",
        )
    if not extract:
        return {"ticker": ticker.upper(), "available": False}
    return {"ticker": ticker.upper(), "available": True, **extract}


@app.get("/api/market/{ticker}/income-statement")
def get_ticker_income_statement_endpoint(
    ticker: str,
    periods: int = 11,
    quarterly: bool = False,
    response: Response = None,  # type: ignore[assignment]
):
    """[DEPRECATED] Yfinance-backed income statement.

    The Financials tab now uses ``/api/sec/{ticker}/income-statement`` which
    is sourced from SEC XBRL companyfacts (10+ years vs ~4 from yfinance).
    This endpoint is preserved for one release for any external consumer; new
    callers should migrate.
    """
    if response is not None:
        response.headers["Deprecation"] = "true"
        response.headers["Sunset"] = "use /api/sec/{ticker}/income-statement"
    try:
        result = get_income_statement_history(
            ticker.upper(),
            periods=periods,
            quarterly=quarterly,
        )
        if isinstance(result, dict):
            result["_deprecated"] = "use /api/sec/{ticker}/income-statement"
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Income statement fetch failed for {ticker}: {str(e)}",
        )


from pydantic import BaseModel as _ScannerBaseModel  # local alias; avoids touching models.py

class ScannerParseRequest(_ScannerBaseModel):
    query: str


@app.post("/api/scanner/parse")
def scanner_parse(body: ScannerParseRequest):
    """Parse a natural-language scanner query via Gemini (fallback: regex)."""
    try:
        return parse_nl_query(body.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"NL parse failed: {str(e)}")


@app.get("/api/market/{ticker}/contracts")
def get_ticker_contracts(ticker: str, force: bool = False):
    """LLM-extracted signed commercial contracts (HPC leases, PPAs, hosting deals).

    Reads recent 8-K Exhibit 99.1 bodies + IR news headlines for the ticker,
    runs Gemini (or Claude when ANTHROPIC_API_KEY is set), and returns
    structured Contract objects for the contract-aware DCF layer. Disk-cached
    per-ticker keyed on the latest 8-K accession; in-memory cached ~30 min.
    """
    from data.contract_extract import extract_contracts
    try:
        return extract_contracts(ticker.upper(), force=force).model_dump()
    except _AnthropicNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Contract extraction failed for {ticker}: {str(e)}",
        )


@app.post("/api/scanner/regime-shift/{ticker}")
def scanner_regime_shift(ticker: str, force: bool = False):
    """Single-stock fundamentals regime-shift classifier (Claude-driven).

    Aggregates 8q quarterly fundamentals, the latest 8-K/6-K earnings release,
    price/volume technicals, IV/HV context, and recent news headlines, then
    runs the SanDisk-style 6-step rubric. Cached for ~15 min per ticker;
    pass ``?force=true`` to bypass.
    """
    try:
        result = classify_regime_shift(ticker.upper(), force=force)
    except _AnthropicNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Regime-shift classification failed for {ticker}: {str(e)}",
        )
    return result.model_dump()


@app.get("/api/market/{ticker}/price-history")
def get_price_history_endpoint(ticker: str, period: str = "1M"):
    """Get OHLCV price history for any ticker."""
    try:
        return get_price_history(ticker.upper(), period=period)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Price history fetch failed: {str(e)}")


@app.get("/api/market/{ticker}/regime")
def get_ticker_regime(ticker: str):
    """Detect current volatility regime using HMM."""
    try:
        return detect_current_regime(ticker.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Regime detection failed: {str(e)}")


@app.get("/api/market/{ticker}/hv-confidence")
def get_hv_confidence(ticker: str, window: int = 30, confidence: float = 0.95):
    """Get historical volatility with bootstrap confidence intervals."""
    try:
        return hv_with_confidence(ticker.upper(), window=window, confidence=confidence)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"HV confidence calculation failed: {str(e)}")


# =============================================
# Public option chain (yfinance-backed) — used by the /options-chain page.
# Distinct from /api/execution/options/chain/{underlying} which is Alpaca-
# backed and behind the trading paywall. This one is read-only public data.
# =============================================

@app.get("/api/market/{ticker}/option-expirations")
def get_option_expirations(ticker: str):
    """Available expiration dates for a ticker, with ATM IV + total OI summary.

    Powers the horizontal expiration strip on /options-chain. yfinance returns
    a list of YYYY-MM-DD strings; we enrich each with DTE, an ATM IV proxy
    (the call closest to spot), and total open interest across both legs so
    the user can see at a glance which expiries are liquid.
    """
    import yfinance as yf
    from datetime import date as _date

    sym = ticker.upper()
    try:
        t = yf.Ticker(sym)
        expiries = list(t.options or [])
        if not expiries:
            return {"ticker": sym, "spot": None, "expirations": []}

        spot_hist = t.history(period="1d")
        spot = float(spot_hist["Close"].iloc[-1]) if not spot_hist.empty else None

        out: List[Dict[str, Any]] = []
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
                chain = t.option_chain(exp_str)
                # ATM IV from the call whose strike is closest to spot.
                if spot is not None and not chain.calls.empty:
                    closest = chain.calls.iloc[
                        (chain.calls["strike"] - spot).abs().argsort().iloc[0]
                    ]
                    iv = closest.get("impliedVolatility")
                    if iv is not None and not pd.isna(iv):
                        atm_iv = float(iv)
                for leg in (chain.calls, chain.puts):
                    if "openInterest" in leg.columns:
                        total_oi += int(leg["openInterest"].fillna(0).sum())
            except Exception:
                pass
            out.append({
                "expiration": exp_str,
                "dte": dte,
                "atm_iv": round(atm_iv, 4) if atm_iv is not None else None,
                "total_oi": total_oi,
            })
        return {"ticker": sym, "spot": spot, "expirations": out}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Option expirations fetch failed for {sym}: {str(e)}",
        )


@app.get("/api/market/{ticker}/option-chain")
def get_market_option_chain(ticker: str, expiration: str):
    """Per-expiration option chain (calls + puts) for a single ticker.

    `expiration` must be YYYY-MM-DD and must appear in
    /api/market/{ticker}/option-expirations.
    """
    import yfinance as yf
    from datetime import date as _date

    sym = ticker.upper()
    try:
        _date.fromisoformat(expiration)
    except ValueError:
        raise HTTPException(status_code=422, detail="expiration must be YYYY-MM-DD")
    try:
        t = yf.Ticker(sym)
        spot_hist = t.history(period="1d")
        spot = float(spot_hist["Close"].iloc[-1]) if not spot_hist.empty else None
        if expiration not in (t.options or []):
            raise HTTPException(
                status_code=404,
                detail=f"Expiration {expiration} not available for {sym}",
            )
        chain = t.option_chain(expiration)

        def _row(r) -> Dict[str, Any]:
            def _f(v):
                try:
                    if v is None or pd.isna(v):
                        return None
                    return float(v)
                except (TypeError, ValueError):
                    return None

            def _i(v):
                try:
                    if v is None or pd.isna(v):
                        return 0
                    return int(v)
                except (TypeError, ValueError):
                    return 0

            bid = _f(r.get("bid"))
            ask = _f(r.get("ask"))
            mid: Optional[float] = None
            if bid is not None and ask is not None and bid > 0 and ask > 0:
                mid = round((bid + ask) / 2, 4)
            return {
                "contract_symbol": r.get("contractSymbol"),
                "strike": _f(r.get("strike")),
                "bid": bid,
                "ask": ask,
                "last": _f(r.get("lastPrice")),
                "mid": mid,
                "iv": _f(r.get("impliedVolatility")),
                "volume": _i(r.get("volume")),
                "open_interest": _i(r.get("openInterest")),
                "in_the_money": bool(r.get("inTheMoney")) if r.get("inTheMoney") is not None else None,
            }

        calls = [_row(r) for _, r in chain.calls.iterrows()]
        puts = [_row(r) for _, r in chain.puts.iterrows()]
        # Sort ascending by strike for the table render.
        calls.sort(key=lambda x: (x["strike"] is None, x["strike"]))
        puts.sort(key=lambda x: (x["strike"] is None, x["strike"]))

        return {
            "ticker": sym,
            "expiration": expiration,
            "spot": spot,
            "calls": calls,
            "puts": puts,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Option chain fetch failed for {sym} {expiration}: {str(e)}",
        )


@app.post("/api/risk/stress-test", response_model=StressTestResponse)
def run_stress_test(req: StressTestRequest):
    """Run stress test on portfolio positions."""
    try:
        result = stress_test_portfolio(
            positions=req.positions,
            spot_shock_pct=req.spot_shock_pct,
            vol_shock_pct=req.vol_shock_pct
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stress test failed: {str(e)}")


@app.post("/api/risk/pnl-attribution", response_model=PnLAttributionResponse)
def get_pnl_attribution(req: PnLAttributionRequest):
    """Calculate P&L attribution by Greeks."""
    try:
        greeks = calculate_greeks(
            S=req.S, K=req.K, T=req.T,
            r=req.r, sigma=req.sigma,
            option_type=req.option_type
        )
        second_order = calculate_all_second_order_greeks(
            S=req.S, K=req.K, T=req.T,
            r=req.r, sigma=req.sigma,
            option_type=req.option_type
        )
        all_greeks = {**greeks, **second_order}

        attribution = greeks_pnl_attribution(
            greeks_dict=all_greeks,
            delta_S=req.delta_S,
            delta_sigma=req.delta_sigma,
            delta_t=req.delta_t
        )

        # Scale by qty * 100
        scaled = {k: round(v * req.qty * 100, 4) for k, v in attribution.items()}

        return PnLAttributionResponse(
            attribution=scaled,
            greeks=all_greeks
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"P&L attribution failed: {str(e)}")


@app.get("/api/risk/tca/{ticker}")
def get_tca(ticker: str):
    """Transaction cost analysis for a ticker."""
    try:
        return get_tca_data(ticker.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TCA analysis failed: {str(e)}")


# =============================================
# Phase 2: NLP Pipeline Endpoints
# =============================================

@app.get("/api/sentiment/{ticker}")
def get_sentiment_analysis(ticker: str):
    """Get NLP sentiment analysis for a ticker using IR data and news."""
    try:
        ir_data = aggregate_ir_data(ticker.upper())
        sentiment = analyze_news_batch(ir_data.get("news", []))
        bayesian = bayesian_update_for_ticker(
            spot_price=ir_data["company"].get("current_price", 0) or 0,
            sentiment_data=sentiment,
        )
        return {
            "ticker": ticker.upper(),
            "company": ir_data["company"],
            "sentiment": sentiment,
            "bayesian_update": bayesian,
            "data_sources": ir_data["data_sources"],
            "article_count": ir_data["article_count"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sentiment analysis failed: {str(e)}")


@app.get("/api/sentiment/{ticker}/news")
def get_ticker_news(ticker: str):
    """Get raw news articles for a ticker."""
    try:
        ir_data = aggregate_ir_data(ticker.upper())
        return {
            "ticker": ticker.upper(),
            "news": ir_data["news"],
            "filings": ir_data["filings"],
            "article_count": ir_data["article_count"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"News fetch failed: {str(e)}")


# =============================================
# Investor-relations feed (per-ticker, thesis-tagged)
# =============================================

def _ir_row_to_item(row) -> IRFilingItem:
    """sqlite Row → IRFilingItem (used by the GET endpoint)."""
    return IRFilingItem(
        item_hash=row["item_hash"],
        ticker=row["ticker"],
        source=row["source"],
        item_type=row["item_type"],
        title=row["title"],
        publisher=row["publisher"],
        link=row["link"],
        published_at=row["published_at"],
        thesis=row["thesis"],
        confidence=row["confidence"],
        rationale=row["rationale"],
        classifier=row["classifier"],
        fetched_at=row["fetched_at"],
    )


@app.get("/api/ir/{ticker}", response_model=IRFilingListResponse)
def get_ir_filings(ticker: str, limit: int = 25):
    """Latest IR items for a ticker, with BULLISH/BEARISH/NEUTRAL/INFORMATIVE
    counts. If the DB has nothing for this ticker yet we run one synchronous
    refresh so the cold-start UX is 'loading … data' rather than 'loading …
    empty'."""
    ticker_u = ticker.upper()
    rows = rh_db.get_ir_filings(ticker_u, limit=limit)
    if not rows:
        try:
            refresh_ir_for_ticker(ticker_u, force_reclassify=False)
        except Exception:
            # Refresh is best-effort on cold-start; UI shows empty state.
            logging.getLogger(__name__).exception(
                "Cold-start IR refresh failed for %s", ticker_u
            )
        rows = rh_db.get_ir_filings(ticker_u, limit=limit)

    counts = rh_db.count_ir_thesis(ticker_u)
    return IRFilingListResponse(
        ticker=ticker_u,
        items=[_ir_row_to_item(r) for r in rows],
        counts=counts,
        last_refreshed_at=rh_db.latest_ir_fetched_at(ticker_u),
    )


@app.post("/api/ir/{ticker}/refresh", response_model=IRFilingRefreshResponse)
def refresh_ir_endpoint(ticker: str, force_reclassify: bool = False):
    """Re-scrape Yahoo News + SEC EDGAR for this ticker, upsert new items,
    and classify any NULL-thesis rows. Pass `force_reclassify=true` to also
    re-run the classifier on already-labelled rows (e.g. after a prompt change).
    """
    result = refresh_ir_for_ticker(ticker.upper(), force_reclassify=force_reclassify)
    return IRFilingRefreshResponse(**result)  # type: ignore[arg-type]


@app.get("/api/ir/{ticker}/counts", response_model=IRFilingCountsResponse)
def get_ir_counts(ticker: str):
    """Just the thesis counts — used for badge rendering elsewhere in the UI."""
    ticker_u = ticker.upper()
    counts = rh_db.count_ir_thesis(ticker_u)
    return IRFilingCountsResponse(
        ticker=ticker_u,
        counts={k: v for k, v in counts.items() if k != "TOTAL"},
        total=int(counts.get("TOTAL", 0)),
    )


# =============================================
# SEC EDGAR — S&P 500 + Portfolio cache + per-ticker reads
# =============================================

@app.post("/api/sec/sync")
def sec_sync_kickoff(
    limit: Optional[int] = None,
    include_portfolio: bool = True,
    include_sp500: bool = True,
):
    """Kick off a non-blocking S&P 500 + portfolio EDGAR cache warmup.

    Portfolio holdings are processed first so they're guaranteed coverage even
    if `limit` is set. Subsequent runs are mostly cache hits and finish fast.
    """
    from data.sp500_sync import kick_off_in_thread, is_running
    if is_running():
        return {"started": False, "reason": "already_running"}
    return kick_off_in_thread(limit=limit)


@app.get("/api/sec/sync/status")
def sec_sync_status():
    """Current sync progress (or last completed run)."""
    from data.sp500_sync import get_sync_status
    return get_sync_status()


@app.get("/api/sec/universe")
def sec_universe():
    """The dedup'd ticker universe used by the sync (portfolio first)."""
    from data.sp500_sync import _resolve_universe
    from data.sp500_universe import get_universe_status
    tickers = _resolve_universe(include_sp500=True, include_portfolio=True, force_refresh_universe=False)
    return {
        "tickers": tickers,
        "count": len(tickers),
        "sp500_cache": get_universe_status(),
    }


@app.get("/api/sec/companyfacts/{ticker}")
def sec_companyfacts(ticker: str):
    """Extracted fundamentals digest from cached XBRL companyfacts.

    Returns the load-bearing DCF inputs (revenue, op margin, tax rate, capex,
    debt, cash, shares) plus revenue history. Cache hit is instant; miss
    triggers a single SEC roundtrip.
    """
    from data.sec_edgar import extract_sec_fundamentals
    ticker_u = ticker.upper().strip().replace(".", "-")
    data = extract_sec_fundamentals(ticker_u)
    if not data:
        raise HTTPException(status_code=404, detail=f"No SEC data for {ticker_u}")
    return {"ticker": ticker_u, **data}


@app.get("/api/sec/{ticker}/income-statement")
def sec_income_statement(ticker: str, period: str = "annual", force: bool = False):
    """Full multi-year income statement extracted from XBRL companyfacts."""
    from data.sec_statements import get_income_statement
    if period not in ("annual", "quarterly"):
        raise HTTPException(status_code=400, detail="period must be 'annual' or 'quarterly'")
    ticker_u = ticker.upper().strip().replace(".", "-")
    return get_income_statement(ticker_u, period, force=force)


@app.get("/api/sec/{ticker}/balance-sheet")
def sec_balance_sheet(ticker: str, period: str = "annual", force: bool = False):
    """Full multi-year balance sheet extracted from XBRL companyfacts."""
    from data.sec_statements import get_balance_sheet
    if period not in ("annual", "quarterly"):
        raise HTTPException(status_code=400, detail="period must be 'annual' or 'quarterly'")
    ticker_u = ticker.upper().strip().replace(".", "-")
    return get_balance_sheet(ticker_u, period, force=force)


@app.get("/api/sec/{ticker}/cash-flow")
def sec_cash_flow(ticker: str, period: str = "annual", force: bool = False):
    """Full multi-year cash flow statement extracted from XBRL companyfacts."""
    from data.sec_statements import get_cash_flow
    if period not in ("annual", "quarterly"):
        raise HTTPException(status_code=400, detail="period must be 'annual' or 'quarterly'")
    ticker_u = ticker.upper().strip().replace(".", "-")
    return get_cash_flow(ticker_u, period, force=force)


@app.get("/api/sec/{ticker}/ratios")
def sec_ratios(ticker: str, period: str = "annual", force: bool = False):
    """Derived financial ratios (margins, returns, liquidity, leverage)."""
    from data.financial_ratios import get_ratios
    if period not in ("annual", "quarterly"):
        raise HTTPException(status_code=400, detail="period must be 'annual' or 'quarterly'")
    ticker_u = ticker.upper().strip().replace(".", "-")
    return get_ratios(ticker_u, period, force=force)


@app.get("/api/sec/{ticker}/{statement}/insights")
def sec_statement_insights(ticker: str, statement: str, period: str = "annual", force: bool = False):
    """AI-generated trend commentary for one statement.

    Pulls the structured statement (income/balance/cash-flow/ratios), passes
    it to ``financial_ai_insights.generate_financial_insights``, and returns
    the result. Cached by data-hash so restatements auto-invalidate.
    """
    from data.financial_ai_insights import generate_financial_insights
    from data.sec_statements import (
        get_balance_sheet,
        get_cash_flow,
        get_income_statement,
    )
    from data.financial_ratios import get_ratios

    if period not in ("annual", "quarterly"):
        raise HTTPException(status_code=400, detail="period must be 'annual' or 'quarterly'")

    ticker_u = ticker.upper().strip().replace(".", "-")
    fetcher = {
        "income-statement": get_income_statement,
        "balance-sheet": get_balance_sheet,
        "cash-flow": get_cash_flow,
        "ratios": get_ratios,
    }.get(statement)
    if fetcher is None:
        raise HTTPException(
            status_code=400,
            detail="statement must be one of: income-statement, balance-sheet, cash-flow, ratios",
        )

    statement_data = fetcher(ticker_u, period)  # type: ignore[arg-type]
    if not statement_data.get("rows"):
        raise HTTPException(status_code=404, detail=f"No statement data for {ticker_u}")

    insights = generate_financial_insights(
        ticker=ticker_u,
        statement=statement,
        period=period,
        statement_data=statement_data,
        force=force,
    )
    if insights is None:
        raise HTTPException(
            status_code=503,
            detail="AI insights unavailable (Gemini API key missing or call failed)",
        )
    return insights


@app.get("/api/sec/filings/{ticker}/{accession}/ai-summary")
def sec_filing_ai_summary(ticker: str, accession: str, force: bool = False):
    """AI-generated executive summary for one SEC filing.

    Cached forever per-accession (filings are immutable). Returns the cached
    payload if it exists; otherwise fetches the exhibit body, runs Gemini
    Flash with a structured schema, and caches the result. ``?force=true``
    skips the cache (useful for re-running after a prompt change).
    """
    from data.filing_ai_summary import generate_filing_summary, get_cached_summary
    from data.sec_exhibits import fetch_filing_body_by_accession

    ticker_u = ticker.upper().strip().replace(".", "-")
    if not force:
        cached = get_cached_summary(accession)
        if cached is not None:
            return cached

    body = fetch_filing_body_by_accession(ticker_u, accession)
    if not body:
        raise HTTPException(
            status_code=404,
            detail=f"No retrievable body for {ticker_u}/{accession} (8-K may lack Exhibit 99.1)",
        )

    summary = generate_filing_summary(
        ticker=ticker_u,
        accession=accession,
        body=body,
        force=force,
    )
    if summary is None:
        raise HTTPException(
            status_code=503,
            detail="AI summary unavailable (Gemini API key missing or call failed)",
        )
    return summary


@app.get("/api/sec/filings/{ticker}")
def sec_filings(ticker: str, limit: int = 15):
    """Recent SEC filings for a ticker. For 8-Ks, includes exhibit-99.1 body.

    Cache-warm on tickers covered by the overnight sync. Cold tickers fall
    through to a live SEC fetch (rate-limited at 10 req/s).
    """
    from data.sec_exhibits import scrape_filings_with_bodies
    ticker_u = ticker.upper().strip().replace(".", "-")
    rows = scrape_filings_with_bodies(ticker_u, limit=int(limit))
    if not rows:
        raise HTTPException(status_code=404, detail=f"No filings for {ticker_u}")
    return {"ticker": ticker_u, "count": len(rows), "filings": rows}


@app.get("/api/etf/{ticker}")
def etf_fundamentals_endpoint(ticker: str):
    """ETF metadata digest (AUM, NAV, expense ratio, top holdings, sector
    weights). 404 if the ticker isn't an ETF — callers wanting an automatic
    stock/ETF router should use `/api/market/{ticker}/fundamentals` instead.
    """
    from data.etf_fundamentals import get_etf_fundamentals, is_etf
    ticker_u = ticker.upper().strip()
    if not is_etf(ticker_u):
        raise HTTPException(status_code=404, detail=f"{ticker_u} is not an ETF")
    return get_etf_fundamentals(ticker_u)


# =============================================
# Phase 3: Backtesting Endpoints
# =============================================

@app.post("/api/backtest/run")
def run_volatility_backtest(req: BacktestRequest):
    """Run a volatility arbitrage backtest."""
    try:
        config = BacktestConfig(
            ticker=req.ticker.upper(),
            start_date=req.start_date,
            end_date=req.end_date,
            initial_capital=req.initial_capital,
            iv_hv_sell_threshold=req.iv_hv_sell_threshold,
            iv_hv_buy_threshold=req.iv_hv_buy_threshold,
            max_position_pct=req.max_position_pct,
            stop_loss_pct=req.stop_loss_pct,
        )
        result = run_backtest(config)
        return {
            "config": result.config,
            "metrics": result.metrics,
            "trades": result.trades,
            "equity_curve": result.equity_curve,
            "monthly_returns": result.monthly_returns,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {str(e)}")


@app.post("/api/backtest/compare")
def run_comparative_backtest(req: MultiBacktestRequest):
    """Run multi-strategy comparative backtest across multiple tickers."""
    try:
        config = req.model_dump()
        result = run_multi_backtest(config)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Comparative backtest failed: {str(e)}")


# =============================================
# Phase 5: Hedging & EV Endpoints
# =============================================

@app.post("/api/hedge/ratio")
def get_hedge_ratio(req: HedgeRequest):
    """Calculate hedge ratio for portfolio positions."""
    try:
        return compute_hedge_ratio(req.positions, req.target_delta)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Hedge calculation failed: {str(e)}")


@app.post("/api/hedge/rebalance-check")
def check_rebalance(req: RebalanceTriggerRequest):
    """Check if portfolio needs rebalancing based on Greeks limits."""
    try:
        return check_rebalance_triggers(
            req.positions,
            delta_limit=req.delta_limit,
            gamma_limit=req.gamma_limit,
            vega_limit=req.vega_limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rebalance check failed: {str(e)}")


@app.post("/api/hedge/schedule")
def get_rebalance_schedule(req: HedgeRequest):
    """Forecast rebalancing needs over the next 5 days."""
    try:
        return {
            "schedule": optimal_rebalance_schedule(req.positions),
            "current_hedge": compute_hedge_ratio(req.positions, req.target_delta),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schedule forecast failed: {str(e)}")


@app.post("/api/strategy/ev")
def calculate_ev(req: EVRequest):
    """Calculate Expected Value for a potential trade."""
    try:
        return calculate_trade_ev(
            S=req.S, K=req.K, T=req.T, r=req.r, sigma=req.sigma,
            option_type=req.option_type, premium=req.premium,
            contracts=req.contracts, direction=req.direction,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"EV calculation failed: {str(e)}")


@app.post("/api/strategy/ev/scan")
def scan_ev_opportunities(req: EVScanRequest):
    """Scan across strikes for best EV trading opportunities."""
    try:
        return {
            "opportunities": scan_opportunities(
                S=req.S, T=req.T, r=req.r, sigma=req.sigma,
                strike_range_pct=req.strike_range_pct,
                num_strikes=req.num_strikes,
                min_ev_per_contract=req.min_ev_per_contract,
            ),
            "spot_price": req.S,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"EV scan failed: {str(e)}")


# =============================================
# Phase 6: Risk Management Endpoints
# =============================================

@app.get("/api/risk/var/{ticker}")
def get_var(ticker: str, portfolio_value: float = 100000, confidence: float = 0.95, holding_period: int = 1, method: str = "all"):
    """Calculate Value at Risk for a ticker."""
    try:
        if method == "historical":
            return historical_var(ticker.upper(), portfolio_value, confidence, holding_period=holding_period)
        elif method == "parametric":
            return parametric_var(ticker.upper(), portfolio_value, confidence, holding_period=holding_period)
        elif method == "monte_carlo":
            return monte_carlo_var(ticker.upper(), portfolio_value, confidence, holding_period=holding_period)
        else:
            return comprehensive_var(ticker.upper(), portfolio_value, confidence, holding_period=holding_period)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"VaR calculation failed: {str(e)}")


@app.post("/api/risk/limits-check")
def check_limits(req: RiskCheckRequest):
    """Check portfolio position limits."""
    try:
        limits = RiskLimits(
            max_portfolio_delta=req.max_portfolio_delta,
            max_portfolio_gamma=req.max_portfolio_gamma,
            max_portfolio_vega=req.max_portfolio_vega,
        )
        return check_position_limits(req.portfolio_greeks, limits)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Limits check failed: {str(e)}")


@app.get("/api/risk/drawdown")
def check_portfolio_drawdown(current_equity: float, peak_equity: float, limit: float = 0.10):
    """Check portfolio drawdown against limit."""
    try:
        return check_drawdown(current_equity, peak_equity, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Drawdown check failed: {str(e)}")


# =============================================
# Phase 7: Execution Endpoints
# =============================================

@app.get("/api/execution/account")
def get_trading_account():
    """Get Alpaca trading account information."""
    try:
        return get_account()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Account fetch failed: {str(e)}")


@app.get("/api/execution/positions")
def get_trading_positions():
    """Get all open positions from Alpaca."""
    try:
        return {"positions": get_positions()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Positions fetch failed: {str(e)}")


@app.get("/api/execution/orders")
def get_trading_orders(status: str = "open"):
    """Get orders from Alpaca."""
    try:
        return {"orders": get_orders(status)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Orders fetch failed: {str(e)}")


@app.post("/api/execution/order")
def submit_trading_order(req: OrderRequest):
    """Submit a trading order to Alpaca."""
    try:
        return submit_order(
            symbol=req.symbol,
            qty=req.qty,
            side=req.side,
            order_type=req.order_type,
            time_in_force=req.time_in_force,
            limit_price=req.limit_price,
            signal_source=req.signal_source,
            signal_data=req.signal_data,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Order submission failed: {str(e)}")


@app.delete("/api/execution/order/{order_id}")
def cancel_trading_order(order_id: str):
    """Cancel a specific order."""
    try:
        return cancel_order(order_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Order cancellation failed: {str(e)}")


@app.get("/api/execution/history")
def get_equity_history(period: str = "1M", timeframe: str = "1D"):
    """Get portfolio equity history from Alpaca."""
    try:
        return get_portfolio_history(period, timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"History fetch failed: {str(e)}")


# =============================================
# Options Trading Endpoints
# =============================================

@app.get("/api/execution/options/contracts")
def get_option_contracts(
    underlying_symbol: str,
    expiration_date: str = None,
    expiration_date_gte: str = None,
    expiration_date_lte: str = None,
    strike_price_gte: float = None,
    strike_price_lte: float = None,
    option_type: str = None,
):
    """List available options contracts for an underlying symbol."""
    try:
        return get_options_contracts(
            underlying_symbol=underlying_symbol.upper(),
            expiration_date=expiration_date,
            expiration_date_gte=expiration_date_gte,
            expiration_date_lte=expiration_date_lte,
            strike_price_gte=strike_price_gte,
            strike_price_lte=strike_price_lte,
            option_type=option_type,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contracts fetch failed: {str(e)}")


@app.get("/api/execution/options/chain/{underlying}")
def get_option_chain(
    underlying: str,
    expiration_date: str = None,
    option_type: str = None,
    strike_price_gte: float = None,
    strike_price_lte: float = None,
):
    """Get live options chain snapshot with bid/ask and greeks."""
    try:
        return get_options_chain_snapshot(
            underlying_symbol=underlying.upper(),
            expiration_date=expiration_date,
            option_type=option_type,
            strike_price_gte=strike_price_gte,
            strike_price_lte=strike_price_lte,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chain snapshot failed: {str(e)}")


@app.post("/api/execution/options/order")
def submit_options_order(req: OptionsOrderRequest):
    """Submit an options order to Alpaca."""
    try:
        return submit_option_order(
            symbol=req.symbol,
            qty=req.qty,
            side=req.side,
            order_type=req.order_type,
            limit_price=req.limit_price,
            signal_source=req.signal_source,
            signal_data=req.signal_data,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Options order failed: {str(e)}")


@app.post("/api/execution/options/exercise")
def exercise_options_position(req: ExerciseRequest):
    """Exercise an options position."""
    try:
        return exercise_option(req.symbol_or_contract_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Exercise failed: {str(e)}")


@app.delete("/api/execution/options/position/{symbol}")
def close_options_position(symbol: str):
    """Close an options position."""
    try:
        return close_option_position(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Close position failed: {str(e)}")


# =============================================
# Trade Journal Endpoints
# =============================================

@app.get("/api/journal/trades")
def get_journal_trades(
    symbol: str = None,
    status: str = None,
    signal_source: str = None,
    date_from: str = None,
    date_to: str = None,
    limit: int = 100,
    offset: int = 0,
):
    """Get trade history with optional filters."""
    try:
        trades = get_trades(
            symbol=symbol, status=status, signal_source=signal_source,
            date_from=date_from, date_to=date_to, limit=limit, offset=offset,
        )
        return {"trades": trades, "count": len(trades)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Journal query failed: {str(e)}")


@app.get("/api/journal/trades/{trade_id}")
def get_journal_trade(trade_id: int):
    """Get a single trade by ID."""
    try:
        trade = get_trade(trade_id)
        if trade is None:
            raise HTTPException(status_code=404, detail="Trade not found")
        return trade
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trade fetch failed: {str(e)}")


@app.get("/api/journal/pnl")
def get_journal_pnl():
    """Get aggregate P&L summary."""
    try:
        return get_pnl_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"P&L summary failed: {str(e)}")


@app.get("/api/journal/pnl/by-signal")
def get_journal_pnl_by_signal():
    """Get P&L breakdown by signal source."""
    try:
        return {"signal_stats": get_trade_stats_by_signal()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signal stats failed: {str(e)}")


@app.post("/api/journal/sync")
def trigger_journal_sync():
    """Sync trade statuses from Alpaca."""
    try:
        return sync_order_statuses()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@app.get("/api/journal/activity-log")
def get_journal_activity_log(event_type: str = None, limit: int = 100, offset: int = 0):
    """Get engine/system activity log."""
    try:
        logs = get_engine_logs(event_type=event_type, limit=limit, offset=offset)
        return {"logs": logs, "count": len(logs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Activity log failed: {str(e)}")


# =============================================
# Auto Engine Endpoints
# =============================================

@app.post("/api/engine/start")
async def start_engine():
    """Start the mispricing engine."""
    try:
        engine = get_engine()
        result = await engine.start()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine start failed: {str(e)}")


@app.post("/api/engine/stop")
async def stop_engine():
    """Stop the mispricing engine."""
    try:
        engine = get_engine()
        result = await engine.stop()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine stop failed: {str(e)}")


@app.get("/api/engine/status")
def get_engine_status():
    """Get engine status, config, and stats."""
    try:
        engine = get_engine()
        return engine.status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine status failed: {str(e)}")


@app.put("/api/engine/config")
def update_engine_config(req: EngineConfigRequest):
    """Update engine configuration at runtime."""
    try:
        engine = get_engine()
        updates = req.model_dump(exclude_none=True)
        config = engine.update_config(**updates)
        return {"config": config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Config update failed: {str(e)}")


@app.get("/api/engine/logs")
def get_engine_activity_logs(event_type: str = None, limit: int = 100, offset: int = 0):
    """Get engine activity logs."""
    try:
        logs = get_engine_logs(event_type=event_type, limit=limit, offset=offset)
        return {"logs": logs, "count": len(logs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine logs failed: {str(e)}")


# =============================================
# Portfolio Monitoring Endpoints
# =============================================

@app.get("/api/portfolio/positions-greeks")
def get_positions_with_greeks():
    """Get all positions enriched with Greeks (individual + aggregated)."""
    from datetime import datetime, date as date_type
    try:
        raw_positions = get_positions()
        enriched = []
        option_positions = []
        stock_positions = []

        for pos in raw_positions:
            asset_class = pos.get("asset_class", "us_equity")
            if asset_class == "us_option":
                option_positions.append(pos)
            else:
                stock_positions.append(pos)

        # Enrich stock positions (delta = qty, other greeks = 0)
        for pos in stock_positions:
            qty = int(float(pos.get("qty", 0)))
            enriched.append({
                **pos,
                "parsed_symbol": pos.get("symbol", ""),
                "position_type": "stock",
                "greeks": {
                    "delta": float(qty),
                    "gamma": 0.0,
                    "vega": 0.0,
                    "theta": 0.0,
                    "rho": 0.0,
                },
                "bs_price": None,
                "bs_params": None,
            })

        # Enrich option positions with individual Greeks
        greeks_input = _build_greeks_input(option_positions)
        for pos, gi in zip(option_positions, greeks_input):
            try:
                indiv_greeks = calculate_greeks(
                    S=gi["S"], K=gi["K"], T=gi["T"],
                    r=gi["r"], sigma=gi["sigma"],
                    option_type=gi["option_type"],
                )
                bs_price = black_scholes(
                    S=gi["S"], K=gi["K"], T=gi["T"],
                    r=gi["r"], sigma=gi["sigma"],
                    option_type=gi["option_type"],
                )
                qty = gi["qty"]
                multiplier = qty * 100
                scaled_greeks = {k: round(float(v) * multiplier, 4) for k, v in indiv_greeks.items()}
            except Exception:
                scaled_greeks = {"delta": 0, "gamma": 0, "vega": 0, "theta": 0, "rho": 0}
                bs_price = 0
                gi = {}

            parsed = _parse_occ_symbol(pos.get("symbol", ""))
            readable = ""
            if parsed:
                readable = f"{parsed['underlying']} {parsed['expiration']} ${parsed['strike']:.2f} {parsed['type'].title()}"

            enriched.append({
                **pos,
                "parsed_symbol": readable,
                "position_type": "option",
                "greeks": scaled_greeks,
                "bs_price": round(float(bs_price), 4) if bs_price else None,
                "bs_params": gi if gi else None,
            })

        # Aggregate portfolio Greeks
        portfolio_greeks = {"total_delta": 0, "total_gamma": 0, "total_vega": 0, "total_theta": 0, "total_rho": 0}
        # Add stock deltas
        for pos in enriched:
            portfolio_greeks["total_delta"] += pos["greeks"].get("delta", 0)
            portfolio_greeks["total_gamma"] += pos["greeks"].get("gamma", 0)
            portfolio_greeks["total_vega"] += pos["greeks"].get("vega", 0)
            portfolio_greeks["total_theta"] += pos["greeks"].get("theta", 0)
            portfolio_greeks["total_rho"] += pos["greeks"].get("rho", 0)

        portfolio_greeks = {k: round(v, 4) for k, v in portfolio_greeks.items()}

        return {
            "positions": enriched,
            "portfolio_greeks": portfolio_greeks,
            "position_count": len(enriched),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Positions-Greeks fetch failed: {str(e)}")


@app.get("/api/portfolio/summary")
def get_portfolio_summary():
    """Get combined portfolio summary: account, Greeks, P&L."""
    from datetime import datetime
    try:
        account = get_account()
        positions = get_positions()

        # Build greeks input from option positions
        option_positions = [p for p in positions if p.get("asset_class") == "us_option"]
        greeks_input = _build_greeks_input(option_positions)

        # Aggregate Greeks (options)
        if greeks_input:
            agg = aggregate_portfolio_greeks(greeks_input)
        else:
            agg = {"total_delta": 0, "total_gamma": 0, "total_vega": 0, "total_theta": 0, "total_rho": 0}

        # Add stock deltas
        stock_delta = sum(
            int(float(p.get("qty", 0)))
            for p in positions if p.get("asset_class") != "us_option"
        )
        if isinstance(agg.get("total_delta"), (int, float)):
            agg["total_delta"] = round(agg["total_delta"] + stock_delta, 4)

        # P&L summary from journal
        try:
            pnl = get_pnl_summary()
        except Exception:
            pnl = {}

        return {
            "account": account,
            "portfolio_greeks": agg,
            "pnl_summary": pnl,
            "position_count": len(positions),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Portfolio summary failed: {str(e)}")


@app.get("/api/portfolio/equity-history")
def get_portfolio_equity_history(period: str = "1M", timeframe: str = "1D"):
    """Get portfolio equity history for charting."""
    try:
        return get_portfolio_history(period, timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Equity history failed: {str(e)}")


@app.get("/api/portfolio/market-status")
def get_market_status():
    """Get current US market status based on ET time."""
    import pytz
    from datetime import datetime, time as dt_time, timedelta

    et = pytz.timezone("US/Eastern")
    now = datetime.now(et)
    weekday = now.weekday()  # 0=Mon, 6=Sun

    market_open = dt_time(9, 30)
    market_close = dt_time(16, 0)
    pre_market_open = dt_time(4, 0)
    after_hours_close = dt_time(20, 0)

    current_time = now.time()

    if weekday >= 5:
        status = "closed"
    elif market_open <= current_time < market_close:
        status = "open"
    elif pre_market_open <= current_time < market_open or market_close <= current_time < after_hours_close:
        status = "extended"
    else:
        status = "closed"

    # Calculate next open/close
    if status == "open":
        next_close = now.replace(hour=16, minute=0, second=0, microsecond=0).isoformat()
        next_open = None
    else:
        next_close = None
        # Next market open: find next weekday at 9:30 ET
        days_ahead = 0
        candidate = now
        if weekday >= 5:
            days_ahead = 7 - weekday  # Monday
        elif current_time >= market_close:
            days_ahead = 1
            if weekday == 4:
                days_ahead = 3  # Friday after close -> Monday
        candidate = (now + timedelta(days=days_ahead)).replace(
            hour=9, minute=30, second=0, microsecond=0
        )
        next_open = candidate.isoformat()

    return {
        "status": status,
        "current_time_et": now.strftime("%H:%M:%S ET"),
        "next_open": next_open,
        "next_close": next_close,
    }


# =============================================
# Phase V2 — Multi-Agent Orchestrator (P1)
# =============================================

from agents.service import get_service as _get_agents_service


@app.post("/api/agents/analyze")
async def agents_analyze(payload: dict):
    ticker = str(payload.get("ticker", "")).upper().strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="Missing 'ticker'")
    try:
        result = await _get_agents_service().analyze(ticker)
        return result.model_dump(mode="json")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent analyze failed: {exc}")


@app.get("/api/agents/status")
def agents_status():
    return {"agents": _get_agents_service().status()}


@app.get("/api/agents/confluence/{ticker}")
async def agents_confluence(ticker: str):
    svc = _get_agents_service()
    cached = svc.cached(ticker)
    if cached is None:
        try:
            cached = await svc.analyze(ticker)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Agent analyze failed: {exc}")
    return cached.model_dump(mode="json")


# =============================================
# Phase V2 — Signal History & Win Rate (P3)
# =============================================

from journal.database import (
    get_signal_history as _db_signal_history,
    get_signal_performance as _db_signal_perf,
    get_win_rate_by_bucket as _db_win_rate_bucket,
)


@app.get("/api/signals/history")
def signals_history(ticker: Optional[str] = None, days: int = 30, min_confluence: Optional[float] = None, limit: int = 500):
    return {"signals": _db_signal_history(ticker=ticker, days=days, min_confluence=min_confluence, limit=limit)}


@app.get("/api/signals/win-rate")
def signals_win_rate(min_confluence: float = 0.65):
    buckets = _db_win_rate_bucket()
    # Headline number: union of buckets that meet the threshold.
    if min_confluence >= 0.65:
        filtered = [buckets.get("high", {})]
    elif min_confluence >= 0.50:
        filtered = [buckets.get("mid", {}), buckets.get("high", {})]
    else:
        filtered = list(buckets.values())
    resolved = sum(b.get("resolved", 0) or 0 for b in filtered)
    wins = sum(b.get("wins", 0) or 0 for b in filtered)
    rate = round(wins / resolved, 4) if resolved else None
    return {"min_confluence": min_confluence, "resolved": resolved, "wins": wins, "win_rate": rate, "buckets": buckets}


@app.get("/api/signals/performance")
def signals_performance():
    return _db_signal_perf()


# =============================================
# Phase V2 — Per-Agent Memory (P5)
# =============================================

from agents.memory import memory_overview as _memory_overview


@app.get("/api/agents/memory/{ticker}")
def agents_memory(ticker: str):
    return _memory_overview(ticker)


# =============================================
# Phase V2 — Historical Replay (P6)
# =============================================

from datetime import date as _date

_replay_cache: dict = {}


@app.post("/api/replay/run")
async def replay_run(payload: dict):
    from replay.engine import ReplayEngine
    import asyncio as _asyncio

    ticker = str(payload.get("ticker", "")).upper().strip()
    start_s = str(payload.get("start", "")).strip()
    end_s = str(payload.get("end", "")).strip()
    if not ticker or not start_s or not end_s:
        raise HTTPException(status_code=400, detail="ticker, start, end are required (YYYY-MM-DD)")
    try:
        start = _date.fromisoformat(start_s)
        end = _date.fromisoformat(end_s)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=f"Invalid date: {ve}")

    engine = ReplayEngine()
    try:
        result = await _asyncio.to_thread(engine.run, ticker, start, end)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Replay failed: {exc}")

    _replay_cache[result.replay_id] = result
    return result.to_dict()


@app.get("/api/replay/{replay_id}")
def replay_get(replay_id: str):
    rec = _replay_cache.get(replay_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Replay not found (cache miss)")
    return rec.to_dict()


@app.get("/api/replay/{replay_id}/pdf")
def replay_pdf(replay_id: str):
    from fastapi.responses import Response

    rec = _replay_cache.get(replay_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Replay not found")

    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
    except ImportError:
        raise HTTPException(status_code=503, detail="reportlab not installed")

    import io

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(72, 720, f"VegaEdge Replay — {rec.ticker}")
    c.setFont("Helvetica", 10)
    c.drawString(72, 700, f"{rec.start} → {rec.end}   (id {rec.replay_id[:8]})")

    y = 670
    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, y, "Metrics")
    y -= 16
    c.setFont("Helvetica", 10)
    for k, v in rec.metrics.items():
        if isinstance(v, (dict, list)):
            continue
        c.drawString(80, y, f"{k}: {v}")
        y -= 14

    y -= 10
    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, y, "Coaching")
    y -= 16
    c.setFont("Helvetica", 10)
    # Wrap coaching text at ~95 chars per line.
    text = rec.coaching or "(no narrative)"
    for line in _wrap(text, 95):
        c.drawString(72, y, line)
        y -= 14
        if y < 72:
            c.showPage()
            y = 720

    c.showPage()
    c.save()
    return Response(content=buf.getvalue(), media_type="application/pdf")


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        if len(current) + 1 + len(w) > width:
            lines.append(current)
            current = w
        else:
            current = f"{current} {w}".strip()
    if current:
        lines.append(current)
    return lines


# =============================================
# Phase V2 — Trade Recommendation Tool (P2)
# =============================================

from vegaedge.trade_rec import get_trade_recommendation as _get_trade_rec


@app.post("/api/agents/trade-recommendation")
async def agents_trade_recommendation(payload: dict):
    ticker = str(payload.get("ticker", "")).upper().strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="Missing 'ticker'")
    override = payload.get("strategy_override")
    try:
        rec = await _get_trade_rec(ticker, strategy_override=override)
        return rec.model_dump(mode="json")
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Trade rec failed: {exc}")


# ---------------------------------------------------------------------------
# Robinhood real-portfolio endpoints
# ---------------------------------------------------------------------------


@app.post("/api/robinhood/ingest", response_model=RobinhoodIngestResponse)
def robinhood_ingest():
    """Re-scan `hood reports/` and `sofi reports/` and upsert new activity rows."""
    try:
        from pathlib import Path as _Path
        import sys as _sys

        _scripts = _Path(__file__).parent.parent.parent / "scripts"
        if str(_scripts) not in _sys.path:
            _sys.path.insert(0, str(_scripts))
        from ingest_robinhood import ingest as _rh_ingest, REPORTS_DIR as _RH_DIR  # type: ignore
        from ingest_sofi import ingest as _sofi_ingest, REPORTS_DIR as _SOFI_DIR  # type: ignore

        rh_result = _rh_ingest(_RH_DIR)
        sofi_result = _sofi_ingest(_SOFI_DIR)
        rh_result["sofi"] = sofi_result
        return RobinhoodIngestResponse(**rh_result)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Ingest failed: {exc}")


@app.post("/api/robinhood/sync", response_model=RobinhoodSyncResponse)
def robinhood_sync(account: Optional[str] = None):
    """Pull live positions from ALL Robinhood accounts and persist one snapshot per account.

    When `account` is omitted (the normal case) every account the user has
    (brokerage, Roth IRA, …) is fetched and stored in separate
    robinhood_live_snapshot rows tagged by their internal account name.
    When a specific account tag is passed only that account is fetched
    (useful for targeted re-syncs).

    Reads ROBINHOOD_USERNAME / ROBINHOOD_PASSWORD / ROBINHOOD_TOTP_SECRET
    from the environment.
    """
    from datetime import datetime, timezone
    from brokers import robinhood_api as rh_api

    fetched_at = datetime.now(timezone.utc).isoformat()

    if not rh_api._is_configured():
        return RobinhoodSyncResponse(
            ok=False,
            fetched_at=fetched_at,
            account=account,
            error="ROBINHOOD_USERNAME / ROBINHOOD_PASSWORD not set in .env.local",
        )

    # --- Full multi-account sync (default path) ---
    if not account:
        equities_by_tag, options_by_tag, summaries_by_tag, first_error = \
            rh_api.fetch_all_accounts_positions()

        if not equities_by_tag and not options_by_tag:
            # Nothing came back at all — likely a credentials/network failure.
            return RobinhoodSyncResponse(
                ok=False,
                fetched_at=fetched_at,
                account=None,
                error=first_error or "fetch_all_accounts_positions returned empty",
            )

        total_eq = 0
        total_opt = 0
        last_snapshot_id = 0
        for tag in set(list(equities_by_tag.keys()) + list(options_by_tag.keys())):
            eq_list = equities_by_tag.get(tag, [])
            opt_list = options_by_tag.get(tag, [])
            summary = summaries_by_tag.get(tag, {})
            payload_json = rh_portfolio.serialize_live_snapshot(eq_list, opt_list, summary)
            snap_id = rh_db.write_live_snapshot(
                fetched_at=fetched_at,
                account=tag,
                payload_json=payload_json,
                stale=False,
                error=None,
            )
            last_snapshot_id = snap_id
            total_eq += len(eq_list)
            total_opt += len(opt_list)

        # Also sync crypto positions into a separate snapshot row tagged "crypto".
        try:
            crypto_holdings, crypto_err = rh_api.fetch_crypto_positions()
            if crypto_err and first_error is None:
                first_error = crypto_err
            crypto_payload = rh_portfolio.serialize_live_snapshot([], [], {}, crypto=crypto_holdings)
            crypto_snap_id = rh_db.write_live_snapshot(
                fetched_at=fetched_at,
                account="crypto",
                payload_json=crypto_payload,
                stale=False,
                error=crypto_err,
            )
            last_snapshot_id = crypto_snap_id
        except Exception as _crypto_exc:  # noqa: BLE001
            import logging as _log
            _log.getLogger(__name__).warning("Crypto sync failed: %s", _crypto_exc)
            crypto_holdings = []

        return RobinhoodSyncResponse(
            ok=first_error is None,
            fetched_at=fetched_at,
            account="all",
            equities_count=total_eq,
            options_count=total_opt,
            snapshot_id=last_snapshot_id,
            stale=False,
            error=first_error,
        )

    # --- Single-account targeted sync ---
    equities, eq_err = rh_api.fetch_equity_positions(account)
    options, op_err = rh_api.fetch_option_positions(account)
    summary, sm_err = rh_api.fetch_account_summary()
    error = eq_err or op_err or sm_err

    payload_json = rh_portfolio.serialize_live_snapshot(equities, options, summary)
    snapshot_id = rh_db.write_live_snapshot(
        fetched_at=fetched_at,
        account=account,
        payload_json=payload_json,
        stale=False,
        error=error,
    )

    return RobinhoodSyncResponse(
        ok=error is None,
        fetched_at=fetched_at,
        account=account,
        equities_count=len(equities),
        options_count=len(options),
        snapshot_id=snapshot_id,
        stale=False,
        error=error,
    )


@app.get("/api/robinhood/sync/status", response_model=RobinhoodSyncStatus)
def robinhood_sync_status(account: Optional[str] = None):
    """Last-known live-sync state for the dashboard's source toggle."""
    from brokers import robinhood_api as rh_api

    row = rh_db.latest_live_snapshot(account)
    if row is None:
        return RobinhoodSyncStatus(
            has_snapshot=False,
            configured=rh_api._is_configured(),
        )
    return RobinhoodSyncStatus(
        has_snapshot=True,
        fetched_at=row["fetched_at"],
        account=row["account"],
        stale=bool(row["stale"]),
        error=row["error"],
        configured=rh_api._is_configured(),
    )


@app.get("/api/robinhood/accounts", response_model=RobinhoodAccountsResponse)
def robinhood_accounts():
    """Distinct account tags present in the activity DB."""
    return RobinhoodAccountsResponse(accounts=rh_portfolio.list_accounts())


@app.get("/api/robinhood/holdings", response_model=RobinhoodHoldingsResponse)
def robinhood_holdings(
    live_prices: bool = True,
    account: Optional[str] = None,
    source: str = "csv",
):
    """Current Robinhood holdings.

    `account` may be `brokerage`, `roth_ira`, or `all` (default). Set
    `live_prices=false` to skip yfinance enrichment (useful when the
    network is flaky; purely cost-basis view still works).
    `source=csv` (default) replays the activity log; `source=live` reads
    the latest snapshot from POST /api/robinhood/sync (Robinhood API).
    """
    if source == "live":
        equities = rh_portfolio.compute_live_holdings(account)
        options = rh_portfolio.compute_live_options(account)
    else:
        equities = rh_portfolio.compute_equity_holdings(account)
        if live_prices:
            equities = rh_portfolio.enrich_equity_with_prices(equities)
        options = rh_portfolio.compute_option_holdings(account)

    return RobinhoodHoldingsResponse(
        equities=[RobinhoodHolding(**e.__dict__) for e in equities],
        options=[RobinhoodOption(**o.__dict__) for o in options],
    )


@app.get("/api/robinhood/summary", response_model=RobinhoodSummary)
def robinhood_summary(
    live_prices: bool = True,
    account: Optional[str] = None,
    source: str = "csv",
):
    if source == "live":
        equities = rh_portfolio.compute_live_holdings(account)
        options = rh_portfolio.compute_live_options(account)
        s = rh_portfolio.compute_live_summary(equities, options, account)
    else:
        equities = rh_portfolio.compute_equity_holdings(account)
        if live_prices:
            equities = rh_portfolio.enrich_equity_with_prices(equities)
        options = rh_portfolio.compute_option_holdings(account)
        s = rh_portfolio.compute_summary(equities, options, account)
    return RobinhoodSummary(**s.__dict__)


@app.get("/api/robinhood/activity", response_model=List[RobinhoodActivityRow])
def robinhood_activity(limit: int = 50, trans_code: Optional[str] = None, account: Optional[str] = None):
    limit = max(1, min(int(limit), 500))
    rows = rh_portfolio.recent_activity(limit=limit, trans_code=trans_code, account=account)
    return [RobinhoodActivityRow(**r.__dict__) for r in rows]


# =============================================
# Robinhood-aware analytics — adapter endpoints that feed the user's actual
# holdings into the project's existing analytics modules. See
# `backend/src/robinhood/analytics.py`.
# =============================================


@app.get("/api/robinhood/analytics/portfolio-greeks")
def robinhood_portfolio_greeks(account: str = "all"):
    try:
        return rh_analytics.portfolio_greeks_for_account(account)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Portfolio Greeks failed: {exc}")


@app.get("/api/robinhood/analytics/hedge-ratio")
def robinhood_hedge_ratio(account: str = "all", target_delta: float = 0.0):
    try:
        return rh_analytics.hedge_ratio_for_account(account, target_delta=target_delta)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Hedge ratio failed: {exc}")


@app.get("/api/robinhood/analytics/hedge-ratio-by-underlying")
def robinhood_hedge_ratio_by_underlying(account: str = "all", target_delta: float = 0.0):
    try:
        return rh_analytics.hedge_ratio_by_underlying_for_account(
            account, target_delta=target_delta,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Per-underlying hedge ratio failed: {exc}")


@app.get("/api/robinhood/analytics/delta-gamma-hedge")
def robinhood_delta_gamma_hedge(
    account: str = "all",
    underlying: Optional[str] = None,
    hedge_dte: int = 30,
    hedge_type: str = "call",
    top_n: int = 10,
):
    try:
        return rh_analytics.delta_gamma_hedge_for_account(
            account,
            underlying=underlying,
            hedge_dte=hedge_dte,
            hedge_type=hedge_type,
            top_n=top_n,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Delta-gamma hedge failed: {exc}")


@app.get("/api/robinhood/analytics/rebalance-check")
def robinhood_rebalance_check(
    account: str = "all",
    delta_limit: float = 1000.0,
    gamma_limit: float = 100.0,
    vega_limit: float = 1000.0,
):
    try:
        return rh_analytics.rebalance_check_for_account(
            account,
            delta_limit=delta_limit,
            gamma_limit=gamma_limit,
            vega_limit=vega_limit,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Rebalance check failed: {exc}")


@app.get("/api/robinhood/analytics/stress-test")
def robinhood_stress_test(
    account: str = "all",
    spot_shock: float = 0.10,
    vol_shock: float = 0.20,
):
    try:
        return rh_analytics.stress_test_for_account(
            account,
            spot_shock_pct=spot_shock,
            vol_shock_pct=vol_shock,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Stress test failed: {exc}")


@app.get("/api/robinhood/analytics/limits-check")
def robinhood_limits_check(
    account: str = "all",
    max_delta: float = 10000.0,
    max_gamma: float = 500.0,
    max_vega: float = 10000.0,
):
    try:
        return rh_analytics.limits_check_for_account(
            account,
            max_portfolio_delta=max_delta,
            max_portfolio_gamma=max_gamma,
            max_portfolio_vega=max_vega,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Limits check failed: {exc}")


@app.get("/api/robinhood/analytics/drawdown")
def robinhood_drawdown(account: str = "all", limit: float = 0.10):
    try:
        return rh_analytics.drawdown_for_account(account, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Drawdown check failed: {exc}")


# =============================================
# Robinhood Crypto endpoints
# =============================================

@app.get("/api/robinhood/crypto/positions", response_model=List[CryptoHoldingResponse])
def robinhood_crypto_positions(account: str = "crypto"):
    """Return crypto holdings from the latest robinhood_live_snapshot tagged 'crypto'.

    Returns an empty list if no crypto sync has been run yet.
    Trigger a sync first via POST /api/robinhood/sync.
    """
    holdings = rh_portfolio.compute_live_crypto(account)
    return [CryptoHoldingResponse(**h.__dict__) for h in holdings]


@app.get("/api/robinhood/crypto/quote/{symbol}", response_model=CryptoQuoteResponse)
def robinhood_crypto_quote(symbol: str):
    """Fetch live mark price for a crypto symbol via Robinhood."""
    from brokers import robinhood_api as rh_api
    sym = symbol.upper().strip()
    if not rh_api._is_configured():
        return CryptoQuoteResponse(symbol=sym, error="Robinhood credentials not configured")
    if not rh_api.login():
        return CryptoQuoteResponse(symbol=sym, error="Robinhood login failed")
    try:
        import robin_stocks.robinhood as rh
        data = rh.crypto.get_crypto_quote(sym) or {}
        mark = data.get("mark_price") or data.get("last_trade_price")
        price = float(mark) if mark is not None else None
        # Invalidate cache so this fresh fetch is stored.
        import time as _time
        rh_api._CRYPTO_QUOTE_CACHE[sym] = (_time.time(), price) if price is not None else rh_api._CRYPTO_QUOTE_CACHE.get(sym, (0, None))
        return CryptoQuoteResponse(symbol=sym, mark_price=price)
    except Exception as exc:  # noqa: BLE001
        return CryptoQuoteResponse(symbol=sym, error=str(exc))


@app.post("/api/robinhood/crypto/order", response_model=CryptoOrderResponse)
def robinhood_crypto_order(req: CryptoOrderRequest):
    """Place or simulate a crypto order.

    SAFETY CONSTRAINTS (enforced in order):
      1. dry_run=True (default) → returns a simulated order, NEVER calls robin_stocks
         order functions.
      2. Live orders (dry_run=False) MUST have confirm=True.
      3. Live orders MUST have notional_usd ≤ CRYPTO_ORDER_NOTIONAL_CAP_USD ($50).

    Every attempt (dry-run AND live) is logged to the backend logger with full params.
    """
    import logging as _logging
    import uuid as _uuid
    from datetime import datetime, timezone
    from brokers import robinhood_api as rh_api

    logger = _logging.getLogger("crypto_order")

    sym = req.symbol.upper().strip()
    attempt_ts = datetime.now(timezone.utc).isoformat()

    # --- Validate notional cap (applies to ALL requests, including dry-run, as
    #     an extra sanity guard; required for live orders specifically) ---
    if req.notional_usd > CRYPTO_ORDER_NOTIONAL_CAP_USD:
        logger.warning(
            "crypto_order REJECTED notional_cap",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "notional_usd": req.notional_usd, "dry_run": req.dry_run,
                "reason": f"notional {req.notional_usd} > cap {CRYPTO_ORDER_NOTIONAL_CAP_USD}",
            },
        )
        raise HTTPException(
            status_code=400,
            detail=f"notional_usd {req.notional_usd} exceeds per-order cap of ${CRYPTO_ORDER_NOTIONAL_CAP_USD}",
        )

    # --- Dry-run path: simulate only ---
    if req.dry_run:
        mark_price: Optional[float] = None
        qty: Optional[float] = None
        if rh_api._is_configured() and rh_api.login():
            mark_price = rh_api._get_crypto_quote_cached(sym)
        if mark_price and mark_price > 0:
            qty = round(req.notional_usd / mark_price, 8)
        stub_id = f"DRY-RUN-{str(_uuid.uuid4()).upper()[:16]}"
        logger.info(
            "crypto_order DRY_RUN",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "notional_usd": req.notional_usd, "dry_run": True,
                "mark_price": mark_price, "quantity": qty, "order_id": stub_id,
            },
        )
        return CryptoOrderResponse(
            order_id=stub_id,
            symbol=sym,
            side=req.side,
            notional_usd=req.notional_usd,
            quantity=qty,
            mark_price=mark_price,
            dry_run=True,
            status="simulated",
            message=f"DRY RUN — no real order was placed. Mark price: {mark_price}",
        )

    # --- Live order path ---
    # Require explicit confirmation flag.
    if not req.confirm:
        logger.warning(
            "crypto_order REJECTED no_confirm",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "notional_usd": req.notional_usd, "dry_run": False,
            },
        )
        raise HTTPException(status_code=400, detail="confirm flag required for live orders")

    if not rh_api._is_configured():
        raise HTTPException(status_code=503, detail="Robinhood credentials not configured")
    if not rh_api.login():
        raise HTTPException(status_code=503, detail="Robinhood login failed")

    import robin_stocks.robinhood as rh

    try:
        if req.side == "buy":
            result = rh.orders.order_buy_crypto_by_price(sym, req.notional_usd)
        else:
            result = rh.orders.order_sell_crypto_by_price(sym, req.notional_usd)
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "crypto_order LIVE_ERROR",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "notional_usd": req.notional_usd, "dry_run": False,
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=500, detail=f"Order placement failed: {exc}")

    # IMPORTANT: robin_stocks returns the raw broker response. On success the
    # dict has {"id": "<uuid>", "state": "...", ...}. On REJECTION it returns
    # the broker's error envelope instead — typically containing one or more
    # of: non_field_errors, detail, reject_reason, buying_power, account, etc.
    # Detect those and surface the failure honestly. The earlier version of
    # this code fabricated a UUID + "submitted" status when `id` was missing,
    # which silently masked rejected orders.
    if not isinstance(result, dict) or not result.get("id"):
        # Try to extract a useful error message from common RH error shapes.
        error_msg = "Order rejected by Robinhood (no order id returned)"
        if isinstance(result, dict):
            if result.get("non_field_errors"):
                error_msg = "; ".join(str(e) for e in result["non_field_errors"])
            elif result.get("detail"):
                error_msg = str(result["detail"])
            elif result.get("reject_reason"):
                error_msg = f"reject_reason: {result['reject_reason']}"
            else:
                # Surface whatever fields the broker did return so the user can debug
                error_msg = f"Unexpected response: {result}"
        elif result is None:
            error_msg = "Robinhood returned no response (rate-limited or timeout)"

        logger.error(
            "crypto_order LIVE_REJECTED",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "notional_usd": req.notional_usd, "dry_run": False,
                "raw_response": result, "error": error_msg,
            },
        )
        raise HTTPException(
            status_code=422,
            detail=f"Order rejected: {error_msg}",
        )

    order_id = str(result["id"])
    status = result.get("state") or "submitted"
    filled_quantity = result.get("quantity")

    # Fetch current mark for the response
    mark_price = rh_api._get_crypto_quote_cached(sym)
    qty = (
        float(filled_quantity)
        if filled_quantity is not None
        else (round(req.notional_usd / mark_price, 8) if mark_price and mark_price > 0 else None)
    )

    logger.info(
        "crypto_order LIVE_PLACED",
        extra={
            "ts": attempt_ts, "symbol": sym, "side": req.side,
            "notional_usd": req.notional_usd, "dry_run": False, "confirm": req.confirm,
            "order_id": order_id, "status": status, "mark_price": mark_price,
            "raw_response": result,
        },
    )

    return CryptoOrderResponse(
        order_id=str(order_id),
        symbol=sym,
        side=req.side,
        notional_usd=req.notional_usd,
        quantity=qty,
        mark_price=mark_price,
        dry_run=False,
        status=status,
        message=f"Order {order_id} submitted. Check the Robinhood app for status.",
    )


@app.post("/api/robinhood/equity/order", response_model=EquityOrderResponse)
def robinhood_equity_order(req: EquityOrderRequest):
    """Place or simulate an equity (stock) order via Robinhood.

    SAFETY CONSTRAINTS (enforced in order):
      1. Estimated notional cap: quantity × mark_price must be ≤
         EQUITY_ORDER_NOTIONAL_CAP_USD ($200). For limit orders, uses
         limit_price × quantity (exact). For market orders, uses current
         quote × quantity. Fires BEFORE the dry_run branch so oversized
         quantities are blocked regardless of dry_run setting.
      2. dry_run=True (default) → returns a simulated order, NEVER calls
         robin_stocks order functions.
      3. Live orders (dry_run=False) MUST have confirm=True.
      4. Live orders MUST resolve a valid account_number via enumerate_accounts().
      5. After calling robin_stocks, validate result["id"] exists. If not,
         parse non_field_errors / detail / reject_reason and return HTTP 422.
         Do NOT fabricate a UUID for a rejected order.

    Every attempt (dry-run AND live) is logged to the backend logger.
    """
    import logging as _logging
    import uuid as _uuid
    from datetime import datetime, timezone
    from brokers import robinhood_api as rh_api

    logger = _logging.getLogger("equity_order")

    sym = req.symbol.upper().strip()
    attempt_ts = datetime.now(timezone.utc).isoformat()

    # --- Resolve the notional estimate for cap check ---
    # For limit orders we know the exact price; for market orders we need a quote.
    mark_price_for_cap: Optional[float] = None
    if req.order_type == "limit":
        if req.limit_price is None or req.limit_price <= 0:
            raise HTTPException(status_code=400, detail="limit_price required and must be > 0 for limit orders")
        mark_price_for_cap = req.limit_price
    else:
        # Market order: attempt to fetch a live quote for the cap check.
        # If Robinhood isn't configured we fall back to yfinance spot via the
        # existing _get_spot_cached helper so the cap check still fires.
        if rh_api._is_configured() and rh_api.login():
            mark_price_for_cap = rh_api._get_equity_quote_cached(sym)
        if mark_price_for_cap is None:
            mark_price_for_cap = rh_api._get_spot_cached(sym)

    estimated_notional: Optional[float] = None
    if mark_price_for_cap is not None and mark_price_for_cap > 0:
        estimated_notional = round(req.quantity * mark_price_for_cap, 4)

    # --- Notional cap guard (fires before dry_run path) ---
    if estimated_notional is not None and estimated_notional > EQUITY_ORDER_NOTIONAL_CAP_USD:
        logger.warning(
            "equity_order REJECTED notional_cap",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "quantity": req.quantity, "mark_price": mark_price_for_cap,
                "estimated_notional": estimated_notional,
                "cap": EQUITY_ORDER_NOTIONAL_CAP_USD,
                "dry_run": req.dry_run,
            },
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"estimated_notional ${estimated_notional:.2f} exceeds per-order cap of "
                f"${EQUITY_ORDER_NOTIONAL_CAP_USD:.2f}. Reduce quantity or raise the cap."
            ),
        )

    # --- Dry-run path: simulate only ---
    if req.dry_run:
        # Refresh quote for response display (may already be cached from cap check)
        mark_for_display = mark_price_for_cap
        if mark_for_display is None and rh_api._is_configured() and rh_api.login():
            mark_for_display = rh_api._get_equity_quote_cached(sym)
        if mark_for_display is None:
            mark_for_display = rh_api._get_spot_cached(sym)

        est_notional_display = (
            round(req.quantity * mark_for_display, 4)
            if mark_for_display is not None and mark_for_display > 0
            else None
        )
        stub_id = f"DRY-RUN-{str(_uuid.uuid4()).upper()[:16]}"
        logger.info(
            "equity_order DRY_RUN",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "quantity": req.quantity, "account": req.account,
                "order_type": req.order_type, "limit_price": req.limit_price,
                "mark_price": mark_for_display, "estimated_notional": est_notional_display,
                "order_id": stub_id,
            },
        )
        return EquityOrderResponse(
            order_id=stub_id,
            symbol=sym,
            side=req.side,
            quantity=req.quantity,
            account=req.account,
            order_type=req.order_type,
            limit_price=req.limit_price,
            estimated_notional_usd=est_notional_display,
            mark_price=mark_for_display,
            dry_run=True,
            status="simulated",
            message=(
                f"DRY RUN — no real order was placed. "
                f"Mark price: {mark_for_display}. "
                f"Estimated notional: ${est_notional_display:.2f}"
                if est_notional_display is not None
                else "DRY RUN — no real order was placed."
            ),
        )

    # --- Live order path ---
    if not req.confirm:
        logger.warning(
            "equity_order REJECTED no_confirm",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "quantity": req.quantity, "account": req.account, "dry_run": False,
            },
        )
        raise HTTPException(status_code=400, detail="confirm flag required for live orders")

    if not rh_api._is_configured():
        raise HTTPException(status_code=503, detail="Robinhood credentials not configured")
    if not rh_api.login():
        raise HTTPException(status_code=503, detail="Robinhood login failed")

    # Resolve account_number for the requested account tag.
    acct_num, acct_warn = rh_api._account_number_for_tag(req.account)
    if acct_num is None:
        raise HTTPException(status_code=503, detail=f"Could not resolve account_number: {acct_warn}")
    if acct_warn:
        logger.warning("equity_order account_number_fallback", extra={"ts": attempt_ts, "warn": acct_warn})

    import robin_stocks.robinhood as rh

    try:
        if req.order_type == "market":
            if req.side == "buy":
                result = rh.orders.order_buy_market(sym, req.quantity, account_number=acct_num)
            else:
                result = rh.orders.order_sell_market(sym, req.quantity, account_number=acct_num)
        else:
            # limit order — limit_price already validated above
            if req.side == "buy":
                result = rh.orders.order_buy_limit(sym, req.quantity, req.limit_price, account_number=acct_num)
            else:
                result = rh.orders.order_sell_limit(sym, req.quantity, req.limit_price, account_number=acct_num)
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "equity_order LIVE_ERROR",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "quantity": req.quantity, "account": req.account,
                "order_type": req.order_type, "dry_run": False,
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=500, detail=f"Order placement failed: {exc}")

    # CRITICAL: validate that robin_stocks returned a real order dict with an id.
    # On rejection Robinhood returns an error envelope (non_field_errors, detail,
    # reject_reason, etc.) without an 'id' field. Do NOT fabricate a UUID — that
    # would silently mask the rejection. Same pattern as crypto order fix.
    if not isinstance(result, dict) or not result.get("id"):
        error_msg = "Order rejected by Robinhood (no order id returned)"
        if isinstance(result, dict):
            if result.get("non_field_errors"):
                error_msg = "; ".join(str(e) for e in result["non_field_errors"])
            elif result.get("detail"):
                error_msg = str(result["detail"])
            elif result.get("reject_reason"):
                error_msg = f"reject_reason: {result['reject_reason']}"
            else:
                error_msg = f"Unexpected response: {result}"
        elif result is None:
            error_msg = "Robinhood returned no response (rate-limited or timeout)"

        logger.error(
            "equity_order LIVE_REJECTED",
            extra={
                "ts": attempt_ts, "symbol": sym, "side": req.side,
                "quantity": req.quantity, "account": req.account,
                "order_type": req.order_type, "dry_run": False,
                "raw_response": result, "error": error_msg,
            },
        )
        raise HTTPException(
            status_code=422,
            detail=f"Order rejected: {error_msg}",
        )

    order_id = str(result["id"])
    status = result.get("state") or "submitted"

    # Refresh mark price for response
    mark_price_live = rh_api._get_equity_quote_cached(sym)
    est_notional_live = (
        round(req.quantity * mark_price_live, 4)
        if mark_price_live is not None and mark_price_live > 0
        else None
    )

    logger.info(
        "equity_order LIVE_PLACED",
        extra={
            "ts": attempt_ts, "symbol": sym, "side": req.side,
            "quantity": req.quantity, "account": req.account,
            "order_type": req.order_type, "limit_price": req.limit_price,
            "dry_run": False, "confirm": req.confirm,
            "order_id": order_id, "status": status,
            "mark_price": mark_price_live, "acct_num": acct_num,
            "raw_response": result,
        },
    )

    return EquityOrderResponse(
        order_id=order_id,
        symbol=sym,
        side=req.side,
        quantity=req.quantity,
        account=req.account,
        order_type=req.order_type,
        limit_price=req.limit_price,
        estimated_notional_usd=est_notional_live,
        mark_price=mark_price_live,
        dry_run=False,
        status=status,
        message=f"Order {order_id} submitted. Check the Robinhood app for fill status.",
    )


@app.post("/api/robinhood/options/order", response_model=OptionOrderResponse)
def robinhood_options_order(req: OptionOrderRequest):
    """Place or simulate a single-leg option order via Robinhood.

    Mirrors equity order safety: dry_run default, confirm gate, $200 notional cap
    (limit_price * 100 * qty), brokerage-account-only (IRAs typically lack
    options permission), real-order rejection parsing.
    """
    import logging as _logging
    import uuid as _uuid
    from datetime import datetime, timezone
    from brokers import robinhood_api as rh_api

    logger = _logging.getLogger("option_order")

    underlying = req.underlying.upper().strip()
    attempt_ts = datetime.now(timezone.utc).isoformat()

    # Notional cap: 1 contract = 100 shares; price is per-share.
    estimated_notional = round(req.limit_price * 100 * req.quantity, 4)
    if estimated_notional > OPTION_ORDER_NOTIONAL_CAP_USD:
        logger.warning(
            "option_order REJECTED notional_cap",
            extra={
                "ts": attempt_ts, "underlying": underlying,
                "strike": req.strike, "expiration": req.expiration,
                "option_type": req.option_type, "side": req.side,
                "quantity": req.quantity, "limit_price": req.limit_price,
                "estimated_notional": estimated_notional,
                "cap": OPTION_ORDER_NOTIONAL_CAP_USD, "dry_run": req.dry_run,
            },
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"estimated_notional ${estimated_notional:.2f} exceeds per-order cap of "
                f"${OPTION_ORDER_NOTIONAL_CAP_USD:.2f}. Reduce quantity or limit price."
            ),
        )

    # Dry-run path: simulate only.
    if req.dry_run:
        stub_id = f"DRY-RUN-{str(_uuid.uuid4()).upper()[:16]}"
        logger.info(
            "option_order DRY_RUN",
            extra={
                "ts": attempt_ts, "underlying": underlying,
                "strike": req.strike, "expiration": req.expiration,
                "option_type": req.option_type, "side": req.side,
                "position_effect": req.position_effect,
                "quantity": req.quantity, "limit_price": req.limit_price,
                "estimated_notional": estimated_notional, "order_id": stub_id,
            },
        )
        return OptionOrderResponse(
            order_id=stub_id,
            underlying=underlying,
            expiration=req.expiration,
            strike=req.strike,
            option_type=req.option_type,
            side=req.side,
            position_effect=req.position_effect,
            quantity=req.quantity,
            limit_price=req.limit_price,
            estimated_notional_usd=estimated_notional,
            account=req.account,
            dry_run=True,
            status="simulated",
            message=(
                f"DRY RUN — no real order was placed. "
                f"Notional ${estimated_notional:.2f} ({req.quantity} contract(s) "
                f"@ ${req.limit_price:.2f}/share)."
            ),
        )

    # Live order path
    if not req.confirm:
        logger.warning(
            "option_order REJECTED no_confirm",
            extra={"ts": attempt_ts, "underlying": underlying, "dry_run": False},
        )
        raise HTTPException(status_code=400, detail="confirm flag required for live orders")

    if not rh_api._is_configured():
        raise HTTPException(status_code=503, detail="Robinhood credentials not configured")
    if not rh_api.login():
        raise HTTPException(status_code=503, detail="Robinhood login failed")

    acct_num, acct_warn = rh_api._account_number_for_tag(req.account)
    if acct_num is None:
        raise HTTPException(status_code=503, detail=f"Could not resolve account_number: {acct_warn}")
    if acct_warn:
        logger.warning("option_order account_number_fallback", extra={"ts": attempt_ts, "warn": acct_warn})

    # Map (side, position_effect) -> (creditOrDebit, robin_stocks function).
    # buy → debit; sell → credit. position_effect is passed through.
    credit_or_debit = "debit" if req.side == "buy" else "credit"

    import robin_stocks.robinhood as rh

    # Preflight: confirm the contract actually exists on Robinhood before
    # placing the order. robin_stocks calls id_for_option() internally, and
    # when the lookup fails it returns None, which produces a malformed
    # option URL — Robinhood then rejects with the cryptic
    #   {'legs': [{'option': ['Invalid hyperlink - Incorrect URL match.']}]}
    # We catch that case here and surface a useful 422 instead.
    try:
        option_id = rh.helper.id_for_option(
            underlying, req.expiration, req.strike, req.option_type,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "option_order PREFLIGHT_LOOKUP_ERROR",
            extra={
                "ts": attempt_ts, "underlying": underlying,
                "strike": req.strike, "expiration": req.expiration,
                "option_type": req.option_type, "error": str(exc),
            },
        )
        raise HTTPException(status_code=502, detail=f"Option contract lookup failed: {exc}")

    if not option_id:
        logger.warning(
            "option_order PREFLIGHT_NO_CONTRACT",
            extra={
                "ts": attempt_ts, "underlying": underlying,
                "strike": req.strike, "expiration": req.expiration,
                "option_type": req.option_type, "side": req.side,
            },
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"No tradable {req.option_type.upper()} contract found for "
                f"{underlying} ${req.strike} exp {req.expiration}. "
                f"Strike or expiration likely doesn't exist on this underlying — "
                f"pick a strike from the chain."
            ),
        )

    try:
        if req.side == "buy":
            result = rh.orders.order_buy_option_limit(
                positionEffect=req.position_effect,
                creditOrDebit=credit_or_debit,
                price=req.limit_price,
                symbol=underlying,
                quantity=req.quantity,
                expirationDate=req.expiration,
                strike=req.strike,
                optionType=req.option_type,
                account_number=acct_num,
            )
        else:
            result = rh.orders.order_sell_option_limit(
                positionEffect=req.position_effect,
                creditOrDebit=credit_or_debit,
                price=req.limit_price,
                symbol=underlying,
                quantity=req.quantity,
                expirationDate=req.expiration,
                strike=req.strike,
                optionType=req.option_type,
                account_number=acct_num,
            )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "option_order LIVE_ERROR",
            extra={
                "ts": attempt_ts, "underlying": underlying,
                "strike": req.strike, "expiration": req.expiration,
                "option_type": req.option_type, "side": req.side,
                "position_effect": req.position_effect,
                "quantity": req.quantity, "limit_price": req.limit_price,
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=500, detail=f"Order placement failed: {exc}")

    if not isinstance(result, dict) or not result.get("id"):
        error_msg = "Order rejected by Robinhood (no order id returned)"
        if isinstance(result, dict):
            if result.get("non_field_errors"):
                error_msg = "; ".join(str(e) for e in result["non_field_errors"])
            elif result.get("detail"):
                error_msg = str(result["detail"])
            elif result.get("reject_reason"):
                error_msg = f"reject_reason: {result['reject_reason']}"
            elif (
                isinstance(result.get("legs"), list)
                and result["legs"]
                and isinstance(result["legs"][0], dict)
                and "option" in result["legs"][0]
            ):
                # Robinhood DRF "Invalid hyperlink" — option contract URL
                # didn't match. The preflight should have caught this; if
                # we land here the chain shifted between lookup and submit.
                error_msg = (
                    f"Robinhood rejected the contract URL for "
                    f"{underlying} ${req.strike} {req.option_type.upper()} "
                    f"{req.expiration}. The contract may have been delisted "
                    f"or the strike doesn't exist — re-pick from the chain."
                )
            else:
                error_msg = f"Unexpected response: {result}"
        elif result is None:
            error_msg = "Robinhood returned no response (rate-limited or timeout)"

        logger.error(
            "option_order LIVE_REJECTED",
            extra={
                "ts": attempt_ts, "underlying": underlying,
                "strike": req.strike, "expiration": req.expiration,
                "option_type": req.option_type, "side": req.side,
                "quantity": req.quantity, "limit_price": req.limit_price,
                "raw_response": result, "error": error_msg,
            },
        )
        raise HTTPException(status_code=422, detail=f"Order rejected: {error_msg}")

    order_id = str(result["id"])
    status = result.get("state") or "submitted"

    logger.info(
        "option_order LIVE_PLACED",
        extra={
            "ts": attempt_ts, "underlying": underlying,
            "strike": req.strike, "expiration": req.expiration,
            "option_type": req.option_type, "side": req.side,
            "position_effect": req.position_effect,
            "quantity": req.quantity, "limit_price": req.limit_price,
            "order_id": order_id, "status": status,
            "acct_num": acct_num, "raw_response": result,
        },
    )

    return OptionOrderResponse(
        order_id=order_id,
        underlying=underlying,
        expiration=req.expiration,
        strike=req.strike,
        option_type=req.option_type,
        side=req.side,
        position_effect=req.position_effect,
        quantity=req.quantity,
        limit_price=req.limit_price,
        estimated_notional_usd=estimated_notional,
        account=req.account,
        dry_run=False,
        status=status,
        message=f"Order {order_id} submitted. Check the Robinhood app for fill status.",
    )


# =============================================
# Recommendation API + Remote-Agent Webhook
# =============================================

from fastapi import Header
from recommend.engine import (
    build_recommendation as _build_rec,
    build_regime_signal as _build_regime_signal,
)
from recommend.models import RegimeSignalResponse as _RegimeSignalResponse
from recommend.webhook import (
    DEFAULT_WATCHLIST as _REC_DEFAULT_WATCHLIST,
    load_webhook_config as _load_webhook_config,
    scan_and_dispatch as _scan_and_dispatch,
)


@app.get("/api/recommend/{ticker}")
async def recommend_ticker(ticker: str):
    """On-demand verdict + ranked CC / CSP / LEAP candidates for one ticker.

    Designed for a remote Claude agent to call directly. Returns full
    RecommendationResponse JSON (verdict, mispricing snapshot, three
    StrategyBlocks each with up to 3 ranked candidates by annualized return).
    """
    try:
        rec = await _build_rec(ticker.upper().strip())
        return rec.model_dump(mode="json")
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Recommend failed: {exc}")


@app.get("/api/regime/{ticker}", response_model=_RegimeSignalResponse)
async def regime_signal(ticker: str):
    """Cron-friendly bundle: HMM regime + IV/HV ratio + 4-way verdict
    (BUY / SELL_PUT / SELL_COVERED_CALL / HOLD) + top actionable contract.

    One call replaces /api/market/{ticker}/regime + /api/market/{ticker}/mispricing
    + /api/recommend/{ticker} for cron consumers that just want a JSON line per
    poll.
    """
    try:
        return await _build_regime_signal(ticker)
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Regime signal failed: {exc}")


@app.get("/api/recommend")
async def recommend_watchlist():
    """Return recommendations for every watchlist ticker in one call.

    Per-ticker errors are captured under `results[ticker].error` so a single
    bad ticker does not 500 the whole response.
    """
    try:
        from engine.config import EngineConfig
        watchlist = list(EngineConfig().tickers) or _REC_DEFAULT_WATCHLIST
    except Exception:
        watchlist = _REC_DEFAULT_WATCHLIST

    results: dict = {}
    for t in watchlist:
        try:
            rec = await _build_rec(t)
            results[t] = rec.model_dump(mode="json")
        except Exception as exc:  # noqa: BLE001
            results[t] = {"error": str(exc)}
    return {"watchlist": watchlist, "results": results}


@app.get("/api/backtest/wheel")
def get_wheel_backtest():
    """Return the latest wheel backtest output produced by
    scripts/covered_call_backtest.py --strategy wheel. Re-read on every call so
    re-runs of the script update the page automatically. Adds a top-level
    `summary` block (totals across tickers) + `caveats` so consumers don't have
    to re-aggregate or re-explain the synthetic-IV limitation.
    """
    import json as _json
    from pathlib import Path as _Path
    candidate = _Path(__file__).resolve().parents[3] / "sweep-results" / "wheel_1y.json"
    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"No wheel backtest output at {candidate}")
    try:
        payload = _json.loads(candidate.read_text())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read wheel JSON: {exc}")

    # Aggregate totals across tickers — same numbers the frontend table renders.
    rows = list((payload.get("results") or {}).values())
    wheels = [r.get("wheel") for r in rows if isinstance(r, dict) and r.get("wheel")]
    total_csp_premium = sum(w.get("csp_premium_usd", 0.0) for w in wheels)
    total_cc_premium = sum(w.get("cc_premium_usd", 0.0) for w in wheels)
    total_realized = sum(w.get("realized_share_pnl_usd", 0.0) for w in wheels)
    total_unrealized = sum(w.get("unrealized_share_pnl_usd", 0.0) for w in wheels)
    total_return = sum(w.get("total_return_usd", 0.0) for w in wheels)
    total_max_capital = sum(w.get("max_capital_usd", 0.0) for w in wheels)
    total_csp_fires = sum(w.get("csp_fires", 0) for w in wheels)
    total_cc_fires = sum(w.get("cc_fires", 0) for w in wheels)
    total_trades = sum(int(r.get("trade_count", 0)) for r in rows if isinstance(r, dict))
    total_assignments = sum(int(r.get("exercised_count", 0)) for r in rows if isinstance(r, dict))
    final_inventory = {
        r["ticker"]: int(r.get("final_share_inventory", 0))
        for r in rows
        if isinstance(r, dict) and r.get("ticker")
    }
    weighted_return_pct = (total_return / total_max_capital * 100.0) if total_max_capital > 0 else 0.0

    payload["summary"] = {
        "ticker_count": len(rows),
        "total_csp_fires": total_csp_fires,
        "total_cc_fires": total_cc_fires,
        "total_trades": total_trades,
        "total_assignments": total_assignments,
        "total_premium_usd": round(total_csp_premium + total_cc_premium, 2),
        "total_csp_premium_usd": round(total_csp_premium, 2),
        "total_cc_premium_usd": round(total_cc_premium, 2),
        "total_realized_share_pnl_usd": round(total_realized, 2),
        "total_unrealized_share_pnl_usd": round(total_unrealized, 2),
        "total_return_usd": round(total_return, 2),
        "total_max_capital_usd": round(total_max_capital, 2),
        "weighted_return_pct_of_max_cap": round(weighted_return_pct, 2),
        "final_share_inventory": final_inventory,
    }

    payload.setdefault("caveats", []).extend([
        "Synthetic IV (rolling HV * (1 + |N(0.10, 0.15)|)) — modeled, not observed.",
        "Per-contract sizing (1 contract = 100 shares). Multiply by your contract count.",
        "Hold-to-expiry on both legs. CC entries are skipped if strike <= avg cost basis to avoid locking in a share-leg loss.",
        "max_capital is the per-ticker peak; consumers summing across tickers see worst-case simultaneous deployment.",
    ])

    return payload


@app.post("/api/webhooks/scan-now")
async def webhook_scan_now(authorization: str = Header(...)):
    """Manual trigger that runs the same dispatcher the cron runs.

    Auth: Authorization header must equal "Bearer <REMOTE_AGENT_WEBHOOK_TOKEN>".
    Useful for the remote agent to force-refresh, and for testing the wire.
    """
    cfg = _load_webhook_config()
    if cfg is None:
        raise HTTPException(status_code=503, detail="Webhook not configured (set REMOTE_AGENT_WEBHOOK_URL/TOKEN)")
    if authorization != f"Bearer {cfg.bearer_token}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    return await _scan_and_dispatch()


@app.get("/api/webhooks/config")
def webhook_config():
    """Diagnostic — return webhook config WITHOUT exposing the bearer token."""
    cfg = _load_webhook_config()
    if cfg is None:
        return {"configured": False}
    return {
        "configured": True,
        "remote_url": cfg.remote_url,
        "watchlist": cfg.watchlist,
        "only_actionable": cfg.only_actionable,
    }


# ---- Analytics report run endpoints ----------------------------------------

import json as _json
from datetime import timezone as _tz


@app.post("/api/analytics/runs", response_model=AnalyticsRunCreateResponse)
def create_analytics_run(req: AnalyticsRunCreateRequest):
    """Persist a completed 'Run all' analytics snapshot."""
    conn = rh_db.get_conn()
    created_at = datetime.now(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload_json = _json.dumps(req.payload, default=str)
    cur = conn.execute(
        """
        INSERT INTO analytics_report_run (created_at, account, ticker_count, payload_json, notes)
        VALUES (?, ?, ?, ?, ?)
        """,
        (created_at, req.account, req.ticker_count, payload_json, req.notes),
    )
    conn.commit()
    return AnalyticsRunCreateResponse(run_id=int(cur.lastrowid or 0), created_at=created_at)


@app.get("/api/analytics/runs", response_model=list[AnalyticsRunMeta])
def list_analytics_runs(limit: int = 50):
    """Return metadata for the most recent analytics runs (no payload)."""
    conn = rh_db.get_conn()
    rows = conn.execute(
        """
        SELECT run_id, created_at, account, ticker_count, notes
        FROM analytics_report_run
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [
        AnalyticsRunMeta(
            run_id=row["run_id"],
            created_at=row["created_at"],
            account=row["account"],
            ticker_count=row["ticker_count"],
            notes=row["notes"],
        )
        for row in rows
    ]


@app.get("/api/analytics/runs/{run_id}", response_model=AnalyticsRunFull)
def get_analytics_run(run_id: int):
    """Return the full analytics run row, with payload parsed back to JSON."""
    conn = rh_db.get_conn()
    row = conn.execute(
        "SELECT * FROM analytics_report_run WHERE run_id = ?", (run_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    try:
        payload = _json.loads(row["payload_json"])
    except Exception:
        payload = row["payload_json"]
    return AnalyticsRunFull(
        run_id=row["run_id"],
        created_at=row["created_at"],
        account=row["account"],
        ticker_count=row["ticker_count"],
        payload=payload,
        notes=row["notes"],
    )


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

import notifications as _notifications  # noqa: E402  -- import after FastAPI app is created


@app.get("/api/notifications")
def list_notifications():
    """Return undismissed alerts, newest first."""
    try:
        items = _notifications.list_active()
        return {"items": items, "count": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"List failed: {e}")


@app.post("/api/notifications/scan-now")
def scan_notifications(account: str = "all"):
    """Run all detectors against the live Robinhood book and persist new alerts."""
    try:
        return _notifications.scan_now(account=account)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scan failed: {e}")


@app.post("/api/notifications/{notification_id}/dismiss")
def dismiss_notification(notification_id: int):
    ok = _notifications.dismiss(notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found or already dismissed.")
    return {"id": notification_id, "dismissed": True}


@app.post("/api/notifications/dismiss-all")
def dismiss_all_notifications():
    from notifications import service as _svc  # type: ignore
    n = _svc.dismiss_all()
    return {"dismissed": n}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
