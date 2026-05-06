'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getStatementInsights,
  type FinancialInsights,
  type StatementKind,
} from '@/lib/pricing-api';

/**
 * AI commentary card on top of a structured financial statement.
 *
 * This is distinct from EarningsAIPanel — that one summarises one filing's
 * narrative text. This component summarises the structured row × period grid
 * that the StatementPanel above it is rendering. The model only sees the
 * numbers, so its commentary is grounded in the table values rather than the
 * filing prose.
 *
 * Cached server-side by data hash, so subsequent visits load instantly until
 * the underlying values change (e.g. a 10-K/A restatement bumps the hash).
 */

type Subtab = 'summary' | 'trends' | 'json';

interface Props {
  ticker: string;
  statement: StatementKind;
  /** Match the period the parent StatementPanel is showing. v1 is annual-only;
   *  the component still accepts quarterly so a future period-toggle lift can
   *  pass it through. */
  period?: 'annual' | 'quarterly';
}

const TREND_LABELS: Array<{ key: keyof FinancialInsights['trends']; label: string }> = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'gross_profit', label: 'Gross Profit' },
  { key: 'operating', label: 'Operating' },
  { key: 'ebitda', label: 'EBITDA' },
  { key: 'net_income', label: 'Net Income' },
];

export function FinancialAIInsights({ ticker, statement, period = 'annual' }: Props) {
  const [data, setData] = useState<FinancialInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subtab, setSubtab] = useState<Subtab>('summary');

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const d = await getStatementInsights(ticker, statement, period, { force });
        setData(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [ticker, statement, period],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div className="rv-card" style={{ padding: 0, marginTop: 14, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
            AI Insights
          </h3>
          <span className="rv-sub" style={{ fontSize: 11 }}>
            Trend commentary on the table above · grounded in the numbers (no filing-text speculation)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Subtabs subtab={subtab} onChange={setSubtab} />
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 3,
              color: 'var(--ink-dim)',
              padding: '4px 10px',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            Regenerate
          </button>
        </div>
      </div>

      <div style={{ padding: 14, minHeight: 120 }}>
        {loading && (
          <div className="rv-sub" style={{ fontSize: 12 }}>
            Generating AI insights… (cached after first call; ~3-20s cold)
          </div>
        )}
        {error && !loading && (
          <div style={{ color: 'var(--pink)', fontSize: 12 }}>{error}</div>
        )}
        {data && !loading && subtab === 'summary' && <SummaryView data={data} />}
        {data && !loading && subtab === 'trends' && <TrendsView data={data} />}
        {data && !loading && subtab === 'json' && <JsonView data={data} />}
      </div>

      {data && (
        <div
          style={{
            padding: '6px 14px',
            borderTop: '1px solid var(--line)',
            fontSize: 10,
            color: 'var(--ink-mute)',
            fontFamily: "'JetBrains Mono', monospace",
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          <span>
            model: {data._model ?? '?'} · {data._elapsed_sec ?? '?'}s · hash {data._data_hash ?? '?'}
          </span>
          <span>{data._periods_covered?.length ?? 0} periods covered</span>
        </div>
      )}
    </div>
  );
}

function Subtabs({ subtab, onChange }: { subtab: Subtab; onChange: (s: Subtab) => void }) {
  const items: Array<{ key: Subtab; label: string }> = [
    { key: 'summary', label: 'Summary' },
    { key: 'trends', label: 'Trends' },
    { key: 'json', label: 'JSON' },
  ];
  return (
    <div
      style={{
        display: 'inline-flex',
        border: '1px solid var(--line)',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          style={{
            background: subtab === it.key ? 'var(--line)' : 'transparent',
            border: 0,
            color: subtab === it.key ? 'var(--ink)' : 'var(--ink-mute)',
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: 'pointer',
            fontWeight: subtab === it.key ? 600 : 400,
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function SummaryView({ data }: { data: FinancialInsights }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          color: 'var(--ink)',
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        {data.summary_bullets.map((b, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            {b}
          </li>
        ))}
      </ul>

      {data.data_quality_notes.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ink-mute)',
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Data quality notes
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              color: 'var(--ink-dim)',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {data.data_quality_notes.map((n, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.missing_periods.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ink-mute)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Missing periods
          </span>
          {data.missing_periods.map((p) => (
            <span
              key={p}
              style={{
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--gold)',
                border: '1px solid rgba(255,215,0,0.35)',
                background: 'rgba(255,215,0,0.08)',
                borderRadius: 3,
                padding: '2px 6px',
              }}
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendsView({ data }: { data: FinancialInsights }) {
  const filled = TREND_LABELS.filter(({ key }) => data.trends[key] != null);
  if (filled.length === 0) {
    return <div className="rv-sub" style={{ fontSize: 12 }}>No per-metric trends emitted for this statement.</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
      {filled.map(({ key, label }) => (
        <div
          key={key}
          style={{
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: 10,
            background: '#0d0e11',
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--ink-mute)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5 }}>
            {data.trends[key]}
          </div>
        </div>
      ))}
    </div>
  );
}

function JsonView({ data }: { data: FinancialInsights }) {
  // Strip the underscore-prefixed metadata fields for the user-facing JSON.
  const { summary_bullets, trends, data_quality_notes, missing_periods } = data;
  const clean = { summary_bullets, trends, data_quality_notes, missing_periods };
  return (
    <pre
      style={{
        margin: 0,
        background: '#0d0e11',
        border: '1px solid var(--line)',
        borderRadius: 4,
        padding: 12,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        color: 'var(--ink-dim)',
        overflowX: 'auto',
        lineHeight: 1.5,
      }}
    >
      {JSON.stringify(clean, null, 2)}
    </pre>
  );
}
