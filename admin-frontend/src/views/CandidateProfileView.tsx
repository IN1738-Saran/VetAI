import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Video, MessageSquareText, ListChecks, Download, Check, AlertTriangle } from 'lucide-react';
import { useCandidates } from '@/lib/useCandidates';
import {
  numericScore,
  stageForCandidate,
  buildCandidateTimeline,
  currentStatusMarker,
  type ArtifactsMeta,
  type SessionTimelineMeta,
} from '@/lib/candidateDerived';
import { scoreTone, verdictTone } from '@/lib/badgeClass';
import { setCandidateStatus } from '@/lib/candidateActions';
import { SAMPLE_JOBS, loadCustomJobs, findJobPostingForTitle } from '@/lib/jobLibrary';
import { Badge } from '@/components/Badge';
import { ScoreBar } from '@/components/ScoreBar';
import { NotAvailable } from '@/components/NotAvailable';
import { FeedLoadingSkeleton, FeedErrorState } from '@/components/FeedStates';

type FetchState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

// Generic small-JSON-endpoint fetcher, shared by the two hooks below
// (artifact existence/dates, extracted Strengths/Gaps) - both are
// lightweight, side-effect-free GETs against the new
// /api/candidate-artifacts/:sessionId endpoints, always 200 with a JSON
// body describing what is/isn't available (never a raw report dump).
function useJson<T>(url: string | undefined, label: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ status: 'loading' });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState({ status: 'loading' });

    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'error', message: `${label} request failed (${res.status})` });
          return;
        }
        const data = (await res.json()) as T;
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
  }, [url, label]);

  return state;
}

interface HighlightsResponse {
  configured: boolean;
  found: boolean;
  mode: 'skills' | 'generic';
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  gaps: string[];
}

// Static lookup, not a dynamic `bg-status-${tone}` template string - Tailwind's
// content scanner needs literal class names to avoid purging these in a
// production build (same pattern as DashboardView's STAGE_DOT_CLASS).
const TIMELINE_DOT_CLASS: Record<string, string> = {
  green: 'bg-status-green',
  blue: 'bg-status-blue',
  amber: 'bg-status-amber',
  red: 'bg-status-red',
  gray: 'bg-status-gray',
};

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

// Every download opens in a new tab: this endpoint 404s/500s honestly
// (unconfigured Azure Blob, artifact never generated) with a bare JSON body,
// not a Content-Disposition attachment - a plain same-tab <a> would navigate
// this entire SPA away to show that JSON. See CandidatesView's table links
// for the same fix.
function DownloadLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

// Compact "download only" card for the Profile match report / Interview
// feedback reports - replaces rendering the full raw report on the page
// (too long, hard to scan). `artifact` (from the lightweight
// candidate-artifacts-meta endpoint) tells us whether the report actually
// exists without ever fetching its full body.
type ReportAvailability =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'unconfigured' }
  | { kind: 'missing' }
  | { kind: 'ready'; generatedAt: string | null };

function ReportDownloadCard({
  icon,
  title,
  href,
  availability,
}: {
  icon: ReactNode;
  title: string;
  href: string;
  availability: ReportAvailability;
}) {
  const canDownload = availability.kind === 'ready';

  return (
    <div className="rounded-card bg-card p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {icon} {title}
        </div>
        {canDownload ? (
          <DownloadLink
            href={href}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-navy hover:bg-accent-hover"
          >
            <Download size={13} /> Download PDF
          </DownloadLink>
        ) : (
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-ink-faint"
          >
            <Download size={13} /> Download PDF
          </button>
        )}
      </div>
      <div className="mt-2 text-[12px] text-ink-muted">
        {availability.kind === 'loading' && <span>Checking...</span>}
        {availability.kind === 'error' && <NotAvailable reason="Temporarily unavailable - please try again shortly." />}
        {availability.kind === 'unconfigured' && <NotAvailable reason="Not available in this environment yet." />}
        {availability.kind === 'missing' && <NotAvailable reason="Not generated yet for this candidate." />}
        {availability.kind === 'ready' && (
          <span>
            Ready to download as a PDF
            {availability.generatedAt ? ` - generated ${new Date(availability.generatedAt).toLocaleString()}` : ''}.
          </span>
        )}
      </div>
    </div>
  );
}

function reportAvailability(
  meta: FetchState<ArtifactsMeta>,
  pick: (m: ArtifactsMeta) => { exists: boolean; generatedAt: string | null } | null
): ReportAvailability {
  if (meta.status === 'loading') return { kind: 'loading' };
  if (meta.status === 'error') return { kind: 'error', message: meta.message };
  if (!meta.data.configured) return { kind: 'unconfigured' };
  const artifact = pick(meta.data);
  if (!artifact?.exists) return { kind: 'missing' };
  return { kind: 'ready', generatedAt: artifact.generatedAt };
}

export function CandidateProfileView() {
  const { sessionId } = useParams();
  const { data, isLoading, isError, error, refetch } = useCandidates();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [actionPending, setActionPending] = useState<'reject' | 'shortlist' | null>(null);
  // videoFailed distinguishes "no recording exists / storage unconfigured"
  // from "still loading" - a bare <video> with a 404/500 src just renders an
  // empty black box with no explanation, which is worse than saying so.
  const [videoFailed, setVideoFailed] = useState(false);
  // Called unconditionally, ahead of the isLoading/isError/not-found early
  // returns below, per Rules of Hooks - sessionId (the route param) is the
  // same value candidate.sessionid will resolve to once data loads. `data`
  // itself is already available here (undefined while loading), so the
  // candidate lookup below is safe to do before the early returns - it's a
  // plain computation, not a hook, so ordering rules don't apply to it.
  //
  // Existence/last-modified only (GET /api/candidate-artifacts/:sessionId) -
  // never downloads full report/video content. Powers the Download cards
  // below and the Timeline's real generated-on events.
  const artifactsMeta = useJson<ArtifactsMeta>(
    sessionId ? `/api/candidate-artifacts/${sessionId}` : undefined,
    'Artifacts'
  );

  // Side-effect-free session read (GET /api/candidate-session-timeline/:id) -
  // adds real Resume-uploaded/Interview-link-opened/Interview-started/
  // Interview-completed timestamps to the Timeline below when a session
  // blob exists for this candidate. Deliberately not GET /api/interview/
  // :sessionId, which mutates on every call (see candidateController.js's
  // getCandidateSessionTimeline comment).
  const sessionTimeline = useJson<SessionTimelineMeta>(
    sessionId ? `/api/candidate-session-timeline/${sessionId}` : undefined,
    'Session timeline'
  );

  // If this candidate's real jobtitle matches a Job Library posting, its
  // real required-skill tags are sent along so the backend can return
  // genuine, named Strengths/Gaps (matched/missing against the profile
  // report's actual text) instead of the generic heading-based extraction -
  // see services/reportHighlights.js's matchSkillsAgainstText.
  const candidateForSkillsLookup = (data ?? []).find((c) => c.sessionid === sessionId);
  const matchedJobPosting = candidateForSkillsLookup
    ? findJobPostingForTitle(candidateForSkillsLookup.jobtitle || '', [...SAMPLE_JOBS, ...loadCustomJobs()])
    : undefined;
  const skillsQueryString = matchedJobPosting
    ? `?skills=${encodeURIComponent(matchedJobPosting.tags.join(','))}`
    : '';

  // Strengths/Gaps, computed server-side from the profile report's real
  // text (services/reportHighlights.js) - the browser never fetches the
  // raw report body itself, only this small structured result.
  const highlights = useJson<HighlightsResponse>(
    sessionId ? `/api/candidate-artifacts/${sessionId}/highlights${skillsQueryString}` : undefined,
    'Highlights'
  );

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
  // candidatename/jobtitle for the PDF's own header/filename - see
  // candidateController.js's reportMetaFromQuery (this backend doesn't query
  // n8n's feed itself, so the frontend passes what it already has).
  const reportQuery = `?name=${encodeURIComponent(candidate.candidatename || '')}&role=${encodeURIComponent(
    candidate.jobtitle || ''
  )}&email=${encodeURIComponent(candidate.candidateemail || '')}&interviewDate=${encodeURIComponent(
    candidate.createdat ? new Date(candidate.createdat).toLocaleDateString() : ''
  )}`;
  const profileHref = `/api/download-profile/${candidate.sessionid}${reportQuery}`;
  const feedbackHref = `/api/download-feedback/${candidate.sessionid}${reportQuery}`;
  const timeline = buildCandidateTimeline(
    candidate,
    artifactsMeta.status === 'ready' ? artifactsMeta.data : null,
    sessionTimeline.status === 'ready' ? sessionTimeline.data : null
  );
  const liveMarker = currentStatusMarker(candidate);

  // candidate is proven defined by the early return above - this closure is
  // recreated every render, so the assertion is safe, not just convenient.
  async function handleDecision(kind: 'reject' | 'shortlist') {
    const confirmed = window.confirm(
      `Set status to "${kind === 'reject' ? 'Rejected' : 'Shortlisted'}" for ${candidate!.candidatename}?`
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
              <Badge tone={stageForCandidate(candidate).tone}>{stageForCandidate(candidate).label}</Badge>
            </div>
            <div className="mt-0.5 text-[13px] text-ink-muted">
              {candidate.jobtitle || 'N/A'} - {candidate.candidateemail || 'N/A'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DownloadLink
            href={profileHref}
            className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Download report (PDF)
          </DownloadLink>
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
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-navy hover:bg-accent-hover disabled:opacity-50"
          >
            {actionPending === 'shortlist' ? 'Shortlisting...' : 'Shortlist'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-1 text-[14px] font-semibold text-ink">Match breakdown</div>
            <p className="mb-4 text-[12px] text-ink-muted">
              Scored against {candidate.jobtitle || 'N/A'}
            </p>
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
            <NotAvailable reason="Individual skill scores aren't available yet - only the overall match score is." />
          </div>

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <MessageSquareText size={16} /> What the score is based on
            </div>
            <p className="mb-3 text-[12px] text-ink-muted">Summary from the scoring engine</p>
            {candidate.summary ? (
              <p className="text-[13px] leading-relaxed text-ink">{candidate.summary}</p>
            ) : (
              <NotAvailable reason="No summary is available for this candidate." />
            )}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-status-green-text">
                  Strengths
                </div>
                {highlights.status === 'loading' && (
                  <p className="text-[12px] text-ink-muted">Loading...</p>
                )}
                {highlights.status === 'error' && (
                  <NotAvailable reason="Temporarily unavailable - please try again shortly." />
                )}
                {highlights.status === 'ready' &&
                  ((highlights.data.strengths ?? []).length > 0 ? (
                    <ul className="space-y-1.5">
                      {highlights.data.strengths.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] text-ink">
                          {highlights.data.mode === 'skills' ? (
                            <>
                              <Check size={14} className="mt-0.5 shrink-0 text-status-green-text" /> {item}
                            </>
                          ) : (
                            <>
                              <span className="text-status-green-text">•</span> {item}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <NotAvailable
                      reason={
                        highlights.data.found
                          ? 'No specific strengths were called out in the profile report.'
                          : 'Available once a profile match report has been generated.'
                      }
                    />
                  ))}
              </div>
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-status-amber-text">
                  Gaps against the JD
                </div>
                {highlights.status === 'loading' && (
                  <p className="text-[12px] text-ink-muted">Loading...</p>
                )}
                {highlights.status === 'error' && (
                  <NotAvailable reason="Temporarily unavailable - please try again shortly." />
                )}
                {highlights.status === 'ready' &&
                  ((highlights.data.gaps ?? []).length > 0 ? (
                    <ul className="space-y-1.5">
                      {highlights.data.gaps.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] text-ink">
                          {highlights.data.mode === 'skills' ? (
                            <>
                              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-amber-text" />{' '}
                              {item} - required, not evidenced
                            </>
                          ) : (
                            <>
                              <span className="text-status-amber-text">•</span> {item}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <NotAvailable
                      reason={
                        highlights.data.found
                          ? 'No specific gaps were called out in the profile report.'
                          : 'Available once a profile match report has been generated.'
                      }
                    />
                  ))}
              </div>
            </div>
          </div>

          <ReportDownloadCard
            icon={<FileText size={16} />}
            title="Profile match report"
            href={profileHref}
            availability={reportAvailability(artifactsMeta, (m) => m.profile)}
          />

          <ReportDownloadCard
            icon={<FileText size={16} />}
            title="Interview feedback report"
            href={feedbackHref}
            availability={reportAvailability(artifactsMeta, (m) => m.feedback)}
          />

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <Video size={16} /> Interview recording
            </div>
            {videoFailed ? (
              <NotAvailable reason="No recording is available for this candidate." />
            ) : (
              <video
                controls
                className="w-full rounded-lg bg-navy"
                src={`/api/download-video/${candidate.sessionid}`}
                onError={() => setVideoFailed(true)}
              >
                Your browser does not support video playback.
              </video>
            )}
            <p className="mt-2 text-[12px] text-ink-faint">
              Chapter markers aren't available yet, and the recording needs to fully load before you can
              skip ahead.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-3 text-[14px] font-semibold text-ink">Timeline</div>
            {artifactsMeta.status === 'loading' && (
              <p className="text-[13px] text-ink-muted">Loading timeline...</p>
            )}
            {(timeline.length > 0 || liveMarker) && (
              <ul className="relative space-y-4 border-l border-border pl-4 text-[13px]">
                {timeline.map((event) => (
                  <li key={`${event.label}-${event.timestamp}`} className="relative" title={event.basis}>
                    <span
                      className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card ${TIMELINE_DOT_CLASS[event.tone]}`}
                    />
                    <div className="text-ink">{event.label}</div>
                    <div className="text-ink-muted">{new Date(event.timestamp).toLocaleString()}</div>
                  </li>
                ))}
                {liveMarker && (
                  <li className="relative" title={liveMarker.basis}>
                    <span
                      className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card ${TIMELINE_DOT_CLASS[liveMarker.tone]}`}
                    />
                    <div className="text-ink">{liveMarker.label}</div>
                    <div className="text-ink-muted">Now</div>
                  </li>
                )}
              </ul>
            )}
            {timeline.length === 0 && !liveMarker && artifactsMeta.status !== 'loading' && (
              <NotAvailable reason="No activity has been recorded for this candidate yet." />
            )}
            {timeline.length > 0 && sessionTimeline.status === 'ready' && !sessionTimeline.data.found && (
              <p className="mt-3 text-[11px] text-ink-faint">
                Some earlier milestones, like when the invite was first opened, aren't tracked for this
                candidate.
              </p>
            )}
          </div>

          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="mb-1 text-[14px] font-semibold text-ink">Your notes</div>
            <p className="mb-3 text-[12px] text-ink-faint">Private to you - not saved yet</p>
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
                <DownloadLink
                  className="flex items-center gap-2 text-ink hover:underline"
                  href={`/api/download-video/${candidate.sessionid}`}
                >
                  <Video size={14} /> Interview recording
                </DownloadLink>
              </li>
              <li>
                <DownloadLink
                  className="flex items-center gap-2 text-ink hover:underline"
                  href={`/api/download-questions/${candidate.sessionid}`}
                >
                  <FileText size={14} /> Question list
                </DownloadLink>
              </li>
            </ul>
            <p className="mt-2 text-[12px] text-ink-faint">
              Profile match and feedback reports are available above. Links here open in a new tab.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
