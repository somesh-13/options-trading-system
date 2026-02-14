"""Keltner Channel + VegaEdge Strategy for Backtesting.

Combines Keltner Channel position detection with IV/HV volatility signals.
"""

from dataclasses import dataclass, field
from typing import Optional
import numpy as np
import pandas as pd

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from backtest.strategies import BaseStrategy, BarData, SignalResult


@dataclass
class KeltnerBarData(BarData):
    """Extended bar data with Keltner Channel indicators."""
    ema_20: float = 0.0
    atr_20: float = 0.0
    upper_band: float = 0.0
    lower_band: float = 0.0
    keltner_position: str = "MIDDLE"  # BOTTOM, TOP, MIDDLE


class KeltnerVegaEdgeStrategy(BaseStrategy):
    """
    Keltner Channel + VegaEdge combined strategy.
    
    Entry Rules:
    1. BUY LEAP: IV/HV < 0.8 AND price at Keltner BOTTOM
    2. SELL CSP: IV/HV > 1.3 AND price at Keltner BOTTOM
    3. SELL CALL: IV/HV > 1.3 AND price at Keltner TOP
    
    More selective than volatility-only approach.
    """
    
    name = "keltner_vegaedge"
    
    def entry_signal(self, bar: KeltnerBarData, config: dict) -> SignalResult:
        """Check for Keltner + IV/HV combined signals."""
        
        iv_hv = bar.iv_hv_ratio
        position = bar.keltner_position
        
        # Signal 1: BUY LEAP (cheap IV + at bottom)
        if iv_hv < 0.8 and position == "BOTTOM":
            return SignalResult(
                should_act=True,
                direction="BUY_CALL",
                reason=f"LEAP: IV/HV {iv_hv:.2f} < 0.8 + at Keltner BOTTOM",
                metadata={"keltner_position": position, "signal_type": "BUY_LEAP"}
            )
        
        # Signal 2: SELL CSP (IV spike + at bottom)
        if iv_hv > 1.3 and position == "BOTTOM":
            return SignalResult(
                should_act=True,
                direction="SELL_PUT",
                reason=f"CSP: IV/HV {iv_hv:.2f} > 1.3 + at Keltner BOTTOM",
                metadata={"keltner_position": position, "signal_type": "SELL_CSP"}
            )
        
        # Signal 3: SELL CALL (IV spike + at top)
        if iv_hv > 1.3 and position == "TOP":
            return SignalResult(
                should_act=True,
                direction="SELL_CALL",
                reason=f"CALL: IV/HV {iv_hv:.2f} > 1.3 + at Keltner TOP",
                metadata={"keltner_position": position, "signal_type": "SELL_CALL"}
            )
        
        return SignalResult(should_act=False)
    
    def exit_signal(self, bar: KeltnerBarData, position: dict, config: dict) -> SignalResult:
        """Exit logic for Keltner + VegaEdge positions."""
        
        days_held = position.get("days_held", 0)
        stop_loss = config.get("stop_loss_pct", 0.05)
        price_change_pct = (bar.spot - position["entry_spot"]) / position["entry_spot"]
        
        # Signal-specific exit logic
        signal_type = position.get("signal_type", "")
        
        # LEAPs: longer hold time (60 days)
        if signal_type == "BUY_LEAP":
            if days_held >= 60:
                return SignalResult(should_act=True, reason="leap_time_expiry")
            
            # Exit if IV normalizes (IV/HV > 1.0)
            if bar.iv_hv_ratio > 1.0:
                return SignalResult(should_act=True, reason="iv_normalized")
            
            # Stop loss (larger for LEAPs: 10%)
            if price_change_pct < -0.10:
                return SignalResult(should_act=True, reason="leap_stop_loss")
        
        # CSP/Calls: shorter hold (30 days)
        else:
            if days_held >= 30:
                return SignalResult(should_act=True, reason="premium_time_expiry")
            
            # Standard stop loss (5%)
            if position["direction"] == "SELL_CALL" and price_change_pct > stop_loss:
                return SignalResult(should_act=True, reason="stop_loss")
            if position["direction"] == "SELL_PUT" and price_change_pct < -stop_loss:
                return SignalResult(should_act=True, reason="stop_loss")
            
            # Exit if IV normalizes
            if position["direction"] == "SELL_CALL" and bar.iv_hv_ratio < 1.0:
                return SignalResult(should_act=True, reason="iv_normalized")
            if position["direction"] == "SELL_PUT" and bar.iv_hv_ratio < 1.0:
                return SignalResult(should_act=True, reason="iv_normalized")
        
        return SignalResult(should_act=False)


def calculate_keltner_channel(df: pd.DataFrame, ema_period: int = 20, atr_period: int = 20, multiplier: float = 2.0) -> pd.DataFrame:
    """
    Add Keltner Channel indicators to DataFrame.
    
    Args:
        df: DataFrame with 'high', 'low', 'close' columns
        ema_period: EMA period (default 20)
        atr_period: ATR period (default 20)
        multiplier: ATR multiplier for bands (default 2.0)
    
    Returns:
        DataFrame with added columns: ema_20, atr_20, upper_band, lower_band, keltner_position
    """
    
    # Calculate EMA
    df['ema_20'] = df['close'].ewm(span=ema_period, adjust=False).mean()
    
    # Calculate True Range
    df['prev_close'] = df['close'].shift(1)
    df['tr1'] = df['high'] - df['low']
    df['tr2'] = abs(df['high'] - df['prev_close'])
    df['tr3'] = abs(df['low'] - df['prev_close'])
    df['true_range'] = df[['tr1', 'tr2', 'tr3']].max(axis=1)
    
    # Calculate ATR
    df['atr_20'] = df['true_range'].ewm(span=atr_period, adjust=False).mean()
    
    # Calculate bands
    df['upper_band'] = df['ema_20'] + (multiplier * df['atr_20'])
    df['lower_band'] = df['ema_20'] - (multiplier * df['atr_20'])
    
    # Determine position (5% threshold)
    threshold = 0.05
    df['band_width'] = df['upper_band'] - df['lower_band']
    df['bottom_zone'] = df['lower_band'] + (df['band_width'] * threshold)
    df['top_zone'] = df['upper_band'] - (df['band_width'] * threshold)
    
    df['keltner_position'] = 'MIDDLE'
    df.loc[df['close'] <= df['bottom_zone'], 'keltner_position'] = 'BOTTOM'
    df.loc[df['close'] >= df['top_zone'], 'keltner_position'] = 'TOP'
    
    # Cleanup temp columns
    df.drop(['prev_close', 'tr1', 'tr2', 'tr3', 'true_range', 'band_width', 'bottom_zone', 'top_zone'], 
            axis=1, inplace=True)
    
    return df
