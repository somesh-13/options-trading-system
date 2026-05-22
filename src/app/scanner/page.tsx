import { ScannerShell } from '@/components/scanner/ScannerShell';

/**
 * Scanner page — portfolio-driven universe fetched live from Robinhood holdings.
 * Shows a "backend unavailable" empty state if the backend is unreachable
 * (no silent demo-data fallback).
 */
export default function ScannerPage() {
  return (
    <div className="scanner-page-15">
      <h2 className="rv-h1">Scanner</h2>
      <div className="rv-sub">
        Live scan · scanning all portfolio tickers · refreshes every 60s
      </div>

      <ScannerShell />
    </div>
  );
}
