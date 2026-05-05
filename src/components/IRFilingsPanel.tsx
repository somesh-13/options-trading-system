'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getIRFilings,
  refreshIRFilings,
  type IRFilingList,
  type IRFilingItem,
  type ThesisLabel,
} from '@/lib/ir-api';

interface IRFilingsPanelProps {
  ticker: string;
}

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min — IR doesn't change minute-to-minute

const THESIS_STYLE: Record<
  ThesisLabel,
  { color: string; border: string; bg: string }
> = {
  BULLISH: {
    color: 'var(--green)',
    border: 'rgba(0,200,5,.45)',
    bg: 'rgba(0,200,5,.18)',
  },
  BEARISH: {
    color: 'var(--pink)',
    border: 'rgba(255,0,110,.45)',
    bg: 'rgba(255,0,110,.12)',
  },
  NEUTRAL: {
    color: 'var(--ink-mute)',
    border: 'var(--line)',
    bg: 'rgba(255,255,255,.06)',
  },
  INFORMATIVE: {
    color: 'var(--gold)',
    border: 'rgba(255,215,0,.4)',
    bg: 'rgba(255,215,0,.12)',
  },
};

const THESIS_ORDER: ThesisLabel[] = ['BULLISH', 'BEARISH', 'NEUTRAL', 'INFORMATIVE'];

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function IRFilingsPanel({ ticker }: IRFilingsPanelProps) {
  const [data, setData] = useState<IRFilingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const next = await getIRFilings(ticker, 25);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load IR feed');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      await refreshIRFilings(ticker, false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [ticker, fetchData]);

  const toggle = useCallback((hash: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  const items = data?.items ?? [];
  const visibleChips = useMemo(() => {
    const c = data?.counts ?? {};
    return THESIS_ORDER.filter((label) => (c[label] ?? 0) > 0).map((label) => ({
      label,
      n: c[label] ?? 0,
      style: THESIS_STYLE[label],
    }));
  }, [data]);

  if (loading && !data) {
    return (
      <div className="rv-card" style={{ marginTop: 0 }}>
        <div className="rv-card-head">
          <h3>LATEST IR FILINGS</h3>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ height: 14, background: 'var(--line-soft)', borderRadius: 3, opacity: 0.6 }} />
          <div style={{ height: 14, background: 'var(--line-soft)', borderRadius: 3, opacity: 0.4, width: '80%' }} />
          <div style={{ height: 14, background: 'var(--line-soft)', borderRadius: 3, opacity: 0.4, width: '60%' }} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rv-card" style={{ marginTop: 0 }}>
        <div className="rv-card-head">
          <h3>LATEST IR FILINGS</h3>
        </div>
        <div
          style={{
            border: '1px solid rgba(255,0,110,.35)',
            background: 'rgba(255,0,110,.08)',
            color: 'var(--pink)',
            padding: '10px 12px',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          Error loading IR feed: {error}
        </div>
        <button
          onClick={fetchData}
          type="button"
          className="rv-btn primary"
          style={{ marginTop: 10 }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rv-card" style={{ marginTop: 0 }}>
      <div className="rv-card-head">
        <div>
          <h3>LATEST IR FILINGS</h3>
          {data?.last_refreshed_at && (
            <div className="text-meta" style={{ marginTop: 4 }}>
              UPDATED {relativeTime(data.last_refreshed_at)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="rv-btn ghost"
          disabled={refreshing}
          style={{ fontSize: 11, padding: '6px 10px' }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Count chips */}
      {visibleChips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {visibleChips.map(({ label, n, style }) => (
            <span
              key={label}
              className="rv-pill"
              style={{
                color: style.color,
                borderColor: style.border,
                background: style.bg,
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              {label} {n}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            border: '1px solid rgba(255,0,110,.35)',
            background: 'rgba(255,0,110,.08)',
            color: 'var(--pink)',
            padding: '8px 10px',
            borderRadius: 6,
            fontSize: 11,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div
          style={{
            border: '1px dashed rgba(255,215,0,.35)',
            background: 'rgba(255,215,0,.04)',
            color: 'var(--ink-mute)',
            borderRadius: 6,
            padding: '14px 12px',
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          No IR items yet. Click <strong>Refresh</strong> to fetch the latest filings.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item) => (
            <IRRow
              key={item.item_hash}
              item={item}
              expanded={expanded.has(item.item_hash)}
              onToggle={() => toggle(item.item_hash)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface IRRowProps {
  item: IRFilingItem;
  expanded: boolean;
  onToggle: () => void;
}

function IRRow({ item, expanded, onToggle }: IRRowProps) {
  const thesis = item.thesis ?? 'NEUTRAL';
  const style = THESIS_STYLE[thesis];

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        background: '#0c0d10',
        borderRadius: 6,
        padding: '8px 10px',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: '100%',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          minHeight: 44,
          paddingBlock: 4,
        }}
      >
        <span
          className="rv-pill"
          style={{
            color: style.color,
            borderColor: style.border,
            background: style.bg,
            fontSize: 10,
            fontWeight: 600,
            flexShrink: 0,
            minWidth: 80,
            textAlign: 'center',
          }}
        >
          {thesis}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: 'var(--ink)',
              fontSize: 12,
              lineHeight: 1.35,
              fontWeight: 500,
            }}
          >
            {item.title}
          </div>
          <div className="text-meta" style={{ marginTop: 3 }}>
            {item.publisher || item.source.toUpperCase()} · {relativeTime(item.published_at)}
            {item.item_type && item.item_type !== 'STORY' ? ` · ${item.item_type}` : ''}
          </div>
        </span>
        <span
          style={{
            color: 'var(--ink-mute)',
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--line-soft)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {item.rationale && (
            <div
              style={{
                color: 'var(--ink-dim)',
                fontSize: 11,
                lineHeight: 1.45,
                fontStyle: 'italic',
              }}
            >
              {item.rationale}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: 10,
              color: 'var(--ink-mute)',
            }}
          >
            {item.classifier && <span>via {item.classifier}</span>}
            {item.confidence != null && (
              <span>confidence {(item.confidence * 100).toFixed(0)}%</span>
            )}
            {item.link && (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--gold)',
                  textDecoration: 'underline',
                  marginLeft: 'auto',
                  fontWeight: 600,
                  fontSize: 11,
                }}
              >
                Source ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
