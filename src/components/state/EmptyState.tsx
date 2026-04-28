'use client';

import * as React from 'react';
import Link from 'next/link';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateProps {
  icon?: string;
  title: string;
  sub?: string;
  action?: EmptyStateAction;
}

/**
 * Instructive empty state. Centered: large muted icon, bold title,
 * sub copy, optional ghost-button action. Matches the design's
 * "No positions yet · open scanner →" example.
 */
export function EmptyState({ icon = '◎', title, sub, action }: EmptyStateProps) {
  const actionStyle: React.CSSProperties = {
    fontSize: '11px',
    marginTop: '8px',
    display: 'inline-block',
  };

  const actionEl = action ? (
    action.href ? (
      <Link href={action.href} className="rv-btn ghost" style={actionStyle}>
        {action.label}
      </Link>
    ) : (
      <button
        type="button"
        onClick={action.onClick}
        className="rv-btn ghost"
        style={actionStyle}
      >
        {action.label}
      </button>
    )
  ) : null;

  return (
    <div style={{ textAlign: 'center', padding: '12px 8px' }}>
      <div
        style={{
          fontSize: '28px',
          color: 'var(--ink-mute)',
          lineHeight: 1,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          marginTop: '8px',
        }}
      >
        {title}
      </div>
      {sub ? (
        <div className="rv-sub" style={{ marginTop: '2px', marginBottom: 0 }}>
          {sub}
        </div>
      ) : null}
      {actionEl}
    </div>
  );
}

export default EmptyState;
