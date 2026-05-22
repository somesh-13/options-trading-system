'use client';

/**
 * Calendar-spread roll logic configuration card.
 *
 * Reads current roll_* fields from /api/engine/status, writes via PUT
 * /api/engine/config. The actual roll evaluator (the loop that walks open
 * positions and triggers rolls when conditions are met) is still future
 * work — these fields persist so that when it lands the user's preferences
 * are already on the engine.
 */

import { useCallback, useEffect, useState } from 'react';

type RollTo = 'nearest-weekly' | '+7d' | '+14d';
type RollStrike = 'same' | 'atm-at-roll';

type StatusResponse = {
  config?: {
    roll_enabled?: boolean;
    roll_trigger_dte?: number;
    roll_requires_iv_hv?: boolean;
    roll_to?: RollTo;
    roll_strike?: RollStrike;
  };
};

const POLL_MS = 30_000;

export function RollLogic() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [triggerDte, setTriggerDte] = useState<number>(1);
  const [requiresIvHv, setRequiresIvHv] = useState<boolean>(true);
  const [rollTo, setRollTo] = useState<RollTo>('nearest-weekly');
  const [rollStrike, setRollStrike] = useState<RollStrike>('same');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    try {
      const res = await fetch('/api/engine/status', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as StatusResponse;
      const c = body.config ?? {};
      if (typeof c.roll_enabled === 'boolean') setEnabled(c.roll_enabled);
      if (typeof c.roll_trigger_dte === 'number') setTriggerDte(c.roll_trigger_dte);
      if (typeof c.roll_requires_iv_hv === 'boolean') setRequiresIvHv(c.roll_requires_iv_hv);
      if (c.roll_to) setRollTo(c.roll_to);
      if (c.roll_strike) setRollStrike(c.roll_strike);
    } catch {
      // Soft-fail — keep current local values.
    }
  }, []);

  useEffect(() => {
    hydrate();
    const id = setInterval(hydrate, POLL_MS);
    return () => clearInterval(id);
  }, [hydrate]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/engine/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll_enabled: enabled,
          roll_trigger_dte: triggerDte,
          roll_requires_iv_hv: requiresIvHv,
          roll_to: rollTo,
          roll_strike: rollStrike,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `save failed (${res.status})`);
      }
      setSaveMsg('saved');
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [enabled, triggerDte, requiresIvHv, rollTo, rollStrike]);

  const dim = !enabled;

  return (
    <div className="rv-card" style={{ marginTop: 10 }}>
      <div className="rv-card-head">
        <h3>Roll logic · calendar spreads</h3>
        <span className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
          short-leg roll trigger
        </span>
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          marginBottom: 12,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span style={{ fontWeight: 600, color: enabled ? 'var(--ink)' : 'var(--ink-mute)' }}>
          Auto-roll enabled
        </span>
      </label>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px 12px',
          opacity: dim ? 0.55 : 1,
          pointerEvents: dim ? 'none' : 'auto',
          transition: 'opacity .12s',
        }}
      >
        <div>
          <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
            Trigger · short DTE ≤
          </div>
          <input
            type="number"
            value={triggerDte}
            min={0}
            max={14}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) setTriggerDte(Math.max(0, Math.min(14, v)));
            }}
            style={{
              width: '100%',
              background: '#0c0d10',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
              padding: '4px 6px',
              borderRadius: 3,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              marginTop: 2,
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: 'var(--ink-mute)',
              marginTop: 14,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={requiresIvHv}
              onChange={(e) => setRequiresIvHv(e.target.checked)}
            />
            Re-check IV/HV before rolling
          </label>
        </div>

        <div>
          <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
            Roll short to
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {(['nearest-weekly', '+7d', '+14d'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setRollTo(opt)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  background: rollTo === opt ? 'rgba(34,211,238,.15)' : '#181818',
                  color: rollTo === opt ? '#22D3EE' : 'var(--ink-mute)',
                  border: '1px solid ' + (rollTo === opt ? 'rgba(34,211,238,.3)' : 'var(--line)'),
                  cursor: 'pointer',
                }}
              >
                {opt === 'nearest-weekly' ? 'nearest weekly' : opt}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="rv-sub" style={{ margin: 0, fontSize: 10 }}>
            Roll strike
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {(['same', 'atm-at-roll'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setRollStrike(opt)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  background: rollStrike === opt ? 'rgba(34,211,238,.15)' : '#181818',
                  color: rollStrike === opt ? '#22D3EE' : 'var(--ink-mute)',
                  border: '1px solid ' + (rollStrike === opt ? 'rgba(34,211,238,.3)' : 'var(--line)'),
                  cursor: 'pointer',
                }}
              >
                {opt === 'same' ? 'same strike' : 'ATM at roll'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rv-btn"
          style={{ fontSize: 11 }}
        >
          {saving ? 'saving…' : 'save roll config'}
        </button>
        {saveMsg && (
          <span style={{ color: 'var(--green)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
            {saveMsg}
          </span>
        )}
        {error && (
          <span style={{ color: 'var(--pink)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
