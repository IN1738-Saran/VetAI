import { CalendarClock } from 'lucide-react';
import { PlaceholderView } from '@/components/PlaceholderView';

// The reference set has no "Interviews list" screen - only "Interviews >
// New" (VetAI-07-New-interview.png). This route hosts the New Interview
// form (built in Phase 4), matching that breadcrumb.
export function InterviewsView() {
  return (
    <PlaceholderView
      icon={CalendarClock}
      title="New Interview form lands in Phase 4"
      description="3-step layout (details, documents, length and delivery) wired to the real, unmodified POST /api/create-interview."
    />
  );
}
