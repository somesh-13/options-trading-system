'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { InfoIcon } from '@/components/ui/InfoIcon';
import type { HedgeRatioResult, RebalanceCheckResult, LimitsCheckResult } from '@/lib/robinhood-analytics-api';

// ---- types ------------------------------------------------------------------

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'err'; error: string };

type Severity = 'critical' | 'warn' | 'info';
type Category = 'hedge' | 'limits' | 'opportunity' | 'concentration';

interface Action {
  severity: Severity;
  category: Category;
  title: string;
  detail?: string;
  ticker?: string;           // when set, the ticker symbol in the title is rendered as a Link
  link?: { label: string; href: string };
}

// ---- props ------------------------------------------------------------------

export interface RecommendedActionsCardProps {
  hedge: AsyncState<HedgeRatioResult>;
  rebalance: AsyncState<RebalanceCheckResult>;
  limits: AsyncState<LimitsCheckResult>;
  tickerResults: Record<string, AsyncState<unknown>>;
  tickers: string[];
  holdings?: Array<{ symbol: string; market_value: number | null }>;
  totalNAV?: number;
}

// ---- helpers ----------------------------------------------------------------

function stockHref(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol)}?from=robinhood`;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
const CATEGORY_ORDER: Record<Category, number> = { hedge: 0, limits: 1, opportunity: 2, concentration: 3 };

function sortActions(a: Action, b: Action): number {
  const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (sev !== 0) return sev;
  return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
}

// ---- icon -------------------------------------------------------------------

function SeverityIcon({ s }: { s: Severity }) {
  if (s === 'critical') return <span title="critical" style={{ color: 'var(--pink, #FF006E)' }}>🔴</span>;
  if (s === 'warn')     return <span title="warn"     style={{ color: 'var(--gold, #FFD700)' }}>🟡</span>;
  return                       <span title="info"     style={{ color: 'var(--green, #00C805)' }}>🟢</span>;
}

// ---- main component ---------------------------------------------------------

export function RecommendedActionsCard({
  hedge,
  rebalance,
  limits,
  tickerResults,
  tickers,
  holdings,
  totalNAV,
}: RecommendedActionsCardProps) {
  const actions = useMemo<Action[]>(() => {
    const result: Action[] = [];

    // ---- a) Hedge action ----------------------------------------------------
    if (hedge.status === 'ok' && !hedge.data.error) {
      const { current_delta, hedge_direction, hedge_shares, hedge_notional } = hedge.data;
      // Only surface if there's a real breach (delta meaningfully non-zero)
      if (hedge_direction !== 'NONE' && Math.abs(current_delta) > 1) {
        const severity: Severity = Math.abs(current_delta) > 50 ? 'critical' : 'warn';
        result.push({
          severity,
          category: 'hedge',
          title: `${hedge_direction} ${Math.abs(hedge_shares).toLocaleString()} shares (≈${fmtMoney(hedge_notional)} notional) to neutralise Δ`,
          detail: `Current Δ ${current_delta.toFixed(2)} → target 0`,
          link: { label: 'risk-mgmt', href: '/risk-mgmt' },
        });
      }
    }

    // ---- b) Greek limit violations ------------------------------------------
    if (limits.status === 'ok' && !limits.data.error) {
      for (const v of limits.data.violations) {
        const over = v.utilization_pct > 100 ? +(v.utilization_pct - 100).toFixed(1) : 0;
        result.push({
          severity: 'critical',
          category: 'limits',
          title: `Reduce ${v.greek}: ${v.current.toFixed(2)} > ${v.limit.toFixed(2)} (${over}% over)`,
          link: { label: 'risk-mgmt', href: '/risk-mgmt' },
        });
      }
    }

    if (rebalance.status === 'ok' && !rebalance.data.error && rebalance.data.needs_rebalance) {
      for (const b of rebalance.data.breaches) {
        // Avoid duplicate if limits already reported it
        const alreadyReported = result.some(
          (a) => a.category === 'limits' && a.title.includes(b.greek),
        );
        if (!alreadyReported) {
          result.push({
            severity: 'critical',
            category: 'limits',
            title: `Rebalance ${b.greek}: ${b.current.toFixed(2)} > ${b.limit.toFixed(2)} (${b.severity})`,
            link: { label: 'risk-mgmt', href: '/risk-mgmt' },
          });
        }
      }
    }

    // ---- c) Tradable opportunities ------------------------------------------
    let opportunityCount = 0;
    for (const t of tickers) {
      if (opportunityCount >= 5) break;
      const recState = tickerResults[`${t}:rec`];
      if (recState?.status !== 'ok') continue;
      const d = recState.data as Record<string, unknown>;
      const strategy = d.strategy as string | undefined;
      const strikes = d.strikes as unknown[] | undefined;
      if (!strategy || strategy === 'HOLD') continue;
      if ((strikes?.length ?? 0) === 0) continue;
      result.push({
        severity: 'warn',
        category: 'opportunity',
        ticker: t,
        title: `${t}: ${strategy}`,
        detail: `${strikes!.length} strike candidate${strikes!.length === 1 ? '' : 's'}`,
        link: { label: 'Open chain', href: `/options-chain?ticker=${t}` },
      });
      opportunityCount++;
    }

    // ---- d) High-IV but no contracts ----------------------------------------
    let noContractCount = 0;
    for (const t of tickers) {
      if (noContractCount >= 3) break;
      const mispState = tickerResults[`${t}:mispricing`];
      const recState = tickerResults[`${t}:rec`];
      if (mispState?.status !== 'ok') continue;
      const md = mispState.data as Record<string, unknown>;
      const signal = md.signal as string | undefined;
      const ratio = md.iv_hv_ratio as number | undefined;
      if (signal !== 'SELL' || (ratio ?? 0) <= 1.5) continue;
      // rec must have errored with a "no contracts" message
      if (recState?.status !== 'err') continue;
      const errMsg = recState.error.toLowerCase();
      if (!errMsg.includes('no') && !errMsg.includes('contract') && !errMsg.includes('dte')) continue;
      result.push({
        severity: 'info',
        category: 'opportunity',
        ticker: t,
        title: `${t}: high IV (${(ratio!).toFixed(2)}x) — no contracts in standard DTE window`,
        detail: 'Manually expand DTE filter to find premium-selling candidates',
        link: { label: 'Open chain', href: `/options-chain?ticker=${t}` },
      });
      noContractCount++;
    }

    // ---- e) Concentration ---------------------------------------------------
    if (holdings && totalNAV && totalNAV > 0) {
      for (const h of holdings) {
        const mv = h.market_value;
        if (mv == null) continue;
        const pct = (mv / totalNAV) * 100;
        if (pct < 10) continue;
        const severity: Severity = pct >= 20 ? 'warn' : 'info';
        result.push({
          severity,
          category: 'concentration',
          ticker: h.symbol,
          title: `${h.symbol} is ${pct.toFixed(1)}% of NAV — consider trimming`,
        });
      }
    }

    return result.sort(sortActions);
  }, [hedge, rebalance, limits, tickerResults, tickers, holdings, totalNAV]);

  const visible = actions.slice(0, 8);
  const overflow = actions.length - visible.length;

  const anyRunStarted =
    hedge.status !== 'idle' ||
    rebalance.status !== 'idle' ||
    limits.status !== 'idle' ||
    tickers.some((t) => tickerResults[`${t}:mispricing`] != null || tickerResults[`${t}:rec`] != null);

  return (
    <div className="rv-card" style={{ padding: 12, marginBottom: 14 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          marginBottom: 2,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13 }}>
          Recommended actions · {actions.length}
          <InfoIcon term="hedge-ratio" />
        </h3>
      </div>
      <div className="rv-sub" style={{ fontSize: 10, marginBottom: 10 }}>
        synthesised from your latest analytics run
      </div>

      {/* Empty state */}
      {!anyRunStarted || actions.length === 0 ? (
        <div className="rv-sub" style={{ fontSize: 11 }}>
          {anyRunStarted
            ? 'No actions — portfolio looks clean or not enough data yet'
            : 'No actions yet — click ▶ Run all to populate'}
        </div>
      ) : (
        <>
          {visible.map((action, i) => (
            <div
              key={`${action.category}-${action.title}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '6px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              {/* Icon */}
              <span style={{ flexShrink: 0, lineHeight: 1.4 }}>
                <SeverityIcon s={action.severity} />
              </span>
              {/* Text */}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    wordBreak: 'break-word',
                  }}
                >
                  {action.ticker
                    ? (() => {
                        // Replace the leading "TICKER" or "TICKER:" with a link.
                        const prefix = action.ticker + ':';
                        if (action.title.startsWith(prefix)) {
                          return (
                            <>
                              <Link
                                href={stockHref(action.ticker)}
                                style={{
                                  color: 'var(--gold, #FFD700)',
                                  textDecoration: 'underline',
                                  textDecorationColor: 'var(--gold-dim, #cdaa3d)',
                                }}
                              >
                                {action.ticker}
                              </Link>
                              {action.title.slice(action.ticker.length)}
                            </>
                          );
                        }
                        // Fallback: just show title as-is if format doesn't match
                        return action.title;
                      })()
                    : action.title}
                </span>
                {action.detail && (
                  <span
                    className="rv-sub"
                    style={{ display: 'block', fontSize: 10, marginTop: 1 }}
                  >
                    {action.detail}
                  </span>
                )}
              </span>
              {/* Link */}
              {action.link && (
                <Link
                  href={action.link.href}
                  className="rv-btn ghost"
                  style={{ fontSize: 10, flexShrink: 0, padding: '2px 6px', whiteSpace: 'nowrap' }}
                >
                  {action.link.label}
                </Link>
              )}
            </div>
          ))}

          {overflow > 0 && (
            <div
              className="rv-sub"
              style={{ fontSize: 10, marginTop: 6, textAlign: 'right' }}
            >
              +{overflow} more action{overflow === 1 ? '' : 's'} (raise cap to view)
            </div>
          )}
        </>
      )}
    </div>
  );
}
