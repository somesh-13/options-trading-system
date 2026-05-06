'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getFilingAISummary,
  listSecFilings,
  type FilingAISummary,
  type SecFiling,
} from '@/lib/filing-ai-api';

/**
 * AI Filing summary panel.
 *
 * Lists recent SEC filings (10-K / 10-Q / 8-K) for a ticker. Filings with an
 * Exhibit 99.1 body are eligible for AI summarization — clicking the row
 * triggers a backend Gemini call (cached forever per accession, so the second
 * click is instant).
 *
 * The summary view has three sub-tabs:
 *   - Summary: 5–8 executive bullets + financial highlights + physical-AI entities
 *   - Structured: the full extracted JSON in a readable layout
 *   - Evidence: each bullet's verbatim source quote
 */

type Subtab = 'summary' | 'structured' | 'evidence';

interface Props {
  ticker: string;
}

export function EarningsAIPanel({ ticker }: Props) {
  const [filings, setFilings] = useState<SecFiling[] | null>(null);
  const [filingsErr, setFilingsErr] = useState<string | null>(null);
  const [selectedAccession, setSelectedAccession] = useState<string | null>(null);

  const [summary, setSummary] = useState<FilingAISummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [subtab, setSubtab] = useState<Subtab>('summary');

  // Initial filings list.
  useEffect(() => {
    let cancelled = false;
    setFilings(null);
    setFilingsErr(null);
    listSecFilings(ticker, 15)
      .then((d) => {
        if (cancelled) return;
        setFilings(d.filings);
        // Auto-select the first 8-K with a body — that's the most recent
        // earnings/material announcement worth summarising.
        const first = d.filings.find((f) => f.type === '8-K' && f.body_excerpt && f.accession);
        if (first?.accession) setSelectedAccession(first.accession);
      })
      .catch((e: Error) => {
        if (!cancelled) setFilingsErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const selectedFiling = useMemo(
    () => filings?.find((f) => f.accession === selectedAccession) ?? null,
    [filings, selectedAccession],
  );

  const loadSummary = useCallback(
    async (accession: string, force = false) => {
      setSummaryLoading(true);
      setSummaryErr(null);
      setSummary(null);
      try {
        const s = await getFilingAISummary(ticker, accession, { force });
        setSummary(s);
      } catch (e) {
        setSummaryErr(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setSummaryLoading(false);
      }
    },
    [ticker],
  );

  // Auto-load summary when the user picks a filing.
  useEffect(() => {
    if (!selectedAccession) return;
    loadSummary(selectedAccession);
  }, [selectedAccession, loadSummary]);

  const eligibleFilings = useMemo(
    () => (filings ?? []).filter((f) => f.accession && f.body_excerpt),
    [filings],
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14 }}>
      {/* Filing list */}
      <div className="rv-card" style={{ padding: 0, height: 'fit-content', maxHeight: 600, overflow: 'auto' }}>
        <div className="rv-card-head" style={{ padding: '8px 12px', marginBottom: 0, borderBottom: '1px solid var(--line)' }}>
          <h3 style={{ fontSize: 11, margin: 0 }}>RECENT FILINGS</h3>
        </div>
        {filingsErr && (
          <div style={{ padding: 12, color: 'var(--pink)', fontSize: 11 }}>{filingsErr}</div>
        )}
        {!filings && !filingsErr && (
          <div style={{ padding: 12, color: 'var(--ink-mute)', fontSize: 11 }}>Loading filings…</div>
        )}
        {filings && filings.length === 0 && (
          <div style={{ padding: 12, color: 'var(--ink-mute)', fontSize: 11 }}>No recent filings.</div>
        )}
        {filings && filings.map((f) => {
          const eligible = !!(f.accession && f.body_excerpt);
          const selected = f.accession === selectedAccession;
          return (
            <button
              key={f.accession ?? `${f.type}-${f.date}`}
              type="button"
              disabled={!eligible}
              onClick={() => f.accession && setSelectedAccession(f.accession)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: selected ? 'rgba(76,154,255,0.08)' : 'transparent',
                border: 0,
                borderBottom: '1px solid var(--line)',
                borderLeft: selected ? '2px solid var(--blue)' : '2px solid transparent',
                padding: '8px 12px',
                cursor: eligible ? 'pointer' : 'not-allowed',
                opacity: eligible ? 1 : 0.45,
                color: 'var(--ink)',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-mute)', marginBottom: 2 }}>
                <span>{f.type}</span>
                <span>{f.date}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.3 }}>
                {f.title}
              </div>
              {!eligible && (
                <div style={{ fontSize: 9, color: 'var(--ink-mute)', marginTop: 2, fontStyle: 'italic' }}>
                  no exhibit body
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Summary content */}
      <div className="rv-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>
              {selectedFiling
                ? `${selectedFiling.type} · ${selectedFiling.date}`
                : 'Select a filing'}
            </h3>
            <div className="rv-sub" style={{ fontSize: 11 }}>
              {selectedFiling
                ? selectedFiling.title
                : 'Pick one from the left to generate or load its AI summary.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Subtabs subtab={subtab} onChange={setSubtab} />
            {selectedAccession && (
              <button
                type="button"
                onClick={() => loadSummary(selectedAccession, true)}
                disabled={summaryLoading}
                title="Re-run the model on this filing"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  borderRadius: 3,
                  color: 'var(--ink-dim)',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: summaryLoading ? 'not-allowed' : 'pointer',
                  opacity: summaryLoading ? 0.5 : 1,
                }}
              >
                Regenerate
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: 14, minHeight: 320 }}>
          {!selectedAccession && (
            <div className="rv-sub" style={{ fontSize: 12 }}>No filing selected.</div>
          )}
          {summaryLoading && (
            <div className="rv-sub" style={{ fontSize: 12 }}>
              Generating AI summary… (Gemini Flash-Lite, ~3s)
            </div>
          )}
          {summaryErr && !summaryLoading && (
            <div style={{ color: 'var(--pink)', fontSize: 12 }}>{summaryErr}</div>
          )}
          {summary && !summaryLoading && subtab === 'summary' && (
            <SummaryView summary={summary} />
          )}
          {summary && !summaryLoading && subtab === 'structured' && (
            <StructuredView summary={summary} />
          )}
          {summary && !summaryLoading && subtab === 'evidence' && (
            <EvidenceView summary={summary} />
          )}
        </div>

        {summary && (
          <div
            style={{
              padding: '6px 14px',
              borderTop: '1px solid var(--line)',
              fontSize: 10,
              color: 'var(--ink-mute)',
              fontFamily: "'JetBrains Mono', monospace",
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>
              model: {summary._model ?? '?'} · generated {summary._elapsed_sec ?? '?'}s
            </span>
            <span>
              {eligibleFilings.length} filings eligible for AI summary
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Subtabs({ subtab, onChange }: { subtab: Subtab; onChange: (s: Subtab) => void }) {
  const items: Array<{ key: Subtab; label: string }> = [
    { key: 'summary', label: 'Summary' },
    { key: 'structured', label: 'Structured' },
    { key: 'evidence', label: 'Evidence' },
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

function SummaryView({ summary }: { summary: FilingAISummary }) {
  const finFields = Object.entries(summary.financial_highlights).filter(
    ([, v]) => v != null && String(v).trim() !== '',
  ) as Array<[string, string]>;
  const physical = summary.physical_ai;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section title="AI Summary">
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink)', fontSize: 13, lineHeight: 1.55 }}>
          {summary.summary_bullets.map((b, i) => (
            <li key={i} style={{ marginBottom: 6 }}>{b}</li>
          ))}
        </ul>
      </Section>

      {finFields.length > 0 && (
        <Section title="Financial Highlights">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {finFields.map(([k, v]) => (
              <KvPill key={k} label={k.replace(/_/g, ' ')} value={v} />
            ))}
          </div>
        </Section>
      )}

      {(physical.sites.length || physical.capacity_mw.length || physical.customers_or_partners.length || physical.build_phases.length) > 0 && (
        <Section title="Physical-AI / Infrastructure">
          {physical.sites.length > 0 && (
            <ListRow label="Sites" items={physical.sites} />
          )}
          {physical.capacity_mw.length > 0 && (
            <ListRow label="Capacity (MW)" items={physical.capacity_mw} />
          )}
          {physical.customers_or_partners.length > 0 && (
            <ListRow label="Customers / partners" items={physical.customers_or_partners} />
          )}
          {physical.build_phases.length > 0 && (
            <ListRow label="Build phases" items={physical.build_phases} />
          )}
        </Section>
      )}

      {summary.operational_highlights.length > 0 && (
        <Section title="Operational Highlights">
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-dim)', fontSize: 12, lineHeight: 1.5 }}>
            {summary.operational_highlights.map((b, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{b}</li>
            ))}
          </ul>
        </Section>
      )}

      {summary.risks.length > 0 && (
        <Section title="Risks">
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-dim)', fontSize: 12, lineHeight: 1.5 }}>
            {summary.risks.map((b, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{b}</li>
            ))}
          </ul>
        </Section>
      )}

      {summary.missing_fields.length > 0 && (
        <Section title="Not stated in this filing">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {summary.missing_fields.map((f) => (
              <span
                key={f}
                style={{
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: 'var(--ink-mute)',
                  border: '1px solid var(--line)',
                  borderRadius: 3,
                  padding: '2px 6px',
                }}
              >
                {f}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function StructuredView({ summary }: { summary: FilingAISummary }) {
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
      {JSON.stringify(
        {
          summary_bullets: summary.summary_bullets,
          financial_highlights: summary.financial_highlights,
          physical_ai: summary.physical_ai,
          operational_highlights: summary.operational_highlights,
          risks: summary.risks,
          missing_fields: summary.missing_fields,
        },
        null,
        2,
      )}
    </pre>
  );
}

function EvidenceView({ summary }: { summary: FilingAISummary }) {
  if (summary.evidence.length === 0) {
    return <div className="rv-sub" style={{ fontSize: 12 }}>No evidence quotes attached.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {summary.evidence.map((e, i) => (
        <div key={i} style={{ borderLeft: '2px solid var(--line)', paddingLeft: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>
            Bullet #{e.bullet_index + 1}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.55, fontStyle: 'italic' }}>
            “{e.quote}”
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
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
        {title}
      </div>
      {children}
    </div>
  );
}

function KvPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 4,
        padding: '6px 10px',
        background: '#0d0e11',
      }}
    >
      <div style={{ fontSize: 9, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink)', fontFamily: "'JetBrains Mono', monospace" }}>
        {value}
      </div>
    </div>
  );
}

function ListRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--ink-mute)', minWidth: 130, paddingTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((it, i) => (
          <span
            key={i}
            style={{
              fontSize: 11,
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: 3,
              padding: '2px 6px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
