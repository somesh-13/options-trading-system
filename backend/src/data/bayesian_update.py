"""Bayesian Update Module - Adjusts fair value using NLP sentiment as information edge.

Implements: Posterior = Prior x (1 + sentiment * weight)
The prior comes from technical analysis (current price / vol metrics).
The likelihood comes from NLP sentiment scores.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class BayesianPrior:
    """Prior belief about fair value based on technical analysis."""
    fair_value: float
    confidence: float  # 0-1, how confident in the prior
    source: str  # e.g., "technical", "fundamental"


@dataclass
class BayesianLikelihood:
    """Likelihood from NLP sentiment as information edge."""
    sentiment: float  # -1 to +1
    dilution_risk: float  # 0-100
    guidance_change: float  # -1 to +1
    competitive_threats: float  # 0-100
    article_count: int  # more articles = higher weight


def compute_posterior(
    prior: BayesianPrior,
    likelihood: BayesianLikelihood,
    max_adjustment_pct: float = 0.05,
) -> dict:
    """Compute posterior fair value using Bayesian update.

    The adjustment is capped at max_adjustment_pct to prevent
    NLP signals from dominating the pricing decision.

    Args:
        prior: Prior fair value belief from technical analysis
        likelihood: NLP-derived sentiment factors
        max_adjustment_pct: Maximum adjustment cap (default 5%)

    Returns:
        Dict with posterior fair value and breakdown
    """
    # Confidence scaling: more articles → more weight
    article_weight = min(1.0, likelihood.article_count / 10.0)

    # Sentiment adjustment (primary factor)
    sentiment_adj = likelihood.sentiment * max_adjustment_pct * article_weight

    # Dilution risk adjustment (negative drag)
    dilution_adj = -(likelihood.dilution_risk / 100.0) * (max_adjustment_pct * 0.5)

    # Guidance change boost
    guidance_adj = likelihood.guidance_change * (max_adjustment_pct * 0.3)

    # Competitive threat drag
    threat_adj = -(likelihood.competitive_threats / 100.0) * (max_adjustment_pct * 0.2)

    # Combined adjustment, capped
    total_adj = sentiment_adj + dilution_adj + guidance_adj + threat_adj
    total_adj = max(-max_adjustment_pct, min(max_adjustment_pct, total_adj))

    # Prior confidence reduces the adjustment
    effective_adj = total_adj * (1.0 - prior.confidence * 0.5)

    posterior_value = prior.fair_value * (1.0 + effective_adj)

    return {
        "prior_fair_value": round(prior.fair_value, 4),
        "prior_confidence": round(prior.confidence, 4),
        "posterior_fair_value": round(posterior_value, 4),
        "total_adjustment_pct": round(effective_adj * 100, 4),
        "breakdown": {
            "sentiment_adj_pct": round(sentiment_adj * 100, 4),
            "dilution_adj_pct": round(dilution_adj * 100, 4),
            "guidance_adj_pct": round(guidance_adj * 100, 4),
            "threat_adj_pct": round(threat_adj * 100, 4),
        },
        "article_weight": round(article_weight, 4),
        "signal": _classify_signal(effective_adj),
    }


def _classify_signal(adj: float) -> str:
    """Classify the Bayesian adjustment into a trading signal."""
    if adj > 0.02:
        return "STRONG_BULLISH"
    elif adj > 0.005:
        return "BULLISH"
    elif adj < -0.02:
        return "STRONG_BEARISH"
    elif adj < -0.005:
        return "BEARISH"
    return "NEUTRAL"


def bayesian_update_for_ticker(
    spot_price: float,
    sentiment_data: dict,
    prior_confidence: float = 0.5,
) -> dict:
    """Convenience function: run Bayesian update for a ticker given its spot price and sentiment data.

    Args:
        spot_price: Current stock price (used as prior fair value)
        sentiment_data: Output from nlp_extractor.analyze_news_batch()
        prior_confidence: How confident we are in technical prior (0-1)
    """
    prior = BayesianPrior(
        fair_value=spot_price,
        confidence=prior_confidence,
        source="market_price",
    )

    likelihood = BayesianLikelihood(
        sentiment=sentiment_data.get("overall_sentiment", 0.0),
        dilution_risk=sentiment_data.get("avg_dilution_risk", 0.0),
        guidance_change=sentiment_data.get("avg_guidance_change", 0.0),
        competitive_threats=sentiment_data.get("avg_competitive_threats", 0.0),
        article_count=sentiment_data.get("article_count", 0),
    )

    return compute_posterior(prior, likelihood)
