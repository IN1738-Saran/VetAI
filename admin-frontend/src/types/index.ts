// Shared UI-level types for the recruiter admin panel.
// Deliberately does NOT redefine backend/n8n field names here — components
// that consume real data import the shapes from lib/candidates.ts once
// Phase 3 wires the feed, so there is exactly one place field names live.

export type Verdict = 'Strong fit' | 'Fit' | 'Partial fit' | 'Weak fit' | string;

export type CandidateStage =
  | 'Needs review'
  | 'Reviewed'
  | 'Awaiting interview'
  | 'Interview today'
  | 'Completed'
  | 'Blocked'
  | string;

export type SemanticTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';
