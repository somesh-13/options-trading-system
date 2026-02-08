"""Engine configuration dataclass."""

from dataclasses import dataclass, field, asdict


@dataclass
class EngineConfig:
    """Runtime configuration for the mispricing engine."""
    enabled: bool = True
    dry_run: bool = False  # Live execution by default
    scan_interval_seconds: int = 300  # 5 minutes
    tickers: list = field(default_factory=lambda: ["CIFR"])

    # Mispricing thresholds
    iv_hv_sell_threshold: float = 1.3
    iv_hv_buy_threshold: float = 0.8
    min_ev_per_contract: float = 50.0

    # Position limits
    max_contracts_per_trade: int = 5
    max_total_contracts: int = 20
    max_daily_trades: int = 10
    max_daily_loss: float = 1000.0

    # Market hours (ET) — 9:30 to 16:00
    market_open_hour: int = 9
    market_open_minute: int = 30
    market_close_hour: int = 16
    market_close_minute: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    def update(self, **kwargs):
        for k, v in kwargs.items():
            if v is not None and hasattr(self, k):
                setattr(self, k, v)
