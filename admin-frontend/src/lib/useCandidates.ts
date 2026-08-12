import { useQuery } from '@tanstack/react-query';
import { fetchCandidates } from './candidates';

// Single shared query key - Dashboard, Candidates, Analytics and Candidate
// Profile all read through this hook, so TanStack Query's cache means the
// feed is fetched once per session/navigation-tree, not once per screen
// (plan sections 6/7/13; the current dashboard.html/analytics.html each
// fetch independently, which this is meant to stop doing).
export function useCandidates() {
  return useQuery({
    queryKey: ['candidates'],
    queryFn: fetchCandidates,
  });
}
