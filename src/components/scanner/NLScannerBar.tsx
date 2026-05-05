'use client';

import { useState } from 'react';

export interface ScannerParseResult {
  tickers: string[];
  intent: string;
  conditions: string[];
  timeframe?: string;
  summary?: string;
  source?: 'gemini' | 'regex' | string;
}

// Emitted on a successful Submit. The combined query is the joined staged
// conditions + the input field at submit time, separated by " AND ". Parent
// uses this to persist a custom scanner tab in FilterChips.
export interface ScannerSubmitPayload {
  query: string; // combined query text
  result: ScannerParseResult;
}

interface NLScannerBarProps {
  onResult?: (result: ScannerParseResult) => void;
  onSubmitted?: (payload: ScannerSubmitPayload) => void;
}

const EXAMPLES = [
  'Is CIFR overpriced vs its 30-day HV?',
  'Should I buy MARA today?',
  'Compare AAPL and MSFT volatility',
  'Show me stocks with ratio > 1.3',
];

const COMBINE_SEPARATOR = ' AND ';

function combineConditions(staged: string[], current: string): string {
  return [...staged, current].map((s) => s.trim()).filter(Boolean).join(COMBINE_SEPARATOR);
}

export function NLScannerBar({ onResult, onSubmitted }: NLScannerBarProps) {
  const [query, setQuery] = useState('');
  const [staged, setStaged] = useState<string[]>([]);
  const [result, setResult] = useState<ScannerParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const combinedPreview = combineConditions(staged, query);
  const canSubmit = !loading && combinedPreview.length > 0;
  const canAddCondition = !loading && trimmedQuery.length > 0 && !staged.includes(trimmedQuery);

  const addCondition = () => {
    if (!canAddCondition) return;
    setStaged((prev) => [...prev, trimmedQuery]);
    setQuery('');
  };

  const removeCondition = (idx: number) => {
    setStaged((prev) => prev.filter((_, i) => i !== idx));
  };

  const runQuery = async (text: string, opts: { staged?: string[] } = {}): Promise<ScannerParseResult | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;
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
      return body;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResult(null);
      return null;
    } finally {
      setLoading(false);
      // Clear staged conditions only after the full submit pipeline completes.
      if (opts.staged) {
        setStaged([]);
        setQuery('');
      }
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const combined = combineConditions(staged, query);
    if (!combined) return;
    const stagedSnapshot = [...staged];
    const parsed = await runQuery(combined, { staged: stagedSnapshot });
    if (parsed) {
      onSubmitted?.({ query: combined, result: parsed });
    }
  };

  // Click an example chip → run it as a one-off (does not stage).
  const runExample = async (ex: string) => {
    setQuery(ex);
    await runQuery(ex);
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
            onKeyDown={(e) => {
              // "+" stages the condition without losing the keyboard flow.
              if ((e.key === '+' && e.shiftKey) || (e.key === 'Enter' && e.shiftKey)) {
                e.preventDefault();
                addCondition();
              }
            }}
            placeholder={
              staged.length > 0
                ? 'Add another condition (or Submit to combine)…'
                : "LLM scanner — ask in plain English, e.g. 'Is CIFR overpriced today?'"
            }
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
          disabled={!canSubmit}
          title={
            staged.length > 0
              ? `Combine ${staged.length + (trimmedQuery ? 1 : 0)} condition${staged.length + (trimmedQuery ? 1 : 0) === 1 ? '' : 's'} and run`
              : 'Run query'
          }
          style={{ padding: '6px 16px', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
        >
          {loading ? 'Parsing…' : 'Submit'}
        </button>
        <button
          type="button"
          onClick={addCondition}
          disabled={!canAddCondition}
          className="rv-btn"
          title={
            !trimmedQuery
              ? 'Type a condition first'
              : staged.includes(trimmedQuery)
                ? 'This condition is already staged'
                : 'Stage this condition; Submit will combine all staged conditions'
          }
          style={{
            padding: '6px 12px',
            cursor: canAddCondition ? 'pointer' : 'not-allowed',
          }}
          data-testid="nl-scanner-add-condition"
          aria-label="Stage condition"
        >
          + Add
        </button>
      </form>

      {staged.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="text-meta" style={{ marginBottom: 4 }}>
            STAGED · {staged.length} · joined with &quot;{COMBINE_SEPARATOR.trim()}&quot; on Submit
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {staged.map((cond, i) => (
              <span
                key={`${i}-${cond}`}
                className="rv-chip"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10.5,
                  padding: '2px 4px 2px 8px',
                  border: '1px solid var(--gold-dim, rgba(255,215,0,.35))',
                  background: 'rgba(255,215,0,.08)',
                  color: 'var(--gold)',
                }}
              >
                <span title={cond}>{cond}</span>
                <button
                  type="button"
                  onClick={() => removeCondition(i)}
                  aria-label={`Remove staged condition "${cond}"`}
                  title="Remove this condition"
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--ink-mute)',
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                    padding: '2px 4px',
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && staged.length === 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { void runExample(ex); }}
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
