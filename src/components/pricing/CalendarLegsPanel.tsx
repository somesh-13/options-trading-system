'use client';

import type { OptionExpirationMeta } from '@/lib/pricing-api';

interface LegMeta {
  expiration: string; // YYYY-MM-DD
  dte: number;
  atm_iv: number | null;
}

interface CalendarLegsPanelProps {
  ticker: string;
  spot: number | null;
  strike: number;
  onStrikeChange: (k: number) => void;
  expirations: OptionExpirationMeta[];
  shortExpiry: string | null;
  longExpiry: string | null;
  onShortExpiryChange: (iso: string) => void;
  onLongExpiryChange: (iso: string) => void;
}

function formatExpiration(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

function LegCard({
  side,
  meta,
  expirations,
  onChange,
}: {
  side: 'short' | 'long';
  meta: LegMeta | null;
  expirations: OptionExpirationMeta[];
  onChange: (iso: string) => void;
}) {
  const isShort = side === 'short';
  const borderColor = isShort ? '#ef4444' : '#22c55e';
  const sideLabel = isShort ? 'SHORT · front month' : 'LONG · back month';

  return (
    <div
      style={{
        background: '#181818',
        borderLeft: `2px solid ${borderColor}`,
        borderTop: '1px solid var(--line)',
        borderRight: '1px solid var(--line)',
        borderBottom: '1px solid var(--line)',
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <div
        className="text-meta"
        style={{ color: borderColor, letterSpacing: 1, fontWeight: 600 }}
      >
        {sideLabel}
      </div>
      <div style={{ marginTop: 6 }}>
        <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>Expiry</div>
        <select
          value={meta?.expiration ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%',
            background: '#0c0d10',
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            padding: '4px 6px',
            borderRadius: 3,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {expirations.map((e) => (
            <option key={e.expiration} value={e.expiration}>
              {formatExpiration(e.expiration)} ({e.dte}d) ·{' '}
              {typeof e.atm_iv === 'number' ? `${(e.atm_iv * 100).toFixed(0)}% IV` : '—'}
            </option>
          ))}
        </select>
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
        }}
      >
        <div>
          <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>DTE</div>
          <div>{meta?.dte ?? '—'}d</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>ATM IV</div>
          <div>
            {typeof meta?.atm_iv === 'number' ? `${(meta.atm_iv * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CalendarLegsPanel({
  ticker,
  spot,
  strike,
  onStrikeChange,
  expirations,
  shortExpiry,
  longExpiry,
  onShortExpiryChange,
  onLongExpiryChange,
}: CalendarLegsPanelProps) {
  const findMeta = (iso: string | null): LegMeta | null => {
    if (!iso) return null;
    const e = expirations.find((x) => x.expiration === iso);
    return e ? { expiration: e.expiration, dte: e.dte, atm_iv: e.atm_iv } : null;
  };

  const shortMeta = findMeta(shortExpiry);
  const longMeta = findMeta(longExpiry);

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 10px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          marginBottom: 10,
        }}
      >
        <div>
          <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>Ticker</div>
          <div>{ticker}</div>
        </div>
        <div>
          <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>Spot</div>
          <div>${spot != null ? spot.toFixed(2) : '—'}</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            marginBottom: 2,
          }}
        >
          <span className="rv-sub" style={{ margin: 0 }}>Strike (shared · pure calendar)</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>${strike.toFixed(2)}</span>
        </div>
        <input
          type="number"
          step="0.5"
          value={strike}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v > 0) onStrikeChange(v);
          }}
          style={{
            width: '100%',
            background: '#0c0d10',
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            padding: '4px 6px',
            borderRadius: 3,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}
        />
      </div>

      <LegCard
        side="short"
        meta={shortMeta}
        expirations={expirations}
        onChange={onShortExpiryChange}
      />
      <LegCard
        side="long"
        meta={longMeta}
        expirations={expirations}
        onChange={onLongExpiryChange}
      />
    </div>
  );
}
