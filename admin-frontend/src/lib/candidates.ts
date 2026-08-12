// The candidates feed - single source of truth for Dashboard/Candidates/
// Analytics/Candidate Profile. Direct browser -> n8n call, matching current
// dashboard.html/analytics.html behavior exactly (plan section 6: "fetch
// once, share the data" - this file is that one fetch, used by every
// consumer via useCandidates() below, instead of each screen re-fetching
// independently as dashboard.html and analytics.html do today).
//
// If the optional Phase 5 proxy (GET /api/candidates) is ever built, only
// fetchCandidates() needs to change - every consumer already goes through
// useCandidates().
const DATAENTRY_URL = 'https://n8n.systechusa.com/webhook/dataentry';

// A live Phase 3 fetch against production (2026-08-13, 2,903 records)
// confirmed exactly 11 fields exist on every record - the original 9 plus
// updatedat and reattempt_reason, neither previously proven. verdict and
// status are controlled enums, not free text - see badgeClass.ts for the
// full confirmed value sets. No other field was observed; anything beyond
// these 11 is still passed through untyped but must be treated as unproven
// (plan section 4.3) until independently confirmed.
export interface RawCandidate {
  candidatename: string;
  candidateemail: string;
  jobtitle: string;
  overall_score: number | string | null;
  /** Controlled enum: strong_fit | fit | borderline | weak_fit | reject (rare) | null (rare). */
  verdict: string | null;
  summary: string | null;
  /** Controlled enum, exactly 3 values: 'Interview Scheduled' | 'Interview Not Scheduled' | 'Interview Completed'. */
  status: string | null;
  createdat: string | null;
  updatedat: string | null;
  reattempt_reason: string | null;
  sessionid: string;
  [extra: string]: unknown;
}

// Ported verbatim from dashboard.html's/analytics.html's unwrapping
// (checked in this exact order): a bare array; a single candidate object
// (has candidatename or candidateemail directly); data.data as an array or
// a single object; data.result; data.candidates; and finally, falling back
// to treating the whole payload as one candidate object.
function unwrapCandidates(data: unknown): RawCandidate[] {
  if (Array.isArray(data)) return data as RawCandidate[];

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    if (obj.candidatename || obj.candidateemail) {
      return [obj as RawCandidate];
    }
    if (Array.isArray(obj.data)) {
      return obj.data as RawCandidate[];
    }
    if (obj.data && typeof obj.data === 'object') {
      return [obj.data as RawCandidate];
    }
    if (obj.result) {
      return Array.isArray(obj.result) ? (obj.result as RawCandidate[]) : [obj.result as RawCandidate];
    }
    if (obj.candidates) {
      return Array.isArray(obj.candidates)
        ? (obj.candidates as RawCandidate[])
        : [obj.candidates as RawCandidate];
    }
    return [obj as RawCandidate];
  }

  return [];
}

export async function fetchCandidates(): Promise<RawCandidate[]> {
  const res = await fetch(`${DATAENTRY_URL}?ts=${Date.now()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
    cache: 'no-store',
    body: JSON.stringify({ timestamp: Date.now() }),
  });

  const data = await res.json();
  return unwrapCandidates(data);
}
