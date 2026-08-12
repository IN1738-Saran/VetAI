import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyState?: ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
}

// Sorting/filtering/pagination are wired against the real candidates feed
// starting Phase 3 - this is the shared visual/structural shell only.
export function DataTable<T>({ columns, rows, rowKey, emptyState, loading, onRowClick }: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-card bg-card shadow-card">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-ink-muted">
                Loading...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-ink-muted">
                {emptyState ?? 'No data.'}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={
                  'border-b border-border last:border-0 hover:bg-surface' +
                  (onRowClick ? ' cursor-pointer' : '')
                }
              >
                {columns.map((col) => (
                  <td key={col.key} className={'px-4 py-3 align-middle ' + (col.className ?? '')}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
