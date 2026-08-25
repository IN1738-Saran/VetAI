// Generic array-of-objects -> CSV, used by the Reports page to export real,
// already-loaded data (candidates feed, derived aggregates) - no server
// round-trip, since the browser already has everything it needs.
function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','));
  return [header, ...body].join('\r\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns: string[]): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
