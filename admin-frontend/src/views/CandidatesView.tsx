import { Users } from 'lucide-react';
import { PlaceholderView } from '@/components/PlaceholderView';

export function CandidatesView() {
  return (
    <PlaceholderView
      icon={Users}
      title="Candidates lands in Phase 3"
      description="Saved views, filter chips, bulk select and the candidates table, wired to the real webhook/dataentry feed."
    />
  );
}
