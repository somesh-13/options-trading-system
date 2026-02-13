"""Multi-Strategy Definitions for Backtesting.

Three strategies:
1. IVHVArbitrageStrategy - IV/HV ratio threshold trades (mirrors engine.py logic)
2. EVFilteredStrategy - IV/HV + EV per contract filter
3. MeanReversionStrategy - Z-score of IV/HV ratio mean reversion
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from strategy.ev_calculator import calculate_trade_ev


@dataclass
class BarData:
    """Single bar of prepared data for strategy consumption."""
    date: str
    spot: float
    hv: float
    iv: float
    iv_hv_ratio: float
    iv_hv_rolling_mean: float
    iv_hv_rolling_std: float


@dataclass
class SignalResult:
    """Result from a strategy signal check."""
    should_act: bool
    direction: str = ""       # "SELL_CALL" or "BUY_CALL"
    reason: str = ""
    metadata: dict = field(default_factory=dict)


class BaseStrategy(ABC):
    """Abstract base class for backtesting strategies."""

    name: str = "base"

    @abstractmethod
    def entry_signal(self, bar: BarData, config: dict) -> SignalResult:
        """Check if we should enter a trade on this bar."""
        ...

    @abstractmethod
    def exit_signal(self, bar: BarData, position: dict, config: dict) -> SignalResult:
        """Check if we should exit the current position."""
        ...


class IVHVArbitrageStrategy(BaseStrategy):
    """IV/HV ratio threshold strategy (same logic as engine.py)."""

    name = "iv_hv_arbitrage"

    def entry_signal(self, bar: BarData, config: dict) -> SignalResult:
        sell_thresh = config.get("iv_hv_sell_threshold", 1.15)
        buy_thresh = config.get("iv_hv_buy_threshold", 0.85)

        if bar.iv_hv_ratio > sell_thresh:
            return SignalResult(
                should_act=True,
                direction="SELL_CALL",
                reason=f"IV/HV {bar.iv_hv_ratio:.2f} > sell threshold {sell_thresh}",
            )
        elif bar.iv_hv_ratio < buy_thresh:
            return SignalResult(
                should_act=True,
                direction="BUY_CALL",
                reason=f"IV/HV {bar.iv_hv_ratio:.2f} < buy threshold {buy_thresh}",
            )
        return SignalResult(should_act=False)

    def exit_signal(self, bar: BarData, position: dict, config: dict) -> SignalResult:
        days_held = position.get("days_held", 0)
        stop_loss = config.get("stop_loss_pct", 0.05)
        price_change_pct = (bar.spot - position["entry_spot"]) / position["entry_spot"]

        # Time-based exit (30 days max hold)
        if days_held >= 30:
            return SignalResult(should_act=True, reason="time_expiry")

        # Stop loss
        if position["direction"] == "SELL_CALL" and price_change_pct > stop_loss:
            return SignalResult(should_act=True, reason="stop_loss")
        if position["direction"] == "BUY_CALL" and price_change_pct < -stop_loss:
            return SignalResult(should_act=True, reason="stop_loss")

        # IV normalization
        if position["direction"] == "SELL_CALL" and bar.iv_hv_ratio < 1.0:
            return SignalResult(should_act=True, reason="iv_normalized")
        if position["direction"] == "BUY_CALL" and bar.iv_hv_ratio > 1.0:
            return SignalResult(should_act=True, reason="iv_normalized")

        return SignalResult(should_act=False)


class EVFilteredStrategy(BaseStrategy):
    """IV/HV arbitrage with additional EV per-contract filter."""

    name = "ev_filtered"

    def entry_signal(self, bar: BarData, config: dict) -> SignalResult:
        sell_thresh = config.get("iv_hv_sell_threshold", 1.15)
        buy_thresh = config.get("iv_hv_buy_threshold", 0.85)
        ev_threshold = config.get("ev_threshold", 25.0)

        direction = ""
        if bar.iv_hv_ratio > sell_thresh:
            direction = "SELL_CALL"
        elif bar.iv_hv_ratio < buy_thresh:
            direction = "BUY_CALL"
        else:
            return SignalResult(should_act=False)

        # Calculate EV: use HV as "true" sigma, IV-based premium as market price.
        # This captures the vol arbitrage edge: selling at IV-premium vs HV risk.
        import numpy as np
        T = 30 / 365  # 30-day expiry
        r = config.get("risk_free_rate", 0.05)
        K = bar.spot  # ATM
        ev_dir = "sell" if direction == "SELL_CALL" else "buy"
        # Market premium priced at IV
        market_premium = bar.spot * bar.iv * np.sqrt(T) * 0.4

        try:
            ev_result = calculate_trade_ev(
                S=bar.spot, K=K, T=T, r=r, sigma=bar.hv,
                option_type="call", premium=market_premium,
                contracts=1, direction=ev_dir,
            )
            ev_per_contract = ev_result["ev_per_contract"]
        except Exception:
            ev_per_contract = 0.0

        if ev_per_contract >= ev_threshold:
            return SignalResult(
                should_act=True,
                direction=direction,
                reason=f"IV/HV {bar.iv_hv_ratio:.2f} + EV/contract ${ev_per_contract:.0f} >= ${ev_threshold:.0f}",
                metadata={"ev_per_contract": ev_per_contract},
            )

        return SignalResult(should_act=False, reason=f"EV ${ev_per_contract:.0f} below threshold ${ev_threshold:.0f}")

    def exit_signal(self, bar: BarData, position: dict, config: dict) -> SignalResult:
        # Same exit logic as IVHVArbitrage
        days_held = position.get("days_held", 0)
        stop_loss = config.get("stop_loss_pct", 0.05)
        price_change_pct = (bar.spot - position["entry_spot"]) / position["entry_spot"]

        if days_held >= 30:
            return SignalResult(should_act=True, reason="time_expiry")
        if position["direction"] == "SELL_CALL" and price_change_pct > stop_loss:
            return SignalResult(should_act=True, reason="stop_loss")
        if position["direction"] == "BUY_CALL" and price_change_pct < -stop_loss:
            return SignalResult(should_act=True, reason="stop_loss")
        if position["direction"] == "SELL_CALL" and bar.iv_hv_ratio < 1.0:
            return SignalResult(should_act=True, reason="iv_normalized")
        if position["direction"] == "BUY_CALL" and bar.iv_hv_ratio > 1.0:
            return SignalResult(should_act=True, reason="iv_normalized")

        return SignalResult(should_act=False)


class MeanReversionStrategy(BaseStrategy):
    """Mean reversion on the IV/HV ratio z-score."""

    name = "mean_reversion"

    def entry_signal(self, bar: BarData, config: dict) -> SignalResult:
        z_entry = config.get("mean_reversion_z_entry", 1.0)

        if bar.iv_hv_rolling_std == 0:
            return SignalResult(should_act=False)

        z_score = (bar.iv_hv_ratio - bar.iv_hv_rolling_mean) / bar.iv_hv_rolling_std

        if z_score > z_entry:
            # IV/HV ratio is high relative to recent mean -> sell vol
            return SignalResult(
                should_act=True,
                direction="SELL_CALL",
                reason=f"Z-score {z_score:.2f} > {z_entry} (mean reversion sell)",
                metadata={"z_score": round(z_score, 4)},
            )
        elif z_score < -z_entry:
            # IV/HV ratio is low relative to recent mean -> buy vol
            return SignalResult(
                should_act=True,
                direction="BUY_CALL",
                reason=f"Z-score {z_score:.2f} < -{z_entry} (mean reversion buy)",
                metadata={"z_score": round(z_score, 4)},
            )

        return SignalResult(should_act=False)

    def exit_signal(self, bar: BarData, position: dict, config: dict) -> SignalResult:
        z_exit = config.get("mean_reversion_z_exit", 0.3)
        stop_loss = config.get("stop_loss_pct", 0.05)
        days_held = position.get("days_held", 0)
        price_change_pct = (bar.spot - position["entry_spot"]) / position["entry_spot"]

        # 20-day time limit for mean reversion
        if days_held >= 20:
            return SignalResult(should_act=True, reason="time_expiry")

        # Stop loss
        if position["direction"] == "SELL_CALL" and price_change_pct > stop_loss:
            return SignalResult(should_act=True, reason="stop_loss")
        if position["direction"] == "BUY_CALL" and price_change_pct < -stop_loss:
            return SignalResult(should_act=True, reason="stop_loss")

        # Z-score reverted to near mean
        if bar.iv_hv_rolling_std > 0:
            z_score = (bar.iv_hv_ratio - bar.iv_hv_rolling_mean) / bar.iv_hv_rolling_std
            if abs(z_score) < z_exit:
                return SignalResult(should_act=True, reason="z_score_reverted",
                                   metadata={"z_score": round(z_score, 4)})

        return SignalResult(should_act=False)


STRATEGY_MAP = {
    "iv_hv_arbitrage": IVHVArbitrageStrategy,
    "ev_filtered": EVFilteredStrategy,
    "mean_reversion": MeanReversionStrategy,
}
