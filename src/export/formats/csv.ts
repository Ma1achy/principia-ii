/** Per-sample CSV with a configurable column set. */
export function simResultsToCsv(
  rows: { [k: string]: number | string }[],
  cols: string[],
): string {
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c] ?? '')).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

function csvEscape(v: number | string): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NaN';
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
