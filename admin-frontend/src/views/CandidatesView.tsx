import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useCandidates } from '@/lib/useCandidates';
import { useQueryClient } from '@tanstack/react-query';
import type { RawCandidate } from '@/lib/candidates';
import { computeSavedViews, filterBySavedView, type SavedViewId } from '@/lib/candidateDerived';
import { scoreTone, verdictTone, statusTone } from '@/lib/badgeClass';
import { scheduleSelected } from '@/lib/candidateActions';
import { Badge } from '@/components/Badge';
import { ScoreBar } from '@/components/ScoreBar';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { FeedLoadingSkeleton, FeedErrorState, FeedEmptyState } from '@/components/FeedStates';

const PAGE_SIZE = 10;

export function CandidatesView() {
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [view, setView] = useState<SavedViewId>('all');
  const [jobTitleFilter, setJobTitleFilter] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [scheduling, setScheduling] = useState(false);

  const candidates = data ?? [];
  const savedViews = useMemo(() => computeSavedViews(candidates), [candidates]);
  const jobTitles = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.jobtitle || 'Unknown'))).sort(),
    [candidates]
  );

  const filtered = useMemo(() => {
    let rows = filterBySavedView(candidates, view);
    if (jobTitleFilter) rows = rows.filter((c) => (c.jobtitle || 'Unknown') === jobTitleFilter);
    return rows;
  }, [candidates, view, jobTitleFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleRow(sessionid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionid)) next.delete(sessionid);
      else next.add(sessionid);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = pageRows.every((r) => next.has(r.sessionid));
      for (const r of pageRows) {
        if (allSelected) next.delete(r.sessionid);
        else next.add(r.sessionid);
      }
      return next;
    });
  }

  async function handleScheduleSelected() {
    const rows = candidates.filter((c) => selected.has(c.sessionid));
    if (rows.length === 0) return;

    const confirmed = window.confirm(
      `Send/reset interview invitations for ${rows.length} candidate${rows.length > 1 ? 's' : ''}? ` +
        'This calls the real n8n createinterview webhook for each one.'
    );
    if (!confirmed) return;

    setScheduling(true);
    try {
      const results = await scheduleSelected(rows);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        window.alert(
          `${results.length - failed.length}/${results.length} succeeded. Failed: ` +
            failed.map((f) => f.candidatename).join(', ')
        );
      }
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    } finally {
      setScheduling(false);
    }
  }

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (candidates.length === 0) return <FeedEmptyState />;

  const columns: DataTableColumn<RawCandidate>[] = [
    {
      key: 'select',
      header: '',
      className: 'w-8',
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.sessionid)}
          onChange={() => toggleRow(row.sessionid)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${row.candidatename}`}
        />
      ),
    },
    {
      key: 'candidate',
      header: 'Candidate',
      render: (row) => (
        <div>
          <div className="font-medium text-ink">{row.candidatename || 'N/A'}</div>
          <div className="text-[12px] text-ink-muted">{row.candidateemail || 'N/A'}</div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (row) => row.jobtitle || 'N/A' },
    {
      key: 'score',
      header: 'Match score',
      render: (row) => {
        const raw = row.overall_score;
        const value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
        return <ScoreBar value={value} tone={scoreTone(raw)} compact />;
      },
    },
    {
      key: 'verdict',
      header: 'Verdict',
      render: (row) => <Badge tone={verdictTone(row.verdict)}>{row.verdict || 'N/A'}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={statusTone(row.status)}>{row.status || 'N/A'}</Badge>,
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (row) => (row.createdat ? new Date(row.createdat).toLocaleString() : 'N/A'),
    },
  ];

  return (
    <div className="grid grid-cols-[220px_1fr] gap-5">
      <aside className="space-y-1">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Views
        </div>
        {savedViews.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              setView(v.id);
              setPage(1);
            }}
            title={v.basis}
            className={clsx(
              'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]',
              view === v.id ? 'bg-navy text-white' : 'text-ink hover:bg-surface'
            )}
          >
            <span>{v.label}</span>
            <span className={clsx('text-[12px]', view === v.id ? 'text-white/70' : 'text-ink-faint')}>
              {v.count ?? '-'}
            </span>
          </button>
        ))}
      </aside>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={jobTitleFilter}
            onChange={(e) => {
              setJobTitleFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink"
          >
            <option value="">All roles</option>
            {jobTitles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <div className="ml-auto">
            <button
              type="button"
              disabled={selected.size === 0 || scheduling}
              onClick={handleScheduleSelected}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scheduling ? 'Scheduling...' : `Schedule ${selected.size} selected`}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.sessionid))}
            onChange={toggleAllOnPage}
            aria-label="Select all on this page"
          />
          <span className="text-[12px] text-ink-muted">Select all on this page</span>
        </div>

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.sessionid}
          emptyState="No candidates match this view."
          onRowClick={(row) => navigate(`/candidates/${row.sessionid}`)}
        />

        <div className="flex items-center justify-between text-[13px] text-ink-muted">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
