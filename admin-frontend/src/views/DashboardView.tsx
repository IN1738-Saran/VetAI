import { useCandidates } from '@/lib/useCandidates';
import { computeDashboardKpis, topRolesByVolume } from '@/lib/candidateDerived';
import { StatCard } from '@/components/StatCard';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState, FeedEmptyState } from '@/components/FeedStates';

export function DashboardView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) {
    return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }
  const candidates = data ?? [];
  if (candidates.length === 0) return <FeedEmptyState />;

  const kpis = computeDashboardKpis(candidates);
  const roles = topRolesByVolume(candidates);
  const maxRoleCount = Math.max(...roles.map((r) => r.count), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-5">
        <StatCard label="All candidates" value={kpis.totalCount} accent />
        <StatCard label="New today" value={kpis.newToday} />
        <StatCard label="Needs review" value={kpis.needsReviewCount} />
        <StatCard label="Average score" value={kpis.averageScore ?? '-'} />
        <StatCard label="Pass rate" value={kpis.passRate !== null ? `${kpis.passRate}%` : '-'} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Today's schedule</div>
          <p className="mb-3 text-[12px] text-ink-muted">Interviews scheduled for today</p>
          <NotAvailable reason="the current feed has no interview-scheduling field" />
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Pipeline</div>
          <p className="mb-3 text-[12px] text-ink-muted">All roles</p>
          <div className="flex items-center justify-between rounded-lg bg-navy px-4 py-2.5 text-white">
            <span className="text-[13px] font-medium">Applied</span>
            <span className="text-[13px] font-semibold">{kpis.totalCount}</span>
          </div>
          <div className="mt-3">
            <NotAvailable reason="Parsed/Qualified/Interviewed/Passed/Shortlisted stages need a pipeline-stage field the current feed does not have" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Activity</div>
          <p className="mb-3 text-[12px] text-ink-muted">Everything that moved recently</p>
          <NotAvailable reason="the feed is a snapshot, not an event log" />
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">Top roles by volume</div>
          <ul className="space-y-3">
            {roles.map((role) => (
              <li key={role.jobtitle}>
                <div className="mb-1 flex items-baseline justify-between text-[13px]">
                  <span className="text-ink">{role.jobtitle}</span>
                  <span className="text-ink-muted">
                    {role.count}
                    {role.averageScore !== null ? ` - avg ${role.averageScore}` : ''}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-navy"
                    style={{ width: `${(role.count / maxRoleCount) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
