'use client';

import { ReactNode } from 'react';

interface Props {
  /** Big title — e.g. strategy name or "Strategy Comparison". */
  title: string;
  /** Optional one-line subtitle (e.g., universe summary). */
  subtitle?: string;
  /** Tag chips for style/family. */
  tags?: string[];
  /** Primary action — usually "Run Backtest". */
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  };
  /** Secondary actions — Save, Clone, Export, Compare. */
  secondaryActions?: Array<{ label: string; onClick: () => void; icon?: ReactNode }>;
}

export default function StrategyToolbar({
  title,
  subtitle,
  tags,
  primaryAction,
  secondaryActions,
}: Props) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white truncate">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs sm:text-sm text-gray-400 mt-0.5 line-clamp-1">{subtitle}</p>
        )}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider text-gray-300 bg-white/5 ring-1 ring-inset ring-[#26272d]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {secondaryActions?.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-300 bg-white/5 hover:bg-white/10 ring-1 ring-inset ring-[#26272d] transition-colors"
          >
            {a.icon}
            {a.label}
          </button>
        ))}
        {primaryAction && (
          <button
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled || primaryAction.loading}
            className="px-4 py-1.5 text-sm font-semibold rounded-lg text-[#0b0b0d] bg-[#22D3EE] hover:bg-[#67E8F9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_20px_-6px_rgba(34,211,238,0.6)]"
          >
            {primaryAction.loading ? 'Running…' : primaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
