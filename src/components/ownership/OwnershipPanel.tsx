'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  fmtPct,
  fmtShares,
  fmtDate,
  truncate,
  GREEN,
  PINK,
  GOLD,
  BLUE,
  MUTE,
  PCT_CHANGE_OUTLIER_THRESHOLD,
} from './_format';
import InsidersSubPanel, { type InsidersData } from './InsidersSubPanel';
import TradesSubPanel, { type Trade } from './TradesSubPanel';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip);

interface TopHolder {
  holder: string | null;
  sharesHeld: number | null;
  pctHeld: number | null;       // decimal, 0..1, derived from sharesHeld/SO when available
  pctChange: number | null;     // decimal, can be negative
  dateReported: number | null;  // epoch ms
  value: number | null;
}

interface OwnershipData {
  ticker: string;
  breakdown: {
    institutionalPct: number | null;
    insiderPct: number | null;
    retailPct: number | null;
  };
  floatShares: number | null;
  sharesOutstanding: number | null;
  topHolders: TopHolder[];
  insiders: InsidersData;
  trades: Trade[];
}

type SubTab = 'holders' | 'insiders' | 'trades';

const INSIDER_TOOLTIP =
  "Yahoo's insider % counts 13D/G beneficial-owner vehicles (e.g. Lake Harriet, Revolve, Bayshore for WULF) as insiders. \"Direct\" is the sum of officer/director directly-held shares from the SEC insider roster.";

const OUTLIER_TOOLTIP =
  'yfinance reports an unusually large change. Likely a stale-vs-fresh report base — verify on SEC 13F.';

function BreakdownTile({
  label,
  value,
  color,
  secondary,
  tooltip,
}: {
  label: string;
  value: number | null;
  color: string;
  secondary?: { label: string; value: number | null } | null;
  tooltip?: string;
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
      title={tooltip}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--ink-mute)',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {label}
        {tooltip && (
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '1px solid var(--ink-mute)',
              fontSize: 8,
              color: 'var(--ink-mute)',
              cursor: 'help',
            }}
          >
            i
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: 22,
          color,
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
        }}
      >
        {fmtPct(value, 2)}
      </span>
      {secondary && secondary.value !== null && Number.isFinite(secondary.value) && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-dim)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {secondary.label}: {fmtPct(secondary.value, 2)}
        </span>
      )}
    </div>
  );
}

function SubTabStrip({
  active,
  onChange,
}: {
  active: SubTab;
  onChange: (next: SubTab) => void;
}) {
  const tabs: { id: SubTab; label: string }[] = [
    { id: 'holders', label: 'Holders' },
    { id: 'insiders', label: 'Insiders' },
    { id: 'trades', label: 'Trades' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' }}>
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className="rv-btn ghost"
          style={{
            borderRadius: 0,
            border: 0,
            borderBottom: active === id ? '2px solid var(--pink)' : '2px solid transparent',
            color: active === id ? 'var(--ink)' : 'var(--ink-mute)',
            padding: '8px 12px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.04em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
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
        label: (ctx) => `Δ position: ${(Number(ctx.parsed.y) * 100).toFixed(2)}%`,
      },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(38,39,45,0.4)' },
      ticks: {
        color: '#a3a3a8',
        font: { size: 9, family: 'JetBrains Mono, monospace' },
        maxRotation: 60,
        minRotation: 30,
      },
    },
    y: {
      grid: { color: 'rgba(38,39,45,0.4)' },
      ticks: {
        color: '#a3a3a8',
        font: { size: 10, family: 'JetBrains Mono, monospace' },
        callback: (v) => `${(Number(v) * 100).toFixed(0)}%`,
      },
    },
  },
});

function HoldersSubPanel({ topHolders }: { topHolders: TopHolder[] }) {
  const holdersWithChange = topHolders.filter(
    (h) => h.pctChange !== null && Number.isFinite(h.pctChange),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="rv-card" style={{ margin: 0 }}>
        <div className="rv-card-head">
          <h3>Top Institutional Holders</h3>
          <div className="tools">
            <span>{topHolders.length} HOLDERS</span>
          </div>
        </div>
        {topHolders.length === 0 ? (
          <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '12px 0' }}>
            No institutional-holder data available for this ticker.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rv-table">
              <thead>
                <tr>
                  <th>Holder</th>
                  <th className="r">Shares Held</th>
                  <th className="r">% Held</th>
                  <th>Date Reported</th>
                  <th className="r">Δ Position</th>
                </tr>
              </thead>
              <tbody>
                {topHolders.map((h, i) => {
                  const ch = h.pctChange;
                  const outlier = ch !== null && Math.abs(ch) > PCT_CHANGE_OUTLIER_THRESHOLD;
                  const pos = ch !== null && ch >= 0;
                  const cellColor =
                    ch === null
                      ? 'var(--ink-mute)'
                      : outlier
                        ? 'var(--ink-mute)'
                        : pos
                          ? GREEN
                          : PINK;
                  return (
                    <tr key={`${h.holder ?? 'h'}-${i}`}>
                      <td>{h.holder ?? '—'}</td>
                      <td className="r">{fmtShares(h.sharesHeld)}</td>
                      <td className="r">{fmtPct(h.pctHeld, 2)}</td>
                      <td>{fmtDate(h.dateReported)}</td>
                      <td
                        className="r"
                        style={{ color: cellColor }}
                        title={outlier ? OUTLIER_TOOLTIP : undefined}
                      >
                        {ch === null
                          ? '—'
                          : `${pos ? '+' : ''}${(ch * 100).toFixed(2)}%${outlier ? ' ⚠' : ''}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rv-card" style={{ margin: 0 }}>
        <div className="rv-card-head">
          <h3>Position Change by Holder</h3>
        </div>
        {holdersWithChange.length === 0 ? (
          <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '12px 0' }}>
            No quarter-over-quarter change data reported.
          </div>
        ) : (
          <div style={{ height: 260 }}>
            <Bar
              data={{
                labels: holdersWithChange.map((h) => truncate(h.holder ?? '—', 18)),
                datasets: [
                  {
                    label: 'Δ Position',
                    data: holdersWithChange.map((h) => h.pctChange ?? 0),
                    backgroundColor: holdersWithChange.map((h) => {
                      const ch = h.pctChange ?? 0;
                      if (Math.abs(ch) > PCT_CHANGE_OUTLIER_THRESHOLD) return MUTE;
                      return ch >= 0 ? GREEN : PINK;
                    }),
                    borderWidth: 0,
                  },
                ],
              }}
              options={chartOpts()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function OwnershipPanel({ ticker }: { ticker: string }) {
  const [data, setData] = useState<OwnershipData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('holders');

  const fetchOwnership = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/market/${ticker}/ownership`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Ownership fetch failed: ${res.status}`);
      const payload = (await res.json()) as OwnershipData;
      setData(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load ownership');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    void fetchOwnership();
  }, [fetchOwnership]);

  const directInsiderTile = useMemo(() => {
    if (!data) return null;
    const direct = data.insiders?.directInsiderPct;
    if (direct === null || direct === undefined) return null;
    return { label: 'Direct', value: direct };
  }, [data]);

  if (loading) {
    return (
      <div className="rv-card">
        <div className="rv-card-head">
          <h3>Ownership</h3>
        </div>
        <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '24px 0' }}>
          Loading ownership data…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rv-card">
        <div className="rv-card-head">
          <h3>Ownership</h3>
        </div>
        <div style={{ color: 'var(--pink)', fontSize: 12, padding: '24px 0' }}>
          {error ?? 'No data'}
        </div>
      </div>
    );
  }

  const { breakdown } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
        }}
      >
        <BreakdownTile label="Institutional" value={breakdown.institutionalPct} color={BLUE} />
        <BreakdownTile
          label="Insider"
          value={breakdown.insiderPct}
          color={GOLD}
          secondary={directInsiderTile}
          tooltip={INSIDER_TOOLTIP}
        />
        <BreakdownTile label="Retail" value={breakdown.retailPct} color={GREEN} />
      </div>

      <SubTabStrip active={subTab} onChange={setSubTab} />

      {subTab === 'holders' && <HoldersSubPanel topHolders={data.topHolders} />}
      {subTab === 'insiders' && (
        <InsidersSubPanel insiders={data.insiders} sharesOutstanding={data.sharesOutstanding} />
      )}
      {subTab === 'trades' && <TradesSubPanel trades={data.trades} />}
    </div>
  );
}
