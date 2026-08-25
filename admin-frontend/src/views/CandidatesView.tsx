import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { X, Download, Video, FileText, ListChecks, Trash2, RefreshCw } from 'lucide-react';
import { useCandidates } from '@/lib/useCandidates';
import { useQueryClient } from '@tanstack/react-query';
import type { RawCandidate } from '@/lib/candidates';
import {
  computeSavedViews,
  filterBySavedView,
  matchesSearch,
  stageForCandidate,
  type SavedViewId,
} from '@/lib/candidateDerived';
import { scoreTone, verdictTone } from '@/lib/badgeClass';
import { scheduleSelected, deleteCandidate } from '@/lib/candidateActions';
import { Badge } from '@/components/Badge';
import { ScoreBar } from '@/components/ScoreBar';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { FeedLoadingSkeleton, FeedErrorState, FeedEmptyState } from '@/components/FeedStates';

const PAGE_SIZE = 10;

export function CandidatesView() {
  const { data, isLoading, isError, error, refetch, isFetching } = useCandidates();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = searchParams.get('q') ?? '';

  const [view, setView] = useState<SavedViewId>('all');
  const [jobTitleFilter, setJobTitleFilter] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [scheduling, setScheduling] = useState(false);
  // Per-row Create Interview / Delete pending state - keyed by sessionid so
  // one row's in-flight action doesn't disable the whole table.
  const [rowPending, setRowPending] = useState<Record<string, 'schedule' | 'delete'>>({});

  // Old_Version's dashboard.html sorts this same table by Created At,
  // descending, by default (`$('#candidatesTable').DataTable({ order:
  // [[7, 'desc']] })`, column 7 being createdat) - without that, a newly
  // created candidate can land anywhere in n8n's own feed order and never
  // surface near the top of "All candidates". Sorting the base list once
  // keeps every saved view (Needs review, Awaiting interview, ...)
  // consistently most-recent-first too, matching that same real behavior.
  const candidates = useMemo(() => {
    return [...(data ?? [])].sort((a, b) => {
      const at = a.createdat ? new Date(a.createdat).getTime() : 0;
      const bt = b.createdat ? new Date(b.createdat).getTime() : 0;
      return bt - at;
    });
  }, [data]);
  const savedViews = useMemo(() => computeSavedViews(candidates), [candidates]);
  const jobTitles = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.jobtitle || 'Unknown'))).sort(),
    [candidates]
  );

  const filtered = useMemo(() => {
    let rows = filterBySavedView(candidates, view);
    if (jobTitleFilter) rows = rows.filter((c) => (c.jobtitle || 'Unknown') === jobTitleFilter);
    if (searchQuery) rows = rows.filter((c) => matchesSearch(c, searchQuery));
    return rows;
  }, [candidates, view, jobTitleFilter, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function clearSearch() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      return next;
    });
    setPage(1);
  }

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
      `Send interview invitations to ${rows.length} candidate${rows.length > 1 ? 's' : ''}?`
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

  // Single-row equivalent of handleScheduleSelected above - reuses the same
  // scheduleSelected() (two-step: n8n createinterview, then update-session-
  // dates), just called with a one-item array instead of the checkbox
  // selection. Ported from dashboard.html's per-row "Create Interview"
  // button (renderCreateInterviewButton/createInterview(index)).
  async function handleCreateInterviewRow(candidate: RawCandidate) {
    if (rowPending[candidate.sessionid]) return;
    const confirmed = window.confirm(
      `Send an interview invitation to ${candidate.candidatename || 'this candidate'}?`
    );
    if (!confirmed) return;

    setRowPending((prev) => ({ ...prev, [candidate.sessionid]: 'schedule' }));
    try {
      const [result] = await scheduleSelected([candidate]);
      if (!result.ok) {
        window.alert(`Failed to create interview: ${result.error}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ['candidates'] });
      }
    } finally {
      setRowPending((prev) => {
        const next = { ...prev };
        delete next[candidate.sessionid];
        return next;
      });
    }
  }

  // Ported from dashboard.html's deleteCandidate(sessionId): confirm, call
  // the real DELETE endpoint, surface the result. On success we remove the
  // row from the cached feed directly (setQueryData) rather than
  // invalidating/refetching - the delete only touches Postgres/Azure, not
  // n8n's own dataentry store, so an immediate refetch could still return
  // the just-deleted row if n8n hasn't caught up yet. The next natural
  // refetch (navigation/refocus) will reconcile either way.
  async function handleDeleteRow(candidate: RawCandidate) {
    if (rowPending[candidate.sessionid]) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete ${candidate.candidatename || 'this candidate'}?\n\n` +
        'This action cannot be undone.'
    );
    if (!confirmed) return;

    setRowPending((prev) => ({ ...prev, [candidate.sessionid]: 'delete' }));
    try {
      await deleteCandidate(candidate.sessionid);
      queryClient.setQueryData<RawCandidate[]>(['candidates'], (old) =>
        old ? old.filter((c) => c.sessionid !== candidate.sessionid) : old
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete candidate');
    } finally {
      setRowPending((prev) => {
        const next = { ...prev };
        delete next[candidate.sessionid];
        return next;
      });
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
      className: 'max-w-[220px]',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink" title={row.candidatename || 'N/A'}>
            {row.candidatename || 'N/A'}
          </div>
          <div className="truncate text-[12px] text-ink-muted" title={row.candidateemail || 'N/A'}>
            {row.candidateemail || 'N/A'}
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      className: 'max-w-[200px]',
      render: (row) => (
        <span className="line-clamp-2 text-[13px]" title={row.jobtitle || 'N/A'}>
          {row.jobtitle || 'N/A'}
        </span>
      ),
    },
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
      key: 'stage',
      header: 'Stage',
      render: (row) => {
        const stage = stageForCandidate(row);
        return <Badge tone={stage.tone}>{stage.label}</Badge>;
      },
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (row) => {
        const ts = row.updatedat || row.createdat;
        return ts ? new Date(ts).toLocaleDateString() : 'N/A';
      },
    },
    // The four columns below restore dashboard.html's per-row artifact/
    // action buttons (Profile Status / Interview Video / Interview Feedback
    // / Actions), which existed in the old table but had no equivalent in
    // this view previously - only the Candidate Profile detail page had
    // them. `target="_blank"` (not in the old plain-`<a>` version) is a
    // small, deliberate improvement: inside a data table, a 404 response
    // (no Content-Disposition header) would otherwise navigate the whole
    // SPA away to a bare JSON error page instead of just failing quietly in
    // a new tab.
    {
      key: 'profileStatus',
      header: 'Profile Status',
      render: (row) => (
        <a
          href={`/api/download-profile/${row.sessionid}?name=${encodeURIComponent(row.candidatename || '')}&role=${encodeURIComponent(row.jobtitle || '')}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-surface"
        >
          <Download size={13} /> Download
        </a>
      ),
    },
    {
      key: 'interviewVideo',
      header: 'Interview Video',
      render: (row) => (
        <a
          href={`/api/download-video/${row.sessionid}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-surface"
        >
          <Video size={13} /> Download
        </a>
      ),
    },
    {
      key: 'interviewFeedback',
      header: 'Interview Feedback',
      render: (row) => (
        <div className="flex flex-col items-start gap-1.5">
          <a
            href={`/api/download-feedback/${row.sessionid}?name=${encodeURIComponent(row.candidatename || '')}&role=${encodeURIComponent(row.jobtitle || '')}&email=${encodeURIComponent(row.candidateemail || '')}&interviewDate=${encodeURIComponent(row.createdat ? new Date(row.createdat).toLocaleDateString() : '')}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-ink hover:underline"
          >
            <FileText size={13} /> Download
          </a>
          <a
            href={`/api/download-questions/${row.sessionid}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-ink hover:underline"
          >
            <ListChecks size={13} /> Questions
          </a>
        </div>
      ),
    },
    {
      key: 'rowActions',
      header: 'Actions',
      render: (row) => {
        const pending = rowPending[row.sessionid];
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={!!pending}
              onClick={() => handleCreateInterviewRow(row)}
              className="whitespace-nowrap rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-navy hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === 'schedule' ? 'Sending...' : 'Create Interview'}
            </button>
            <button
              type="button"
              disabled={!!pending}
              onClick={() => handleDeleteRow(row)}
              title="Delete candidate"
              aria-label={`Delete ${row.candidatename || 'candidate'}`}
              className="rounded-lg border border-status-red px-2.5 py-1.5 text-status-red-text hover:bg-status-red-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === 'delete' ? <span className="text-[11px]">...</span> : <Trash2 size={14} />}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {searchQuery && (
        <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[13px] text-ink">
          Searching for <strong>&quot;{searchQuery}&quot;</strong>
          <button type="button" onClick={clearSearch} className="ml-1 text-ink-muted hover:text-ink">
            <X size={14} />
          </button>
          <span className="ml-auto text-ink-muted">{filtered.length} match(es)</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
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

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={jobTitleFilter}
              onChange={(e) => {
                setJobTitleFilter(e.target.value);
                setPage(1);
              }}
              className="max-w-[220px] rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-ink"
            >
              <option value="">All roles</option>
              {jobTitles.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refetch the real candidates feed"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
              {isFetching ? 'Refreshing...' : 'Refresh'}
            </button>

            <div className="ml-auto">
              <button
                type="button"
                disabled={selected.size === 0 || scheduling}
                onClick={handleScheduleSelected}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-navy hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
    </div>
  );
}
