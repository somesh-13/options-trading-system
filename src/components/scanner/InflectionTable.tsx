'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getRobinhoodHoldings, type RobinhoodHolding } from '@/lib/robinhood-api';

export type InflectionCandidate = {
  ticker: string;
  name: string;
  theme: string;
  cap_b: number;
  de: number | null;
  gm_pct: number | null;
  roe_pct: number | null;
  altman_z: number | null;
  above_200dma: boolean | null;
  rsi_signal: string | null;
  fwd_pe: number | null;
  mos_30: boolean | null;
  score: number;
  verdict: string;
};

type SortKey = 'score' | 'cap_b' | 'ticker' | 'fwd_pe' | 'altman_z';
type SortDir = 'asc' | 'desc';

interface InflectionTableProps {
  candidates: InflectionCandidate[];
  asOf: string;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function scoreClass(s: number): string {
  if (s >= 8) return 'rv-up';
  if (s >= 5) return '';
  return 'rv-dn';
}

function accountTag(account: string): string {
  if (account === 'roth_ira') return 'Roth';
  if (account === 'brokerage') return 'Indiv';
  return account;
}

export function InflectionTable({ candidates, asOf }: InflectionTableProps) {
  const [holdings, setHoldings] = useState<RobinhoodHolding[]>([]);
  const [holdingsErr, setHoldingsErr] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let cancelled = false;
    getRobinhoodHoldings(false, 'all')
      .then((r) => {
        if (!cancelled) setHoldings(r.equities);
      })
      .catch((e) => {
        if (!cancelled) setHoldingsErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ownedAccounts = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const h of holdings) {
      const sym = h.symbol.toUpperCase();
      if (!map.has(sym)) map.set(sym, new Set());
      map.get(sym)!.add(h.account);
    }
    return map;
  }, [holdings]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...candidates].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir;
      }
      const an = (av as number | null) ?? -Infinity;
      const bn = (bv as number | null) ?? -Infinity;
      if (an === bn) return a.cap_b - b.cap_b;
      return (an - bn) * dir;
    });
  }, [candidates, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'ticker' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  if (candidates.length === 0) {
    return (
      <div
        className="rv-card"
        style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 12 }}
      >
        No candidates in current snapshot.
      </div>
    );
  }

  return (
    <div className="rv-card" style={{ padding: 0 }}>
      <div
        className="rv-card-head"
        style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <h3 style={{ margin: 0, fontSize: 13 }}>Inflection candidates</h3>
        <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
          as-of {asOf} · {candidates.length} survivors · ranked by Conviction Score
        </span>
        <button
          type="button"
          className="rv-btn ghost"
          disabled
          title="Live recompute coming in wave 2. Snapshot data refreshed manually for now."
          style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6, cursor: 'not-allowed' }}
        >
          Refresh scan
        </button>
      </div>
      {holdingsErr && (
        <div
          className="rv-sub"
          style={{ padding: '6px 14px', color: 'var(--pink, #ff006e)', fontSize: 11 }}
        >
          could not load holdings ({holdingsErr}) — in-portfolio column will show "—"
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              <th></th>
              <th
                onClick={() => toggleSort('ticker')}
                style={{ cursor: 'pointer' }}
                title="Sort by ticker"
              >
                Ticker{sortIndicator('ticker')}
              </th>
              <th>In portfolio?</th>
              <th>Theme</th>
              <th
                className="r"
                onClick={() => toggleSort('cap_b')}
                style={{ cursor: 'pointer' }}
                title="Sort by market cap"
              >
                Cap ($B){sortIndicator('cap_b')}
              </th>
              <th
                className="r"
                onClick={() => toggleSort('score')}
                style={{ cursor: 'pointer' }}
                title="Sort by conviction score"
              >
                Score{sortIndicator('score')}
              </th>
              <th className="r">D/E</th>
              <th className="r">GM%</th>
              <th className="r">ROE%</th>
              <th
                className="r"
                onClick={() => toggleSort('altman_z')}
                style={{ cursor: 'pointer' }}
                title="Sort by Altman Z"
              >
                Altman Z{sortIndicator('altman_z')}
              </th>
              <th>200DMA</th>
              <th>RSI</th>
              <th
                className="r"
                onClick={() => toggleSort('fwd_pe')}
                style={{ cursor: 'pointer' }}
                title="Sort by forward P/E"
              >
                Fwd P/E{sortIndicator('fwd_pe')}
              </th>
              <th>MoS≥30%?</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((c, i) => {
              const owned = ownedAccounts.get(c.ticker.toUpperCase());
              const ownedTag = !owned
                ? '—'
                : owned.size > 1
                  ? 'Both'
                  : accountTag(Array.from(owned)[0]);
              return (
                <tr key={c.ticker}>
                  <td className="r" style={{ color: 'var(--ink-mute)', fontSize: 10 }}>
                    {i + 1}
                  </td>
                  <td>
                    <Link href={`/stock/${c.ticker}`} prefetch className="rv-ticker-link">
                      {c.ticker}
                    </Link>
                    <div style={{ color: 'var(--ink-mute)', fontSize: 10 }}>{c.name}</div>
                  </td>
                  <td>
                    {ownedTag === '—' ? (
                      <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>—</span>
                    ) : (
                      <span className="rv-chip buy" style={{ fontSize: 10 }}>
                        {ownedTag}
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--ink-dim)', fontSize: 11 }}>{c.theme}</td>
                  <td className="r">{fmt(c.cap_b, 2)}</td>
                  <td className={`r ${scoreClass(c.score)}`}>
                    <b>{c.score}</b>
                  </td>
                  <td className={`r ${c.de != null && c.de < 0.5 ? 'rv-up' : ''}`}>
                    {fmt(c.de, 2)}
                  </td>
                  <td className={`r ${c.gm_pct != null && c.gm_pct > 40 ? 'rv-up' : ''}`}>
                    {fmt(c.gm_pct, 1)}
                  </td>
                  <td className={`r ${c.roe_pct != null ? (c.roe_pct >= 0 ? 'rv-up' : 'rv-dn') : ''}`}>
                    {fmt(c.roe_pct, 1)}
                  </td>
                  <td
                    className={`r ${
                      c.altman_z != null
                        ? c.altman_z >= 2.99
                          ? 'rv-up'
                          : c.altman_z >= 1.81
                            ? ''
                            : 'rv-dn'
                        : ''
                    }`}
                  >
                    {fmt(c.altman_z, 2)}
                  </td>
                  <td>
                    {c.above_200dma == null ? (
                      <span style={{ color: 'var(--ink-mute)' }}>—</span>
                    ) : c.above_200dma ? (
                      <span className="rv-chip buy" style={{ fontSize: 10 }}>
                        above
                      </span>
                    ) : (
                      <span className="rv-chip sell" style={{ fontSize: 10 }}>
                        below
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--ink-dim)', fontSize: 10 }}>
                    {c.rsi_signal ?? '—'}
                  </td>
                  <td className="r">{c.fwd_pe == null ? 'n/a' : fmt(c.fwd_pe, 1)}</td>
                  <td>
                    {c.mos_30 == null ? (
                      <span style={{ color: 'var(--ink-mute)' }}>—</span>
                    ) : c.mos_30 ? (
                      <span className="rv-chip buy" style={{ fontSize: 10 }}>
                        yes
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>no</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--ink-dim)', fontSize: 11, maxWidth: 280 }}>
                    {c.verdict}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
