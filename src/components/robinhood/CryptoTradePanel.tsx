'use client';

import { useState } from 'react';
import {
  placeCryptoOrder,
  type CryptoHolding,
  type CryptoOrderResponse,
} from '@/lib/robinhood-api';

// Top Robinhood-supported crypto symbols.
const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'DOGE', 'SOL', 'ADA'];
const NOTIONAL_CAP = 50; // must match backend CRYPTO_ORDER_NOTIONAL_CAP_USD

function getSymbolList(holdings: CryptoHolding[]): string[] {
  const fromHoldings = holdings.map((h) => h.symbol);
  const combined = Array.from(new Set([...fromHoldings, ...DEFAULT_SYMBOLS]));
  return combined;
}

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

interface Props {
  holdings: CryptoHolding[];
}

export function CryptoTradePanel({ holdings }: Props) {
  const symbols = getSymbolList(holdings);

  const [symbol, setSymbol] = useState<string>(symbols[0] ?? 'BTC');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [notional, setNotional] = useState<string>('');
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [confirm, setConfirm] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CryptoOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notionalNum = parseFloat(notional);
  const notionalValid =
    !isNaN(notionalNum) && notionalNum > 0 && notionalNum <= NOTIONAL_CAP;

  // Submission is valid when:
  //   - symbol is set
  //   - notional is valid
  //   - EITHER dry_run=true, OR (dry_run=false AND confirm=true)
  const canSubmit =
    symbol &&
    notionalValid &&
    (dryRun || (!dryRun && confirm)) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const res = await placeCryptoOrder({
        symbol,
        side,
        notional_usd: notionalNum,
        dry_run: dryRun,
        confirm,
      });
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Color of the panel border: gold = dry-run, real-money = subtle red
  const borderColor = dryRun
    ? 'var(--gold, #FFD700)'
    : 'var(--pink, #FF006E)';

  return (
    <div
      className="rv-card"
      style={{ borderColor, transition: 'border-color 0.2s' }}
      data-testid="crypto-trade-panel"
    >
      <div className="rv-card-head">
        <h3>Crypto order panel</h3>
        {dryRun && (
          <span
            style={{
              ...monoStyle,
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 3,
              border: '1px solid var(--gold, #FFD700)',
              background: 'rgba(255,215,0,0.12)',
              color: 'var(--gold, #FFD700)',
              marginLeft: 'auto',
            }}
          >
            DRY RUN — no real orders
          </span>
        )}
        {!dryRun && (
          <span
            style={{
              ...monoStyle,
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 3,
              border: '1px solid var(--pink, #FF006E)',
              background: 'rgba(255,0,110,0.12)',
              color: 'var(--pink, #FF006E)',
              marginLeft: 'auto',
            }}
          >
            LIVE — real money
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Row 1: Symbol + Side */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Symbol
            </span>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              data-testid="crypto-symbol"
              style={{
                ...monoStyle,
                fontSize: 13,
                padding: '6px 8px',
                background: 'var(--bg, #1E1E1E)',
                border: '1px solid var(--line)',
                borderRadius: 3,
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Side
            </span>
            <div style={{ display: 'flex', gap: 0, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--line)' }}>
              {(['buy', 'sell'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  data-testid={`side-${s}`}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    background:
                      side === s
                        ? s === 'buy'
                          ? 'rgba(0,200,5,0.18)'
                          : 'rgba(255,0,110,0.18)'
                        : 'var(--bg, #1E1E1E)',
                    border: 'none',
                    color:
                      side === s
                        ? s === 'buy'
                          ? 'var(--green, #00C805)'
                          : 'var(--pink, #FF006E)'
                        : 'var(--ink-dim)',
                    cursor: 'pointer',
                    fontWeight: side === s ? 700 : 400,
                    ...monoStyle,
                    fontSize: 13,
                    textTransform: 'uppercase',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Amount (USD) — max ${NOTIONAL_CAP}
            </span>
            <input
              type="number"
              min={0.01}
              max={NOTIONAL_CAP}
              step={0.01}
              value={notional}
              onChange={(e) => setNotional(e.target.value)}
              placeholder={`0.01 – ${NOTIONAL_CAP}`}
              data-testid="crypto-notional"
              style={{
                ...monoStyle,
                fontSize: 13,
                padding: '6px 8px',
                background: 'var(--bg, #1E1E1E)',
                border: `1px solid ${
                  notional && !notionalValid ? 'var(--pink, #FF006E)' : 'var(--line)'
                }`,
                borderRadius: 3,
                color: 'var(--ink)',
              }}
            />
            {notional && !notionalValid && (
              <span style={{ fontSize: 10, color: 'var(--pink, #FF006E)', ...monoStyle }}>
                {parseFloat(notional) > NOTIONAL_CAP
                  ? `Max $${NOTIONAL_CAP} per test order`
                  : 'Must be > $0'}
              </span>
            )}
          </label>
        </div>

        {/* Row 2: Dry-run toggle */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            padding: '8px 10px',
            borderRadius: 4,
            border: `1px solid ${dryRun ? 'var(--gold, #FFD700)' : 'var(--line)'}`,
            background: dryRun ? 'rgba(255,215,0,0.06)' : undefined,
            transition: 'border-color 0.2s, background 0.2s',
          }}
        >
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => {
              setDryRun(e.target.checked);
              if (e.target.checked) setConfirm(false);
            }}
            data-testid="dry-run-toggle"
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold, #FFD700)' }}
          />
          <span style={{ ...monoStyle, fontSize: 12, color: dryRun ? 'var(--gold, #FFD700)' : 'var(--ink-dim)' }}>
            Dry run (simulate only — default ON)
          </span>
        </label>

        {/* Row 3: Real-money confirmation — only shown when dry-run is OFF */}
        {!dryRun && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              padding: '8px 10px',
              borderRadius: 4,
              border: '1px solid var(--pink, #FF006E)',
              background: 'rgba(255,0,110,0.06)',
            }}
          >
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              data-testid="confirm-toggle"
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--pink, #FF006E)' }}
            />
            <span style={{ ...monoStyle, fontSize: 12, color: 'var(--pink, #FF006E)' }}>
              I confirm this is a REAL MONEY order on Robinhood (no paper trading)
            </span>
          </label>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="crypto-submit"
          style={{
            ...monoStyle,
            padding: '8px 0',
            borderRadius: 4,
            border: 'none',
            background: canSubmit
              ? dryRun
                ? 'rgba(255,215,0,0.18)'
                : 'rgba(255,0,110,0.18)'
              : 'var(--line)',
            color: canSubmit
              ? dryRun
                ? 'var(--gold, #FFD700)'
                : 'var(--pink, #FF006E)'
              : 'var(--ink-mute)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          {submitting
            ? 'Submitting…'
            : dryRun
            ? `Simulate ${side} ${symbol}`
            : `Place live ${side} ${symbol}`}
        </button>
      </form>

      {/* Result display */}
      {result && !error && (
        <div
          data-testid="crypto-order-result"
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 4,
            border: `1px solid ${result.dry_run ? 'var(--green, #00C805)' : 'var(--gold, #FFD700)'}`,
            background: result.dry_run
              ? 'rgba(0,200,5,0.08)'
              : 'rgba(255,215,0,0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <span
              style={{
                ...monoStyle,
                fontSize: 11,
                color: result.dry_run ? 'var(--green, #00C805)' : 'var(--gold, #FFD700)',
                fontWeight: 700,
              }}
            >
              {result.dry_run ? 'SIMULATED ORDER' : 'ORDER PLACED'}
            </span>
            <span style={{ ...monoStyle, fontSize: 10, color: 'var(--ink-mute)' }}>
              {result.order_id}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 4 }}>
            {[
              ['Symbol', result.symbol],
              ['Side', result.side.toUpperCase()],
              ['Notional', `$${result.notional_usd.toFixed(2)}`],
              ['Quantity', result.quantity != null ? result.quantity.toFixed(8) : '—'],
              ['Mark price', result.mark_price != null ? `$${result.mark_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—'],
              ['Status', result.status],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ ...monoStyle, fontSize: 9, color: 'var(--ink-mute)', textTransform: 'uppercase' }}>{k}</span>
                <span style={{ ...monoStyle, fontSize: 12, color: 'var(--ink)' }}>{v}</span>
              </div>
            ))}
          </div>
          {result.message && (
            <p style={{ ...monoStyle, fontSize: 11, color: 'var(--ink-dim)', marginTop: 8, marginBottom: 0 }}>
              {result.message}
            </p>
          )}
          {!result.dry_run && (
            <p
              style={{
                ...monoStyle,
                fontSize: 11,
                color: 'var(--gold, #FFD700)',
                marginTop: 8,
                marginBottom: 0,
              }}
            >
              Order submitted. Check the Robinhood app to confirm fill status.
            </p>
          )}
        </div>
      )}

      {error && (
        <div
          data-testid="crypto-order-error"
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 4,
            border: '1px solid var(--pink, #FF006E)',
            background: 'rgba(255,0,110,0.08)',
            color: 'var(--pink, #FF006E)',
            ...monoStyle,
            fontSize: 12,
          }}
        >
          Error: {error}
        </div>
      )}
    </div>
  );
}
