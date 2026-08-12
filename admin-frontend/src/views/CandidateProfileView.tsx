import { Users } from 'lucide-react';
import { PlaceholderView } from '@/components/PlaceholderView';

// Reached via a row click on Candidates, not its own nav item.
export function CandidateProfileView() {
  return (
    <PlaceholderView
      icon={Users}
      title="Candidate Profile lands in Phase 4"
      description="Match breakdown, strengths/gaps, recording player with question markers, timeline, notes and files - with 'not scored yet' placeholders for any sub-score not present in the real payload."
    />
  );
}
