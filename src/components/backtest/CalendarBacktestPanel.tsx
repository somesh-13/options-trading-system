'use client';

import { useMemo, useState } from 'react';
import type { BenchmarkId } from './types';

// --- Local state shape: kept private to this panel so the cross-strategy
// StrategyParameters type doesn't need to grow another half-dozen fields.

interface CalendarConfig {
  // Universe & dates
  tickersRaw: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  benchmark: BenchmarkId;

  // Entry
  fbRatioEntry: number;
  ivHvEntry: number;
  strikeSelection: 'atm' | 'delta-40';
  frontDte: string[]; // multi-select buckets
  backDte: string[];

  // Exit
  takeProfitPct: number;     // % of max profit
  stopLossPctOfDebit: number; // % of debit (e.g. 150 = 1.5×)
  autoCloseDte: '0' | '1' | '2';

  // Roll
  rollEnabled: boolean;
  rollTriggerDte: number;
  rollRequiresIvHv: boolean;
  rollTo: 'nearest-weekly' | '+7d' | '+14d';
  rollStrike: 'same' | 'atm-at-roll';

  // Sizing
  sizingMode: 'equal-weight' | 'fixed' | 'pct-bp';
  fixedContracts: number;
  pctOfBp: number;
  maxConcurrent: number;
  maxContractsPerPosition: number;
  feesBps: number;
  slippageBps: number;
}

const DEFAULT_CFG: CalendarConfig = {
  tickersRaw: 'NVDA, TSLA, SPY',
  startDate: '2024-01-01',
  endDate: '2026-05-01',
  initialCapital: 10_000,
  benchmark: 'SPY',
  fbRatioEntry: 1.15,
  ivHvEntry: 1.10,
  strikeSelection: 'atm',
  frontDte: ['1–3d', '3–5d'],
  backDte: ['7–14d', '14–21d'],
  takeProfitPct: 50,
  stopLossPctOfDebit: 150,
  autoCloseDte: '0',
  rollEnabled: true,
  rollTriggerDte: 1,
  rollRequiresIvHv: true,
  rollTo: 'nearest-weekly',
  rollStrike: 'same',
  sizingMode: 'equal-weight',
  fixedContracts: 1,
  pctOfBp: 5,
  maxConcurrent: 3,
  maxContractsPerPosition: 5,
  feesBps: 0.5,
  slippageBps: 0.5,
};

const FRONT_DTE_BUCKETS = ['0–1d', '1–3d', '3–5d', '5–7d'];
const BACK_DTE_BUCKETS = ['4–7d', '7–14d', '14–21d', '21–35d'];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#111',
        border: '1px solid #2a2a2a',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'uppercase',
          fontSize: 11,
          letterSpacing: 2,
          color: '#9ca3af',
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function PillToggle({
  options,
  value,
  onChange,
  multi,
}: {
  options: Array<{ id: string; label: string }>;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  multi?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const active = multi
          ? (value as string[]).includes(o.id)
          : value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              if (multi) {
                const cur = value as string[];
                onChange(active ? cur.filter((x) => x !== o.id) : [...cur, o.id]);
              } else {
                onChange(o.id);
              }
            }}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              background: active ? 'rgba(34,211,238,.15)' : '#181818',
              color: active ? '#22D3EE' : '#9ca3af',
              border: '1px solid ' + (active ? 'rgba(34,211,238,.3)' : '#2a2a2a'),
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        color: '#9ca3af',
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      style={{
        width: '100%',
        background: '#0c0d10',
        border: '1px solid #2a2a2a',
        color: 'var(--ink)',
        padding: '5px 8px',
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    />
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  suffix,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix: string;
  label?: string;
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#9ca3af',
          marginBottom: 2,
        }}
      >
        <span>{label}</span>
        <span style={{ color: 'var(--ink)' }}>{value}{suffix}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#fbbf24' }}
      />
    </>
  );
}

interface RunResult {
  status: 'idle' | 'loading' | 'ok' | 'error';
  totalReturnPct?: number;
  cagr?: number;
  sharpe?: number;
  maxDdPct?: number;
  winRate?: number;
  totalTrades?: number;
  message?: string;
}

export default function CalendarBacktestPanel() {
  const [cfg, setCfg] = useState<CalendarConfig>(DEFAULT_CFG);
  const [run, setRun] = useState<RunResult>({ status: 'idle' });

  const tickers = useMemo(
    () => cfg.tickersRaw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
    [cfg.tickersRaw],
  );

  const onRun = async () => {
    setRun({ status: 'loading' });
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: 'calendar_spread',
          tickers,
          startDate: cfg.startDate,
          endDate: cfg.endDate,
          initialCapital: cfg.initialCapital,
          feesBps: cfg.feesBps,
          slippageBps: cfg.slippageBps,
          // Strategy-specific config bundle. Backend would unpack this when
          // it implements the calendar_spread handler.
          calendarConfig: cfg,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.detail ?? `Backend rejected calendar_spread strategy (${res.status})`,
        );
      }
      const data = await res.json();
      setRun({
        status: 'ok',
        totalReturnPct: data.totalReturnPct,
        cagr: data.cagr,
        sharpe: data.sharpe,
        maxDdPct: data.maxDdPct,
        winRate: data.winRate,
        totalTrades: data.totalTrades,
      });
    } catch (e) {
      setRun({
        status: 'error',
        message:
          e instanceof Error
            ? e.message
            : 'Calendar-spread backtest engine is not yet wired up in the backend.',
      });
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* --- Output area --- */}
      <SectionCard title="Equity Curve · Calendar Spread">
        <div
          style={{
            height: 220,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b7280',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            border: '1px dashed #2a2a2a',
            borderRadius: 8,
          }}
        >
          {run.status === 'idle' && 'configure below + click Run Calendar Backtest'}
          {run.status === 'loading' && 'running backtest…'}
          {run.status === 'error' && (
            <div style={{ textAlign: 'center', color: '#ef4444' }}>{run.message}</div>
          )}
          {run.status === 'ok' && 'equity curve render (TODO once backend returns time-series)'}
        </div>

        {run.status === 'ok' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 8,
              marginTop: 12,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
            }}
          >
            <Kpi label="Total return" value={fmtPct(run.totalReturnPct)} good={(run.totalReturnPct ?? 0) >= 0} />
            <Kpi label="CAGR" value={fmtPct(run.cagr)} good={(run.cagr ?? 0) >= 0} />
            <Kpi label="Sharpe" value={fmtNum(run.sharpe, 2)} good={(run.sharpe ?? 0) >= 1} />
            <Kpi label="Max DD" value={fmtPct(run.maxDdPct)} good={false} muted />
            <Kpi label="Win rate" value={fmtPct(run.winRate)} good={(run.winRate ?? 0) >= 50} />
            <Kpi label="Trades" value={run.totalTrades?.toString() ?? '—'} good muted />
          </div>
        )}
      </SectionCard>

      {/* --- Config sections --- */}
      <SectionCard title="Universe & Dates">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Ticker(s) — comma separated</FieldLabel>
            <input
              type="text"
              value={cfg.tickersRaw}
              onChange={(e) => setCfg({ ...cfg, tickersRaw: e.target.value })}
              placeholder="NVDA, TSLA, SPY"
              style={{
                width: '100%',
                background: '#0c0d10',
                border: '1px solid #2a2a2a',
                color: 'var(--ink)',
                padding: '5px 8px',
                borderRadius: 4,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <FieldLabel>Start date</FieldLabel>
              <input
                type="date"
                value={cfg.startDate}
                onChange={(e) => setCfg({ ...cfg, startDate: e.target.value })}
                style={{
                  width: '100%',
                  background: '#0c0d10',
                  border: '1px solid #2a2a2a',
                  color: 'var(--ink)',
                  padding: '5px 8px',
                  borderRadius: 4,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                }}
              />
            </div>
            <div>
              <FieldLabel>End date</FieldLabel>
              <input
                type="date"
                value={cfg.endDate}
                onChange={(e) => setCfg({ ...cfg, endDate: e.target.value })}
                style={{
                  width: '100%',
                  background: '#0c0d10',
                  border: '1px solid #2a2a2a',
                  color: 'var(--ink)',
                  padding: '5px 8px',
                  borderRadius: 4,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                }}
              />
            </div>
          </div>
          <div>
            <FieldLabel>Initial capital</FieldLabel>
            <NumberInput value={cfg.initialCapital} onChange={(v) => setCfg({ ...cfg, initialCapital: v })} step={1000} min={1000} />
          </div>
          <div>
            <FieldLabel>Benchmark</FieldLabel>
            <PillToggle
              options={[
                { id: 'SPY', label: 'SPY' },
                { id: 'QQQ', label: 'QQQ' },
                { id: 'IWM', label: 'IWM' },
                { id: 'BTC', label: 'BTC' },
              ]}
              value={cfg.benchmark}
              onChange={(v) => setCfg({ ...cfg, benchmark: v as BenchmarkId })}
            />
          </div>
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SectionCard title="Entry Conditions">
          <div style={{ display: 'grid', gap: 14 }}>
            <Slider
              label="F/B IV Ratio ≥ (entry threshold)"
              suffix="×"
              value={cfg.fbRatioEntry}
              min={1.0}
              max={2.0}
              step={0.05}
              onChange={(v) => setCfg({ ...cfg, fbRatioEntry: v })}
            />
            <Slider
              label="Overall IV/HV ≥"
              suffix="×"
              value={cfg.ivHvEntry}
              min={1.0}
              max={2.0}
              step={0.05}
              onChange={(v) => setCfg({ ...cfg, ivHvEntry: v })}
            />
            <div>
              <FieldLabel>Strike selection</FieldLabel>
              <PillToggle
                options={[
                  { id: 'atm', label: 'ATM' },
                  { id: 'delta-40', label: '0.40Δ Delta-based' },
                ]}
                value={cfg.strikeSelection}
                onChange={(v) => setCfg({ ...cfg, strikeSelection: v as 'atm' | 'delta-40' })}
              />
            </div>
            <div>
              <FieldLabel>Front-month DTE (short leg)</FieldLabel>
              <PillToggle
                multi
                options={FRONT_DTE_BUCKETS.map((b) => ({ id: b, label: b }))}
                value={cfg.frontDte}
                onChange={(v) => setCfg({ ...cfg, frontDte: v as string[] })}
              />
            </div>
            <div>
              <FieldLabel>Back-month DTE (long leg)</FieldLabel>
              <PillToggle
                multi
                options={BACK_DTE_BUCKETS.map((b) => ({ id: b, label: b }))}
                value={cfg.backDte}
                onChange={(v) => setCfg({ ...cfg, backDte: v as string[] })}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Exit Conditions">
          <div style={{ display: 'grid', gap: 14 }}>
            <Slider
              label="Take profit at % of max profit"
              suffix="%"
              value={cfg.takeProfitPct}
              min={25}
              max={90}
              step={5}
              onChange={(v) => setCfg({ ...cfg, takeProfitPct: v })}
            />
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", marginTop: -8 }}>
              close when short leg decays to {cfg.takeProfitPct}% of premium collected
            </div>
            <Slider
              label="Stop loss at % of debit paid"
              suffix="%"
              value={cfg.stopLossPctOfDebit}
              min={100}
              max={300}
              step={10}
              onChange={(v) => setCfg({ ...cfg, stopLossPctOfDebit: v })}
            />
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", marginTop: -8 }}>
              close if spread loses &gt;{(cfg.stopLossPctOfDebit / 100).toFixed(1)}× the debit paid
            </div>
            <div>
              <FieldLabel>Auto-close short leg at DTE ≤</FieldLabel>
              <PillToggle
                options={[
                  { id: '0', label: '0d (let expire)' },
                  { id: '1', label: '1d' },
                  { id: '2', label: '2d' },
                ]}
                value={cfg.autoCloseDte}
                onChange={(v) => setCfg({ ...cfg, autoCloseDte: v as '0' | '1' | '2' })}
              />
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Roll Logic">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: '#9ca3af',
                marginBottom: 4,
              }}
            >
              <input
                type="checkbox"
                checked={cfg.rollEnabled}
                onChange={(e) => setCfg({ ...cfg, rollEnabled: e.target.checked })}
              />
              Auto-roll short leg when DTE ≤
            </label>
            <NumberInput
              value={cfg.rollTriggerDte}
              onChange={(v) => setCfg({ ...cfg, rollTriggerDte: v })}
              min={0}
              max={3}
            />
          </div>
          <div>
            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: '#9ca3af',
              }}
            >
              <input
                type="checkbox"
                checked={cfg.rollRequiresIvHv}
                onChange={(e) => setCfg({ ...cfg, rollRequiresIvHv: e.target.checked })}
              />
              Only roll if IV/HV still above entry threshold
            </label>
          </div>
          <div>
            <FieldLabel>Roll short to</FieldLabel>
            <PillToggle
              options={[
                { id: 'nearest-weekly', label: 'Nearest weekly' },
                { id: '+7d', label: '+7 days' },
                { id: '+14d', label: '+14 days' },
              ]}
              value={cfg.rollTo}
              onChange={(v) => setCfg({ ...cfg, rollTo: v as 'nearest-weekly' | '+7d' | '+14d' })}
            />
          </div>
          <div>
            <FieldLabel>Roll strike</FieldLabel>
            <PillToggle
              options={[
                { id: 'same', label: 'Same strike' },
                { id: 'atm-at-roll', label: 'Nearest ATM at roll time' },
              ]}
              value={cfg.rollStrike}
              onChange={(v) => setCfg({ ...cfg, rollStrike: v as 'same' | 'atm-at-roll' })}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Position Sizing">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <FieldLabel>Position size</FieldLabel>
            <PillToggle
              options={[
                { id: 'equal-weight', label: 'Equal-weight' },
                { id: 'fixed', label: 'Fixed (n contracts)' },
                { id: 'pct-bp', label: '% of buying power' },
              ]}
              value={cfg.sizingMode}
              onChange={(v) =>
                setCfg({ ...cfg, sizingMode: v as 'equal-weight' | 'fixed' | 'pct-bp' })
              }
            />
            {cfg.sizingMode === 'fixed' && (
              <div style={{ marginTop: 8 }}>
                <FieldLabel>Fixed contracts</FieldLabel>
                <NumberInput
                  value={cfg.fixedContracts}
                  onChange={(v) => setCfg({ ...cfg, fixedContracts: v })}
                  min={1}
                />
              </div>
            )}
            {cfg.sizingMode === 'pct-bp' && (
              <div style={{ marginTop: 8 }}>
                <FieldLabel>% of buying power</FieldLabel>
                <NumberInput
                  value={cfg.pctOfBp}
                  onChange={(v) => setCfg({ ...cfg, pctOfBp: v })}
                  min={1}
                  max={100}
                />
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <FieldLabel>Max concurrent calendar positions</FieldLabel>
              <NumberInput
                value={cfg.maxConcurrent}
                onChange={(v) => setCfg({ ...cfg, maxConcurrent: v })}
                min={1}
              />
            </div>
            <div>
              <FieldLabel>Max contracts per position</FieldLabel>
              <NumberInput
                value={cfg.maxContractsPerPosition}
                onChange={(v) => setCfg({ ...cfg, maxContractsPerPosition: v })}
                min={1}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <FieldLabel>Fees (BPS)</FieldLabel>
                <NumberInput value={cfg.feesBps} onChange={(v) => setCfg({ ...cfg, feesBps: v })} step={0.1} />
              </div>
              <div>
                <FieldLabel>Slippage (BPS)</FieldLabel>
                <NumberInput value={cfg.slippageBps} onChange={(v) => setCfg({ ...cfg, slippageBps: v })} step={0.1} />
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => console.info('Save preset (TODO)', cfg)}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            background: 'transparent',
            color: '#9ca3af',
            border: '1px solid #333',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Save Preset
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={run.status === 'loading'}
          style={{
            padding: '8px 24px',
            borderRadius: 6,
            background: run.status === 'loading' ? '#0e7490' : '#22D3EE',
            color: '#000',
            fontWeight: 700,
            border: 'none',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            cursor: run.status === 'loading' ? 'wait' : 'pointer',
          }}
        >
          {run.status === 'loading' ? 'Running…' : 'Run Calendar Backtest'}
        </button>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  good,
  muted,
}: {
  label: string;
  value: string;
  good: boolean;
  muted?: boolean;
}) {
  const color = muted ? '#9ca3af' : good ? '#22c55e' : '#ef4444';
  return (
    <div
      style={{
        background: '#0c0d10',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: '8px 10px',
      }}
    >
      <div style={{ color: '#6b7280', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ color, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function fmtPct(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtNum(v: number | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
