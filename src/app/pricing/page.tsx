'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Slider } from '@/components/pricing/Slider';
import { GreekBigCell } from '@/components/pricing/GreekBigCell';
import { MiniVolSurface } from '@/components/pricing/MiniVolSurface';
import { StrikeStrip, buildStrikeWindow } from '@/components/pricing/StrikeStrip';
import { CalcModeToggle, type CalcMode } from '@/components/pricing/CalcModeToggle';
import { SideToggle, type Side } from '@/components/pricing/SideToggle';
import { ContractMetrics } from '@/components/pricing/ContractMetrics';
import { PnLScenarios } from '@/components/pricing/PnLScenarios';
import { VolSmile } from '@/components/pricing/VolSmile';
import { ExpirationStrip, type Expiration } from '@/components/chain/ExpirationStrip';
import { IvHvScale } from '@/components/charts/IvHvScale';
import { OptionsTradePanel } from '@/components/robinhood/OptionsTradePanel';
import {
  calculateImpliedVol,
  calculatePriceAndGreeks,
  getMispricing,
  getOptionExpirations,
  getTickerPrice,
  getVolSurface,
  type Greeks,
  type MispricingData,
  type OptionExpirationMeta,
  type PricingResponse,
  type VolSurfaceData,
} from '@/lib/pricing-api';

const DEFAULT_TICKER = 'CIFR';

type DerivedExpiration = Expiration & { rawDate: string };

const FALLBACK_EXPIRATIONS: DerivedExpiration[] = [
  { dte: '24d', date: 'loading…', rawDate: '', iv: 0, oi: 0 },
];

const RISK_FREE_DEFAULT = 0.045;

function formatExpDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysUntil(iso: string): number {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 0;
  const diffMs = d.getTime() - Date.now();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

const GREEK_UNITS: Record<string, string> = {
  delta: 'per $1 spot',
  gamma: 'Δ per $1 spot',
  theta: '$/share/day',
  vega: '$/share per 1% IV',
  rho: '$/share per 1% rate',
  vanna: 'Δ per 1% IV',
  charm: 'Δ per day',
  volga: 'Vega per 1% IV',
};

function fmtVal(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function PricingPageInner() {
  const searchParams = useSearchParams();
  // Capture ?ticker / ?strike once at mount. We don't subscribe to live URL
  // changes — the user-controlled ticker form is the source of truth after the
  // initial deep-link.
  const initialFromUrl = useMemo(() => {
    const t = searchParams?.get('ticker');
    const s = searchParams?.get('strike');
    const ty = searchParams?.get('type');
    const ex = searchParams?.get('expiry');
    const sNum = s != null ? Number(s) : NaN;
    return {
      ticker: t && /^[A-Z0-9.\-]+$/i.test(t) ? t.toUpperCase() : null,
      strike: Number.isFinite(sNum) && sNum > 0 ? sNum : null,
      type: ty === 'call' || ty === 'put' ? (ty as 'call' | 'put') : null,
      expiry: ex && /^\d{4}-\d{2}-\d{2}$/.test(ex) ? ex : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [ticker, setTicker] = useState(initialFromUrl.ticker ?? DEFAULT_TICKER);
  const [tickerInput, setTickerInput] = useState(initialFromUrl.ticker ?? DEFAULT_TICKER);
  const [optType, setOptType] = useState<'call' | 'put'>(initialFromUrl.type ?? 'call');
  const [side, setSide] = useState<Side>('long');
  const [strike, setStrike] = useState(initialFromUrl.strike ?? 16);
  const [expiryIdx, setExpiryIdx] = useState(2);
  // One-shot guards: when a deep-link supplies ?strike or ?expiry, the first
  // ticker-hydration cycle must NOT overwrite them with the auto-derived ATM
  // strike or expiryIdx=0. After the first cycle, normal ATM/expiry logic
  // resumes (e.g., when the user types a new ticker into the form).
  const urlStrikeConsumedRef = useRef<boolean>(initialFromUrl.strike == null);
  const urlExpiryConsumedRef = useRef<boolean>(initialFromUrl.expiry == null);
  const [spot, setSpot] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0.724);
  const [days, setDays] = useState(24);
  const [r, setR] = useState(RISK_FREE_DEFAULT);
  const [marketPrice, setMarketPrice] = useState(0.82);
  const [mode, setMode] = useState<CalcMode>('price-from-iv');

  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [solvedIV, setSolvedIV] = useState<number | null>(null);
  const [surface, setSurface] = useState<VolSurfaceData | null>(null);
  // Order panel is hidden by default; opens when the user actively picks a
  // strike from the StrikeStrip (or clicks the "Place order" CTA). Keeps the
  // mobile page short — the panel is heavy enough to push every analysis
  // section off-screen otherwise.
  const [orderPanelOpen, setOrderPanelOpen] = useState(false);
  // Reset whenever the ticker changes — old strike no longer relevant.
  useEffect(() => {
    setOrderPanelOpen(false);
  }, [ticker]);
  // Full expiration list (incl. LEAPS out to 2028+). The vol-surface payload
  // is intentionally short-dated for smile rendering, so the strip is built
  // from this richer source instead.
  const [fullExpirations, setFullExpirations] = useState<OptionExpirationMeta[] | null>(null);
  const [mispricing, setMispricing] = useState<MispricingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.title = `${ticker} pricing · VegaEdge`;
  }, [ticker]);

  // Hydrate spot, mispricing, vol surface whenever ticker changes.
  useEffect(() => {
    let cancelled = false;
    setSpot(null);
    setMispricing(null);
    setSurface(null);
    setFullExpirations(null);
    setPricing(null);
    setError(null);
    (async () => {
      try {
        const [s, m, vs, exps] = await Promise.all([
          getTickerPrice(ticker).catch(() => null),
          getMispricing(ticker).catch(() => null),
          getVolSurface(ticker).catch(() => null),
          getOptionExpirations(ticker).catch(() => null),
        ]);
        if (cancelled) return;
        if (s != null) setSpot(s);
        // Backend returns 200 with `{ticker, error}` when yfinance throttles
        // — guard against undefined numeric fields before pushing to state.
        if (m && typeof m.atm_call_price === 'number' && typeof m.implied_vol_atm === 'number') {
          setMispricing(m);
          setMarketPrice(m.atm_call_price);
          setSigma(m.implied_vol_atm);
          if (s == null && typeof m.spot_price === 'number') setSpot(m.spot_price);
        }
        if (vs) setSurface(vs);
        if (exps?.expirations) setFullExpirations(exps.expirations);
        if (!urlStrikeConsumedRef.current) {
          // Honor the ?strike= deep-link this once; future ticker changes
          // will fall back to ATM auto-derive.
          urlStrikeConsumedRef.current = true;
        } else if (m && Number.isFinite(m.atm_strike) && m.atm_strike > 0) {
          setStrike(m.atm_strike);
        } else if (s != null && s > 0) {
          setStrike(Math.round(s));
        }
        if (!urlExpiryConsumedRef.current && initialFromUrl.expiry) {
          // Honor ?expiry=YYYY-MM-DD by selecting its index in the strip's
          // source list. Prefer the full chain (incl. LEAPS) so a deep-link
          // to a long-dated contract resolves; fall back to surface and
          // finally to index 0 if the date isn't listed at all.
          const fullList = exps?.expirations.map((e) => e.expiration) ?? [];
          const idx =
            fullList.indexOf(initialFromUrl.expiry) >= 0
              ? fullList.indexOf(initialFromUrl.expiry)
              : (vs?.expirations.indexOf(initialFromUrl.expiry) ?? -1);
          setExpiryIdx(idx >= 0 ? idx : 0);
          urlExpiryConsumedRef.current = true;
        } else {
          setExpiryIdx(0);
        }
        if (s == null && m == null && vs == null) {
          setError(`No data returned for ${ticker}`);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load market data');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticker, initialFromUrl.expiry]);

  // Build the expiration strip from the FULL chain (incl. LEAPS) so the
  // strip carousel can scroll out to multi-year dates. Decorate with ATM IV
  // from the (intentionally short-dated) surface when the date overlaps.
  // Falls back to surface-only or a placeholder if neither has loaded yet.
  const expirations: DerivedExpiration[] = useMemo(() => {
    // Compute the surface's ATM-IV column once so we can index into it for
    // each expiration date that the surface includes.
    const surfaceIvByDate = new Map<string, number>();
    if (surface && surface.expirations.length && surface.strikes.length) {
      const strikes = surface.strikes;
      const refSpot = mispricing?.spot_price ?? spot ?? surface.spot_price ?? strikes[0] ?? 0;
      let atmIdx = 0;
      let atmDiff = Infinity;
      for (let j = 0; j < strikes.length; j++) {
        const d = Math.abs(strikes[j] - refSpot);
        if (d < atmDiff) {
          atmDiff = d;
          atmIdx = j;
        }
      }
      surface.expirations.forEach((iso, i) => {
        const ivAtm = surface.iv_matrix[i]?.[atmIdx];
        if (typeof ivAtm === 'number' && Number.isFinite(ivAtm)) {
          surfaceIvByDate.set(iso, ivAtm);
        }
      });
    }

    if (fullExpirations && fullExpirations.length > 0) {
      return fullExpirations.map((e) => ({
        dte: `${e.dte}d`,
        date: formatExpDate(e.expiration),
        rawDate: e.expiration,
        // Prefer surface-derived ATM IV (interpolated); fall back to the
        // chain's own per-expiration ATM IV; finally 0 so the chip renders.
        iv: surfaceIvByDate.get(e.expiration) ?? e.atm_iv ?? 0,
        oi: 0,
      }));
    }
    if (surface && surface.expirations.length) {
      return surface.expirations.map((iso) => ({
        dte: `${daysUntil(iso)}d`,
        date: formatExpDate(iso),
        rawDate: iso,
        iv: surfaceIvByDate.get(iso) ?? 0,
        oi: 0,
      }));
    }
    return FALLBACK_EXPIRATIONS;
  }, [surface, fullExpirations, mispricing, spot]);

  const safeExpiryIdx = Math.min(expiryIdx, Math.max(0, expirations.length - 1));
  const expSel = expirations[safeExpiryIdx] ?? FALLBACK_EXPIRATIONS[0];

  // Keep `days` in sync with the selected expiration.
  useEffect(() => {
    if (!expSel.rawDate) return;
    const dte = daysUntil(expSel.rawDate);
    if (dte > 0) setDays(dte);
  }, [expSel.rawDate]);

  // Render the full set of strikes the backend exposes for this ticker so the
  // user can scroll out to far-OTM contracts (e.g. $2028 LEAPS strikes) via
  // the carousel arrows. Fall back to a small spot-centered window before the
  // surface arrives so the strip doesn't flash empty.
  const strikeWindow = useMemo(() => {
    if (surface?.strikes && surface.strikes.length > 0) {
      const all = [...surface.strikes];
      if (!all.includes(strike)) all.push(strike);
      return [...new Set(all)].sort((a, b) => a - b);
    }
    if (spot == null) return [strike];
    const win = buildStrikeWindow(spot);
    if (!win.includes(strike)) win.push(strike);
    return [...new Set(win)].sort((a, b) => a - b);
  }, [surface, spot, strike]);

  // Recompute on input changes (debounced + abortable).
  useEffect(() => {
    if (spot == null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const T = days / 365;
      if (T <= 0 || sigma <= 0) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);

      (async () => {
        try {
          let effectiveSigma = sigma;
          if (mode === 'iv-from-price') {
            const iv = await calculateImpliedVol(marketPrice, spot, strike, T, r, optType);
            if (ctrl.signal.aborted) return;
            setSolvedIV(iv);
            effectiveSigma = iv;
          } else {
            setSolvedIV(null);
          }
          const res = await calculatePriceAndGreeks({
            S: spot,
            K: strike,
            T,
            r,
            sigma: effectiveSigma,
            option_type: optType,
          });
          if (ctrl.signal.aborted) return;
          setPricing(res);
        } catch (e) {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e.message : 'Pricing call failed');
        } finally {
          if (!ctrl.signal.aborted) setLoading(false);
        }
      })();
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [spot, strike, days, sigma, r, optType, marketPrice, mode]);

  const greeks: Greeks | null = pricing?.greeks ?? null;
  const theoretical = pricing?.price ?? 0;
  const effectiveSigma = mode === 'iv-from-price' && solvedIV != null ? solvedIV : sigma;

  const isAtmStrike = mispricing != null && Math.abs(strike - mispricing.atm_strike) < 0.01;
  const bid = isAtmStrike ? mispricing!.bid : null;
  const ask = isAtmStrike ? mispricing!.ask : null;
  const mid = bid != null && ask != null ? (bid + ask) / 2 : marketPrice;
  const spread = bid != null && ask != null ? ask - bid : null;
  const edge = theoretical - mid;
  const edgeIsNoise = spread != null && Math.abs(edge) < spread / 2;
  const hasMid = bid != null && ask != null && mid > 0;
  const tradePremium = mid > 0 ? mid : marketPrice;
  const premiumSource: 'mid' | 'market' = hasMid ? 'mid' : 'market';
  const sideSign = side === 'short' ? -1 : 1;
  const signGreek = (v: number | null | undefined): number | null =>
    v == null || !Number.isFinite(v) ? null : v * sideSign;

  // Real day-change comes from the mispricing payload's previous_close.
  // Fall back to 0 if the backend didn't include it (older response shape /
  // first-listing-day with no prev bar).
  const chgPct =
    mispricing && typeof mispricing.change_percent === 'number'
      ? mispricing.change_percent
      : 0;
  const hasChg = mispricing && typeof mispricing.change_percent === 'number';

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <h2 className="rv-h1" style={{ margin: 0 }}>
          {ticker}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = tickerInput.trim().toUpperCase();
            if (next && next !== ticker) setTicker(next);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            placeholder="Ticker"
            spellCheck={false}
            maxLength={8}
            style={{
              width: 80,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              background: '#0c0d10',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
              padding: '3px 6px',
              borderRadius: 3,
              textTransform: 'uppercase',
            }}
          />
          <button
            type="submit"
            className="rv-btn ghost"
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            load
          </button>
        </form>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18 }}>
          {spot != null ? spot.toFixed(2) : '—'}
        </span>
        {mispricing && (
          <>
            {hasChg && (
              <span
                className={`rv-chip ${chgPct >= 0 ? 'buy' : 'warn'}`}
                title={
                  mispricing.previous_close != null
                    ? `prev close $${mispricing.previous_close.toFixed(2)}`
                    : undefined
                }
              >
                {chgPct >= 0 ? '+' : ''}
                {chgPct.toFixed(2)}%
              </span>
            )}
            <IvHvScale
              iv={mispricing.implied_vol_atm}
              hv={mispricing.historical_vol}
              ratio={mispricing.iv_hv_ratio}
            />
            <span
              className={`rv-chip ${
                mispricing.signal === 'BUY'
                  ? 'buy'
                  : mispricing.signal === 'SELL'
                    ? 'sell'
                    : 'neutral'
              }`}
            >
              {mispricing.signal}
            </span>
          </>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <CalcModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      <div className="rv-sub" style={{ margin: '0 0 8px' }}>
        Black-Scholes · {optType.toUpperCase()} · K ${strike.toFixed(2)} · {days}d · σ{' '}
        {(effectiveSigma * 100).toFixed(1)}% · r {(r * 100).toFixed(2)}%
      </div>

      <ExpirationStrip
        expirations={expirations}
        selectedIdx={safeExpiryIdx}
        onSelect={setExpiryIdx}
      />
      <StrikeStrip
        strikes={strikeWindow}
        selected={strike}
        spot={spot ?? strike}
        optType={optType}
        onSelect={(k) => {
          setStrike(k);
          setOrderPanelOpen(true);
        }}
      />

      <div className="rv-pricing-grid">
        <div className="rv-card" style={{ opacity: loading ? 0.7 : 1, transition: 'opacity .12s' }}>
          <div className="rv-card-head">
            <h3>Inputs</h3>
            <div className="tools">
              <span
                className={optType === 'call' ? 'on' : ''}
                onClick={() => setOptType('call')}
                style={{ cursor: 'pointer' }}
              >
                call
              </span>
              <span
                className={optType === 'put' ? 'on' : ''}
                onClick={() => setOptType('put')}
                style={{ cursor: 'pointer' }}
              >
                put
              </span>
            </div>
          </div>

          <div style={{ marginTop: 4, marginBottom: 4 }}>
            <SideToggle side={side} onChange={setSide} />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 10px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
            }}
          >
            <div>
              <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
                Spot
              </div>
              <div>${spot != null ? spot.toFixed(2) : '—'}</div>
            </div>
            <div>
              <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
                Strike
              </div>
              <div>${strike.toFixed(2)}</div>
            </div>
            <div>
              <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
                Type
              </div>
              <div>{optType.toUpperCase()}</div>
            </div>
            <div>
              <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
                Expiry
              </div>
              <div>
                {expSel.date} ({expSel.dte})
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span className="rv-sub" style={{ margin: 0 }}>
                σ (volatility) {mode === 'iv-from-price' ? '· solved' : ''}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {(effectiveSigma * 100).toFixed(1)}%
              </span>
            </div>
            <Slider
              value={effectiveSigma}
              min={0.05}
              max={3}
              step={0.005}
              disabled={mode === 'iv-from-price'}
              onChange={setSigma}
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span className="rv-sub" style={{ margin: 0 }}>
                T (days)
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{days}</span>
            </div>
            <Slider value={days} min={1} max={365} step={1} onChange={(v) => setDays(Math.round(v))} />
          </div>

          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span className="rv-sub" style={{ margin: 0 }}>
                r (risk-free)
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {(r * 100).toFixed(2)}%
              </span>
            </div>
            <Slider value={r} min={0} max={0.15} step={0.0025} onChange={setR} />
          </div>

          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span className="rv-sub" style={{ margin: 0 }}>
                Market price {mode === 'iv-from-price' ? '· editable' : ''}
              </span>
              <input
                type="number"
                step="0.01"
                value={marketPrice}
                disabled={mode === 'price-from-iv'}
                onChange={(e) => setMarketPrice(parseFloat(e.target.value) || 0)}
                style={{
                  width: 70,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  background: '#0c0d10',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  textAlign: 'right',
                  opacity: mode === 'price-from-iv' ? 0.55 : 1,
                }}
              />
            </div>
          </div>

          <div
            style={{
              borderTop: '1px dashed var(--line)',
              margin: '14px 0 4px',
              paddingTop: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                fontSize: 10.5,
                color: 'var(--ink-mute)',
              }}
            >
              <span>Trade premium</span>
              <span className="rv-chip neutral" style={{ fontSize: 9 }}>
                {premiumSource === 'mid' ? 'market mid' : 'market'}
              </span>
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.1,
              }}
            >
              ${tradePremium.toFixed(2)}
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: 'var(--ink-dim)',
                marginTop: 1,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              breakeven & expiry P&amp;L use this price
            </div>

            <div
              style={{
                display: 'flex',
                gap: 12,
                marginTop: 8,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: 'var(--ink-mute)',
              }}
            >
              {bid != null && ask != null ? (
                <>
                  <span>
                    bid <span style={{ color: 'var(--ink)' }}>${bid.toFixed(2)}</span>
                  </span>
                  <span>
                    mid{' '}
                    <b style={{ color: 'var(--ink)' }}>${mid.toFixed(2)}</b>
                  </span>
                  <span>
                    ask <span style={{ color: 'var(--ink)' }}>${ask.toFixed(2)}</span>
                  </span>
                </>
              ) : (
                <span>
                  market <b style={{ color: 'var(--ink)' }}>${marketPrice.toFixed(2)}</b>{' '}
                  <span style={{ fontSize: 9 }}>(off-ATM, bid/ask N/A)</span>
                </span>
              )}
            </div>

            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px dashed var(--line)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: 'var(--ink-mute)',
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span>Model value</span>
              <b style={{ color: 'var(--ink)', fontSize: 13 }}>${theoretical.toFixed(2)}</b>
              <span className="rv-chip neutral" style={{ fontSize: 9 }}>
                valuation only
              </span>
            </div>

            <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 4 }}>
              Model − market:{' '}
              <span
                className={`rv-chip ${
                  edgeIsNoise ? 'neutral' : edge > 0 ? 'buy' : 'sell'
                }`}
              >
                {edge >= 0 ? '+' : ''}${edge.toFixed(2)} ({((edge / Math.max(mid, 0.01)) * 100).toFixed(1)}%)
              </span>
              {edgeIsNoise && (
                <span style={{ marginLeft: 6, fontSize: 9.5 }}>· inside spread (no actionable edge)</span>
              )}
            </div>

            {mode === 'iv-from-price' && solvedIV != null && (
              <div className="rv-sub" style={{ margin: '6px 0 0' }}>
                solved IV: {(solvedIV * 100).toFixed(2)}%
              </div>
            )}
          </div>

          {spot != null && days > 0 && sigma > 0 && (
            <ContractMetrics
              S={spot}
              K={strike}
              T={days / 365}
              r={r}
              sigma={effectiveSigma}
              optType={optType}
              theoretical={theoretical}
              premium={tradePremium}
              side={side}
              premiumSource={premiumSource}
            />
          )}

          {error && (
            <div
              className="rv-chip warn"
              style={{ marginTop: 10, display: 'inline-block', fontSize: 10 }}
            >
              {error}
            </div>
          )}
        </div>

        <div>
          <div
            className="rv-sub"
            style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>First-order Greeks</span>
            {side === 'short' && (
              <span className="rv-chip warn" style={{ fontSize: 9 }}>
                short · signs flipped
              </span>
            )}
          </div>
          <div className="rv-greek-grid">
            <GreekBigCell
              sym="Δ"
              ord={1}
              name="Delta"
              val={fmtVal(signGreek(greeks?.delta))}
              unit={GREEK_UNITS.delta}
              desc="price sensitivity to spot"
              sparkColor="var(--green)"
              sparkSeed={2}
            />
            <GreekBigCell
              sym="Γ"
              ord={1}
              name="Gamma"
              val={fmtVal(signGreek(greeks?.gamma))}
              unit={GREEK_UNITS.gamma}
              desc="curvature of delta"
              sparkColor="var(--green)"
              sparkSeed={3}
            />
            <GreekBigCell
              sym="Θ"
              ord={1}
              name="Theta"
              val={fmtVal(signGreek(greeks?.theta))}
              unit={GREEK_UNITS.theta}
              desc="time decay"
              sparkColor="var(--pink)"
              sparkSeed={5}
            />
            <GreekBigCell
              sym="V"
              ord={1}
              name="Vega"
              val={fmtVal(signGreek(greeks?.vega))}
              unit={GREEK_UNITS.vega}
              desc="sensitivity to vol"
              sparkColor="var(--blue)"
              sparkSeed={7}
            />
            <GreekBigCell
              sym="ρ"
              ord={1}
              name="Rho"
              val={fmtVal(signGreek(greeks?.rho))}
              unit={GREEK_UNITS.rho}
              desc="sensitivity to rate"
              sparkColor="var(--ink-dim)"
              sparkSeed={9}
            />
          </div>

          <div className="rv-sub" style={{ margin: '14px 0 6px' }}>
            Second-order Greeks <span style={{ color: 'var(--gold)' }}>· your edge</span>
          </div>
          <div className="rv-greek-grid">
            <GreekBigCell
              sym="∂Δ/∂σ"
              ord={2}
              name="Vanna"
              val={fmtVal(signGreek(greeks?.vanna))}
              unit={GREEK_UNITS.vanna}
              desc="Δ moves when vol moves"
              sparkColor="var(--gold)"
              sparkSeed={11}
            />
            <GreekBigCell
              sym="∂Δ/∂t"
              ord={2}
              name="Charm"
              val={fmtVal(signGreek(greeks?.charm))}
              unit={GREEK_UNITS.charm}
              desc="Δ decay over time"
              sparkColor="var(--gold)"
              sparkSeed={13}
            />
            <GreekBigCell
              sym="∂V/∂σ"
              ord={2}
              name="Volga"
              val={fmtVal(signGreek(greeks?.volga))}
              unit={GREEK_UNITS.volga}
              desc="vega of vega"
              sparkColor="var(--gold)"
              sparkSeed={15}
            />
          </div>

          {spot != null && (
            <PnLScenarios
              S={spot}
              K={strike}
              optType={optType}
              premium={tradePremium}
              side={side}
              premiumSource={premiumSource}
            />
          )}

          <div className="rv-card" style={{ marginTop: 14 }}>
            <div className="rv-card-head">
              <h3>Vol surface · {ticker}</h3>
              <span className="rv-sub" style={{ marginBottom: 0, fontSize: 10 }}>
                smile by expiration · selected highlighted
              </span>
            </div>
            <VolSmile
              surface={surface}
              selectedStrike={strike}
              selectedExpiration={expSel.rawDate || undefined}
            />
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px dashed var(--line)',
              }}
            >
              <div
                className="rv-sub"
                style={{ marginBottom: 4, fontSize: 10 }}
              >
                heatmap · IV by strike × DTE
              </div>
              <MiniVolSurface
                surface={surface}
                selectedStrike={strike}
                selectedExpiration={expSel.rawDate || undefined}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Place an order from the same context (ticker / strike / expiry / type)
          you've been pricing. Hidden until the user actively picks a strike
          (StrikeStrip onSelect) or clicks the CTA — keeps the mobile page
          short, surfaces the panel on intent. The panel remounts on every
          ticker change so its initial fields stay in sync. */}
      <div style={{ marginTop: 14 }}>
        {!orderPanelOpen ? (
          <button
            type="button"
            onClick={() => setOrderPanelOpen(true)}
            className="rv-btn"
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: '#0d0e11',
              color: 'var(--ink)',
              letterSpacing: '.04em',
            }}
            title="Open the Robinhood order ticket for the current ticker/strike/expiry"
          >
            Place order · {ticker} {optType.toUpperCase()} ${strike.toFixed(2)} ·{' '}
            {expSel.date || expSel.dte || '—'}
          </button>
        ) : (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setOrderPanelOpen(false)}
              aria-label="Close order panel"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                zIndex: 4,
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 4,
                color: 'var(--ink-mute)',
                cursor: 'pointer',
                fontSize: 14,
                padding: '4px 10px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
            <OptionsTradePanel
              key={ticker}
              underlying={ticker}
              initialStrike={strike}
              initialOptionType={optType}
              initialSide={side === 'short' ? 'sell' : 'buy'}
              initialExpiration={expSel.rawDate || undefined}
              initialLimitPrice={tradePremium > 0 ? tradePremium : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="rv-sub" style={{ padding: 12 }}>Loading pricing…</div>}>
      <PricingPageInner />
    </Suspense>
  );
}
