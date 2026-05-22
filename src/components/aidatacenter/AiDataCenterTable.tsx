'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { AI_DC_PEERS, AiDataCenterPeer, BusinessModel } from '@/data/aiDataCenter';
import { getTickerPrice } from '@/lib/pricing-api';

type PriceMap = Record<string, number | null>;

type SortKey =
  | 'rank'
  | 'ticker'
  | 'model'
  | 'gpuModels'
  | 'gpuCount'
  | 'contractedMW'
  | 'revenuePerMwUsd'
  | 'utilizationPct'
  | 'capexPerMwUsdM'
  | 'annualDepreciationUsdM'
  | 'siteNoiMarginPct'
  | 'evPerMwUsdM'
  | 'backlogUsdB'
  | 'flagshipCounterparty'
  | 'price'
  | 'marketCapPerMw'
  | 'forwardPe';

type SortDir = 'asc' | 'desc';

function modelChipClass(m: BusinessModel): string {
  return m === 'Neocloud' ? 'buy' : m === 'HPC Landlord' ? 'sell' : 'warn';
}

function formatGpuCount(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatUsdMillions(usd: number): string {
  return `$${(usd / 1_000_000).toFixed(2)}M`;
}

function utilDisplay(p: AiDataCenterPeer): { text: string; cls: string } {
  if (p.utilizationPct === null) return { text: '—', cls: '' };
  if (p.utilizationPct === 0) return { text: '0%', cls: 'rv-dn' };
  if (p.utilizationPct >= 25) return { text: `${p.utilizationPct}%`, cls: 'rv-up' };
  return { text: `${p.utilizationPct}%`, cls: '' };
}

function computeMarketCapUsd(p: AiDataCenterPeer, price: number | null): number | null {
  if (price === null || !isFinite(price)) return null;
  return price * p.sharesOutstandingM * 1_000_000;
}

function computeMarketCapPerMwUsdM(p: AiDataCenterPeer, price: number | null): number | null {
  const mc = computeMarketCapUsd(p, price);
  if (mc === null) return null;
  return mc / p.contractedMW / 1_000_000;
}

function computeForwardPe(p: AiDataCenterPeer, price: number | null): number | null {
  if (price === null || p.forwardEpsUsd === null || p.forwardEpsUsd <= 0) return null;
  return price / p.forwardEpsUsd;
}

type EnrichedPeer = AiDataCenterPeer & {
  price: number | null;
  marketCapPerMw: number | null;
  forwardPe: number | null;
};

function enrich(rows: AiDataCenterPeer[], prices: PriceMap): EnrichedPeer[] {
  return rows.map((p) => {
    const price = prices[p.ticker] ?? null;
    return {
      ...p,
      price,
      marketCapPerMw: computeMarketCapPerMwUsdM(p, price),
      forwardPe: computeForwardPe(p, price),
    };
  });
}

function getSortValue(p: EnrichedPeer, key: SortKey): number | string {
  const v = p[key as keyof EnrichedPeer];
  if (v === null || v === undefined) return -Infinity;
  return v as number | string;
}

const COLUMNS: { key: SortKey; label: string; align?: 'r'; title?: string; minWidth?: number }[] = [
  { key: 'rank', label: '#', align: 'r' },
  { key: 'ticker', label: 'Ticker' },
  { key: 'model', label: 'Model' },
  { key: 'price', label: 'Price', align: 'r', title: 'Live spot from backend' },
  { key: 'marketCapPerMw', label: 'Mkt Cap / MW', align: 'r', title: 'Market cap ÷ contracted critical IT MW ($M / MW)' },
  { key: 'forwardPe', label: 'Fwd P/E', align: 'r', title: 'Price ÷ forward (FY26) EPS estimate; N/M where consensus EPS is negative' },
  { key: 'gpuModels', label: 'GPUs', minWidth: 180 },
  { key: 'gpuCount', label: '# GPUs', align: 'r' },
  { key: 'contractedMW', label: 'MW (IT)', align: 'r', title: 'Contracted critical IT MW' },
  { key: 'revenuePerMwUsd', label: 'Rev / MW', align: 'r', title: 'Contracted revenue per critical IT MW per year' },
  { key: 'utilizationPct', label: 'Util %', align: 'r', title: 'Net GPU / MW load rate (utilization %)' },
  { key: 'capexPerMwUsdM', label: 'CapEx/MW', align: 'r', title: 'CapEx per MW build cost ($M)' },
  { key: 'annualDepreciationUsdM', label: 'D&A', align: 'r', title: 'Annual depreciation & amortization, USD millions (FY25)' },
  { key: 'siteNoiMarginPct', label: 'NOI %', align: 'r', title: 'Site-level NOI / EBITDA margin' },
  { key: 'evPerMwUsdM', label: 'EV/MW', align: 'r', title: 'Enterprise value per contracted MW ($M)' },
  { key: 'backlogUsdB', label: 'Backlog', align: 'r', title: 'Contracted revenue backlog, USD billions' },
  { key: 'flagshipCounterparty', label: 'Top counterparty', minWidth: 220 },
];

interface AiDataCenterTableProps {
  rows?: AiDataCenterPeer[];
}

export function AiDataCenterTable({ rows = AI_DC_PEERS }: AiDataCenterTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [prices, setPrices] = useState<PriceMap>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const syncPrices = useCallback(async () => {
    setLoadingPrices(true);
    setPriceError(null);
    const next: PriceMap = {};
    const results = await Promise.allSettled(
      rows.map(async (p) => {
        const price = await getTickerPrice(p.ticker);
        return { ticker: p.ticker, price };
      })
    );
    let failures = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        next[r.value.ticker] = r.value.price;
      } else {
        next[rows[i].ticker] = null;
        failures += 1;
      }
    }
    setPrices(next);
    setLastSync(new Date());
    setLoadingPrices(false);
    if (failures > 0) {
      setPriceError(
        `${failures} / ${rows.length} prices failed to load (backend offline?)`
      );
    }
  }, [rows]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount; mirrors RegimeShiftPanel pattern
    void syncPrices();
  }, [syncPrices]);

  const enriched = useMemo(() => enrich(rows, prices), [rows, prices]);

  const sorted = useMemo(() => {
    const arr = [...enriched];
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [enriched, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'rank' || key === 'ticker' || key === 'model' || key === 'gpuModels' || key === 'flagshipCounterparty'
          ? 'asc'
          : 'desc'
      );
    }
  }

  function arrowFor(key: SortKey): string {
    if (key !== sortKey) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  const lastSyncLabel = lastSync ? lastSync.toLocaleTimeString() : '—';

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="rv-btn"
          onClick={() => void syncPrices()}
          disabled={loadingPrices}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: loadingPrices ? 'transparent' : 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            color: loadingPrices ? 'var(--ink-mute)' : 'var(--ink)',
            cursor: loadingPrices ? 'wait' : 'pointer',
          }}
        >
          {loadingPrices ? '⟳ Syncing prices…' : '⟳ Sync Prices'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
          Last sync: <b>{lastSyncLabel}</b>
        </span>
        {priceError && (
          <span style={{ fontSize: 11, color: 'var(--pink)' }}>{priceError}</span>
        )}
      </div>

      <div className="rv-card" style={{ padding: 0 }}>
        <div className="rv-table-wrap">
          <table className="rv-table aidc-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const classes = [
                    c.align === 'r' ? 'r' : '',
                    c.key === 'ticker' ? 'aidc-sticky-col' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <th
                      key={c.key}
                      className={classes}
                      title={c.title}
                      onClick={() => toggleSort(c.key)}
                      style={{
                        cursor: 'pointer',
                        userSelect: 'none',
                        minWidth: c.minWidth,
                        color: c.key === sortKey ? 'var(--gold)' : undefined,
                      }}
                    >
                      {c.label}
                      {arrowFor(c.key)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const util = utilDisplay(p);
                const topTwo = p.rank <= 2;
                return (
                  <tr key={p.ticker} className={p.rank === 1 ? 'sel' : ''}>
                    <td className="r" style={{ color: 'var(--ink-mute)' }}>
                      {p.rank}
                    </td>
                    <td className="aidc-sticky-col">
                      <Link
                        href={`/pricing?ticker=${p.ticker}`}
                        prefetch
                        className="rv-ticker-link"
                        title={p.name}
                      >
                        {p.ticker}
                      </Link>
                    </td>
                    <td>
                      <span className={`rv-chip ${modelChipClass(p.model)}`}>{p.model}</span>
                    </td>
                    <td
                      className="r"
                      style={{
                        color: p.price === null ? 'var(--ink-mute)' : undefined,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {p.price === null ? '—' : `$${p.price.toFixed(2)}`}
                    </td>
                    <td
                      className="r"
                      style={{
                        color: p.marketCapPerMw === null ? 'var(--ink-mute)' : 'var(--gold)',
                        fontWeight: 700,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                      title={
                        p.price !== null
                          ? `Market cap ≈ $${(
                              (p.price * p.sharesOutstandingM) / 1000
                            ).toFixed(2)}B (${p.sharesOutstandingM}M shares × $${p.price.toFixed(2)})`
                          : undefined
                      }
                    >
                      {p.marketCapPerMw === null ? '—' : `$${p.marketCapPerMw.toFixed(1)}M`}
                    </td>
                    <td
                      className="r"
                      style={{
                        color: p.forwardPe === null ? 'var(--ink-mute)' : undefined,
                      }}
                      title={
                        p.forwardEpsUsd === null
                          ? 'Consensus FY26 EPS negative — Fwd P/E not meaningful'
                          : undefined
                      }
                    >
                      {p.forwardPe === null
                        ? p.forwardEpsUsd === null
                          ? 'N/M'
                          : '—'
                        : `${p.forwardPe.toFixed(1)}x`}
                    </td>
                    <td style={{ color: p.gpuCount === null ? 'var(--ink-mute)' : undefined }}>
                      {p.gpuModels}
                    </td>
                    <td className="r" title={p.gpuCountLabel}>
                      {formatGpuCount(p.gpuCount)}
                    </td>
                    <td className="r">{p.contractedMW.toLocaleString()}</td>
                    <td
                      className="r"
                      style={{
                        color: topTwo ? 'var(--gold)' : undefined,
                        fontWeight: topTwo ? 700 : 500,
                      }}
                    >
                      {formatUsdMillions(p.revenuePerMwUsd)}
                    </td>
                    <td className={`r ${util.cls}`} title={p.utilizationNote}>
                      {util.text}
                    </td>
                    <td className="r">${p.capexPerMwUsdM.toFixed(1)}M</td>
                    <td
                      className="r"
                      style={{
                        color: p.annualDepreciationUsdM === null ? 'var(--ink-mute)' : undefined,
                      }}
                    >
                      {p.annualDepreciationUsdM === null
                        ? '—'
                        : `$${p.annualDepreciationUsdM.toLocaleString()}M`}
                    </td>
                    <td className="r">{p.siteNoiMarginPct}%</td>
                    <td className="r">${p.evPerMwUsdM.toFixed(1)}M</td>
                    <td className="r">${p.backlogUsdB.toFixed(2)}B</td>
                    <td style={{ color: 'var(--ink-mute)' }}>{p.flagshipCounterparty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
