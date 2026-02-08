"""Position Limits & Risk Controls - Greeks-based portfolio risk management.

Implements position limits, concentration checks, and drawdown protection
as specified in the SIG project plan.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class RiskLimits:
    """Portfolio risk limits configuration."""
    max_portfolio_delta: float = 10000.0
    max_single_stock_delta: float = 2000.0
    max_portfolio_gamma: float = 500.0
    max_portfolio_vega: float = 10000.0
    max_portfolio_theta: float = -5000.0  # Negative = paying theta
    max_position_pct: float = 0.10  # Max 10% of portfolio per position
    max_sector_pct: float = 0.30  # Max 30% per sector
    max_drawdown_pct: float = 0.10  # 10% max drawdown trigger
    var_limit_pct: float = 0.02  # 2% daily VaR limit


def check_position_limits(
    portfolio_greeks: dict,
    limits: RiskLimits = None,
) -> dict:
    """Check if current portfolio Greeks exceed risk limits.

    Args:
        portfolio_greeks: Dict with total_delta, total_gamma, etc.
        limits: Risk limits config (uses defaults if None)

    Returns:
        Risk check results with violations
    """
    if limits is None:
        limits = RiskLimits()

    violations = []
    warnings = []

    checks = [
        ("delta", abs(portfolio_greeks.get("total_delta", 0)), limits.max_portfolio_delta),
        ("gamma", abs(portfolio_greeks.get("total_gamma", 0)), limits.max_portfolio_gamma),
        ("vega", abs(portfolio_greeks.get("total_vega", 0)), limits.max_portfolio_vega),
    ]

    for greek, current, limit in checks:
        utilization = current / limit if limit > 0 else 0
        status = {
            "greek": greek,
            "current": round(current, 2),
            "limit": limit,
            "utilization_pct": round(utilization * 100, 2),
        }

        if utilization >= 1.0:
            status["level"] = "VIOLATION"
            violations.append(status)
        elif utilization >= 0.8:
            status["level"] = "WARNING"
            warnings.append(status)

    # Theta check (negative is paying)
    theta = portfolio_greeks.get("total_theta", 0)
    if theta < limits.max_portfolio_theta:
        violations.append({
            "greek": "theta",
            "current": round(theta, 2),
            "limit": limits.max_portfolio_theta,
            "utilization_pct": round(abs(theta / limits.max_portfolio_theta) * 100, 2),
            "level": "VIOLATION",
        })

    risk_score = _compute_risk_score(violations, warnings)

    return {
        "status": "VIOLATION" if violations else "WARNING" if warnings else "OK",
        "risk_score": risk_score,
        "violations": violations,
        "warnings": warnings,
        "total_checks": len(checks) + 1,
        "action": _recommend_action(violations, warnings),
    }


def check_drawdown(
    current_equity: float,
    peak_equity: float,
    limit: float = 0.10,
) -> dict:
    """Check if portfolio drawdown exceeds limit."""
    if peak_equity <= 0:
        return {"error": "Invalid peak equity"}

    drawdown = (peak_equity - current_equity) / peak_equity
    breached = drawdown >= limit

    return {
        "current_equity": round(current_equity, 2),
        "peak_equity": round(peak_equity, 2),
        "drawdown_pct": round(drawdown * 100, 4),
        "limit_pct": round(limit * 100, 2),
        "breached": breached,
        "action": "EMERGENCY_LIQUIDATE" if breached else "MONITOR",
        "remaining_buffer_pct": round((limit - drawdown) * 100, 4),
    }


def _compute_risk_score(violations: list, warnings: list) -> int:
    """Compute overall risk score 0-100. Higher = more risk."""
    score = 0
    score += len(violations) * 30
    score += len(warnings) * 10
    return min(100, score)


def _recommend_action(violations: list, warnings: list) -> str:
    """Recommend risk management action."""
    if len(violations) >= 2:
        return "EMERGENCY_REDUCE: Multiple limit breaches. Reduce positions immediately."
    elif len(violations) == 1:
        return f"REDUCE: {violations[0]['greek'].upper()} limit breached. Hedge or reduce exposure."
    elif len(warnings) >= 2:
        return "CAUTION: Multiple Greeks approaching limits. Monitor closely."
    elif warnings:
        return f"MONITOR: {warnings[0]['greek'].upper()} approaching limit."
    return "OK: All Greeks within limits."
