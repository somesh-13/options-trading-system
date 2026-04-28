// Shared types for the stock detail page + charts.
// Adapted from the leaderBoardProject `historicalPriceService.ts` but kept
// minimal and Polygon-agnostic since our backend serves this via yfinance.

export interface HistoricalDataPoint {
  timestamp: number; // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string; // YYYY-MM-DD for display
}

export type TimeRange = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y';
