'use client';

/**
 * Auto engine — Phase 7 of the VegaEdge UI revamp.
 *
 * Visual port of `engineAfter()` from
 *   design/stocks-revamp/project/pages/06-auto-engine.js
 *
 * Header: status chip + uptime sub + dry-run / HALT-ALL controls.
 * Body  : `<Guardrails />` (left, 320px) + `<EventStream />` (right, 1fr).
 */

import { Guardrails } from '@/components/auto/Guardrails';
import { EventStream } from '@/components/auto/EventStream';

export default function AutoEnginePage() {
  // TODO: wire GET /api/auto-engine/state — engine state, uptime, next-scan ETA.

  const handleHaltAll = () => {
    // TODO: wire POST /api/auto-engine/halt
  };

  const handleDryRun = () => {
    // TODO: wire POST /api/auto-engine/mode { dry_run: true }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <h2 className="rv-h1" style={{ margin: 0 }}>Auto engine</h2>
        <span className="rv-chip buy">
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--green)',
              marginRight: 4,
              animation: 'rv-pulse 1.5s infinite',
            }}
          />
          RUNNING
        </span>
        <span className="rv-sub" style={{ margin: 0 }}>
          started 08:00:00 · 4h 8m uptime · next scan in 2m 14s
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="rv-btn ghost"
            style={{ fontSize: 11 }}
            onClick={handleDryRun}
          >
            dry run
          </button>
          <button
            type="button"
            className="rv-btn"
            style={{
              fontSize: 11,
              background: 'var(--pink)',
              color: '#fff',
              fontWeight: 700,
            }}
            onClick={handleHaltAll}
          >
            ■ HALT ALL
          </button>
        </span>
      </div>

      <div className="rv-grid-2" style={{ gridTemplateColumns: '320px 1fr' }}>
        <Guardrails />
        <EventStream />
      </div>
    </>
  );
}
