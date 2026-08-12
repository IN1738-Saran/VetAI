import { LayoutDashboard } from 'lucide-react';
import { PlaceholderView } from '@/components/PlaceholderView';

export function DashboardView() {
  return (
    <PlaceholderView
      icon={LayoutDashboard}
      title="Dashboard lands in Phase 3"
      description="KPI cards, today's schedule, pipeline funnel, activity feed and top-roles-by-volume, wired to the real candidates feed."
    />
  );
}
