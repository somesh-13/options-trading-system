/**
 * Open positions table — full-width grid with per-position Greek contribution.
 *
 * Direct port of design line 141-166 in
 * `design/stocks-revamp/project/pages/05-portfolio.js`.
 *
 * TODO: wire GET /api/portfolio (positions[] with per-leg Greeks).
 */
type Position = {
  name: string;
  structure: string;
  qty: number;       // signed: negative = short
  entry: number;
  mark: number;
  pnl: number;       // dollars
  delta: number;     // contribution
  gamma: number;     // contribution (1 decimal)
  theta: number;     // contribution
  vega: number;      // contribution
};

const POSITIONS: Position[] = [
  { name: 'CIFR 240517C16', structure: 'short call', qty: -3, entry: 0.82, mark: 0.86, pnl:  48, delta: -123, gamma: -2.3, theta:  18, vega:  -6 },
  { name: 'MARA 240517C22', structure: 'short call', qty: -5, entry: 1.20, mark: 1.16, pnl: 210, delta: -180, gamma: -3.1, theta:  32, vega: -12 },
  { name: 'PYPL 240607C70', structure: 'long call',  qty:  4, entry: 1.80, mark: 1.60, pnl: -82, delta:  164, gamma:  4.8, theta: -14, vega:  28 },
  { name: 'RIOT 240503P10', structure: 'long put',   qty:  2, entry: 0.55, mark: 0.62, pnl:  34, delta:  -88, gamma: -2.4, theta:  -8, vega:  12 },
];

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `\u2212${Math.abs(n)}`;
  return '0';
}

function signedFixed1(n: number): string {
  if (n > 0) return `+${n.toFixed(1)}`;
  if (n < 0) return `\u2212${Math.abs(n).toFixed(1)}`;
  return '0.0';
}

function pnlStr(pnl: number): string {
  if (pnl > 0) return `+$${pnl}`;
  if (pnl < 0) return `\u2212$${Math.abs(pnl)}`;
  return '$0';
}

export function PositionsTable() {
  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <h3>Open positions — with Greek contribution</h3>
        <div className="tools">
          <span className="on">4 open</span>
          <span>23 closed</span>
        </div>
      </div>
      <table className="rv-table" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th>Position</th>
            <th>Structure</th>
            <th className="r">Qty</th>
            <th className="r">Entry</th>
            <th className="r">Mark</th>
            <th className="r">P&amp;L</th>
            <th className="r">Δ contrib</th>
            <th className="r">Γ contrib</th>
            <th className="r">Θ contrib</th>
            <th className="r">V contrib</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {POSITIONS.map((p) => (
            <tr key={p.name}>
              <td><b>{p.name}</b></td>
              <td>
                <span className={`rv-chip ${p.qty < 0 ? 'sell' : 'buy'}`}>
                  {p.structure}
                </span>
              </td>
              <td className="r">{signed(p.qty)}</td>
              <td className="r">{p.entry.toFixed(2)}</td>
              <td className="r">{p.mark.toFixed(2)}</td>
              <td className={`r ${p.pnl > 0 ? 'rv-up' : 'rv-dn'}`}>
                <b>{pnlStr(p.pnl)}</b>
              </td>
              <td className="r">{signed(p.delta)}</td>
              <td className="r">{signedFixed1(p.gamma)}</td>
              <td className="r">{signed(p.theta)}</td>
              <td className="r">{signed(p.vega)}</td>
              <td>
                <span
                  className="rv-btn ghost"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  close
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PositionsTable;
