'use client';

/**
 * Event stream card — port of the right card in `engineAfter()` from the
 * design source (design/stocks-revamp/project/pages/06-auto-engine.js).
 *
 * Filter chips are visual + interactive (state held locally) but do not
 * actually filter the mock rows; once wired to /api/auto-engine/events we
 * pass the active filter to the request.
 */

import { useState } from 'react';

type Filter = 'all' | 'exec' | 'signal' | 'skip' | 'error';

type EventRow = {
  time: string;
  label: string;       // EXEC / SIGNAL / SKIP / SCAN / ERROR
  cls: 'exec' | 'signal' | 'skip' | 'scan' | 'err';
  sym: string;
  msg: string;
  trace?: string;
};

// TODO: wire GET /api/auto-engine/events (filtered by chip selection)
const EVENTS: EventRow[] = [
  {
    time: '12:08:42',
    label: 'EXEC',
    cls: 'exec',
    sym: 'CIFR',
    msg: 'SELL 3x CIFR240517C16.00 @ $0.82 · order OID-8811 · filled',
    trace:
      'spot 15.50 · IV 72.4 · ratio 1.45x · EV $82 · hit 61% · regime high-vol · decision: approved · all guards passed',
  },
  { time: '12:06:18', label: 'SIGNAL', cls: 'signal', sym: 'CIFR', msg: 'IV/HV 1.45 · EV $82 · approved' },
  { time: '11:54:01', label: 'EXEC', cls: 'exec', sym: 'MARA', msg: 'SELL 5x MARA240517C22.00 @ $1.20 · order OID-8810 · filled' },
  { time: '11:53:40', label: 'SIGNAL', cls: 'signal', sym: 'MARA', msg: 'IV/HV 1.51 · EV $94 · approved' },
  {
    time: '11:31:15',
    label: 'SKIP',
    cls: 'skip',
    sym: 'HOOD',
    msg: 'EV $18 < threshold $50',
    trace: 'IV 41.2 · HV 38.1 · ratio 1.08 · signal NEUTRAL · no edge',
  },
  { time: '11:29:02', label: 'SKIP', cls: 'skip', sym: 'COIN', msg: 'hit rate 49% < threshold 55%' },
  { time: '11:05:22', label: 'SCAN', cls: 'scan', sym: '—', msg: 'scan #7 · 8 tickers · 2 signals · 1 exec' },
  { time: '10:58:11', label: 'EXEC', cls: 'exec', sym: 'PYPL', msg: 'BUY 4x PYPL240607C70.00 @ $1.80 · order OID-8808 · filled' },
  { time: '10:42:03', label: 'SKIP', cls: 'skip', sym: 'GRAB', msg: 'position limit reached (4/5)' },
  { time: '10:30:22', label: 'SCAN', cls: 'scan', sym: '—', msg: 'scan #6 · 8 tickers · 1 signal · 1 exec' },
  { time: '10:05:22', label: 'SCAN', cls: 'scan', sym: '—', msg: 'scan #5 · 8 tickers · 0 signals' },
];

const FILTERS: Filter[] = ['all', 'exec', 'signal', 'skip', 'error'];

export function EventStream() {
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <div className="rv-card" style={{ padding: 0 }}>
      <div className="rv-card-head" style={{ padding: '10px 14px' }}>
        <h3>Event stream</h3>
        <div className="tools">
          {FILTERS.map((f) => (
            <span
              key={f}
              className={filter === f ? 'on' : ''}
              onClick={() => setFilter(f)}
            >
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="rv-log" style={{ maxHeight: 480, overflow: 'auto' }}>
        {EVENTS.map((e, i) => (
          <div className="row" key={`${e.time}-${i}`}>
            <span className="t">{e.time}</span>
            <span className={`ev ${e.cls}`}>{e.label}</span>
            <span className="sym">{e.sym}</span>
            <span className="msg">
              {e.msg}
              {e.trace && <div className="trace">{e.trace}</div>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
