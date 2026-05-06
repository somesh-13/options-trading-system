'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getOptionExpirations, getOptionChain, type OptionChainLeg } from '@/lib/pricing-api';
import { RESIZE_LOCALSTORAGE_PREFIX } from '@/lib/useDisplaySettings';
import type { Opportunity } from './ScannerTable';

const RESIZE_KEY = RESIZE_LOCALSTORAGE_PREFIX + 'overlay:premium-picks';

interface PersistedSize {
  w?: number;
  h?: number;
}

function loadSize(): PersistedSize {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RESIZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedSize;
    return {
      w: typeof parsed.w === 'number' && Number.isFinite(parsed.w) ? parsed.w : undefined,
      h: typeof parsed.h === 'number' && Number.isFinite(parsed.h) ? parsed.h : undefined,
    };
  } catch {
    return {};
  }
}

function saveSize(size: PersistedSize): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RESIZE_KEY, JSON.stringify(size));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

const MAX_TICKERS = 6;
const MIN_DTE = 5;
const MAX_DTE = 60;
const TOP_N_PER_SIDE = 8;

type Side = 'call' | 'put';

interface Pick {
  ticker: string;
  spot: number;
  side: Side;
  expiration: string;
  dte: number;
  strike: number;
  mid: number;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  volume: number;
  openInterest: number;
  yieldPct: number;        // mid / strike (per period)
  annualizedPct: number;   // annualized yield
  otmPct: number;          // distance from spot, in % (positive = further OTM)
  ratio: number;           // IV/HV ratio of the underlying (carried over for context)
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading'; progress: number; total: number }
  | { status: 'ok'; calls: Pick[]; puts: Pick[]; errors: string[] }
  | { status: 'error'; message: string };

function pickExpiration(
  expirations: { expiration: string; dte: number }[],
): { expiration: string; dte: number } | null {
  const eligible = expirations
    .filter((e) => e.dte >= MIN_DTE && e.dte <= MAX_DTE)
    .sort((a, b) => a.dte - b.dte);
  if (eligible.length > 0) return eligible[0];
  // Fallback: nearest non-zero DTE if nothing in window
  const positive = expirations.filter((e) => e.dte > 0).sort((a, b) => a.dte - b.dte);
  return positive[0] ?? null;
}

function legsToPicks(
  ticker: string,
  spot: number,
  ratio: number,
  expiration: string,
  dte: number,
  legs: OptionChainLeg[],
  side: Side,
): Pick[] {
  return legs
    .map<Pick | null>((leg) => {
      const strike = leg.strike;
      if (strike == null || strike <= 0) return null;

      // OTM only — calls above spot, puts below spot.
      if (side === 'call' && strike <= spot) return null;
      if (side === 'put' && strike >= spot) return null;

      // Prefer mid; fall back to bid/last only if mid missing.
      let mid = leg.mid ?? null;
      if (mid == null && leg.bid != null && leg.ask != null) {
        mid = (leg.bid + leg.ask) / 2;
      }
      if (mid == null) mid = leg.last ?? null;
      if (mid == null || mid <= 0) return null;

      // Liquidity filter — drop dead strikes.
      if (leg.volume === 0 && leg.open_interest < 10) return null;

      const yieldPct = mid / strike;
      const annualizedPct = yieldPct * (365 / Math.max(dte, 1));
      const otmPct = ((strike - spot) / spot) * (side === 'call' ? 1 : -1);

      return {
        ticker,
        spot,
        side,
        expiration,
        dte,
        strike,
        mid,
        bid: leg.bid,
        ask: leg.ask,
        iv: leg.iv,
        volume: leg.volume,
        openInterest: leg.open_interest,
        yieldPct,
        annualizedPct,
        otmPct,
        ratio,
      };
    })
    .filter((p): p is Pick => p !== null);
}

async function loadPicksForTicker(
  ticker: string,
  spot: number,
  ratio: number,
): Promise<{ calls: Pick[]; puts: Pick[] }> {
  const exps = await getOptionExpirations(ticker);
  const chosen = pickExpiration(exps.expirations);
  if (!chosen) return { calls: [], puts: [] };

  const chain = await getOptionChain(ticker, chosen.expiration);
  const useSpot = chain.spot ?? exps.spot ?? spot;

  return {
    calls: legsToPicks(ticker, useSpot, ratio, chosen.expiration, chosen.dte, chain.calls, 'call'),
    puts: legsToPicks(ticker, useSpot, ratio, chosen.expiration, chosen.dte, chain.puts, 'put'),
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  candidates: Opportunity[];
}

export function PremiumPicksOverlay({ open, onClose, candidates }: Props) {
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  // Pick the top N tickers by IV/HV ratio (already sorted in ScannerShell).
  const targets = useMemo(
    () =>
      candidates
        .filter((c) => c.spot > 0)
        .slice(0, MAX_TICKERS),
    [candidates],
  );

  useEffect(() => {
    if (!open) return;
    if (targets.length === 0) {
      setState({ status: 'error', message: 'No tickers loaded yet — wait for the scanner to finish.' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', progress: 0, total: targets.length });

    (async () => {
      const allCalls: Pick[] = [];
      const allPuts: Pick[] = [];
      const errors: string[] = [];
      let done = 0;

      // Bounded concurrency.
      const queue = [...targets];
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length > 0) {
          const t = queue.shift();
          if (!t) break;
          try {
            const { calls, puts } = await loadPicksForTicker(t.ticker, t.spot, t.ratio);
            if (cancelled) return;
            allCalls.push(...calls);
            allPuts.push(...puts);
          } catch {
            if (cancelled) return;
            errors.push(t.ticker);
          } finally {
            done++;
            if (!cancelled) {
              setState((prev) =>
                prev.status === 'loading'
                  ? { status: 'loading', progress: done, total: prev.total }
                  : prev,
              );
            }
          }
        }
      });

      await Promise.all(workers);
      if (cancelled) return;

      allCalls.sort((a, b) => b.annualizedPct - a.annualizedPct);
      allPuts.sort((a, b) => b.annualizedPct - a.annualizedPct);

      setState({
        status: 'ok',
        calls: allCalls.slice(0, TOP_N_PER_SIDE),
        puts: allPuts.slice(0, TOP_N_PER_SIDE),
        errors,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, targets]);

  // Persisted resize: load on open, observe + debounce-write while open.
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

  if (!open) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Juiciest premium picks"
      onClick={onClose}
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
          width: persisted.w ?? 'min(1280px, 96vw)',
          height: persisted.h,
          minWidth: 720,
          minHeight: 420,
          maxWidth: '98vw',
          maxHeight: '95vh',
          resize: 'both',
          overflow: 'auto',
          padding: 16,
          background: 'var(--surface-raised, #161616)',
          position: 'relative',
        }}
      >
        {/* Drag-to-resize affordance — the native handle sits in the bottom-right
            corner but is invisible on dark themes. This subtle glyph helps users
            discover it. The native handle handles the actual drag. */}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>$ Juiciest premium to sell</h3>
          <button
            type="button"
            className="rv-btn ghost"
            onClick={onClose}
            style={{ fontSize: 11, padding: '2px 10px' }}
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>
        <div className="rv-sub" style={{ fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
          OTM strikes ranked by annualized yield = (mid / strike) × (365 / DTE).
          {` Universe: top ${targets.length} portfolio tickers by IV/HV. `}
          Nearest expiration with {MIN_DTE}–{MAX_DTE} DTE.
        </div>

        {state.status === 'loading' && (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--ink-mute)',
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 8 }}>⟳</div>
            <div>
              Loading option chains… {state.progress}/{state.total}
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="rv-sub" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>
            {state.message}
          </div>
        )}

        {state.status === 'ok' && (
          <>
            {state.errors.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {state.errors.map((sym) => (
                  <span
                    key={sym}
                    className="rv-chip sell"
                    style={{ fontSize: 10 }}
                    title={`${sym} option chain fetch failed`}
                  >
                    {sym} ✗
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <PicksTable
                title="Sell calls (covered call)"
                subtitle="OTM above spot — assignment = sell shares at strike"
                rows={state.calls}
              />
              <PicksTable
                title="Sell puts (cash-secured put)"
                subtitle="OTM below spot — assignment = buy shares at strike"
                rows={state.puts}
              />
            </div>

            {state.calls.length === 0 && state.puts.length === 0 && (
              <div className="rv-sub" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>
                No liquid OTM strikes found in the {MIN_DTE}–{MAX_DTE} DTE window.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PicksTable({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Pick[];
}) {
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{title}</div>
        <div className="rv-sub" style={{ fontSize: 10 }}>
          {subtitle}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="rv-table" style={{ fontSize: 11, width: '100%' }}>
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="r">Strike</th>
              <th className="r">Mid</th>
              <th className="r" title="Annualized yield = (mid / strike) × (365 / DTE)">
                Ann %
              </th>
              <th className="r" title="Per-period yield: mid / strike">
                %/exp
              </th>
              <th className="r">OTM%</th>
              <th className="r">DTE</th>
              <th className="r" title="Volume / Open Interest">
                Vol/OI
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const annTier =
                p.annualizedPct >= 0.5 ? 'rv-up' : p.annualizedPct >= 0.2 ? '' : 'rv-sub';
              const pricingHref = `/pricing?ticker=${p.ticker}&strike=${p.strike}&type=${p.side}&expiry=${p.expiration}`;
              return (
                <tr key={`${p.ticker}-${p.side}-${p.strike}-${p.expiration}`}>
                  <td>
                    <Link href={pricingHref} className="rv-ticker-link" prefetch>
                      {p.ticker}
                    </Link>
                  </td>
                  <td className="r">
                    <Link
                      href={pricingHref}
                      prefetch
                      style={{ color: 'inherit', textDecoration: 'none' }}
                      title={`Open ${p.ticker} ${p.side.toUpperCase()} $${p.strike.toFixed(2)} on pricing page`}
                    >
                      ${p.strike.toFixed(2)}
                    </Link>
                  </td>
                  <td className="r">${p.mid.toFixed(2)}</td>
                  <td className={`r ${annTier}`}>
                    <b>{(p.annualizedPct * 100).toFixed(1)}%</b>
                  </td>
                  <td className="r">{(p.yieldPct * 100).toFixed(2)}%</td>
                  <td className="r">{(p.otmPct * 100).toFixed(1)}%</td>
                  <td className="r">{p.dte}d</td>
                  <td className="r" style={{ color: 'var(--ink-mute)' }}>
                    {p.volume}/{p.openInterest}
                  </td>
                  <td>
                    <Link
                      href={`/options-chain?ticker=${p.ticker}&expiration=${p.expiration}`}
                      className="rv-btn ghost"
                      style={{ fontSize: 10, padding: '2px 6px', textDecoration: 'none' }}
                    >
                      chain
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="rv-sub" style={{ padding: 12, textAlign: 'center' }}>
                  No qualifying strikes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
