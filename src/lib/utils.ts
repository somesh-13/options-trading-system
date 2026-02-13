/**
 * Shared utility functions for OCC symbol parsing.
 */

export function parseOCC(occ: string): { underlying: string; expDate: string; type: string; strike: number } | null {
  const match = occ.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, underlying, dateStr, type, strikeStr] = match;
  const yy = dateStr.slice(0, 2);
  const mm = dateStr.slice(2, 4);
  const dd = dateStr.slice(4, 6);
  return {
    underlying,
    expDate: `20${yy}-${mm}-${dd}`,
    type: type === 'C' ? 'Call' : 'Put',
    strike: parseInt(strikeStr) / 1000,
  };
}

export function formatOCCReadable(occ: string): string {
  const parsed = parseOCC(occ);
  if (!parsed) return occ;
  return `${parsed.underlying} ${parsed.expDate} $${parsed.strike.toFixed(2)} ${parsed.type}`;
}
