'use client';

import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Fundamentals } from '@/app/stock/[ticker]/StockDetailClient';

interface DCFValuationProps {
  ticker: string;
  currentPrice: number;
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
}

type AccentVar = 'var(--green)' | 'var(--gold)' | 'var(--pink)' | 'var(--blue)' | 'var(--purple)';

const YEARS = [2026, 2027, 2028, 2029, 2030] as const;

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

  const capexAbs = deep?.capex ?? null;
  const capexM =
    capexAbs != null
      ? Math.round(capexAbs / 1_000_000)
      : revenueM > 0
        ? Math.round(revenueM * 0.1)
        : 50;

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
  }, [defaults]);

  const [openSections, setOpenSections] = useState({
    rev: true,
    margin: false,
    cap: false,
    btc: false,
    macro: false,
    val: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const results = useMemo(() => {
    const discountRate = (fedRate + riskPremium) / 100;
    const revenues: number[] = [];
    const opIncomeArr: number[] = [];
    const fcfArr: number[] = [];

    let totalPV = 0;
    YEARS.forEach((_year, i) => {
      const t = i + 1;
      const revenue_t = revenueM * Math.pow(1 + cagrPct / 100, t);
      const opIncome_t = revenue_t * (opMarginPct / 100);
      const nopat_t = opIncome_t * (1 - taxPct / 100);
      const fcf_t = nopat_t - capexM;

      const pv = fcf_t / Math.pow(1 + discountRate, t);
      totalPV += pv;

      revenues.push(revenue_t);
      opIncomeArr.push(opIncome_t);
      fcfArr.push(fcf_t);
    });

    const finalFCF = fcfArr[fcfArr.length - 1];
    const terminalValue = finalFCF * terminalMultiple;
    const terminalPV = terminalValue / Math.pow(1 + discountRate, YEARS.length);

    const enterpriseValue = totalPV + terminalPV;
    const btcTreasuryM = defaults.hasBtc ? (btcHoldings * btcPrice) / 1_000_000 : 0;
    const equityValue = enterpriseValue - netDebtM + btcTreasuryM;
    const fairPrice = sharesM > 0 ? equityValue / sharesM : 0;
    const deltaPercent = currentPrice ? ((fairPrice - currentPrice) / currentPrice) * 100 : 0;

    return {
      fairPrice: Math.max(0, fairPrice),
      deltaPercent,
      revenues,
      opIncome: opIncomeArr,
      fcf: fcfArr,
      enterpriseValue,
      btcTreasuryM,
      discountRatePct: discountRate * 100,
    };
  }, [
    revenueM, cagrPct, opMarginPct, taxPct, capexM, netDebtM, sharesM,
    fedRate, riskPremium, terminalMultiple,
    btcHoldings, btcPrice, defaults.hasBtc, currentPrice,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const green = styles.getPropertyValue('--green').trim() || '#00C805';
    const line = styles.getPropertyValue('--line').trim() || '#26272d';
    const mute = styles.getPropertyValue('--ink-mute').trim() || '#a3a3a8';

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const peak = Math.max(...results.revenues.map(Math.abs), 1) * 1.15;
    const padding = 40;
    const chartHeight = rect.height - padding * 2;
    const chartWidth = rect.width - padding * 2;
    const spacing = chartWidth / YEARS.length;
    const barWidth = spacing * 0.4;
    const zeroY = padding + chartHeight; // x-axis position

    YEARS.forEach((year, i) => {
      const x = padding + i * spacing + spacing / 2;
      const revH = Math.max(0, (Math.max(0, results.revenues[i]) / peak) * chartHeight);
      const fcfVal = results.fcf[i];
      const fcfH = (Math.abs(fcfVal) / peak) * chartHeight;

      // Revenue bar (positive only)
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.roundRect(x - barWidth, zeroY - revH, barWidth * 2, revH, 4);
      ctx.fill();

      // FCF bar (green up, pink down for negatives)
      ctx.fillStyle = fcfVal >= 0 ? green : '#ff006e';
      ctx.beginPath();
      const fcfY = fcfVal >= 0 ? zeroY - fcfH : zeroY;
      ctx.roundRect(x - barWidth + 4, fcfY, barWidth * 2 - 8, fcfH, 4);
      ctx.fill();

      ctx.fillStyle = mute;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(year.toString(), x, rect.height - 10);
    });
  }, [results]);

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
              ? 'fetching Yahoo Finance fundamentals…'
              : deepError
                ? `Yahoo Finance fetch failed (${deepError}) — using fallback defaults`
                : deep
                  ? `✓ Yahoo Finance · ${Object.keys(deep.sources ?? {}).length} fields · ${deep.asOf ?? ''}`
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
              color: 'var(--blue)',
              marginTop: 2,
            }}
          >
            ${currentPrice.toFixed(2)}
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 5fr) minmax(320px, 7fr)',
          gap: 18,
          alignItems: 'start',
        }}
      >
        {/* Left — controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

        {/* Right — results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Fair price hero */}
          <div
            className="rv-card"
            style={{
              marginTop: 0,
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'linear-gradient(160deg, rgba(0,200,5,.06) 0%, var(--card) 50%, rgba(255,215,0,.05) 100%)',
            }}
          >
            <div className="text-section" style={{ marginBottom: 4 }}>
              ESTIMATED FAIR SHARE PRICE
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 22, color: 'var(--green)', fontWeight: 700 }}>$</span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 72,
                  fontWeight: 700,
                  color: 'var(--ink)',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {results.fairPrice.toFixed(2)}
              </span>
            </div>
            <div
              style={{
                marginTop: 14,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                padding: '4px 12px',
                borderRadius: 999,
                border: `1px solid ${deltaBorder}`,
                background: deltaBg,
                color: deltaColor,
                fontWeight: 600,
              }}
            >
              {isPositive ? '▲' : '▼'} {Math.abs(results.deltaPercent).toFixed(1)}% vs market (${currentPrice.toFixed(2)})
            </div>
          </div>

          {/* Chart */}
          <div className="rv-card" style={{ marginTop: 0 }}>
            <div className="rv-card-head">
              <h3>CASH FLOW FORECAST (2026 – 2030)</h3>
            </div>
            <div style={{ position: 'relative', width: '100%', height: 240 }}>
              <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 18,
                marginTop: 10,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 10.5,
                color: 'var(--ink-dim)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, background: 'var(--line)', borderRadius: 2 }} /> Revenue
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, background: 'var(--green)', borderRadius: 2 }} /> Free Cash Flow
              </span>
            </div>
          </div>

          {/* Breakdown table */}
          <div className="rv-card" style={{ marginTop: 0 }}>
            <table className="rv-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="r">2026</th>
                  <th className="r">2028</th>
                  <th className="r">2030</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Total Revenue</td>
                  <td className="r rv-num">{fmtM(results.revenues[0])}</td>
                  <td className="r rv-num">{fmtM(results.revenues[2])}</td>
                  <td className="r rv-num">{fmtM(results.revenues[4])}</td>
                </tr>
                <tr>
                  <td>Operating Income</td>
                  <td className="r rv-num">{fmtM(results.opIncome[0])}</td>
                  <td className="r rv-num">{fmtM(results.opIncome[2])}</td>
                  <td className="r rv-num">{fmtM(results.opIncome[4])}</td>
                </tr>
                <tr style={{ background: 'rgba(0,200,5,.06)' }}>
                  <td style={{ color: 'var(--green)', fontWeight: 600 }}>Free Cash Flow</td>
                  <td className="r" style={{ color: 'var(--green)' }}>{fmtM(results.fcf[0])}</td>
                  <td className="r" style={{ color: 'var(--green)' }}>{fmtM(results.fcf[2])}</td>
                  <td className="r" style={{ color: 'var(--green)' }}>{fmtM(results.fcf[4])}</td>
                </tr>
              </tbody>
            </table>
            <div
              style={{
                marginTop: 10,
                fontSize: 10.5,
                color: 'var(--ink-mute)',
                fontFamily: 'JetBrains Mono, monospace',
                textAlign: 'center',
              }}
            >
              EV: {fmtM(results.enterpriseValue)}
              {defaults.hasBtc ? ` · BTC treasury: ${fmtM(results.btcTreasuryM)}` : ''}
              {' · '}
              Net debt: {fmtM(netDebtM)} · Shares: {sharesM.toLocaleString()}M
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
