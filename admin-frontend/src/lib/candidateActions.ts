// Row-level "Create Interview" / bulk "Schedule N selected" - ported
// verbatim from dashboard.html's createInterview(index): fire
// webhook/createinterview, then reset the 48h window via the existing
// backend route. Two-step sequence preserved exactly (plan section 6: do
// not collapse this into one call) - the Phase 5 proxy path preserves the
// same two-step sequence server-side (candidatesFeedController.js), just
// moved off the client, per plan section 6.
import type { RawCandidate } from './candidates';
import { USE_CANDIDATES_PROXY } from './featureFlags';

export interface ScheduleResult {
  sessionid: string;
  candidatename: string;
  ok: boolean;
  error?: string;
}

async function scheduleOne(candidate: RawCandidate): Promise<ScheduleResult> {
  const sessionid = candidate.sessionid;
  if (!sessionid) {
    return { sessionid: '', candidatename: candidate.candidatename, ok: false, error: 'Missing session id' };
  }

  try {
    if (USE_CANDIDATES_PROXY) {
      const res = await fetch(`/api/candidates/${sessionid}/create-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidatename: candidate.candidatename,
          candidateemail: candidate.candidateemail,
          jobtitle: candidate.jobtitle,
        }),
      });
      if (!res.ok) throw new Error('Failed to create interview');
      return { sessionid, candidatename: candidate.candidatename, ok: true };
    }

    const n8nRes = await fetch('https://n8n.systechusa.com/webhook/createinterview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionid,
        candidatename: candidate.candidatename,
        candidateemail: candidate.candidateemail,
        jobtitle: candidate.jobtitle,
      }),
    });
    if (!n8nRes.ok) throw new Error('Failed to create interview in n8n');

    const updateRes = await fetch(`/api/update-session-dates/${sessionid}`, { method: 'POST' });
    if (!updateRes.ok) throw new Error('Failed to update session dates');

    return { sessionid, candidatename: candidate.candidatename, ok: true };
  } catch (err) {
    return {
      sessionid,
      candidatename: candidate.candidatename,
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Sequential, not Promise.all - this hits a real external webhook per
// candidate; a burst of N simultaneous requests against production n8n is
// unnecessary risk for a UI action a recruiter might fire against dozens of
// rows at once.
export async function scheduleSelected(
  candidates: RawCandidate[],
  onProgress?: (done: number, total: number) => void
): Promise<ScheduleResult[]> {
  const results: ScheduleResult[] = [];
  for (const candidate of candidates) {
    results.push(await scheduleOne(candidate));
    onProgress?.(results.length, candidates.length);
  }
  return results;
}

// Ported verbatim from dashboard.html's saveStatus(): POST webhook/vetaiupdate
// with { sessionid, status }. The current UI already lets a recruiter type
// ANY free-text string into this field with no validation, so presetting it
// to 'Rejected' / 'Shortlisted' via a button is not a new capability - same
// contract, same webhook, just a fixed value instead of a text input.
//
// IMPORTANT CAVEAT (see Phase 4 report): the real `status` values observed
// in production are a controlled 3-value enum owned by n8n's own interview-
// scheduling automation ('Interview Not Scheduled' / 'Interview Scheduled' /
// 'Interview Completed'). Writing 'Rejected'/'Shortlisted' into that same
// field injects a value outside that vocabulary - if any n8n workflow branches
// on status text (e.g. reminder emails), this could have an effect that
// isn't visible from this repository. Flagged, not resolved - recommend
// confirming with whoever owns the n8n workflow before relying on this in
// production.
export async function setCandidateStatus(sessionid: string, status: string): Promise<void> {
  const res = USE_CANDIDATES_PROXY
    ? await fetch(`/api/candidates/${sessionid}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    : await fetch('https://n8n.systechusa.com/webhook/vetaiupdate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionid, status }),
      });
  if (!res.ok) throw new Error('Failed to update status');
}

// Ported from dashboard.html's deleteCandidate(sessionId): same single
// same-origin backend route (no n8n/proxy split needed here - the
// candidateController.js DELETE endpoint is unchanged from Old_Version and
// was never a direct-to-n8n call in the first place).
//
// A 404 here is an expected, documented outcome (baseline/endpoint-
// contracts.md) - it means no matching row exists in Postgres `candidates`
// for this session (e.g. a session that only ever appeared via the n8n
// dataentry feed and was never scored/inserted there), not necessarily an
// application bug. Callers should word the resulting message accordingly
// rather than treating it as a generic failure.
export async function deleteCandidate(sessionid: string): Promise<void> {
  const res = await fetch(`/api/delete-candidate/${sessionid}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    let message = 'Failed to delete candidate';
    try {
      const body = await res.json();
      if (body?.error) {
        message = res.status === 404 ? 'No record was found for this candidate to delete.' : body.error;
      }
    } catch {
      // response body wasn't JSON - fall back to the generic message above.
    }
    throw new Error(message);
  }
}
