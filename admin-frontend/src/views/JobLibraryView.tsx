import { Briefcase } from 'lucide-react';
import { PlaceholderView } from '@/components/PlaceholderView';

// Per plan section 4.4 / master prompt scope: Job Library has no backend
// persistence today and must be built as a visual shell over local/sample
// state only, clearly marked as such - never wired to fake persistence.
// The phased plan does not assign it its own numbered phase; it will be
// built alongside a later phase once the shared table/card components are
// exercised by real screens first.
export function JobLibraryView() {
  return (
    <PlaceholderView
      icon={Briefcase}
      title="Job Library placeholder - scheduled after Phase 4"
      description="Will render as a visual shell over local sample state only (no backend table exists for reusable jobs), clearly commented as a placeholder in code."
    />
  );
}
