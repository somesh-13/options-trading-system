'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartData,
} from 'chart.js';
import {
  simulateMultiLeg,
  type SimulateMultiLegResponse,
} from '@/lib/pricing-api';
import { isLegComplete, type Leg } from '@/lib/option-legs';
import { classifyMultiLeg } from '@/lib/option-strategies';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const SIZE_KEY = 'simulator-overlay-size';

type PersistedSize = { w?: number; h?: number };

function loadSize(): PersistedSize {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SIZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      w: typeof parsed?.w === 'number' ? parsed.w : undefined,
      h: typeof parsed?.h === 'number' ? parsed.h : undefined,
    };
  } catch {
    return {};
  }
}

function saveSize(s: PersistedSize) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIZE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / private mode */
  }
}

interface Props {
  open: boolean;
  legs: Leg[];
  underlying: string;
  onClose: () => void;
}

/** Build N evenly-spaced YYYY-MM-DD strings from today through max(legExpirations). */
function buildEvalDates(legs: Leg[], steps = 8): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expDates = legs
    .map((l) => new Date(`${l.expiration}T00:00:00`))
    .filter((d) => !isNaN(d.getTime()));
  if (expDates.length === 0) return [today.toISOString().slice(0, 10)];

  const maxExp = expDates.reduce((a, b) => (a > b ? a : b));
  const totalDays = Math.max(0, Math.round((maxExp.getTime() - today.getTime()) / 86400000));
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const days = Math.round((i * totalDays) / Math.max(1, steps - 1));
    const d = new Date(today.getTime() + days * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  // Always include the exact expiry as the final entry if not already present.
  const last = maxExp.toISOString().slice(0, 10);
  if (out[out.length - 1] !== last) out.push(last);
  // dedupe in case totalDays === 0
  return Array.from(new Set(out));
}

export function SimulatorOverlay({ open, legs, underlying, onClose }: Props) {
  const [sigma, setSigma] = useState('0.30');
  const [r, setR] = useState('0.05');
  const [spot, setSpot] = useState<string>('');
  const [data, setData] = useState<SimulateMultiLegResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateIdx, setDateIdx] = useState(0);

  // Persisted resize (mirrors PremiumPicksOverlay).
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [persisted, setPersisted] = useState<PersistedSize>({});
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setPersisted(loadSize());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        saveSize({ w: Math.round(width), h: Math.round(height) });
      }, 250);
    });
    obs.observe(el);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      obs.disconnect();
    };
  }, [open]);

  // Reset state when the overlay opens fresh.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setData(null);
    setDateIdx(0);
    if (!spot) {
      // Try to seed spot from the first leg's strike as a sensible default;
      // user can override before fetching.
      const k = parseFloat(legs[0]?.strike ?? '');
      if (!isNaN(k) && k > 0) setSpot(String(k));
      else setSpot('100');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const evalDates = useMemo(() => buildEvalDates(legs), [legs]);
  const strategyLabel = useMemo(() => classifyMultiLeg(legs).label, [legs]);

  const allLegsValid = legs.length > 0 && legs.every(isLegComplete);
  const sigmaNum = parseFloat(sigma);
  const rNum = parseFloat(r);
  const spotNum = parseFloat(spot);
  const inputsValid =
    !isNaN(sigmaNum) && sigmaNum > 0 && sigmaNum <= 5 &&
    !isNaN(rNum) && rNum >= 0 && rNum <= 1 &&
    !isNaN(spotNum) && spotNum > 0;

  // Fetch sim curves whenever inputs change.
  useEffect(() => {
    if (!open || !allLegsValid || !inputsValid) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await simulateMultiLeg({
          legs: legs.map((l) => ({
            strike: parseFloat(l.strike),
            option_type: l.optionType,
            side: l.side,
            quantity: parseInt(l.quantity, 10),
            entry_price: parseFloat(l.entryPrice),
            expiration: l.expiration,
          })),
          spot: spotNum,
          r: rNum,
          sigma: sigmaNum,
          evaluation_dates: evalDates,
          price_range: { steps: 80 },
        });
        if (!cancelled) {
          setData(res);
          // Default the slider to today (idx 0) on a fresh fetch.
          setDateIdx(0);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200); // small debounce
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, legs, sigmaNum, rNum, spotNum, evalDates, allLegsValid, inputsValid]);

  if (!open) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Currently selected curve (clamped to available range).
  const curve = data && data.curves.length > 0
    ? data.curves[Math.min(dateIdx, data.curves.length - 1)]
    : null;
  const expiryCurve = data && data.curves.length > 0
    ? data.curves[data.curves.length - 1]
    : null;
  const prices = data?.prices ?? [];

  // Summary stats for the visible curve.
  const curvePnl = curve?.pnl ?? [];
  const maxPnl = curvePnl.length ? Math.max(...curvePnl) : 0;
  const minPnl = curvePnl.length ? Math.min(...curvePnl) : 0;

  // Breakevens: linear interpolation where the visible curve crosses 0.
  const breakevens: number[] = [];
  for (let i = 1; i < curvePnl.length; i++) {
    const a = curvePnl[i - 1];
    const b = curvePnl[i];
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
      const t = a === b ? 0 : a / (a - b);
      breakevens.push(prices[i - 1] + t * (prices[i] - prices[i - 1]));
    }
  }

  const chartData: ChartData<'line'> = {
    labels: prices.map((p) => p.toFixed(2)),
    datasets: [
      {
        label: `P&L on ${curve?.date ?? '—'}`,
        data: curvePnl,
        borderColor: 'rgba(58,141,255,1)',
        backgroundColor: (ctx) => {
          // green above zero, pink below.
          const v = ctx.parsed?.y;
          if (v == null) return 'rgba(58,141,255,0.15)';
          return v >= 0 ? 'rgba(0,200,5,0.15)' : 'rgba(255,0,110,0.15)';
        },
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
        fill: { target: { value: 0 }, above: 'rgba(0,200,5,0.10)', below: 'rgba(255,0,110,0.10)' },
      },
      ...(expiryCurve && expiryCurve !== curve
        ? [
            {
              label: `At expiry (${expiryCurve.date})`,
              data: expiryCurve.pnl,
              borderColor: 'rgba(176,176,176,0.55)',
              borderDash: [4, 4],
              borderWidth: 1,
              pointRadius: 0,
              tension: 0,
              fill: false,
            } as ChartData<'line'>['datasets'][number],
          ]
        : []),
    ],
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: { color: '#B0B0B0', font: { size: 11, family: 'JetBrains Mono' } },
      },
      tooltip: {
        callbacks: {
          title: (items) => `Underlying $${items[0]?.label}`,
          label: (item) =>
            `${item.dataset.label}: $${(item.parsed.y as number).toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Underlying price ($)', color: '#B0B0B0' },
        ticks: {
          color: '#B0B0B0',
          font: { size: 10, family: 'JetBrains Mono' },
          maxTicksLimit: 12,
          callback: function (value) {
            const idx = Number(value);
            return idx >= 0 && idx < prices.length ? `$${prices[idx].toFixed(0)}` : '';
          },
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
      y: {
        title: { display: true, text: 'P&L ($)', color: '#B0B0B0' },
        ticks: {
          color: '#B0B0B0',
          font: { size: 10, family: 'JetBrains Mono' },
          callback: (v) => `$${Number(v).toFixed(0)}`,
        },
        grid: {
          color: (ctx) => (ctx.tick.value === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.04)'),
          lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
        },
      },
    },
  };

  // T_remaining on selected eval date for max-expiry leg (display only).
  const selectedDate = curve?.date ?? evalDates[0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sel = new Date(`${selectedDate}T00:00:00`);
  const daysFromToday = Math.max(0, Math.round((sel.getTime() - today.getTime()) / 86400000));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Multi-leg returns simulator"
      onClick={onClose}
      data-testid="simulator-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '4vh 12px',
        zIndex: 1000,
      }}
    >
      <div
        ref={cardRef}
        onClick={stop}
        className="rv-card"
        style={{
          width: persisted.w ?? 'min(960px, 96vw)',
          height: persisted.h ?? 'min(680px, 90vh)',
          minWidth: 600,
          minHeight: 460,
          maxWidth: '98vw',
          maxHeight: '95vh',
          resize: 'both',
          overflow: 'auto',
          padding: 16,
          background: 'var(--surface-raised, #161616)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: 4,
            bottom: 2,
            fontSize: 12,
            color: 'var(--ink-mute)',
            pointerEvents: 'none',
            userSelect: 'none',
            opacity: 0.6,
          }}
          title="Drag corner to resize"
        >
          ↘
        </span>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>
              Returns simulator · {underlying.toUpperCase() || '—'}
            </h3>
            <span
              style={{
                ...monoStyle,
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 3,
                border: '1px solid var(--blue, #3A8DFF)',
                background: 'rgba(58,141,255,0.12)',
                color: 'var(--blue, #3A8DFF)',
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              {strategyLabel}
            </span>
          </div>
          <button
            type="button"
            className="rv-btn ghost"
            onClick={onClose}
            style={{ fontSize: 11, padding: '2px 10px' }}
            aria-label="Close simulator"
          >
            ✕ Close
          </button>
        </div>

        {/* Inputs row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Spot ($)" testid="simulator-spot-input" value={spot} setValue={setSpot} step="any" />
          <Field label="σ (vol)" testid="simulator-sigma-input" value={sigma} setValue={setSigma} step="0.01" />
          <Field label="r (rate)" testid="simulator-r-input" value={r} setValue={setR} step="0.005" />
          <span style={{ ...monoStyle, fontSize: 11, color: 'var(--ink-mute)', marginLeft: 'auto' }}>
            {legs.length} leg{legs.length === 1 ? '' : 's'} · Black-Scholes re-pricing
          </span>
        </div>

        {/* Status / chart area */}
        <div style={{ flex: 1, minHeight: 280, position: 'relative' }}>
          {!allLegsValid && (
            <Banner color="var(--pink, #FF006E)" text="Fill in all leg fields to simulate." />
          )}
          {allLegsValid && !inputsValid && (
            <Banner color="var(--pink, #FF006E)" text="Spot, σ and r must be valid positive numbers." />
          )}
          {allLegsValid && inputsValid && loading && !data && (
            <Banner color="var(--ink-dim)" text="Computing payoff curves…" />
          )}
          {allLegsValid && inputsValid && error && (
            <Banner color="var(--pink, #FF006E)" text={`Error: ${error}`} />
          )}
          {data && (
            <div style={{ position: 'relative', height: '100%', minHeight: 260 }}>
              <Line data={chartData} options={chartOptions} />
            </div>
          )}
        </div>

        {/* Date slider + summary chips */}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="rv-sub" style={{ ...monoStyle, fontSize: 11, minWidth: 80 }}>Date:</span>
              <input
                type="range"
                min={0}
                max={Math.max(0, evalDates.length - 1)}
                step={1}
                value={dateIdx}
                onChange={(e) => setDateIdx(parseInt(e.target.value, 10))}
                data-testid="simulator-date-slider"
                style={{
                  flex: 1,
                  accentColor: 'var(--blue, #3A8DFF)',
                }}
              />
              <span style={{ ...monoStyle, fontSize: 11, color: 'var(--ink)', minWidth: 180, textAlign: 'right' }}>
                {selectedDate} · T+{daysFromToday}d
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Chip label="Max P&L" value={`$${maxPnl.toFixed(2)}`} fg="var(--green, #00C805)" bg="rgba(0,200,5,0.12)" />
              <Chip label="Min P&L" value={`$${minPnl.toFixed(2)}`} fg="var(--pink, #FF006E)" bg="rgba(255,0,110,0.12)" />
              {breakevens.length > 0 && (
                <Chip
                  label={`Breakeven${breakevens.length > 1 ? 's' : ''}`}
                  value={breakevens.map((b) => `$${b.toFixed(2)}`).join(' / ')}
                  fg="var(--gold, #FFD700)"
                  bg="rgba(255,215,0,0.10)"
                />
              )}
              <Chip
                label="Spot"
                value={`$${spotNum.toFixed(2)}`}
                fg="var(--blue, #3A8DFF)"
                bg="rgba(58,141,255,0.12)"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- small subcomponents ----------------------------------------------------

function Field({
  label,
  testid,
  value,
  setValue,
  step,
}: {
  label: string;
  testid: string;
  value: string;
  setValue: (v: string) => void;
  step?: string | number;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 110px' }}>
      <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => setValue(e.target.value)}
        data-testid={testid}
        style={{
          ...monoStyle,
          fontSize: 13,
          padding: '6px 8px',
          background: 'var(--bg, #1E1E1E)',
          border: '1px solid var(--line)',
          borderRadius: 3,
          color: 'var(--ink)',
          width: 100,
        }}
      />
    </label>
  );
}

function Banner({ text, color }: { text: string; color: string }) {
  return (
    <div
      style={{
        ...monoStyle,
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        fontSize: 12,
        textAlign: 'center',
        padding: 16,
      }}
    >
      {text}
    </div>
  );
}

function Chip({
  label, value, fg, bg,
}: { label: string; value: string; fg: string; bg: string }) {
  return (
    <span
      style={{
        ...monoStyle,
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 3,
        border: `1px solid ${fg}`,
        background: bg,
        color: fg,
        display: 'inline-flex',
        gap: 6,
      }}
    >
      <span style={{ opacity: 0.75 }}>{label}:</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </span>
  );
}
