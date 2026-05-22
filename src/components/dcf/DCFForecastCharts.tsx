'use client';

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

interface DCFForecastResults {
  revenues: number[];
  /** Layered split for the contract-aware DCF: when present and any
   *  contractRevenues entry is > 0, the Projected Revenue panel renders as a
   *  stacked Base + Contracts bar. Falls back to a single bar otherwise so
   *  the contract-layer-OFF visual is unchanged. */
  baseRevenues?: number[];
  contractRevenues?: number[];
  nopat: number[];
  fcf: number[];
  fairPrice: number;
  deltaPercent: number;
}

interface Props {
  results: DCFForecastResults;
  /** Used to label "Year 1 → Year 5" — currently the model's horizon is 5y. */
  years?: string[];
  currentPrice?: number;
  /** Optional row of inputs rendered directly under the Projected Revenue
   *  panel, so users can manually override each year's revenue. The bars
   *  stay in sync because the parent recomputes `results.revenues` from the
   *  override state. */
  revenueOverrideRow?: React.ReactNode;
}

const POSITIVE_GREEN = '#00C805';
const NEGATIVE_PINK = '#FF006E';
const GOLD = '#FFD700';
const BLUE = '#4c9aff';

function fmtM(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}B`;
  return `${sign}$${abs.toFixed(0)}M`;
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function chartOpts(seriesLabel: string, stacked = false): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: stacked, labels: { color: '#a3a3a8', font: { size: 10 } } },
      tooltip: {
        backgroundColor: '#0d0e11',
        borderColor: '#26272d',
        borderWidth: 1,
        titleColor: '#e6e6ea',
        bodyColor: '#a3a3a8',
        padding: 8,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label || seriesLabel}: ${fmtM(ctx.parsed.y as number)}`,
        },
      },
    },
    scales: {
      x: {
        stacked,
        grid: { color: 'rgba(38,39,45,0.4)' },
        ticks: { color: '#a3a3a8', font: { size: 10, family: 'JetBrains Mono, monospace' } },
      },
      y: {
        stacked,
        grid: { color: 'rgba(38,39,45,0.4)' },
        ticks: {
          color: '#a3a3a8',
          font: { size: 10, family: 'JetBrains Mono, monospace' },
          callback: (v) => fmtM(Number(v)),
        },
      },
    },
  };
}

interface PanelProps {
  title: string;
  values: number[];
  labels: string[];
  color: string;
  /** When true, negative bars get pink. */
  flipNegative?: boolean;
}

function ForecastPanel({ title, values, labels, color, flipNegative }: PanelProps) {
  const colors = values.map((v) => (flipNegative && v < 0 ? NEGATIVE_PINK : color));
  const first = values[0];
  const last = values[values.length - 1];
  const totalChangePct = first !== 0 && Number.isFinite(first) ? ((last - first) / Math.abs(first)) * 100 : 0;

  return (
    <div
      className="rv-card"
      style={{
        padding: '10px 14px',
        background: '#0d0e11',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 13, color: 'var(--ink)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          {fmtM(last)}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: totalChangePct >= 0 ? POSITIVE_GREEN : NEGATIVE_PINK,
            fontFamily: "'JetBrains Mono', monospace",
            marginLeft: 'auto',
          }}
          title={`5-year cumulative change vs Year 1 (${fmtM(first)})`}
        >
          5y: {fmtPct(totalChangePct)}
        </span>
      </div>
      <div style={{ height: 130 }}>
        <Bar
          data={{
            labels,
            datasets: [{
              label: title,
              data: values,
              backgroundColor: colors,
              borderColor: colors,
              borderWidth: 0,
            }],
          }}
          options={chartOpts(title)}
        />
      </div>
    </div>
  );
}

interface StackedPanelProps {
  base: number[];
  contracts: number[];
  totals: number[];
  labels: string[];
}

function StackedRevenuePanel({ base, contracts, totals, labels }: StackedPanelProps) {
  const last = totals[totals.length - 1];
  const first = totals[0];
  const totalChangePct = first !== 0 && Number.isFinite(first) ? ((last - first) / Math.abs(first)) * 100 : 0;
  const lastContractShare = last !== 0 ? (contracts[contracts.length - 1] / last) * 100 : 0;

  return (
    <div
      className="rv-card"
      style={{
        padding: '10px 14px',
        background: '#0d0e11',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 500 }}>
          Projected Revenue (Base + Contracts)
        </span>
        <span style={{ fontSize: 13, color: 'var(--ink)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          {fmtM(last)}
        </span>
        <span
          title="Contract share of last-year revenue"
          style={{ fontSize: 10.5, color: GOLD, fontFamily: "'JetBrains Mono', monospace" }}
        >
          {lastContractShare.toFixed(1)}% from contracts
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: totalChangePct >= 0 ? POSITIVE_GREEN : NEGATIVE_PINK,
            fontFamily: "'JetBrains Mono', monospace",
            marginLeft: 'auto',
          }}
          title={`5-year cumulative change vs Year 1 (${fmtM(first)})`}
        >
          5y: {fmtPct(totalChangePct)}
        </span>
      </div>
      <div style={{ height: 150 }}>
        <Bar
          data={{
            labels,
            datasets: [
              {
                label: 'Base',
                data: base,
                backgroundColor: BLUE,
                borderColor: BLUE,
                borderWidth: 0,
                stack: 'rev',
              },
              {
                label: 'Contracts',
                data: contracts,
                backgroundColor: GOLD,
                borderColor: GOLD,
                borderWidth: 0,
                stack: 'rev',
              },
            ],
          }}
          options={chartOpts('Revenue', true)}
        />
      </div>
    </div>
  );
}

export default function DCFForecastCharts({ results, years, currentPrice, revenueOverrideRow }: Props) {
  const labels = years ?? results.revenues.map((_, i) => `Y+${i + 1}`);
  const validPrice = typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0;
  const upsidePct = validPrice ? ((results.fairPrice - currentPrice) / currentPrice) * 100 : null;
  const upsideColor = upsidePct == null
    ? 'var(--ink-mute)'
    : upsidePct >= 0
      ? POSITIVE_GREEN
      : NEGATIVE_PINK;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Headline ribbon: intrinsic value + implied upside */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          padding: '10px 14px',
          background: '#0d0e11',
          border: '1px solid var(--line)',
          borderRadius: 4,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 500 }}>Intrinsic Value</span>
        <span
          style={{
            fontSize: 18,
            color: 'var(--ink)',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
          }}
        >
          ${Number.isFinite(results.fairPrice) ? results.fairPrice.toFixed(2) : '—'}
        </span>
        {validPrice && (
          <>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
              vs ${currentPrice.toFixed(2)}
            </span>
            <span
              style={{
                fontSize: 12,
                color: upsideColor,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                marginLeft: 'auto',
              }}
            >
              {upsidePct != null ? fmtPct(upsidePct) : '—'} implied
            </span>
          </>
        )}
      </div>

      {results.baseRevenues && results.contractRevenues && results.contractRevenues.some((v) => v > 0) ? (
        <StackedRevenuePanel
          base={results.baseRevenues}
          contracts={results.contractRevenues}
          totals={results.revenues}
          labels={labels}
        />
      ) : (
        <ForecastPanel
          title="Projected Revenue"
          values={results.revenues}
          labels={labels}
          color={BLUE}
        />
      )}
      {revenueOverrideRow}
      <ForecastPanel
        title="Projected Net Income (NOPAT)"
        values={results.nopat}
        labels={labels}
        color={GOLD}
        flipNegative
      />
      <ForecastPanel
        title="Projected Free Cash Flow"
        values={results.fcf}
        labels={labels}
        color={POSITIVE_GREEN}
        flipNegative
      />
    </div>
  );
}
