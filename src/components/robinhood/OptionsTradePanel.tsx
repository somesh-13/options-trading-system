'use client';

import { useState } from 'react';
import {
  placeOptionOrder,
  type OptionOrderResponse,
} from '@/lib/robinhood-api';
import {
  type Leg,
  newLeg,
  isLegComplete,
  MAX_LEGS,
} from '@/lib/option-legs';
import { classifyMultiLeg } from '@/lib/option-strategies';
import { SimulatorOverlay } from './SimulatorOverlay';

const NOTIONAL_CAP = 200; // must match backend OPTION_ORDER_NOTIONAL_CAP_USD

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

type StrategyKind = {
  short: string; // e.g. 'CSP'
  full: string;  // e.g. 'Cash-Secured Put (sell-to-open)'
  // gold for income-generating opens (CSP/CC), green for long opens, dim for closes
  tone: 'csp' | 'cc' | 'long' | 'short' | 'close';
};

function strategyKind(
  side: 'buy' | 'sell',
  optionType: 'call' | 'put',
  positionEffect: 'open' | 'close',
): StrategyKind {
  if (positionEffect === 'open') {
    if (side === 'sell' && optionType === 'put') {
      return { short: 'CSP', full: 'Cash-Secured Put (sell-to-open)', tone: 'csp' };
    }
    if (side === 'sell' && optionType === 'call') {
      return { short: 'CC', full: 'Covered Call (sell-to-open)', tone: 'cc' };
    }
    if (side === 'buy' && optionType === 'call') {
      return { short: 'LONG CALL', full: 'Long Call (buy-to-open)', tone: 'long' };
    }
    return { short: 'LONG PUT', full: 'Long Put (buy-to-open)', tone: 'long' };
  }
  // close
  if (side === 'buy' && optionType === 'put') {
    return { short: 'CLOSE SHORT PUT', full: 'Close short put (buy-to-close)', tone: 'close' };
  }
  if (side === 'buy' && optionType === 'call') {
    return { short: 'CLOSE SHORT CALL', full: 'Close short call (buy-to-close)', tone: 'close' };
  }
  if (side === 'sell' && optionType === 'call') {
    return { short: 'CLOSE LONG CALL', full: 'Close long call (sell-to-close)', tone: 'close' };
  }
  return { short: 'CLOSE LONG PUT', full: 'Close long put (sell-to-close)', tone: 'close' };
}

function strategyToneColors(tone: StrategyKind['tone']): { fg: string; bg: string } {
  switch (tone) {
    case 'csp':
      return { fg: 'var(--gold, #FFD700)', bg: 'rgba(255,215,0,0.14)' };
    case 'cc':
      return { fg: 'var(--gold, #FFD700)', bg: 'rgba(255,215,0,0.14)' };
    case 'long':
      return { fg: 'var(--green, #00C805)', bg: 'rgba(0,200,5,0.14)' };
    case 'short':
      return { fg: 'var(--pink, #FF006E)', bg: 'rgba(255,0,110,0.14)' };
    case 'close':
    default:
      return { fg: 'var(--ink-dim, #B0B0B0)', bg: 'rgba(176,176,176,0.10)' };
  }
}

interface Props {
  underlying: string;
  initialExpiration?: string;
  initialStrike?: number;
  initialOptionType?: 'call' | 'put';
  initialSide?: 'buy' | 'sell';
  initialLimitPrice?: number;
}

export function OptionsTradePanel({
  underlying,
  initialExpiration = '',
  initialStrike,
  initialOptionType = 'call',
  initialSide = 'buy',
  initialLimitPrice,
}: Props) {
  const [legs, setLegs] = useState<Leg[]>(() => [
    newLeg({
      expiration: initialExpiration,
      strike: initialStrike != null ? String(initialStrike) : '',
      optionType: initialOptionType,
      side: initialSide,
      quantity: '1',
      entryPrice: initialLimitPrice != null ? String(initialLimitPrice) : '',
    }),
  ]);
  const [positionEffect, setPositionEffect] = useState<'open' | 'close'>('open');
  const [account, setAccount] = useState<'brokerage' | 'roth_ira'>('brokerage');
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [confirm, setConfirm] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OptionOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);

  const updateLeg = (id: string, patch: Partial<Leg>) =>
    setLegs((cur) => cur.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLeg = (id: string) =>
    setLegs((cur) => (cur.length <= 1 ? cur : cur.filter((l) => l.id !== id)));
  const addLeg = () =>
    setLegs((cur) => {
      if (cur.length >= MAX_LEGS) return cur;
      const last = cur[cur.length - 1];
      // New leg copies last leg with side flipped (typical spread workflow).
      return [
        ...cur,
        newLeg({
          expiration: last.expiration,
          strike: last.strike,
          optionType: last.optionType,
          side: last.side === 'buy' ? 'sell' : 'buy',
          quantity: last.quantity,
          entryPrice: last.entryPrice,
        }),
      ];
    });

  const allLegsComplete = legs.every(isLegComplete);

  // Single-leg "Place" path uses leg 0. Place button only enabled at 1 leg.
  const leg0 = legs[0];
  const strikeNum = parseFloat(leg0.strike);
  const qtyNum = parseInt(leg0.quantity, 10);
  const limitNum = parseFloat(leg0.entryPrice);
  const expirationValid = /^\d{4}-\d{2}-\d{2}$/.test(leg0.expiration);
  const strikeValid = !isNaN(strikeNum) && strikeNum > 0;
  const qtyValid = !isNaN(qtyNum) && qtyNum >= 1;
  const limitValid = !isNaN(limitNum) && limitNum > 0;

  const estNotional: number | null =
    qtyValid && limitValid ? parseFloat((qtyNum * limitNum * 100).toFixed(4)) : null;
  const overCap = estNotional !== null && estNotional > NOTIONAL_CAP;

  const isMultiLeg = legs.length > 1;

  const canSubmit =
    !isMultiLeg &&
    underlying.length > 0 &&
    expirationValid &&
    strikeValid &&
    qtyValid &&
    limitValid &&
    !overCap &&
    (dryRun || (!dryRun && confirm)) &&
    !submitting;

  const canSimulate = underlying.length > 0 && allLegsComplete && !submitting;

  // Combined notional across all legs (signed: + for credit received, − for debit paid).
  const combinedDebit = legs.reduce((s, l) => {
    const q = parseInt(l.quantity, 10);
    const p = parseFloat(l.entryPrice);
    if (isNaN(q) || isNaN(p)) return s;
    const sign = l.side === 'buy' ? -1 : 1;
    return s + sign * q * p * 100;
  }, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const res = await placeOptionOrder({
        underlying: underlying.toUpperCase(),
        expiration: leg0.expiration,
        strike: strikeNum,
        option_type: leg0.optionType,
        side: leg0.side,
        position_effect: positionEffect,
        quantity: qtyNum,
        limit_price: limitNum,
        account,
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

  // Strategy badge: single-leg uses the existing helper; multi-leg delegates.
  const badge = (() => {
    if (!isMultiLeg) {
      const k = strategyKind(leg0.side, leg0.optionType, positionEffect);
      const c = strategyToneColors(k.tone);
      return { short: k.short, full: k.full, fg: c.fg, bg: c.bg };
    }
    const m = classifyMultiLeg(legs);
    const c = strategyToneColors('long'); // multi-leg uses neutral green-ish chip
    return { short: m.label.toUpperCase(), full: m.label, fg: c.fg, bg: c.bg };
  })();

  return (
    <div
      className="rv-card"
      style={{ borderColor, transition: 'border-color 0.2s' }}
      data-testid="options-trade-panel"
    >
      <div className="rv-card-head">
        <h3>Options order panel</h3>
        <span
          style={{
            ...monoStyle,
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 3,
            border: `1px solid ${dryRun ? 'var(--gold, #FFD700)' : 'var(--pink, #FF006E)'}`,
            background: dryRun ? 'rgba(255,215,0,0.12)' : 'rgba(255,0,110,0.12)',
            color: dryRun ? 'var(--gold, #FFD700)' : 'var(--pink, #FF006E)',
            marginLeft: 'auto',
          }}
        >
          {dryRun ? 'DRY RUN — no real orders' : 'LIVE — real money'}
        </span>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Header row: Underlying + strategy badge + account selector */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Underlying</span>
          <span style={{ ...monoStyle, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
            {underlying.toUpperCase() || '—'}
          </span>
          <span
            data-testid="option-strategy-badge"
            title={badge.full}
            style={{
              ...monoStyle,
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 3,
              border: `1px solid ${badge.fg}`,
              background: badge.bg,
              color: badge.fg,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {badge.short}
          </span>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span className="rv-sub" style={{ margin: 0, fontSize: 10 }}>account</span>
            <div
              role="tablist"
              aria-label="Trading account"
              style={{
                display: 'flex',
                borderRadius: 3,
                overflow: 'hidden',
                border: '1px solid var(--line)',
              }}
            >
              {(
                [
                  { v: 'brokerage', label: 'Individual' },
                  { v: 'roth_ira', label: 'Roth IRA' },
                ] as const
              ).map((opt) => {
                const selected = account === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setAccount(opt.v)}
                    data-testid={`option-account-${opt.v}`}
                    style={{
                      ...monoStyle,
                      fontSize: 11,
                      padding: '4px 10px',
                      background: selected ? 'rgba(58,141,255,0.14)' : 'var(--bg, #1E1E1E)',
                      border: 'none',
                      color: selected ? 'var(--blue, #3A8DFF)' : 'var(--ink-dim)',
                      cursor: 'pointer',
                      fontWeight: selected ? 700 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Per-leg rows */}
        {legs.map((leg, idx) => (
          <LegRow
            key={leg.id}
            leg={leg}
            index={idx}
            canRemove={legs.length > 1}
            onChange={(patch) => updateLeg(leg.id, patch)}
            onRemove={() => removeLeg(leg.id)}
          />
        ))}

        {/* Add leg + position effect + combined-notional summary */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={addLeg}
            disabled={legs.length >= MAX_LEGS}
            data-testid="add-leg-button"
            title={legs.length >= MAX_LEGS ? `Max ${MAX_LEGS} legs` : 'Add leg'}
            style={{
              ...monoStyle,
              fontSize: 11,
              padding: '6px 12px',
              borderRadius: 3,
              border: `1px dashed ${legs.length >= MAX_LEGS ? 'var(--line)' : 'var(--gold, #FFD700)'}`,
              background: 'transparent',
              color: legs.length >= MAX_LEGS ? 'var(--ink-mute)' : 'var(--gold, #FFD700)',
              cursor: legs.length >= MAX_LEGS ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            + Add leg ({legs.length}/{MAX_LEGS})
          </button>

          {!isMultiLeg && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Effect</span>
              <select
                value={positionEffect}
                onChange={(e) => setPositionEffect(e.target.value as 'open' | 'close')}
                data-testid="option-effect"
                style={{
                  ...monoStyle,
                  fontSize: 12,
                  padding: '4px 6px',
                  background: 'var(--bg, #1E1E1E)',
                  border: '1px solid var(--line)',
                  borderRadius: 3,
                  color: 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                <option value="open">Open</option>
                <option value="close">Close</option>
              </select>
            </label>
          )}

          {allLegsComplete && (
            <span style={{ ...monoStyle, fontSize: 11, color: 'var(--ink-dim)', marginLeft: 'auto' }}>
              Net {combinedDebit >= 0 ? 'credit' : 'debit'}: $
              {Math.abs(combinedDebit).toFixed(2)}
            </span>
          )}
        </div>

        {!isMultiLeg && overCap && (
          <span style={{ fontSize: 10, color: 'var(--pink, #FF006E)', ...monoStyle }}>
            Est. notional ${estNotional?.toFixed(2)} exceeds cap ${NOTIONAL_CAP}
            (= limit × 100 × contracts)
          </span>
        )}

        {/* Dry-run toggle (single-leg only — multi-leg is sim only) */}
        {!isMultiLeg && (
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
            }}
          >
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => {
                setDryRun(e.target.checked);
                if (e.target.checked) setConfirm(false);
              }}
              data-testid="option-dry-run-toggle"
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold, #FFD700)' }}
            />
            <span style={{ ...monoStyle, fontSize: 12, color: dryRun ? 'var(--gold, #FFD700)' : 'var(--ink-dim)' }}>
              Dry run (simulate only — default ON)
            </span>
          </label>
        )}

        {!isMultiLeg && !dryRun && (
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
              data-testid="option-confirm-toggle"
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--pink, #FF006E)' }}
            />
            <span style={{ ...monoStyle, fontSize: 12, color: 'var(--pink, #FF006E)' }}>
              I confirm this is a REAL MONEY options order on Robinhood
            </span>
          </label>
        )}

        {/* Action row: Place + Simulate */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="option-submit"
            title={
              isMultiLeg
                ? 'Multi-leg routing not wired — use Simulate'
                : undefined
            }
            style={{
              ...monoStyle,
              flex: '1 1 200px',
              padding: '8px 12px',
              borderRadius: 4,
              border: 'none',
              background: canSubmit
                ? dryRun
                  ? 'rgba(255,215,0,0.18)'
                  : 'rgba(255,0,110,0.18)'
                : 'var(--line)',
              color: canSubmit ? (dryRun ? 'var(--gold, #FFD700)' : 'var(--pink, #FF006E)') : 'var(--ink-mute)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {submitting
              ? 'Submitting…'
              : isMultiLeg
                ? 'Multi-leg — simulate only'
                : `${dryRun ? 'Simulate place' : 'Place live'} ${leg0.side} ${qtyValid ? qtyNum : '?'} ${
                    strikeValid ? strikeNum : '?'
                  }${leg0.optionType[0].toUpperCase()} ${leg0.expiration || '…'}${
                    estNotional != null ? ` · ~$${estNotional.toFixed(2)}` : ''
                  }`}
          </button>

          <button
            type="button"
            onClick={() => setSimOpen(true)}
            disabled={!canSimulate}
            data-testid="simulate-button"
            title={canSimulate ? 'Open returns simulator' : 'Fill all leg fields to simulate'}
            style={{
              ...monoStyle,
              padding: '8px 16px',
              borderRadius: 4,
              border: `1px solid ${canSimulate ? 'var(--blue, #3A8DFF)' : 'var(--line)'}`,
              background: canSimulate ? 'rgba(58,141,255,0.14)' : 'transparent',
              color: canSimulate ? 'var(--blue, #3A8DFF)' : 'var(--ink-mute)',
              cursor: canSimulate ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            ⏵ Simulate
          </button>
        </div>
      </form>

      {result && !error && (
        <div
          data-testid="option-order-result"
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 4,
            border: `1px solid ${result.dry_run ? 'var(--green, #00C805)' : 'var(--gold, #FFD700)'}`,
            background: result.dry_run ? 'rgba(0,200,5,0.08)' : 'rgba(255,215,0,0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 6, alignItems: 'center' }}>
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
            {(() => {
              const kind = strategyKind(
                result.side as 'buy' | 'sell',
                result.option_type as 'call' | 'put',
                result.position_effect as 'open' | 'close',
              );
              const c = strategyToneColors(kind.tone);
              return (
                <span
                  data-testid="option-strategy-badge-result"
                  title={kind.full}
                  style={{
                    ...monoStyle,
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 3,
                    border: `1px solid ${c.fg}`,
                    background: c.bg,
                    color: c.fg,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                  }}
                >
                  {kind.short}
                </span>
              );
            })()}
            <span style={{ ...monoStyle, fontSize: 10, color: 'var(--ink-mute)' }}>{result.order_id}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 4 }}>
            {[
              ['Underlying', result.underlying],
              ['Contract', `${result.strike} ${result.option_type.toUpperCase()} ${result.expiration}`],
              ['Side', result.side.toUpperCase()],
              ['Effect', result.position_effect.toUpperCase()],
              ['Account', result.account === 'roth_ira' ? 'Roth IRA' : 'Individual'],
              ['Qty', `${result.quantity}`],
              ['Limit', `$${result.limit_price.toFixed(2)}`],
              ['Notional', `$${result.estimated_notional_usd.toFixed(2)}`],
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
        </div>
      )}

      {error && (
        <div
          data-testid="option-order-error"
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

      <SimulatorOverlay
        open={simOpen}
        legs={legs}
        underlying={underlying}
        onClose={() => setSimOpen(false)}
      />
    </div>
  );
}

// ----- Per-leg row component -------------------------------------------------

function LegRow({
  leg,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  leg: Leg;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<Leg>) => void;
  onRemove: () => void;
}) {
  const strikeNum = parseFloat(leg.strike);
  const qtyNum = parseInt(leg.quantity, 10);
  const entryNum = parseFloat(leg.entryPrice);
  const expirationValid = /^\d{4}-\d{2}-\d{2}$/.test(leg.expiration);
  const strikeValid = !isNaN(strikeNum) && strikeNum > 0;
  const qtyValid = !isNaN(qtyNum) && qtyNum >= 1;
  const entryValid = !isNaN(entryNum) && entryNum >= 0;

  return (
    <div
      data-testid={`leg-row-${index}`}
      style={{
        position: 'relative',
        padding: '8px 10px',
        borderRadius: 4,
        border: '1px solid var(--line)',
        background: 'rgba(255,255,255,0.015)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
      }}>
        <span style={{
          ...monoStyle,
          fontSize: 9,
          padding: '1px 6px',
          borderRadius: 2,
          background: 'var(--bg, #1E1E1E)',
          border: '1px solid var(--line)',
          color: 'var(--ink-dim)',
          fontWeight: 700,
        }}>
          LEG {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            data-testid={`remove-leg-button-${index}`}
            aria-label={`Remove leg ${index + 1}`}
            style={{
              ...monoStyle,
              marginLeft: 'auto',
              padding: '0 8px',
              borderRadius: 3,
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--ink-mute)',
              cursor: 'pointer',
              fontSize: 11,
              lineHeight: '20px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px' }}>
          <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Expiration</span>
          <input
            type="date"
            value={leg.expiration}
            onChange={(e) => onChange({ expiration: e.target.value })}
            data-testid={`option-expiration-${index}`}
            style={{
              ...monoStyle,
              fontSize: 13,
              padding: '6px 8px',
              background: 'var(--bg, #1E1E1E)',
              border: `1px solid ${leg.expiration && !expirationValid ? 'var(--pink, #FF006E)' : 'var(--line)'}`,
              borderRadius: 3,
              color: 'var(--ink)',
              colorScheme: 'dark',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 100px' }}>
          <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Strike</span>
          <input
            type="number"
            min={0.01}
            step="any"
            value={leg.strike}
            onChange={(e) => onChange({ strike: e.target.value })}
            placeholder="0.00"
            data-testid={`option-strike-${index}`}
            style={{
              ...monoStyle,
              fontSize: 13,
              padding: '6px 8px',
              background: 'var(--bg, #1E1E1E)',
              border: `1px solid ${leg.strike && !strikeValid ? 'var(--pink, #FF006E)' : 'var(--line)'}`,
              borderRadius: 3,
              color: 'var(--ink)',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 110px' }}>
          <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Type</span>
          <div style={{ display: 'flex', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {(['call', 'put'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ optionType: t })}
                data-testid={`option-type-${t}-${index}`}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: leg.optionType === t ? 'rgba(255,215,0,0.14)' : 'var(--bg, #1E1E1E)',
                  border: 'none',
                  color: leg.optionType === t ? 'var(--gold, #FFD700)' : 'var(--ink-dim)',
                  cursor: 'pointer',
                  fontWeight: leg.optionType === t ? 700 : 400,
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

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 100px' }}>
          <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Side</span>
          <div style={{ display: 'flex', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {(['buy', 'sell'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ side: s })}
                data-testid={`option-side-${s}-${index}`}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background:
                    leg.side === s
                      ? s === 'buy'
                        ? 'rgba(0,200,5,0.18)'
                        : 'rgba(255,0,110,0.18)'
                      : 'var(--bg, #1E1E1E)',
                  border: 'none',
                  color:
                    leg.side === s
                      ? s === 'buy'
                        ? 'var(--green, #00C805)'
                        : 'var(--pink, #FF006E)'
                      : 'var(--ink-dim)',
                  cursor: 'pointer',
                  fontWeight: leg.side === s ? 700 : 400,
                  ...monoStyle,
                  fontSize: 12,
                  textTransform: 'uppercase',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 80px' }}>
          <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Qty</span>
          <input
            type="number"
            min={1}
            step={1}
            value={leg.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            placeholder="1"
            data-testid={`option-quantity-${index}`}
            style={{
              ...monoStyle,
              fontSize: 13,
              padding: '6px 8px',
              background: 'var(--bg, #1E1E1E)',
              border: `1px solid ${leg.quantity && !qtyValid ? 'var(--pink, #FF006E)' : 'var(--line)'}`,
              borderRadius: 3,
              color: 'var(--ink)',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 110px' }}>
          <span className="rv-sub" style={{ margin: 0, fontSize: 11 }}>Entry $/sh</span>
          <input
            type="number"
            min={0}
            step="any"
            value={leg.entryPrice}
            onChange={(e) => onChange({ entryPrice: e.target.value })}
            placeholder="0.00"
            data-testid={`option-entry-price-${index}`}
            style={{
              ...monoStyle,
              fontSize: 13,
              padding: '6px 8px',
              background: 'var(--bg, #1E1E1E)',
              border: `1px solid ${leg.entryPrice && !entryValid ? 'var(--pink, #FF006E)' : 'var(--line)'}`,
              borderRadius: 3,
              color: 'var(--ink)',
            }}
          />
        </label>
      </div>
    </div>
  );
}
