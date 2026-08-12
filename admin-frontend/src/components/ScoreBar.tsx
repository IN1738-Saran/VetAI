import clsx from 'clsx';
import type { SemanticTone } from '@/types';

const FILL_CLASSES: Record<SemanticTone, string> = {
  green: 'bg-status-green',
  blue: 'bg-status-blue',
  amber: 'bg-status-amber',
  red: 'bg-status-red',
  gray: 'bg-status-gray',
};

interface ScoreBarProps {
  label?: string;
  /** null/undefined renders the "not scored yet" placeholder state (plan section 4.3/9). */
  value: number | null | undefined;
  tone?: SemanticTone;
  max?: number;
}

// The numeric value is always rendered alongside the bar - never
// color/bar-only - per plan Accessibility section 11.
export function ScoreBar({ label, value, tone = 'blue', max = 100 }: ScoreBarProps) {
  const notScored = value === null || value === undefined;
  const pct = notScored ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div>
      {label && (
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[13px] text-ink">{label}</span>
          <span className={clsx('text-[13px] font-medium', notScored ? 'text-ink-faint' : 'text-ink')}>
            {notScored ? 'Not scored yet' : value}
          </span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        {!notScored && (
          <div
            className={clsx('h-full rounded-full', FILL_CLASSES[tone])}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
