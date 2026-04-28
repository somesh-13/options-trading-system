/**
 * Right-column order ticket — port of `chainAfter()`'s `.rv-card.rv-ticket` block.
 *
 * Static contents matching the design source. Ticket would normally be driven by
 * the selected chain row + a strategy suggestion query.
 *
 * TODO: wire selected-strike state in from the parent page once row clicks are interactive
 * TODO: wire POST /api/strategy/ev/scan to populate suggested structures
 */

export function OrderTicket() {
  return (
    <>
      <div className="rv-card-head">
        <h3>Order ticket</h3>
        <span className="rv-chip sell">SELL PREMIUM</span>
      </div>

      <div className="rv-ticket-line">
        CIFR <b>240517C16.00</b>
      </div>
      <div className="rv-ticket-line sub">Short 24-day 16 call · mid 0.82 · IV 74%</div>

      <div className="rv-ticket-row">
        <span>Side</span>
        <span>
          <b className="rv-dn">SELL</b> to open
        </span>
      </div>
      <div className="rv-ticket-row">
        <span>Qty</span>
        <span>
          <b>3</b> contracts · $4,650 max risk
        </span>
      </div>
      <div className="rv-ticket-row">
        <span>Limit</span>
        <span>
          <b>0.82</b> <span style={{ color: 'var(--ink-mute)' }}>(mid)</span>
        </span>
      </div>
      <div className="rv-ticket-row">
        <span>TIF</span>
        <span>DAY</span>
      </div>

      <div style={{ borderTop: '1px dashed var(--line)', margin: '10px 0', paddingTop: 10 }}>
        <div className="rv-ticket-row">
          <span>Max profit</span>
          <span className="rv-up">
            <b>+$246</b>
          </span>
        </div>
        <div className="rv-ticket-row">
          <span>Max loss</span>
          <span className="rv-dn">
            <b>unlimited</b> (naked)
          </span>
        </div>
        <div className="rv-ticket-row">
          <span>Breakeven</span>
          <span>$16.82</span>
        </div>
        <div className="rv-ticket-row">
          <span>POP</span>
          <span>
            <b>64%</b> (HMM-adjusted)
          </span>
        </div>
        <div className="rv-ticket-row">
          <span>EV / contract</span>
          <span className="rv-up">
            <b>+$82</b>
          </span>
        </div>
      </div>

      <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--ink-mute)',
            fontFamily: "'JetBrains Mono', monospace",
            marginBottom: 6,
          }}
        >
          Suggested structures
        </div>
        <div className="rv-alt">
          Bear call spread 16/17 · max loss $180 · <span className="rv-up">EV $58</span>
        </div>
        <div className="rv-alt">
          Iron condor 14/15/16/17 · max loss $140 · <span className="rv-up">EV $44</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <span
          className="rv-btn"
          style={{
            flex: 1,
            background: 'var(--pink)',
            color: '#000',
            textAlign: 'center',
            fontWeight: 700,
          }}
        >
          SELL 3× @ 0.82
        </span>
        <span className="rv-btn ghost">simulate</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 6, textAlign: 'center' }}>
        paper account · click to review
      </div>
    </>
  );
}
