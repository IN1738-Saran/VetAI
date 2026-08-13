import { useMemo, useState } from 'react';
import { useCandidates } from '@/lib/useCandidates';
import {
  computeDashboardKpis,
  computeOutcomes,
  filterByDateRange,
  submissionsOverTime,
  topRolesByVolume,
} from '@/lib/candidateDerived';
import { StatCard } from '@/components/StatCard';
import { Donut } from '@/components/Donut';
import { LineChartCard } from '@/components/LineChartCard';
import { HorizontalBarChart } from '@/components/HorizontalBarChart';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState, FeedEmptyState } from '@/components/FeedStates';

export function AnalyticsView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [jobTitleFilter, setJobTitleFilter] = useState('');

  const candidates = data ?? [];
  const jobTitles = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.jobtitle || 'Unknown'))).sort(),
    [candidates]
  );

  const filtered = useMemo(() => {
    let rows = filterByDateRange(candidates, from || null, to || null);
    if (jobTitleFilter) rows = rows.filter((c) => (c.jobtitle || 'Unknown') === jobTitleFilter);
    return rows;
  }, [candidates, from, to, jobTitleFilter]);

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (candidates.length === 0) return <FeedEmptyState />;

  const kpis = computeDashboardKpis(filtered);
  const outcomes = computeOutcomes(filtered);
  const roles = topRolesByVolume(filtered, 10).map((r) => ({ label: r.jobtitle, value: r.count }));
  const submissions = submissionsOverTime(filtered);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-card bg-card p-4 shadow-card">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-muted">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-muted">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-muted">Job</label>
          <select
            value={jobTitleFilter}
            onChange={(e) => setJobTitleFilter(e.target.value)}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px]"
          >
            <option value="">All roles</option>
            {jobTitles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[12px] font-medium text-ink-muted">Department</label>
          <select disabled title="No department field exists in the real feed" className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-ink-faint">
            <option>Not available</option>
          </select>
        </div>
        {(from || to || jobTitleFilter) && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setTo('');
              setJobTitleFilter('');
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-ink hover:bg-surface"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <StatCard label="Candidates in range" value={kpis.totalCount} accent />
        <StatCard label="Average score" value={kpis.averageScore ?? '-'} />
        <StatCard label="Pass rate" value={kpis.passRate !== null ? `${kpis.passRate}%` : '-'} />
        <StatCard label="Needs review" value={kpis.needsReviewCount} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Candidates by job</div>
          <p className="mb-3 text-[12px] text-ink-muted">Top 10 roles in the selected range</p>
          <HorizontalBarChart data={roles} />
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Interview outcomes</div>
          <p className="mb-3 text-[12px] text-ink-muted">Pass rule: score 70+ and Fit or better</p>
          <Donut
            centerLabel="Total"
            centerValue={filtered.length}
            slices={[
              { label: 'Passed', value: outcomes.passed, color: '#16A34A' },
              { label: 'Needs review', value: outcomes.needsReview, color: '#D97706' },
              { label: 'Not passed', value: outcomes.notPassed, color: '#DC2626' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Skills gap</div>
          <p className="mb-3 text-[12px] text-ink-muted">Required vs. demonstrated skills</p>
          <NotAvailable reason="no required/preferred skill tags exist anywhere in the real feed - the JD itself is never returned in structured form (see Phase 4 finding)" />
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Submissions over time</div>
          <p className="mb-3 text-[12px] text-ink-muted">By month, based on createdat</p>
          {submissions.length > 0 ? (
            <LineChartCard data={submissions} />
          ) : (
            <NotAvailable reason="no records with a valid createdat in the selected range" />
          )}
        </div>
      </div>
    </div>
  );
}
