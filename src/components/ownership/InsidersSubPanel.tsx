'use client';

import { fmtPct, fmtShares, fmtDate, GOLD, BLUE } from './_format';

export interface InsiderRosterEntry {
  name: string | null;
  position: string | null;
  sharesDirect: number | null;
  sharesIndirect: number | null;
  totalShares: number | null;
  pctOfSharesOutstanding: number | null;
  latestTransaction: string | null;
  latestTransactionDate: number | null;
}

export interface InsidersData {
  yahooInsiderPct: number | null;
  directInsiderPct: number | null;
  roster: InsiderRosterEntry[];
}

function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      className="rv-card"
      style={{
        margin: 0,
        padding: '12px 14px',
        background: '#0d0e11',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          color: color ?? 'var(--ink)',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function InsidersSubPanel({
  insiders,
  sharesOutstanding,
}: {
  insiders: InsidersData;
  sharesOutstanding: number | null;
}) {
  const roster = insiders?.roster ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <StatTile
          label="Direct Insider %"
          value={fmtPct(insiders?.directInsiderPct ?? null, 2)}
          color={GOLD}
        />
        <StatTile
          label="Yahoo Insider %"
          value={fmtPct(insiders?.yahooInsiderPct ?? null, 2)}
          color={BLUE}
        />
        <StatTile label="Insiders Listed" value={String(roster.length)} />
        <StatTile label="Shares Outstanding" value={fmtShares(sharesOutstanding)} />
      </div>

      <div className="rv-card" style={{ margin: 0 }}>
        <div className="rv-card-head">
          <h3>Insider Roster</h3>
          <div className="tools">
            <span>SEC Form 4 / Yahoo</span>
          </div>
        </div>
        {roster.length === 0 ? (
          <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '12px 0' }}>
            No insider roster reported for this ticker.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rv-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th className="r">Shares Direct</th>
                  <th className="r">Shares Indirect</th>
                  <th className="r">Total</th>
                  <th className="r">% S/O</th>
                  <th>Last Tx</th>
                  <th>Last Tx Date</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r, i) => (
                  <tr key={`${r.name ?? 'i'}-${i}`}>
                    <td>{r.name ?? '—'}</td>
                    <td style={{ color: 'var(--ink-dim)' }}>{r.position ?? '—'}</td>
                    <td className="r">{fmtShares(r.sharesDirect)}</td>
                    <td className="r">{fmtShares(r.sharesIndirect)}</td>
                    <td className="r" style={{ color: 'var(--ink)' }}>
                      {fmtShares(r.totalShares)}
                    </td>
                    <td className="r">{fmtPct(r.pctOfSharesOutstanding, 3)}</td>
                    <td style={{ color: 'var(--ink-dim)' }}>{r.latestTransaction ?? '—'}</td>
                    <td>{fmtDate(r.latestTransactionDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
