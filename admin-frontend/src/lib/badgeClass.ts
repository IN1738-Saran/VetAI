// Ported verbatim from backend/src/views/dashboard.html's
// getScoreBadgeClass / getVerdictBadgeClass / getStatusBadgeClass
// (implementation plan Strict Constraint #10: reuse existing thresholds,
// do not invent new ones). badge-success/warning/danger/info map to the
// green/amber/red/blue semantic tones used throughout the new design system.
import type { SemanticTone } from '@/types';

export function scoreTone(score: number | string | null | undefined): SemanticTone {
  // Matches getScoreBadgeClass exactly: falsy score falls through to
  // badge-info (blue), not a "not scored yet" gray - that gray treatment is
  // a distinct, new UI pattern applied only to sub-scores absent from a real
  // payload (see components/NotScoredYet.tsx), not to this ported function.
  if (score === null || score === undefined || score === '') return 'blue';
  const numScore = typeof score === 'string' ? parseFloat(score) : score;
  if (Number.isNaN(numScore)) return 'blue';
  if (numScore >= 80) return 'green';
  if (numScore >= 60) return 'amber';
  return 'red';
}

export function verdictTone(verdict: string | null | undefined): SemanticTone {
  if (!verdict) return 'blue';
  const lower = verdict.toLowerCase();
  if (lower.includes('pass') || lower.includes('accept') || lower.includes('qualified')) return 'green';
  if (lower.includes('fail') || lower.includes('reject')) return 'red';
  return 'amber';
}

export function statusTone(status: string | null | undefined): SemanticTone {
  if (!status) return 'blue';
  const lower = status.toLowerCase();
  if (lower.includes('completed') || lower.includes('finished')) return 'green';
  if (lower.includes('pending') || lower.includes('scheduled')) return 'amber';
  if (lower.includes('cancelled') || lower.includes('failed')) return 'red';
  return 'blue';
}
