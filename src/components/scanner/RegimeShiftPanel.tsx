'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  RegimeShiftClassification,
  RegimeShiftResult,
} from '@/lib/types/regimeShift';

interface Props {
  ticker: string;
}

const CHECK_LABELS: Record<keyof Pick<
  RegimeShiftResult,
  'fundamental_inflection' | 'strategic_mix_shift' | 'guidance_underestimation' | 'tape_confirmation'
>, string> = {
  fundamental_inflection: 'Fundamental Inflection',
  strategic_mix_shift: 'Strategic Mix Shift',
  guidance_underestimation: 'Guidance Underestimation',
  tape_confirmation: 'Tape Confirmation',
};

const VERDICT_STYLE: Record<RegimeShiftClassification, { color: string; bg: string; border: string; subtitle: string }> = {
  'HIGH-CONVICTION REGIME SHIFT': {
    color: 'var(--gold)',
    bg: 'rgba(255,215,0,.08)',
    border: 'rgba(255,215,0,.45)',
    subtitle: 'Trigger an alert. Evidence matches an extreme regime shift.',
  },
  'EARLY WATCHLIST CANDIDATE': {
    color: 'var(--blue)',
    bg: 'rgba(76,154,255,.08)',
    border: 'rgba(76,154,255,.4)',
    subtitle: 'Some signals present. Flag for monitoring; no strong alert.',
  },
  'NO REGIME SHIFT DETECTED': {
    color: 'var(--ink-mute)',
    bg: 'transparent',
    border: 'var(--line)',
    subtitle: 'Evidence is insufficient for a regime-shift call.',
  },
};

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

export default function RegimeShiftPanel({ ticker }: Props) {
  const [data, setData] = useState<RegimeShiftResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInputs, setShowInputs] = useState(false);

  const runScan = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/scanner/regime-shift/${encodeURIComponent(ticker)}${force ? '?force=true' : ''}`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 240)}`);
      }
      const body = (await res.json()) as RegimeShiftResult;
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    void runScan(false);
  }, [runScan]);

  const verdictStyle = data ? VERDICT_STYLE[data.classification] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header / Re-run */}
      <div className="rv-card">
        <div className="rv-card-head">
          <h3>REGIME SHIFT SCANNER</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {data?.model && <span className="text-meta">{data.model}</span>}
            <button
              type="button"
              className="rv-btn"
              onClick={() => { void runScan(true); }}
              disabled={loading}
              style={{ padding: '4px 10px', cursor: loading ? 'wait' : 'pointer' }}
            >
              {loading ? 'Scanning…' : 'Re-run scan'}
            </button>
          </div>
        </div>
        <div className="text-meta" style={{ lineHeight: 1.5 }}>
          Single-ticker LLM classifier. Aggregates 8q quarterly fundamentals, the latest 8-K/6-K
          earnings release, IV/HV regime, 52W technicals, and recent news headlines, then applies a
          6-step rubric for early/mid-stage fundamental regime shifts (the SanDisk SNDK 2025–2026
          template). Results cached ~15 min per ticker.
        </div>
      </div>

      {error && (
        <div
          className="rv-card"
          style={{
            padding: 12,
            borderColor: 'rgba(255,0,110,.35)',
            background: 'rgba(255,0,110,.06)',
            color: 'var(--pink)',
            fontSize: 12,
          }}
        >
          <div className="text-meta" style={{ marginBottom: 4, color: 'var(--pink)' }}>SCAN FAILED</div>
          {error}
        </div>
      )}

      {!data && loading && (
        <div className="rv-card" style={{ padding: 18, textAlign: 'center', color: 'var(--ink-dim)', fontSize: 12 }}>
          Aggregating fundamentals, technicals, and IR signals — then calling Claude…
        </div>
      )}

      {data && verdictStyle && (
        <>
          {/* Verdict banner */}
          <div
            className="rv-card"
            style={{
              padding: '14px 18px',
              border: `1px solid ${verdictStyle.border}`,
              background: verdictStyle.bg,
            }}
          >
            <div className="text-meta">CLASSIFICATION</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: verdictStyle.color,
                letterSpacing: '0.02em',
                marginTop: 4,
              }}
            >
              {data.classification}
            </div>
            <div style={{ color: 'var(--ink-dim)', fontSize: 12, marginTop: 6 }}>
              {verdictStyle.subtitle}
            </div>
          </div>

          {/* 4 check chips */}
          <div className="rv-card">
            <div className="rv-card-head">
              <h3>CHECKS</h3>
              <span className="text-meta">
                {Object.values(CHECK_LABELS).length} steps
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 8,
              }}
            >
              {(Object.keys(CHECK_LABELS) as Array<keyof typeof CHECK_LABELS>).map((k) => {
                const passed = data[k];
                return (
                  <div
                    key={k}
                    style={{
                      padding: '10px 12px',
                      border: `1px solid ${passed ? 'rgba(0,200,5,.35)' : 'var(--line)'}`,
                      background: passed ? 'rgba(0,200,5,.06)' : 'transparent',
                      borderRadius: 6,
                    }}
                  >
                    <div className="text-meta">{CHECK_LABELS[k].toUpperCase()}</div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 13,
                        fontWeight: 600,
                        color: passed ? 'var(--green)' : 'var(--ink-mute)',
                      }}
                    >
                      {passed ? '✓ TRUE' : '✗ FALSE'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key reasons */}
          <div className="rv-card">
            <div className="rv-card-head">
              <h3>KEY REASONS</h3>
              <span className="text-meta">{data.key_reasons.length} bullets</span>
            </div>
            {data.key_reasons.length === 0 ? (
              <div className="text-meta">No reasons returned by the model.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink)', fontSize: 13, lineHeight: 1.55 }}>
                {data.key_reasons.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Suggested actions */}
          <div className="rv-card">
            <div className="rv-card-head">
              <h3>SUGGESTED ACTIONS</h3>
              <span className="text-meta">{data.suggested_actions.length} ideas</span>
            </div>
            {data.suggested_actions.length === 0 ? (
              <div className="text-meta">No actions returned.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-dim)', fontSize: 13, lineHeight: 1.55 }}>
                {data.suggested_actions.map((a, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{a}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Data gaps */}
          {data.data_gaps.length > 0 && (
            <div className="rv-card" style={{ borderColor: 'var(--line-soft)' }}>
              <div className="rv-card-head">
                <h3 style={{ color: 'var(--ink-mute)' }}>DATA GAPS</h3>
                <span className="text-meta">{data.data_gaps.length} items</span>
              </div>
              <div className="text-meta" style={{ lineHeight: 1.5, marginBottom: 6 }}>
                Inputs the model could not see. Booleans driven by these inputs may be weakly supported.
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-mute)', fontSize: 11.5, lineHeight: 1.55 }}>
                {data.data_gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Inputs (collapsible) */}
          <div className="rv-card">
            <div
              className="rv-card-head"
              onClick={() => setShowInputs((v) => !v)}
              style={{ cursor: 'pointer' }}
            >
              <h3>RAW INPUTS</h3>
              <span className="text-meta">{showInputs ? 'HIDE' : 'SHOW'}</span>
            </div>
            {showInputs && <RawInputsBlock data={data} />}
          </div>

          <div className="text-meta" style={{ textAlign: 'right' }}>
            as of {data.as_of ?? '—'} · {ticker.toUpperCase()}
          </div>
        </>
      )}
    </div>
  );
}

function RawInputsBlock({ data }: { data: RegimeShiftResult }) {
  const echo = data.inputs_echo ?? {};
  const q = echo.fundamentals_quarterly_8q;
  const ttm = echo.ttm_aggregates;
  const px = echo.price_context;
  const iv = echo.iv_context;
  const news = echo.news_headlines ?? [];
  const earnings = echo.latest_earnings_release ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {q?.periods && q.periods.length > 0 && (
        <div>
          <div className="text-meta" style={{ marginBottom: 6 }}>QUARTERLY (newest → oldest)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
              <thead>
                <tr style={{ color: 'var(--ink-mute)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px' }}>Metric</th>
                  {q.periods.map((p) => (
                    <th key={p} style={{ textAlign: 'right', padding: '4px 8px' }}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Revenue ($M)" values={q.revenue_M} fmt={(v) => (v == null ? '—' : v.toFixed(0))} />
                <Row label="Rev YoY%" values={q.revenue_yoy_chg} fmt={(v) => fmtPct(v)} />
                <Row label="Gross Margin" values={q.gross_margin} fmt={(v) => fmtPct(v)} />
                <Row label="Op Margin" values={q.operating_margin} fmt={(v) => fmtPct(v)} />
                <Row label="Diluted EPS" values={q.eps_diluted} fmt={(v) => fmtNum(v)} />
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {ttm && (
          <SubCard title="TTM AGGREGATES">
            <KV k="Revenue" v={fmtMoney(ttm.revenue)} />
            <KV k="Rev growth (1y)" v={fmtPct(ttm.revenue_growth_1y)} />
            <KV k="Op income" v={fmtMoney(ttm.operating_income)} />
            <KV k="Op margin" v={fmtPct(ttm.operating_margin)} />
            <KV k="Gross margins" v={fmtPct(ttm.gross_margins)} />
            <KV k="Earnings growth" v={fmtPct(ttm.earnings_growth)} />
            <KV k="Forward P/E" v={fmtNum(ttm.forward_pe)} />
          </SubCard>
        )}

        {px && (
          <SubCard title="PRICE / TAPE">
            <KV k="Last close" v={fmtNum(px.latest_close)} />
            <KV k="52W high" v={fmtNum(px['52w_high'])} />
            <KV k="Off 52W high" v={fmtPct(px.pct_off_52w_high)} />
            <KV k="1M / 3M" v={`${fmtPct(px.perf_1m)} / ${fmtPct(px.perf_3m)}`} />
            <KV k="6M / 12M" v={`${fmtPct(px.perf_6m)} / ${fmtPct(px.perf_12m)}`} />
            <KV k="Vol 5d / 3M avg" v={fmtNum(px.recent_volume_vs_3mo_avg_ratio, 2) + 'x'} />
          </SubCard>
        )}

        {iv && (
          <SubCard title="IV / REGIME">
            <KV k="ATM IV" v={fmtPct(iv.implied_vol_atm)} />
            <KV k="HV 30d" v={fmtPct(iv.historical_vol_30d)} />
            <KV k="IV/HV ratio" v={fmtNum(iv.iv_hv_ratio, 2)} />
            <KV k="ATM strike" v={fmtNum(iv.atm_strike)} />
            <KV k="Expiration" v={iv.expiration ?? '—'} />
            <KV k="Regime" v={iv.regime ?? '—'} />
          </SubCard>
        )}

        {Object.keys(earnings).length > 0 && (
          <SubCard title="LATEST EARNINGS (8-K/6-K)">
            {Object.entries(earnings).map(([k, v]) => (
              <KV key={k} k={k} v={String(v)} />
            ))}
          </SubCard>
        )}
      </div>

      {news.length > 0 && (
        <div>
          <div className="text-meta" style={{ marginBottom: 6 }}>RECENT HEADLINES</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-dim)', fontSize: 12, lineHeight: 1.5 }}>
            {news.map((n, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                <span style={{ color: 'var(--ink)' }}>{n.title}</span>
                {n.publisher && <span style={{ color: 'var(--ink-mute)' }}> — {n.publisher}</span>}
                {n.date && <span style={{ color: 'var(--ink-mute)' }}> ({n.date})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, values, fmt }: { label: string; values?: (number | null)[]; fmt: (v: number | null | undefined) => string }) {
  if (!values) return null;
  return (
    <tr>
      <td style={{ color: 'var(--ink-dim)', padding: '4px 8px' }}>{label}</td>
      {values.map((v, i) => (
        <td key={i} style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--ink)' }}>{fmt(v)}</td>
      ))}
    </tr>
  );
}

function SubCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px' }}>
      <div className="text-meta" style={{ marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
      <span style={{ color: 'var(--ink-mute)' }}>{k}</span>
      <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono, monospace)' }}>{v}</span>
    </div>
  );
}
