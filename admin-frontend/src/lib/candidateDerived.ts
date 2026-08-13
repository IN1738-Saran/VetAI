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
import { verdictTone, statusTone } from './badgeClass';

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
    { id: 'all', label: 'All candidates', count: candidates.length, basis: 'Every record in the feed' },
    {
      id: 'needs-review',
      label: 'Needs review',
      count: count((c) => normalizedVerdict(c) === 'borderline'),
      basis: "verdict = 'borderline'",
    },
    {
      id: 'ai-recommended',
      label: 'AI recommended',
      count: null,
      basis: 'No recommendation flag exists in the real feed',
    },
    {
      id: 'shortlisted',
      label: 'Shortlisted',
      count: null,
      basis: 'No shortlisting concept exists in the real feed (status is exactly 3 fixed values)',
    },
    {
      id: 'awaiting-interview',
      label: 'Awaiting interview',
      count: count((c) => normalizedStatus(c) === 'interview not scheduled'),
      basis: "status = 'Interview Not Scheduled'",
    },
    {
      id: 'completed',
      label: 'Completed',
      count: count((c) => normalizedStatus(c) === 'interview completed'),
      basis: "status = 'Interview Completed'",
    },
    {
      id: 'rejected',
      label: 'Rejected',
      count: count((c) => normalizedVerdict(c) === 'reject'),
      basis: "verdict = 'reject' (rare - 2 of 2,903 in the live sample)",
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
