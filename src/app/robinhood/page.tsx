'use client';

import { useCallback, useEffect, useState } from 'react';
import { AccountSummaryCard } from '@/components/robinhood/AccountSummaryCard';
import { HoldingsTable } from '@/components/robinhood/HoldingsTable';
import { OptionsTable } from '@/components/robinhood/OptionsTable';
import { ActivityTimeline } from '@/components/robinhood/ActivityTimeline';
import { AnalyticsPanel } from '@/components/robinhood/AnalyticsPanel';
import {
  getRobinhoodAccounts,
  getRobinhoodHoldings,
  getRobinhoodSummary,
  getRobinhoodActivity,
  getRobinhoodSyncStatus,
  triggerRobinhoodIngest,
  triggerRobinhoodSync,
  type RobinhoodAccount,
  type RobinhoodHoldingsResponse,
  type RobinhoodSource,
  type RobinhoodSummary,
  type RobinhoodSyncStatus,
  type RobinhoodActivityRow,
} from '@/lib/robinhood-api';

const ACCOUNT_LABEL: Record<RobinhoodAccount, string> = {
  all: 'All accounts',
  brokerage: 'Brokerage',
  roth_ira: 'Roth IRA',
  sofi: 'SoFi',
};

const TAB_ORDER: RobinhoodAccount[] = ['all', 'brokerage', 'roth_ira', 'sofi'];

type View = 'portfolio' | 'analytics';
const VIEW_TABS: Array<{ key: View; label: string }> = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'analytics', label: 'Analytics' },
];

export default function RobinhoodPage() {
  const [account, setAccount] = useState<RobinhoodAccount>('all');
  const [view, setView] = useState<View>('portfolio');
  const [source, setSource] = useState<RobinhoodSource>('csv');
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([]);
  const [holdings, setHoldings] = useState<RobinhoodHoldingsResponse | null>(null);
  const [summary, setSummary] = useState<RobinhoodSummary | null>(null);
  const [activity, setActivity] = useState<RobinhoodActivityRow[]>([]);
  const [syncStatus, setSyncStatus] = useState<RobinhoodSyncStatus | null>(null);
  const [livePrices, setLivePrices] = useState(true);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    async (acc: RobinhoodAccount, withLivePrices: boolean, src: RobinhoodSource) => {
      setLoading(true);
      setErr(null);
      try {
        const [h, s, a] = await Promise.all([
          getRobinhoodHoldings(withLivePrices, acc, src),
          getRobinhoodSummary(withLivePrices, acc, src),
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

  const refreshSyncStatus = useCallback(async (acc: RobinhoodAccount) => {
    try {
      const s = await getRobinhoodSyncStatus(acc);
      setSyncStatus(s);
    } catch {
      setSyncStatus(null);
    }
  }, []);

  useEffect(() => {
    getRobinhoodAccounts()
      .then((r) => setAvailableAccounts(r.accounts))
      .catch(() => setAvailableAccounts([]));
  }, []);

  useEffect(() => {
    load(account, livePrices, source);
    refreshSyncStatus(account);
  }, [load, refreshSyncStatus, account, livePrices, source]);

  const onReingest = useCallback(async () => {
    setIngesting(true);
    setErr(null);
    try {
      await triggerRobinhoodIngest();
      // Refresh the account list in case new account types appeared.
      const accs = await getRobinhoodAccounts().catch(() => ({ accounts: [] }));
      setAvailableAccounts(accs.accounts);
      await load(account, livePrices, source);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setIngesting(false);
    }
  }, [load, account, livePrices, source]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    setErr(null);
    try {
      const result = await triggerRobinhoodSync(account);
      if (!result.ok && result.error) {
        setErr(result.error);
      }
      await refreshSyncStatus(account);
      // Auto-flip to live view after a successful sync so the user sees fresh data.
      if (result.ok) {
        setSource('live');
        await load(account, livePrices, 'live');
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [account, livePrices, load, refreshSyncStatus]);

  const equityCount = holdings?.equities.length ?? 0;
  const optionCount = holdings?.options.length ?? 0;
  const visibleTabs = TAB_ORDER.filter(
    (t) => t === 'all' || availableAccounts.includes(t),
  );

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
          {equityCount} equities · {optionCount} option legs · {activity.length} recent events
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            data-testid="source-badge"
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              padding: '2px 8px',
              borderRadius: 3,
              border: '1px solid var(--line)',
              background: source === 'live' ? 'rgba(0,200,5,0.12)' : 'transparent',
              color: source === 'live' ? 'var(--green, #00C805)' : 'var(--ink-mute)',
            }}
            title={
              syncStatus?.fetched_at
                ? `Last live sync: ${new Date(syncStatus.fetched_at).toLocaleString()}`
                : 'No live snapshot yet'
            }
          >
            {source === 'live' ? 'LIVE' : 'CSV'}
            {source === 'live' && syncStatus?.fetched_at
              ? ` · ${new Date(syncStatus.fetched_at).toLocaleTimeString()}`
              : ''}
          </span>
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11 }}
            onClick={() => setSource((s) => (s === 'csv' ? 'live' : 'csv'))}
            disabled={!syncStatus?.has_snapshot && source === 'csv'}
            data-testid="toggle-source"
            title={
              !syncStatus?.has_snapshot
                ? 'Run "Sync RH" first to enable live view'
                : `Toggle between CSV-derived and live API snapshot`
            }
          >
            View: {source === 'live' ? 'Live' : 'CSV'}
          </button>
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11 }}
            onClick={() => setLivePrices((v) => !v)}
            data-testid="toggle-live-prices"
          >
            {livePrices ? 'Live prices: on' : 'Live prices: off'}
          </button>
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11 }}
            disabled={ingesting}
            onClick={onReingest}
            data-testid="reingest-button"
          >
            {ingesting ? 'Ingesting…' : 'Re-ingest CSVs'}
          </button>
          <button
            type="button"
            className="rv-btn"
            style={{ fontSize: 11 }}
            disabled={syncing || (syncStatus !== null && !syncStatus.configured)}
            onClick={onSync}
            data-testid="sync-rh-button"
            title={
              syncStatus && !syncStatus.configured
                ? 'Set ROBINHOOD_USERNAME / ROBINHOOD_PASSWORD in .env.local'
                : 'Pull live positions from the Robinhood API'
            }
          >
            {syncing ? 'Syncing…' : 'Sync RH'}
          </button>
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

      {view === 'portfolio' ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <AccountSummaryCard
              summary={summary}
              accountLabel={ACCOUNT_LABEL[account]}
              source={source}
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
      ) : (
        <div style={{ marginBottom: 12 }}>
          <AnalyticsPanel
            account={account}
            tickers={(holdings?.equities ?? []).map((e) => e.symbol)}
          />
        </div>
      )}
    </>
  );
}
