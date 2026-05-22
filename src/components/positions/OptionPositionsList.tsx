'use client';

import { useMemo } from 'react';
import type { PositionWithGreeks } from '@/lib/pricing-api';
import { formatOCCReadable, parseOCC } from '@/lib/utils';
import { thetaVegaRatioColor } from '@/lib/calendar';

interface OptionPositionsListProps {
  positions: PositionWithGreeks[];
}

// Greeks may include charm if the backend supplies it. The type definition
// in pricing-api.ts only lists the 5 first-order Greeks, so we read charm
// defensively as an optional numeric field.
type GreeksWithCharm = PositionWithGreeks['greeks'] & { charm?: number };

interface ParsedLeg extends PositionWithGreeks {
  underlying: string;
  expDate: string;
  optType: 'Call' | 'Put';
  strike: number;
  signedQty: number;
}

interface CalendarSpread {
  kind: 'spread';
  underlying: string;
  optType: 'Call' | 'Put';
  strike: number;
  shortLeg: ParsedLeg;
  longLeg: ParsedLeg;
  netDelta: number;
  netGamma: number;
  netVega: number;
  netTheta: number;
  netRho: number;
  netCharm: number | null;
  thetaOverVega: number;
  netPnl: number;
}

interface SoloLeg {
  kind: 'solo';
  leg: ParsedLeg;
}

type Row = CalendarSpread | SoloLeg;

const RATIO_COLOR_CSS: Record<'green' | 'gold' | 'mute', string> = {
  green: '#22c55e',
  gold: '#fbbf24',
  mute: '#9ca3af',
};

function safeRatio(theta: number, vega: number): number {
  if (!Number.isFinite(theta) || !Number.isFinite(vega) || vega === 0) return NaN;
  return Math.abs(theta) / Math.abs(vega);
}

function fmtRatio(r: number): string {
  return Number.isFinite(r) ? r.toFixed(3) : '—';
}

/**
 * Group option positions into calendar spreads. A pair is a calendar when
 * legs share (underlying, type, strike), have opposite signed-qty signs,
 * and have different expiries. Anything left over renders as a solo leg.
 */
function groupIntoSpreads(legs: ParsedLeg[]): Row[] {
  const rows: Row[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < legs.length; i++) {
    if (consumed.has(i)) continue;
    const a = legs[i];
    let pair: ParsedLeg | null = null;
    let pairIdx = -1;
    for (let j = i + 1; j < legs.length; j++) {
      if (consumed.has(j)) continue;
      const b = legs[j];
      if (
        a.underlying === b.underlying &&
        a.optType === b.optType &&
        a.strike === b.strike &&
        a.expDate !== b.expDate &&
        Math.sign(a.signedQty) !== Math.sign(b.signedQty)
      ) {
        pair = b;
        pairIdx = j;
        break;
      }
    }
    if (pair) {
      consumed.add(i);
      consumed.add(pairIdx);
      const shortLeg = a.signedQty < 0 ? a : pair;
      const longLeg = a.signedQty < 0 ? pair : a;
      const sg = shortLeg.greeks as GreeksWithCharm;
      const lg = longLeg.greeks as GreeksWithCharm;
      // Net = long − short. Greeks are per-contract; multiply by signed qty
      // and a sign factor if we want full position deltas, but trader convention
      // for spread analysis is the unit-contract net so traders can read off
      // "edge per spread" without scaling by size.
      const netDelta = lg.delta - sg.delta;
      const netGamma = lg.gamma - sg.gamma;
      const netVega = lg.vega - sg.vega;
      const netTheta = lg.theta - sg.theta;
      const netRho = lg.rho - sg.rho;
      const netCharm =
        typeof lg.charm === 'number' && typeof sg.charm === 'number'
          ? lg.charm - sg.charm
          : null;
      const thetaOverVega = safeRatio(netTheta, netVega);
      const netPnl =
        parseFloat(shortLeg.unrealized_pl || '0') + parseFloat(longLeg.unrealized_pl || '0');
      rows.push({
        kind: 'spread',
        underlying: a.underlying,
        optType: a.optType,
        strike: a.strike,
        shortLeg,
        longLeg,
        netDelta,
        netGamma,
        netVega,
        netTheta,
        netRho,
        netCharm,
        thetaOverVega,
        netPnl,
      });
    } else {
      consumed.add(i);
      rows.push({ kind: 'solo', leg: a });
    }
  }
  return rows;
}

function formatExpDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

function ThetaVegaBadge({ ratio }: { ratio: number }) {
  if (!Number.isFinite(ratio)) {
    return <span style={{ color: '#9ca3af' }}>—</span>;
  }
  const bucket = thetaVegaRatioColor(ratio);
  return (
    <span style={{ color: RATIO_COLOR_CSS[bucket], fontWeight: 600 }}>
      {ratio.toFixed(3)}
    </span>
  );
}

function LegRow({ pos }: { pos: ParsedLeg }) {
  const pnl = parseFloat(pos.unrealized_pl || '0');
  const pnlPct = parseFloat(pos.unrealized_plpc || '0') * 100;
  const isPositive = pnl >= 0;
  const tvRatio = safeRatio(pos.greeks.theta, pos.greeks.vega);

  return (
    <div className="bg-[#1E1E1E] rounded-lg p-4 border border-gray-700/50">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-bold text-[#FFD700]">{formatOCCReadable(pos.symbol)}</p>
          <p className="text-xs text-gray-500">{pos.symbol}</p>
        </div>
        <div className="text-right">
          <p className={`font-bold ${isPositive ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
            {isPositive ? '+' : ''}${pnl.toFixed(2)}
          </p>
          <p className={`text-xs ${isPositive ? 'text-[#00C805]' : 'text-[#FF006E]'}`}>
            {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
          </p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-gray-500">Qty</span>
          <span className="ml-2 text-white">{pos.qty}</span>
        </div>
        <div>
          <span className="text-gray-500">Entry</span>
          <span className="ml-2 text-white">${parseFloat(pos.avg_entry_price || '0').toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-500">Current</span>
          <span className="ml-2 text-white">${parseFloat(pos.current_price || '0').toFixed(2)}</span>
        </div>
        <div>
          <span className="text-gray-500">Value</span>
          <span className="ml-2 text-white">${parseFloat(pos.market_value || '0').toFixed(2)}</span>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-2 mt-2 text-xs">
        <div><span className="text-gray-500">Delta</span> <span className="text-white">{pos.greeks.delta.toFixed(2)}</span></div>
        <div><span className="text-gray-500">Gamma</span> <span className="text-white">{pos.greeks.gamma.toFixed(4)}</span></div>
        <div><span className="text-gray-500">Vega</span> <span className="text-white">{pos.greeks.vega.toFixed(2)}</span></div>
        <div><span className="text-gray-500">Theta</span> <span className="text-white">{pos.greeks.theta.toFixed(2)}</span></div>
        <div><span className="text-gray-500">Rho</span> <span className="text-white">{pos.greeks.rho.toFixed(4)}</span></div>
        <div title="|Θ| / |V| · time-decay edge vs vol exposure">
          <span className="text-gray-500">Θ/V</span>{' '}
          <ThetaVegaBadge ratio={tvRatio} />
        </div>
      </div>
    </div>
  );
}

function SpreadRow({ spread }: { spread: CalendarSpread }) {
  const tvBucket = thetaVegaRatioColor(spread.thetaOverVega);
  const netPositive = spread.netPnl >= 0;

  return (
    <div
      className="rounded-lg p-4 border"
      style={{
        background: '#181818',
        borderColor: 'rgba(34,211,238,.35)',
        boxShadow: '0 0 0 1px rgba(34,211,238,.05) inset',
      }}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <div
            style={{
              display: 'inline-flex',
              gap: 6,
              alignItems: 'center',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: '#22D3EE',
              background: 'rgba(34,211,238,.10)',
              border: '1px solid rgba(34,211,238,.35)',
              borderRadius: 999,
              padding: '2px 10px',
              textTransform: 'uppercase',
              letterSpacing: 1,
              fontWeight: 600,
            }}
          >
            {spread.optType === 'Call' ? 'CALL' : 'PUT'} CALENDAR SPREAD
          </div>
          <div style={{ marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: '#FFD700', fontWeight: 700 }}>
            {spread.underlying} ${spread.strike.toFixed(2)} {spread.optType}
          </div>
        </div>
        <div className="text-right">
          <p
            className={`font-bold ${netPositive ? 'text-[#00C805]' : 'text-[#FF006E]'}`}
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {netPositive ? '+' : ''}${spread.netPnl.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500">net P&L</p>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-3 mb-3"
        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
      >
        <div
          style={{
            background: '#0c0d10',
            border: '1px solid #2a2a2a',
            borderLeft: '2px solid #ef4444',
            borderRadius: 6,
            padding: 8,
          }}
        >
          <div style={{ color: '#ef4444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
            SHORT (front)
          </div>
          <div style={{ color: '#9ca3af', marginTop: 2 }}>
            {formatExpDate(spread.shortLeg.expDate)} · {spread.shortLeg.qty}× @ ${parseFloat(spread.shortLeg.avg_entry_price || '0').toFixed(2)}
          </div>
        </div>
        <div
          style={{
            background: '#0c0d10',
            border: '1px solid #2a2a2a',
            borderLeft: '2px solid #22c55e',
            borderRadius: 6,
            padding: 8,
          }}
        >
          <div style={{ color: '#22c55e', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
            LONG (back)
          </div>
          <div style={{ color: '#9ca3af', marginTop: 2 }}>
            {formatExpDate(spread.longLeg.expDate)} · {spread.longLeg.qty}× @ ${parseFloat(spread.longLeg.avg_entry_price || '0').toFixed(2)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <div>
          <span className="text-gray-500">Net Δ</span>{' '}
          <span className="text-white">{spread.netDelta.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-gray-500">Net Γ</span>{' '}
          <span className="text-white">{spread.netGamma.toFixed(4)}</span>
        </div>
        <div>
          <span className="text-gray-500">Net V</span>{' '}
          <span className="text-white">{spread.netVega.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-gray-500">Net Θ</span>{' '}
          <span style={{ color: spread.netTheta >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
            {spread.netTheta >= 0 ? '+' : ''}{spread.netTheta.toFixed(3)}
          </span>
        </div>
        <div
          title="|Net Θ| / |Net V| · time-decay edge vs vol exposure"
          style={{
            background: 'rgba(255,215,0,.05)',
            border: '1px solid rgba(255,215,0,.30)',
            borderRadius: 4,
            padding: '0 6px',
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <span className="text-gray-500">Θ/V</span>{' '}
          <span style={{ color: RATIO_COLOR_CSS[tvBucket], fontWeight: 700 }}>
            {fmtRatio(spread.thetaOverVega)}
          </span>
        </div>
        <div title="∂Δ/∂t · how spread delta migrates with time. Available when the backend reports charm.">
          <span className="text-gray-500">Net Charm</span>{' '}
          <span className="text-white">
            {spread.netCharm == null ? '—' : spread.netCharm.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function OptionPositionsList({ positions }: OptionPositionsListProps) {
  const rows = useMemo<Row[]>(() => {
    const optionPositions = positions.filter((p) => p.position_type === 'option');
    const parsed: ParsedLeg[] = [];
    for (const p of optionPositions) {
      const occ = parseOCC(p.symbol);
      const qtyNum = parseFloat(p.qty || '0');
      if (!occ) continue;
      parsed.push({
        ...p,
        underlying: occ.underlying,
        expDate: occ.expDate,
        optType: occ.type as 'Call' | 'Put',
        strike: occ.strike,
        signedQty: qtyNum,
      });
    }
    return groupIntoSpreads(parsed);
  }, [positions]);

  const totalOptionPositions = positions.filter((p) => p.position_type === 'option').length;

  if (totalOptionPositions === 0) {
    return (
      <div className="bg-[#2D2D2D] rounded-lg p-6">
        <h3 className="text-lg font-bold mb-2">Options Positions</h3>
        <p className="text-gray-500">No open options positions</p>
      </div>
    );
  }

  const spreadCount = rows.filter((r) => r.kind === 'spread').length;
  const soloCount = rows.filter((r) => r.kind === 'solo').length;

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">
        Options Positions ({totalOptionPositions})
        {spreadCount > 0 && (
          <span className="ml-3 text-xs font-normal text-gray-400">
            · {spreadCount} calendar spread{spreadCount > 1 ? 's' : ''}
            {soloCount > 0 && ` · ${soloCount} solo leg${soloCount > 1 ? 's' : ''}`}
          </span>
        )}
      </h3>
      <div className="space-y-3">
        {rows.map((row, i) =>
          row.kind === 'spread' ? (
            <SpreadRow key={`spread-${i}`} spread={row} />
          ) : (
            <LegRow key={`leg-${row.leg.symbol}`} pos={row.leg} />
          ),
        )}
      </div>
    </div>
  );
}
