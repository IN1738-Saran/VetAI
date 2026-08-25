import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { useCandidates } from '@/lib/useCandidates';
import { statsForJobTitle } from '@/lib/candidateDerived';
import { SAMPLE_JOBS, loadCustomJobs, saveCustomJob, departmentsFor, type JobPosting } from '@/lib/jobLibrary';
import { Badge } from '@/components/Badge';
import { FeedLoadingSkeleton, FeedErrorState } from '@/components/FeedStates';

function NewJobModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (job: JobPosting) => void;
}) {
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [seniority, setSeniority] = useState('');
  const [status, setStatus] = useState<'Active' | 'Draft'>('Draft');
  const [interviewLengthMinutes, setInterviewLengthMinutes] = useState(45);
  const [tagsInput, setTagsInput] = useState('');

  const canCreate = title.trim() !== '' && department.trim() !== '';

  function handleCreate() {
    if (!canCreate) return;
    onCreate({
      title: title.trim(),
      department: department.trim(),
      seniority: seniority.trim() || 'Not specified',
      status,
      interviewLengthMinutes,
      tags: tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-card bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-semibold text-ink">New job</div>
          <button type="button" onClick={onClose} className="text-ink-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink">Job title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Analytics Engineer"
              className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink">Department *</label>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Data Activation & Analytics"
              className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink">Seniority</label>
            <input
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              placeholder="e.g. Senior - 5-8 yrs"
              className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Active' | 'Draft')}
                className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
              >
                <option>Draft</option>
                <option>Active</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink">Interview length</label>
              <select
                value={interviewLengthMinutes}
                onChange={(e) => setInterviewLengthMinutes(Number(e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink">Key skills (comma-separated)</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. Python, dbt, Snowflake"
              className="w-full rounded-lg border border-border px-3 py-2 text-[13px]"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={handleCreate}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-navy hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create job
          </button>
        </div>
      </div>
    </div>
  );
}

export function JobLibraryView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const navigate = useNavigate();
  const [department, setDepartment] = useState('All departments');
  const [customJobs, setCustomJobs] = useState(() => loadCustomJobs());
  const [showNewJobModal, setShowNewJobModal] = useState(false);

  const allJobs = useMemo(() => [...SAMPLE_JOBS, ...customJobs], [customJobs]);
  const departments = useMemo(() => departmentsFor(allJobs), [allJobs]);
  const candidates = data ?? [];

  const visibleJobs =
    department === 'All departments' ? allJobs : allJobs.filter((j) => j.department === department);

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink-muted">
        Browse open roles across our practice areas and start an interview directly from a listing.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {departments.map((dept) => (
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
          onClick={() => setShowNewJobModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold text-white hover:bg-navy/90"
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
                >
                  Start interview
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showNewJobModal && (
        <NewJobModal
          onClose={() => setShowNewJobModal(false)}
          onCreate={(job) => {
            setCustomJobs(saveCustomJob(job));
            setShowNewJobModal(false);
          }}
        />
      )}
    </div>
  );
}
