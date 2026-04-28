"""FastAPI Routes for Options Pricing Engine"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import sys
from pathlib import Path
from typing import List, Optional

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
from data.fundamentals import get_ticker_fundamentals
from scanner.nl_parser import parse_nl_query
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
)

# Robinhood activity ingestion + portfolio derivation.
from robinhood import database as rh_db
from robinhood import portfolio as rh_portfolio

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

    # Robinhood activity table + idempotent ingest from `hood reports/`.
    try:
        rh_db.ensure_schema()
        from pathlib import Path as _Path
        import sys as _sys

        _scripts = _Path(__file__).parent.parent.parent / "scripts"
        if str(_scripts) not in _sys.path:
            _sys.path.insert(0, str(_scripts))
        from ingest_robinhood import ingest as _rh_ingest  # type: ignore

        reports = _Path(__file__).parent.parent.parent.parent / "hood reports"
        if reports.exists():
            _rh_ingest(reports)
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).warning("Robinhood ingest skipped: %s", exc)

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
    """Detect IV vs HV mispricing for any ticker."""
    try:
        return detect_mispricing(ticker.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mispricing detection failed: {str(e)}")


@app.get("/api/market/{ticker}/detail")
def get_ticker_detail_endpoint(ticker: str):
    """Rich ticker snapshot for the stock detail page."""
    try:
        return get_ticker_detail(ticker.upper())
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Detail fetch failed for {ticker}: {str(e)}")


@app.get("/api/market/{ticker}/fundamentals")
def get_ticker_fundamentals_endpoint(ticker: str):
    """Deep fundamentals (income stmt, cashflow, balance sheet) for the DCF page."""
    try:
        return get_ticker_fundamentals(ticker.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fundamentals fetch failed for {ticker}: {str(e)}")


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
    """Re-scan the `hood reports/` directory and upsert any new activity rows."""
    try:
        from pathlib import Path as _Path
        import sys as _sys

        _scripts = _Path(__file__).parent.parent.parent / "scripts"
        if str(_scripts) not in _sys.path:
            _sys.path.insert(0, str(_scripts))
        from ingest_robinhood import ingest as _rh_ingest, REPORTS_DIR  # type: ignore

        result = _rh_ingest(REPORTS_DIR)
        return RobinhoodIngestResponse(**result)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Ingest failed: {exc}")


@app.get("/api/robinhood/accounts", response_model=RobinhoodAccountsResponse)
def robinhood_accounts():
    """Distinct account tags present in the activity DB."""
    return RobinhoodAccountsResponse(accounts=rh_portfolio.list_accounts())


@app.get("/api/robinhood/holdings", response_model=RobinhoodHoldingsResponse)
def robinhood_holdings(live_prices: bool = True, account: Optional[str] = None):
    """Current Robinhood holdings derived from activity log.

    `account` may be `brokerage`, `roth_ira`, or `all` (default). Set
    `live_prices=false` to skip the yfinance enrichment (useful when the
    network is flaky; purely cost-basis view still works).
    """
    equities = rh_portfolio.compute_equity_holdings(account)
    if live_prices:
        equities = rh_portfolio.enrich_equity_with_prices(equities)
    options = rh_portfolio.compute_option_holdings(account)

    return RobinhoodHoldingsResponse(
        equities=[RobinhoodHolding(**e.__dict__) for e in equities],
        options=[RobinhoodOption(**o.__dict__) for o in options],
    )


@app.get("/api/robinhood/summary", response_model=RobinhoodSummary)
def robinhood_summary(live_prices: bool = True, account: Optional[str] = None):
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
