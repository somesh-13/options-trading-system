'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  ChartOptions,
  TooltipItem,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { ChartSeries, EquityPoint, RANGE_PRESETS } from './types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
);

/** Convert a hex like '#22D3EE' to 'rgba(34,211,238,alpha)' for soft glow fills. */
function withAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface Props {
  series: ChartSeries[];
  /** ID of the focused series (slightly bolder line, used for tooltip primary value). */
  focusedId?: string;
  /** Toggle for "Drawdown" view that re-derives each series as % drawdown from running peak. */
  defaultView?: 'equity' | 'drawdown';
  /** Initial capital for cumulative-return tooltip math. */
  initialCapital: number;
  /** Title shown in the chart card header. */
  title: string;
  /** Optional small subtitle / status pill content. */
  subtitle?: string;
  /** Called when the user clicks an action button (Export/Save/etc.). */
  onAction?: (action: 'export-png' | 'export-csv' | 'reset') => void;
}

type RangeId = (typeof RANGE_PRESETS)[number]['id'];

/** Slice points to the requested time window. Returns a *new* points array. */
function applyRange(points: EquityPoint[], rangeId: RangeId): EquityPoint[] {
  if (!points.length || rangeId === 'MAX') return points;
  const preset = RANGE_PRESETS.find((r) => r.id === rangeId);
  if (!preset) return points;
  const last = new Date(points[points.length - 1].date);
  let cutoff: Date;
  if (preset.days === 'ytd') {
    cutoff = new Date(last.getFullYear(), 0, 1);
  } else if (preset.days === 'max') {
    return points;
  } else {
    cutoff = new Date(last);
    cutoff.setDate(cutoff.getDate() - preset.days);
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= cutoffStr);
}

/** Derive drawdown curve (%, negative) from an equity curve. */
function toDrawdown(points: EquityPoint[]): EquityPoint[] {
  let peak = -Infinity;
  return points.map((p) => {
    peak = Math.max(peak, p.equity);
    const dd = peak > 0 ? (100 * (p.equity - peak)) / peak : 0;
    return { date: p.date, equity: dd };
  });
}

export default function HeroPerformanceChart({
  series,
  focusedId,
  defaultView = 'equity',
  initialCapital,
  title,
  subtitle,
  onAction,
}: Props) {
  const [rangeId, setRangeId] = useState<RangeId>('MAX');
  const [view, setView] = useState<'equity' | 'drawdown'>(defaultView);
  const [logScale, setLogScale] = useState(false);
  const [visibleIds, setVisibleIds] = useState<Record<string, boolean>>({});
  const chartRef = useRef<ChartJS<'line'> | null>(null);

  // Project each series to the chosen window + view.
  const projected = useMemo(() => {
    return series.map((s) => {
      const windowed = applyRange(s.points, rangeId);
      const pts = view === 'drawdown' ? toDrawdown(windowed) : windowed;
      return { ...s, points: pts };
    });
  }, [series, rangeId, view]);

  // Pick a unified time axis from the longest projected series.
  const labels = useMemo(() => {
    const longest = projected.reduce<EquityPoint[]>(
      (acc, s) => (s.points.length > acc.length ? s.points : acc),
      [],
    );
    return longest.map((p) => p.date);
  }, [projected]);

  // Index lookup so each series can backfill into the unified label axis.
  const data = useMemo(() => {
    return {
      labels,
      datasets: projected
        .filter((s) => visibleIds[s.id] !== false)
        .map((s) => {
          const byDate = new Map(s.points.map((p) => [p.date, p.equity]));
          const values = labels.map((d) => (byDate.has(d) ? byDate.get(d)! : null));
          const isFocused = s.id === focusedId;
          return {
            label: s.label,
            data: values,
            borderColor: s.color,
            backgroundColor: s.isBenchmark
              ? 'transparent'
              : withAlpha(s.color, isFocused ? 0.18 : 0.08),
            borderWidth: isFocused ? 2.25 : 1.6,
            borderDash: s.dashed ? [4, 4] : undefined,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBorderWidth: 2,
            pointHoverBackgroundColor: s.color,
            pointHoverBorderColor: '#0b0b0d',
            tension: 0.05,
            fill: !s.isBenchmark && view === 'equity',
            spanGaps: true,
          };
        }),
    };
  }, [projected, labels, focusedId, visibleIds, view]);

  const options: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0b0b0d',
          borderColor: '#26272d',
          borderWidth: 1,
          titleColor: '#e5e7eb',
          bodyColor: '#cbd5e1',
          padding: 10,
          displayColors: true,
          callbacks: {
            title: (items) => items[0]?.label ?? '',
            label: (item: TooltipItem<'line'>) => {
              const v = item.parsed.y;
              if (v == null) return ` ${item.dataset.label}: —`;
              if (view === 'drawdown') {
                return ` ${item.dataset.label}: ${v.toFixed(2)}%`;
              }
              const cum = initialCapital ? ((v - initialCapital) / initialCapital) * 100 : 0;
              return ` ${item.dataset.label}: $${v.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })} (${cum >= 0 ? '+' : ''}${cum.toFixed(2)}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#6b7280',
            maxTicksLimit: 8,
            font: { size: 10 },
          },
          grid: { color: 'rgba(38,39,45,0.7)', drawTicks: false },
          border: { display: false },
        },
        y: {
          type: logScale && view === 'equity' ? 'logarithmic' : 'linear',
          ticks: {
            color: '#6b7280',
            font: { size: 10, family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            callback: (val: string | number) => {
              const n = typeof val === 'number' ? val : Number(val);
              if (view === 'drawdown') return `${n.toFixed(0)}%`;
              if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
              if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
              return `$${n.toFixed(0)}`;
            },
          },
          grid: { color: 'rgba(38,39,45,0.7)', drawTicks: false },
          border: { display: false },
        },
      },
    }),
    [logScale, view, initialCapital],
  );

  const exportCsv = () => {
    const rows = [
      ['date', ...projected.map((s) => s.label)].join(','),
      ...labels.map((d, i) => {
        const cells = projected.map((s) => {
          const byDate = new Map(s.points.map((p) => [p.date, p.equity]));
          const v = byDate.get(d);
          return v == null ? '' : v.toFixed(4);
        });
        return [d, ...cells].join(',');
      }),
    ];
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest-${view}-${rangeId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onAction?.('export-csv');
  };

  const exportPng = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.toBase64Image('image/png', 1.0);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest-${view}-${rangeId}.png`;
    a.click();
    onAction?.('export-png');
  };

  const toggleVisible = (id: string) => {
    setVisibleIds((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));
  };

  return (
    <section
      className="rounded-2xl border border-[#1f2027] bg-[#0b0b0d] shadow-[0_0_0_1px_rgba(34,211,238,0.04)_inset,0_20px_60px_-30px_rgba(0,0,0,0.8)]"
    >
      {/* Header row */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#16171c]">
        <div className="flex-1 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-white tracking-tight truncate">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setRangeId(p.id)}
              className={`px-2 py-1 text-[11px] font-medium rounded-md tabular-nums transition-colors ${
                rangeId === p.id
                  ? 'bg-[#22D3EE]/15 text-[#22D3EE] ring-1 ring-inset ring-[#22D3EE]/40'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="w-px h-5 bg-[#26272d] mx-1" />
          <button
            onClick={() => setView(view === 'equity' ? 'drawdown' : 'equity')}
            className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
              view === 'drawdown'
                ? 'bg-[#FF006E]/15 text-[#FF006E] ring-1 ring-inset ring-[#FF006E]/40'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
            title="Toggle drawdown view"
          >
            DD
          </button>
          <button
            onClick={() => setLogScale(!logScale)}
            disabled={view === 'drawdown'}
            className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
              logScale && view === 'equity'
                ? 'bg-white/10 text-white ring-1 ring-inset ring-white/20'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent'
            }`}
            title="Logarithmic y-axis"
          >
            Log
          </button>
          <div className="w-px h-5 bg-[#26272d] mx-1" />
          <button
            onClick={exportPng}
            className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          >
            PNG
          </button>
          <button
            onClick={exportCsv}
            className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          >
            CSV
          </button>
        </div>
      </header>

      {/* Chart canvas */}
      <div className="px-2 sm:px-4 pt-3 pb-2">
        <div className="relative h-[320px] sm:h-[400px] lg:h-[460px]">
          {series.length === 0 || labels.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center text-gray-600 text-sm">
              Select a strategy and run a backtest to see the equity curve.
            </div>
          ) : (
            <Line ref={chartRef} data={data} options={options} />
          )}
        </div>
      </div>

      {/* Legend chips */}
      {projected.length > 0 && (
        <footer className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-[#16171c]">
          {projected.map((s) => {
            const hidden = visibleIds[s.id] === false;
            return (
              <button
                key={s.id}
                onClick={() => toggleVisible(s.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-tight transition-colors ${
                  hidden
                    ? 'bg-transparent text-gray-600 ring-1 ring-inset ring-[#26272d] hover:text-gray-400'
                    : 'bg-white/5 text-gray-200 hover:bg-white/10'
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: s.color,
                    boxShadow: s.isBenchmark
                      ? 'none'
                      : `0 0 8px ${withAlpha(s.color, 0.6)}`,
                    opacity: hidden ? 0.3 : 1,
                  }}
                />
                {s.label}
                {s.isBenchmark && (
                  <span className="text-[10px] text-gray-500 ml-0.5">bench</span>
                )}
              </button>
            );
          })}
        </footer>
      )}
    </section>
  );
}
