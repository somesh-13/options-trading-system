'use client';

import { useState } from 'react';
import {
  placeEquityOrder,
  type RobinhoodHolding,
  type EquityOrderResponse,
} from '@/lib/robinhood-api';

const NOTIONAL_CAP = 200; // must match backend EQUITY_ORDER_NOTIONAL_CAP_USD

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

interface Props {
  equities: RobinhoodHolding[];
}

export function EquityTradePanel({ equities }: Props) {
  const [symbol, setSymbol] = useState<string>('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState<string>('');
  const [account, setAccount] = useState<'brokerage' | 'roth_ira'>('brokerage');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [confirm, setConfirm] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EquityOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const symTrimmed = symbol.trim().toUpperCase();
  const qtyNum = parseFloat(quantity);
  const limitNum = parseFloat(limitPrice);

  const qtyValid = !isNaN(qtyNum) && qtyNum >= 0.000001;
  const limitValid = orderType === 'market' || (!isNaN(limitNum) && limitNum > 0);

  // Estimated notional for sanity display (shown on submit button).
  // Uses limit_price when available, otherwise undefined (mark unknown client-side).
  const estNotional: number | null =
    qtyValid && orderType === 'limit' && limitValid ? parseFloat((qtyNum * limitNum).toFixed(4)) : null;

  // Client-side cap warning: only knowable when order_type is limit (we have limit_price).
  const overCap = estNotional !== null && estNotional > NOTIONAL_CAP;

  const canSubmit =
    symTrimmed.length > 0 &&
    qtyValid &&
    limitValid &&
    !overCap &&
    (dryRun || (!dryRun && confirm)) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const res = await placeEquityOrder({
        symbol: symTrimmed,
        side,
        quantity: qtyNum,
        account,
        order_type: orderType,
        limit_price: orderType === 'limit' ? limitNum : null,
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

  const borderColor = dryRun ? 'var(--gold, #FFD700)' : 'var(--pink, #FF006E)';

  // Populate symbol from held equities
  const heldSymbols = Array.from(new Set(equities.map((e) => e.symbol))).sort();

  return (
    <div
      className="rv-card"
      style={{ borderColor, transition: 'border-color 0.2s' }}
      data-testid="equity-trade-panel"
    >
      <div className="rv-card-head">
        <h3>Equity order panel</h3>
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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Symbol
            </span>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. RDW"
              list="equity-symbol-list"
              data-testid="equity-symbol"
              style={{
                ...monoStyle,
                fontSize: 13,
                padding: '6px 8px',
                background: 'var(--bg, #1E1E1E)',
                border: '1px solid var(--line)',
                borderRadius: 3,
                color: 'var(--ink)',
              }}
            />
            {heldSymbols.length > 0 && (
              <datalist id="equity-symbol-list">
                {heldSymbols.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Side
            </span>
            <div
              style={{
                display: 'flex',
                gap: 0,
                borderRadius: 3,
                overflow: 'hidden',
                border: '1px solid var(--line)',
              }}
            >
              {(['buy', 'sell'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  data-testid={`equity-side-${s}`}
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

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Shares
            </span>
            <input
              type="number"
              min={0.000001}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="1"
              data-testid="equity-quantity"
              style={{
                ...monoStyle,
                fontSize: 13,
                padding: '6px 8px',
                background: 'var(--bg, #1E1E1E)',
                border: `1px solid ${quantity && !qtyValid ? 'var(--pink, #FF006E)' : 'var(--line)'}`,
                borderRadius: 3,
                color: 'var(--ink)',
              }}
            />
          </label>
        </div>

        {/* Row 2: Account + Order type + (conditional) Limit price */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Account
            </span>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value as 'brokerage' | 'roth_ira')}
              data-testid="equity-account"
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
              <option value="brokerage">Brokerage</option>
              <option value="roth_ira">Roth IRA</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
            <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
              Order type
            </span>
            <div
              style={{
                display: 'flex',
                gap: 0,
                borderRadius: 3,
                overflow: 'hidden',
                border: '1px solid var(--line)',
              }}
            >
              {(['market', 'limit'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOrderType(t)}
                  data-testid={`equity-order-type-${t}`}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    background:
                      orderType === t ? 'rgba(255,215,0,0.14)' : 'var(--bg, #1E1E1E)',
                    border: 'none',
                    color: orderType === t ? 'var(--gold, #FFD700)' : 'var(--ink-dim)',
                    cursor: 'pointer',
                    fontWeight: orderType === t ? 700 : 400,
                    ...monoStyle,
                    fontSize: 12,
                    textTransform: 'uppercase',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </label>

          {orderType === 'limit' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
              <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>
                Limit price ($)
              </span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="0.00"
                data-testid="equity-limit-price"
                style={{
                  ...monoStyle,
                  fontSize: 13,
                  padding: '6px 8px',
                  background: 'var(--bg, #1E1E1E)',
                  border: `1px solid ${(limitPrice && !limitValid) || overCap ? 'var(--pink, #FF006E)' : 'var(--line)'}`,
                  borderRadius: 3,
                  color: 'var(--ink)',
                }}
              />
              {overCap && (
                <span style={{ fontSize: 10, color: 'var(--pink, #FF006E)', ...monoStyle }}>
                  Est. notional ${estNotional?.toFixed(2)} exceeds cap ${NOTIONAL_CAP}
                </span>
              )}
            </label>
          )}
        </div>

        {/* Dry-run toggle */}
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
            data-testid="equity-dry-run-toggle"
            style={{
              width: 16,
              height: 16,
              cursor: 'pointer',
              accentColor: 'var(--gold, #FFD700)',
            }}
          />
          <span
            style={{
              ...monoStyle,
              fontSize: 12,
              color: dryRun ? 'var(--gold, #FFD700)' : 'var(--ink-dim)',
            }}
          >
            Dry run (simulate only — default ON)
          </span>
        </label>

        {/* Real-money confirmation — only shown when dry-run is OFF */}
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
              data-testid="equity-confirm-toggle"
              style={{
                width: 16,
                height: 16,
                cursor: 'pointer',
                accentColor: 'var(--pink, #FF006E)',
              }}
            />
            <span style={{ ...monoStyle, fontSize: 12, color: 'var(--pink, #FF006E)' }}>
              I confirm this is a REAL MONEY order on Robinhood (no paper trading)
            </span>
          </label>
        )}

        {/* Submit button — shows estimated notional when known */}
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="equity-submit"
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
            : [
                dryRun
                  ? `Simulate ${side} ${qtyValid ? qtyNum : '?'} ${symTrimmed || '…'}`
                  : `Place live ${side} ${qtyValid ? qtyNum : '?'} ${symTrimmed || '…'}`,
                estNotional != null ? `· ~$${estNotional.toFixed(2)}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
        </button>
      </form>

      {/* Result display */}
      {result && !error && (
        <div
          data-testid="equity-order-result"
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 4,
            border: `1px solid ${result.dry_run ? 'var(--green, #00C805)' : 'var(--gold, #FFD700)'}`,
            background: result.dry_run ? 'rgba(0,200,5,0.08)' : 'rgba(255,215,0,0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: 6,
            }}
          >
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 4,
            }}
          >
            {[
              ['Symbol', result.symbol],
              ['Side', result.side.toUpperCase()],
              ['Qty', String(result.quantity)],
              ['Account', result.account],
              ['Order type', result.order_type],
              [
                'Mark price',
                result.mark_price != null
                  ? `$${result.mark_price.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}`
                  : '—',
              ],
              [
                'Est. notional',
                result.estimated_notional_usd != null
                  ? `$${result.estimated_notional_usd.toFixed(2)}`
                  : '—',
              ],
              ['Status', result.status],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span
                  style={{
                    ...monoStyle,
                    fontSize: 9,
                    color: 'var(--ink-mute)',
                    textTransform: 'uppercase',
                  }}
                >
                  {k}
                </span>
                <span style={{ ...monoStyle, fontSize: 12, color: 'var(--ink)' }}>{v}</span>
              </div>
            ))}
          </div>
          {result.message && (
            <p
              style={{
                ...monoStyle,
                fontSize: 11,
                color: 'var(--ink-dim)',
                marginTop: 8,
                marginBottom: 0,
              }}
            >
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
          data-testid="equity-order-error"
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
