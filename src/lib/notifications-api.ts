/**
 * Client wrapper for the notifications service. Hits the FastAPI backend via
 * the same-origin proxy (`notifications` is in `BACKEND_PROXY_PREFIXES`).
 */

import { PRICING_API_URL } from './pricing-api';

export type AlertType = 'high_iv' | 'cc_opportunity' | 'csp_opportunity' | string;
export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface NotificationRow {
  id: number;
  ticker: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationRow[];
  count: number;
}

export interface NotificationScanResult {
  scanned_tickers: number;
  candidates: number;
  inserted: number;
  deduped: number;
  by_detector: Record<string, number>;
  message?: string;
}

async function ok<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    let detail = `${fallback}: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export function listNotifications(): Promise<NotificationListResponse> {
  return fetch(`${PRICING_API_URL}/api/notifications`, { cache: 'no-store' }).then((r) =>
    ok<NotificationListResponse>(r, 'List notifications failed'),
  );
}

export function scanNotificationsNow(account = 'all'): Promise<NotificationScanResult> {
  return fetch(
    `${PRICING_API_URL}/api/notifications/scan-now?account=${encodeURIComponent(account)}`,
    { method: 'POST', cache: 'no-store' },
  ).then((r) => ok<NotificationScanResult>(r, 'Scan failed'));
}

export function dismissNotification(id: number): Promise<{ id: number; dismissed: boolean }> {
  return fetch(`${PRICING_API_URL}/api/notifications/${id}/dismiss`, {
    method: 'POST',
    cache: 'no-store',
  }).then((r) => ok(r, 'Dismiss failed'));
}

export function dismissAllNotifications(): Promise<{ dismissed: number }> {
  return fetch(`${PRICING_API_URL}/api/notifications/dismiss-all`, {
    method: 'POST',
    cache: 'no-store',
  }).then((r) => ok(r, 'Dismiss-all failed'));
}
