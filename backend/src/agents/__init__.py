"""VegaEdge multi-agent orchestration layer.

Six specialized agents (Volatility, Technical, Sentiment, Earnings, Regime, Macro)
produce typed AgentSignal objects. The ConfluenceEngine runs them in parallel and
recommends a trade only when weighted consensus reaches threshold (default 0.65).
"""

from agents.base import BaseAgent, AgentSignal, AnalysisContext

__all__ = ["BaseAgent", "AgentSignal", "AnalysisContext"]
