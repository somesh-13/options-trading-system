"""SentimentAgent — wraps the existing NLP + Bayesian pipeline."""

from __future__ import annotations

import asyncio

from agents.base import AgentSignal, AnalysisContext, BaseAgent
from data.bayesian_update import bayesian_update_for_ticker
from data.ir_scraper import aggregate_ir_data
from data.nlp_extractor import analyze_news_batch


class SentimentAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            agent_id="sentiment",
            name="SentimentAgent",
            domain="News + Bayesian",
            weight=0.15,
        )

    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        payload = await asyncio.to_thread(self._fetch, ticker)
        score: float = float(payload["sentiment"])
        momentum = payload["bullish"] - payload["bearish"]

        # Confidence rises with article volume; defaults low when we have no news.
        n = int(payload["article_count"])
        confidence = min(1.0, 0.3 + 0.07 * n)

        reasoning = (
            f"Sentiment {score:+.2f} over {n} articles "
            f"({payload['bullish']} bullish / {payload['bearish']} bearish). "
            f"Bayesian posterior adjust {payload['bayesian_adj_pct']:+.2f}%."
        )

        return self._signal(
            ticker=ticker,
            signal_type="SENTIMENT_SCORE",
            confidence=confidence,
            reasoning=reasoning,
            data_sources=["ir_scraper", "nlp_extractor", "bayesian_update"],
            metadata={
                "sentiment_score": score,
                "news_volume": n,
                "momentum": int(momentum),
                "bayesian_signal": payload["bayesian_signal"],
                "bayesian_adj_pct": payload["bayesian_adj_pct"],
            },
        )

    @staticmethod
    def _fetch(ticker: str) -> dict:
        ir = aggregate_ir_data(ticker.upper())
        news = ir.get("news", []) or []
        agg = analyze_news_batch(news)
        spot = float((ir.get("company") or {}).get("current_price") or 0.0)
        bayes = bayesian_update_for_ticker(spot_price=spot, sentiment_data=agg)
        return {
            "sentiment": agg["overall_sentiment"],
            "article_count": agg["article_count"],
            "bullish": agg["bullish_count"],
            "bearish": agg["bearish_count"],
            "bayesian_signal": bayes["signal"],
            "bayesian_adj_pct": bayes["total_adjustment_pct"],
        }
