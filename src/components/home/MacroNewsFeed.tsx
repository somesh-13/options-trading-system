'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getMacroNews,
  type MacroNewsArticle,
  type MacroNewsCategory,
  type MacroNewsResponse,
} from '@/lib/macro-news-api';

const REFRESH_MS = 5 * 60 * 1000;

type FilterKey = MacroNewsCategory | 'all';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'conflict', label: 'Conflict' },
  { key: 'health', label: 'Health' },
  { key: 'economy', label: 'Economy' },
  { key: 'politics', label: 'Politics' },
];

const CAT_COLORS: Record<string, { fg: string; bg: string }> = {
  conflict: { fg: '#FF006E', bg: 'rgba(255,0,110,0.10)' },
  health: { fg: '#FFD700', bg: 'rgba(255,215,0,0.10)' },
  economy: { fg: '#00C805', bg: 'rgba(0,200,5,0.10)' },
  politics: { fg: '#7AB8FF', bg: 'rgba(122,184,255,0.10)' },
};

function relativeAgo(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const chipBtnStyle: React.CSSProperties = {
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'inherit',
};

export function MacroNewsFeed() {
  const [data, setData] = useState<MacroNewsResponse | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await getMacroNews({ limit: 40 });
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => {
    const arts = data?.articles ?? [];
    if (filter === 'all') return arts;
    return arts.filter((a) => a.category === filter);
  }, [data, filter]);

  return (
    <div className="rv-card" style={{ marginTop: 14 }}>
      <div className="rv-card-head">
        <h3>Macro news — world affairs, conflict, health, economy</h3>
        <div className="tools" role="tablist" aria-label="News category filter">
          {FILTERS.map((c) => {
            const count =
              c.key === 'all'
                ? data?.articles.length ?? 0
                : data?.by_category?.[c.key] ?? 0;
            return (
              <button
                type="button"
                key={c.key}
                role="tab"
                aria-selected={filter === c.key}
                className={filter === c.key ? 'on' : ''}
                style={chipBtnStyle}
                onClick={() => setFilter(c.key)}
              >
                {c.label}
                {count ? ` ${count}` : ''}
              </button>
            );
          })}
        </div>
      </div>
      {err && (
        <div style={{ padding: '8px 14px', color: 'var(--pink)', fontSize: 12 }}>
          Failed to load news: {err}{' '}
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11, marginLeft: 6 }}
            onClick={load}
          >
            Retry
          </button>
        </div>
      )}
      {loading && !data && (
        <div style={{ padding: '12px 14px', color: 'var(--ink-mute)', fontSize: 12 }}>
          loading global headlines…
        </div>
      )}
      {data && visible.length === 0 && !loading && (
        <div style={{ padding: '12px 14px', color: 'var(--ink-mute)', fontSize: 12 }}>
          No headlines in this category right now.
        </div>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visible.map((a) => (
          <NewsRow key={a.url} a={a} />
        ))}
      </ul>
      {data && (
        <div
          style={{
            padding: '6px 14px',
            fontSize: 10,
            color: 'var(--ink-mute)',
            fontFamily: "'JetBrains Mono', monospace",
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>
            sources: GDELT 2.0 · BBC · AP · WHO
            {data.cached ? ' · cached' : ''}
          </span>
          <span>
            {data.articles.length} headlines · refresh 5m
          </span>
        </div>
      )}
    </div>
  );
}

function NewsRow({ a }: { a: MacroNewsArticle }) {
  const c = CAT_COLORS[a.category] ?? { fg: 'var(--ink-mute)', bg: 'rgba(255,255,255,0.04)' };
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 86px minmax(0, 1fr) auto',
        alignItems: 'baseline',
        gap: 10,
        padding: '8px 14px',
        borderTop: '1px solid var(--line)',
      }}
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-mute)',
          whiteSpace: 'nowrap',
        }}
      >
        {relativeAgo(a.published_at)}
      </span>
      <span
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontFamily: "'JetBrains Mono', monospace",
          padding: '2px 6px',
          borderRadius: 3,
          background: c.bg,
          color: c.fg,
          textAlign: 'center',
          justifySelf: 'start',
        }}
      >
        {a.category}
      </span>
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 13,
          color: 'var(--ink)',
          textDecoration: 'none',
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.textDecoration = 'underline';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.textDecoration = 'none';
        }}
      >
        {a.title}
      </a>
      <span
        style={{
          fontSize: 10,
          color: 'var(--ink-mute)',
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: 'nowrap',
        }}
      >
        {a.source}
      </span>
    </li>
  );
}
