'use client';

import { useState } from 'react';
import { ChainTable } from '@/components/chain/ChainTable';
import { ExpirationStrip, type Expiration } from '@/components/chain/ExpirationStrip';
import { OrderTicket } from '@/components/chain/OrderTicket';

/**
 * Option chain page — port of `chainAfter()` from the design source.
 *
 * Layout: header line (ticker / spot / change chip / sub) → ExpirationStrip
 * → `.rv-chain-wrap` two-col grid (chain card | ticket card).
 *
 * Mock data inline. Ticker is hardcoded for now.
 *
 * TODO: read ticker from URL `?ticker=…` once we have multi-ticker data.
 * TODO: wire GET /api/options/chain?ticker=…&expiration=… for chain rows
 * TODO: wire POST /api/strategy/ev/scan for the EV signal column
 */

const EXPIRATIONS: Expiration[] = [
  { dte: '7d', date: 'Apr 26', iv: 0.68, oi: 12 },
  { dte: '14d', date: 'May 03', iv: 0.71, oi: 18 },
  { dte: '24d', date: 'May 17', iv: 0.724, oi: 44 },
  { dte: '45d', date: 'Jun 07', iv: 0.69, oi: 22 },
  { dte: '80d', date: 'Jul 12', iv: 0.62, oi: 14 },
  { dte: '170d', date: 'Oct 11', iv: 0.55, oi: 8 },
];

export default function OptionsChainPage() {
  const [selectedIdx, setSelectedIdx] = useState(2);
  const expiration = EXPIRATIONS[selectedIdx];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 2 }}>
        <h2 className="rv-h1" style={{ margin: 0 }}>
          CIFR
        </h2>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18 }}>15.50</span>
        <span className="rv-chip buy">+2.4%</span>
        <span className="rv-sub" style={{ margin: 0 }}>
          Cipher Mining · high-vol regime · 7 flagged strikes
        </span>
      </div>

      <ExpirationStrip
        expirations={EXPIRATIONS}
        selectedIdx={selectedIdx}
        onSelect={setSelectedIdx}
      />

      <div className="rv-chain-wrap">
        <div className="rv-card" style={{ padding: 0 }}>
          <ChainTable expiration={expiration} />
        </div>
        <div className="rv-card rv-ticket">
          <OrderTicket />
        </div>
      </div>
    </>
  );
}
