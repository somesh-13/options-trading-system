'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  dismissAllNotifications,
  dismissNotification,
  listNotifications,
  scanNotificationsNow,
  type NotificationRow,
  type AlertSeverity,
} from '@/lib/notifications-api';
import {
  getOptionChain,
  getOptionExpirations,
  type OptionChainLeg,
} from '@/lib/pricing-api';

const POLL_MS = 60_000;
const ALERT_DTE_MIN = 5;
const ALERT_DTE_MAX = 60;

/** Pick the side (call/put) the user is most likely to *sell* based on the
 *  alert type. CSP alerts target puts; everything else (high IV, covered call)
 *  targets calls — that's where the rich premium lives in our default flows. */
function sideForAlert(alertType: string): 'call' | 'put' {
  return alertType === 'csp_opportunity' ? 'put' : 'call';
}

/** Among OTM legs on one side, find the contract with the highest yield per
 *  dollar of strike — the same "annualized yield" the Premium Picks overlay
 *  ranks by. Avoids picking deep-OTM lottery strikes that have huge IV but
 *  almost no real premium dollars. Requires minimal liquidity (positive OI or
 *  volume) so the result is actually tradeable. Returns null if no qualifying
 *  leg. */
function pickMostInflated(
  legs: OptionChainLeg[],
  spot: number | null,
  side: 'call' | 'put',
): OptionChainLeg | null {
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const liquid = legs.filter((l) => {
    if (l.strike == null || !Number.isFinite(l.strike) || l.strike <= 0) return false;
    if (l.mid == null || !Number.isFinite(l.mid) || l.mid <= 0) return false;
    if ((l.open_interest ?? 0) <= 0 && (l.volume ?? 0) <= 0) return false;
    if (spot == null || !Number.isFinite(spot) || spot <= 0) return true;
    return side === 'call' ? l.strike > spot : l.strike < spot;
  });
  if (liquid.length === 0) return null;
  // yield = mid / strike; same metric as Premium Picks overlay (DTE is constant
  // here since all legs share the chosen expiration, so annualization is a
  // monotonic transform — ranking by raw yield is equivalent and cheaper).
  return liquid.reduce((best, cur) => {
    const bestYield = (best.mid ?? 0) / (best.strike ?? 1);
    const curYield = (cur.mid ?? 0) / (cur.strike ?? 1);
    return curYield > bestYield ? cur : best;
  });
}

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  info: 'var(--blue, #4c9aff)',
  warn: 'var(--gold, #FFD700)',
  critical: 'var(--pink, #FF006E)',
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  high_iv: 'High IV',
  cc_opportunity: 'Covered Call',
  csp_opportunity: 'Cash-Secured Put',
  vol_term_spike: 'Earnings Vol Spike',
};

function severityRank(s: AlertSeverity): number {
  return s === 'critical' ? 0 : s === 'warn' ? 1 : 2;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  // Per-alert id of the click currently resolving its inflated-premium leg.
  // Used to disable repeat clicks and show a tiny spinner on the active card.
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listNotifications();
      setItems(r.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + 60s poll
  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const sev = severityRank(a.severity) - severityRank(b.severity);
        if (sev !== 0) return sev;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    [items],
  );

  const unreadCount = items.length;
  const criticalCount = items.filter((i) => i.severity === 'critical').length;

  const onScan = async () => {
    setScanning(true);
    setError(null);
    setScanSummary(null);
    try {
      const r = await scanNotificationsNow();
      const parts: string[] = [];
      parts.push(`${r.scanned_tickers} tickers`);
      if (r.inserted) parts.push(`${r.inserted} new`);
      if (r.deduped) parts.push(`${r.deduped} dedup'd`);
      setScanSummary(parts.join(' · '));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
      setTimeout(() => setScanSummary(null), 4000);
    }
  };

  const onDismiss = async (id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await dismissNotification(id);
    } catch (e) {
      setError((e as Error).message);
      // Re-sync from server on failure so the list isn't stuck.
      refresh();
    }
  };

  const onDismissAll = async () => {
    setItems([]);
    try {
      await dismissAllNotifications();
    } catch (e) {
      setError((e as Error).message);
      refresh();
    }
  };

  /** Click → /pricing pre-filled with the most-inflated-premium contract.
   *  Resolves the contract on click rather than at alert-creation time so old
   *  alerts (stored before this feature) still get a sensible deep-link. Falls
   *  back to /pricing?ticker=X if anything in the chain lookup fails. */
  const onActivate = useCallback(
    async (item: NotificationRow) => {
      if (resolvingId != null) return; // ignore double-clicks while resolving
      const fallback = `/pricing?ticker=${encodeURIComponent(item.ticker)}`;
      setResolvingId(item.id);
      setOpen(false);
      try {
        const exps = await getOptionExpirations(item.ticker);
        // Vol-term-spike alerts (and any future detector that pinpoints a
        // specific expiration) carry `metadata.front_expiration`. Land on
        // that exact date so the user sees the spike, not the generic 5–60
        // DTE pick.
        const metaExpRaw = (item.metadata as Record<string, unknown> | null)?.front_expiration;
        const metaExp =
          typeof metaExpRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metaExpRaw)
            ? metaExpRaw
            : null;
        const preferred = metaExp
          ? exps.expirations.find((e) => e.expiration === metaExp) ?? null
          : null;
        const eligible = exps.expirations
          .filter((e) => e.dte >= ALERT_DTE_MIN && e.dte <= ALERT_DTE_MAX)
          .sort((a, b) => a.dte - b.dte);
        const positive = exps.expirations
          .filter((e) => e.dte > 0)
          .sort((a, b) => a.dte - b.dte);
        const chosen = preferred ?? eligible[0] ?? positive[0] ?? null;
        if (!chosen) {
          router.push(fallback);
          return;
        }
        const chain = await getOptionChain(item.ticker, chosen.expiration);
        const side = sideForAlert(item.alert_type);
        const legs = side === 'call' ? chain.calls : chain.puts;
        const leg = pickMostInflated(legs, chain.spot ?? exps.spot ?? null, side);
        if (!leg || leg.strike == null) {
          router.push(fallback);
          return;
        }
        router.push(
          `/pricing?ticker=${encodeURIComponent(item.ticker)}` +
            `&strike=${leg.strike}` +
            `&type=${side}` +
            `&expiry=${chosen.expiration}`,
        );
      } catch {
        router.push(fallback);
      } finally {
        setResolvingId(null);
      }
    },
    [resolvingId, router],
  );

  const bellColor = criticalCount > 0
    ? SEVERITY_COLOR.critical
    : unreadCount > 0
      ? 'var(--gold, #FFD700)'
      : 'var(--ink-mute)';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} active)` : ''}`}
        aria-expanded={open}
        title={unreadCount > 0 ? `${unreadCount} active alert${unreadCount === 1 ? '' : 's'}` : 'Alerts'}
        style={{
          background: 'transparent',
          border: 0,
          padding: '6px 8px',
          cursor: 'pointer',
          color: bellColor,
          fontSize: 16,
          lineHeight: 1,
          position: 'relative',
        }}
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 2,
              right: 0,
              minWidth: 14,
              height: 14,
              borderRadius: 7,
              background: criticalCount > 0 ? SEVERITY_COLOR.critical : SEVERITY_COLOR.warn,
              color: '#0c0d10',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="rv-notif-dropdown">
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
              Alerts {unreadCount > 0 ? `· ${unreadCount}` : ''}
            </span>
            {scanSummary && (
              <span style={{ fontSize: 10, color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
                {scanSummary}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={onScan}
                disabled={scanning}
                className="rv-btn ghost"
                style={{ fontSize: 10, padding: '3px 8px' }}
                title="Re-scan portfolio for new alerts"
              >
                {scanning ? '…' : '↻ scan'}
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onDismissAll}
                  className="rv-btn ghost"
                  style={{ fontSize: 10, padding: '3px 8px' }}
                  title="Dismiss all"
                >
                  clear
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {error && (
              <div style={{ padding: 12, color: 'var(--pink)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                {error}
              </div>
            )}
            {!error && sorted.length === 0 && !loading && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 12 }}>
                {scanning ? 'Scanning…' : 'No active alerts. Click ↻ scan to check now.'}
              </div>
            )}
            {sorted.map((n) => (
              <NotificationCard
                key={n.id}
                item={n}
                resolving={resolvingId === n.id}
                onActivate={() => onActivate(n)}
                onDismiss={() => onDismiss(n.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationCard({
  item,
  resolving,
  onActivate,
  onDismiss,
}: {
  item: NotificationRow;
  resolving: boolean;
  onActivate: () => void;
  onDismiss: () => void;
}) {
  const color = SEVERITY_COLOR[item.severity] ?? SEVERITY_COLOR.info;
  const typeLabel = ALERT_TYPE_LABEL[item.alert_type] ?? item.alert_type;
  return (
    <div
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 4,
          alignSelf: 'stretch',
          background: color,
          borderRadius: 2,
          marginTop: 2,
          marginBottom: 2,
        }}
      />
      <button
        type="button"
        onClick={onActivate}
        disabled={resolving}
        aria-label={`Open ${item.ticker} on pricing page at the most inflated premium`}
        title={`Open ${item.ticker} on pricing page · resolves to the most inflated premium contract`}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 0,
          padding: 0,
          margin: 0,
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: resolving ? 'progress' : 'pointer',
          opacity: resolving ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (resolving) return;
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'baseline',
            flexWrap: 'wrap',
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontFamily: "'JetBrains Mono', monospace",
              color,
              fontWeight: 700,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
            }}
          >
            {typeLabel}
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
            {relativeTime(item.created_at)}
          </span>
          {resolving && (
            <span
              aria-hidden
              style={{
                fontSize: 9.5,
                color: 'var(--ink-mute)',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              ⟳ resolving…
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink)',
            fontWeight: 500,
            wordBreak: 'break-word',
          }}
        >
          {item.title}
        </div>
        {item.body && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink-dim, var(--ink-mute))',
              marginTop: 3,
              lineHeight: 1.4,
            }}
          >
            {item.body}
          </div>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="Mark as seen"
        title="Mark as seen — won't show again"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          background: 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 3,
          color: 'var(--ink-mute)',
          cursor: 'pointer',
          fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace",
          lineHeight: 1,
          padding: '3px 6px',
          alignSelf: 'flex-start',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--green, #00C805)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--green, #00C805)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-mute)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)';
        }}
      >
        ✓ seen
      </button>
    </div>
  );
}
