'use client';

/**
 * Horizontal expiration strip — port of `chainAfter()`'s `.rv-expstrip` block.
 * Shows term structure (DTE, date, ATM IV, OI) at a glance so the trader can
 * spot calendar skew without opening a dropdown.
 */

import { ScrollCarousel } from '@/components/ui/ScrollCarousel';

export type Expiration = {
  dte: string;
  date: string;
  iv: number;
  oi: number;
};

export type ExpirationStripProps = {
  expirations: Expiration[];
  selectedIdx: number;
  onSelect?: (i: number) => void;
};

export function ExpirationStrip({ expirations, selectedIdx, onSelect }: ExpirationStripProps) {
  return (
    <ScrollCarousel centerOnKey={selectedIdx} style={{ margin: '10px 0 12px' }}>
      {expirations.map((e, i) => (
        <div
          key={`${e.dte}-${e.date}`}
          className={`rv-exp ${i === selectedIdx ? 'on' : ''}`}
          onClick={onSelect ? () => onSelect(i) : undefined}
        >
          <div className="dte">{e.dte}</div>
          <div className="date">{e.date}</div>
          <div className="iv">ATM IV {(e.iv * 100).toFixed(0)}%</div>
          <div className="oi">{e.oi}k OI</div>
        </div>
      ))}
    </ScrollCarousel>
  );
}
