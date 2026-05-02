'use client';

import { useMemo, useState } from 'react';
import { GLOSSARY, type GlossaryCategory } from '@/lib/glossary';

// ── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  greeks: 'Greeks',
  risk: 'Risk',
  vol: 'Volatility',
  options: 'Options Basics',
  portfolio: 'Portfolio',
  strategy: 'Strategy',
  metrics: 'Metrics',
};

const CATEGORY_COLORS: Record<GlossaryCategory, { bg: string; color: string; border: string }> = {
  greeks:    { bg: 'rgba(157,122,255,0.10)', color: '#9d7aff', border: 'rgba(157,122,255,0.30)' },
  risk:      { bg: 'rgba(255,0,110,0.08)',   color: '#FF006E', border: 'rgba(255,0,110,0.30)'   },
  vol:       { bg: 'rgba(76,154,255,0.09)',  color: '#4c9aff', border: 'rgba(76,154,255,0.30)'  },
  options:   { bg: 'rgba(0,200,5,0.08)',     color: '#00C805', border: 'rgba(0,200,5,0.30)'     },
  portfolio: { bg: 'rgba(255,215,0,0.08)',   color: '#FFD700', border: 'rgba(255,215,0,0.30)'   },
  strategy:  { bg: 'rgba(255,140,0,0.09)',   color: '#ff8c00', border: 'rgba(255,140,0,0.30)'   },
  metrics:   { bg: 'rgba(163,163,168,0.08)', color: '#a3a3a8', border: 'rgba(163,163,168,0.25)' },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function GlossaryPage() {
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(GLOSSARY)
      .filter(([, e]) => {
        if (!q) return true;
        return (
          e.term.toLowerCase().includes(q) ||
          e.simple.toLowerCase().includes(q) ||
          e.detail.toLowerCase().includes(q)
        );
      })
      .sort(([, a], [, b]) => a.term.localeCompare(b.term));
  }, [query]);

  // Group by category (only populated groups)
  const byCategory = useMemo(() => {
    const map = new Map<GlossaryCategory, typeof entries>();
    for (const entry of entries) {
      const cat = entry[1].category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(entry);
    }
    // Sort categories by canonical order
    const order: GlossaryCategory[] = [
      'options', 'greeks', 'vol', 'risk', 'portfolio', 'strategy', 'metrics',
    ];
    return order
      .filter((c) => map.has(c))
      .map((c) => [c, map.get(c)!] as [GlossaryCategory, typeof entries]);
  }, [entries]);

  return (
    <div className="rv-content" style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 className="rv-h1" style={{ marginBottom: 4 }}>Glossary</h1>
        <p className="rv-sub" style={{ marginBottom: 16 }}>
          Plain-English definitions of every term used in this dashboard.
          Click &#9432; icons anywhere in the app to see these inline.
        </p>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: 420 }}>
          <input
            type="search"
            placeholder="Search terms…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              background: '#0c0d10',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '7px 12px',
              color: 'var(--ink)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--ink-mute)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {query && (
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute)' }}>
            {entries.length} result{entries.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
          </p>
        )}
      </div>

      {/* No results */}
      {entries.length === 0 && (
        <div className="rv-card" style={{ textAlign: 'center', padding: '32px 16px' }}>
          <p style={{ color: 'var(--ink-mute)', margin: 0 }}>
            No terms match &ldquo;{query}&rdquo;
          </p>
        </div>
      )}

      {/* Grouped sections */}
      {byCategory.map(([cat, catEntries]) => {
        const colors = CATEGORY_COLORS[cat];
        return (
          <section key={cat}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: '24px 0 10px',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: colors.color,
                }}
              >
                {CATEGORY_LABELS[cat]}
              </h2>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--ink-mute)',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {catEntries.length} term{catEntries.length === 1 ? '' : 's'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {catEntries.map(([slug, entry]) => (
                <div
                  key={slug}
                  id={slug}
                  className="rv-card"
                  style={{ margin: 0, scrollMarginTop: 70 }}
                >
                  {/* Card header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      marginBottom: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--ink)',
                        textTransform: 'none',
                        letterSpacing: 0,
                        fontFamily: 'inherit',
                      }}
                    >
                      {entry.term}
                    </h3>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: colors.color,
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 3,
                        padding: '1px 6px',
                      }}
                    >
                      {cat}
                    </span>
                  </div>

                  {/* Simple */}
                  <p
                    style={{
                      margin: '0 0 8px',
                      fontSize: 13,
                      lineHeight: '1.6',
                      color: 'var(--ink)',
                    }}
                  >
                    {entry.simple}
                  </p>

                  {/* Detail */}
                  <p
                    style={{
                      margin: '0 0 8px',
                      fontSize: 12,
                      lineHeight: '1.6',
                      color: 'var(--ink-dim)',
                    }}
                  >
                    {entry.detail}
                  </p>

                  {/* Formula */}
                  {entry.formula && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '6px 10px',
                        background: '#0c0d10',
                        border: '1px solid var(--line)',
                        borderRadius: 5,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: 'var(--gold, #FFD700)',
                      }}
                    >
                      {entry.formula}
                    </div>
                  )}

                  {/* Example */}
                  {entry.example && (
                    <p
                      style={{
                        margin: '8px 0 0',
                        fontSize: 11,
                        color: 'var(--ink-mute)',
                        fontStyle: 'italic',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      e.g. {entry.example}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <div style={{ height: 48 }} />
    </div>
  );
}
