/**
 * Client wrappers for the per-ticker Gemini chat endpoint.
 *
 * The chat endpoint lives under `/api/robinhood/analytics/ticker-chat`
 * because that prefix is already proxied through Next.js's rewrites
 * (see next.config.ts BACKEND_PROXY_PREFIXES). One-shot, non-streaming.
 */

import { PRICING_API_URL } from './pricing-api';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TickerChatResponse {
  reply: string;
  model: string;
  latency_ms: number;
  error?: string | null;
}

export async function sendTickerChat(
  ticker: string,
  message: string,
  history: ChatMessage[],
  account?: string,
): Promise<TickerChatResponse> {
  const res = await fetch(`${PRICING_API_URL}/api/robinhood/analytics/ticker-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticker: ticker.toUpperCase(),
      message,
      history,
      ...(account && account !== 'all' ? { account } : {}),
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
      else if (body?.error) detail = body.error;
    } catch {
      /* body was not JSON */
    }
    throw new Error(detail);
  }
  return (await res.json()) as TickerChatResponse;
}
