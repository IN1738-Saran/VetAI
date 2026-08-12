// Row-level "Create Interview" / bulk "Schedule N selected" - ported
// verbatim from dashboard.html's createInterview(index): fire
// webhook/createinterview, then reset the 48h window via the existing
// backend route. Two-step sequence preserved exactly (plan section 6: do
// not collapse this into one call).
import type { RawCandidate } from './candidates';

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
