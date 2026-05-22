'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { RobinhoodOption } from '@/lib/robinhood-api';
import { groupStrategies, type StrategyGroup } from '@/lib/option-strategies';

const COLLAPSE_KEY = 'rv:robinhood:option-legs-collapsed';
const SORT_KEY = 'rv:robinhood:option-legs-sort';
const EXPANDED_GROUPS_KEY = 'rv:robinhood:option-legs-expanded';

type SortKey =
  | 'underlying'
  | 'expiry'
  | 'qty'
  | 'cost'
  | 'mv'
  | 'realized'
  | 'unrealized';

type SortDir = 'asc' | 'desc';
type SortState = { key: SortKey; dir: SortDir } | null;

/**
 * Comparator for nullable numeric fields. Null values are pushed to the
 * bottom regardless of asc/desc so a missing mark price never floats to the
 * top of "highest unrealized" view.
 */
function cmpNullableNum(a: number | null, b: number | null, dirSign: 1 | -1): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  return dirSign * (a - b);
}

function compareGroups(a: StrategyGroup, b: StrategyGroup, key: SortKey, dirSign: 1 | -1): number {
  switch (key) {
    case 'underlying':
      return dirSign * a.underlying.localeCompare(b.underlying);
    case 'expiry':
      return dirSign * a.expiry.localeCompare(b.expiry);
    case 'qty':
      return dirSign * (a.spreadCount - b.spreadCount);
    case 'cost':
      return dirSign * (a.netCostBasis - b.netCostBasis);
    case 'realized':
      return dirSign * (a.netRealized - b.netRealized);
    case 'mv':
      return cmpNullableNum(a.netMarketValue, b.netMarketValue, dirSign);
    case 'unrealized':
      return cmpNullableNum(a.netUnrealized, b.netUnrealized, dirSign);
    default:
      return 0;
  }
}

function stockHref(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol)}?from=robinhood`;
}

const fmt = (n: number, fraction = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });

const fmtSigned = (n: number) => {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const cls = (n: number) => (n > 0 ? 'rv-up' : n < 0 ? 'rv-dn' : '');

function strategyChipColor(type: StrategyGroup['type']): { bg: string; border: string; fg: string } {
  // Debit / long bias → green; credit / short bias → gold; neutral / catch-all → blue-ish.
  switch (type) {
    case 'long_call':
    case 'long_put':
    case 'long_call_spread':
    case 'long_put_spread':
    case 'long_straddle':
    case 'long_strangle':
      return { bg: 'rgba(0,200,5,.08)', border: 'rgba(0,200,5,.35)', fg: 'var(--green, #00C805)' };
    case 'short_call':
    case 'short_put':
    case 'short_call_spread':
    case 'short_put_spread':
    case 'short_straddle':
    case 'short_strangle':
    case 'iron_condor':
    case 'iron_butterfly':
      return { bg: 'rgba(255,215,0,.08)', border: 'rgba(255,215,0,.35)', fg: 'var(--gold, #FFD700)' };
    default:
      return { bg: 'rgba(58,141,255,.08)', border: 'rgba(58,141,255,.35)', fg: 'var(--blue, #3A8DFF)' };
  }
}

export function OptionsTable({ options }: { options: RobinhoodOption[] }) {
  const [hydrated, setHydrated] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [sort, setSort] = useState<SortState>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Load persisted UI state after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(SORT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SortState;
        if (parsed && parsed.key) setSort(parsed);
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(EXPANDED_GROUPS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setExpanded(new Set(arr));
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (sort) localStorage.setItem(SORT_KEY, JSON.stringify(sort));
      else localStorage.removeItem(SORT_KEY);
    } catch {
      /* ignore */
    }
  }, [sort, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }, [expanded, hydrated]);

  const groups = useMemo(() => {
    const all = groupStrategies(options);
    if (!sort) return all;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...all].sort((a, b) => compareGroups(a, b, sort.key, sign));
  }, [options, sort]);

  const totalLegs = options.length;
  const totalGroups = groups.length;
  const multiLegGroups = groups.filter((g) => g.legs.length > 1).length;

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(groups.map((g) => g.id)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  function SortIndicator({ k }: { k: SortKey }) {
    if (!sort || sort.key !== k) {
      return <span style={{ marginLeft: 4, color: 'var(--ink-mute)', fontSize: 9 }}>↕</span>;
    }
    return (
      <span style={{ marginLeft: 4, color: 'var(--ink)', fontSize: 9 }}>
        {sort.dir === 'asc' ? '▲' : '▼'}
      </span>
    );
  }

  function SortableTh({
    k,
    align = 'left',
    children,
  }: {
    k: SortKey;
    align?: 'left' | 'right';
    children: React.ReactNode;
  }) {
    const active = sort?.key === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        title="Click to sort · click again to flip · third click resets"
        style={{
          textAlign: align,
          cursor: 'pointer',
          userSelect: 'none',
          color: active ? 'var(--ink)' : undefined,
        }}
      >
        {children}
        <SortIndicator k={k} />
      </th>
    );
  }

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3
          onClick={() => setCollapsed((c) => !c)}
          role="button"
          aria-expanded={!collapsed}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCollapsed((c) => !c);
            }
          }}
          style={{ cursor: 'pointer', userSelect: 'none', margin: 0 }}
          title={collapsed ? 'Click to expand' : 'Click to collapse'}
        >
          <span style={{ display: 'inline-block', width: 14, color: 'var(--ink-mute)' }}>
            {collapsed ? '▶' : '▼'}
          </span>
          {' '}Open option strategies · {totalGroups}
          {totalLegs !== totalGroups && (
            <span className="rv-sub" style={{ fontWeight: 400, marginLeft: 6 }}>
              ({totalLegs} legs · {multiLegGroups} multi-leg)
            </span>
          )}
        </h3>
        <span className="rv-sub" style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
          grouped by underlying + expiry + account · click strategy to expand legs
          {!collapsed && multiLegGroups > 0 && (
            <>
              <button
                type="button"
                className="rv-btn ghost"
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={expandAll}
              >
                expand all
              </button>
              <button
                type="button"
                className="rv-btn ghost"
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={collapseAll}
              >
                collapse all
              </button>
            </>
          )}
        </span>
      </div>
      {!collapsed && (
        <div style={{ overflowX: 'auto' }}>
          <table className="rv-table rh-options-table" style={{ minWidth: 720, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <SortableTh k="underlying">Underlying</SortableTh>
                <th>Strategy</th>
                <SortableTh k="expiry">Expiry</SortableTh>
                <SortableTh k="qty" align="right">Qty</SortableTh>
                <SortableTh k="cost" align="right">Net cost</SortableTh>
                <SortableTh k="mv" align="right">Mkt value</SortableTh>
                <SortableTh k="realized" align="right">Realized</SortableTh>
                <SortableTh k="unrealized" align="right">Unrealized</SortableTh>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 12, color: 'var(--ink-mute)', textAlign: 'center' }}>
                    No open option strategies.
                  </td>
                </tr>
              )}
              {groups.map((g) => renderGroup(g))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  function renderGroup(g: StrategyGroup) {
    const isMultiLeg = g.legs.length > 1;
    const isOpen = expanded.has(g.id) || g.legs.length === 1;
    const chip = strategyChipColor(g.type);

    return (
      <Fragment key={g.id}>
        <tr
          onClick={isMultiLeg ? () => toggleExpand(g.id) : undefined}
          style={{
            cursor: isMultiLeg ? 'pointer' : 'default',
            background: isMultiLeg ? 'rgba(255,255,255,.015)' : undefined,
          }}
          aria-expanded={isMultiLeg ? isOpen : undefined}
        >
          <td style={{ textAlign: 'center', color: 'var(--ink-mute)', fontSize: 11 }}>
            {isMultiLeg ? (isOpen ? '▼' : '▶') : ''}
          </td>
          <td>
            <Link
              href={stockHref(g.underlying)}
              data-testid={`option-link-${g.underlying}`}
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px dotted var(--line)' }}
            >
              <b>{g.underlying}</b>
            </Link>
          </td>
          <td>
            <span
              className="rv-chip"
              style={{
                fontSize: 10,
                fontWeight: 600,
                background: chip.bg,
                borderColor: chip.border,
                color: chip.fg,
                marginRight: 8,
              }}
              title={`${g.legs.length} leg${g.legs.length === 1 ? '' : 's'} · ${g.account}`}
            >
              {g.label}
            </span>
            {/* Strategy description (g.subLabel) only renders once the row is
                expanded — keeps collapsed rows clean and avoids wrapping the
                chip line on narrow screens. Single-leg groups are always
                "open" so their description still appears. */}
            {isOpen && g.subLabel && (
              <span style={{ fontSize: 10, color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
                {g.subLabel}
              </span>
            )}
          </td>
          <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{g.expiry}</td>
          <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
            {fmt(g.spreadCount, 0)}
          </td>
          <td
            style={{
              textAlign: 'right',
              fontFamily: "'JetBrains Mono', monospace",
              color: g.netCostBasis < 0 ? 'var(--ink-dim)' : undefined,
            }}
          >
            {fmtSigned(g.netCostBasis)}
          </td>
          <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
            {g.netMarketValue == null ? '—' : `$${fmt(g.netMarketValue)}`}
          </td>
          <td
            className={cls(g.netRealized)}
            style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
          >
            {g.netRealized === 0 ? '—' : fmtSigned(g.netRealized)}
          </td>
          <td
            className={g.netUnrealized != null ? cls(g.netUnrealized) : ''}
            style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
          >
            {g.netUnrealized == null ? '—' : fmtSigned(g.netUnrealized)}
          </td>
        </tr>
        {isMultiLeg && isOpen && g.legs.map((leg, idx) => (
          <tr
            key={`${g.id}-leg-${idx}-${leg.side}-${leg.strike}-${leg.position}`}
            style={{ background: 'rgba(0,0,0,.15)' }}
          >
            <td></td>
            <td style={{ color: 'var(--ink-mute)', fontSize: 11 }}>↳</td>
            <td>
              <span
                className={`rv-chip ${leg.position === 'long' ? '' : 'warn'}`}
                style={{ fontSize: 10, marginRight: 6 }}
              >
                {leg.position === 'long' ? 'LONG' : 'SHORT'}
              </span>
              {leg.side} ${fmt(leg.strike)}
            </td>
            <td style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ink-mute)' }}>{leg.expiry}</td>
            <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{fmt(leg.quantity, 0)}</td>
            <td
              style={{
                textAlign: 'right',
                fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--ink-mute)',
              }}
              title={`Avg premium: $${fmt(leg.avg_cost)}`}
            >
              {fmtSigned(leg.cost_basis)}
            </td>
            <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: 'var(--ink-mute)' }}>
              {leg.market_value == null ? '—' : `$${fmt(leg.market_value)}`}
            </td>
            <td
              className={cls(leg.realized_pnl)}
              style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
            >
              {leg.realized_pnl === 0 ? '—' : fmtSigned(leg.realized_pnl)}
            </td>
            <td
              className={leg.unrealized_pnl != null ? cls(leg.unrealized_pnl) : ''}
              style={{ textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}
            >
              {leg.unrealized_pnl == null ? '—' : fmtSigned(leg.unrealized_pnl)}
            </td>
          </tr>
        ))}
      </Fragment>
    );
  }
}
