'use client';

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Title,
  ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { fmtShares, fmtMoney, fmtDate, GREEN, PINK } from './_format';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip);

export interface Trade {
  date: number | null;
  insider: string | null;
  position: string | null;
  transaction: string | null;
  text: string | null;
  shares: number | null;
  value: number | null;
  ownership: string | null; // "D" | "I"
}

type Direction = 'buy' | 'sell' | 'neutral';

function classifyTransaction(transaction: string | null, text: string | null): Direction {
  const blob = `${transaction ?? ''} ${text ?? ''}`.toLowerCase();
  if (!blob.trim()) return 'neutral';
  if (blob.includes('sale') || blob.includes('sold') || blob.includes('sell')) return 'sell';
  if (blob.includes('purchase') || blob.includes('buy') || blob.includes('bought')) return 'buy';
  return 'neutral';
}

function transactionLabel(t: Trade): string {
  const primary = t.transaction?.trim();
  if (primary) return primary;
  const txt = t.text?.trim();
  if (txt) return txt;
  return '—';
}

function OwnershipPill({ ownership }: { ownership: string | null }) {
  if (!ownership) return <span style={{ color: 'var(--ink-mute)' }}>—</span>;
  const isDirect = ownership.toUpperCase().startsWith('D');
  return (
    <span
      className="rv-pill"
      style={{
        fontSize: 9,
        padding: '1px 6px',
        borderColor: isDirect ? 'rgba(0,200,5,.35)' : 'rgba(255,215,0,.35)',
        background: isDirect ? 'rgba(0,200,5,.08)' : 'rgba(255,215,0,.08)',
        color: isDirect ? GREEN : 'var(--gold)',
      }}
      title={isDirect ? 'Direct ownership' : 'Indirect — entity / vehicle'}
    >
      {ownership.toUpperCase()}
    </span>
  );
}

function monthKey(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yr}-${mo}`;
}

const chartOpts = (): ChartOptions<'bar'> => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#0d0e11',
      borderColor: '#26272d',
      borderWidth: 1,
      titleColor: '#e6e6ea',
      bodyColor: '#a3a3a8',
      padding: 8,
      callbacks: {
        label: (ctx) => `Net: ${fmtShares(Number(ctx.parsed.y))}`,
      },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(38,39,45,0.4)' },
      ticks: { color: '#a3a3a8', font: { size: 10, family: 'JetBrains Mono, monospace' } },
    },
    y: {
      grid: { color: 'rgba(38,39,45,0.4)' },
      ticks: {
        color: '#a3a3a8',
        font: { size: 10, family: 'JetBrains Mono, monospace' },
        callback: (v) => fmtShares(Number(v)),
      },
    },
  },
});

export default function TradesSubPanel({ trades }: { trades: Trade[] }) {
  const monthlyNet = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const t of trades) {
      const key = monthKey(t.date);
      if (!key || t.shares === null || !Number.isFinite(t.shares)) continue;
      const dir = classifyTransaction(t.transaction, t.text);
      if (dir === 'neutral') continue;
      const signed = dir === 'buy' ? Math.abs(t.shares) : -Math.abs(t.shares);
      buckets.set(key, (buckets.get(key) ?? 0) + signed);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [trades]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {monthlyNet.length >= 3 && (
        <div className="rv-card" style={{ margin: 0 }}>
          <div className="rv-card-head">
            <h3>Net Insider Activity by Month</h3>
            <div className="tools">
              <span>{trades.length} TX</span>
            </div>
          </div>
          <div style={{ height: 180 }}>
            <Bar
              data={{
                labels: monthlyNet.map(([k]) => k),
                datasets: [
                  {
                    label: 'Net shares',
                    data: monthlyNet.map(([, v]) => v),
                    backgroundColor: monthlyNet.map(([, v]) => (v >= 0 ? GREEN : PINK)),
                    borderWidth: 0,
                  },
                ],
              }}
              options={chartOpts()}
            />
          </div>
        </div>
      )}

      <div className="rv-card" style={{ margin: 0 }}>
        <div className="rv-card-head">
          <h3>Recent Insider Transactions</h3>
          <div className="tools">
            <span>{trades.length} ROWS</span>
          </div>
        </div>
        {trades.length === 0 ? (
          <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '12px 0' }}>
            No insider transactions reported for this ticker.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rv-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Insider</th>
                  <th>Position</th>
                  <th>Transaction</th>
                  <th>Own</th>
                  <th className="r">Shares</th>
                  <th className="r">Value</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const dir = classifyTransaction(t.transaction, t.text);
                  const tint =
                    dir === 'buy'
                      ? 'rgba(0,200,5,0.05)'
                      : dir === 'sell'
                        ? 'rgba(255,0,110,0.05)'
                        : 'transparent';
                  const txColor = dir === 'buy' ? GREEN : dir === 'sell' ? PINK : 'var(--ink-dim)';
                  const label = transactionLabel(t);
                  return (
                    <tr key={`${t.date ?? 'd'}-${i}`} style={{ background: tint }}>
                      <td>{fmtDate(t.date)}</td>
                      <td>{t.insider ?? '—'}</td>
                      <td style={{ color: 'var(--ink-dim)' }}>{t.position ?? '—'}</td>
                      <td style={{ color: txColor, maxWidth: 320, whiteSpace: 'normal' }}>{label}</td>
                      <td>
                        <OwnershipPill ownership={t.ownership} />
                      </td>
                      <td className="r">{fmtShares(t.shares)}</td>
                      <td className="r">{fmtMoney(t.value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
