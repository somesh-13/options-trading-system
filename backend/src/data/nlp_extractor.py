"""NLP Feature Extractor - Sentiment and alpha factor extraction from text.

Extracts structured sentiment signals from news articles and IR data.
Uses rule-based NLP for baseline, with hooks for Claude API integration.
Outputs standardized alpha factors for the Bayesian update module.
"""

import re
from typing import Optional


# Sentiment lexicons for financial text
BULLISH_WORDS = {
    "beat", "beats", "exceeded", "surpass", "surpassed", "outperform",
    "upgrade", "upgraded", "bullish", "growth", "profitable", "profit",
    "revenue growth", "strong", "positive", "raised", "raising", "buyback",
    "repurchase", "dividend", "expand", "expansion", "accelerate",
    "record", "all-time high", "momentum", "optimistic", "upside",
    "overweight", "buy", "outperform", "above consensus", "beat estimates",
}

BEARISH_WORDS = {
    "miss", "missed", "below", "decline", "declining", "downgrade",
    "downgraded", "bearish", "loss", "losses", "weak", "weakness",
    "negative", "cut", "cutting", "dilution", "dilutive", "offering",
    "secondary", "shelf", "concern", "risk", "lawsuit", "investigation",
    "recall", "shortage", "underperform", "sell", "underweight",
    "below consensus", "missed estimates", "warning", "restructuring",
}

DILUTION_WORDS = {
    "offering", "secondary offering", "shelf registration", "dilution",
    "dilutive", "share issuance", "stock offering", "equity raise",
    "convertible", "warrant", "at-the-market", "ATM offering",
}

GUIDANCE_POSITIVE = {
    "raised guidance", "increased outlook", "upward revision",
    "higher forecast", "above guidance", "beat guidance",
    "raised full-year", "increased expectations",
}

GUIDANCE_NEGATIVE = {
    "lowered guidance", "reduced outlook", "downward revision",
    "lower forecast", "below guidance", "missed guidance",
    "cut full-year", "reduced expectations", "withdrew guidance",
}


def _count_matches(text: str, word_set: set) -> int:
    """Count how many words/phrases from the set appear in text."""
    text_lower = text.lower()
    count = 0
    for word in word_set:
        if word in text_lower:
            count += 1
    return count


def extract_sentiment(text: str) -> float:
    """Extract sentiment score from text. Returns -1.0 to +1.0."""
    if not text:
        return 0.0

    bull_count = _count_matches(text, BULLISH_WORDS)
    bear_count = _count_matches(text, BEARISH_WORDS)
    total = bull_count + bear_count

    if total == 0:
        return 0.0

    raw = (bull_count - bear_count) / total
    return max(-1.0, min(1.0, raw))


def extract_dilution_risk(text: str) -> float:
    """Extract dilution risk score. Returns 0-100."""
    if not text:
        return 0.0

    matches = _count_matches(text, DILUTION_WORDS)
    # Scale: 0 matches = 0, 1 = 30, 2 = 55, 3+ = 75+
    if matches == 0:
        return 0.0
    score = min(100.0, 20.0 + matches * 25.0)
    return score


def extract_guidance_change(text: str) -> float:
    """Extract guidance change signal. Returns -1.0 to +1.0."""
    if not text:
        return 0.0

    pos = _count_matches(text, GUIDANCE_POSITIVE)
    neg = _count_matches(text, GUIDANCE_NEGATIVE)
    total = pos + neg

    if total == 0:
        return 0.0

    return max(-1.0, min(1.0, (pos - neg) / total))


def extract_competitive_threats(text: str) -> float:
    """Extract competitive threat level. Returns 0-100."""
    threat_words = {
        "competition", "competitor", "market share loss", "disruption",
        "new entrant", "price war", "margin pressure", "commoditization",
        "regulatory", "antitrust", "tariff", "ban", "restriction",
    }
    if not text:
        return 0.0

    matches = _count_matches(text, threat_words)
    if matches == 0:
        return 0.0
    return min(100.0, 15.0 + matches * 20.0)


def extract_all_factors(text: str) -> dict:
    """Extract all NLP alpha factors from text.

    Returns:
        Dict with sentiment, dilution_risk, guidance_change, competitive_threats
    """
    return {
        "sentiment": round(extract_sentiment(text), 4),
        "dilution_risk": round(extract_dilution_risk(text), 2),
        "guidance_change": round(extract_guidance_change(text), 4),
        "competitive_threats": round(extract_competitive_threats(text), 2),
    }


def analyze_news_batch(articles: list[dict]) -> dict:
    """Analyze a batch of news articles and aggregate sentiment.

    Args:
        articles: List of dicts with 'title' and optionally 'summary' keys.

    Returns:
        Aggregated sentiment analysis across all articles.
    """
    if not articles:
        return {
            "overall_sentiment": 0.0,
            "avg_dilution_risk": 0.0,
            "avg_guidance_change": 0.0,
            "avg_competitive_threats": 0.0,
            "article_count": 0,
            "bullish_count": 0,
            "bearish_count": 0,
            "neutral_count": 0,
            "per_article": [],
        }

    sentiments = []
    dilution_risks = []
    guidance_changes = []
    competitive_threats = []
    per_article = []
    bullish = bearish = neutral = 0

    for article in articles:
        text = article.get("title", "") + " " + article.get("summary", "")
        factors = extract_all_factors(text)
        sentiments.append(factors["sentiment"])
        dilution_risks.append(factors["dilution_risk"])
        guidance_changes.append(factors["guidance_change"])
        competitive_threats.append(factors["competitive_threats"])

        if factors["sentiment"] > 0.1:
            bullish += 1
        elif factors["sentiment"] < -0.1:
            bearish += 1
        else:
            neutral += 1

        per_article.append({
            "title": article.get("title", "")[:100],
            **factors,
        })

    n = len(sentiments)
    return {
        "overall_sentiment": round(sum(sentiments) / n, 4),
        "avg_dilution_risk": round(sum(dilution_risks) / n, 2),
        "avg_guidance_change": round(sum(guidance_changes) / n, 4),
        "avg_competitive_threats": round(sum(competitive_threats) / n, 2),
        "article_count": n,
        "bullish_count": bullish,
        "bearish_count": bearish,
        "neutral_count": neutral,
        "per_article": per_article,
    }
