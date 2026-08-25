import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useCandidates } from '@/lib/useCandidates';
import {
  computeDashboardKpis,
  computeOutcomes,
  filterByDateRange,
  submissionsOverTime,
  topRolesByVolume,
} from '@/lib/candidateDerived';
import { SAMPLE_JOBS, loadCustomJobs, findJobPostingForTitle } from '@/lib/jobLibrary';
import { StatCard } from '@/components/StatCard';
import { Donut } from '@/components/Donut';
import { LineChartCard } from '@/components/LineChartCard';
import { HorizontalBarChart } from '@/components/HorizontalBarChart';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState, FeedEmptyState } from '@/components/FeedStates';

// Server-side hard cap is 40 (see backend/src/controllers/
// candidateController.js's getSkillsGapSummary) - this client-side cap is
// tighter to keep the request itself small and fast, not a workaround for
// the server limit.
const MAX_SKILLS_GAP_SAMPLE = 30;

interface SkillsGapSummary {
  configured: boolean;
  sampleSize: number;
  checkedCount: number;
  missingPercentages: Record<string, number>;
}

type SkillsGapState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SkillsGapSummary };

// Real aggregate skill-gap data for one role at a time: given the session
// ids of a (capped) real, recent sample of candidates for that role and its
// Job Library posting's real required-skill tags, the backend checks each
// candidate's actual profile-match-report text (matchSkillsAgainstText) and
// returns what fraction are missing each skill. Nothing here is invented -
// if there's no matching Job Library posting (so no known required
// skills), this never fires and the caller shows the existing "not
// available" state instead.
function useSkillsGapSummary(sessionIds: string[], skills: string[]): SkillsGapState {
  const [state, setState] = useState<SkillsGapState>({ status: 'idle' });
  const sessionIdsKey = sessionIds.join(',');
  const skillsKey = skills.join(',');

  useEffect(() => {
    if (skills.length === 0 || sessionIds.length === 0) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    fetch('/api/skills-gap-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds, skills }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'error', message: `Request failed (${res.status})` });
          return;
        }
        const data = (await res.json()) as SkillsGapSummary;
        setState({ status: 'ready', data });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error' });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdsKey, skillsKey]);

  return state;
}

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

  // Only meaningful once a specific role is selected - "known required
  // skills" is a property of one Job Library posting, not of "all roles".
  const matchedJob = jobTitleFilter
    ? findJobPostingForTitle(jobTitleFilter, [...SAMPLE_JOBS, ...loadCustomJobs()])
    : undefined;
  const skillsGapSessionIds = matchedJob
    ? [...filtered]
        .sort(
          (a, b) =>
            new Date(b.updatedat || b.createdat || 0).getTime() - new Date(a.updatedat || a.createdat || 0).getTime()
        )
        .slice(0, MAX_SKILLS_GAP_SAMPLE)
        .map((c) => c.sessionid)
    : [];
  const skillsGap = useSkillsGapSummary(skillsGapSessionIds, matchedJob?.tags ?? []);

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
          <select disabled title="Department filtering isn't available yet" className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-ink-faint">
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
              { label: 'Needs review', value: outcomes.needsReview, color: '#F2A93E' },
              { label: 'Not passed', value: outcomes.notPassed, color: '#0B1A2C' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Skills gap</div>
          <p className="mb-3 text-[12px] text-ink-muted">
            {matchedJob ? `Required for ${matchedJob.title}, missing from real candidate reports` : 'Required vs. demonstrated skills'}
          </p>
          {!matchedJob && (
            <NotAvailable reason="Select a specific role above to see its required skills against real candidates." />
          )}
          {matchedJob && skillsGap.status === 'loading' && (
            <p className="text-[13px] text-ink-muted">Checking real candidate reports...</p>
          )}
          {matchedJob && skillsGap.status === 'error' && (
            <NotAvailable reason="Temporarily unavailable - please try again shortly." />
          )}
          {matchedJob && skillsGap.status === 'ready' && !skillsGap.data.configured && (
            <NotAvailable reason="Not available in this environment yet." />
          )}
          {matchedJob && skillsGap.status === 'ready' && skillsGap.data.configured && skillsGap.data.checkedCount === 0 && (
            <NotAvailable reason="No profile reports have been generated yet for this role." />
          )}
          {matchedJob && skillsGap.status === 'ready' && skillsGap.data.configured && skillsGap.data.checkedCount > 0 && (
            <>
              <ul className="space-y-3">
                {Object.entries(skillsGap.data.missingPercentages)
                  .sort(([, a], [, b]) => b - a)
                  .map(([skill, pct]) => (
                    <li key={skill}>
                      <div className="mb-1 flex items-baseline justify-between text-[13px]">
                        <span className="text-ink">{skill}</span>
                        <span className="text-ink-muted">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                        <div
                          className={clsx(
                            'h-full rounded-full',
                            pct >= 50 ? 'bg-status-red' : pct >= 25 ? 'bg-status-amber' : 'bg-status-green'
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-[11px] text-ink-faint">
                Based on the {skillsGap.data.checkedCount} most recent candidates for this role
                {filtered.length > skillsGap.data.checkedCount ? ` (${filtered.length} total match it)` : ''}.
              </p>
            </>
          )}
        </div>

        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="mb-1 text-[14px] font-semibold text-ink">Submissions over time</div>
          <p className="mb-3 text-[12px] text-ink-muted">By month</p>
          {submissions.length > 0 ? (
            <LineChartCard data={submissions} />
          ) : (
            <NotAvailable reason="No submissions in the selected date range." />
          )}
        </div>
      </div>
    </div>
  );
}
