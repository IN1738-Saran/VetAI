import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useCandidates } from '@/lib/useCandidates';
import { statsForJobTitle } from '@/lib/candidateDerived';
import { Badge } from '@/components/Badge';
import { FeedLoadingSkeleton, FeedErrorState } from '@/components/FeedStates';

// PLACEHOLDER: no backend persistence exists for saved jobs yet (plan
// section 4.4 / master prompt scope - "build the screen as a visual shell
// with realistic-looking sample state clearly marked as such"). Metadata
// below (department/seniority/tags/status/length) is entirely local sample
// data, never sent anywhere. Job titles were deliberately chosen to match
// real, currently-active jobtitle values in the live webhook/dataentry feed
// (confirmed 2026-08-13), so the "candidates"/"avg score" stats next to each
// card are genuinely computed from real data via statsForJobTitle(), not
// faked - only the job-as-a-reusable-entity concept itself is a placeholder.
interface SampleJob {
  title: string;
  department: string;
  seniority: string;
  status: 'Active' | 'Draft';
  interviewLengthMinutes: number;
  tags: string[];
}

const SAMPLE_JOBS: SampleJob[] = [
  {
    title: 'Senior Data Engineer (DBT & Snowflake)',
    department: 'Data Engineering',
    seniority: 'Senior - 6-10 yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['dbt', 'Snowflake', 'SQL', 'Airflow', 'Python'],
  },
  {
    title: 'Senior Data Engineer - Azure',
    department: 'Data Engineering',
    seniority: 'Senior - 5-9 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Azure', 'Databricks', 'ADF', 'Spark'],
  },
  {
    title: 'Lead Data Engineer (Azure Databricks)',
    department: 'Data Engineering',
    seniority: 'Lead - 8+ yrs',
    status: 'Active',
    interviewLengthMinutes: 60,
    tags: ['Databricks', 'Kafka', 'Delta Lake', 'Terraform'],
  },
  {
    title: 'MuleSoft API Developer',
    department: 'Integration',
    seniority: 'Mid - 3-6 yrs',
    status: 'Draft',
    interviewLengthMinutes: 45,
    tags: ['MuleSoft', 'REST', 'Java', 'RAML'],
  },
  {
    title: 'Senior QA Analyst',
    department: 'Quality',
    seniority: 'Senior - 5-8 yrs',
    status: 'Active',
    interviewLengthMinutes: 45,
    tags: ['Selenium', 'API testing', 'SQL', 'Jira'],
  },
  {
    title: 'Inside Sales Lead',
    department: 'Sales',
    seniority: 'Mid - 3-5 yrs',
    status: 'Active',
    interviewLengthMinutes: 30,
    tags: ['CRM', 'Outreach', 'Negotiation'],
  },
];

const DEPARTMENTS = ['All departments', ...Array.from(new Set(SAMPLE_JOBS.map((j) => j.department)))];

export function JobLibraryView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const navigate = useNavigate();
  const [department, setDepartment] = useState('All departments');

  const candidates = data ?? [];
  const distinctRealTitles = useMemo(
    () => new Set(candidates.map((c) => (c.jobtitle || 'Unknown').trim().toLowerCase())).size,
    [candidates]
  );

  const visibleJobs =
    department === 'All departments' ? SAMPLE_JOBS : SAMPLE_JOBS.filter((j) => j.department === department);

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-status-amber bg-status-amber-bg px-4 py-3 text-[13px] text-status-amber-text">
        <strong>{SAMPLE_JOBS.length} sample jobs</strong> shown here as a placeholder - no backend table for
        reusable jobs exists yet. The real feed currently has <strong>{distinctRealTitles}</strong> distinct
        free-text job titles with no reusable-job concept behind any of them. Candidate counts and average
        scores below each card ARE real, matched against those free-text titles.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {DEPARTMENTS.map((dept) => (
            <button
              key={dept}
              type="button"
              onClick={() => setDepartment(dept)}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-[13px] font-medium',
                department === dept ? 'border-navy bg-navy text-white' : 'border-border text-ink hover:bg-surface'
              )}
            >
              {dept}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled
          title="No backend exists to persist a new job yet - this is a placeholder screen"
          className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold text-white opacity-60 disabled:cursor-not-allowed"
        >
          <Plus size={14} /> New job
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visibleJobs.map((job) => {
          const stats = statsForJobTitle(candidates, job.title);
          return (
            <div key={job.title} className="rounded-card bg-card p-5 shadow-card">
              <div className="mb-3 flex items-start justify-between">
                <Badge tone={job.status === 'Active' ? 'green' : 'gray'}>{job.status}</Badge>
                <span className="text-[12px] text-ink-faint">{job.seniority}</span>
              </div>
              <div className="mb-1 text-[15px] font-semibold text-ink">{job.title}</div>
              <div className="mb-3 text-[12px] text-ink-muted">
                {job.department} - {job.interviewLengthMinutes} min interview
              </div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {job.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink-muted">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                <div>
                  <div className="text-[15px] font-bold text-ink">{stats.count}</div>
                  <div className="text-[11px] text-ink-faint">
                    candidates{stats.averageScore !== null ? ` - avg ${stats.averageScore}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/interviews', { state: { jobTitle: job.title } })}
                  className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-navy hover:bg-accent-hover"
                  title="Opens New Interview with this title pre-filled - documents and submission are still real and required"
                >
                  Start interview
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
