'use client';

/**
 * Compact single-row verdict for one ticker.
 *
 * Layout (~50px tall):
 *   [TICKER] [SIGNAL pill] [IV/HV ratio] [Strategy chip] [annotations]
 *
 * Reads from the per-ticker AsyncState dict keyed as `TICKER:test_key`.
 * Suppresses: sentiment, backtest with <10 trades, regime at 100% probability.
 */

import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'err'; error: string };

export interface TickerVerdictProps {
  ticker: string;
  results: Record<string, AsyncState<unknown>>;
}

// ---------------------------------------------------------------------------
// conviction helper (exported for sorting in parent components)
// ---------------------------------------------------------------------------

export function conviction(
  results: Record<string, AsyncState<unknown>>,
  ticker: string,
): number {
  const m = results[`${ticker}:mispricing`];
  const c = results[`${ticker}:confluence`];
  let score = 0;
  if (m?.status === 'ok') {
    const ratio = (m.data as Record<string, unknown>).iv_hv_ratio as number | undefined;
    if (ratio != null) score += Math.abs(ratio - 1);
  }
  if (c?.status === 'ok') {
    const cs = (c.data as Record<string, unknown>).confluence_score as number | undefined;
    if (cs != null) score += cs;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function signalColor(sig: string | undefined): string {
  if (sig === 'BUY') return 'var(--green, #00C805)';
  if (sig === 'SELL') return 'var(--pink, #FF006E)';
  return 'var(--ink-dim, #888)';
}

function ratioColor(ratio: number): string {
  if (ratio > 1.5) return 'var(--pink, #FF006E)';
  if (ratio < 0.7) return 'var(--green, #00C805)';
  return 'var(--ink, #e0e0e0)';
}

// ---------------------------------------------------------------------------
// TickerVerdict
// ---------------------------------------------------------------------------

export function TickerVerdict({ ticker, results }: TickerVerdictProps) {
  const mispState = results[`${ticker}:mispricing`];
  const confState = results[`${ticker}:confluence`];
  const hvState   = results[`${ticker}:hv`];
  const varState  = results[`${ticker}:var`];
  const regState  = results[`${ticker}:regime`];
  const btState   = results[`${ticker}:backtest`];

  // ---- idle / loading / error for mispricing (the primary signal) ----------

  if (!mispState || mispState.status === 'idle') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-mute, #555)',
        }}
      >
        <TickerLink ticker={ticker} />
        <span style={{ fontSize: 10, color: 'var(--ink-mute, #555)' }}>not run yet</span>
      </div>
    );
  }

  if (mispState.status === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        }}
      >
        <TickerLink ticker={ticker} />
        <span style={{ fontSize: 10, color: 'var(--ink-dim, #888)' }}>…</span>
      </div>
    );
  }

  if (mispState.status === 'err') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        }}
      >
        <TickerLink ticker={ticker} />
        <span style={{ fontSize: 10, color: 'var(--pink, #FF006E)' }}>{mispState.error}</span>
      </div>
    );
  }

  // ---- ok: extract mispricing fields ---------------------------------------

  const md = mispState.data as Record<string, unknown>;
  const signal   = md.signal as string | undefined;
  const ivhvRatio = md.iv_hv_ratio as number | undefined;

  // ---- confluence ----------------------------------------------------------

  let strategy: string | null = null;
  let confScore: number | null = null;
  if (confState?.status === 'ok') {
    const cd = confState.data as Record<string, unknown>;
    strategy  = (cd.recommended_strategy as string | undefined) ?? null;
    confScore = (cd.confluence_score as number | undefined) ?? null;
  }

  // ---- HV annotation -------------------------------------------------------

  let hvAnnotation: string | null = null;
  if (hvState?.status === 'ok') {
    const hd = hvState.data as Record<string, unknown>;
    const hv       = hd.hv as number | undefined;
    const lo       = hd.ci_lower as number | undefined;
    const hi       = hd.ci_upper as number | undefined;
    const reliable = hd.reliable as boolean | undefined;
    if (hv != null) {
      const hvPct = (hv * 100).toFixed(1);
      if (reliable === false && lo != null && hi != null) {
        hvAnnotation = `HV ${hvPct}% [${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}]`;
      } else {
        hvAnnotation = `HV ${hvPct}%`;
      }
    }
  }

  // ---- VaR annotation ------------------------------------------------------

  let varAnnotation: string | null = null;
  if (varState?.status === 'ok') {
    const vd = varState.data as Record<string, unknown>;
    const hist = vd.historical as { var_pct?: number } | undefined;
    if (hist?.var_pct != null) {
      varAnnotation = `VaR ${hist.var_pct.toFixed(1)}%`;
    }
  }

  // ---- Regime annotation (only show if probability < 0.95) -----------------

  let regAnnotation: string | null = null;
  if (regState?.status === 'ok') {
    const rd = regState.data as Record<string, unknown>;
    const regime = rd.regime as string | undefined;
    const prob   = rd.probability as number | undefined;
    if (regime && prob != null && prob < 0.95) {
      regAnnotation = `${regime} ${(prob * 100).toFixed(0)}%`;
    }
  }

  // ---- Backtest annotation (only if total_trades < 10 AND result is ok) ----

  let btWarn = false;
  if (btState?.status === 'ok') {
    const bd = btState.data as Record<string, unknown>;
    const metrics = bd.metrics as Record<string, number> | undefined;
    const trades  = metrics?.total_trades ?? (bd.total_trades as number | undefined);
    if (trades != null && trades < 10) {
      btWarn = true;
    }
  }

  // ---- collect annotations -------------------------------------------------

  const annotations: string[] = [];
  if (hvAnnotation)  annotations.push(hvAnnotation);
  if (varAnnotation) annotations.push(varAnnotation);
  if (regAnnotation) annotations.push(regAnnotation);

  // ---- render --------------------------------------------------------------

  const showStrategy =
    strategy != null && strategy !== 'HOLD' && strategy !== '' && confScore != null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '5px 10px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        minHeight: 34,
      }}
    >
      {/* 1. Ticker symbol */}
      <TickerLink ticker={ticker} />

      {/* 2. Signal pill */}
      {signal ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 3,
            border: `1px solid ${signalColor(signal)}`,
            color: signalColor(signal),
            letterSpacing: '.04em',
          }}
        >
          {signal}
        </span>
      ) : (
        <span style={{ fontSize: 10, color: 'var(--ink-mute, #555)' }}>—</span>
      )}

      {/* 3. IV/HV ratio */}
      {ivhvRatio != null ? (
        <span
          style={{
            fontWeight: 700,
            color: ratioColor(ivhvRatio),
            minWidth: 38,
            fontSize: 11,
          }}
        >
          {ivhvRatio.toFixed(2)}x
        </span>
      ) : (
        <span style={{ color: 'var(--ink-mute, #555)', minWidth: 38 }}>—</span>
      )}

      {/* 4. Strategy chip */}
      {showStrategy && (
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 3,
            background: 'rgba(255,215,0,0.08)',
            border: '1px solid var(--gold-dim, #cdaa3d)',
            color: 'var(--gold, #FFD700)',
            whiteSpace: 'nowrap',
          }}
        >
          {'\u{1F3AF}'} {strategy} ({confScore!.toFixed(2)})
        </span>
      )}

      {/* 5. Annotations */}
      {(annotations.length > 0 || btWarn) && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-mute, #666)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
          }}
        >
          {annotations.map((a, i) => (
            <span key={i}>{a}</span>
          ))}
          {annotations.length > 0 && btWarn && <span style={{ color: 'var(--ink-mute, #666)' }}>·</span>}
          {btWarn && (
            <span style={{ color: 'var(--gold, #FFD700)' }}>&#9888; backtest sparse</span>
          )}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helper: gold ticker link
// ---------------------------------------------------------------------------

function TickerLink({ ticker }: { ticker: string }) {
  return (
    <Link
      href={`/stock/${encodeURIComponent(ticker)}?from=robinhood`}
      style={{
        color: 'var(--gold, #FFD700)',
        fontWeight: 700,
        textDecoration: 'none',
        minWidth: 56,
        fontSize: 12,
        letterSpacing: '.04em',
      }}
    >
      {ticker}
    </Link>
  );
}
