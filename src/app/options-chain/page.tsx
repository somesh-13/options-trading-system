'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChainTable, type ChainSelectPayload } from '@/components/chain/ChainTable';
import { ExpirationStrip, type Expiration } from '@/components/chain/ExpirationStrip';
import { OptionsTradePanel } from '@/components/robinhood/OptionsTradePanel';
import {
  getOptionExpirations,
  getOptionChain,
  type OptionExpirationsResponse,
  type OptionChainResponse,
} from '@/lib/pricing-api';
import { getRobinhoodHoldings } from '@/lib/robinhood-api';

/**
 * Option chain page — yfinance-backed, click-to-trade via Robinhood.
 *
 * Flow:
 *   1. User picks a ticker (free-text or holdings dropdown). URL ?ticker= is
 *      hydrated on first load; subsequent changes update the URL via History.
 *   2. Page fetches /api/market/{t}/option-expirations once, populates the
 *      ExpirationStrip and auto-selects the first expiration ≥25 DTE (closest
 *      to the standard CC/CSP window).
 *   3. On expiration change, fetches /api/market/{t}/option-chain?expiration=…
 *      and renders calls/puts in ChainTable.
 *   4. Click a Bid/Ask cell → ChainTable emits ChainSelectPayload → page
 *      remounts OptionsTradePanel with that strike/expiry/side/price as
 *      `initial*` props. Trade panel still has its own dry_run + $200
 *      notional cap safety gates.
 */

function OptionsChainInner() {
  const searchParams = useSearchParams();
  const initialTicker = (searchParams.get('ticker') || 'CIFR').toUpperCase();

  const [ticker, setTicker] = useState<string>(initialTicker);
  const [tickerInput, setTickerInput] = useState<string>(initialTicker);

  // Holdings → dropdown.
  const [holdings, setHoldings] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    getRobinhoodHoldings(true, 'all', 'live')
      .then((h) => {
        if (cancelled) return;
        const symbols = Array.from(
          new Set([
            ...h.equities.map((e) => e.symbol),
            ...h.options.map((o) => o.underlying).filter((s): s is string => !!s),
          ]),
        ).sort();
        setHoldings(symbols);
      })
      .catch(() => { /* dropdown stays empty; free-text still works */ });
    return () => { cancelled = true; };
  }, []);

  // Expirations.
  const [expsResp, setExpsResp] = useState<OptionExpirationsResponse | null>(null);
  const [expsErr, setExpsErr] = useState<string | null>(null);
  const [expsLoading, setExpsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setExpsResp(null);
    setExpsErr(null);
    setExpsLoading(true);
    getOptionExpirations(ticker)
      .then((r) => { if (!cancelled) setExpsResp(r); })
      .catch((e: Error) => { if (!cancelled) setExpsErr(e.message); })
      .finally(() => { if (!cancelled) setExpsLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  // Auto-select the first expiration with DTE ≥ 25 (or the first available
  // if everything is short-dated). Resets on ticker change.
  const [selectedExp, setSelectedExp] = useState<string | null>(null);
  useEffect(() => {
    if (!expsResp || expsResp.expirations.length === 0) {
      setSelectedExp(null);
      return;
    }
    const target =
      expsResp.expirations.find((e) => e.dte >= 25) ?? expsResp.expirations[0];
    setSelectedExp(target.expiration);
  }, [expsResp]);

  // Chain for the selected expiration.
  const [chain, setChain] = useState<OptionChainResponse | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  useEffect(() => {
    if (!selectedExp) {
      setChain(null);
      return;
    }
    let cancelled = false;
    setChain(null);
    setChainErr(null);
    setChainLoading(true);
    getOptionChain(ticker, selectedExp)
      .then((r) => { if (!cancelled) setChain(r); })
      .catch((e: Error) => { if (!cancelled) setChainErr(e.message); })
      .finally(() => { if (!cancelled) setChainLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, selectedExp]);

  // Adapt the new expirations payload into the ExpirationStrip's existing
  // shape so we don't have to touch the strip component. dte/date/iv/oi.
  const stripExpirations: Expiration[] = useMemo(() => {
    if (!expsResp) return [];
    return expsResp.expirations.map((e) => {
      const dt = new Date(e.expiration + 'T00:00:00');
      const date = dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      return {
        dte: `${e.dte}d`,
        date,
        iv: e.atm_iv ?? 0,
        // ExpirationStrip displays "Nk OI" — divide so 31,319 OI → 31k.
        oi: Math.round(e.total_oi / 1000),
      };
    });
  }, [expsResp]);

  const selectedIdx = useMemo(() => {
    if (!expsResp || !selectedExp) return 0;
    const idx = expsResp.expirations.findIndex((e) => e.expiration === selectedExp);
    return idx >= 0 ? idx : 0;
  }, [expsResp, selectedExp]);

  const handleStripSelect = useCallback(
    (i: number) => {
      const exp = expsResp?.expirations[i]?.expiration;
      if (exp) setSelectedExp(exp);
    },
    [expsResp],
  );

  // Click-to-trade — captured strike/type/side/price feed initial* props on
  // OptionsTradePanel. We use a `key` derived from the selection so the panel
  // remounts (and re-applies `initial*`) on every click, instead of trying to
  // make the panel a controlled component.
  const [tradeSel, setTradeSel] = useState<ChainSelectPayload | null>(null);
  const handleChainSelect = useCallback((payload: ChainSelectPayload) => {
    setTradeSel(payload);
  }, []);

  const handleTickerSubmit = useCallback(
    (raw: string) => {
      const t = raw.trim().toUpperCase();
      if (!t || t === ticker) return;
      setTicker(t);
      setTickerInput(t);
      setTradeSel(null);
      // Update URL without navigating (so a bookmark persists).
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('ticker', t);
        window.history.replaceState(null, '', url.toString());
      } catch { /* ignore */ }
    },
    [ticker],
  );

  // Stable key for the trade panel — bumps whenever the user makes a fresh
  // chain selection or switches ticker/expiration.
  const tradeKey = tradeSel
    ? `${ticker}|${selectedExp}|${tradeSel.strike}|${tradeSel.optionType}|${tradeSel.side}|${tradeSel.price}`
    : `${ticker}|${selectedExp ?? 'no-exp'}`;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 className="rv-h1" style={{ margin: 0 }}>{ticker}</h2>
        {chain?.spot != null && (
          <span className="rv-sub" style={{ margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
            spot ${chain.spot.toFixed(2)}
          </span>
        )}
        <span className="rv-sub" style={{ margin: 0 }}>
          live yfinance chain · click Bid (sell) / Ask (buy) to populate the order ticket
        </span>
      </div>

      {/* Ticker controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTickerSubmit(tickerInput);
          }}
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        >
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            placeholder="ticker"
            spellCheck={false}
            autoCapitalize="characters"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
              padding: '4px 8px',
              minWidth: 90,
              maxWidth: 120,
              background: 'transparent',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: 3,
            }}
          />
          <button type="submit" className="rv-btn" style={{ fontSize: 11, padding: '4px 10px' }}>
            Load
          </button>
        </form>

        {holdings.length > 0 && (
          <select
            value={holdings.includes(ticker) ? ticker : ''}
            onChange={(e) => handleTickerSubmit(e.target.value)}
            className="rv-btn"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            <option value="">— from your book ({holdings.length}) —</option>
            {holdings.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        <span className="rv-sub" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {expsLoading ? 'loading expirations…' : expsResp ? `${expsResp.expirations.length} expiries` : ''}
        </span>
      </div>

      {expsErr && (
        <div
          className="rv-card"
          role="alert"
          style={{
            marginBottom: 10,
            borderColor: 'var(--pink)',
            color: 'var(--pink)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            padding: 10,
          }}
        >
          {expsErr}
        </div>
      )}

      {stripExpirations.length > 0 && (
        <ExpirationStrip
          expirations={stripExpirations}
          selectedIdx={selectedIdx}
          onSelect={handleStripSelect}
        />
      )}

      <div className="rv-chain-wrap">
        <div className="rv-card" style={{ padding: 0 }}>
          {chainLoading && (
            <div className="rv-sub" style={{ padding: 16, fontSize: 12 }}>loading chain…</div>
          )}
          {chainErr && (
            <div
              role="alert"
              style={{
                padding: 16,
                fontSize: 12,
                color: 'var(--pink)',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {chainErr}
            </div>
          )}
          {chain && !chainLoading && (
            <ChainTable
              expiration={chain.expiration}
              spot={chain.spot}
              calls={chain.calls}
              puts={chain.puts}
              onSelect={handleChainSelect}
            />
          )}
        </div>
        <div>
          <OptionsTradePanel
            key={tradeKey}
            underlying={ticker}
            initialExpiration={selectedExp ?? ''}
            initialStrike={tradeSel?.strike}
            initialOptionType={tradeSel?.optionType ?? 'call'}
            initialSide={tradeSel?.side}
            initialLimitPrice={tradeSel?.price}
          />
        </div>
      </div>
    </>
  );
}

export default function OptionsChainPage() {
  return (
    <Suspense fallback={<div className="rv-card" style={{ height: 200, opacity: 0.6 }} />}>
      <OptionsChainInner />
    </Suspense>
  );
}
