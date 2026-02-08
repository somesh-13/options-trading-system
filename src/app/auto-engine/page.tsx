'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import Link from 'next/link';
import {
  startEngine,
  stopEngine,
  getEngineStatus,
  updateEngineConfig,
  getEngineLogs,
  type EngineStatus,
  type EngineLogEntry,
} from '@/lib/pricing-api';

const STATE_COLORS: Record<string, string> = {
  STOPPED: 'bg-gray-600',
  IDLE: 'bg-[#00C805]',
  SCANNING: 'bg-[#FFD700]',
  EVALUATING: 'bg-[#FFD700]',
  EXECUTING: 'bg-[#FF006E]',
};

const STATE_TEXT_COLORS: Record<string, string> = {
  STOPPED: 'text-gray-400',
  IDLE: 'text-[#00C805]',
  SCANNING: 'text-[#FFD700]',
  EVALUATING: 'text-[#FFD700]',
  EXECUTING: 'text-[#FF006E]',
};

const EVENT_COLORS: Record<string, string> = {
  start: 'text-[#00C805]',
  stop: 'text-gray-400',
  scan: 'text-[#FFD700]',
  signal: 'text-[#FFD700]',
  execute: 'text-[#FF006E]',
  skip: 'text-gray-500',
  error: 'text-[#FF006E]',
  config_update: 'text-blue-400',
};

export default function AutoEnginePage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [logs, setLogs] = useState<EngineLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Config form state
  const [configForm, setConfigForm] = useState({
    scan_interval_seconds: 300,
    iv_hv_sell_threshold: 1.3,
    iv_hv_buy_threshold: 0.8,
    min_ev_per_contract: 50,
    max_contracts_per_trade: 5,
    max_total_contracts: 20,
    max_daily_trades: 10,
    max_daily_loss: 1000,
    dry_run: false,
  });

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        getEngineStatus(),
        getEngineLogs({ limit: 50 }),
      ]);
      setStatus(statusRes);
      setLogs(logsRes.logs);

      // Sync config form with server config
      if (statusRes.config) {
        const c = statusRes.config;
        setConfigForm((prev) => ({
          scan_interval_seconds: (c.scan_interval_seconds as number) ?? prev.scan_interval_seconds,
          iv_hv_sell_threshold: (c.iv_hv_sell_threshold as number) ?? prev.iv_hv_sell_threshold,
          iv_hv_buy_threshold: (c.iv_hv_buy_threshold as number) ?? prev.iv_hv_buy_threshold,
          min_ev_per_contract: (c.min_ev_per_contract as number) ?? prev.min_ev_per_contract,
          max_contracts_per_trade: (c.max_contracts_per_trade as number) ?? prev.max_contracts_per_trade,
          max_total_contracts: (c.max_total_contracts as number) ?? prev.max_total_contracts,
          max_daily_trades: (c.max_daily_trades as number) ?? prev.max_daily_trades,
          max_daily_loss: (c.max_daily_loss as number) ?? prev.max_daily_loss,
          dry_run: (c.dry_run as boolean) ?? prev.dry_run,
        }));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch engine status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh when running
  useEffect(() => {
    const isRunning = status?.state && status.state !== 'STOPPED';
    if (isRunning) {
      intervalRef.current = setInterval(fetchStatus, 5000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status?.state, fetchStatus]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await startEngine();
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await stopEngine();
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stop failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfigUpdate = async () => {
    try {
      await updateEngineConfig(configForm);
      await fetchStatus();
      setShowConfig(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Config update failed');
    }
  };

  const state = status?.state || 'STOPPED';
  const stats = status?.stats;
  const isRunning = state !== 'STOPPED';

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">&larr; Dashboard</Link>
            <h1 className="text-3xl font-bold">Auto Engine</h1>
            <p className="text-gray-400 text-sm mt-1">Automated mispricing detection and execution for CIFR</p>
          </div>
          <span className="px-3 py-1 bg-[#FFD700]/20 text-[#FFD700] text-xs font-bold rounded">PAPER</span>
        </header>

        {error && (
          <div className="mb-4 p-3 bg-[#FF006E]/20 border border-[#FF006E]/40 rounded-lg text-sm text-[#FF006E]">
            {error}
          </div>
        )}

        {/* Status Banner */}
        <div className="mb-6 bg-[#2D2D2D] rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-5 h-5 rounded-full ${STATE_COLORS[state] || 'bg-gray-600'} ${
                isRunning ? 'animate-pulse' : ''
              }`} />
              <div>
                <p className={`text-2xl font-bold ${STATE_TEXT_COLORS[state] || 'text-gray-400'}`}>
                  {state}
                </p>
                <p className="text-xs text-gray-500">
                  {isRunning && stats?.started_at
                    ? `Running since ${new Date(stats.started_at).toLocaleString()}`
                    : stats?.stopped_at
                    ? `Stopped at ${new Date(stats.stopped_at).toLocaleString()}`
                    : 'Engine not started'}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfig(!showConfig)}
                className="px-4 py-2 bg-[#1E1E1E] hover:bg-[#333333] rounded-lg text-sm transition-colors"
              >
                {showConfig ? 'Hide Config' : 'Config'}
              </button>
              {isRunning ? (
                <button
                  onClick={handleStop}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-[#FF006E] hover:bg-[#FF006E]/80 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Stopping...' : 'Stop Engine'}
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Starting...' : 'Start Engine'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Config Panel */}
        {showConfig && (
          <div className="mb-6 bg-[#2D2D2D] rounded-lg p-6">
            <h2 className="font-bold text-sm uppercase text-gray-400 mb-4">Engine Configuration</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Scan Interval (sec)</label>
                <input
                  type="number"
                  value={configForm.scan_interval_seconds}
                  onChange={(e) => setConfigForm({ ...configForm, scan_interval_seconds: parseInt(e.target.value) || 300 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">IV/HV Sell Threshold</label>
                <input
                  type="number"
                  step="0.1"
                  value={configForm.iv_hv_sell_threshold}
                  onChange={(e) => setConfigForm({ ...configForm, iv_hv_sell_threshold: parseFloat(e.target.value) || 1.3 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">IV/HV Buy Threshold</label>
                <input
                  type="number"
                  step="0.1"
                  value={configForm.iv_hv_buy_threshold}
                  onChange={(e) => setConfigForm({ ...configForm, iv_hv_buy_threshold: parseFloat(e.target.value) || 0.8 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Min EV/Contract ($)</label>
                <input
                  type="number"
                  value={configForm.min_ev_per_contract}
                  onChange={(e) => setConfigForm({ ...configForm, min_ev_per_contract: parseFloat(e.target.value) || 50 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Contracts/Trade</label>
                <input
                  type="number"
                  value={configForm.max_contracts_per_trade}
                  onChange={(e) => setConfigForm({ ...configForm, max_contracts_per_trade: parseInt(e.target.value) || 5 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Total Contracts</label>
                <input
                  type="number"
                  value={configForm.max_total_contracts}
                  onChange={(e) => setConfigForm({ ...configForm, max_total_contracts: parseInt(e.target.value) || 20 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Daily Trades</label>
                <input
                  type="number"
                  value={configForm.max_daily_trades}
                  onChange={(e) => setConfigForm({ ...configForm, max_daily_trades: parseInt(e.target.value) || 10 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Daily Loss ($)</label>
                <input
                  type="number"
                  value={configForm.max_daily_loss}
                  onChange={(e) => setConfigForm({ ...configForm, max_daily_loss: parseFloat(e.target.value) || 1000 })}
                  className="w-full bg-[#1E1E1E] text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#00C805]"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={configForm.dry_run}
                  onChange={(e) => setConfigForm({ ...configForm, dry_run: e.target.checked })}
                  className="accent-[#FFD700]"
                />
                Dry Run Mode (log signals without executing)
              </label>
              <button
                onClick={handleConfigUpdate}
                className="px-5 py-2 bg-[#00C805] hover:bg-[#00A004] text-white font-bold rounded-lg text-sm transition-colors"
              >
                Save Config
              </button>
            </div>
          </div>
        )}

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-[#2D2D2D] rounded-lg p-4 text-center">
              <p className="text-gray-400 text-xs uppercase">Scans</p>
              <p className="text-xl font-bold">{stats.scans_completed}</p>
            </div>
            <div className="bg-[#2D2D2D] rounded-lg p-4 text-center">
              <p className="text-gray-400 text-xs uppercase">Trades Executed</p>
              <p className="text-xl font-bold text-[#00C805]">{stats.trades_executed}</p>
            </div>
            <div className="bg-[#2D2D2D] rounded-lg p-4 text-center">
              <p className="text-gray-400 text-xs uppercase">Trades Skipped</p>
              <p className="text-xl font-bold text-gray-400">{stats.trades_skipped}</p>
            </div>
            <div className="bg-[#2D2D2D] rounded-lg p-4 text-center">
              <p className="text-gray-400 text-xs uppercase">Errors</p>
              <p className={`text-xl font-bold ${stats.errors > 0 ? 'text-[#FF006E]' : 'text-gray-400'}`}>
                {stats.errors}
              </p>
            </div>
            <div className="bg-[#2D2D2D] rounded-lg p-4 text-center">
              <p className="text-gray-400 text-xs uppercase">Last Scan</p>
              <p className="text-sm font-mono">
                {stats.last_scan_time
                  ? new Date(stats.last_scan_time).toLocaleTimeString()
                  : '-'}
              </p>
            </div>
          </div>
        )}

        {/* Activity Log */}
        <div className="bg-[#2D2D2D] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <h2 className="font-bold text-sm uppercase text-gray-400">Activity Log</h2>
            {isRunning && (
              <span className="text-xs text-gray-500">Auto-refreshing every 5s</span>
            )}
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <p className="p-4 text-center text-gray-500">Loading...</p>
            ) : logs.length === 0 ? (
              <p className="p-4 text-center text-gray-500">No activity logs yet. Start the engine to begin scanning.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {logs.map((log) => (
                    <Fragment key={log.id}>
                      <tr
                        className="border-b border-gray-700/30 hover:bg-[#333333]/50 cursor-pointer"
                        onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      >
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap w-40 text-xs">
                          {new Date(log.timestamp).toLocaleString(undefined, {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                          })}
                        </td>
                        <td className={`px-4 py-2 font-bold uppercase text-xs w-24 ${EVENT_COLORS[log.event_type] || 'text-gray-400'}`}>
                          {log.event_type}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs w-16">
                          {log.ticker || '-'}
                        </td>
                        <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-md">
                          {log.details ? summarizeDetails(log.details) : '-'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600 text-xs">
                          {log.details ? '\u25BC' : ''}
                        </td>
                      </tr>
                      {expandedLog === log.id && log.details && (
                        <tr key={`${log.id}-detail`} className="border-b border-gray-700/30">
                          <td colSpan={5} className="px-4 py-3 bg-[#1E1E1E]">
                            <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function summarizeDetails(details: Record<string, unknown>): string {
  if (details.reason) return String(details.reason);
  if (details.dry_run) return `DRY RUN: ${details.occ_symbol || ''} ${details.side || ''}`;
  if (details.occ_symbol) return `${details.side || ''} ${details.qty || ''}x ${details.occ_symbol}`;
  if (details.error) return String(details.error).slice(0, 100);
  if (details.config) return 'Config snapshot';
  if (details.stats) return 'Stats snapshot';
  const keys = Object.keys(details);
  return keys.slice(0, 3).join(', ');
}
