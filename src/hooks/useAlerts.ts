'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PortfolioSummaryResponse, PortfolioGreeks, PositionWithGreeks } from '@/lib/pricing-api';

export interface Alert {
  id: string;
  type: 'pnl_loss' | 'pnl_gain' | 'greeks_breach' | 'position_loss';
  message: string;
  severity: 'warning' | 'danger' | 'success';
  timestamp: Date;
}

export interface AlertConfig {
  daily_loss_threshold: number;
  daily_gain_threshold: number;
  max_delta: number;
  max_gamma: number;
  max_vega: number;
  max_theta: number;
  position_loss_pct_threshold: number;
  browser_notifications: boolean;
  sound_alerts: boolean;
}

const DEFAULT_CONFIG: AlertConfig = {
  daily_loss_threshold: 500,
  daily_gain_threshold: 1000,
  max_delta: 500,
  max_gamma: 100,
  max_vega: 1000,
  max_theta: 500,
  position_loss_pct_threshold: 20,
  browser_notifications: false,
  sound_alerts: false,
};

const STORAGE_KEY = 'portfolio-alert-config';

function loadConfig(): AlertConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_CONFIG;
}

export function saveAlertConfig(config: AlertConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function useAlerts(
  summary: PortfolioSummaryResponse | null,
  positions?: PositionWithGreeks[] | null
) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [config, setConfig] = useState<AlertConfig>(DEFAULT_CONFIG);
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  const updateConfig = useCallback((newConfig: AlertConfig) => {
    setConfig(newConfig);
    saveAlertConfig(newConfig);
    firedRef.current.clear();
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    if (!summary) return;

    const newAlerts: Alert[] = [];
    const acct = summary.account;
    const greeks = summary.portfolio_greeks;

    // Daily P&L check
    const equity = parseFloat(acct.equity || '0');
    const lastEquity = parseFloat(acct.last_equity || '0');
    const dayPL = equity - lastEquity;

    if (config.daily_loss_threshold > 0 && dayPL < -config.daily_loss_threshold) {
      const key = `pnl_loss_${Math.floor(dayPL)}`;
      if (!firedRef.current.has(key)) {
        firedRef.current.add(key);
        newAlerts.push({
          id: `loss_${Date.now()}`,
          type: 'pnl_loss',
          message: `Daily loss ($${Math.abs(dayPL).toFixed(2)}) exceeds threshold ($${config.daily_loss_threshold})`,
          severity: 'danger',
          timestamp: new Date(),
        });
      }
    }

    if (config.daily_gain_threshold > 0 && dayPL > config.daily_gain_threshold) {
      const key = `pnl_gain_${Math.floor(dayPL)}`;
      if (!firedRef.current.has(key)) {
        firedRef.current.add(key);
        newAlerts.push({
          id: `gain_${Date.now()}`,
          type: 'pnl_gain',
          message: `Daily gain ($${dayPL.toFixed(2)}) exceeds threshold ($${config.daily_gain_threshold})`,
          severity: 'success',
          timestamp: new Date(),
        });
      }
    }

    // Greeks breach checks
    const greeksChecks: Array<{ name: string; value: number; limit: number }> = [
      { name: 'Delta', value: Math.abs(greeks.total_delta), limit: config.max_delta },
      { name: 'Gamma', value: Math.abs(greeks.total_gamma), limit: config.max_gamma },
      { name: 'Vega', value: Math.abs(greeks.total_vega), limit: config.max_vega },
      { name: 'Theta', value: Math.abs(greeks.total_theta), limit: config.max_theta },
    ];

    for (const check of greeksChecks) {
      if (check.limit > 0 && check.value > check.limit) {
        const key = `greeks_${check.name}_${Math.floor(check.value)}`;
        if (!firedRef.current.has(key)) {
          firedRef.current.add(key);
          newAlerts.push({
            id: `greeks_${check.name}_${Date.now()}`,
            type: 'greeks_breach',
            message: `${check.name} (${check.value.toFixed(2)}) exceeds limit (${check.limit})`,
            severity: 'warning',
            timestamp: new Date(),
          });
        }
      }
    }

    // Position-level loss checks
    if (positions && config.position_loss_pct_threshold > 0) {
      for (const pos of positions) {
        const lossPct = parseFloat(pos.unrealized_plpc || '0') * 100;
        if (lossPct < -config.position_loss_pct_threshold) {
          const key = `pos_loss_${pos.symbol}_${Math.floor(lossPct)}`;
          if (!firedRef.current.has(key)) {
            firedRef.current.add(key);
            newAlerts.push({
              id: `pos_${pos.symbol}_${Date.now()}`,
              type: 'position_loss',
              message: `${pos.symbol} down ${Math.abs(lossPct).toFixed(1)}% (threshold: ${config.position_loss_pct_threshold}%)`,
              severity: 'danger',
              timestamp: new Date(),
            });
          }
        }
      }
    }

    if (newAlerts.length > 0) {
      setAlerts((prev) => [...newAlerts, ...prev].slice(0, 10));

      // Browser notification
      if (config.browser_notifications && typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          for (const a of newAlerts) {
            new Notification('Portfolio Alert', { body: a.message });
          }
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission();
        }
      }

      // Sound alert
      if (config.sound_alerts && typeof Audio !== 'undefined') {
        try {
          const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczHjqIxNjQdkQnN3y80uCLUTA0cLDR4ZpcODFppMzhmWQ+NWSfy+GfaUQ3');
          audio.volume = 0.3;
          audio.play().catch(() => {});
        } catch {}
      }
    }
  }, [summary, positions, config]);

  return { alerts, config, updateConfig, dismissAlert };
}
