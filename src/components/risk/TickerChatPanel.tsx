'use client';

import { useEffect, useRef, useState } from 'react';
import { sendTickerChat, type ChatMessage } from '@/lib/ai-api';

interface Props {
  ticker: string;
}

const SUGGESTIONS = [
  'When does my LEAP spread go in loss?',
  'What is my net delta and is it bullish?',
  'Which legs are most exposed if the stock drops 10%?',
  'Summarize my recent trades.',
];

export function TickerChatPanel({ ticker }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset chat when ticker changes — chat is ticker-scoped.
  useEffect(() => {
    setMessages([]);
    setInput('');
    setError(null);
    setModel(null);
  }, [ticker]);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const historyForApi = messages;
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setPending(true);
    try {
      const res = await sendTickerChat(ticker, trimmed, historyForApi, 'all');
      if (res.error) {
        setError(res.error);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
        setModel(res.model);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rv-card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
      <div className="rv-card-head">
        <h3>Ask Gemini about {ticker}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {model && <span className="rv-sub" style={{ fontSize: 10 }}>{model}</span>}
          {messages.length > 0 && (
            <button
              type="button"
              className="rv-btn ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              disabled={pending}
            >
              clear
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          marginTop: 8,
          minHeight: 120,
          maxHeight: 400,
          overflowY: 'auto',
          padding: '8px 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && !pending && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--ink-mute, #888)', fontSize: 12 }}>
              Grounded in your live {ticker} positions. Try:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rv-chip"
                  style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              background:
                m.role === 'user'
                  ? 'rgba(0,200,5,0.12)'
                  : 'rgba(255,255,255,0.05)',
              border:
                m.role === 'user'
                  ? '1px solid rgba(0,200,5,0.35)'
                  : '1px solid rgba(255,255,255,0.08)',
              color: 'var(--ink, #fff)',
            }}
          >
            {m.content}
          </div>
        ))}

        {pending && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--ink-mute, #888)',
            }}
          >
            thinking…
          </div>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--pink, #FF006E)', fontSize: 12, padding: '4px 0' }}>
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        style={{ display: 'flex', gap: 8, marginTop: 8 }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${ticker}…`}
          aria-label={`Message about ${ticker}`}
          disabled={pending}
          className="bg-[#2D2D2D] text-white px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00C805]"
          style={{ flex: 1, fontSize: 13 }}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="px-4 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors disabled:opacity-50"
          style={{ fontSize: 13 }}
        >
          send
        </button>
      </form>
    </div>
  );
}
