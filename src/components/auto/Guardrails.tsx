/**
 * Guardrails card — port of the left card in `engineAfter()` from the design
 * source (design/stocks-revamp/project/pages/06-auto-engine.js).
 *
 * 4 LimitBar rows + dashed-divided "Entry conditions" + "Session stats" blocks.
 */

import { Fragment } from 'react';
import { LimitBar } from './LimitBar';

// TODO: wire GET /api/auto-engine/state — limits + session stats (mock for now)
const ENTRY_CONDITIONS: Array<[string, string]> = [
  ['min EV', '$50 ✓'],
  ['min hit rate', '55% ✓'],
  ['max σ', '1.50x'],
  ['size', '3 contracts'],
  ['regime req', 'any'],
  ['scan every', '5 min'],
];

const SESSION_STATS: Array<[string, string, string?]> = [
  ['scans', '49'],
  ['signals', '11'],
  ['executed', '7'],
  ['skipped', '4'],
  ['errors', '0'],
  ['P&L (session)', '+$428', 'rv-up'],
];

const monoGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '4px 8px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px dashed var(--line)',
  margin: '10px 0',
  paddingTop: 10,
};

export function Guardrails() {
  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Guardrails · today</h3>
      </div>
      <LimitBar label="Open positions" used={4} cap={5} />
      <LimitBar label="Daily loss" used={340} cap={1000} unit="$" />
      <LimitBar label="Trades today" used={7} cap={10} />
      <LimitBar label="Exposure" used={48200} cap={100000} unit="$" />

      <div style={dividerStyle}>
        <div className="rv-sub" style={{ marginBottom: 6 }}>
          Entry conditions
        </div>
        <div style={monoGridStyle}>
          {ENTRY_CONDITIONS.map(([k, v]) => (
            <Fragment key={k}>
              <div>{k}</div>
              <div>{v}</div>
            </Fragment>
          ))}
        </div>
      </div>

      <div style={dividerStyle}>
        <div className="rv-sub" style={{ marginBottom: 6 }}>
          Session stats
        </div>
        <div style={monoGridStyle}>
          {SESSION_STATS.map(([k, v, cls]) => (
            <Fragment key={k}>
              <div>{k}</div>
              <div className={cls}>{v}</div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
