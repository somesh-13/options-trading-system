import Link from 'next/link';
import { IvHvScale } from '@/components/charts/IvHvScale';
import { Sparkline } from '@/components/charts/Sparkline';
import { EvBar } from '@/components/charts/EvBar';

/**
 * Scanner opportunity table — port of the table inside `scannerAfter()`.
 *
 * TODO: wire POST /api/strategy/ev/scan ({ tickers: watchlist }) → Opportunity[].
 * For now, mock data is inline and deterministic.
 */

export type Signal = 'BUY' | 'SELL' | 'NEUTRAL';
export type Regime = 'normal' | 'high-vol' | 'crash';

export type Opportunity = {
  ticker: string;
  spot: number;
  iv: number;
  hv: number;
  ratio: number;
  signal: Signal;
  regime: Regime;
  ev: number;
  hitRate: number;
  seed: number;
};

export const SCANNER_ROWS: Opportunity[] = [
  { ticker: 'MARA', spot: 19.85,  iv: 0.922, hv: 0.610, ratio: 1.51, signal: 'SELL',    regime: 'high-vol', ev: 94, hitRate: 0.66, seed: 3 },
  { ticker: 'CIFR', spot: 15.50,  iv: 0.724, hv: 0.498, ratio: 1.45, signal: 'SELL',    regime: 'high-vol', ev: 82, hitRate: 0.61, seed: 2 },
  { ticker: 'WULF', spot:  8.22,  iv: 0.681, hv: 0.512, ratio: 1.33, signal: 'SELL',    regime: 'high-vol', ev: 64, hitRate: 0.58, seed: 4 },
  { ticker: 'PYPL', spot: 68.20,  iv: 0.281, hv: 0.352, ratio: 0.80, signal: 'BUY',     regime: 'normal',   ev: 41, hitRate: 0.55, seed: 5 },
  { ticker: 'GRAB', spot:  4.85,  iv: 0.322, hv: 0.421, ratio: 0.76, signal: 'BUY',     regime: 'normal',   ev: 28, hitRate: 0.54, seed: 6 },
  { ticker: 'RIOT', spot: 11.10,  iv: 0.711, hv: 0.918, ratio: 0.77, signal: 'BUY',     regime: 'high-vol', ev: 52, hitRate: 0.57, seed: 7 },
  { ticker: 'HOOD', spot: 21.40,  iv: 0.412, hv: 0.381, ratio: 1.08, signal: 'NEUTRAL', regime: 'normal',   ev: 18, hitRate: 0.51, seed: 8 },
  { ticker: 'COIN', spot: 182.40, iv: 0.505, hv: 0.488, ratio: 1.04, signal: 'NEUTRAL', regime: 'normal',   ev: 12, hitRate: 0.49, seed: 9 },
];

function signalChipClass(s: Signal): string {
  return s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : 'neutral';
}
function regimeChipClass(r: Regime): string {
  return r === 'high-vol' ? 'warn' : r === 'normal' ? 'buy' : 'neutral';
}
function sparkColor(s: Signal): string {
  return s === 'BUY' ? 'var(--green)' : s === 'SELL' ? 'var(--gold)' : 'var(--ink-mute)';
}

interface ScannerTableProps {
  rows?: Opportunity[];
  highlightTicker?: string;
}

export function ScannerTable({ rows = SCANNER_ROWS, highlightTicker }: ScannerTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rv-card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 12 }}>
        No tickers match this condition.
      </div>
    );
  }
  return (
    <div className="rv-card" style={{ padding: 0 }}>
      <table className="rv-table" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th></th>
            <th>Ticker</th>
            <th>Spark 30d</th>
            <th className="r">Spot</th>
            <th>IV / HV</th>
            <th className="r">Ratio ↓</th>
            <th>Signal</th>
            <th>Regime</th>
            <th style={{ minWidth: 110 }}>EV / contract</th>
            <th className="r">Hit</th>
            <th className="r">Vol</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => {
            const volK = (Math.abs(Math.sin(o.seed)) * 600) | 0;
            const selected = highlightTicker
              ? highlightTicker === o.ticker
              : i === 0;
            return (
              <tr key={o.ticker} className={selected ? 'sel' : ''}>
                <td className="r" style={{ color: 'var(--ink-mute)', fontSize: 10 }}>{i + 1}</td>
                <td>
                  <Link href={`/stock/${o.ticker}`} prefetch className="rv-ticker-link">
                    {o.ticker}
                  </Link>
                </td>
                <td style={{ width: 60 }}>
                  <Sparkline seed={o.seed} color={sparkColor(o.signal)} up={o.signal === 'BUY'} />
                </td>
                <td className="r">{o.spot.toFixed(2)}</td>
                <td><IvHvScale iv={o.iv} hv={o.hv} ratio={o.ratio} /></td>
                <td className={`r ${o.ratio > 1.3 ? 'rv-up' : o.ratio < 0.8 ? 'rv-dn' : ''}`}>
                  <b>{o.ratio.toFixed(2)}x</b>
                </td>
                <td><span className={`rv-chip ${signalChipClass(o.signal)}`}>{o.signal}</span></td>
                <td>
                  <span className={`rv-chip ${regimeChipClass(o.regime)}`} style={{ background: 'transparent' }}>
                    {o.regime}
                  </span>
                </td>
                <td style={{ minWidth: 110 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <EvBar ev={o.ev} />
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10,
                        color: o.ev >= 0 ? 'var(--green)' : 'var(--pink)',
                        minWidth: 30,
                        textAlign: 'right',
                      }}
                    >
                      <b>${o.ev}</b>
                    </span>
                  </div>
                </td>
                <td className="r">{(o.hitRate * 100).toFixed(0)}%</td>
                <td className="r" style={{ color: 'var(--ink-mute)' }}>{volK}k</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <Link
                    href={`/options-chain?ticker=${o.ticker}`}
                    className="rv-btn ghost"
                    style={{ fontSize: 10, padding: '2px 6px', textDecoration: 'none' }}
                  >
                    chain
                  </Link>
                  <span className="rv-btn ghost" style={{ fontSize: 10, padding: '2px 6px' }}>build</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
