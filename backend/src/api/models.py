"""Pydantic models for API request/response validation"""

from pydantic import BaseModel, Field
from typing import Literal, Dict, List


class OptionParams(BaseModel):
    """Parameters for options pricing"""
    S: float = Field(..., gt=0, description="Spot price")
    K: float = Field(..., gt=0, description="Strike price")
    T: float = Field(..., gt=0, le=10, description="Time to expiration (years)")
    r: float = Field(..., ge=0, le=1, description="Risk-free rate")
    sigma: float = Field(..., gt=0, le=5, description="Volatility")
    option_type: Literal['call', 'put'] = Field(..., description="Option type")


class ImpliedVolParams(BaseModel):
    """Parameters for implied volatility calculation"""
    market_price: float = Field(..., gt=0, description="Observed market price")
    S: float = Field(..., gt=0, description="Spot price")
    K: float = Field(..., gt=0, description="Strike price")
    T: float = Field(..., gt=0, le=10, description="Time to expiration (years)")
    r: float = Field(..., ge=0, le=1, description="Risk-free rate")
    option_type: Literal['call', 'put'] = Field(..., description="Option type")


class PricingResponse(BaseModel):
    """Response from pricing calculation"""
    price: float
    parameters: OptionParams


class GreeksResponse(BaseModel):
    """Response from Greeks calculation"""
    price: float
    greeks: Dict[str, float]
    parameters: OptionParams


class ImpliedVolResponse(BaseModel):
    """Response from implied volatility calculation"""
    implied_volatility: float
    market_price: float
    parameters: ImpliedVolParams


class IVCompareResponse(BaseModel):
    """Response from IV solver comparison"""
    newton_raphson: Dict[str, float | int | bool | None]
    bisection: Dict[str, float | int | bool | None]


class VolSurfaceResponse(BaseModel):
    """Response from vol surface generation"""
    strikes: List[float]
    expirations: List[str]
    iv_matrix: List[List[float | None]]
    spot_price: float
    ticker: str


class HedgeForecastRequest(BaseModel):
    """Request for hedge stability forecast"""
    S: float = Field(..., gt=0)
    K: float = Field(..., gt=0)
    T: float = Field(..., gt=0, le=10)
    r: float = Field(..., ge=0, le=1)
    sigma: float = Field(..., gt=0, le=5)
    option_type: Literal['call', 'put'] = 'call'
    days: int = Field(30, ge=1, le=365)


class HedgeForecastResponse(BaseModel):
    """Response from hedge forecast"""
    delta_decay: Dict
    vol_shock: Dict
    rehedge: Dict


class RegimeResponse(BaseModel):
    """Response from HMM regime detection"""
    ticker: str
    regime: str
    probability: float
    regime_means: List[float]
    regime_vols: List[float]
    regime_probs: List[float]
    regime_labels: List[str]
    n_regimes: int
    lookback_days: int


class HVConfidenceResponse(BaseModel):
    """Response from HV confidence interval calculation"""
    ticker: str
    hv: float
    ci_lower: float
    ci_upper: float
    confidence: float
    parkinson_hv: float
    ci_width: float
    reliable: bool
    window: int


class StressTestRequest(BaseModel):
    """Request for stress testing"""
    positions: List[Dict] = Field(..., description="List of position dicts with S, K, T, r, sigma, option_type, qty")
    spot_shock_pct: float = Field(0.0, ge=-1.0, le=1.0)
    vol_shock_pct: float = Field(0.0, ge=-1.0, le=5.0)


class StressTestResponse(BaseModel):
    """Response from stress test"""
    positions: List[Dict]
    total_pnl: float
    total_attribution: Dict[str, float]
    spot_shock_pct: float
    vol_shock_pct: float


class PnLAttributionRequest(BaseModel):
    """Request for P&L attribution"""
    S: float = Field(..., gt=0)
    K: float = Field(..., gt=0)
    T: float = Field(..., gt=0, le=10)
    r: float = Field(..., ge=0, le=1)
    sigma: float = Field(..., gt=0, le=5)
    option_type: Literal['call', 'put'] = 'call'
    qty: int = Field(1, ge=-1000, le=1000)
    delta_S: float = Field(0.0)
    delta_sigma: float = Field(0.0)
    delta_t: float = Field(0.0, ge=0)


class PnLAttributionResponse(BaseModel):
    """Response from P&L attribution"""
    attribution: Dict[str, float]
    greeks: Dict[str, float]


class TCAResponse(BaseModel):
    """Response from TCA analysis"""
    ticker: str
    bid: float
    ask: float
    mid: float
    spread: float
    spread_pct: float
    slippage_estimate: float
    tca_per_contract: float
    iv: float
    hv: float
    edge_dollars: float
    edge_survives_tca: bool
    atm_strike: float
    expiration: str


# === Phase 2: NLP Pipeline Models ===

class SentimentRequest(BaseModel):
    """Request for NLP sentiment analysis"""
    ticker: str = Field(..., description="Stock ticker symbol")


# === Phase 3: Backtesting Models ===

class BacktestRequest(BaseModel):
    """Request for running a backtest"""
    ticker: str = Field(..., description="Stock ticker symbol")
    start_date: str = Field(..., description="Start date (YYYY-MM-DD)")
    end_date: str = Field(..., description="End date (YYYY-MM-DD)")
    initial_capital: float = Field(100000.0, gt=0)
    iv_hv_sell_threshold: float = Field(1.2, gt=0)
    iv_hv_buy_threshold: float = Field(0.8, gt=0)
    max_position_pct: float = Field(0.1, gt=0, le=1.0)
    stop_loss_pct: float = Field(0.05, gt=0, le=1.0)


# === Phase 5: Hedging Models ===

class HedgeRequest(BaseModel):
    """Request for hedge ratio calculation"""
    positions: List[Dict] = Field(..., description="List of position dicts with S, K, T, r, sigma, option_type, qty")
    target_delta: float = Field(0.0, description="Target portfolio delta")


class RebalanceTriggerRequest(BaseModel):
    """Request for checking rebalance triggers"""
    positions: List[Dict] = Field(...)
    delta_limit: float = Field(100.0, gt=0)
    gamma_limit: float = Field(50.0, gt=0)
    vega_limit: float = Field(500.0, gt=0)


# === Phase 5: EV Calculator Models ===

class EVRequest(BaseModel):
    """Request for Expected Value calculation"""
    S: float = Field(..., gt=0)
    K: float = Field(..., gt=0)
    T: float = Field(..., gt=0, le=10)
    r: float = Field(..., ge=0, le=1)
    sigma: float = Field(..., gt=0, le=5)
    option_type: Literal['call', 'put'] = 'call'
    premium: float = Field(None, gt=0)
    contracts: int = Field(1, ge=1, le=1000)
    direction: Literal['sell', 'buy'] = 'sell'


class EVScanRequest(BaseModel):
    """Request for EV opportunity scan"""
    S: float = Field(..., gt=0)
    T: float = Field(..., gt=0, le=10)
    r: float = Field(..., ge=0, le=1)
    sigma: float = Field(..., gt=0, le=5)
    strike_range_pct: float = Field(0.2, gt=0, le=0.5)
    num_strikes: int = Field(10, ge=3, le=50)
    min_ev_per_contract: float = Field(50.0)


# === Phase 6: Risk Management Models ===

class VaRRequest(BaseModel):
    """Request for VaR calculation"""
    ticker: str = Field(..., description="Stock ticker symbol")
    portfolio_value: float = Field(100000.0, gt=0)
    confidence: float = Field(0.95, ge=0.9, le=0.999)
    holding_period: int = Field(1, ge=1, le=30)
    method: Literal['historical', 'parametric', 'monte_carlo', 'all'] = 'all'


class RiskCheckRequest(BaseModel):
    """Request for position limits check"""
    portfolio_greeks: Dict[str, float] = Field(...)
    max_portfolio_delta: float = Field(10000.0, gt=0)
    max_portfolio_gamma: float = Field(500.0, gt=0)
    max_portfolio_vega: float = Field(10000.0, gt=0)


# === Phase 7: Execution Models ===

class OrderRequest(BaseModel):
    """Request for submitting an order"""
    symbol: str = Field(...)
    qty: int = Field(..., gt=0)
    side: Literal['buy', 'sell'] = Field(...)
    order_type: Literal['market', 'limit', 'stop', 'stop_limit'] = 'market'
    time_in_force: Literal['day', 'gtc', 'ioc'] = 'day'
    limit_price: float = Field(None, gt=0)
