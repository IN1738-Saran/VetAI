import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useCandidates } from '@/lib/useCandidates';
import {
  computeDashboardKpis,
  computeOutcomes,
  filterByDateRange,
  topRolesByVolume,
} from '@/lib/candidateDerived';
import { downloadCsv } from '@/lib/csvExport';
import { StatCard } from '@/components/StatCard';
import { FeedLoadingSkeleton, FeedErrorState, FeedEmptyState } from '@/components/FeedStates';

const CANDIDATE_EXPORT_COLUMNS = [
  'candidatename',
  'candidateemail',
  'jobtitle',
  'overall_score',
  'verdict',
  'status',
  'createdat',
  'updatedat',
];

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsView() {
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
  const roles = topRolesByVolume(filtered, 15);

  function exportCandidates() {
    downloadCsv(
      `vetai-candidates-${todayStamp()}.csv`,
      filtered as unknown as Record<string, unknown>[],
      CANDIDATE_EXPORT_COLUMNS
    );
  }

  function exportRoleBreakdown() {
    downloadCsv(
      `vetai-role-breakdown-${todayStamp()}.csv`,
      roles as unknown as Record<string, unknown>[],
      ['jobtitle', 'count', 'averageScore']
    );
  }

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
        <div className="flex-1">
          <label className="mb-1 block text-[12px] font-medium text-ink-muted">Job</label>
          <select
            value={jobTitleFilter}
            onChange={(e) => setJobTitleFilter(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-1.5 text-[13px]"
          >
            <option value="">All roles</option>
            {jobTitles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
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

      <div className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-ink">Candidate export</div>
            <p className="text-[12px] text-ink-muted">
              Every candidate currently in range, with their real score, verdict and status.
            </p>
          </div>
          <button
            type="button"
            onClick={exportCandidates}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
        <p className="text-[12px] text-ink-faint">{filtered.length} candidates will be included.</p>
      </div>

      <div className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-ink">Role breakdown</div>
            <p className="text-[12px] text-ink-muted">Candidate volume and average score per role, in range.</p>
          </div>
          <button
            type="button"
            onClick={exportRoleBreakdown}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-ink hover:bg-surface"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-muted">
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Candidates</th>
                <th className="py-2 font-medium">Average score</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.jobtitle} className="border-b border-border last:border-0">
                  <td className="py-2 text-ink">{r.jobtitle}</td>
                  <td className="py-2 text-ink">{r.count}</td>
                  <td className="py-2 text-ink">{r.averageScore ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-3 text-[14px] font-semibold text-ink">Interview outcomes</div>
        <ul className="grid grid-cols-3 gap-4 text-[13px]">
          <li>
            <div className="text-ink-muted">Passed</div>
            <div className="text-[20px] font-semibold text-status-green">{outcomes.passed}</div>
          </li>
          <li>
            <div className="text-ink-muted">Needs review</div>
            <div className="text-[20px] font-semibold text-status-amber">{outcomes.needsReview}</div>
          </li>
          <li>
            <div className="text-ink-muted">Not passed</div>
            <div className="text-[20px] font-semibold text-ink">{outcomes.notPassed}</div>
          </li>
        </ul>
      </div>
    </div>
  );
}

