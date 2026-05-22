'use client';

import { useEffect, useState } from 'react';
import { getCalendarSignals, type CalendarSignalsBundle } from '@/lib/pricing-api';
import IvTermTable from './IvTermTable';
import IvForwardCurve from './IvForwardCurve';
import BestPairRow from './BestPairRow';

interface CalendarSignalsProps {
  ticker: string;
}

const STATUS_CHIP: Record<
  CalendarSignalsBundle['status'],
  { color: string; border: string; bg: string }
> = {
  FAVORABLE: { color: 'var(--green)', border: 'rgba(0,200,5,.35)', bg: 'rgba(0,200,5,.08)' },
  NEUTRAL: { color: 'var(--gold)', border: 'rgba(255,215,0,.35)', bg: 'rgba(255,215,0,.08)' },
  WEAK: { color: 'var(--ink-dim)', border: 'var(--line)', bg: '#0c0d10' },
};

export default function CalendarSignals({ ticker }: CalendarSignalsProps) {
  const [data, setData] = useState<CalendarSignalsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setError(null);
        const bundle = await getCalendarSignals(ticker);
        if (cancelled) return;
        setData(bundle);
        setLastUpdate(new Date());
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed');
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ticker]);

  if (loading && !data) {
    return (
      <div className="rv-card" style={{ marginTop: 0 }}>
        <div className="rv-card-head">
          <h3>{ticker} CALENDAR SIGNALS</h3>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ height: 14, background: 'var(--line-soft)', borderRadius: 3, opacity: 0.6 }} />
          <div style={{ height: 60, background: 'var(--line-soft)', borderRadius: 6, opacity: 0.4 }} />
          <div style={{ height: 40, background: 'var(--line-soft)', borderRadius: 6, opacity: 0.3 }} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rv-card" style={{ marginTop: 0 }}>
        <div className="rv-card-head">
          <h3>{ticker} CALENDAR SIGNALS</h3>
        </div>
        <div
          style={{
            border: '1px solid rgba(255,0,110,.35)',
            background: 'rgba(255,0,110,.08)',
            color: 'var(--pink)',
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
          }}
        >
          {error || 'No data'}
        </div>
      </div>
    );
  }

  const chip = STATUS_CHIP[data.status];

  return (
    <div className="rv-card" style={{ marginTop: 0 }}>
      <div className="rv-card-head">
        <div>
          <h3>{ticker} CALENDAR SIGNALS</h3>
          <div className="text-meta" style={{ marginTop: 4 }}>
            LAST UPDATED {lastUpdate.toLocaleTimeString()}
          </div>
        </div>
        <span
          className="rv-pill"
          style={{ color: chip.color, borderColor: chip.border, background: chip.bg, fontWeight: 600 }}
        >
          {data.status}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <IvTermTable termStructure={data.termStructure} hv={data.hv} size="sm" />
        <IvForwardCurve
          termStructure={data.termStructure}
          hv={data.hv}
          best={data.best}
          height={80}
        />
        {data.best ? (
          <BestPairRow ticker={ticker} pair={data.best} strike={data.atmStrike} />
        ) : (
          <div
            style={{
              background: '#0c0d10',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              color: 'var(--ink-mute)',
              fontFamily: 'JetBrains Mono, monospace',
              textAlign: 'center',
            }}
          >
            no viable front/back pair in the 7d / 21d window
          </div>
        )}
      </div>
    </div>
  );
}
