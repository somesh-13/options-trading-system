'use client';

/**
 * Event stream card — port of the right card in `engineAfter()` from the
 * design source (design/stocks-revamp/project/pages/06-auto-engine.js).
 *
 * Wired to GET /api/engine/logs (proxied to FastAPI). Polls every 5s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

type Filter = 'all' | 'exec' | 'signal' | 'skip' | 'error';

type EventRow = {
  time: string;
  label: string;
  cls: 'exec' | 'signal' | 'skip' | 'scan' | 'err';
  sym: string;
  msg: string;
  trace?: string;
};

type RawLog = {
  id: number;
  timestamp: string;
  event_type: string;
  ticker: string | null;
  details: Record<string, unknown> | null;
  trade_id: string | null;
};

const FILTERS: Filter[] = ['all', 'exec', 'signal', 'skip', 'error'];
const POLL_MS = 5000;

function eventTypeForFilter(f: Filter): string | null {
  if (f === 'all') return null;
  if (f === 'exec') return 'execute';
  return f;
}

function clsFor(eventType: string): EventRow['cls'] {
  switch (eventType) {
    case 'execute': return 'exec';
    case 'skip': return 'skip';
    case 'scan': return 'scan';
    case 'error': return 'err';
    case 'signal': return 'signal';
    default: return 'scan';
  }
}

function labelFor(eventType: string): string {
  if (eventType === 'execute') return 'EXEC';
  return eventType.toUpperCase();
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return iso.slice(11, 19);
  }
}

function summarize(row: RawLog): { msg: string; trace?: string } {
  const d = row.details ?? {};
  const t = row.event_type;

  if (t === 'execute') {
    const side = String(d.side ?? '').toUpperCase();
    const qty = d.qty ?? '?';
    const occ = d.occ_symbol ?? '?';
    const px = d.limit_price ?? '?';
    const orderResult = d.order_result as { error?: string; detail?: string; id?: string } | undefined;
    const dryRun = d.dry_run === true;
    let status = '';
    if (dryRun) status = 'dry-run';
    else if (orderResult?.error) status = `REJECTED: ${orderResult.error}`;
    else if (orderResult?.id) status = `order ${orderResult.id}`;
    else status = 'submitted';
    const msg = `${side} ${qty}x ${occ} @ $${px} · ${status}`;

    const sig = d.signal_data as Record<string, unknown> | undefined;
    const traceParts: string[] = [];
    if (sig) {
      if (sig.iv_hv_ratio != null) traceParts.push(`IV/HV ${Number(sig.iv_hv_ratio).toFixed(2)}`);
      if (sig.ev_per_contract != null) traceParts.push(`EV $${Number(sig.ev_per_contract).toFixed(2)}`);
      if (sig.spot_price != null) traceParts.push(`spot ${Number(sig.spot_price).toFixed(2)}`);
      if (sig.implied_vol_atm != null) traceParts.push(`IV ${(Number(sig.implied_vol_atm) * 100).toFixed(1)}`);
      if (sig.signal != null) traceParts.push(`signal ${sig.signal}`);
    }
    if (orderResult?.detail) traceParts.push(`detail: ${orderResult.detail}`);
    return { msg, trace: traceParts.length ? traceParts.join(' · ') : undefined };
  }

  if (t === 'skip') {
    const reason = d.reason ?? 'unknown';
    const extras: string[] = [];
    if (d.strike != null) extras.push(`strike ${d.strike}`);
    if (d.expiration) extras.push(`exp ${d.expiration}`);
    return {
      msg: `skip · ${reason}`,
      trace: extras.length ? extras.join(' · ') : undefined,
    };
  }

  if (t === 'scan') return { msg: `scan ${row.ticker ?? ''}` };
  if (t === 'start') return { msg: 'engine started' };
  if (t === 'stop') return { msg: 'engine stopped' };
  if (t === 'config_update') return { msg: 'config updated', trace: JSON.stringify(d) };
  if (t === 'error') {
    return {
      msg: typeof d.error === 'string' ? d.error : 'engine error',
      trace: typeof d.traceback === 'string' ? (d.traceback as string).slice(0, 400) : undefined,
    };
  }
  return { msg: t };
}

function toEventRow(row: RawLog): EventRow {
  const { msg, trace } = summarize(row);
  return {
    time: fmtTime(row.timestamp),
    label: labelFor(row.event_type),
    cls: clsFor(row.event_type),
    sym: row.ticker ?? '—',
    msg,
    trace,
  };
}

export function EventStream() {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f: Filter) => {
    const qs = new URLSearchParams({ limit: '100' });
    const eventType = eventTypeForFilter(f);
    if (eventType) qs.set('event_type', eventType);
    try {
      const res = await fetch(`/api/engine/logs?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(`logs ${res.status}`);
        return;
      }
      const body: { logs?: RawLog[] } = await res.json();
      setRows((body.logs ?? []).map(toEventRow));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
    const id = setInterval(() => load(filter), POLL_MS);
    return () => clearInterval(id);
  }, [filter, load]);

  const visible = useMemo(() => rows, [rows]);

  return (
    <div className="rv-card" style={{ padding: 0 }}>
      <div className="rv-card-head" style={{ padding: '10px 14px' }}>
        <h3>Event stream</h3>
        <div className="tools">
          {FILTERS.map((f) => (
            <span
              key={f}
              role="button"
              tabIndex={0}
              className={filter === f ? 'on' : ''}
              onClick={() => setFilter(f)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') setFilter(f);
              }}
              style={{ cursor: 'pointer' }}
            >
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="rv-log" style={{ maxHeight: 480, overflow: 'auto' }}>
        {error ? (
          <div className="row" style={{ color: 'var(--pink)', fontSize: 12, padding: 14 }}>
            <span className="msg">error: {error}</span>
          </div>
        ) : loading ? (
          <div className="row" style={{ color: 'var(--ink-mute)', fontSize: 12, padding: 14 }}>
            <span className="msg">loading…</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="row" style={{ color: 'var(--ink-mute)', fontSize: 12, padding: 14 }}>
            <span className="msg">no events match this filter</span>
          </div>
        ) : (
          visible.map((e, i) => (
            <div className="row" key={`${e.time}-${i}`}>
              <span className="t">{e.time}</span>
              <span className={`ev ${e.cls}`}>{e.label}</span>
              <span className="sym">{e.sym}</span>
              <span className="msg">
                {e.msg}
                {e.trace && <div className="trace">{e.trace}</div>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
