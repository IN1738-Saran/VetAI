import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useCandidates } from '@/lib/useCandidates';
import {
  computeDashboardKpis,
  computePipelineFunnel,
  topRolesByVolume,
  scheduledInterviews,
  recentActivity,
  numericScore,
  formatRelativeTime,
} from '@/lib/candidateDerived';
import { scoreTone, verdictTone } from '@/lib/badgeClass';
import { StatCard } from '@/components/StatCard';
import { Badge } from '@/components/Badge';
import { ScoreBar } from '@/components/ScoreBar';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState, FeedEmptyState } from '@/components/FeedStates';
import { paletteColor } from '@/lib/chartPalette';

const STAGE_DOT_CLASS: Record<string, string> = {
  green: 'bg-status-green',
  blue: 'bg-status-blue',
  amber: 'bg-status-amber',
  red: 'bg-status-red',
  gray: 'bg-status-gray',
};

export function DashboardView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const navigate = useNavigate();

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) {
    return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }
  const candidates = data ?? [];
  if (candidates.length === 0) return <FeedEmptyState />;

  const kpis = computeDashboardKpis(candidates);
  const pipeline = computePipelineFunnel(candidates);
  const roles = topRolesByVolume(candidates);
  const maxRoleCount = Math.max(...roles.map((r) => r.count), 1);
  const scheduled = scheduledInterviews(candidates);
  const activity = recentActivity(candidates);

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
          <div className="mb-1 text-[14px] font-semibold text-ink">Scheduled interviews</div>
          <p className="mb-3 text-[12px] text-ink-muted">
            Most recently updated first - exact scheduling times aren't tracked yet.
          </p>
          {scheduled.length > 0 ? (
            <ul className="divide-y divide-border">
              {scheduled.map((c) => {
                const score = numericScore(c);
                return (
                  <li key={c.sessionid} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink">{c.candidatename || 'N/A'}</div>
                      <div className="truncate text-[12px] text-ink-muted">{c.jobtitle || 'N/A'}</div>
                    </div>
                    <div className="w-20 shrink-0">
                      <ScoreBar value={score} tone={scoreTone(c.overall_score)} compact />
                    </div>
                    <Badge tone={verdictTone(c.verdict)}>{c.verdict || 'N/A'}</Badge>
                    <button
                      type="button"
                      onClick={() => navigate(`/candidates/${c.sessionid}`)}
                      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-surface"
                    >
                      Open
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <NotAvailable reason="No interviews are currently scheduled." />
          )}
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Pipeline</div>
          <p className="mb-3 text-[12px] text-ink-muted">All roles</p>
          <ul className="space-y-2">
            {pipeline.map((stage) => (
              <li key={stage.label} title={stage.basis}>
                {stage.count === null ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-2.5 text-[13px] text-ink-faint">
                    {stage.label} - not available
                  </div>
                ) : (
                  <div
                    className={clsx(
                      'flex items-center justify-between rounded-lg px-4 py-2.5',
                      stage.label === 'Applied' ? 'bg-navy text-white' : 'bg-surface text-ink'
                    )}
                  >
                    <span className="text-[13px] font-medium">{stage.label}</span>
                    <span className="text-[13px] font-semibold">{stage.count}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-faint">
            There's no separate "Qualified" stage yet - hover a row to see how it's calculated.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Activity</div>
          <p className="mb-3 text-[12px] text-ink-muted">Most recently updated candidate records</p>
          {activity.length > 0 ? (
            <ul className="space-y-3">
              {activity.map(({ candidate, timestamp, stage }) => (
                <li key={candidate.sessionid} className="flex items-start gap-2.5">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STAGE_DOT_CLASS[stage.tone]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink">
                      <span className="font-medium">{candidate.candidatename || 'N/A'}</span> - {stage.label}
                    </div>
                    <div className="text-[12px] text-ink-faint">{formatRelativeTime(timestamp)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <NotAvailable reason="No recent activity to show." />
          )}
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-3 text-[14px] font-semibold text-ink">Top roles by volume</div>
          <ul className="space-y-3">
            {roles.map((role, i) => (
              <li key={role.jobtitle}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-ink" title={role.jobtitle}>
                    {role.jobtitle}
                  </span>
                  <span className="shrink-0 text-ink-muted">
                    {role.count}
                    {role.averageScore !== null ? ` - avg ${role.averageScore}` : ''}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(role.count / maxRoleCount) * 100}%`, backgroundColor: paletteColor(i) }}
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
