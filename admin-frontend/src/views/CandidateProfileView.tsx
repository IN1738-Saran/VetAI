import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Video, MessageSquareText, ListChecks } from 'lucide-react';
import { useCandidates } from '@/lib/useCandidates';
import { numericScore } from '@/lib/candidateDerived';
import { scoreTone, verdictTone, statusTone } from '@/lib/badgeClass';
import { setCandidateStatus } from '@/lib/candidateActions';
import { Badge } from '@/components/Badge';
import { ScoreBar } from '@/components/ScoreBar';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState } from '@/components/FeedStates';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Single-value radial gauge for the overall score - distinct from the
// multi-slice Donut (used for Analytics outcome breakdowns), so kept local
// rather than forced into a shared component for a single caller.
function OverallScoreRing({ value, tone }: { value: number | null; tone: string }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const strokeMap: Record<string, string> = {
    green: '#16A34A',
    blue: '#2563EB',
    amber: '#D97706',
    red: '#DC2626',
    gray: '#9CA3AF',
  };

  return (
    <div className="relative flex h-[140px] w-[140px] items-center justify-center">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#E7E9ED" strokeWidth="10" />
        {value !== null && (
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={strokeMap[tone]}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (pct / 100) * c}
          />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-ink">{value ?? '-'}</span>
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">Overall</span>
      </div>
    </div>
  );
}

export function CandidateProfileView() {
  const { sessionId } = useParams();
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [actionPending, setActionPending] = useState<'reject' | 'shortlist' | null>(null);

  if (isLoading) return <FeedLoadingSkeleton />;
  if (isError) return <FeedErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const candidate = (data ?? []).find((c) => c.sessionid === sessionId);
  if (!candidate) {
    return (
      <div className="rounded-card bg-card p-8 text-center text-[13px] text-ink-muted shadow-card">
        No candidate found for this session id in the current feed.
      </div>
    );
  }

  const score = numericScore(candidate);

  // candidate is proven defined by the early return above - this closure is
  // recreated every render, so the assertion is safe, not just convenient.
  async function handleDecision(kind: 'reject' | 'shortlist') {
    const confirmed = window.confirm(
      `Set status to "${kind === 'reject' ? 'Rejected' : 'Shortlisted'}" for ${candidate!.candidatename}? ` +
        'This calls the real n8n vetaiupdate webhook.'
    );
    if (!confirmed) return;

    setActionPending(kind);
    try {
      await setCandidateStatus(candidate!.sessionid, kind === 'reject' ? 'Rejected' : 'Shortlisted');
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setActionPending(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between rounded-card bg-card p-5 shadow-card">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-navy text-[14px] font-semibold text-white">
            {initials(candidate.candidatename || '?')}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[17px] font-semibold text-ink">{candidate.candidatename || 'N/A'}</span>
              <Badge tone={verdictTone(candidate.verdict)}>{candidate.verdict || 'N/A'}</Badge>
              <Badge tone={statusTone(candidate.status)}>{candidate.status || 'N/A'}</Badge>
            </div>
            <div className="mt-0.5 text-[13px] text-ink-muted">
              {candidate.jobtitle || 'N/A'} - {candidate.candidateemail || 'N/A'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/download-profile/${candidate.sessionid}`}
            className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Download report
          </a>
          <button
            type="button"
            disabled={actionPending !== null}
            onClick={() => handleDecision('reject')}
            className="rounded-lg border border-status-red px-3 py-2 text-[13px] font-medium text-status-red-text hover:bg-status-red-bg disabled:opacity-50"
          >
            {actionPending === 'reject' ? 'Rejecting...' : 'Reject'}
          </button>
          <button
            type="button"
            disabled={actionPending !== null}
            onClick={() => handleDecision('shortlist')}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {actionPending === 'shortlist' ? 'Shortlisting...' : 'Shortlist'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center gap-6">
              <OverallScoreRing value={score} tone={scoreTone(candidate.overall_score)} />
              <div className="flex-1 space-y-3">
                <ScoreBar label="Overall match" value={score} tone={scoreTone(candidate.overall_score)} />
                <ScoreBar label="Skills match" value={null} />
                <ScoreBar label="Experience fit" value={null} />
                <ScoreBar label="Communication" value={null} />
                <ScoreBar label="Problem solving" value={null} />
                <ScoreBar label="Culture fit" value={null} />
              </div>
            </div>
            <NotAvailable reason="only an overall score exists in the real feed - per-dimension sub-scores are not returned by webhook/dataentry" />
          </div>

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <MessageSquareText size={16} /> What the score is based on
            </div>
            {candidate.summary ? (
              <p className="text-[13px] leading-relaxed text-ink">{candidate.summary}</p>
            ) : (
              <NotAvailable reason="no summary text on this record" />
            )}
            <div className="mt-3">
              <NotAvailable reason="strengths/gaps lists are not returned by webhook/dataentry" />
            </div>
          </div>

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <Video size={16} /> Interview recording
            </div>
            <video
              controls
              className="w-full rounded-lg bg-navy"
              src={`/api/download-video/${candidate.sessionid}`}
            >
              Your browser does not support video playback.
            </video>
            <p className="mt-2 text-[12px] text-ink-faint">
              Not available: question-timestamp markers on the scrub bar (transcript timestamps are not
              exposed by this data source, and the video endpoint does not support HTTP range requests, so
              seeking is only possible once the file has buffered).
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-3 text-[14px] font-semibold text-ink">Timeline</div>
            <ul className="space-y-2 text-[13px]">
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-status-green" />
                <span className="text-ink">Created</span>
                <span className="ml-auto text-ink-muted">
                  {candidate.createdat ? new Date(candidate.createdat).toLocaleString() : 'N/A'}
                </span>
              </li>
              {candidate.updatedat && candidate.updatedat !== candidate.createdat && (
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-status-blue" />
                  <span className="text-ink">Last updated</span>
                  <span className="ml-auto text-ink-muted">
                    {new Date(candidate.updatedat).toLocaleString()}
                  </span>
                </li>
              )}
            </ul>
            <div className="mt-3">
              <NotAvailable reason="first-accessed/invitation-sent/started/completed events require calling GET /api/interview/:sessionId, which has side effects unsafe for a recruiter view (marks first-access, and 410s once completed) - see Phase 4 report" />
            </div>
          </div>

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-1 text-[14px] font-semibold text-ink">Your notes</div>
            <p className="mb-3 text-[12px] text-ink-faint">Private to you - not saved (no notes endpoint exists yet)</p>
            <ul className="mb-3 space-y-2">
              {notes.map((n, i) => (
                <li key={i} className="rounded-lg bg-surface px-3 py-2 text-[13px] text-ink">
                  {n}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim()) {
                    setNotes((prev) => [...prev, draft.trim()]);
                    setDraft('');
                  }
                }}
                placeholder="Add a note..."
                className="flex-1 rounded-lg border border-border px-3 py-2 text-[13px]"
              />
            </div>
          </div>

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <ListChecks size={16} /> Files
            </div>
            <ul className="space-y-2 text-[13px]">
              <li>
                <a className="flex items-center gap-2 text-ink hover:underline" href={`/api/download-profile/${candidate.sessionid}`}>
                  <FileText size={14} /> Profile match report
                </a>
              </li>
              <li>
                <a className="flex items-center gap-2 text-ink hover:underline" href={`/api/download-video/${candidate.sessionid}`}>
                  <Video size={14} /> Interview recording
                </a>
              </li>
              <li>
                <a className="flex items-center gap-2 text-ink hover:underline" href={`/api/download-feedback/${candidate.sessionid}`}>
                  <FileText size={14} /> Feedback
                </a>
              </li>
              <li>
                <a className="flex items-center gap-2 text-ink hover:underline" href={`/api/download-questions/${candidate.sessionid}`}>
                  <FileText size={14} /> Question list
                </a>
              </li>
            </ul>
            <p className="mt-2 text-[12px] text-ink-faint">Links 404 gracefully if the artifact was never generated for this session.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
