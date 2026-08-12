import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}

export function StatCard({ label, value, hint, accent }: StatCardProps) {
  return (
    <div
      className={
        'rounded-card bg-card p-5 shadow-card' +
        (accent ? ' border-l-[3px] border-accent' : '')
      }
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      <div className="mt-2 text-[28px] font-bold leading-none text-ink">{value}</div>
      {hint && <div className="mt-2 text-[12px] text-ink-muted">{hint}</div>}
    </div>
  );
}
