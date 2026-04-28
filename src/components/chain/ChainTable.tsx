import type { Expiration } from './ExpirationStrip';

/**
 * Option chain table — port of `chainAfter()`'s `<table class="rv-table rv-chain">` block.
 *
 * Visual columns (verbatim from design):
 *   CALLS:  Bid · Ask · IV · Δ¹ · Γ¹ · Θ¹ · V¹
 *   Strike (centered)
 *   PUTS:   Bid · Ask · IV · Δ¹
 *   EV signal (trailing)
 *
 * Row formula matches design's `row(k)`. ATM row gets `.atm`, ITM cells `.itm`,
 * strike cell `.strike`. Mock data scales with the selected expiration's DTE
 * and ATM IV so flipping date tabs visibly changes the chain.
 *
 * TODO: wire GET /api/options/chain?ticker=…&expiration=… for the row data
 * TODO: wire POST /api/strategy/ev/scan for the EV badge column
 */

const SPOT = 15.5;
const STRIKES = [13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18];
const SELECTED_STRIKE = 16;

type Flag = 'BUY' | 'SELL' | null;

function flagFor(k: number): Flag {
  if (k === 16) return 'SELL';
  if (k === 14.5) return 'BUY';
  return null;
}

function dteDays(dte: string): number {
  return parseInt(dte, 10) || 24;
}

function ChainRow({ k, expiration }: { k: number; expiration: Expiration }) {
  const callItm = k < SPOT;
  const putItm = k > SPOT;
  const atm = Math.abs(k - SPOT) < 0.3;
  const flag = flagFor(k);
  const sel = k === SELECTED_STRIKE;

  const days = dteDays(expiration.dte);
  // sqrt(time) premium scaling, ATM-IV adjustment
  const t = Math.sqrt(days / 24);
  const ivScale = expiration.iv / 0.724;
  const premium = 1.2 * t * ivScale;
  const spread = 0.2 * ivScale;

  const callBid = (Math.max(0, SPOT - k) + premium).toFixed(2);
  const callAsk = (Math.max(0, SPOT - k) + premium + spread).toFixed(2);
  const callIv = (72 * ivScale + (15 - k) * 2).toFixed(0);
  const callDelta = (0.92 - Math.max(0, k - SPOT) * 0.3).toFixed(2);
  const callGamma = (0.08 / t - Math.abs(k - SPOT) * 0.01).toFixed(3);
  const callTheta = (0.02 / t + Math.abs(k - SPOT) * 0.003).toFixed(3);
  const callVega = (0.04 * t - Math.abs(k - SPOT) * 0.005).toFixed(3);

  const putBid = (Math.max(0, k - SPOT) + premium * 0.67).toFixed(2);
  const putAsk = (Math.max(0, k - SPOT) + premium * 0.67 + spread).toFixed(2);
  const putIv = (70 * ivScale + (k - 15) * 2).toFixed(0);
  const putDelta = (0.08 + Math.max(0, k - SPOT) * 0.3).toFixed(2);

  const rowClass = [atm ? 'atm' : '', sel ? 'sel' : ''].filter(Boolean).join(' ');

  return (
    <tr className={rowClass}>
      <td className={`r ${callItm ? 'itm' : ''}`}>{callBid}</td>
      <td className={`r ${callItm ? 'itm' : ''}`}>{callAsk}</td>
      <td className="r">{callIv}</td>
      <td className="r">{callDelta}</td>
      <td className="r">{callGamma}</td>
      <td className="r">−{callTheta}</td>
      <td className="r">{callVega}</td>
      <td className="r strike">
        <b>{k.toFixed(2)}</b>
        {atm && (
          <span
            className="rv-chip"
            style={{
              background: 'rgba(58,141,255,.15)',
              color: 'var(--blue)',
              padding: '1px 4px',
              marginLeft: 4,
              fontSize: 9,
            }}
          >
            ATM
          </span>
        )}
      </td>
      <td className={`r ${putItm ? 'itm' : ''}`}>{putBid}</td>
      <td className={`r ${putItm ? 'itm' : ''}`}>{putAsk}</td>
      <td className="r">{putIv}</td>
      <td className="r">−{putDelta}</td>
      <td>
        {flag && (
          <span className={`rv-chip ${flag === 'BUY' ? 'buy' : 'sell'}`}>
            {flag} · ${flag === 'SELL' ? 82 : 41}
          </span>
        )}
      </td>
    </tr>
  );
}

export function ChainTable({ expiration }: { expiration: Expiration }) {
  return (
    <table className="rv-table rv-chain">
      <thead>
        <tr className="head2">
          <th
            colSpan={7}
            style={{ textAlign: 'center', color: 'var(--green)', borderRight: '1px solid var(--line)' }}
          >
            CALLS
          </th>
          <th rowSpan={2} className="r" style={{ verticalAlign: 'bottom' }}>
            Strike
          </th>
          <th colSpan={5} style={{ textAlign: 'center', color: 'var(--pink)' }}>
            PUTS
          </th>
          <th rowSpan={2}>EV signal</th>
        </tr>
        <tr>
          <th className="r">Bid</th>
          <th className="r">Ask</th>
          <th className="r">IV</th>
          <th className="r">Δ¹</th>
          <th className="r">Γ¹</th>
          <th className="r">Θ¹</th>
          <th className="r" style={{ borderRight: '1px solid var(--line)' }}>
            V¹
          </th>
          <th className="r">Bid</th>
          <th className="r">Ask</th>
          <th className="r">IV</th>
          <th className="r">Δ¹</th>
        </tr>
      </thead>
      <tbody>
        {STRIKES.map((k) => (
          <ChainRow key={k} k={k} expiration={expiration} />
        ))}
      </tbody>
    </table>
  );
}
