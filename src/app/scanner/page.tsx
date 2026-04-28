import { ScannerShell } from '@/components/scanner/ScannerShell';

/**
 * Scanner page — natural-language LLM scanner bar + condition tabs + opportunity table.
 *
 * TODO: wire POST /api/strategy/ev/scan ({ tickers: watchlist }) for live rows.
 */
export default function ScannerPage() {
  return (
    <>
      <h2 className="rv-h1">Scanner</h2>
      <div className="rv-sub">
        Live scan · 8 watchlist tickers · next auto-scan in 2m 14s
      </div>

      <ScannerShell />
    </>
  );
}
