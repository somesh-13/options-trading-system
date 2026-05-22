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

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip);

const GREEN = '#00C805';
const PINK = '#FF006E';
const MUTE = 'rgba(163,163,168,0.55)';
const ACCENT = '#FFD700';

interface HistoryPoint {
  settlementDate: string;          // "YYYY-MM-DD"
  shortInterest: number | null;
  previousShortInterest: number | null;
  changePercent: number | null;    // FINRA gives whole-percent units (e.g. -4.9, 17.24)
  daysToCover: number | null;
  avgDailyVolume: number | null;
  market: string | null;
}

interface ShortInterestData {
  ticker: string;
  sharesShort: number | null;
  sharesShortPriorMonth: number | null;
  shortPercentOfFloat: number | null;
  shortRatio: number | null;
  floatShares: number | null;
  sharesOutstanding: number | null;
  asOf: number | null;
  priorAsOf: number | null;
  history: HistoryPoint[];
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtShares(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toLocaleString();
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().slice(0, 10);
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

type ChartMode = 'shares' | 'pctFloat';

const historyChartOpts = (mode: ChartMode): ChartOptions<'bar'> => ({
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
        title: (items) => items[0]?.label ?? '',
        label: (ctx) => {
          const y = Number(ctx.parsed.y);
          if (mode === 'pctFloat') {
            return `Short: ${(y * 100).toFixed(2)}% of float`;
          }
          return `Shares short: ${fmtShares(y)}`;
        },
        afterLabel: (ctx) => {
          const ds = ctx.dataset as unknown as {
            _meta?: {
              daysToCover: (number | null)[];
              changePct: (number | null)[];
              shares: (number | null)[];
              pctFloat: (number | null)[];
            };
          };
          const meta = ds._meta;
          if (!meta) return '';
          const d2c = meta.daysToCover[ctx.dataIndex];
          const ch = meta.changePct[ctx.dataIndex];
          const shares = meta.shares[ctx.dataIndex];
          const pct = meta.pctFloat[ctx.dataIndex];
          const lines: string[] = [];
          // Show the *other* metric in the tooltip so the user always sees both.
          if (mode === 'pctFloat') {
            if (shares !== null && shares !== undefined && Number.isFinite(shares)) {
              lines.push(`Shares short: ${fmtShares(shares)}`);
            }
          } else if (pct !== null && pct !== undefined && Number.isFinite(pct)) {
            lines.push(`% of float: ${(pct * 100).toFixed(2)}%`);
          }
          if (d2c !== null && d2c !== undefined && Number.isFinite(d2c)) {
            lines.push(`Days to cover: ${d2c.toFixed(2)}`);
          }
          if (ch !== null && ch !== undefined && Number.isFinite(ch)) {
            const sign = ch >= 0 ? '+' : '';
            lines.push(`Δ vs prior: ${sign}${ch.toFixed(2)}%`);
          }
          return lines.join('\n');
        },
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
        minRotation: 45,
        autoSkip: true,
        maxTicksLimit: 14,
      },
    },
    y: {
      grid: { color: 'rgba(38,39,45,0.4)' },
      ticks: {
        color: '#a3a3a8',
        font: { size: 10, family: 'JetBrains Mono, monospace' },
        callback: (v) =>
          mode === 'pctFloat'
            ? `${(Number(v) * 100).toFixed(1)}%`
            : fmtShares(Number(v)),
      },
    },
  },
});

const snapshotChartOpts = (): ChartOptions<'bar'> => ({
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
        label: (ctx) => `Shares short: ${fmtShares(Number(ctx.parsed.y))}`,
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

export default function ShortInterestPanel({ ticker }: { ticker: string }) {
  const [data, setData] = useState<ShortInterestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('shares');

  const fetchShort = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/market/${ticker}/short-interest`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Short interest fetch failed: ${res.status}`);
      const payload = (await res.json()) as ShortInterestData;
      setData(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load short interest');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    void fetchShort();
  }, [fetchShort]);

  // FINRA returns history newest-first; the chart renders left→right oldest→newest.
  const orderedHistory = useMemo(() => {
    if (!data?.history?.length) return [];
    return [...data.history].reverse();
  }, [data]);

  // Derive % of float per settlement using the *current* float as the divisor.
  // Float changes over time (buybacks, secondaries) but FINRA doesn't publish
  // historical float, and the current float is the same denominator users see
  // on every other site (Yahoo, Fintel) — so this matches their mental model.
  const pctFloatHistory = useMemo(() => {
    const denom = data?.floatShares;
    if (!denom || !Number.isFinite(denom) || denom <= 0) return null;
    return orderedHistory.map((p) =>
      p.shortInterest !== null && Number.isFinite(p.shortInterest)
        ? (p.shortInterest as number) / denom
        : null,
    );
  }, [orderedHistory, data?.floatShares]);

  // If there's no float, the % toggle wouldn't make sense — pin the mode to shares.
  const effectiveMode: ChartMode = pctFloatHistory ? chartMode : 'shares';

  if (loading) {
    return (
      <div className="rv-card">
        <div className="rv-card-head">
          <h3>Short Interest</h3>
        </div>
        <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '24px 0' }}>
          Loading short interest…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rv-card">
        <div className="rv-card-head">
          <h3>Short Interest</h3>
        </div>
        <div style={{ color: 'var(--pink)', fontSize: 12, padding: '24px 0' }}>
          {error ?? 'No data'}
        </div>
      </div>
    );
  }

  const { sharesShort, sharesShortPriorMonth, shortPercentOfFloat, shortRatio, asOf, priorAsOf } = data;

  const hasCurrent = sharesShort !== null && Number.isFinite(sharesShort);
  const hasPrior = sharesShortPriorMonth !== null && Number.isFinite(sharesShortPriorMonth);
  const rising =
    hasCurrent && hasPrior && (sharesShort as number) > (sharesShortPriorMonth as number);
  const trendColor = rising ? PINK : GREEN;

  const hasHistory = orderedHistory.length > 0;
  const latestSettlement = data.history?.[0]?.settlementDate ?? null;
  const oldestSettlement = data.history?.[data.history.length - 1]?.settlementDate ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <StatTile label="% of Float" value={fmtPct(shortPercentOfFloat)} color={trendColor} />
        <StatTile label="Days to Cover" value={fmtNum(shortRatio)} />
        <StatTile label="Shares Short" value={fmtShares(sharesShort)} />
        <StatTile label="As of" value={fmtDate(asOf)} />
      </div>

      {hasHistory ? (
        <div className="rv-card" style={{ margin: 0 }}>
          <div className="rv-card-head">
            <h3>Short Interest History — FINRA Bi-monthly</h3>
            <div className="tools" style={{ alignItems: 'center', gap: 8 }}>
              {pctFloatHistory && (
                <div
                  role="tablist"
                  aria-label="Chart units"
                  style={{
                    display: 'flex',
                    gap: 0,
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  {(['shares', 'pctFloat'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={effectiveMode === m}
                      onClick={() => setChartMode(m)}
                      style={{
                        padding: '2px 8px',
                        background: effectiveMode === m ? 'var(--line)' : 'transparent',
                        color: effectiveMode === m ? 'var(--ink)' : 'var(--ink-mute)',
                        border: 0,
                        cursor: 'pointer',
                        fontSize: 10,
                        fontFamily: "'JetBrains Mono', monospace",
                        textTransform: 'uppercase',
                        letterSpacing: '.04em',
                      }}
                    >
                      {m === 'shares' ? 'Shares' : '% Float'}
                    </button>
                  ))}
                </div>
              )}
              <span>{orderedHistory.length} SETTLEMENTS</span>
              {oldestSettlement && latestSettlement && (
                <span style={{ color: 'var(--ink-mute)' }}>
                  {oldestSettlement} → {latestSettlement}
                </span>
              )}
            </div>
          </div>
          <div style={{ height: 280 }}>
            <Bar
              data={{
                labels: orderedHistory.map((p) => p.settlementDate),
                datasets: [
                  {
                    label: effectiveMode === 'pctFloat' ? '% of Float' : 'Shares Short',
                    data:
                      effectiveMode === 'pctFloat' && pctFloatHistory
                        ? pctFloatHistory.map((v) => v ?? 0)
                        : orderedHistory.map((p) => p.shortInterest ?? 0),
                    backgroundColor: orderedHistory.map((p, i) => {
                      if (i === orderedHistory.length - 1) return ACCENT;
                      const ch = p.changePercent;
                      if (ch === null || ch === undefined || !Number.isFinite(ch)) return MUTE;
                      return ch >= 0 ? PINK : GREEN;
                    }),
                    borderWidth: 0,
                    // Stash per-bar metadata for the tooltip — Chart.js exposes
                    // dataset properties on the tooltip context, so this
                    // round-trips without external state.
                    _meta: {
                      daysToCover: orderedHistory.map((p) => p.daysToCover),
                      changePct: orderedHistory.map((p) => p.changePercent),
                      shares: orderedHistory.map((p) => p.shortInterest),
                      pctFloat: pctFloatHistory ?? orderedHistory.map(() => null),
                    },
                  } as unknown as import('chart.js').ChartDataset<'bar'>,
                ],
              }}
              options={historyChartOpts(effectiveMode)}
            />
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--ink-mute)',
              marginTop: 8,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Bars colored by period-over-period Δ (pink = rising, green = falling). Latest
            settlement highlighted in gold. Data: FINRA Consolidated Short Interest.
            {effectiveMode === 'pctFloat' && (
              <> % computed against the current float ({fmtShares(data.floatShares)}); FINRA does not publish historical float.</>
            )}
          </div>
        </div>
      ) : (
        <div className="rv-card" style={{ margin: 0 }}>
          <div className="rv-card-head">
            <h3>Short Interest — Prior vs Current</h3>
            <div className="tools">
              <span style={{ color: trendColor }}>{rising ? 'RISING' : 'FALLING'}</span>
            </div>
          </div>
          {!hasCurrent && !hasPrior ? (
            <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '12px 0' }}>
              No short-interest data available for this ticker.
            </div>
          ) : (
            <>
              <div style={{ height: 220 }}>
                <Bar
                  data={{
                    labels: [
                      `Prior${priorAsOf ? ` (${fmtDate(priorAsOf)})` : ''}`,
                      `Current${asOf ? ` (${fmtDate(asOf)})` : ''}`,
                    ],
                    datasets: [
                      {
                        label: 'Shares Short',
                        data: [sharesShortPriorMonth ?? 0, sharesShort ?? 0],
                        backgroundColor: [MUTE, rising ? PINK : GREEN],
                        borderWidth: 0,
                      },
                    ],
                  }}
                  options={snapshotChartOpts()}
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--ink-mute)',
                  marginTop: 8,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                FINRA bi-monthly history not available for this ticker — falling back to
                yfinance prior-vs-current snapshot.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
