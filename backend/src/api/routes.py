"""FastAPI Routes for Options Pricing Engine"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from pricing.black_scholes import black_scholes
from pricing.greeks import calculate_greeks
from pricing.implied_vol import implied_volatility
from pricing.second_order_greeks import calculate_all_second_order_greeks
from data.cifr_data import detect_mispricing_cifr, get_cifr_price, get_historical_volatility
from pricing.implied_vol import implied_volatility_compare
from pricing.vol_surface import generate_vol_surface
from pricing.hedge_stability import forecast_delta_decay, forecast_vol_shock, rehedge_recommendation
from pricing.pnl_attribution import greeks_pnl_attribution, stress_test_position, stress_test_portfolio
from data.market_data import get_ticker_price, detect_mispricing, get_tca_data
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
)

# Phase 2: NLP Pipeline
from data.ir_scraper import aggregate_ir_data
from data.nlp_extractor import analyze_news_batch
from data.bayesian_update import bayesian_update_for_ticker

# Phase 3: Backtesting
from backtest.engine import run_backtest, BacktestConfig

# Phase 5: Hedging & EV
from strategy.hedging import compute_hedge_ratio, check_rebalance_triggers, optimal_rebalance_schedule
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

# Add CORS middleware for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/market/{ticker}/mispricing")
def get_ticker_mispricing(ticker: str):
    """Detect IV vs HV mispricing for any ticker."""
    try:
        return detect_mispricing(ticker.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mispricing detection failed: {str(e)}")


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
