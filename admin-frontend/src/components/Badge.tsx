import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { SemanticTone } from '@/types';

const TONE_CLASSES: Record<SemanticTone, string> = {
  green: 'bg-status-green-bg text-status-green-text',
  blue: 'bg-status-blue-bg text-status-blue-text',
  amber: 'bg-status-amber-bg text-status-amber-text',
  red: 'bg-status-red-bg text-status-red-text',
  gray: 'bg-status-gray-bg text-status-gray-text',
};

interface BadgeProps {
  tone: SemanticTone;
  children: ReactNode;
}

// Text-equivalent by construction (children is always the label text) -
// color is never the sole signal, per plan Accessibility section 11.
export function Badge({ tone, children }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium',
        TONE_CLASSES[tone]
      )}
    >
      {children}
    </span>
  );
}
