'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  calculateImpliedVol,
  calculatePriceAndGreeks,
  getMispricing,
  getTickerPrice,
  getVolSurface,
  type Greeks,
  type MispricingData,
  type PricingResponse,
  type VolSurfaceData,
} from '@/lib/pricing-api';

const DEFAULT_TICKER = 'CIFR';

const EXPIRATIONS: Expiration[] = [
  { dte: '7d', date: 'Apr 26', iv: 0.68, oi: 12 },
  { dte: '14d', date: 'May 03', iv: 0.71, oi: 18 },
  { dte: '24d', date: 'May 17', iv: 0.724, oi: 44 },
  { dte: '45d', date: 'Jun 07', iv: 0.69, oi: 22 },
  { dte: '80d', date: 'Jul 12', iv: 0.62, oi: 14 },
  { dte: '170d', date: 'Oct 11', iv: 0.55, oi: 8 },
];

const RISK_FREE_DEFAULT = 0.045;

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

function dteDays(dte: string): number {
  return parseInt(dte, 10) || 24;
}

export default function PricingPage() {
  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  const [tickerInput, setTickerInput] = useState(DEFAULT_TICKER);
  const [optType, setOptType] = useState<'call' | 'put'>('call');
  const [side, setSide] = useState<Side>('long');
  const [strike, setStrike] = useState(16);
  const [expiryIdx, setExpiryIdx] = useState(2);
  const [spot, setSpot] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0.724);
  const [days, setDays] = useState(dteDays(EXPIRATIONS[2].dte));
  const [r, setR] = useState(RISK_FREE_DEFAULT);
  const [marketPrice, setMarketPrice] = useState(0.82);
  const [mode, setMode] = useState<CalcMode>('price-from-iv');

  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [solvedIV, setSolvedIV] = useState<number | null>(null);
  const [surface, setSurface] = useState<VolSurfaceData | null>(null);
  const [mispricing, setMispricing] = useState<MispricingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate spot, mispricing, vol surface whenever ticker changes.
  useEffect(() => {
    let cancelled = false;
    setSpot(null);
    setMispricing(null);
    setSurface(null);
    setPricing(null);
    setError(null);
    (async () => {
      try {
        const [s, m, vs] = await Promise.all([
          getTickerPrice(ticker).catch(() => null),
          getMispricing(ticker).catch(() => null),
          getVolSurface(ticker).catch(() => null),
        ]);
        if (cancelled) return;
        if (s != null) setSpot(s);
        if (m) {
          setMispricing(m);
          setMarketPrice(m.atm_call_price);
          setSigma(m.implied_vol_atm);
          if (s == null) setSpot(m.spot_price);
        }
        if (vs) setSurface(vs);
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
  }, [ticker]);

  // Keep `days` in sync with the selected expiration tab.
  useEffect(() => {
    setDays(dteDays(EXPIRATIONS[expiryIdx].dte));
  }, [expiryIdx]);

  // Keep the strike window centered on the spot.
  const strikeWindow = useMemo(() => {
    if (spot == null) return [strike];
    const win = buildStrikeWindow(spot);
    if (!win.includes(strike)) win.push(strike);
    return [...new Set(win)].sort((a, b) => a - b);
  }, [spot, strike]);

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

  const expSel = EXPIRATIONS[expiryIdx];
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

  const chgPct = mispricing
    ? ((mispricing.spot_price - mispricing.spot_price * 0.976) / (mispricing.spot_price * 0.976)) *
      100
    : 0;

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
            <span className={`rv-chip ${chgPct >= 0 ? 'buy' : 'warn'}`}>
              {chgPct >= 0 ? '+' : ''}
              {chgPct.toFixed(1)}%
            </span>
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
        expirations={EXPIRATIONS}
        selectedIdx={expiryIdx}
        onSelect={setExpiryIdx}
      />
      <StrikeStrip
        strikes={strikeWindow}
        selected={strike}
        spot={spot ?? strike}
        optType={optType}
        onSelect={setStrike}
      />

      <div className="rv-grid-2" style={{ gridTemplateColumns: '320px 1fr' }}>
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
                {EXPIRATIONS[expiryIdx].date} ({EXPIRATIONS[expiryIdx].dte})
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
              selectedExpiration={expSel.date}
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
                selectedExpiration={expSel.date}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
