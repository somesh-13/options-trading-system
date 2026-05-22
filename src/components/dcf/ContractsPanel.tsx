'use client';

import { CSSProperties, useCallback, useEffect, useState } from 'react';
import type {
  Contract,
  ContractExtractResult,
  ContractSource,
  ContractType,
} from '@/lib/types/contracts';
import {
  effectiveAnnualRevenueM,
  totalCapacityMW,
  totalEffectiveAnnualRevenueM,
  weightedAvgTermYears,
} from '@/lib/types/contracts';

interface Props {
  ticker: string;
  contracts: Contract[];
  onContractsChange: (next: Contract[]) => void;
  defaultRevPerMW_M: number;
}

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  hpc_hosting: 'HPC Hosting',
  hpc_lease: 'HPC Lease',
  ppa: 'PPA',
  colocation: 'Colocation',
  btc_hosting: 'BTC Hosting',
  energy_supply: 'Energy Supply',
  joint_venture: 'JV',
  other: 'Other',
};

const CONTRACT_TYPE_OPTIONS: ContractType[] = [
  'hpc_hosting',
  'hpc_lease',
  'ppa',
  'colocation',
  'btc_hosting',
  'energy_supply',
  'joint_venture',
  'other',
];

function fmtMW(mw: number | null | undefined): string {
  if (mw == null || !Number.isFinite(mw)) return '—';
  if (mw >= 1000) return `${(mw / 1000).toFixed(2)} GW`;
  return `${mw.toFixed(0)} MW`;
}

function fmtMoneyM(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}B`;
  return `$${v.toFixed(0)}M`;
}

function fmtYears(y: number | null | undefined): string {
  if (y == null || !Number.isFinite(y)) return '—';
  return `${y.toFixed(0)}y`;
}

function newManualId(): string {
  // Avoid bringing in a uuid dependency; non-cryptographic is fine here.
  return 'manual_' + Math.random().toString(36).slice(2, 10);
}

const TH_STYLE: CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.04em',
  color: 'var(--ink-mute)',
  borderBottom: '1px solid var(--line)',
  fontFamily: 'JetBrains Mono, monospace',
  textTransform: 'uppercase',
};

const TD_STYLE: CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  borderBottom: '1px solid var(--line-soft)',
  verticalAlign: 'middle',
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  background: '#0c0d10',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 3,
};

export default function ContractsPanel({ ticker, contracts, onContractsChange, defaultRevPerMW_M }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataGaps, setDataGaps] = useState<string[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasManualEdits, setHasManualEdits] = useState(false);

  // Fetch contracts on mount + ticker change. Forces a fresh extract via
  // ?force=false (the backend has its own disk cache keyed on the latest 8-K
  // accession, so subsequent calls are cheap).
  const fetchContracts = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/market/${encodeURIComponent(ticker)}/contracts${force ? '?force=true' : ''}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
      }
      const body = (await res.json()) as ContractExtractResult;
      onContractsChange(body.contracts || []);
      setDataGaps(body.data_gaps || []);
      setModel(body.model ?? null);
      setAsOf(body.as_of ?? null);
      setHasManualEdits(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [ticker, onContractsChange]);

  useEffect(() => {
    void fetchContracts(false);
  }, [fetchContracts]);

  const onRescan = useCallback(() => {
    if (hasManualEdits) {
      const ok = window.confirm(
        'Re-scanning will replace your manual edits with fresh LLM-extracted contracts. Continue?',
      );
      if (!ok) return;
    }
    void fetchContracts(true);
  }, [fetchContracts, hasManualEdits]);

  const updateContract = (id: string, patch: Partial<Contract>) => {
    onContractsChange(
      contracts.map((c) => (c.id === id ? { ...c, ...patch, confidence: 'low' } : c)),
    );
    setHasManualEdits(true);
  };

  const deleteContract = (id: string) => {
    onContractsChange(contracts.filter((c) => c.id !== id));
    setHasManualEdits(true);
    if (editingId === id) setEditingId(null);
  };

  const addContract = () => {
    const blank: Contract = {
      id: newManualId(),
      counterparty: 'New Counterparty',
      contract_type: 'hpc_hosting',
      capacity_mw: null,
      term_years: null,
      energization_date: null,
      annual_revenue_M_stated: null,
      annual_revenue_M_estimated: null,
      currency: 'USD',
      confidence: 'low',
      notes: 'Manually added',
      source: { filing_form: 'manual', title: 'User added' } as ContractSource,
    };
    onContractsChange([...contracts, blank]);
    setEditingId(blank.id);
    setHasManualEdits(true);
  };

  const totalMW = totalCapacityMW(contracts);
  const totalRev = totalEffectiveAnnualRevenueM(contracts, defaultRevPerMW_M);
  const wAvgTerm = weightedAvgTermYears(contracts);

  return (
    <div className="rv-card" style={{ padding: 0, marginTop: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          Signed Contracts
        </h3>
        <span className="text-meta" style={{ fontSize: 11 }}>
          {model ? `${model}` : 'pending'} · {asOf ? `as of ${asOf.slice(0, 16).replace('T', ' ')}` : '—'} ·{' '}
          {contracts.length} row{contracts.length === 1 ? '' : 's'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="rv-btn"
            onClick={addContract}
            disabled={loading}
            style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}
          >
            + Add contract
          </button>
          <button
            type="button"
            className="rv-btn"
            onClick={onRescan}
            disabled={loading}
            style={{ fontSize: 11, padding: '4px 10px', cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? 'Scanning…' : '⟳ Re-scan'}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: 10,
            color: 'var(--pink)',
            fontSize: 12,
            background: 'rgba(255,0,110,.06)',
            borderBottom: '1px solid rgba(255,0,110,.35)',
          }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && contracts.length === 0 && (
        <div style={{ padding: 14 }}>
          <div className="text-meta" style={{ marginBottom: 6 }}>
            No qualifying contracts found in the last 36 months. Add one manually if needed.
          </div>
          {dataGaps.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-mute)', fontSize: 11.5, lineHeight: 1.5 }}>
              {dataGaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Table */}
      {contracts.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH_STYLE}>Counterparty</th>
                <th style={TH_STYLE}>Type</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>Capacity</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>Term</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>Online</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>Stated $/yr</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>Est $/yr</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>Effective</th>
                <th style={TH_STYLE}>Source</th>
                <th style={TH_STYLE}>Conf</th>
                <th style={TH_STYLE}>&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                const editing = editingId === c.id;
                const eff = effectiveAnnualRevenueM(c, defaultRevPerMW_M);
                return (
                  <tr key={c.id}>
                    <td style={TD_STYLE}>
                      {editing ? (
                        <input
                          style={INPUT_STYLE}
                          value={c.counterparty || ''}
                          onChange={(e) => updateContract(c.id, { counterparty: e.target.value })}
                        />
                      ) : (
                        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{c.counterparty || '—'}</span>
                      )}
                    </td>
                    <td style={TD_STYLE}>
                      {editing ? (
                        <select
                          style={INPUT_STYLE}
                          value={c.contract_type}
                          onChange={(e) =>
                            updateContract(c.id, { contract_type: e.target.value as ContractType })
                          }
                        >
                          {CONTRACT_TYPE_OPTIONS.map((t) => (
                            <option key={t} value={t}>{CONTRACT_TYPE_LABELS[t]}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="rv-chip"
                          style={{ fontSize: 10, padding: '1px 6px', whiteSpace: 'nowrap' }}
                        >
                          {CONTRACT_TYPE_LABELS[c.contract_type]}
                        </span>
                      )}
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {editing ? (
                        <input
                          style={{ ...INPUT_STYLE, textAlign: 'right' }}
                          type="number"
                          step={1}
                          value={c.capacity_mw ?? ''}
                          onChange={(e) =>
                            updateContract(c.id, {
                              capacity_mw: e.target.value === '' ? null : parseFloat(e.target.value),
                            })
                          }
                        />
                      ) : (
                        fmtMW(c.capacity_mw)
                      )}
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {editing ? (
                        <input
                          style={{ ...INPUT_STYLE, textAlign: 'right' }}
                          type="number"
                          step={1}
                          value={c.term_years ?? ''}
                          onChange={(e) =>
                            updateContract(c.id, {
                              term_years: e.target.value === '' ? null : parseFloat(e.target.value),
                            })
                          }
                        />
                      ) : (
                        fmtYears(c.term_years)
                      )}
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {editing ? (
                        <input
                          style={INPUT_STYLE}
                          type="text"
                          placeholder="YYYY-MM-DD"
                          value={c.energization_date || ''}
                          onChange={(e) =>
                            updateContract(c.id, { energization_date: e.target.value || null })
                          }
                        />
                      ) : (
                        c.energization_date || '—'
                      )}
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {editing ? (
                        <input
                          style={{ ...INPUT_STYLE, textAlign: 'right' }}
                          type="number"
                          step={1}
                          value={c.annual_revenue_M_stated ?? ''}
                          onChange={(e) =>
                            updateContract(c.id, {
                              annual_revenue_M_stated: e.target.value === '' ? null : parseFloat(e.target.value),
                            })
                          }
                        />
                      ) : (
                        fmtMoneyM(c.annual_revenue_M_stated)
                      )}
                    </td>
                    <td
                      style={{
                        ...TD_STYLE,
                        textAlign: 'right',
                        fontFamily: 'JetBrains Mono, monospace',
                        color: 'var(--ink-mute)',
                      }}
                    >
                      {fmtMoneyM(c.annual_revenue_M_estimated)}
                    </td>
                    <td
                      style={{
                        ...TD_STYLE,
                        textAlign: 'right',
                        fontFamily: 'JetBrains Mono, monospace',
                        color: 'var(--gold)',
                        fontWeight: 600,
                      }}
                    >
                      {fmtMoneyM(eff)}
                    </td>
                    <td style={TD_STYLE}>
                      {c.source.url ? (
                        <a
                          href={c.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${c.source.filing_date || ''}${c.source.title ? ' — ' + c.source.title : ''}`}
                          style={{ color: 'var(--blue)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                        >
                          {c.source.filing_form || 'link'}
                        </a>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                          {c.source.filing_form || '—'}
                        </span>
                      )}
                    </td>
                    <td style={TD_STYLE}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontFamily: 'JetBrains Mono, monospace',
                          background:
                            c.confidence === 'high'
                              ? 'rgba(0,200,5,.12)'
                              : c.confidence === 'medium'
                              ? 'rgba(255,215,0,.12)'
                              : 'rgba(107,107,114,.12)',
                          color:
                            c.confidence === 'high'
                              ? 'var(--green)'
                              : c.confidence === 'medium'
                              ? 'var(--gold)'
                              : 'var(--ink-mute)',
                        }}
                      >
                        {c.confidence}
                      </span>
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        onClick={() => setEditingId(editing ? null : c.id)}
                        style={{
                          background: 'transparent',
                          border: 0,
                          color: editing ? 'var(--green)' : 'var(--ink-mute)',
                          cursor: 'pointer',
                          fontSize: 11,
                          padding: '2px 6px',
                        }}
                        title={editing ? 'Done' : 'Edit'}
                      >
                        {editing ? 'done' : 'edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteContract(c.id)}
                        style={{
                          background: 'transparent',
                          border: 0,
                          color: 'var(--pink)',
                          cursor: 'pointer',
                          fontSize: 11,
                          padding: '2px 6px',
                        }}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  style={{
                    ...TD_STYLE,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    borderTop: '1px solid var(--line)',
                    borderBottom: 'none',
                  }}
                  colSpan={2}
                >
                  Total
                </td>
                <td
                  style={{
                    ...TD_STYLE,
                    textAlign: 'right',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    borderTop: '1px solid var(--line)',
                    borderBottom: 'none',
                  }}
                >
                  {fmtMW(totalMW)}
                </td>
                <td
                  style={{
                    ...TD_STYLE,
                    textAlign: 'right',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: 'var(--ink-mute)',
                    borderTop: '1px solid var(--line)',
                    borderBottom: 'none',
                  }}
                >
                  {wAvgTerm != null ? `${wAvgTerm.toFixed(1)}y avg` : '—'}
                </td>
                <td colSpan={3} style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }} />
                <td
                  style={{
                    ...TD_STYLE,
                    textAlign: 'right',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    borderTop: '1px solid var(--line)',
                    borderBottom: 'none',
                  }}
                >
                  Σ {fmtMoneyM(totalRev)}/yr
                </td>
                <td colSpan={3} style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Data gaps note (always shown when present, including next to populated tables) */}
      {dataGaps.length > 0 && contracts.length > 0 && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)' }}>
          <div className="text-meta" style={{ marginBottom: 4 }}>DATA GAPS</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-mute)', fontSize: 11, lineHeight: 1.5 }}>
            {dataGaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
