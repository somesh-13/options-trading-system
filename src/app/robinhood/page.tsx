'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountSummaryCard } from '@/components/robinhood/AccountSummaryCard';
import { HoldingsTable } from '@/components/robinhood/HoldingsTable';
import { OptionsTable } from '@/components/robinhood/OptionsTable';
import { ActivityTimeline } from '@/components/robinhood/ActivityTimeline';
import { AnalyticsPanel } from '@/components/robinhood/AnalyticsPanel';
import { CryptoTable } from '@/components/robinhood/CryptoTable';
import { CryptoTradePanel } from '@/components/robinhood/CryptoTradePanel';
import {
  getRobinhoodAccounts,
  getRobinhoodHoldings,
  getRobinhoodSummary,
  getRobinhoodActivity,
  getRobinhoodSyncStatus,
  triggerRobinhoodSync,
  getCryptoPositions,
  type RobinhoodAccount,
  type RobinhoodHoldingsResponse,
  type RobinhoodSummary,
  type RobinhoodSyncStatus,
  type RobinhoodActivityRow,
  type CryptoHolding,
} from '@/lib/robinhood-api';

const ACCOUNT_LABEL: Record<RobinhoodAccount, string> = {
  all: 'All accounts',
  brokerage: 'Brokerage',
  roth_ira: 'Roth IRA',
  sofi: 'SoFi',
};

const TAB_ORDER: RobinhoodAccount[] = ['all', 'brokerage', 'roth_ira', 'sofi'];

type View = 'portfolio' | 'analytics' | 'crypto';
const VIEW_TABS: Array<{ key: View; label: string }> = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'crypto', label: 'Crypto' },
];

// Polling cadences (ms)
const SYNC_STATUS_INTERVAL = 60_000; // 60s
const HOLDINGS_INTERVAL = 30_000; // 30s
const AUTO_SYNC_INTERVAL = 5 * 60_000; // 5min during market hours

/**
 * Checks if current time is during US market hours (9:30am–4:00pm ET, Mon–Fri).
 * Uses Intl.DateTimeFormat with America/New_York timezone for DST correctness.
 */
function isUSMarketHours(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutesOfDay = hour * 60 + minute;
  // 9:30 → 570, 16:00 → 960
  return minutesOfDay >= 570 && minutesOfDay < 960;
}

function minutesAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

export default function RobinhoodPage() {
  const [account, setAccount] = useState<RobinhoodAccount>('all');
  const [view, setView] = useState<View>('portfolio');
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([]);
  const [holdings, setHoldings] = useState<RobinhoodHoldingsResponse | null>(null);
  const [summary, setSummary] = useState<RobinhoodSummary | null>(null);
  const [activity, setActivity] = useState<RobinhoodActivityRow[]>([]);
  const [syncStatus, setSyncStatus] = useState<RobinhoodSyncStatus | null>(null);
  const [cryptoHoldings, setCryptoHoldings] = useState<CryptoHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0); // forces re-render so "X min ago" updates

  const syncingRef = useRef(false);
  const lastAutoSyncRef = useRef<number>(0);
  const initialLoadDoneRef = useRef(false);

  const load = useCallback(
    async (acc: RobinhoodAccount) => {
      setLoading(true);
      setErr(null);
      try {
        const [h, s, a] = await Promise.all([
          getRobinhoodHoldings(true, acc, 'live'),
          getRobinhoodSummary(true, acc, 'live'),
          getRobinhoodActivity(50, undefined, acc),
        ]);
        setHoldings(h);
        setSummary(s);
        setActivity(a);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Separate loader for crypto (not account-scoped).
  const loadCrypto = useCallback(async () => {
    try {
      const c = await getCryptoPositions();
      setCryptoHoldings(c);
    } catch {
      /* swallow — crypto tab shows empty state */
    }
  }, []);

  // Lighter refresh: only holdings + summary, no activity (which doesn't change often).
  const refreshLive = useCallback(
    async (acc: RobinhoodAccount) => {
      try {
        const [h, s] = await Promise.all([
          getRobinhoodHoldings(true, acc, 'live'),
          getRobinhoodSummary(true, acc, 'live'),
        ]);
        setHoldings(h);
        setSummary(s);
      } catch {
        /* swallow background errors so the visible state isn't clobbered */
      }
    },
    [],
  );

  const refreshSyncStatus = useCallback(async (acc: RobinhoodAccount) => {
    try {
      const s = await getRobinhoodSyncStatus(acc);
      setSyncStatus(s);
      return s;
    } catch {
      setSyncStatus(null);
      return null;
    }
  }, []);

  const onSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setErr(null);
    try {
      const result = await triggerRobinhoodSync(account);
      if (!result.ok && result.error) {
        setErr(result.error);
      }
      await refreshSyncStatus(account);
      lastAutoSyncRef.current = Date.now();
      if (result.ok) {
        await load(account);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [account, load, refreshSyncStatus]);

  // Initial: load accounts list once.
  useEffect(() => {
    getRobinhoodAccounts()
      .then((r) => setAvailableAccounts(r.accounts))
      .catch(() => setAvailableAccounts([]));
  }, []);

  // Initial sync-status fetch — auto-pull a snapshot if creds are configured
  // but none exists yet.
  useEffect(() => {
    let cancelled = false;
    refreshSyncStatus(account).then((s) => {
      if (cancelled || !s) return;
      if (
        !initialLoadDoneRef.current &&
        s.configured &&
        !s.has_snapshot &&
        !syncingRef.current
      ) {
        initialLoadDoneRef.current = true;
        onSync();
      } else {
        initialLoadDoneRef.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // Reload data whenever the account changes.
  useEffect(() => {
    load(account);
  }, [load, account]);

  // Load crypto once on mount (not account-scoped).
  useEffect(() => {
    loadCrypto();
  }, [loadCrypto]);

  // Polling: sync-status every 60s, holdings/summary every 30s.
  // Pause when tab is hidden, fire one immediate refresh on refocus.
  useEffect(() => {
    let statusTimer: ReturnType<typeof setInterval> | null = null;
    let dataTimer: ReturnType<typeof setInterval> | null = null;
    let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      stop();
      statusTimer = setInterval(() => {
        refreshSyncStatus(account);
      }, SYNC_STATUS_INTERVAL);
      dataTimer = setInterval(() => {
        refreshLive(account);
      }, HOLDINGS_INTERVAL);
      autoSyncTimer = setInterval(() => {
        if (
          syncStatus?.configured &&
          !syncingRef.current &&
          isUSMarketHours() &&
          Date.now() - lastAutoSyncRef.current >= AUTO_SYNC_INTERVAL
        ) {
          onSync();
        }
      }, AUTO_SYNC_INTERVAL);
    };

    const stop = () => {
      if (statusTimer) clearInterval(statusTimer);
      if (dataTimer) clearInterval(dataTimer);
      if (autoSyncTimer) clearInterval(autoSyncTimer);
      statusTimer = null;
      dataTimer = null;
      autoSyncTimer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Immediate refresh on refocus, then resume timers.
        refreshSyncStatus(account);
        refreshLive(account);
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [account, refreshLive, refreshSyncStatus, onSync, syncStatus?.configured]);

  // Tick once a minute so "X min ago" labels stay accurate.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const equityCount = holdings?.equities.length ?? 0;
  const optionCount = holdings?.options.length ?? 0;
  const cryptoCount = cryptoHoldings.length;
  const visibleTabs = TAB_ORDER.filter(
    (t) => t === 'all' || availableAccounts.includes(t),
  );

  const fetchedMinutesAgo = minutesAgo(syncStatus?.fetched_at);
  const showStale = syncStatus?.stale === true && syncStatus?.has_snapshot;
  const showSyncError = !!syncStatus?.error;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <h2 className="rv-h1" style={{ margin: 0 }}>Robinhood</h2>
        <span className="rv-sub" style={{ margin: 0 }}>
          {equityCount} equities · {optionCount} option legs · {cryptoCount} crypto · {activity.length} recent events
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            data-testid="live-badge"
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              padding: '2px 8px',
              borderRadius: 3,
              border: '1px solid var(--green, #00C805)',
              background: 'rgba(0,200,5,0.12)',
              color: 'var(--green, #00C805)',
            }}
            title={
              syncStatus?.fetched_at
                ? `Last live sync: ${new Date(syncStatus.fetched_at).toLocaleString()}`
                : 'No live snapshot yet'
            }
          >
            LIVE
            {fetchedMinutesAgo != null ? ` · ${fetchedMinutesAgo}m ago` : ''}
          </span>
          <button
            type="button"
            className="rv-btn"
            style={{
              fontSize: 11,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: syncing ? 0.7 : 1,
              cursor: syncing ? 'wait' : undefined,
            }}
            disabled={syncing || (syncStatus !== null && !syncStatus.configured)}
            onClick={onSync}
            data-testid="sync-rh-button"
            title={
              syncStatus && !syncStatus.configured
                ? 'Set ROBINHOOD_USERNAME / ROBINHOOD_PASSWORD in backend/.env'
                : fetchedMinutesAgo != null
                  ? `Last synced ${fetchedMinutesAgo}m ago — pull fresh positions from broker`
                  : 'Pull live positions from the Robinhood API'
            }
          >
            {syncing && (
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  border: '1.5px solid var(--ink-mute)',
                  borderTopColor: 'var(--gold, #FFD700)',
                  animation: 'rv-spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
            {syncing ? 'Refreshing…' : 'Sync RH'}
          </button>
          <style>{`@keyframes rv-spin { to { transform: rotate(360deg); } }`}</style>
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div
          role="tablist"
          aria-label="Robinhood accounts"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
        >
          {visibleTabs.map((t) => {
            const active = t === account;
            return (
              <button
                type="button"
                key={t}
                role="tab"
                aria-selected={active}
                data-testid={`account-tab-${t}`}
                onClick={() => setAccount(t)}
                className="rv-btn"
                style={{
                  fontSize: 12,
                  borderColor: active ? 'var(--gold-dim, #cdaa3d)' : 'var(--line)',
                  background: active ? 'var(--line)' : undefined,
                  color: active ? 'var(--ink)' : 'var(--ink-dim)',
                  cursor: 'pointer',
                }}
              >
                {ACCOUNT_LABEL[t]}
              </button>
            );
          })}
        </div>

        <div
          role="tablist"
          aria-label="Robinhood view"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}
        >
          {VIEW_TABS.map((v) => {
            const active = v.key === view;
            return (
              <button
                type="button"
                key={v.key}
                role="tab"
                aria-selected={active}
                data-testid={`view-tab-${v.key}`}
                onClick={() => setView(v.key)}
                className="rv-btn"
                style={{
                  fontSize: 12,
                  borderColor: active ? 'var(--gold-dim, #cdaa3d)' : 'var(--line)',
                  background: active ? 'var(--line)' : undefined,
                  color: active ? 'var(--ink)' : 'var(--ink-dim)',
                  cursor: 'pointer',
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {showSyncError && (
        <div
          className="rv-card"
          role="alert"
          data-testid="sync-error-banner"
          style={{
            marginBottom: 12,
            borderColor: 'var(--pink, #FF006E)',
            background: 'rgba(255,0,110,0.08)',
            color: 'var(--pink, #FF006E)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <span>Sync error: {syncStatus?.error}</span>
          <button
            type="button"
            className="rv-btn"
            style={{ fontSize: 11 }}
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? 'Refreshing…' : 'Retry sync'}
          </button>
        </div>
      )}

      {showStale && !showSyncError && (
        <div
          className="rv-card"
          role="status"
          data-testid="stale-banner"
          style={{
            marginBottom: 12,
            borderColor: 'var(--gold, #FFD700)',
            background: 'rgba(255,215,0,0.08)',
            color: 'var(--gold, #FFD700)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <span>
            Snapshot is stale
            {fetchedMinutesAgo != null ? ` (${fetchedMinutesAgo} min old)` : ''}
            {' '}— click Refresh
          </span>
          <button
            type="button"
            className="rv-btn"
            style={{ fontSize: 11 }}
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      )}

      {err && (
        <div
          className="rv-card"
          role="alert"
          style={{
            marginBottom: 12,
            borderColor: 'var(--pink, #ff006e)',
            color: 'var(--pink, #ff006e)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        >
          Backend error: {err}. Start the Python backend (default <code>http://localhost:8000</code>) or check the <code>hood reports/</code> directory.
        </div>
      )}

      {loading && !holdings && (
        <div className="rv-sub" style={{ marginBottom: 12 }}>
          loading Robinhood activity…
        </div>
      )}

      {view === 'portfolio' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <AccountSummaryCard
              summary={summary}
              accountLabel={ACCOUNT_LABEL[account]}
              fetchedAt={syncStatus?.fetched_at ?? null}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <HoldingsTable equities={holdings?.equities ?? []} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <OptionsTable options={holdings?.options ?? []} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <ActivityTimeline rows={activity} />
          </div>
        </>
      )}

      {view === 'analytics' && (
        <div style={{ marginBottom: 12 }}>
          <AnalyticsPanel
            account={account}
            tickers={(holdings?.equities ?? []).map((e) => e.symbol)}
          />
        </div>
      )}

      {view === 'crypto' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <CryptoTable holdings={cryptoHoldings} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <CryptoTradePanel holdings={cryptoHoldings} />
          </div>
        </>
      )}
    </>
  );
}
