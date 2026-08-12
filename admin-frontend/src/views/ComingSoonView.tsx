import type { LucideIcon } from 'lucide-react';
import { PlaceholderView } from '@/components/PlaceholderView';

interface ComingSoonViewProps {
  icon: LucideIcon;
  label: string;
}

// Backs every disabled nav item's route (in case of a direct link), and
// AI Assistant specifically: it has a reference image, but is explicitly
// scoped out of this pass (requires a retrieval/LLM layer that doesn't
// exist) - see plan section 4.4 "Out of scope".
export function ComingSoonView({ icon, label }: ComingSoonViewProps) {
  return (
    <PlaceholderView
      icon={icon}
      title={`${label} - coming soon`}
      description="No reference design was provided for this screen (or, for AI Assistant, it requires a data-retrieval/LLM layer that doesn't exist yet), so it's intentionally not built in this pass."
    />
  );
}
