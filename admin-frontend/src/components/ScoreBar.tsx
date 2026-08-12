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
  /** Inline number-then-bar layout for table cells, instead of the stacked label/bar layout. */
  compact?: boolean;
}

// The numeric value is ALWAYS rendered next to the bar in every layout -
// never color/bar-only - per plan Accessibility section 11. A prior version
// of this component only showed the value when `label` was passed, which
// silently dropped the text-equivalent in the Candidates table (caught in a
// live Phase 3 smoke test).
export function ScoreBar({ label, value, tone = 'blue', max = 100, compact = false }: ScoreBarProps) {
  const notScored = value === null || value === undefined;
  const pct = notScored ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

  const bar = (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
      {!notScored && (
        <div className={clsx('h-full rounded-full', FILL_CLASSES[tone])} style={{ width: `${pct}%` }} />
      )}
    </div>
  );

  const valueText = notScored ? 'Not scored yet' : value;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className={clsx('w-6 shrink-0 text-[13px] font-medium', notScored ? 'text-ink-faint' : 'text-ink')}>
          {notScored ? '-' : value}
        </span>
        <div className="w-20">{bar}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        {label ? <span className="text-[13px] text-ink">{label}</span> : <span />}
        <span className={clsx('text-[13px] font-medium', notScored ? 'text-ink-faint' : 'text-ink')}>
          {valueText}
        </span>
      </div>
      {bar}
    </div>
  );
}
