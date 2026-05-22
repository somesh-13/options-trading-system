'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  ChartOptions,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import {
  getBalanceSheet,
  getCashFlow,
  getIncomeStatementSec,
  getRatios,
  type FinancialStatementHistory,
  type StatementRow,
} from '@/lib/pricing-api';
import {
  FCF_PER_SHARE_KEY,
  buildFcfPerShareRow,
  injectFcfPerShareRow,
  type FcfPerShareTooltipPayload,
} from '@/lib/financialDerivedRows';
import { ValuationTiles } from './ValuationTiles';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

export type StatementName = 'income' | 'balance' | 'cash-flow' | 'ratios';

interface Props {
  ticker: string;
  /** Which financial statement to render. Defaults to "income". */
  statement?: StatementName;
}

type Unit = 'K' | 'M' | 'B';
type Period = 'annual' | 'quarterly';

// Bars (money / per-share rows) and lines (pct rows) have separate caps so
// the user can fill the chart with 4 bars without forfeiting the % line.
const MAX_BAR_SERIES = 4;
const MAX_LINE_SERIES = 2;

const DEFAULT_CHARTED_BY_STATEMENT: Record<StatementName, string[]> = {
  income: ['revenue', 'gross_profit', 'operating_income', 'net_income'],
  balance: ['total_assets', 'total_equity', 'lt_debt'],
  'cash-flow': ['cf_from_operations', 'cf_capex', 'cf_dividends'],
  ratios: ['gross_margin', 'operating_margin', 'roe'],
};

const HEADER_LABEL_BY_STATEMENT: Record<StatementName, string> = {
  income: 'Income Statement',
  balance: 'Balance Sheet',
  'cash-flow': 'Cash Flow',
  ratios: 'Ratios',
};

/** Statement-specific row used to detect "empty" columns to drop. The income
 *  statement uses Revenue (every public filer reports it); the others fall back
 *  to their canonical bold row. */
const COLUMN_ANCHOR_BY_STATEMENT: Record<StatementName, string> = {
  income: 'revenue',
  balance: 'total_assets',
  'cash-flow': 'cf_from_operations',
  ratios: 'operating_margin',
};

/** Cap how many period columns are shown in the table, chart, and chip row.
 *  Backend returns the full available history (15+ years for mature filers);
 *  the UI shows just the most recent slice to keep tables compact and CAGRs
 *  meaningful at a fixed window. Quarterly is wider so a 5-year QoQ revenue
 *  trend (≈20 quarters) fits without scrolling — matches the inspiration's
 *  Mar '22 → Mar '26 window. */
const MAX_DISPLAY_COLUMNS_BY_PERIOD: Record<Period, number> = {
  annual: 10,
  quarterly: 20,
};

const COLOR_POOL = ['#9FB2C5', '#FF974D', '#B07EF0', '#52B390', '#4c9aff', '#FFD700', '#FF006E'];

const REVENUE_YOY_KEY = 'revenue_yoy_pct';
const REVENUE_QOQ_KEY = 'revenue_qoq_pct';
const STOCK_PRICE_KEY = 'stock_price';

interface PricePoint {
  date: string;
  close: number;
}

function colorForKey(key: string, charted: string[]): string {
  const idx = charted.indexOf(key);
  if (idx >= 0) return COLOR_POOL[idx % COLOR_POOL.length];
  return '#9FB2C5';
}

function unitDivisor(from: 'M', to: Unit): number {
  // Backend always returns 'M' (millions). Convert client-side for display only.
  if (to === 'M') return 1;
  if (to === 'K') return 1 / 1000; // K = larger numbers (×1000)
  return 1000; // B = smaller numbers (÷1000)
}

function formatValue(
  v: number | null | undefined,
  fmt: StatementRow['format'] | undefined,
  unit: Unit,
): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (fmt === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (fmt === 'per_share') return v.toFixed(2);
  if (fmt === 'x' || fmt === 'ratio') return `${v.toFixed(2)}x`;
  if (fmt === 'days') return `${v.toFixed(0)}d`;
  // money — convert from M to selected unit
  const scaled = v / unitDivisor('M', unit);
  if (Math.abs(scaled) >= 1000) return scaled.toFixed(0);
  if (Math.abs(scaled) >= 100) return scaled.toFixed(1);
  return scaled.toFixed(1);
}

function totalChange(values: Array<number | null>): number | null {
  // values are most-recent-first → first is latest, last is oldest
  const latest = values[0];
  const oldest = [...values].reverse().find((v) => v != null && v !== 0);
  if (latest == null || oldest == null || oldest === 0) return null;
  return (latest - oldest) / Math.abs(oldest);
}

function relativeTime(t: number | null): string {
  if (t == null) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function cagrFromValues(values: Array<number | null>, years: string[]): number | null {
  // values are most-recent-first; same with years.
  const latest = values[0];
  const oldest = [...values].reverse().find((v) => v != null && v !== 0);
  if (latest == null || oldest == null || oldest <= 0 || latest <= 0) return null;
  // span = number of years between latest and oldest non-null entry
  const oldestIdx = [...values].reverse().findIndex((v) => v != null && v !== 0);
  if (oldestIdx < 0) return null;
  const yearsSpan = values.length - 1 - oldestIdx; // 0-based index from front
  if (yearsSpan <= 0) return null;
  return Math.pow(latest / oldest, 1 / yearsSpan) - 1;
}

export default function FinancialsPanel({ ticker, statement = 'income' }: Props) {
  const [data, setData] = useState<FinancialStatementHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [charted, setCharted] = useState<string[]>(DEFAULT_CHARTED_BY_STATEMENT[statement]);
  const [unit, setUnit] = useState<Unit>('M');
  const [period, setPeriod] = useState<Period>('annual');
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [, setNowTick] = useState(0);
  // Sibling income-statement payload, fetched only when the Cash Flow tab is
  // active. Sourced for `weighted_avg_shares_diluted` so we can derive the
  // client-side FCF/Share row. Backend has a 24h SEC cache so this is cheap.
  const [incomeForDerivation, setIncomeForDerivation] =
    useState<FinancialStatementHistory | null>(null);
  // Price history (close + date) for the Stock Price comparison row in the
  // income-statement table. 5y window covers the typical 5y annual table /
  // 20q quarterly table; older columns show '—'.
  const [priceHistory, setPriceHistory] = useState<PricePoint[] | null>(null);
  // Tooltip breakdown payload (CFO / CapEx / FCF / shares) keyed by column
  // index — must stay in lockstep with displayData's reversal so the chart
  // tooltip shows the correct period's numbers.
  const fcfTooltipsRef = useRef<FcfPerShareTooltipPayload[] | null>(null);
  // Debounce guard: a forced ratios refresh fires 4 SEC calls; SEC limits to
  // 10 req/s. 5s debounce keeps us well under and avoids accidental hammering.
  const lastForcedRefreshRef = useRef(0);

  // Reset the charted-keys default when the parent switches statements; each
  // statement has its own canonical "important" rows.
  useEffect(() => {
    setCharted(DEFAULT_CHARTED_BY_STATEMENT[statement]);
  }, [statement]);

  // New ticker: drop any "force" intent so the first paint uses the cache.
  useEffect(() => {
    setRefreshKey(0);
    setLastFetchedAt(null);
    lastForcedRefreshRef.current = 0;
  }, [ticker]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    const fetcher =
      statement === 'income' ? getIncomeStatementSec
      : statement === 'balance' ? getBalanceSheet
      : statement === 'cash-flow' ? getCashFlow
      : getRatios;
    fetcher(ticker, period, { force: refreshKey > 0 })
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.message ?? d.error);
        } else {
          setData(d);
          setLastFetchedAt(Date.now());
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, period, statement, refreshKey]);

  // Sibling fetch: pull income statement when the Cash Flow tab is active so
  // we can derive FCF/Share = (CFO − CapEx) ÷ diluted shares. Does NOT block
  // the cash-flow render — if this errors or arrives late, the derived row
  // shows '—' cells until it resolves. `refreshKey` is intentionally NOT in
  // the deps: Scan-Latest refreshes cash flow only; SEC shares data is
  // 24h-stable so the staleness window here is negligible.
  useEffect(() => {
    if (statement !== 'cash-flow') {
      setIncomeForDerivation(null);
      fcfTooltipsRef.current = null;
      return;
    }
    let cancelled = false;
    getIncomeStatementSec(ticker, period)
      .then((d) => {
        if (cancelled) return;
        if (!d.error) setIncomeForDerivation(d);
      })
      .catch(() => {
        /* swallow — derived row degrades to '—' */
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, period, statement]);

  // Fetch price history for the Stock Price table row (income statement only).
  // Resets when the ticker changes; period switches just re-slice client-side.
  useEffect(() => {
    if (statement !== 'income') {
      setPriceHistory(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/market/${ticker}/price-history?period=5Y`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: PricePoint[] } | null) => {
        if (cancelled || !body?.data) return;
        // Trust the backend ordering but normalize ascending by date so our
        // year-end lookup can binary-search.
        const points = body.data
          .filter((p) => p && typeof p.date === 'string' && typeof p.close === 'number')
          .sort((a, b) => a.date.localeCompare(b.date));
        setPriceHistory(points);
      })
      .catch(() => {
        /* row shows '—'; not worth surfacing */
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, statement]);

  // Re-render the "Updated Xs ago" label every 30s so it stays accurate.
  useEffect(() => {
    if (lastFetchedAt == null) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [lastFetchedAt]);

  const handleScanLatest = () => {
    if (loading) return;
    if (Date.now() - lastForcedRefreshRef.current < 5000) return;
    lastForcedRefreshRef.current = Date.now();
    setRefreshKey((k) => k + 1);
  };

  // Cap the API response to the most-recent N columns. Backend returns full
  // history (15+ years for mature filers); the UI only renders the recent
  // slice. Built once and shared by everything downstream so CAGR / chart /
  // chip row / table all agree on the same window.
  const cappedData = useMemo<FinancialStatementHistory | null>(() => {
    if (!data) return null;
    const cap = MAX_DISPLAY_COLUMNS_BY_PERIOD[period];
    const n = Math.min(cap, data.years.length);
    if (n === data.years.length) return data;
    return {
      ...data,
      years: data.years.slice(0, n),
      years_source: data.years_source ? data.years_source.slice(0, n) : undefined,
      year_ends: data.year_ends ? data.year_ends.slice(0, n) : undefined,
      years_fiscal_quarter: data.years_fiscal_quarter
        ? data.years_fiscal_quarter.slice(0, n)
        : data.years_fiscal_quarter,
      rows: data.rows.map((r) => ({ ...r, values: r.values.slice(0, n) })),
    };
  }, [data, period]);

  // Cash Flow only: layer the client-derived FCF/Share row on top of the
  // capped backend response. Stashes the tooltip payload into a ref so the
  // chart tooltip callback can render the full breakdown without re-deriving.
  // The row's values array is most-recent-first (matches cappedData.rows
  // ordering); displayData's reversal step below also reverses the ref so
  // tooltip[i] aligns with the chart's i-th column.
  const withDerivedRows = useMemo<FinancialStatementHistory | null>(() => {
    if (!cappedData) return null;
    if (statement !== 'cash-flow') {
      fcfTooltipsRef.current = null;
      return cappedData;
    }
    const built = buildFcfPerShareRow(cappedData, incomeForDerivation);
    if (!built) {
      fcfTooltipsRef.current = null;
      return cappedData;
    }
    fcfTooltipsRef.current = built.tooltips;
    return { ...cappedData, rows: injectFcfPerShareRow(cappedData.rows, built.row) };
  }, [cappedData, incomeForDerivation, statement]);

  const rowsByKey = useMemo(() => {
    if (!withDerivedRows) return new Map<string, StatementRow>();
    return new Map(withDerivedRows.rows.map((r) => [r.key, r]));
  }, [withDerivedRows]);

  // Display view for the chart and the table:
  //   1. Drop columns where the statement's anchor row is null (e.g. BTBT's
  //      placeholder "Sep '24" with all cells null) — rendering them is just
  //      an empty column. Exception: keep 8-K prelim columns even when the
  //      anchor is null, because the prelim header itself is the signal that
  //      the 10-Q hasn't landed yet (it's worth showing as "—").
  //   2. Reverse to oldest→newest so the table reads left→right in the same
  //      direction as the chart x-axis.
  const displayData = useMemo(() => {
    if (!withDerivedRows) return null;
    const anchorKey = COLUMN_ANCHOR_BY_STATEMENT[statement];
    const anchorRow = withDerivedRows.rows.find((r) => r.key === anchorKey);
    const sources = withDerivedRows.years_source;
    const keepIdx = anchorRow
      ? anchorRow.values
          .map((v, i) =>
            v != null || sources?.[i] === 'sec-8k-prelim' ? i : -1,
          )
          .filter((i) => i >= 0)
      : withDerivedRows.years.map((_, i) => i);
    const orderIdx = [...keepIdx].reverse();
    const years = orderIdx.map((i) => withDerivedRows.years[i]);
    const yearsSource = withDerivedRows.years_source
      ? orderIdx.map((i) => withDerivedRows.years_source![i])
      : undefined;
    const yearsFQ = withDerivedRows.years_fiscal_quarter
      ? orderIdx.map((i) => withDerivedRows.years_fiscal_quarter![i] ?? null)
      : withDerivedRows.years_fiscal_quarter;
    const rows = withDerivedRows.rows.map((r) => ({
      ...r,
      values: orderIdx.map((i) => r.values[i] ?? null),
    }));
    // Reorder the FCF tooltip payload using the same orderIdx so that
    // tooltip[i] matches the chart's i-th (oldest-first) column. Without
    // this, hovering the most-recent column would surface the oldest
    // period's CFO/CapEx/shares numbers.
    if (fcfTooltipsRef.current) {
      const src = fcfTooltipsRef.current;
      fcfTooltipsRef.current = orderIdx.map((i) => src[i]);
    }
    // Synthetic growth rows (income statement only). Stored as decimals so the
    // existing `pct` formatting in the table and the chart's *100 logic both
    // work without special-casing.
    //   Revenue YoY %: vs prior year (annual) or same quarter prior year (Q)
    //   Revenue QoQ %: vs prior quarter — quarterly only (annual already is YoY)
    let rowsWithGrowth = rows;
    if (statement === 'income') {
      const rev = rows.find((r) => r.key === 'revenue');
      if (rev) {
        const computeGrowth = (lookback: number) =>
          rev.values.map((v, i) => {
            const prior = rev.values[i - lookback];
            if (v == null || prior == null || prior === 0) return null;
            return (v - prior) / Math.abs(prior);
          });
        const yoyLookback = period === 'quarterly' ? 4 : 1;
        const yoyValues = computeGrowth(yoyLookback);
        const synthetic: typeof rows = [];
        if (!yoyValues.every((v) => v == null)) {
          synthetic.push({
            key: REVENUE_YOY_KEY,
            label: 'Revenue YoY %',
            format: 'pct' as const,
            values: yoyValues,
          });
        }
        if (period === 'quarterly') {
          const qoqValues = computeGrowth(1);
          if (!qoqValues.every((v) => v == null)) {
            synthetic.push({
              key: REVENUE_QOQ_KEY,
              label: 'Revenue QoQ %',
              format: 'pct' as const,
              values: qoqValues,
            });
          }
        }
        // Stock Price at period end — closest close on/before each year_end.
        // Only added when the backend ships year_ends (ISO dates) AND we have
        // a price-history payload. Reversed via orderIdx so it aligns with
        // the table's oldest→newest column order.
        const yearEndsRaw = withDerivedRows.year_ends;
        if (yearEndsRaw && priceHistory && priceHistory.length > 0) {
          const closeOnOrBefore = (iso: string): number | null => {
            let lo = 0;
            let hi = priceHistory.length;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (priceHistory[mid].date <= iso) lo = mid + 1;
              else hi = mid;
            }
            const idx = lo - 1;
            return idx >= 0 ? priceHistory[idx].close : null;
          };
          const stockValues = orderIdx.map((i) => {
            const iso = yearEndsRaw[i];
            return iso ? closeOnOrBefore(iso) : null;
          });
          if (!stockValues.every((v) => v == null)) {
            synthetic.push({
              key: STOCK_PRICE_KEY,
              label: 'Stock Price',
              format: 'per_share' as const,
              values: stockValues,
            });
          }
        }

        if (synthetic.length > 0) {
          const idx = rows.findIndex((r) => r.key === 'revenue');
          rowsWithGrowth = [
            ...rows.slice(0, idx + 1),
            ...synthetic,
            ...rows.slice(idx + 1),
          ];
        }
      }
    }
    return {
      ...withDerivedRows,
      years,
      years_source: yearsSource,
      years_fiscal_quarter: yearsFQ,
      rows: rowsWithGrowth,
    };
  }, [withDerivedRows, statement, period, priceHistory]);

  const toggleChart = (key: string) => {
    setCharted((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // Cap by series type — bars and lines each get their own budget so a
      // full bar selection doesn't kick the % line off (and vice versa).
      // FCF/Share is `per_share` format but renders as a line on its own
      // axis, so it must count toward the line budget, not the bar budget.
      const isLineSeries = (k: string) => {
        if (k === FCF_PER_SHARE_KEY) return true;
        if (k === STOCK_PRICE_KEY) return true;
        return rowsByKey.get(k)?.format === 'pct';
      };
      const incomingIsLine = isLineSeries(key);
      const cap = incomingIsLine ? MAX_LINE_SERIES : MAX_BAR_SERIES;
      const sameType = prev.filter((k) => isLineSeries(k) === incomingIsLine);
      if (sameType.length >= cap) {
        // Drop the oldest of the same type, keep everything else as-is.
        const oldest = sameType[0];
        return [...prev.filter((k) => k !== oldest), key];
      }
      return [...prev, key];
    });
  };

  const removeChart = (key: string) => {
    setCharted((prev) => prev.filter((k) => k !== key));
  };

  // Build the chart datasets: bars for money/per_share rows, line for pct.
  // displayData is already oldest→newest with empty columns dropped, so we
  // can feed its rows/years straight into Chart.js without re-reversing.
  const chartConfig = useMemo(() => {
    if (!displayData) return null;
    // Chart x-axis uses fiscal-quarter labels in quarterly mode ("Q2 FY25");
    // table column headers stay on the month-based labels ("Mar '25") so the
    // user can cross-reference filing dates. Falls back to month labels if
    // the backend didn't ship the fiscal-quarter array.
    const yearsAsc =
      period === 'quarterly' && displayData.years_fiscal_quarter
        ? displayData.years_fiscal_quarter.map((q, i) => q ?? displayData.years[i])
        : displayData.years;
    const displayRowsByKey = new Map(displayData.rows.map((r) => [r.key, r]));
    const datasets: Array<Record<string, unknown>> = [];
    let hasPercentSeries = false;
    let hasPerShareSeries = false;
    let hasStockPriceSeries = false;

    charted.forEach((key) => {
      const row = displayRowsByKey.get(key);
      if (!row) return;
      const color = colorForKey(key, charted);
      if (key === STOCK_PRICE_KEY) {
        // Stock price: gold line on its own right-side axis so the $ price
        // doesn't get squashed by revenue ($M) bars on yLeft.
        hasStockPriceSeries = true;
        datasets.push({
          type: 'line' as const,
          label: row.label,
          data: row.values,
          borderColor: '#FFD700',
          backgroundColor: '#FFD700',
          yAxisID: 'yStockPrice',
          tension: 0,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
          spanGaps: true,
          _isStockPrice: true,
        });
        return;
      }
      if (key === FCF_PER_SHARE_KEY) {
        // Derived per-share row: dashed purple line on its own right-side
        // axis (yPerShare) so the $/share magnitude doesn't get squashed by
        // the M-denominated CFO/CapEx bars on yLeft. Override the auto color
        // so it stays visually distinct regardless of selection order.
        hasPerShareSeries = true;
        datasets.push({
          type: 'line' as const,
          label: row.label,
          data: row.values,
          borderColor: '#a78bfa',
          backgroundColor: '#a78bfa',
          yAxisID: 'yPerShare',
          tension: 0,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          borderDash: [4, 3],
          spanGaps: true,
          _isFcfPerShare: true,
        });
        return;
      }
      if (row.format === 'pct') {
        hasPercentSeries = true;
        datasets.push({
          type: 'line' as const,
          label: row.label,
          data: row.values.map((v) => (v == null ? null : v * 100)),
          borderColor: color,
          backgroundColor: color,
          yAxisID: 'yPct',
          tension: 0,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          spanGaps: true,
        });
      } else {
        datasets.push({
          type: 'bar' as const,
          label: row.label,
          data: row.values.map((v) => (v == null ? null : v / unitDivisor('M', unit))),
          backgroundColor: color,
          borderColor: color,
          borderWidth: 0,
          yAxisID: 'yLeft',
        });
      }
    });

    return { yearsAsc, datasets, hasPercentSeries, hasPerShareSeries, hasStockPriceSeries };
  }, [displayData, charted, unit, period]);

  const chartOptions: ChartOptions<'bar'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
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
          label: (ctx) => {
            const ds = ctx.dataset as {
              _isFcfPerShare?: boolean;
              _isStockPrice?: boolean;
              label?: string;
              yAxisID?: string;
            };
            const v = ctx.parsed.y;
            if (ds._isStockPrice) {
              return `${ds.label}: ${v == null ? '—' : `$${v.toFixed(2)}`}`;
            }
            if (ds._isFcfPerShare) {
              const tip = fcfTooltipsRef.current?.[ctx.dataIndex];
              if (v == null || !tip) return `${ds.label}: —`;
              const fmtM = (n: number | null) =>
                n == null ? '—' : `$${n.toFixed(1)}M`;
              const fmtSh = (n: number | null) =>
                n == null ? '—' : `${n.toFixed(1)}M`;
              return [
                `${ds.label}: $${v.toFixed(2)}`,
                `= CFO ${fmtM(tip.cfo)} − CapEx ${fmtM(tip.capex)} = FCF ${fmtM(tip.fcf)}`,
                `÷ ${fmtSh(tip.shares)} diluted shares`,
              ];
            }
            if (v == null) return `${ds.label}: —`;
            const isPct = ds.yAxisID === 'yPct';
            return `${ds.label}: ${
              isPct ? `${v.toFixed(1)}%` : v.toFixed(1)
            }`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(38,39,45,0.4)' },
        ticks: { color: '#a3a3a8', font: { size: 10, family: 'JetBrains Mono, monospace' } },
      },
      yLeft: {
        position: 'left',
        grid: { color: 'rgba(38,39,45,0.4)' },
        ticks: { color: '#a3a3a8', font: { size: 10, family: 'JetBrains Mono, monospace' } },
      },
      yPct: {
        position: 'right',
        grid: { display: false },
        display: chartConfig?.hasPercentSeries ?? false,
        ticks: {
          color: '#a3a3a8',
          font: { size: 10, family: 'JetBrains Mono, monospace' },
          callback: (v) => `${v}%`,
        },
      },
      yPerShare: {
        position: 'right',
        grid: { display: false },
        display: chartConfig?.hasPerShareSeries ?? false,
        ticks: {
          color: '#a78bfa',
          font: { size: 10, family: 'JetBrains Mono, monospace' },
          callback: (v) => `$${Number(v).toFixed(2)}`,
        },
      },
      yStockPrice: {
        position: 'right',
        grid: { display: false },
        display: chartConfig?.hasStockPriceSeries ?? false,
        ticks: {
          color: '#FFD700',
          font: { size: 10, family: 'JetBrains Mono, monospace' },
          callback: (v) => `$${Number(v).toFixed(0)}`,
        },
      },
    },
  }), [chartConfig?.hasPercentSeries, chartConfig?.hasPerShareSeries, chartConfig?.hasStockPriceSeries]);

  // Tiles fetch independently of the statement payload so they should render
  // even while ratios history is loading / errored / empty.
  const tilesPrefix =
    statement === 'ratios' ? <ValuationTiles ticker={ticker} refreshKey={refreshKey} /> : null;

  if (loading) {
    return (
      <>
        {tilesPrefix}
        <div className="rv-card" style={{ padding: 24 }}>
          <div className="rv-sub" style={{ fontSize: 12 }}>Loading {ticker} financials…</div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {tilesPrefix}
        <div className="rv-card" style={{ padding: 24 }}>
          <div style={{ color: 'var(--pink)', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
            {error}
          </div>
        </div>
      </>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <>
        {tilesPrefix}
        <div className="rv-card" style={{ padding: 24 }}>
          <div className="rv-sub" style={{ fontSize: 12 }}>
            No {HEADER_LABEL_BY_STATEMENT[statement].toLowerCase()} data for {ticker}.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Live valuation multiples (P/E, P/S, P/B, P/FCF, EV/EBITDA, EV/Sales)
          shown only on the Ratios tab. Mixes today's spot with the latest
          annual filing — historical rows aren't computed because we don't
          have period-end share prices. */}
      {tilesPrefix}
      <div className="rv-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          {data.ticker} {HEADER_LABEL_BY_STATEMENT[statement]}
        </h3>
        <span className="rv-sub" style={{ fontSize: 11, margin: 0 }}>
          {period === 'quarterly' ? 'Quarterly' : 'Annual'} · {data.source === 'sec-edgar' ? 'SEC EDGAR' : 'standardized'} · {data.currency} · most recent first
          {lastFetchedAt != null && ` · Updated ${relativeTime(lastFetchedAt)}`}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleScanLatest}
            className="rv-btn ghost"
            disabled={loading}
            title="Bypass the 24h SEC cache and re-fetch the latest filings from EDGAR"
            style={{ fontSize: 11, padding: '6px 10px' }}
          >
            {loading && refreshKey > 0 ? 'Scanning…' : 'Scan latest'}
          </button>
          <PeriodToggle period={period} onChange={setPeriod} />
          {statement !== 'ratios' && <UnitToggle unit={unit} onChange={setUnit} />}
        </div>
      </div>

      {/* Selected-metrics chip row */}
      {charted.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 14px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          {charted.map((key) => {
            const row = rowsByKey.get(key);
            if (!row) return null;
            const tc = totalChange(row.values);
            const cagr = cagrFromValues(row.values, cappedData?.years ?? data.years);
            return (
              <span
                key={key}
                className="rv-chip"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 10.5,
                  border: '1px solid var(--line)',
                  background: '#0d0e11',
                  padding: '3px 4px 3px 10px',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: colorForKey(key, charted),
                  }}
                />
                <span style={{ color: 'var(--ink)' }}>{row.label}</span>
                {tc != null && (
                  <span style={{ color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
                    Δ {(tc * 100).toFixed(1)}%
                  </span>
                )}
                {cagr != null && (
                  <span style={{ color: 'var(--ink-mute)', fontFamily: "'JetBrains Mono', monospace" }}>
                    CAGR {(cagr * 100).toFixed(1)}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeChart(key)}
                  aria-label={`Remove ${row.label} from chart`}
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--ink-mute)',
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                    padding: '0 4px',
                  }}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Chart */}
      {chartConfig && chartConfig.datasets.length > 0 && (
        <div style={{ height: 320, padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <Chart
            type="bar"
            data={{
              labels: chartConfig.yearsAsc,
              datasets: chartConfig.datasets as never,
            }}
            options={chartOptions}
          />
        </div>
      )}

      {/* IS table */}
      <div style={{ overflowX: 'auto', maxHeight: 600 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--ink)',
          }}
        >
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: '#0d0e11', zIndex: 1 }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--line)',
                  color: 'var(--ink-mute)',
                  fontWeight: 500,
                  fontSize: 11,
                  fontFamily: 'inherit',
                  minWidth: 280,
                }}
              >
                {HEADER_LABEL_BY_STATEMENT[statement]}
              </th>
              {(displayData?.years ?? data.years).map((y, i) => {
                const src = (displayData?.years_source ?? data.years_source)?.[i];
                const fromFiling = src === '8-K' || src === '6-K';
                const isFallback = src === 'yfinance-fallback';
                const badgeLabel = fromFiling ? src : (isFallback ? 'yfinance' : null);
                const badgeTitle = fromFiling
                  ? `Preliminary numbers from this quarter’s ${src} Exhibit 99.1 (not yet in yfinance)`
                  : isFallback
                    ? 'Latest quarter from yfinance — SEC 10-Q not yet filed'
                    : undefined;
                return (
                  <th
                    key={y}
                    title={badgeTitle}
                    style={{
                      textAlign: 'right',
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--line)',
                      color: 'var(--ink-mute)',
                      fontWeight: 500,
                      fontSize: 11,
                      fontFamily: 'inherit',
                      minWidth: 70,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      {y}
                      {badgeLabel && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                            color: 'var(--gold)',
                            border: '1px solid rgba(255,215,0,0.4)',
                            background: 'rgba(255,215,0,0.1)',
                            borderRadius: 3,
                            padding: '1px 4px',
                          }}
                        >
                          {badgeLabel}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(displayData?.rows ?? data.rows).map((row) => {
              const isCharted = charted.includes(row.key);
              return (
                <tr key={row.key}>
                  <td
                    style={{
                      padding: '4px 10px',
                      borderTop: row.bold ? '1px solid var(--line)' : 'none',
                      borderBottom: '1px solid rgba(38,39,45,0.4)',
                    }}
                  >
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isCharted}
                        onChange={() => toggleChart(row.key)}
                        style={{
                          width: 12,
                          height: 12,
                          accentColor: colorForKey(row.key, charted),
                          cursor: 'pointer',
                        }}
                      />
                      <span
                        style={{
                          fontFamily: 'inherit',
                          fontSize: 12,
                          fontWeight: row.bold ? 600 : 400,
                          fontStyle: row.italic ? 'italic' : 'normal',
                          color: row.bold ? 'var(--ink)' : 'var(--ink-dim, var(--ink))',
                        }}
                      >
                        {row.label}
                      </span>
                    </label>
                  </td>
                  {row.values.map((v, idx) => {
                    // FCF/Share is the only row in this table that color-codes
                    // negatives. CapEx, Dividends, etc. naturally report
                    // negative cash outflows and have historically rendered in
                    // neutral ink; keep that contract by scoping the red.
                    const isFcfRow = row.key === FCF_PER_SHARE_KEY;
                    const isNeg =
                      isFcfRow && typeof v === 'number' && Number.isFinite(v) && v < 0;
                    return (
                      <td
                        key={`${row.key}-${idx}`}
                        style={{
                          textAlign: 'right',
                          padding: '4px 10px',
                          borderTop: row.bold ? '1px solid var(--line)' : 'none',
                          borderBottom: '1px solid rgba(38,39,45,0.4)',
                          fontStyle: row.italic ? 'italic' : 'normal',
                          color:
                            v == null
                              ? 'var(--ink-mute)'
                              : isNeg
                                ? 'var(--pink)'
                                : 'var(--ink)',
                        }}
                      >
                        {isFcfRow && typeof v === 'number' && Number.isFinite(v)
                          ? `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`
                          : formatValue(v, row.format, unit)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}

function PeriodToggle({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 3, overflow: 'hidden' }}>
      {(['annual', 'quarterly'] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          style={{
            background: p === period ? 'var(--line)' : 'transparent',
            color: p === period ? 'var(--ink)' : 'var(--ink-mute)',
            border: 0,
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: 'pointer',
            textTransform: 'capitalize',
          }}
        >
          {p === 'annual' ? 'Annual' : 'Quarterly'}
        </button>
      ))}
    </div>
  );
}

function UnitToggle({ unit, onChange }: { unit: Unit; onChange: (u: Unit) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 3, overflow: 'hidden' }}>
      {(['K', 'M', 'B'] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          style={{
            background: u === unit ? 'var(--line)' : 'transparent',
            color: u === unit ? 'var(--ink)' : 'var(--ink-mute)',
            border: 0,
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: 'pointer',
          }}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
