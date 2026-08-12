import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface PlaceholderViewProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
}

// Used for: (a) the 6 "functional-later" screens before their real phase
// lands, and (b) the 4 nav stubs with zero reference design (Email Center,
// Reports, Organization, Profile) plus AI Assistant, which is explicitly
// scoped as a nav stub only despite having a reference image.
export function PlaceholderView({ icon: Icon, title, description }: PlaceholderViewProps) {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-card border border-dashed border-border bg-card text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink-faint">
        <Icon size={22} />
      </div>
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <div className="mt-1.5 max-w-sm text-[13px] text-ink-muted">{description}</div>
    </div>
  );
}
