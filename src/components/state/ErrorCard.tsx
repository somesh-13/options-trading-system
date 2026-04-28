'use client';

import * as React from 'react';

export interface ErrorCardProps {
  title: string;
  detail?: string;
  status?: number;
  durationMs?: number;
  endpoint?: string;
  onRetry?: () => void;
  onViewLogs?: () => void;
}

/**
 * Actionable error card. Matches the design's "Alpaca paper API timeout"
 * example: pink-tinted border, pink title, sub detail, mono structured
 * meta line, ghost retry / view-logs actions when handlers are provided.
 */
export function ErrorCard({
  title,
  detail,
  status,
  durationMs,
  endpoint,
  onRetry,
  onViewLogs,
}: ErrorCardProps) {
  const hasMeta =
    status !== undefined || durationMs !== undefined || endpoint !== undefined;

  const metaParts: string[] = [];
  if (status !== undefined) metaParts.push(String(status));
  if (durationMs !== undefined) metaParts.push(`${(durationMs / 1000).toFixed(1)}s`);
  if (endpoint) metaParts.push(endpoint);
  const metaLine = metaParts.join(' · ');

  const showActions = Boolean(onRetry || onViewLogs);

  return (
    <div className="rv-card" style={{ borderColor: 'rgba(255,0,110,.3)' }}>
      <div className="rv-card-head">
        <h3 style={{ color: 'var(--pink)' }}>{title}</h3>
      </div>
      {detail ? <div className="rv-sub" style={{ marginBottom: 0 }}>{detail}</div> : null}
      {hasMeta ? (
        <div
          style={{
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--ink-dim)',
            marginTop: '4px',
          }}
        >
          {metaLine}
        </div>
      ) : null}
      {showActions ? (
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rv-btn ghost"
              style={{ fontSize: '11px' }}
            >
              retry
            </button>
          ) : null}
          {onViewLogs ? (
            <button
              type="button"
              onClick={onViewLogs}
              className="rv-btn ghost"
              style={{ fontSize: '11px' }}
            >
              view logs
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ErrorCard;
