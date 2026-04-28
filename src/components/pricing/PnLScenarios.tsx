'use client';

type PnLScenariosProps = {
  S: number;
  K: number;
  optType: 'call' | 'put';
  premium: number;
  qty?: number;
  side?: 'long' | 'short';
  premiumSource?: 'mid' | 'market';
};

const MULTIPLIERS = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15];

function payoff(spot: number, K: number, optType: 'call' | 'put') {
  return optType === 'call' ? Math.max(0, spot - K) : Math.max(0, K - spot);
}

export function PnLScenarios({
  S,
  K,
  optType,
  premium,
  qty = 1,
  side = 'long',
  premiumSource = 'mid',
}: PnLScenariosProps) {
  const isShort = side === 'short';
  const rows = MULTIPLIERS.map((m) => {
    const spotAtExpiry = S * m;
    const pay = payoff(spotAtExpiry, K, optType);
    const longNet = pay - premium;
    const netPerShare = isShort ? -longNet : longNet;
    const netPerContract = netPerShare * 100 * qty;
    const pctReturn = premium > 0 ? (netPerShare / premium) * 100 : 0;
    return { m, spotAtExpiry, pay, netPerShare, netPerContract, pctReturn };
  });

  const sourceLabel = premiumSource === 'mid' ? 'mid' : 'market';
  const sideLabel = isShort
    ? `short · premium received $${premium.toFixed(2)} (${sourceLabel})`
    : `long · premium paid $${premium.toFixed(2)} (${sourceLabel})`;

  return (
    <div className="rv-card" style={{ marginTop: 14, padding: 0 }}>
      <div className="rv-card-head" style={{ padding: '10px 14px 6px' }}>
        <h3>P&amp;L scenarios at expiry</h3>
        <span className="rv-sub" style={{ marginBottom: 0, fontSize: 10 }}>
          1 contract · {sideLabel}
        </span>
      </div>
      <table className="rv-table" style={{ fontSize: 11 }}>
        <thead>
          <tr>
            <th>Move</th>
            <th className="r">Spot at expiry</th>
            <th className="r">Payoff ($/share)</th>
            <th className="r">Net P&amp;L ($/contract)</th>
            <th className="r">Return %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const positive = r.netPerContract > 0;
            const flat = Math.abs(r.netPerContract) < 0.5;
            const cls = flat ? '' : positive ? 'rv-up' : 'rv-dn';
            return (
              <tr key={r.m}>
                <td style={{ color: 'var(--ink-mute)' }}>
                  {r.m === 1 ? 'spot' : `${((r.m - 1) * 100).toFixed(0)}%`}
                </td>
                <td className="r">${r.spotAtExpiry.toFixed(2)}</td>
                <td className="r">${r.pay.toFixed(2)}</td>
                <td className={`r ${cls}`}>
                  <b>
                    {r.netPerContract >= 0 ? '+' : ''}${r.netPerContract.toFixed(0)}
                  </b>
                </td>
                <td className={`r ${cls}`}>
                  {r.pctReturn >= 0 ? '+' : ''}
                  {r.pctReturn.toFixed(0)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
