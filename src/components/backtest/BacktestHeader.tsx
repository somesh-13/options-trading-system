'use client';

interface Props {
  /** Optional dirty indicator: when true, shows a small "Unsynced parameters" pill. */
  dirty?: boolean;
  /** Wall-clock string of when the current run completed, e.g. "12:48:33". */
  ranAt?: string | null;
}

export default function BacktestHeader({ dirty, ranAt }: Props) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-2 mb-4 sm:mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          Backtesting Framework
        </h1>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Regime-aware walk-forward simulation with bias mitigation. Compare strategies and
          benchmark them against the broad market.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider text-amber-300 bg-amber-300/10 ring-1 ring-inset ring-amber-300/30">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" />
          Historical simulation
        </span>
        {dirty && (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-wider text-[#22D3EE] bg-[#22D3EE]/10 ring-1 ring-inset ring-[#22D3EE]/30">
            Unsynced parameters
          </span>
        )}
        {ranAt && (
          <span className="hidden sm:inline text-[11px] text-gray-500 tabular-nums">
            Ran {ranAt}
          </span>
        )}
      </div>
    </header>
  );
}
