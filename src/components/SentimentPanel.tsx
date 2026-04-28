'use client';

import { useState } from 'react';
import { PRICING_API_URL as API_URL } from '@/lib/pricing-api';

interface SentimentData {
  ticker: string;
  company: { name: string; sector: string; current_price: number };
  sentiment: {
    overall_sentiment: number;
    avg_dilution_risk: number;
    avg_guidance_change: number;
    avg_competitive_threats: number;
    article_count: number;
    bullish_count: number;
    bearish_count: number;
    neutral_count: number;
    per_article: Array<{ title: string; sentiment: number; dilution_risk: number }>;
  };
  bayesian_update: {
    prior_fair_value: number;
    posterior_fair_value: number;
    total_adjustment_pct: number;
    signal: string;
    breakdown: Record<string, number>;
  };
}

export default function SentimentPanel({ ticker }: { ticker: string }) {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchSentiment = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${API_URL}/api/sentiment/${ticker}`);
      if (!resp.ok) throw new Error('Failed to fetch sentiment');
      const result = await resp.json();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const sentimentColor = (val: number) => {
    if (val > 0.1) return 'text-[#00C805]';
    if (val < -0.1) return 'text-[#FF006E]';
    return 'text-gray-400';
  };

  const signalColor = (signal: string) => {
    if (signal.includes('BULLISH')) return 'text-[#00C805]';
    if (signal.includes('BEARISH')) return 'text-[#FF006E]';
    return 'text-[#FFD700]';
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold">NLP Sentiment Analysis</h3>
        <button
          onClick={fetchSentiment}
          disabled={loading}
          className="px-4 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : 'Analyze Sentiment'}
        </button>
      </div>

      {error && <p className="text-[#FF006E] mb-4">{error}</p>}

      {data && (
        <div className="space-y-4">
          {/* Bayesian Signal */}
          <div className="bg-[#1E1E1E] rounded-lg p-4">
            <h4 className="text-sm text-gray-400 mb-2">Bayesian Fair Value Update</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">Prior (Market)</p>
                <p className="text-lg font-bold">${data.bayesian_update.prior_fair_value.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Posterior (Adjusted)</p>
                <p className="text-lg font-bold text-[#FFD700]">
                  ${data.bayesian_update.posterior_fair_value.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Signal</p>
                <p className={`text-lg font-bold ${signalColor(data.bayesian_update.signal)}`}>
                  {data.bayesian_update.signal}
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-400 mt-2">
              Adjustment: {data.bayesian_update.total_adjustment_pct > 0 ? '+' : ''}
              {data.bayesian_update.total_adjustment_pct.toFixed(4)}%
            </p>
          </div>

          {/* Sentiment Metrics */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Overall Sentiment</p>
              <p className={`text-xl font-bold ${sentimentColor(data.sentiment.overall_sentiment)}`}>
                {data.sentiment.overall_sentiment > 0 ? '+' : ''}{data.sentiment.overall_sentiment.toFixed(3)}
              </p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Dilution Risk</p>
              <p className="text-xl font-bold text-[#FF006E]">{data.sentiment.avg_dilution_risk.toFixed(1)}%</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Guidance Change</p>
              <p className={`text-xl font-bold ${sentimentColor(data.sentiment.avg_guidance_change)}`}>
                {data.sentiment.avg_guidance_change > 0 ? '+' : ''}{data.sentiment.avg_guidance_change.toFixed(3)}
              </p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-3">
              <p className="text-xs text-gray-500">Competitive Threats</p>
              <p className="text-xl font-bold text-[#FFD700]">{data.sentiment.avg_competitive_threats.toFixed(1)}%</p>
            </div>
          </div>

          {/* Article Breakdown */}
          <div className="bg-[#1E1E1E] rounded-lg p-4">
            <div className="flex gap-4 mb-3">
              <span className="text-sm">Articles: {data.sentiment.article_count}</span>
              <span className="text-sm text-[#00C805]">Bullish: {data.sentiment.bullish_count}</span>
              <span className="text-sm text-[#FF006E]">Bearish: {data.sentiment.bearish_count}</span>
              <span className="text-sm text-gray-400">Neutral: {data.sentiment.neutral_count}</span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {data.sentiment.per_article.map((article, i) => (
                <div key={i} className="flex justify-between items-center text-sm border-b border-gray-700 pb-1">
                  <span className="text-gray-300 truncate mr-4" style={{ maxWidth: '70%' }}>
                    {article.title}
                  </span>
                  <span className={sentimentColor(article.sentiment)}>
                    {article.sentiment > 0 ? '+' : ''}{article.sentiment.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!data && !loading && (
        <p className="text-gray-500 text-sm">Click &quot;Analyze Sentiment&quot; to run NLP analysis on recent news for {ticker}</p>
      )}
    </div>
  );
}
