'use client';

import { useCallback, useEffect, useState } from 'react';
import { AccountSummaryCard } from '@/components/robinhood/AccountSummaryCard';
import { HoldingsTable } from '@/components/robinhood/HoldingsTable';
import { OptionsTable } from '@/components/robinhood/OptionsTable';
import { ActivityTimeline } from '@/components/robinhood/ActivityTimeline';
import {
  getRobinhoodAccounts,
  getRobinhoodHoldings,
  getRobinhoodSummary,
  getRobinhoodActivity,
  triggerRobinhoodIngest,
  type RobinhoodAccount,
  type RobinhoodHoldingsResponse,
  type RobinhoodSummary,
  type RobinhoodActivityRow,
} from '@/lib/robinhood-api';

const ACCOUNT_LABEL: Record<RobinhoodAccount, string> = {
  all: 'All accounts',
  brokerage: 'Brokerage',
  roth_ira: 'Roth IRA',
};

const TAB_ORDER: RobinhoodAccount[] = ['all', 'brokerage', 'roth_ira'];

export default function RobinhoodPage() {
  const [account, setAccount] = useState<RobinhoodAccount>('all');
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([]);
  const [holdings, setHoldings] = useState<RobinhoodHoldingsResponse | null>(null);
  const [summary, setSummary] = useState<RobinhoodSummary | null>(null);
  const [activity, setActivity] = useState<RobinhoodActivityRow[]>([]);
  const [livePrices, setLivePrices] = useState(true);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    async (acc: RobinhoodAccount, withLivePrices: boolean) => {
      setLoading(true);
      setErr(null);
      try {
        const [h, s, a] = await Promise.all([
          getRobinhoodHoldings(withLivePrices, acc),
          getRobinhoodSummary(withLivePrices, acc),
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

  useEffect(() => {
    getRobinhoodAccounts()
      .then((r) => setAvailableAccounts(r.accounts))
      .catch(() => setAvailableAccounts([]));
  }, []);

  useEffect(() => {
    load(account, livePrices);
  }, [load, account, livePrices]);

  const onReingest = useCallback(async () => {
    setIngesting(true);
    setErr(null);
    try {
      await triggerRobinhoodIngest();
      // Refresh the account list in case new account types appeared.
      const accs = await getRobinhoodAccounts().catch(() => ({ accounts: [] }));
      setAvailableAccounts(accs.accounts);
      await load(account, livePrices);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setIngesting(false);
    }
  }, [load, account, livePrices]);

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
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Robinhood accounts"
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}
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

      <div style={{ marginBottom: 12 }}>
        <AccountSummaryCard summary={summary} accountLabel={ACCOUNT_LABEL[account]} />
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
  );
}
