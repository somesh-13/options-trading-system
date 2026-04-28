'use client';

import { useEffect, useState } from 'react';
import { getMispricing, type MispricingData } from '@/lib/pricing-api';
import HVConfidenceDisplay from '@/components/HVConfidenceDisplay';
import RegimeIndicator from '@/components/RegimeIndicator';

interface MispricingDetectorProps {
  ticker: string;
}

export default function MispricingDetector({ ticker }: MispricingDetectorProps) {
  const [data, setData] = useState<MispricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = async () => {
    try {
      setError(null);
      setLoading(true);
      const mispricingData = await getMispricing(ticker);
      setData(mispricingData);
      setLastUpdate(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  if (loading && !data) {
    return (
      <div className="rv-card" style={{ marginTop: 0 }}>
        <div className="rv-card-head">
          <h3>{ticker} MISPRICING DETECTOR</h3>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ height: 14, background: 'var(--line-soft)', borderRadius: 3, opacity: 0.6 }} />
          <div style={{ height: 14, background: 'var(--line-soft)', borderRadius: 3, opacity: 0.4, width: '80%' }} />
          <div style={{ height: 14, background: 'var(--line-soft)', borderRadius: 3, opacity: 0.4, width: '60%' }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rv-card" style={{ marginTop: 0 }}>
        <div className="rv-card-head">
          <h3>{ticker} MISPRICING DETECTOR</h3>
        </div>
        <div
          style={{
            border: '1px solid rgba(255,0,110,.35)',
            background: 'rgba(255,0,110,.08)',
            color: 'var(--pink)',
            padding: '10px 12px',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          Error loading {ticker} data: {error}
        </div>
        <button onClick={fetchData} type="button" className="rv-btn primary" style={{ marginTop: 10 }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const signalChip: Record<string, { color: string; border: string; bg: string }> = {
    SELL: { color: 'var(--gold)', border: 'rgba(255,215,0,.35)', bg: 'rgba(255,215,0,.08)' },
    BUY: { color: 'var(--green)', border: 'rgba(0,200,5,.35)', bg: 'rgba(0,200,5,.08)' },
    NEUTRAL: { color: 'var(--ink-dim)', border: 'var(--line)', bg: '#0c0d10' },
  };
  const chip = signalChip[data.signal] || signalChip.NEUTRAL;
  const isOpportunity = data.iv_hv_ratio > 1.3;

  return (
    <div
      className="rv-card"
      style={{
        marginTop: 0,
        borderColor: isOpportunity ? 'rgba(0,200,5,.4)' : 'var(--line)',
      }}
    >
      <div className="rv-card-head">
        <div>
          <h3>{ticker} MISPRICING DETECTOR</h3>
          <div className="text-meta" style={{ marginTop: 4 }}>
            LAST UPDATED {lastUpdate.toLocaleTimeString()}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="rv-pill"
            style={{ color: chip.color, borderColor: chip.border, background: chip.bg, fontWeight: 600 }}
          >
            {data.signal}
          </span>
          <RegimeIndicator ticker={ticker} />
        </div>
      </div>

      {/* Key metrics */}
      <div className="rv-grid-4" style={{ marginBottom: 12 }}>
        <div className="rv-kpi">
          <div className="k">SPOT</div>
          <div className="v">${data.spot_price.toFixed(2)}</div>
        </div>
        <div className="rv-kpi">
          <div className="k">HV (30D)</div>
          <div className="v">{(data.historical_vol * 100).toFixed(1)}%</div>
          <div className="d" style={{ color: 'var(--ink-mute)' }}>realized</div>
        </div>
        <div className="rv-kpi">
          <div className="k">IV (ATM)</div>
          <div className="v">{(data.implied_vol_atm * 100).toFixed(1)}%</div>
          <div className="d" style={{ color: 'var(--ink-mute)' }}>market</div>
        </div>
        <div className="rv-kpi">
          <div className="k">IV / HV</div>
          <div className="v" style={{ color: isOpportunity ? 'var(--green)' : 'var(--ink)' }}>
            {data.iv_hv_ratio.toFixed(2)}x
          </div>
        </div>
      </div>

      {/* HV confidence */}
      <div style={{ marginBottom: 12 }}>
        <HVConfidenceDisplay ticker={ticker} />
      </div>

      {/* ATM call details */}
      <div
        style={{
          background: '#0c0d10',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div className="text-section" style={{ marginBottom: 10 }}>ATM CALL OPTION</div>
        <div className="rv-grid-4">
          <AtmCell label="Strike" value={`$${data.atm_strike}`} />
          <AtmCell label="Mid" value={`$${data.atm_call_price.toFixed(2)}`} />
          <AtmCell label="Bid / Ask" value={`$${data.bid.toFixed(2)} / $${data.ask.toFixed(2)}`} />
          <AtmCell label="Expiration" value={new Date(data.expiration).toLocaleDateString()} />
        </div>
      </div>

      {/* Volume & OI */}
      <div className="rv-grid-2" style={{ marginBottom: 12 }}>
        <div className="rv-kpi">
          <div className="k">VOLUME</div>
          <div className="v">{data.volume.toLocaleString()}</div>
        </div>
        <div className="rv-kpi">
          <div className="k">OPEN INTEREST</div>
          <div className="v">{data.open_interest.toLocaleString()}</div>
        </div>
      </div>

      {isOpportunity && (
        <div
          style={{
            border: '1px solid rgba(0,200,5,.35)',
            background: 'rgba(0,200,5,.08)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <div style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
            Trading opportunity detected
          </div>
          <div className="rv-sub" style={{ margin: 0 }}>
            IV is {((data.iv_hv_ratio - 1) * 100).toFixed(0)}% above HV — selling options captures the vol premium.
          </div>
        </div>
      )}

      <button
        onClick={fetchData}
        type="button"
        className="rv-btn ghost"
        style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
      >
        Refresh data
      </button>
    </div>
  );
}

function AtmCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-meta">{label.toUpperCase()}</div>
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ink)',
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}
