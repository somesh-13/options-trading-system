'use client';

import { bsCallPrice } from '@/lib/stats';

interface CalendarPnLScenariosProps {
  spot: number | null;
  strike: number;
  shortPrice: number | null;
  longPrice: number | null;
  shortDte: number;
  longDte: number;
  longSigma: number;
  r: number;
}

const MOVES_PCT = [-15, -10, -5, 0, 5, 10, 15];

function fmtUsd(n: number, withSign = false): string {
  const a = Math.abs(n);
  const s = `$${a.toFixed(2)}`;
  if (withSign) return n >= 0 ? `+${s}` : `−${s}`;
  return s;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/**
 * Calendar P&L at the short-leg expiry. Short leg P&L = collected premium −
 * max(0, spot − K). Long leg residual value = BS call with back-month σ and
 * residual DTE (longDte − shortDte). Net = short P&L + (long residual − long
 * premium paid).
 */
export default function CalendarPnLScenarios({
  spot,
  strike,
  shortPrice,
  longPrice,
  shortDte,
  longDte,
  longSigma,
  r,
}: CalendarPnLScenariosProps) {
  const ready =
    spot != null && shortPrice != null && longPrice != null && longSigma > 0 && longDte > shortDte;

  const residualT = Math.max(longDte - shortDte, 1) / 365;
  const netDebitPerShare = ready ? (longPrice as number) - (shortPrice as number) : 0;
  const netDebitContract = netDebitPerShare * 100;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="rv-sub" style={{ marginBottom: 6 }}>
        Calendar P&amp;L at short-leg expiry
      </div>
      <div
        style={{
          background: '#0f0f0f',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
          }}
        >
          <thead style={{ background: '#1a1a1a' }}>
            <tr>
              {['MOVE', 'SPOT AT EXPIRY', 'SHORT P&L', 'LONG EST. VALUE', 'NET SPREAD P&L', 'RETURN %'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'right',
                    padding: '6px 10px',
                    color: '#9ca3af',
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: 0.5,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOVES_PCT.map((mv) => {
              const isAtm = mv === 0;
              const spotAtExp = ready ? (spot as number) * (1 + mv / 100) : NaN;
              const shortPnLPerShare = ready
                ? (shortPrice as number) - Math.max(0, spotAtExp - strike)
                : NaN;
              const shortPnL = shortPnLPerShare * 100;
              const longResidualPerShare = ready
                ? bsCallPrice(spotAtExp, strike, residualT, r, longSigma)
                : NaN;
              const longResidual = longResidualPerShare * 100;
              const longPnL = ready ? longResidual - (longPrice as number) * 100 : NaN;
              const netPnL = ready ? shortPnL + longPnL : NaN;
              const returnPct =
                ready && netDebitContract !== 0 ? (netPnL / Math.abs(netDebitContract)) * 100 : NaN;

              return (
                <tr
                  key={mv}
                  style={{
                    background: isAtm ? '#1e1e1e' : 'transparent',
                    borderTop: '1px solid #1a1a1a',
                  }}
                >
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      color: isAtm ? 'var(--ink)' : '#9ca3af',
                      fontWeight: isAtm ? 700 : 400,
                    }}
                  >
                    {isAtm ? 'ATM' : fmtPct(mv)}
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      color: 'var(--ink)',
                      fontWeight: isAtm ? 700 : 400,
                    }}
                  >
                    {ready ? fmtUsd(spotAtExp) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      color: ready ? (shortPnL >= 0 ? '#22c55e' : '#ef4444') : '#6b7280',
                    }}
                  >
                    {ready ? fmtUsd(shortPnL, true) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      color: '#9ca3af',
                    }}
                  >
                    {ready ? fmtUsd(longResidual) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: ready ? (netPnL >= 0 ? '#22c55e' : '#ef4444') : '#6b7280',
                    }}
                  >
                    {ready ? fmtUsd(netPnL, true) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      color: ready
                        ? Number.isFinite(returnPct)
                          ? returnPct >= 0
                            ? '#22c55e'
                            : '#ef4444'
                          : '#6b7280'
                        : '#6b7280',
                    }}
                  >
                    {ready && Number.isFinite(returnPct) ? fmtPct(returnPct) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          fontSize: 10,
          color: '#6b7280',
          fontStyle: 'italic',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 6,
        }}
      >
        Long leg estimated via Black-Scholes with back-month σ and residual DTE after front-month expiry.
      </div>
    </div>
  );
}
