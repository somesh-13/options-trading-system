"""MispricingEngine — singleton asyncio background loop for automated trading."""

import asyncio
import traceback
from datetime import datetime, timezone
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from engine.config import EngineConfig
from engine.scanner import scan_ticker, check_risk_limits, is_market_hours
from execution.alpaca_client import submit_option_order, get_options_contracts
from journal.database import log_engine_event


class EngineState:
    STOPPED = "STOPPED"
    IDLE = "IDLE"
    SCANNING = "SCANNING"
    EVALUATING = "EVALUATING"
    EXECUTING = "EXECUTING"


_executor = ThreadPoolExecutor(max_workers=2)


class MispricingEngine:
    """Singleton engine for automated mispricing detection and execution."""

    _instance: Optional["MispricingEngine"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.config = EngineConfig()
        self.state = EngineState.STOPPED
        self._stop_event = asyncio.Event()
        self._task: Optional[asyncio.Task] = None

        # Stats
        self.stats = {
            "scans_completed": 0,
            "trades_executed": 0,
            "trades_skipped": 0,
            "errors": 0,
            "last_scan_time": None,
            "last_trade_time": None,
            "started_at": None,
            "stopped_at": None,
        }

    async def start(self):
        """Start the engine background loop."""
        if self.state != EngineState.STOPPED:
            return {"status": "already_running", "state": self.state}

        self._stop_event.clear()
        self.state = EngineState.IDLE
        self.stats["started_at"] = datetime.now(timezone.utc).isoformat()
        self.stats["stopped_at"] = None

        log_engine_event("start", details={"config": self.config.to_dict()})

        self._task = asyncio.create_task(self._run_loop())
        return {"status": "started", "state": self.state}

    async def stop(self):
        """Stop the engine gracefully."""
        if self.state == EngineState.STOPPED:
            return {"status": "already_stopped"}

        self._stop_event.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except asyncio.TimeoutError:
                self._task.cancel()

        self.state = EngineState.STOPPED
        self.stats["stopped_at"] = datetime.now(timezone.utc).isoformat()
        log_engine_event("stop", details={"stats": self.stats.copy()})
        return {"status": "stopped"}

    def status(self) -> dict:
        """Return current engine status."""
        return {
            "state": self.state,
            "config": self.config.to_dict(),
            "stats": self.stats.copy(),
        }

    def update_config(self, **kwargs):
        """Update engine config at runtime."""
        self.config.update(**kwargs)
        log_engine_event("config_update", details=kwargs)
        return self.config.to_dict()

    async def _run_loop(self):
        """Main scan loop."""
        while not self._stop_event.is_set():
            try:
                await self._scan_cycle()
            except Exception as e:
                self.stats["errors"] += 1
                log_engine_event("error", details={
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                })

            # Sleep with interruptible wait
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self.config.scan_interval_seconds,
                )
                break  # stop_event was set
            except asyncio.TimeoutError:
                pass  # Normal timeout, continue loop

        self.state = EngineState.STOPPED

    async def _scan_cycle(self):
        """Single scan iteration."""
        loop = asyncio.get_event_loop()

        # Check market hours
        in_market = await loop.run_in_executor(_executor, is_market_hours, self.config)
        if not in_market:
            self.state = EngineState.IDLE
            log_engine_event("skip", details={"reason": "outside_market_hours"})
            return

        # Scan each ticker
        for ticker in self.config.tickers:
            if self._stop_event.is_set():
                break

            self.state = EngineState.SCANNING
            log_engine_event("scan", ticker=ticker)

            # Run sync scanner in thread pool
            result = await loop.run_in_executor(
                _executor, scan_ticker, ticker, self.config,
            )
            self.stats["scans_completed"] += 1
            self.stats["last_scan_time"] = datetime.now(timezone.utc).isoformat()

            if result is None:
                log_engine_event("skip", ticker=ticker, details={"reason": "no_signal"})
                self.stats["trades_skipped"] += 1
                continue

            # Evaluate risk
            self.state = EngineState.EVALUATING
            risk_check = await loop.run_in_executor(
                _executor, check_risk_limits, self.config,
            )

            if not risk_check.get("allowed", False):
                log_engine_event("skip", ticker=ticker, details={
                    "reason": "risk_limit",
                    "risk_check": risk_check,
                    "signal": result["signal"],
                })
                self.stats["trades_skipped"] += 1
                continue

            # Execute trade
            self.state = EngineState.EXECUTING
            await self._execute_trade(ticker, result, risk_check)

        self.state = EngineState.IDLE

    async def _execute_trade(self, ticker: str, scan_result: dict, risk_check: dict):
        """Build and submit an options order based on scan results."""
        loop = asyncio.get_event_loop()
        opp = scan_result["opportunity"]
        mispricing = scan_result["mispricing"]

        side = "sell" if scan_result["signal"] == "SELL" else "buy"
        option_type = opp.get("option_type", "call")
        strike = opp.get("strike", mispricing.get("atm_strike"))
        expiration = mispricing.get("expiration", "")
        qty = min(
            self.config.max_contracts_per_trade,
            opp.get("contracts", 1),
        )
        limit_price = opp.get("premium") or mispricing.get("atm_call_price")

        # Build signal_data for journal
        signal_data = {
            "iv_hv_ratio": scan_result["iv_hv_ratio"],
            "signal": scan_result["signal"],
            "ev_per_contract": opp.get("ev_per_contract"),
            "strike": strike,
            "option_type": option_type,
            "spot_price": mispricing.get("spot_price"),
            "historical_vol": mispricing.get("historical_vol"),
            "implied_vol_atm": mispricing.get("implied_vol_atm"),
            "risk_check": risk_check,
        }

        # Try to find a real OCC symbol via Alpaca
        # Use a wide strike range to capture real standardized strikes,
        # then pick the contract closest to our theoretical strike.
        occ_symbol = None
        try:
            strike_tolerance = 5.0 if strike and strike < 50 else 10.0
            contracts_result = await loop.run_in_executor(
                _executor,
                lambda: get_options_contracts(
                    underlying_symbol=ticker,
                    expiration_date=expiration,
                    option_type=option_type,
                    strike_price_gte=strike - strike_tolerance if strike else None,
                    strike_price_lte=strike + strike_tolerance if strike else None,
                ),
            )
            contracts = contracts_result.get("option_contracts") or contracts_result.get("options_contracts") or []
            if contracts and strike:
                # Pick the contract with the closest strike to our theoretical value
                best_contract = min(
                    contracts,
                    key=lambda c: abs(float(c.get("strike_price", 0)) - strike),
                )
                occ_symbol = best_contract.get("symbol")
                # Update strike and limit_price to reflect the real contract
                real_strike = float(best_contract.get("strike_price", strike))
                signal_data["strike"] = real_strike
                signal_data["theoretical_strike"] = strike
            elif contracts:
                occ_symbol = contracts[0].get("symbol")
        except Exception:
            pass

        if not occ_symbol:
            log_engine_event("skip", ticker=ticker, details={
                "reason": "no_occ_symbol",
                "strike": strike,
                "expiration": expiration,
                "option_type": option_type,
            })
            self.stats["trades_skipped"] += 1
            return

        if self.config.dry_run:
            log_engine_event("execute", ticker=ticker, details={
                "dry_run": True,
                "occ_symbol": occ_symbol,
                "side": side,
                "qty": qty,
                "limit_price": limit_price,
                "signal_data": signal_data,
            })
            self.stats["trades_executed"] += 1
            return

        # Live execution
        order_result = await loop.run_in_executor(
            _executor,
            lambda: submit_option_order(
                symbol=occ_symbol,
                qty=qty,
                side=side,
                order_type="limit",
                limit_price=limit_price,
                signal_source="auto_engine",
                signal_data=signal_data,
            ),
        )

        trade_id = None
        if "error" not in order_result:
            self.stats["trades_executed"] += 1
            self.stats["last_trade_time"] = datetime.now(timezone.utc).isoformat()
        else:
            self.stats["errors"] += 1

        log_engine_event("execute", ticker=ticker, trade_id=trade_id, details={
            "occ_symbol": occ_symbol,
            "side": side,
            "qty": qty,
            "limit_price": limit_price,
            "order_result": order_result,
            "signal_data": signal_data,
        })


def get_engine() -> MispricingEngine:
    """Get or create the singleton engine instance."""
    return MispricingEngine()
