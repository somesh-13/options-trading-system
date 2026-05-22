'use client';

import { useState } from 'react';
import { BENCHMARK_COLORS, BenchmarkId, StrategyParameters } from './types';

interface Props {
  /** Pretty label for the disclosure button. */
  title?: string;
  parameters: StrategyParameters;
  /** Which tickers are selectable in this mode. */
  availableTickers?: string[];
  /** Whether to show multi-ticker toggles (comparison mode) vs single ticker input (single mode). */
  multiTicker?: boolean;
  /** Hide threshold / EV / z-score fields (e.g. for the Wheel mode). */
  showStrategyThresholds?: boolean;
  /** Disabled when a run is in flight. */
  disabled?: boolean;
  /** Called whenever any parameter changes. */
  onChange: (next: StrategyParameters) => void;
  /** Save-preset hook. UI calls back if the user clicks Save. */
  onSavePreset?: () => void;
  /** Defaults the drawer to expanded (e.g. first visit). */
  defaultOpen?: boolean;
}

const BENCHMARKS: BenchmarkId[] = ['SPY', 'QQQ', 'IWM', 'BTC'];

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-gray-600 mt-0.5">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full bg-[#0b0b0d] text-white text-sm px-2.5 py-1.5 rounded-md ring-1 ring-inset ring-[#26272d] focus:outline-none focus:ring-[#22D3EE]/60 tabular-nums disabled:opacity-50';

export default function ParameterDrawer({
  title = 'Parameters',
  parameters,
  availableTickers = ['CIFR', 'WULF', 'ONDS', 'HOOD', 'CLSK'],
  multiTicker = true,
  showStrategyThresholds = true,
  disabled,
  onChange,
  onSavePreset,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const update = (patch: Partial<StrategyParameters>) => {
    onChange({ ...parameters, ...patch });
  };

  const toggleTicker = (t: string) => {
    update({
      tickers: parameters.tickers.includes(t)
        ? parameters.tickers.filter((x) => x !== t)
        : [...parameters.tickers, t],
    });
  };

  return (
    <section className="rounded-2xl border border-[#1f2027] bg-[#0f1014] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-gray-300 hover:bg-white/5 transition-colors"
      >
        <span className="inline-flex items-center gap-2">
          <span className="text-gray-500">▸</span>
          <span
            className="inline-block transition-transform"
            style={{ transform: open ? 'rotate(0deg)' : 'rotate(0deg)' }}
          />
          {title}
          <span className="text-[11px] text-gray-500 font-normal">
            · {parameters.tickers.length} tickers · {parameters.startDate} → {parameters.endDate}
            {parameters.benchmark && ` · vs ${parameters.benchmark}`}
          </span>
        </span>
        <span className={`text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-[#16171c] space-y-4">
          {/* Universe */}
          {multiTicker ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
                Universe
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableTickers.map((t) => {
                  const on = parameters.tickers.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleTicker(t)}
                      disabled={disabled}
                      className={`font-mono text-xs px-2 py-1 rounded-md transition-colors ${
                        on
                          ? 'bg-[#22D3EE]/15 text-[#22D3EE] ring-1 ring-inset ring-[#22D3EE]/40'
                          : 'text-gray-400 bg-white/5 hover:bg-white/10 ring-1 ring-inset ring-[#26272d]'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <Field label="Ticker">
              <input
                type="text"
                value={parameters.tickers[0] ?? ''}
                onChange={(e) =>
                  update({ tickers: [e.target.value.trim().toUpperCase()].filter(Boolean) })
                }
                disabled={disabled}
                className={inputCls}
              />
            </Field>
          )}

          {/* Dates + capital */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Start Date">
              <input
                type="date"
                value={parameters.startDate}
                onChange={(e) => update({ startDate: e.target.value })}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="End Date">
              <input
                type="date"
                value={parameters.endDate}
                onChange={(e) => update({ endDate: e.target.value })}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Initial Capital">
              <input
                type="number"
                step="1000"
                value={parameters.initialCapital}
                onChange={(e) => update({ initialCapital: parseFloat(e.target.value) || 0 })}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Benchmark">
              <select
                value={parameters.benchmark ?? ''}
                onChange={(e) =>
                  update({
                    benchmark: e.target.value ? (e.target.value as BenchmarkId) : null,
                  })
                }
                disabled={disabled}
                className={inputCls}
              >
                <option value="">None</option>
                {BENCHMARKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Strategy thresholds */}
          {showStrategyThresholds && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              <Field label="Sell Threshold (IV/HV)" hint="≥ → sell call">
                <input
                  type="number"
                  step="0.05"
                  value={parameters.ivHvSellThreshold}
                  onChange={(e) => update({ ivHvSellThreshold: parseFloat(e.target.value) || 0 })}
                  disabled={disabled}
                  className={inputCls}
                />
              </Field>
              <Field label="Buy Threshold (IV/HV)" hint="≤ → buy call">
                <input
                  type="number"
                  step="0.05"
                  value={parameters.ivHvBuyThreshold}
                  onChange={(e) => update({ ivHvBuyThreshold: parseFloat(e.target.value) || 0 })}
                  disabled={disabled}
                  className={inputCls}
                />
              </Field>
              <Field label="EV Threshold ($/contract)">
                <input
                  type="number"
                  step="5"
                  value={parameters.evThreshold}
                  onChange={(e) => update({ evThreshold: parseFloat(e.target.value) || 0 })}
                  disabled={disabled}
                  className={inputCls}
                />
              </Field>
              <Field label="Z-Score Entry">
                <input
                  type="number"
                  step="0.1"
                  value={parameters.zEntry}
                  onChange={(e) => update({ zEntry: parseFloat(e.target.value) || 0 })}
                  disabled={disabled}
                  className={inputCls}
                />
              </Field>
              <Field label="Z-Score Exit">
                <input
                  type="number"
                  step="0.1"
                  value={parameters.zExit}
                  onChange={(e) => update({ zExit: parseFloat(e.target.value) || 0 })}
                  disabled={disabled}
                  className={inputCls}
                />
              </Field>
            </div>
          )}

          {/* Costs + execution */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Fees (bps)">
              <input
                type="number"
                step="0.5"
                value={parameters.feesBps}
                onChange={(e) => update({ feesBps: parseFloat(e.target.value) || 0 })}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Slippage (bps)">
              <input
                type="number"
                step="0.5"
                value={parameters.slippageBps}
                onChange={(e) => update({ slippageBps: parseFloat(e.target.value) || 0 })}
                disabled={disabled}
                className={inputCls}
              />
            </Field>
            <Field label="Position Sizing">
              <select
                value={parameters.positionSizingMode}
                onChange={(e) =>
                  update({
                    positionSizingMode: e.target
                      .value as StrategyParameters['positionSizingMode'],
                  })
                }
                disabled={disabled}
                className={inputCls}
              >
                <option value="equal">Equal-weight</option>
                <option value="risk-parity">Risk parity</option>
                <option value="kelly-frac">Fractional Kelly</option>
              </select>
            </Field>
            <Field label="Rebalance">
              <select
                value={parameters.rebalance}
                onChange={(e) =>
                  update({ rebalance: e.target.value as StrategyParameters['rebalance'] })
                }
                disabled={disabled}
                className={inputCls}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
          </div>

          {onSavePreset && (
            <div className="flex justify-end pt-1">
              <button
                onClick={onSavePreset}
                className="text-xs text-gray-400 hover:text-white underline-offset-2 hover:underline"
              >
                Save as preset
              </button>
            </div>
          )}

          {/* Benchmark legend strip */}
          {parameters.benchmark && (
            <div className="pt-2 border-t border-[#16171c] flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                Benchmark
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
                <span
                  className="inline-block h-2.5 w-3 rounded-sm"
                  style={{ backgroundColor: BENCHMARK_COLORS[parameters.benchmark] }}
                />
                {parameters.benchmark}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
