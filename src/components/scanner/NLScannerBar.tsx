'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface ScannerParseResult {
  tickers: string[];
  intent: string;
  conditions: string[];
  timeframe?: string;
  summary?: string;
  source?: 'gemini' | 'regex' | string;
}

interface NLScannerBarProps {
  onResult?: (result: ScannerParseResult) => void;
}

const EXAMPLES = [
  'Is CIFR overpriced vs its 30-day HV?',
  'Should I buy MARA today?',
  'Compare AAPL and MSFT volatility',
  'Show me stocks with ratio > 1.3',
];

export function NLScannerBar({ onResult }: NLScannerBarProps) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ScannerParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQuery = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scanner/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      if (!res.ok) throw new Error(`Parse failed: ${res.status}`);
      const body: ScannerParseResult = await res.json();
      setResult(body);
      onResult?.(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runQuery(query);
  };

  return (
    <div className="rv-card" style={{ marginTop: 0, marginBottom: 14 }}>
      <div className="rv-card-head">
        <h3>LLM SCANNER</h3>
        <span className="text-meta">
          {result?.source === 'gemini' ? 'GEMINI' : result?.source === 'regex' ? 'REGEX FALLBACK' : 'ASK IN PLAIN ENGLISH'}
        </span>
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#0c0d10',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '4px 10px',
          }}
        >
          <span style={{ color: 'var(--ink-mute)', fontSize: 13 }}>❯</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="LLM scanner — ask in plain English, e.g. 'Is CIFR overpriced today?'"
            style={{
              flex: 1,
              background: 'transparent',
              border: 0,
              outline: 'none',
              color: 'var(--ink)',
              fontSize: 13,
              fontFamily: 'inherit',
              padding: '6px 0',
            }}
            disabled={loading}
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          className="rv-btn primary"
          disabled={loading || !query.trim()}
          style={{ padding: '6px 16px', cursor: loading || !query.trim() ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Parsing…' : 'Submit'}
        </button>
      </form>

      {!result && !loading && !error && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { setQuery(ex); void runQuery(ex); }}
              className="rv-chip neutral"
              style={{ cursor: 'pointer', fontSize: 10.5, border: '1px solid var(--line)' }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--pink)',
            background: 'rgba(255,0,110,.08)',
            border: '1px solid rgba(255,0,110,.35)',
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <ResultCell label="TICKERS">
            {result.tickers.length === 0 ? (
              <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>—</span>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {result.tickers.map((t) => (
                  <Link
                    key={t}
                    href={`/stock/${t}`}
                    prefetch
                    className="rv-chip buy"
                    style={{ textDecoration: 'none', cursor: 'pointer', fontWeight: 700 }}
                  >
                    {t}
                  </Link>
                ))}
              </div>
            )}
          </ResultCell>

          <ResultCell label="INTENT">
            <span
              className="rv-chip"
              style={{
                color: 'var(--gold)',
                borderColor: 'rgba(255,215,0,.35)',
                background: 'rgba(255,215,0,.08)',
                fontSize: 10,
              }}
            >
              {result.intent.replace(/_/g, ' ')}
            </span>
          </ResultCell>

          <ResultCell label="CONDITIONS">
            {result.conditions.length === 0 ? (
              <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>—</span>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {result.conditions.map((c, i) => (
                  <span key={i} className="rv-chip neutral" style={{ fontSize: 10 }}>
                    {c}
                  </span>
                ))}
              </div>
            )}
          </ResultCell>

          <ResultCell label="TIMEFRAME">
            <span
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                color: result.timeframe ? 'var(--ink)' : 'var(--ink-mute)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {result.timeframe || '—'}
            </span>
          </ResultCell>
        </div>
      )}

      {result?.summary && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            borderRadius: 4,
            background: '#0c0d10',
            border: '1px solid var(--line-soft)',
            fontSize: 11.5,
            color: 'var(--ink-dim)',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          <span style={{ color: 'var(--ink-mute)' }}>summary:</span> {result.summary}
        </div>
      )}
    </div>
  );
}

function ResultCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#0c0d10',
        border: '1px solid var(--line)',
        borderRadius: 6,
        padding: '8px 10px',
      }}
    >
      <div className="text-meta" style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
