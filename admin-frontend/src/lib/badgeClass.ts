// verdictTone/statusTone were originally ported verbatim from
// dashboard.html's getVerdictBadgeClass/getStatusBadgeClass, which assume
// free-text values (pass/accept/qualified, fail/reject, pending/scheduled,
// cancelled/failed). A live Phase 3 smoke test against the real
// webhook/dataentry feed (2,903 records, inspected 2026-08-13) proved that
// assumption wrong: both fields are actually small controlled enums, and
// the free-text heuristic misclassified ~2,900/2,903 records as
// "needs review" with a 0% pass rate. Rewritten below against the real
// values, with the original keyword heuristic kept as a fallback net for
// any value outside what was observed live.
//
// Real verdict values seen: strong_fit (1002), fit (900), borderline (509,
// plus 1 dirty "Borderline"), weak_fit (488), reject (2), null (1).
// Real status values seen: "Interview Not Scheduled" (1968),
// "Interview Scheduled" (526), "Interview Completed" (409).
//
// scoreTone's numeric thresholds were NOT changed - overall_score is a
// genuine 0-100 numeric score and the >=80/>=60 cutoffs from
// getScoreBadgeClass hold up fine against real data.
import type { SemanticTone } from '@/types';

export function scoreTone(score: number | string | null | undefined): SemanticTone {
  if (score === null || score === undefined || score === '') return 'blue';
  const numScore = typeof score === 'string' ? parseFloat(score) : score;
  if (Number.isNaN(numScore)) return 'blue';
  if (numScore >= 80) return 'green';
  if (numScore >= 60) return 'amber';
  return 'red';
}

const VERDICT_TONE: Record<string, SemanticTone> = {
  strong_fit: 'green',
  fit: 'blue',
  borderline: 'amber',
  weak_fit: 'red',
  reject: 'red',
};

export function verdictTone(verdict: string | null | undefined): SemanticTone {
  if (!verdict || verdict === 'null') return 'gray'; // genuinely unscored, not "info"
  const normalized = verdict.trim().toLowerCase();
  if (normalized in VERDICT_TONE) return VERDICT_TONE[normalized];

  // Fallback net for a value never observed live.
  if (normalized.includes('pass') || normalized.includes('accept') || normalized.includes('qualified')) return 'green';
  if (normalized.includes('fail') || normalized.includes('reject')) return 'red';
  return 'gray';
}

const STATUS_TONE: Record<string, SemanticTone> = {
  'interview completed': 'green',
  'interview scheduled': 'amber',
  'interview not scheduled': 'blue',
};

export function statusTone(status: string | null | undefined): SemanticTone {
  if (!status) return 'gray';
  const normalized = status.trim().toLowerCase();
  if (normalized in STATUS_TONE) return STATUS_TONE[normalized];

  // Fallback net for a value never observed live.
  if (normalized.includes('completed') || normalized.includes('finished')) return 'green';
  if (normalized.includes('cancelled') || normalized.includes('failed')) return 'red';
  if (normalized.includes('scheduled') || normalized.includes('pending')) return 'amber';
  return 'gray';
}
