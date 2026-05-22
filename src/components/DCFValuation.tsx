'use client';

import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import type { Fundamentals } from '@/app/stock/[ticker]/StockDetailClient';
import DCFForecastCharts from '@/components/dcf/DCFForecastCharts';

interface DCFValuationProps {
  ticker: string;
  // Allow null / 0 / NaN here — the parent's API call can transiently return
  // a bad price (yfinance flakiness). The component renders a "—" placeholder
  // and hides the vs-market delta in that case rather than displaying "$0.00",
  // which a user reads as "the stock is worthless."
  currentPrice: number | null | undefined;
  companyName: string;
  fundamentals?: Fundamentals;
}

/**
 * Deep fundamentals from /api/market/{ticker}/fundamentals. Values are in
 * absolute dollars (not $M) unless noted. All optional — yfinance coverage
 * varies by ticker.
 */
interface DeepFundamentals {
  ticker: string;
  name?: string;
  currentPrice?: number | null;
  revenue?: number | null;
  revenueHistory?: Array<{ year: string; revenue: number }>;
  revenueCagr?: number | null;
  revenueGrowth1y?: number | null;
  operatingIncome?: number | null;
  operatingMargin?: number | null;
  taxRate?: number | null;
  capex?: number | null;
  freeCashFlow?: number | null;
  totalDebt?: number | null;
  totalCash?: number | null;
  netDebt?: number | null;
  sharesOutstanding?: number | null;
  marketCap?: number | null;
  beta?: number | null;
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  pegRatio?: number | null;
  evToEbitda?: number | null;
  priceToSales?: number | null;
  enterpriseValue?: number | null;
  returnOnEquity?: number | null;
  returnOnAssets?: number | null;
  grossMargins?: number | null;
  ebitdaMargins?: number | null;
  profitMargins?: number | null;
  earningsGrowth?: number | null;
  targetMeanPrice?: number | null;
  targetHighPrice?: number | null;
  targetLowPrice?: number | null;
  targetMedianPrice?: number | null;
  numberOfAnalystOpinions?: number | null;
  recommendationKey?: string | null;
  recommendationMean?: number | null;
  analystUpsidePct?: number | null;
  sources?: Record<string, string>;
  asOf?: string;
  asOfFiling?: string | null;
  /** When the latest 8-K/6-K reports a fresher quarter than yfinance's annual,
   *  the backend rolls revenue/operatingIncome to TTM that includes it.
   *  Present only when that rollup actually fired. */
  latestQuarterReported?: {
    period_end: string;
    fiscal_period?: string;
    filing_form?: '8-K' | '6-K';
    filing_date?: string;
    accession?: string;
    source?: string;
    ttm_revenue_M?: number | null;
    ttm_operating_income_M?: number | null;
  } | null;
}

type AccentVar = 'var(--green)' | 'var(--gold)' | 'var(--pink)' | 'var(--blue)' | 'var(--purple)';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS: number[] = [
  CURRENT_YEAR,
  CURRENT_YEAR + 1,
  CURRENT_YEAR + 2,
  CURRENT_YEAR + 3,
  CURRENT_YEAR + 4,
];

import type { Contract } from '@/lib/types/contracts';
import { effectiveAnnualRevenueM, rampFactor } from '@/lib/types/contracts';
import ContractsPanel from '@/components/dcf/ContractsPanel';

/**
 * Approximate known corporate BTC treasury holdings (coins). Any ticker with
 * an entry shows the optional Bitcoin balance-sheet section; others hide it.
 * Values are rough; users can edit the slider for their own estimate.
 */
const BTC_TREASURY_HOLDINGS: Record<string, number> = {
  MSTR: 450000,  // MicroStrategy
  MARA: 50000,
  RIOT: 17000,
  CLSK: 15000,   // CleanSpark
  HUT:  10000,   // Hut 8
  TSLA: 11000,
  SQ:   8000,    // Block Inc
  XYZ:  8000,    // Block Inc (post-rebrand)
  HIVE: 2500,
  IREN: 2000,
  CIFR: 2000,
  COIN: 9000,    // Coinbase operational
  BITF: 1500,    // Bitfarms
  WULF: 500,
  GLXY: 5000,    // Galaxy Digital
  MELI: 500,     // MercadoLibre
  SMLR: 1000,    // Semler Scientific
};

// ----------------------------------------------------------------------------
// Accordion + Slider primitives
// ----------------------------------------------------------------------------

interface AccordionSectionProps {
  title: string;
  accent: AccentVar;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionSection({ title, accent, isOpen, onToggle, children }: AccordionSectionProps) {
  return (
    <div
      className="rv-card"
      style={{
        marginTop: 0,
        padding: 0,
        borderLeft: `3px solid ${accent}`,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          minHeight: 44,
          background: 'transparent',
          border: 0,
          color: 'var(--ink)',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span>{title}</span>
        <span
          aria-hidden
          style={{
            color: 'var(--ink-mute)',
            fontSize: 12,
            transition: 'transform .2s ease-out',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
      </button>
      <div
        style={{
          maxHeight: isOpen ? 600 : 0,
          opacity: isOpen ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height .25s ease-out, opacity .2s ease-out',
        }}
      >
        <div
          style={{
            padding: '4px 14px 14px',
            borderTop: '1px solid var(--line-soft)',
            background: '#0c0d10',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
  description: string;
  accent: AccentVar;
}

function Slider({ label, value, onChange, min, max, step, formatValue, description, accent }: SliderProps) {
  const style = { '--dcf-thumb': accent } as CSSProperties;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12, color: 'var(--ink-dim)', fontWeight: 500 }}>{label}</label>
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: accent,
            fontWeight: 600,
          }}
        >
          {formatValue(value)}
        </span>
      </div>
      <input
        type="range"
        className="rv-dcf-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={style}
      />
      <p style={{ fontSize: 10.5, color: 'var(--ink-mute)', margin: '4px 0 0', fontFamily: 'JetBrains Mono, monospace' }}>
        {description}
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Read-only snapshot row (for the Yahoo Finance market/analyst block)
// ----------------------------------------------------------------------------

interface SnapshotRowProps {
  label: string;
  value: string;
  valueColor?: string;
}

function SnapshotRow({ label, value, valueColor }: SnapshotRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '4px 0',
        borderBottom: '1px solid var(--line-soft)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 600,
          color: valueColor ?? 'var(--ink)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Manual revenue override row (rendered under the projected-revenue bars)
// ----------------------------------------------------------------------------

interface RevenueOverrideRowProps {
  years: number[];
  /** Resolved (post-override, post-contract) revenue per year — used as the
   *  placeholder so the user sees the current model output before typing. */
  computed: number[];
  overrides: (number | null)[];
  onChange: (idx: number, value: number | null) => void;
  onResetAll: () => void;
}

function RevenueOverrideRow({
  years,
  computed,
  overrides,
  onChange,
  onResetAll,
}: RevenueOverrideRowProps) {
  const anyOverridden = overrides.some((v) => v != null);
  return (
    <div
      className="rv-card"
      style={{
        padding: '10px 14px',
        background: '#0d0e11',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
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
        <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 500 }}>
          Manual revenue override ($M)
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: 'var(--ink-mute)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          empty = formula · typed value replaces total for that year
        </span>
        {anyOverridden && (
          <button
            type="button"
            onClick={onResetAll}
            className="rv-btn ghost"
            style={{
              fontSize: 11,
              padding: '2px 8px',
              marginLeft: 'auto',
            }}
          >
            Reset all
          </button>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))`,
          gap: 8,
        }}
      >
        {years.map((y, i) => {
          const override = overrides[i];
          const isOverridden = override != null;
          const placeholder = `auto ${Math.round(computed[i] ?? 0)}`;
          return (
            <div
              key={y}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}
            >
              <label
                style={{
                  fontSize: 10,
                  color: 'var(--ink-mute)',
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.05em',
                  textAlign: 'center',
                }}
              >
                {y}
              </label>
              <div style={{ display: 'flex', gap: 4, minWidth: 0 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={isOverridden ? String(override) : ''}
                  placeholder={placeholder}
                  aria-label={`${y} revenue override in millions`}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (v === '') return onChange(i, null);
                    const n = parseFloat(v);
                    if (Number.isFinite(n)) onChange(i, n);
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '4px 6px',
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    background: '#0c0d10',
                    color: isOverridden ? '#4c9aff' : 'var(--ink)',
                    border: `1px solid ${isOverridden ? 'rgba(76,154,255,.5)' : 'var(--line)'}`,
                    borderRadius: 3,
                    outline: 'none',
                    textAlign: 'right',
                  }}
                />
                {isOverridden && (
                  <button
                    type="button"
                    onClick={() => onChange(i, null)}
                    title="Reset to formula"
                    aria-label={`Reset ${y} to formula`}
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      background: 'transparent',
                      color: 'var(--ink-mute)',
                      border: '1px solid var(--line)',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Defaults derivation
// ----------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

interface DcfDefaults {
  revenueM: number;        // current revenue in $M
  cagrPct: number;         // annual growth %
  opMarginPct: number;     // operating margin %
  taxPct: number;          // tax rate %
  capexM: number;          // annual capex in $M
  netDebtM: number;        // net debt in $M
  sharesM: number;         // shares outstanding in millions
  fedRatePct: number;
  riskPremiumPct: number;
  terminalMultiple: number;
  btcHoldings: number;     // coins
  btcPrice: number;
  hasBtc: boolean;
}

function deriveDefaults(
  ticker: string,
  fundamentals?: Fundamentals,
  deep?: DeepFundamentals | null,
): DcfDefaults {
  // Prefer deep fundamentals (from income_stmt / cashflow / balance_sheet)
  // over the lightweight `info`-based fundamentals.
  const revenueAbs = deep?.revenue ?? fundamentals?.revenue ?? null;
  const revenueM = revenueAbs != null ? revenueAbs / 1_000_000 : 500;

  const rawOpMargin = deep?.operatingMargin ?? fundamentals?.operatingMargin;
  const opMarginPct =
    rawOpMargin != null && Number.isFinite(rawOpMargin)
      ? clamp(rawOpMargin * 100, -200, 95)
      : 20;

  // Use multi-year CAGR when we have it (more stable than 1Y growth).
  const cagrSource = deep?.revenueCagr ?? deep?.revenueGrowth1y ?? fundamentals?.revenueGrowth;
  const cagrPct =
    cagrSource != null && Number.isFinite(cagrSource) ? clamp(cagrSource * 100, -30, 150) : 8;

  const taxPct =
    deep?.taxRate != null && Number.isFinite(deep.taxRate)
      ? clamp(deep.taxRate * 100, 0, 40)
      : 21;

  // Calibrate the capex slider so that the model's Year-0 FCF lines up with
  // the actual TTM free-cash-flow yfinance reports. The simple formula used in
  // results (FCF = NOPAT − capex) ignores D&A and working-capital movements,
  // so plugging in *gross* capex tends to produce a wildly negative FCF for
  // capex-heavy businesses (semis, REITs, infra) — and a clamped $0 fair
  // price downstream.
  //
  // Backsolve instead:  capex_effective = NOPAT − FCF_actual
  // This is the capex value that makes the model honest at t=0; the user can
  // still nudge it for sensitivity analysis. Falls back to gross capex (then
  // 10% of revenue) when freeCashFlow is missing.
  const fcfAbs = deep?.freeCashFlow ?? null;
  const capexAbs = deep?.capex ?? null;
  const taxRate = taxPct / 100;
  const opMargin = opMarginPct / 100;
  const nopatM = revenueM * opMargin * (1 - taxRate);
  const fcfM = fcfAbs != null ? fcfAbs / 1_000_000 : null;
  let capexM: number;
  if (fcfM != null && Number.isFinite(fcfM)) {
    capexM = Math.round(nopatM - fcfM);
  } else if (capexAbs != null) {
    capexM = Math.round(capexAbs / 1_000_000);
  } else if (revenueM > 0) {
    capexM = Math.round(revenueM * 0.1);
  } else {
    capexM = 50;
  }

  const netDebtAbs = deep?.netDebt ?? fundamentals?.netDebt ?? null;
  const netDebtM = netDebtAbs != null ? clamp(netDebtAbs / 1_000_000, -100_000, 200_000) : 0;

  const sharesAbs = deep?.sharesOutstanding ?? fundamentals?.sharesOutstanding ?? null;
  const sharesM = sharesAbs != null && sharesAbs > 0 ? sharesAbs / 1_000_000 : 500;

  const btcHoldings = BTC_TREASURY_HOLDINGS[ticker.toUpperCase()] ?? 0;

  return {
    revenueM: Math.max(1, Math.round(revenueM)),
    cagrPct: Math.round(cagrPct * 10) / 10,
    opMarginPct: Math.round(opMarginPct),
    taxPct: Math.round(taxPct),
    capexM: Math.max(0, capexM),
    netDebtM: Math.round(netDebtM),
    sharesM: Math.max(1, Math.round(sharesM)),
    fedRatePct: 4.5,
    riskPremiumPct: 3.5,
    terminalMultiple: 15,
    btcHoldings,
    btcPrice: 95000,
    hasBtc: btcHoldings > 0,
  };
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------

export default function DCFValuation({ ticker, currentPrice, companyName, fundamentals }: DCFValuationProps) {
  const [deep, setDeep] = useState<DeepFundamentals | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);

  // Fetch the deep (income_stmt / cashflow / balance_sheet) fundamentals once
  // per ticker — the lightweight info-based defaults from the parent are just
  // an initial render while this is in flight.
  useEffect(() => {
    let cancelled = false;
    setDeep(null);
    setDeepError(null);
    setDeepLoading(true);
    fetch(`/api/market/${ticker}/fundamentals`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((body: DeepFundamentals) => {
        if (!cancelled) setDeep(body);
      })
      .catch((err) => {
        if (!cancelled) setDeepError(err instanceof Error ? err.message : 'Failed');
      })
      .finally(() => {
        if (!cancelled) setDeepLoading(false);
      });
    return () => { cancelled = true; };
  }, [ticker]);

  const defaults = useMemo(
    () => deriveDefaults(ticker, fundamentals, deep),
    [ticker, fundamentals, deep],
  );

  const [revenueM, setRevenueM] = useState(defaults.revenueM);
  const [cagrPct, setCagrPct] = useState(defaults.cagrPct);
  const [opMarginPct, setOpMarginPct] = useState(defaults.opMarginPct);
  const [taxPct, setTaxPct] = useState(defaults.taxPct);
  const [capexM, setCapexM] = useState(defaults.capexM);
  const [netDebtM, setNetDebtM] = useState(defaults.netDebtM);
  const [sharesM, setSharesM] = useState(defaults.sharesM);
  const [fedRate, setFedRate] = useState(defaults.fedRatePct);
  const [riskPremium, setRiskPremium] = useState(defaults.riskPremiumPct);
  const [terminalMultiple, setTerminalMultiple] = useState(defaults.terminalMultiple);
  const [btcHoldings, setBtcHoldings] = useState(defaults.btcHoldings);
  const [btcPrice, setBtcPrice] = useState(defaults.btcPrice);

  // Per-year revenue overrides. null = use the formula; number = manual entry
  // in $M. When set, the override replaces the total projected revenue for
  // that year (contract layer is suppressed for the overridden year so the
  // input value is the *honest* total the user sees on the bar).
  const [revenueOverrides, setRevenueOverrides] = useState<(number | null)[]>(
    () => YEARS.map(() => null),
  );

  // Re-apply defaults if ticker/fundamentals changes (e.g. nav to another stock).
  useEffect(() => {
    setRevenueM(defaults.revenueM);
    setCagrPct(defaults.cagrPct);
    setOpMarginPct(defaults.opMarginPct);
    setTaxPct(defaults.taxPct);
    setCapexM(defaults.capexM);
    setNetDebtM(defaults.netDebtM);
    setSharesM(defaults.sharesM);
    setBtcHoldings(defaults.btcHoldings);
    setBtcPrice(defaults.btcPrice);
    setRevenueOverrides(YEARS.map(() => null));
  }, [defaults]);

  // Contract-aware DCF layer. Contracts are seeded by ContractsPanel's mount
  // fetch. The toggle flips ON automatically once a non-empty list lands so
  // the user immediately sees the contract revenue baked into the projection
  // for HPC-pivot tickers; non-pivot tickers (AAPL, etc.) stay OFF / hidden.
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractLayerOn, setContractLayerOn] = useState(false);
  const [defaultRevPerMW_M, setDefaultRevPerMW_M] = useState(2);
  const handleContractsChange = useCallback((next: Contract[]) => {
    setContracts(next);
    if (next.length > 0) setContractLayerOn(true);
  }, []);

  const [openSections, setOpenSections] = useState({
    rev: true,
    margin: false,
    cap: false,
    btc: false,
    macro: false,
    val: false,
    contracts: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const results = useMemo(() => {
    const discountRate = (fedRate + riskPremium) / 100;
    const revenues: number[] = [];
    const baseRevenues: number[] = [];
    const contractRevenues: number[] = [];
    const opIncomeArr: number[] = [];
    const nopatArr: number[] = [];
    const fcfArr: number[] = [];

    let totalPV = 0;
    YEARS.forEach((year, i) => {
      const t = i + 1;
      const formulaBase_t = revenueM * Math.pow(1 + cagrPct / 100, t);

      // Layered contract revenue: 0 if toggle off; otherwise sum each
      // contract's effective annual revenue × ramp factor for this calendar
      // year. Contracts that energize after 2030 contribute 0 across all 5y.
      let formulaContracts_t = 0;
      if (contractLayerOn) {
        for (const c of contracts) {
          formulaContracts_t += effectiveAnnualRevenueM(c, defaultRevPerMW_M) * rampFactor(c, year);
        }
      }

      // Manual override wins: the typed number IS the total revenue for that
      // year. Suppress the contract-layer contribution so the bar matches what
      // the user typed instead of stacking another layer on top.
      const override = revenueOverrides[i];
      const baseRevenue_t = override != null ? override : formulaBase_t;
      const contractRevenue_t = override != null ? 0 : formulaContracts_t;
      const revenue_t = baseRevenue_t + contractRevenue_t;

      const opIncome_t = revenue_t * (opMarginPct / 100);
      const nopat_t = opIncome_t * (1 - taxPct / 100);
      const fcf_t = nopat_t - capexM;

      const pv = fcf_t / Math.pow(1 + discountRate, t);
      totalPV += pv;

      revenues.push(revenue_t);
      baseRevenues.push(baseRevenue_t);
      contractRevenues.push(contractRevenue_t);
      opIncomeArr.push(opIncome_t);
      nopatArr.push(nopat_t);
      fcfArr.push(fcf_t);
    });

    const finalFCF = fcfArr[fcfArr.length - 1];
    const terminalValue = finalFCF * terminalMultiple;
    const terminalPV = terminalValue / Math.pow(1 + discountRate, YEARS.length);

    const enterpriseValue = totalPV + terminalPV;
    const btcTreasuryM = defaults.hasBtc ? (btcHoldings * btcPrice) / 1_000_000 : 0;
    const equityValue = enterpriseValue - netDebtM + btcTreasuryM;
    const fairPrice = sharesM > 0 ? equityValue / sharesM : 0;
    const validPrice =
      typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0;
    const deltaPercent = validPrice ? ((fairPrice - (currentPrice as number)) / (currentPrice as number)) * 100 : 0;

    // Don't clamp negative fair prices to 0 — that hides the model's actual
    // verdict ("on these inputs the cash flows don't justify any equity
    // value") behind a misleading "$0.00". Display honestly so the user can
    // see what's going on and adjust the inputs.
    return {
      fairPrice,
      deltaPercent,
      revenues,
      baseRevenues,
      contractRevenues,
      opIncome: opIncomeArr,
      nopat: nopatArr,
      fcf: fcfArr,
      enterpriseValue,
      btcTreasuryM,
      discountRatePct: discountRate * 100,
    };
  }, [
    revenueM, cagrPct, opMarginPct, taxPct, capexM, netDebtM, sharesM,
    fedRate, riskPremium, terminalMultiple,
    btcHoldings, btcPrice, defaults.hasBtc, currentPrice,
    contractLayerOn, contracts, defaultRevPerMW_M,
    revenueOverrides,
  ]);

  // True only when we got a usable current price from the parent — see the
  // DCFValuationProps comment. When false, the "vs market" delta badge is
  // hidden entirely instead of showing a misleading "$0.00".
  const hasPrice =
    typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0;
  const isPositive = results.deltaPercent >= 0;
  const deltaColor = isPositive ? 'var(--green)' : 'var(--pink)';
  const deltaBorder = isPositive ? 'rgba(0,200,5,.35)' : 'rgba(255,0,110,.35)';
  const deltaBg = isPositive ? 'rgba(0,200,5,.08)' : 'rgba(255,0,110,.08)';

  const fmtM = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1000) return `$${(v / 1000).toFixed(1)}B`;
    return `$${Math.round(v).toLocaleString()}M`;
  };

  const DASH = '—';
  const fmtRatio = (v: number | null | undefined): string =>
    v != null && Number.isFinite(v) ? `${v.toFixed(1)}×` : DASH;
  const fmtPct = (v: number | null | undefined): string =>
    v != null && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : DASH;
  const fmtPrice = (v: number | null | undefined): string =>
    v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : DASH;
  const fmtCount = (v: number | null | undefined): string =>
    v != null && Number.isFinite(v) ? `${Math.round(v)}` : DASH;
  const fmtCurrencyShort = (v: number | null | undefined): string => {
    if (v == null || !Number.isFinite(v)) return DASH;
    const abs = Math.abs(v);
    if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    return `$${Math.round(v).toLocaleString()}`;
  };
  const fmtRecommendation = (k: string | null | undefined): string => {
    if (!k) return DASH;
    const map: Record<string, string> = {
      strong_buy: 'Strong Buy',
      buy: 'Buy',
      hold: 'Hold',
      underperform: 'Underperform',
      sell: 'Sell',
      strong_sell: 'Strong Sell',
      none: 'No Rating',
    };
    return map[k.toLowerCase()] ?? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const upsidePct = deep?.analystUpsidePct ?? null;
  const upsideColor =
    upsidePct == null
      ? 'var(--ink)'
      : upsidePct >= 0
        ? 'var(--green)'
        : 'var(--pink)';
  const targetRange =
    deep?.targetLowPrice != null && deep?.targetHighPrice != null
      ? `${fmtPrice(deep.targetLowPrice)} – ${fmtPrice(deep.targetHighPrice)}`
      : DASH;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div>
          <h2 className="rv-h1" style={{ margin: 0 }}>
            {ticker} DCF Valuation
          </h2>
          <p className="rv-sub" style={{ marginTop: 4, marginBottom: 0 }}>
            {companyName} — generic revenue × operating-margin model. Defaults pulled from fundamentals; adjust for your thesis.
          </p>
          <div
            style={{
              marginTop: 6,
              fontSize: 10.5,
              fontFamily: 'JetBrains Mono, monospace',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 8px',
              borderRadius: 999,
              border: `1px solid ${deepError ? 'rgba(255,0,110,.35)' : deep ? 'rgba(0,200,5,.35)' : 'var(--line)'}`,
              background: deepError ? 'rgba(255,0,110,.06)' : deep ? 'rgba(0,200,5,.06)' : '#0c0d10',
              color: deepError ? 'var(--pink)' : deep ? 'var(--green)' : 'var(--ink-mute)',
            }}
          >
            {deepLoading && <span>⟳</span>}
            {deepLoading
              ? 'fetching fundamentals…'
              : deepError
                ? `fundamentals fetch failed (${deepError}) — using defaults`
                : deep
                  ? (() => {
                      const srcs = deep.sources ?? {};
                      const total = Object.keys(srcs).length;
                      const fromSec = Object.values(srcs).filter(v => v === 'sec_edgar').length;
                      const from8K = Object.values(srcs).filter(v => v === 'sec_edgar_8k_ttm').length;
                      const filing = deep.asOfFiling ? ` · 10-K ${deep.asOfFiling}` : '';
                      const lqr = deep.latestQuarterReported;
                      const ttmTag = from8K > 0 && lqr
                        ? ` · TTM thru ${lqr.fiscal_period ?? lqr.period_end} (${lqr.filing_form ?? '8-K'} ${lqr.filing_date ?? ''})`
                        : '';
                      const yfCount = total - fromSec - from8K;
                      const parts: string[] = [];
                      if (fromSec > 0) parts.push(`SEC EDGAR (${fromSec})`);
                      if (from8K > 0) parts.push(`8-K rollup (${from8K})`);
                      if (yfCount > 0) parts.push(`Yahoo (${yfCount})`);
                      const sourceLabel = parts.length > 0 ? parts.join(' + ') : `Yahoo Finance`;
                      return `✓ ${sourceLabel} · ${total} fields${filing}${ttmTag} · ${deep.asOf ?? ''}`;
                    })()
                  : 'using info-based defaults'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="text-meta">CURRENT MARKET PRICE</div>
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 22,
              fontWeight: 700,
              color: hasPrice ? 'var(--blue)' : 'var(--ink-mute)',
              marginTop: 2,
            }}
            title={hasPrice ? undefined : 'Live price unavailable — try refreshing.'}
          >
            {hasPrice ? `$${(currentPrice as number).toFixed(2)}` : '—'}
          </div>
        </div>
      </div>

      {/* Yahoo Finance snapshot — read-only market/analyst view alongside the
          adjustable DCF below. */}
      <div
        className="rv-card"
        style={{
          marginTop: 0,
          marginBottom: 18,
          padding: 14,
          borderLeft: '3px solid var(--blue)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 18,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--blue)',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Valuation Multiples
          </div>
          <SnapshotRow label="P/E (trailing)" value={fmtRatio(deep?.trailingPE)} />
          <SnapshotRow label="P/E (forward)" value={fmtRatio(deep?.forwardPE)} />
          <SnapshotRow label="PEG" value={fmtRatio(deep?.pegRatio)} />
          <SnapshotRow label="P/B" value={fmtRatio(deep?.priceToBook)} />
          <SnapshotRow label="P/S" value={fmtRatio(deep?.priceToSales)} />
          <SnapshotRow label="EV/EBITDA" value={fmtRatio(deep?.evToEbitda)} />
          <SnapshotRow label="Enterprise Value" value={fmtCurrencyShort(deep?.enterpriseValue)} />
          <SnapshotRow label="Market Cap" value={fmtCurrencyShort(deep?.marketCap)} />
        </div>

        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--gold)',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Profitability
          </div>
          <SnapshotRow label="ROE" value={fmtPct(deep?.returnOnEquity)} />
          <SnapshotRow label="ROA" value={fmtPct(deep?.returnOnAssets)} />
          <SnapshotRow label="Gross Margin" value={fmtPct(deep?.grossMargins)} />
          <SnapshotRow label="EBITDA Margin" value={fmtPct(deep?.ebitdaMargins)} />
          <SnapshotRow label="Profit Margin" value={fmtPct(deep?.profitMargins)} />
          <SnapshotRow label="Earnings Growth (1y)" value={fmtPct(deep?.earningsGrowth)} />
          <SnapshotRow label="Revenue CAGR" value={fmtPct(deep?.revenueCagr)} />
          <SnapshotRow label="Beta" value={fmtRatio(deep?.beta)} />
        </div>

        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--green)',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Analyst Consensus
          </div>
          <SnapshotRow label="Target (mean)" value={fmtPrice(deep?.targetMeanPrice)} />
          <SnapshotRow
            label="Upside"
            value={upsidePct != null ? `${(upsidePct * 100).toFixed(1)}%` : DASH}
            valueColor={upsideColor}
          />
          <SnapshotRow label="Target (median)" value={fmtPrice(deep?.targetMedianPrice)} />
          <SnapshotRow label="Target range" value={targetRange} />
          <SnapshotRow label="# Analysts" value={fmtCount(deep?.numberOfAnalystOpinions)} />
          <SnapshotRow label="Recommendation" value={fmtRecommendation(deep?.recommendationKey)} />
          <SnapshotRow label="Rating (1=Buy, 5=Sell)" value={fmtRatio(deep?.recommendationMean)} />
        </div>
      </div>

      <ContractsPanel
        ticker={ticker}
        contracts={contracts}
        onContractsChange={handleContractsChange}
        defaultRevPerMW_M={defaultRevPerMW_M}
      />

      <div className="rv-dcf-grid">
        {/* Left — controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AccordionSection
            title="🔌 Contract Layer"
            accent="var(--blue)"
            isOpen={openSections.contracts}
            onToggle={() => toggleSection('contracts')}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
                color: 'var(--ink-dim)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={contractLayerOn}
                onChange={(e) => setContractLayerOn(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--blue)' }}
              />
              Bake contracts into projection
            </label>
            <Slider
              label="Default revenue per MW (HPC baseline)"
              value={defaultRevPerMW_M}
              onChange={setDefaultRevPerMW_M}
              min={0.5}
              max={5}
              step={0.1}
              formatValue={(v) => `$${v.toFixed(1)}M/MW/yr`}
              description="Used only when a contract has MW disclosed but no $ figure stated."
              accent="var(--blue)"
            />
            <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'JetBrains Mono, monospace' }}>
              {contracts.length} contract{contracts.length === 1 ? '' : 's'} loaded · layer {contractLayerOn ? 'ON' : 'OFF'}
            </p>
          </AccordionSection>

          <AccordionSection
            title="📈 Revenue & Growth"
            accent="var(--green)"
            isOpen={openSections.rev}
            onToggle={() => toggleSection('rev')}
          >
            <Slider
              label="Current Revenue (TTM)"
              value={revenueM}
              onChange={setRevenueM}
              min={10}
              max={Math.max(100_000, defaults.revenueM * 3)}
              step={10}
              formatValue={fmtM}
              description="Trailing twelve-month revenue. Default from yfinance."
              accent="var(--green)"
            />
            <Slider
              label="Annual Revenue CAGR"
              value={cagrPct}
              onChange={setCagrPct}
              min={-20}
              max={80}
              step={0.5}
              formatValue={(v) => `${v.toFixed(1)}%`}
              description="Compound annual growth rate over the 5-year projection."
              accent="var(--green)"
            />
          </AccordionSection>

          <AccordionSection
            title="💼 Operating Margin & Tax"
            accent="var(--gold)"
            isOpen={openSections.margin}
            onToggle={() => toggleSection('margin')}
          >
            <Slider
              label="Operating Margin"
              value={opMarginPct}
              onChange={setOpMarginPct}
              min={-20}
              max={95}
              step={1}
              formatValue={(v) => `${v}%`}
              description="EBIT / Revenue. Negative values allowed for early-stage."
              accent="var(--gold)"
            />
            <Slider
              label="Effective Tax Rate"
              value={taxPct}
              onChange={setTaxPct}
              min={0}
              max={40}
              step={1}
              formatValue={(v) => `${v}%`}
              description="Applied to operating income to derive NOPAT."
              accent="var(--gold)"
            />
          </AccordionSection>

          <AccordionSection
            title="🏦 Balance Sheet"
            accent="var(--pink)"
            isOpen={openSections.cap}
            onToggle={() => toggleSection('cap')}
          >
            <Slider
              label="Net Debt"
              value={netDebtM}
              onChange={setNetDebtM}
              min={-50_000}
              max={Math.max(10_000, defaults.netDebtM * 2)}
              step={10}
              formatValue={fmtM}
              description="Total debt minus cash. Negative = net cash."
              accent="var(--pink)"
            />
            <Slider
              label="Annual CAPEX"
              value={capexM}
              onChange={setCapexM}
              min={0}
              max={Math.max(1000, defaults.capexM * 4)}
              step={5}
              formatValue={fmtM}
              description="Reinvestment subtracted from NOPAT each year."
              accent="var(--pink)"
            />
            <Slider
              label="Shares Outstanding"
              value={sharesM}
              onChange={setSharesM}
              min={1}
              max={Math.max(2000, defaults.sharesM * 2)}
              step={1}
              formatValue={(v) => `${v.toLocaleString()}M`}
              description="Diluted share count used for per-share fair value."
              accent="var(--pink)"
            />
          </AccordionSection>

          {defaults.hasBtc && (
            <AccordionSection
              title="₿ Bitcoin on Balance Sheet"
              accent="var(--gold)"
              isOpen={openSections.btc}
              onToggle={() => toggleSection('btc')}
            >
              <Slider
                label="BTC Holdings"
                value={btcHoldings}
                onChange={setBtcHoldings}
                min={0}
                max={Math.max(10_000, defaults.btcHoldings * 3)}
                step={100}
                formatValue={(v) => `${v.toLocaleString()} coins`}
                description="Treasury coins added to equity value at market price."
                accent="var(--gold)"
              />
              <Slider
                label="Bitcoin Price (Avg)"
                value={btcPrice}
                onChange={setBtcPrice}
                min={10_000}
                max={300_000}
                step={1_000}
                formatValue={(v) => `$${v.toLocaleString()}`}
                description="Mark-to-market price for the treasury stack."
                accent="var(--gold)"
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(255,215,0,.08)',
                  border: '1px solid rgba(255,215,0,.3)',
                  padding: '8px 10px',
                  borderRadius: 6,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 500 }}>BTC Treasury Value</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  {fmtM(results.btcTreasuryM)}
                </span>
              </div>
            </AccordionSection>
          )}

          <AccordionSection
            title="🏛️ Macro (Fed Rate)"
            accent="var(--blue)"
            isOpen={openSections.macro}
            onToggle={() => toggleSection('macro')}
          >
            <Slider
              label="Avg Fed Funds Rate"
              value={fedRate}
              onChange={setFedRate}
              min={0}
              max={10}
              step={0.25}
              formatValue={(v) => `${v.toFixed(2)}%`}
              description="Base risk-free rate for the next 5 years."
              accent="var(--blue)"
            />
            <div
              style={{
                fontSize: 11,
                color: 'var(--ink-dim)',
                background: 'rgba(76,154,255,.08)',
                border: '1px solid rgba(76,154,255,.25)',
                padding: '8px 10px',
                borderRadius: 6,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              <b style={{ color: 'var(--blue)' }}>Impact:</b> Higher Fed rates raise the discount rate, lowering the present value of future cash flows.
            </div>
          </AccordionSection>

          <AccordionSection
            title="⚖️ Valuation Settings"
            accent="var(--purple)"
            isOpen={openSections.val}
            onToggle={() => toggleSection('val')}
          >
            <Slider
              label="Company Risk Premium"
              value={riskPremium}
              onChange={setRiskPremium}
              min={1}
              max={12}
              step={0.5}
              formatValue={(v) => `${v.toFixed(1)}%`}
              description="Extra return investors demand above the risk-free rate."
              accent="var(--purple)"
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(157,122,255,.08)',
                border: '1px solid rgba(157,122,255,.3)',
                padding: '8px 10px',
                borderRadius: 6,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 500 }}>Total Discount Rate</span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                {results.discountRatePct.toFixed(2)}%
              </span>
            </div>
            <Slider
              label="Terminal Multiple"
              value={terminalMultiple}
              onChange={setTerminalMultiple}
              min={5}
              max={30}
              step={1}
              formatValue={(v) => `${v}x`}
              description="Exit multiple applied to final-year FCF."
              accent="var(--purple)"
            />
          </AccordionSection>
        </div>

        {/* Right — forecast charts (Revenue / Net Income / FCF) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DCFForecastCharts
            results={{
              revenues: results.revenues,
              baseRevenues: results.baseRevenues,
              contractRevenues: results.contractRevenues,
              nopat: results.nopat,
              fcf: results.fcf,
              fairPrice: results.fairPrice,
              deltaPercent: results.deltaPercent,
            }}
            years={YEARS.map(String)}
            currentPrice={typeof currentPrice === 'number' && Number.isFinite(currentPrice) ? currentPrice : undefined}
            revenueOverrideRow={
              <RevenueOverrideRow
                years={YEARS}
                computed={results.revenues}
                overrides={revenueOverrides}
                onChange={(idx, val) =>
                  setRevenueOverrides((prev) => {
                    const next = [...prev];
                    next[idx] = val;
                    return next;
                  })
                }
                onResetAll={() => setRevenueOverrides(YEARS.map(() => null))}
              />
            }
          />
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--ink-mute)',
              fontFamily: 'JetBrains Mono, monospace',
              textAlign: 'center',
              padding: '0 4px',
            }}
          >
            EV: {fmtM(results.enterpriseValue)}
            {defaults.hasBtc ? ` · BTC treasury: ${fmtM(results.btcTreasuryM)}` : ''}
            {' · '}
            Net debt: {fmtM(netDebtM)} · Shares: {sharesM.toLocaleString()}M
            {' · '}
            Discount: {results.discountRatePct.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  );
}
