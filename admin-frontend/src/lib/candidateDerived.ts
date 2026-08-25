// Client-side aggregation over the real candidates feed. A live Phase 3
// smoke test (2,903 real records, inspected 2026-08-13) confirmed the exact
// verdict/status vocabulary in production - see badgeClass.ts's header
// comment for the full value counts. Every function below is written
// against those real values, not a guess. Where the reference UI shows
// something this data source genuinely cannot support (interview
// scheduling times, a pipeline-stage field, an "AI recommended" flag, a
// "shortlisted" concept - none of which exist anywhere in the real
// payload), the corresponding function returns null/empty and the view
// renders an explicit "not available" state (plan section 4.3).
import type { RawCandidate } from './candidates';
import { verdictTone } from './badgeClass';
import type { SemanticTone } from '@/types';

export function numericScore(c: RawCandidate): number | null {
  if (c.overall_score === null || c.overall_score === undefined || c.overall_score === '') return null;
  const n = typeof c.overall_score === 'string' ? parseFloat(c.overall_score) : c.overall_score;
  return Number.isNaN(n) ? null : n;
}

function isSameCalendarDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Pass rule: score 70+ and Fit or better" - taken directly from the
// Analytics reference screenshot's own caption under Interview outcomes,
// now applicable because the real verdict enum (strong_fit/fit/borderline/
// weak_fit/reject) confirms what "Fit or better" means.
export function isPassing(c: RawCandidate): boolean {
  const score = numericScore(c);
  const normalized = (c.verdict || '').trim().toLowerCase();
  return score !== null && score >= 70 && (normalized === 'strong_fit' || normalized === 'fit');
}

export interface DashboardKpis {
  totalCount: number;
  newToday: number;
  averageScore: number | null;
  passRate: number | null; // percentage 0-100 - see isPassing()
  needsReviewCount: number; // verdict === 'borderline'
}

export function computeDashboardKpis(candidates: RawCandidate[]): DashboardKpis {
  const totalCount = candidates.length;
  const now = new Date();

  const newToday = candidates.filter((c) => {
    if (!c.createdat) return false;
    const d = new Date(c.createdat);
    return !Number.isNaN(d.getTime()) && isSameCalendarDay(d, now);
  }).length;

  const scores = candidates.map(numericScore).filter((n): n is number => n !== null);
  const averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  const scored = candidates.filter((c) => numericScore(c) !== null);
  const passRate = scored.length
    ? Math.round((scored.filter(isPassing).length / scored.length) * 100)
    : null;

  const needsReviewCount = candidates.filter((c) => verdictTone(c.verdict) === 'amber').length;

  return { totalCount, newToday, averageScore, passRate, needsReviewCount };
}

export interface RoleVolume {
  jobtitle: string;
  count: number;
  averageScore: number | null;
}

export function topRolesByVolume(candidates: RawCandidate[], limit = 8): RoleVolume[] {
  const groups = new Map<string, RawCandidate[]>();
  for (const c of candidates) {
    const key = c.jobtitle || 'Unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  return Array.from(groups.entries())
    .map(([jobtitle, group]) => {
      const scores = group.map(numericScore).filter((n): n is number => n !== null);
      return {
        jobtitle,
        count: group.length,
        averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Used by Job Library to show a real candidate count/avg score next to each
// sample job card, by matching the sample job's title against the real
// feed's free-text jobtitle field. Case/whitespace-insensitive because real
// titles have observed variants (e.g. "Senior Data Engineer (DBT & Snowflake)"
// vs "Senior Data Engineer (DBT  & Snowflake)" - a double space) - this is
// an approximate match against messy free text, not an exact key lookup.
export function statsForJobTitle(candidates: RawCandidate[], jobtitle: string): RoleVolume {
  const normalized = jobtitle.trim().toLowerCase().replace(/\s+/g, ' ');
  const matches = candidates.filter(
    (c) => (c.jobtitle || '').trim().toLowerCase().replace(/\s+/g, ' ') === normalized
  );
  const scores = matches.map(numericScore).filter((n): n is number => n !== null);
  return {
    jobtitle,
    count: matches.length,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  };
}

export type SavedViewId =
  | 'all'
  | 'needs-review'
  | 'ai-recommended'
  | 'shortlisted'
  | 'awaiting-interview'
  | 'completed'
  | 'rejected';

export interface SavedView {
  id: SavedViewId;
  label: string;
  /** null = not derivable from the current data source (rendered as "-" in the UI). */
  count: number | null;
  /** Shown on hover - the exact real-value match this bucket is based on. */
  basis: string;
}

function normalizedVerdict(c: RawCandidate) {
  return (c.verdict || '').trim().toLowerCase();
}
function normalizedStatus(c: RawCandidate) {
  return (c.status || '').trim().toLowerCase();
}

export interface Stage {
  label: string;
  tone: SemanticTone;
}

// A per-row "Stage" derived from the same real verdict/status fields that
// already power the saved-view buckets above (same categorization, just
// exposed per-candidate instead of as a count) - not a new/fabricated field.
// Replaces showing the raw status text as its own column, matching the
// reference UI's Candidates table (Candidate/Role/Score/Verdict/Stage/
// Updated - no separate raw-status column).
export function stageForCandidate(c: RawCandidate): Stage {
  const verdict = normalizedVerdict(c);
  const status = normalizedStatus(c);

  if (verdict === 'reject') return { label: 'Blocked', tone: 'red' };
  if (verdict === 'borderline') return { label: 'Needs review', tone: 'amber' };
  if (status === 'interview completed') return { label: 'Completed', tone: 'green' };
  if (status === 'interview scheduled') return { label: 'Interview scheduled', tone: 'amber' };
  if (status === 'interview not scheduled') return { label: 'Awaiting interview', tone: 'blue' };
  return { label: 'Reviewed', tone: 'gray' };
}

// Case-insensitive substring match against name/email/job title - powers
// the real TopBar search (plan: "reuse existing... no fake search over a
// hardcoded array" - this runs over the already-fetched real feed).
export function matchesSearch(c: RawCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (c.candidatename || '').toLowerCase().includes(q) ||
    (c.candidateemail || '').toLowerCase().includes(q) ||
    (c.jobtitle || '').toLowerCase().includes(q)
  );
}

// Real, derivable count for the "N candidates cannot be scheduled" banner -
// candidateemail is a proven field on every record; some are genuinely empty.
export function candidatesMissingEmail(candidates: RawCandidate[]): RawCandidate[] {
  return candidates.filter((c) => !c.candidateemail || !c.candidateemail.trim());
}

// Bucket definitions match the real, confirmed enum values exactly (see
// badgeClass.ts). "Shortlisted" and "AI recommended" are marked not
// available: the real status field has exactly 3 values (Interview
// Scheduled / Not Scheduled / Completed) with no shortlisting concept, and
// no recommendation flag exists anywhere in the payload - showing 0 for
// either would misrepresent "this concept doesn't exist" as "nobody
// qualifies," which is a different, false claim.
export function computeSavedViews(candidates: RawCandidate[]): SavedView[] {
  const count = (pred: (c: RawCandidate) => boolean) => candidates.filter(pred).length;

  return [
    { id: 'all', label: 'All candidates', count: candidates.length, basis: 'Everyone in the system' },
    {
      id: 'needs-review',
      label: 'Needs review',
      count: count((c) => normalizedVerdict(c) === 'borderline'),
      basis: 'Candidates flagged as a borderline fit',
    },
    {
      id: 'ai-recommended',
      label: 'AI recommended',
      count: null,
      basis: 'Not tracked yet',
    },
    {
      id: 'shortlisted',
      label: 'Shortlisted',
      count: null,
      basis: 'Not tracked yet',
    },
    {
      id: 'awaiting-interview',
      label: 'Awaiting interview',
      count: count((c) => normalizedStatus(c) === 'interview not scheduled'),
      basis: 'Candidates awaiting an interview invite',
    },
    {
      id: 'completed',
      label: 'Completed',
      count: count((c) => normalizedStatus(c) === 'interview completed'),
      basis: 'Candidates who completed their interview',
    },
    {
      id: 'rejected',
      label: 'Rejected',
      count: count((c) => normalizedVerdict(c) === 'reject'),
      basis: 'Candidates marked as not a fit',
    },
  ];
}

export function filterBySavedView(candidates: RawCandidate[], view: SavedViewId): RawCandidate[] {
  switch (view) {
    case 'all':
      return candidates;
    case 'needs-review':
      return candidates.filter((c) => normalizedVerdict(c) === 'borderline');
    case 'ai-recommended':
    case 'shortlisted':
      return []; // not derivable - see computeSavedViews
    case 'awaiting-interview':
      return candidates.filter((c) => normalizedStatus(c) === 'interview not scheduled');
    case 'completed':
      return candidates.filter((c) => normalizedStatus(c) === 'interview completed');
    case 'rejected':
      return candidates.filter((c) => normalizedVerdict(c) === 'reject');
    default:
      return candidates;
  }
}

// -- Analytics-specific aggregations --------------------------------------

export interface OutcomeBreakdown {
  passed: number;
  needsReview: number;
  notPassed: number;
}

// Same "score 70+ and Fit or better" pass rule as computeDashboardKpis,
// partitioned into exactly the 3 buckets the Analytics reference shows.
export function computeOutcomes(candidates: RawCandidate[]): OutcomeBreakdown {
  let passed = 0;
  let needsReview = 0;
  let notPassed = 0;
  for (const c of candidates) {
    if (isPassing(c)) passed++;
    else if (normalizedVerdict(c) === 'borderline') needsReview++;
    else notPassed++;
  }
  return { passed, needsReview, notPassed };
}

export interface SubmissionPoint {
  label: string; // "2026-02"
  value: number;
}

// Buckets by calendar month using createdat - the only real timestamp
// proven to exist on every record. Sorted chronologically.
export function submissionsOverTime(candidates: RawCandidate[]): SubmissionPoint[] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    if (!c.createdat) continue;
    const d = new Date(c.createdat);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([label, value]) => ({ label, value }));
}

export function filterByDateRange(
  candidates: RawCandidate[],
  from: string | null,
  to: string | null
): RawCandidate[] {
  if (!from && !to) return candidates;
  const fromTime = from ? new Date(from).getTime() : -Infinity;
  const toTime = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity; // inclusive end of day
  return candidates.filter((c) => {
    if (!c.createdat) return false;
    const t = new Date(c.createdat).getTime();
    return !Number.isNaN(t) && t >= fromTime && t <= toTime;
  });
}

// -- Dashboard "Today's schedule" / "Activity" -----------------------------
// The real feed has no scheduling timestamp and no event log (plan section
// 4.3) - these were previously rendered as "not available". Real, honest
// substitutes: "Scheduled interviews" uses the real status enum (not a
// fabricated date), and "Activity" uses updatedat, the only real signal that
// a record recently changed. Neither invents data; both are labeled for
// what they actually show.

export interface PipelineStage {
  label: string;
  /** null = not derivable from the current data source (rendered as "not available"). */
  count: number | null;
  /** Shown on hover - the exact real-value rule this stage is computed from. */
  basis: string;
}

// Funnel stages, each backed by a genuinely distinct real field/rule -
// deliberately NOT including a "Qualified" stage between Parsed and
// Interviewed: the only candidate fields available (overall_score, verdict)
// are the same resume-screening signal already used for "Parsed" and
// "Passed" below, so a separate "Qualified" bucket would just re-slice one
// of those two rather than reflect distinct real information. Showing it
// as a third bar off the same field would overstate what this data source
// actually tracks.
export function computePipelineFunnel(candidates: RawCandidate[]): PipelineStage[] {
  const count = (pred: (c: RawCandidate) => boolean) => candidates.filter(pred).length;

  return [
    { label: 'Applied', count: candidates.length, basis: 'Everyone who applied' },
    {
      label: 'Parsed',
      count: count((c) => numericScore(c) !== null),
      basis: 'Resumes that have been scored',
    },
    {
      label: 'Interviewed',
      count: count((c) => normalizedStatus(c) === 'interview completed'),
      basis: 'Candidates who completed their interview',
    },
    {
      label: 'Passed',
      count: count(isPassing),
      basis: 'Score of 70 or higher with a Fit or better rating',
    },
    {
      label: 'Shortlisted',
      count: count((c) => normalizedStatus(c) === 'shortlisted'),
      basis: 'Only counts candidates shortlisted from this app',
    },
  ];
}

export function scheduledInterviews(candidates: RawCandidate[], limit = 5): RawCandidate[] {
  return candidates
    .filter((c) => normalizedStatus(c) === 'interview scheduled')
    .sort((a, b) => new Date(b.updatedat || b.createdat || 0).getTime() - new Date(a.updatedat || a.createdat || 0).getTime())
    .slice(0, limit);
}

export interface ActivityEntry {
  candidate: RawCandidate;
  timestamp: string;
  stage: Stage;
}

export function recentActivity(candidates: RawCandidate[], limit = 5): ActivityEntry[] {
  return candidates
    .filter((c) => c.updatedat || c.createdat)
    .map((c) => ({
      candidate: c,
      timestamp: (c.updatedat || c.createdat) as string,
      stage: stageForCandidate(c),
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// -- Candidate Profile "Timeline" ------------------------------------------
// Real, derived events only - no fabricated stages. `createdat`/`updatedat`
// come straight from the feed; the artifact timestamps come from the new
// GET /api/candidate-artifacts/:sessionId endpoint (blob lastModified,
// side-effect-free - unlike GET /api/interview/:sessionId, which this page
// still can't safely call - see Phase 4 report). "Interview scheduled"/
// "Interview completed" are inferred from the status enum at updatedat,
// not a real distinct event timestamp - the `basis` string on each event
// discloses exactly what it's computed from, same pattern as PipelineStage
// and SavedView above.

export interface ArtifactInfo {
  exists: boolean;
  generatedAt: string | null;
}

export interface ArtifactsMeta {
  configured: boolean;
  profile: ArtifactInfo | null;
  feedback: ArtifactInfo | null;
  video: ArtifactInfo | null;
}

// From GET /api/candidate-session-timeline/:sessionId - a side-effect-free
// read of the session metadata blob (see candidateController.js). `found:
// false` means no session blob exists for this id (e.g. this candidate
// entered the feed some other way, or the record predates this endpoint) -
// distinct from `configured: false` (no session storage in this
// environment). Both render the same as "not present" here: this data is
// additive, so its absence just means fewer Timeline rows, never an error.
export interface SessionTimelineMeta {
  configured: boolean;
  found: boolean;
  createdAt: string | null;
  firstAccessedAt: string | null;
  interviewStartedAt: string | null;
  completedAt: string | null;
  status: string | null;
}

export interface TimelineEvent {
  label: string;
  timestamp: string; // ISO
  tone: SemanticTone;
  basis: string;
}

export function buildCandidateTimeline(
  candidate: RawCandidate,
  artifacts: ArtifactsMeta | null,
  session?: SessionTimelineMeta | null
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const status = normalizedStatus(candidate);
  const sessionFound = Boolean(session?.found);
  // Tracks whether the scheduled/completed branch below already accounted
  // for candidate.updatedat's real-world meaning (whether or not it used
  // updatedat's literal value - the "Interview completed" branch may prefer
  // the recording's own upload time instead) - not the same as "was this
  // exact timestamp value used elsewhere", which would wrongly re-surface
  // updatedat as a separate, redundant "Record last updated" event.
  let updatedAtAccountedFor = false;

  // "Resume uploaded" (the session's own createdAt, from the moment the
  // interview session was created right after the resume was processed) is
  // a more specific, accurate label than the generic feed-based fallback -
  // only used when the real session blob was actually found.
  if (sessionFound && session!.createdAt) {
    events.push({
      label: 'Resume uploaded',
      timestamp: session!.createdAt,
      tone: 'green',
      basis: "When this candidate's interview session was created",
    });
  } else if (candidate.createdat) {
    events.push({
      label: 'Candidate record created',
      timestamp: candidate.createdat,
      tone: 'green',
      basis: 'When this candidate was added',
    });
  }

  if (sessionFound && session!.firstAccessedAt) {
    events.push({
      label: 'Interview link opened',
      timestamp: session!.firstAccessedAt,
      tone: 'blue',
      basis: 'When the candidate first opened their interview link',
    });
  }

  if (sessionFound && session!.interviewStartedAt) {
    events.push({
      label: 'Interview started',
      timestamp: session!.interviewStartedAt,
      tone: 'blue',
      basis: 'When the candidate began the interview',
    });
  }

  if (artifacts?.profile?.exists && artifacts.profile.generatedAt) {
    events.push({
      label: 'Profile match report generated',
      timestamp: artifacts.profile.generatedAt,
      tone: 'blue',
      basis: 'When the profile match report was generated',
    });
  }

  if (status === 'interview scheduled' && candidate.updatedat) {
    events.push({
      label: 'Interview scheduled',
      timestamp: candidate.updatedat,
      tone: 'amber',
      basis: "Estimated from this candidate's current status, not an exact scheduling time",
    });
    updatedAtAccountedFor = true;
  }

  if (status === 'interview completed') {
    const sessionCompletedAt = sessionFound ? session!.completedAt : null;
    const ts = sessionCompletedAt || artifacts?.video?.generatedAt || candidate.updatedat;
    if (ts) {
      events.push({
        label: 'Interview completed',
        timestamp: ts,
        tone: 'green',
        basis: sessionCompletedAt
          ? 'When the interview session was marked complete'
          : artifacts?.video?.generatedAt
            ? 'Estimated from when the recording was uploaded'
            : "Estimated from this candidate's current status, not an exact completion time",
      });
      updatedAtAccountedFor = true;
    }
  }

  if (artifacts?.video?.exists && artifacts.video.generatedAt) {
    events.push({
      label: 'Interview recording uploaded',
      timestamp: artifacts.video.generatedAt,
      tone: 'blue',
      basis: 'When the recording was uploaded',
    });
  }

  if (artifacts?.feedback?.exists && artifacts.feedback.generatedAt) {
    events.push({
      label: 'Interview feedback generated',
      timestamp: artifacts.feedback.generatedAt,
      tone: 'green',
      basis: 'When the feedback report was generated',
    });
  }

  if (candidate.updatedat && candidate.updatedat !== candidate.createdat && !updatedAtAccountedFor) {
    events.push({
      label: 'Record last updated',
      timestamp: candidate.updatedat,
      tone: 'gray',
      basis: 'Most recent update to this record',
    });
  }

  return events
    .filter(
      (event, i, all) => all.findIndex((e) => e.label === event.label && e.timestamp === event.timestamp) === i
    )
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export interface LiveStatusMarker {
  label: string;
  tone: SemanticTone;
  basis: string;
}

// A trailing "current state" indicator for the Timeline - deliberately NOT
// a TimelineEvent, since it has no fixed historical timestamp (it's "now",
// not a past fact). Only shown once the interview is complete: it reflects
// that "Interview completed" is the last real event on record and nothing
// further has happened since - it does not claim a decision-tracking
// feature exists, since no such field is present anywhere in this data
// source (see computeSavedViews above).
export function currentStatusMarker(candidate: RawCandidate): LiveStatusMarker | null {
  if (normalizedStatus(candidate) !== 'interview completed') return null;
  return {
    label: 'Awaiting your decision',
    tone: 'amber',
    basis: 'The interview is complete - nothing further has been recorded since',
  };
}

// Coarse relative-time formatting (minutes/hours/days) - no library needed
// for this granularity.
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
