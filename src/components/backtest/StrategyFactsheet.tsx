'use client';

import { StrategyFactsheetMeta, StrategyParameters } from './types';

interface Props {
  meta: StrategyFactsheetMeta | null;
  parameters: StrategyParameters;
  /** Optional: universe ticker list to override what's in `parameters`. */
  universe?: string[];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 py-1.5">
      <dt className="text-[11px] uppercase tracking-wider text-gray-500 w-32 shrink-0">{label}</dt>
      <dd className="text-sm text-gray-200 min-w-0">{children}</dd>
    </div>
  );
}

export default function StrategyFactsheet({ meta, parameters, universe }: Props) {
  if (!meta) {
    return (
      <section className="rounded-2xl border border-[#1f2027] bg-[#0f1014] p-5">
        <p className="text-sm text-gray-500">
          Select or run a strategy to see its factsheet.
        </p>
      </section>
    );
  }

  const tickers = universe ?? parameters.tickers;

  return (
    <section className="rounded-2xl border border-[#1f2027] bg-[#0f1014] overflow-hidden">
      <header className="px-5 py-3 border-b border-[#16171c]">
        <h3 className="text-sm font-semibold text-white tracking-tight">Strategy Factsheet</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Methodology, assumptions, and bias-mitigation notes.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-[#16171c]">
        {/* Left: Facts */}
        <dl className="bg-[#0f1014] p-5">
          <Row label="Strategy">{meta.title}</Row>
          <Row label="Family">
            <div className="flex flex-wrap gap-1">
              {meta.family.map((f) => (
                <span
                  key={f}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider text-gray-300 bg-white/5 ring-1 ring-inset ring-[#26272d]"
                >
                  {f}
                </span>
              ))}
            </div>
          </Row>
          <Row label="Cadence">{meta.cadence}</Row>
          <Row label="Asset Type">{meta.assetType}</Row>
          <Row label="OOS Start">{meta.oosStart}</Row>
          <Row label="Universe">
            <div className="flex flex-wrap gap-1">
              {tickers.length === 0 ? (
                <span className="text-gray-500">—</span>
              ) : (
                tickers.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-gray-200"
                  >
                    {t}
                  </span>
                ))
              )}
            </div>
          </Row>
        </dl>

        {/* Center: Methodology */}
        <div className="bg-[#0f1014] p-5">
          <p className="text-sm text-gray-300 leading-relaxed">{meta.description}</p>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Entry logic</div>
              <p className="text-gray-300 mt-0.5">{meta.entryLogic}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Exit logic</div>
              <p className="text-gray-300 mt-0.5">{meta.exitLogic}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Risk controls</div>
              <p className="text-gray-300 mt-0.5">{meta.riskControls}</p>
            </div>
          </div>
        </div>

        {/* Right: Assumptions & bias-mitigation */}
        <div className="bg-[#0f1014] p-5">
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Assumptions</div>
              <p className="text-gray-300 mt-0.5">{meta.assumptions}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">
                Walk-forward / bias-mitigation
              </div>
              <p className="text-gray-300 mt-0.5">{meta.walkForward}</p>
            </div>
            <div className="pt-2 border-t border-[#16171c]">
              <div className="text-[11px] uppercase tracking-wider text-gray-500">
                Cost model (run-time)
              </div>
              <div className="grid grid-cols-2 gap-2 text-[12px] mt-1 tabular-nums">
                <div className="text-gray-500">Fees</div>
                <div className="text-gray-200 text-right">{parameters.feesBps} bps</div>
                <div className="text-gray-500">Slippage</div>
                <div className="text-gray-200 text-right">{parameters.slippageBps} bps</div>
                <div className="text-gray-500">Sizing</div>
                <div className="text-gray-200 text-right">{parameters.positionSizingMode}</div>
                <div className="text-gray-500">Rebalance</div>
                <div className="text-gray-200 text-right">{parameters.rebalance}</div>
              </div>
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed pt-2 border-t border-[#16171c]">
              Past performance is historical simulation and does not predict future results.
              All values are net of modeled fees and slippage but exclude taxes and borrow costs.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
