import type { RawCandidate } from '@/lib/candidates';

// (a) A realistic sample payload - shaped exactly like the real records
// confirmed live in Phase 3 (all 11 real fields present).
export const REALISTIC_CANDIDATES: RawCandidate[] = [
  {
    sessionid: 's1',
    candidatename: 'Sudheer Reddy',
    candidateemail: 'sudheer@example.com',
    jobtitle: 'Senior Data Engineer (DBT & Snowflake)',
    overall_score: '92',
    verdict: 'strong_fit',
    summary: 'Strong match for the role.',
    status: 'Interview Scheduled',
    createdat: '2026-02-26T09:51:09.318Z',
    updatedat: '2026-02-27T09:44:08.016Z',
    reattempt_reason: null,
  },
  {
    sessionid: 's2',
    candidatename: 'Jane Doe',
    candidateemail: 'jane@example.com',
    jobtitle: 'Data Engineer - Entry Level',
    overall_score: '75',
    verdict: 'fit',
    summary: 'Reasonable match.',
    status: 'Interview Not Scheduled',
    createdat: '2026-03-02T13:06:24.388Z',
    updatedat: '2026-03-02T13:06:24.388Z',
    reattempt_reason: null,
  },
  {
    sessionid: 's3',
    candidatename: 'John Smith',
    candidateemail: 'john@example.com',
    jobtitle: 'Data Engineer - Entry Level',
    overall_score: '55',
    verdict: 'borderline',
    summary: 'Needs review.',
    status: 'Interview Completed',
    createdat: '2025-12-23T09:21:44.107Z',
    updatedat: '2025-12-24T09:21:44.107Z',
    reattempt_reason: null,
  },
  {
    sessionid: 's4',
    candidatename: 'No Fit Candidate',
    candidateemail: 'nofit@example.com',
    jobtitle: 'Senior Data Engineer - Azure',
    overall_score: '20',
    verdict: 'weak_fit',
    summary: 'Not a match.',
    status: 'Interview Not Scheduled',
    createdat: '2025-12-23T09:19:49.690Z',
    updatedat: '2025-12-23T09:19:49.690Z',
    reattempt_reason: null,
  },
  {
    sessionid: 's5',
    candidatename: 'Rejected Candidate',
    candidateemail: 'rejected@example.com',
    jobtitle: 'Senior Data Engineer - Azure',
    overall_score: '10',
    verdict: 'reject',
    summary: 'Explicitly rejected.',
    status: 'Interview Not Scheduled',
    createdat: '2025-12-23T08:51:00.406Z',
    updatedat: '2025-12-23T08:51:00.406Z',
    reattempt_reason: 'Candidate withdrew',
  },
];

// (b) Empty array - every view must handle this without crashing.
export const EMPTY_CANDIDATES: RawCandidate[] = [];

// (c) A payload missing every "extra" field not proven to exist for every
// record (plan section 4.3) - only the original 9 proven fields, no
// updatedat/reattempt_reason. Components must degrade gracefully, not throw.
export const MINIMAL_CANDIDATES: RawCandidate[] = [
  {
    sessionid: 'm1',
    candidatename: 'Minimal Candidate',
    candidateemail: 'minimal@example.com',
    jobtitle: 'Data Engineer - Entry Level',
    overall_score: null,
    verdict: null,
    summary: null,
    status: null,
    createdat: null,
    updatedat: null,
    reattempt_reason: null,
  },
];
