"""Pydantic models for API request/response validation"""

from pydantic import BaseModel, Field
from typing import Literal, Dict, List, Optional, Any


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


class MultiBacktestRequest(BaseModel):
    """Request for running a multi-strategy comparative backtest"""
    tickers: List[str] = Field(default=["CIFR", "MARA", "RIOT", "COIN", "SQ"])
    start_date: str = Field(default="2022-01-01")
    end_date: str = Field(default="2025-12-31")
    initial_capital: float = Field(100000.0, gt=0)
    strategies: List[str] = Field(default=["iv_hv_arbitrage", "ev_filtered", "mean_reversion"])
    iv_hv_sell_threshold: float = Field(1.15, gt=0)
    iv_hv_buy_threshold: float = Field(0.85, gt=0)
    ev_threshold: float = Field(25.0, ge=0)
    mean_reversion_z_entry: float = Field(1.0, gt=0)
    mean_reversion_z_exit: float = Field(0.3, ge=0)
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
    signal_source: str = Field("manual", description="Signal source: manual or auto_engine")
    signal_data: Optional[Dict[str, Any]] = Field(None, description="Signal metadata")


# === Options Trading Models ===

class OptionsOrderRequest(BaseModel):
    """Request for submitting an options order"""
    symbol: str = Field(..., description="OCC-format symbol e.g. CIFR260220C00016000")
    qty: int = Field(..., gt=0, description="Number of contracts")
    side: Literal['buy', 'sell'] = Field(...)
    order_type: Literal['market', 'limit'] = 'limit'
    limit_price: float = Field(None, gt=0)
    signal_source: str = Field("manual", description="Signal source: manual or auto_engine")
    signal_data: Optional[Dict[str, Any]] = Field(None, description="Signal metadata")


class ExerciseRequest(BaseModel):
    """Request for exercising an options position"""
    symbol_or_contract_id: str = Field(..., description="OCC symbol or Alpaca contract UUID")


# === Trade Journal Models ===

class TradeRecord(BaseModel):
    """Trade record from the journal"""
    id: int
    order_id: Optional[str] = None
    timestamp: str
    symbol: str
    asset_class: str
    side: str
    qty: int
    order_type: str
    limit_price: Optional[float] = None
    filled_price: Optional[float] = None
    filled_qty: Optional[int] = None
    status: str
    signal_source: str
    signal_data: Optional[Dict[str, Any]] = None
    related_trade_id: Optional[int] = None
    realized_pnl: Optional[float] = None
    notes: Optional[str] = None
    created_at: str
    updated_at: str


class PnLSummary(BaseModel):
    """Aggregate P&L summary"""
    total_trades: int
    winning_trades: int
    losing_trades: int
    breakeven_trades: int
    total_pnl: float
    avg_win: float
    avg_loss: float
    best_trade: float
    worst_trade: float
    win_rate: float
    profit_factor: Any  # Can be float or "inf"
    gross_profit: float
    gross_loss: float


# === Engine Config Models ===

# === Portfolio Monitoring Models ===

class PositionGreeksResponse(BaseModel):
    """Response from positions-with-greeks endpoint"""
    positions: List[Dict[str, Any]]
    portfolio_greeks: Dict[str, Any]
    position_count: int
    timestamp: str


class PortfolioSummaryResponse(BaseModel):
    """Response from portfolio summary endpoint"""
    account: Dict[str, Any]
    portfolio_greeks: Dict[str, Any]
    pnl_summary: Dict[str, Any]
    position_count: int
    timestamp: str


class EquityHistoryResponse(BaseModel):
    """Response from equity history endpoint"""
    equity: List[Optional[float]]
    timestamps: List[int]
    profit_loss: List[Optional[float]]
    profit_loss_pct: List[Optional[float]]
    base_value: float
    timeframe: str


class EngineConfigRequest(BaseModel):
    """Request for updating engine configuration"""
    enabled: Optional[bool] = None
    dry_run: Optional[bool] = None
    scan_interval_seconds: Optional[int] = Field(None, ge=30, le=3600)
    tickers: Optional[List[str]] = None
    iv_hv_sell_threshold: Optional[float] = Field(None, gt=0, le=5)
    iv_hv_buy_threshold: Optional[float] = Field(None, gt=0, le=5)
    min_ev_per_contract: Optional[float] = Field(None, ge=0)
    max_contracts_per_trade: Optional[int] = Field(None, ge=1, le=100)
    max_total_contracts: Optional[int] = Field(None, ge=1, le=500)
    max_daily_trades: Optional[int] = Field(None, ge=1, le=100)
    max_daily_loss: Optional[float] = Field(None, ge=0)


class RobinhoodHolding(BaseModel):
    symbol: str
    quantity: float
    avg_cost: float
    cost_basis: float
    realized_pnl: float
    account: str = "all"
    inferred_opening: bool = False
    current_price: Optional[float] = None
    market_value: Optional[float] = None
    unrealized_pnl: Optional[float] = None


class RobinhoodOption(BaseModel):
    underlying: str
    side: Literal["Call", "Put"]
    strike: float
    expiry: str
    position: Literal["long", "short"]
    quantity: float
    avg_cost: float
    cost_basis: float
    realized_pnl: float
    account: str = "all"
    market_value: Optional[float] = None
    unrealized_pnl: Optional[float] = None


class RobinhoodHoldingsResponse(BaseModel):
    equities: List[RobinhoodHolding]
    options: List[RobinhoodOption]


class RobinhoodSummary(BaseModel):
    cash_net_transfers: float           # ACH net (CSV only; 0 in live mode)
    dividends_ytd: float
    interest_ytd: float
    fees_ytd: float
    realized_pnl: float
    unrealized_pnl: float               # equity + option combined
    total_market_value: float           # equity market value only
    total_invested: float               # equity cost basis only
    unknown_basis_proceeds: float = 0.0
    cash_balance: float = 0.0          # current cash in account (live mode)
    option_market_value: float = 0.0   # sum of option leg market values
    option_cost_basis: float = 0.0     # gross option cost basis (always positive)
    nav: float = 0.0                   # equity_mv + option_mv + cash_balance


class RobinhoodActivityRow(BaseModel):
    activity_date: str
    process_date: Optional[str] = None
    settle_date: Optional[str] = None
    instrument: Optional[str] = None
    description: Optional[str] = None
    trans_code: str
    quantity: Optional[float] = None
    price: Optional[float] = None
    amount: Optional[float] = None


class RobinhoodIngestResponse(BaseModel):
    files_read: int
    total_rows: int
    inserted: int
    skipped: int
    backfilled: Optional[int] = 0
    accounts: Optional[Dict[str, str]] = None
    sofi: Optional[Dict[str, Any]] = None


class RobinhoodAccountsResponse(BaseModel):
    accounts: List[str]


class RobinhoodSyncResponse(BaseModel):
    """Response from POST /api/robinhood/sync."""
    ok: bool
    fetched_at: str
    account: Optional[str] = None
    equities_count: int = 0
    options_count: int = 0
    snapshot_id: Optional[int] = None
    stale: bool = False
    error: Optional[str] = None


class RobinhoodSyncStatus(BaseModel):
    """Response from GET /api/robinhood/sync/status."""
    has_snapshot: bool
    fetched_at: Optional[str] = None
    account: Optional[str] = None
    stale: bool = False
    error: Optional[str] = None
    configured: bool = False  # are RH credentials present in the env


# === Crypto Models ===

class CryptoHoldingResponse(BaseModel):
    """A single crypto position."""
    symbol: str
    quantity: float
    avg_cost: float
    cost_basis: float
    current_price: Optional[float] = None
    market_value: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    account: str = "crypto"


class CryptoQuoteResponse(BaseModel):
    """Mark price for a crypto symbol."""
    symbol: str
    mark_price: Optional[float] = None
    error: Optional[str] = None


# Hard cap: no single test order may exceed this notional in USD.
CRYPTO_ORDER_NOTIONAL_CAP_USD: float = 50.0

# Hard cap for equity orders: ~10 shares of a mid-priced stock at test time.
EQUITY_ORDER_NOTIONAL_CAP_USD: float = 200.0


class CryptoOrderRequest(BaseModel):
    """Request to place (or simulate) a crypto order via Robinhood.

    SAFETY:
      - dry_run MUST default to True.  When True the order is simulated only.
      - Live orders (dry_run=False) require confirm=True AND notional_usd <= $50.
    """
    symbol: str = Field(..., description="Crypto ticker, e.g. 'BTC'")
    side: Literal["buy", "sell"] = Field(..., description="buy or sell")
    notional_usd: float = Field(..., gt=0, description="Dollar amount to buy/sell")
    dry_run: bool = Field(True, description="When True, simulate only — do NOT touch real orders")
    confirm: bool = Field(False, description="Must be True for live orders (belt-and-braces)")


class CryptoOrderResponse(BaseModel):
    """Response from a crypto order attempt."""
    order_id: str
    symbol: str
    side: str
    notional_usd: float
    quantity: Optional[float] = None
    mark_price: Optional[float] = None
    dry_run: bool
    status: str
    message: Optional[str] = None


class EquityOrderRequest(BaseModel):
    """Request to place (or simulate) an equity (stock) order via Robinhood.

    SAFETY:
      - dry_run MUST default to True.  When True the order is simulated only.
      - Live orders (dry_run=False) require confirm=True.
      - Estimated notional (quantity × mark_price) must be <= EQUITY_ORDER_NOTIONAL_CAP_USD.
    """
    symbol: str = Field(..., description="Equity ticker, e.g. 'RDW'")
    side: Literal["buy", "sell"] = Field(..., description="buy or sell")
    quantity: float = Field(..., ge=0.000001, description="Number of shares (whole or fractional)")
    account: Literal["brokerage", "roth_ira"] = Field("brokerage", description="Target account")
    order_type: Literal["market", "limit"] = Field("market", description="market or limit")
    limit_price: Optional[float] = Field(None, description="Required when order_type='limit'")
    dry_run: bool = Field(True, description="When True, simulate only — do NOT place real orders")
    confirm: bool = Field(False, description="Must be True for live orders (belt-and-braces)")


class EquityOrderResponse(BaseModel):
    """Response from an equity order attempt."""
    order_id: str
    symbol: str
    side: str
    quantity: float
    account: str
    order_type: str
    limit_price: Optional[float] = None
    estimated_notional_usd: Optional[float] = None
    mark_price: Optional[float] = None
    dry_run: bool
    status: str
    message: Optional[str] = None


# === Analytics Report Run Models ===

class AnalyticsRunCreateRequest(BaseModel):
    """Request to persist a completed analytics run snapshot."""
    account: Optional[str] = None
    ticker_count: Optional[int] = None
    payload: Any = Field(..., description="Arbitrary JSON snapshot of the analytics state")
    notes: Optional[str] = None


class AnalyticsRunCreateResponse(BaseModel):
    """Minimal response after inserting a run."""
    run_id: int
    created_at: str


class AnalyticsRunMeta(BaseModel):
    """Metadata row returned by GET /api/analytics/runs (no payload)."""
    run_id: int
    created_at: str
    account: Optional[str] = None
    ticker_count: Optional[int] = None
    notes: Optional[str] = None


class AnalyticsRunFull(BaseModel):
    """Full row returned by GET /api/analytics/runs/{run_id}, including payload."""
    run_id: int
    created_at: str
    account: Optional[str] = None
    ticker_count: Optional[int] = None
    payload: Any
    notes: Optional[str] = None
