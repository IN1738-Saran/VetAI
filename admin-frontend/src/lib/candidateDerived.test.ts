import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  numericScore,
  isPassing,
  computeDashboardKpis,
  topRolesByVolume,
  computeSavedViews,
  filterBySavedView,
  computeOutcomes,
  submissionsOverTime,
  filterByDateRange,
} from './candidateDerived';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

describe('numericScore', () => {
  it('parses the real overall_score string field', () => {
    expect(numericScore(REALISTIC_CANDIDATES[0])).toBe(92);
  });
  it('returns null for null/undefined/empty score (minimal payload case)', () => {
    expect(numericScore(MINIMAL_CANDIDATES[0])).toBeNull();
  });
});

describe('isPassing - "score 70+ and Fit or better"', () => {
  it('passes a strong_fit/fit candidate scoring 70+', () => {
    expect(isPassing(REALISTIC_CANDIDATES[0])).toBe(true); // strong_fit, 92
    expect(isPassing(REALISTIC_CANDIDATES[1])).toBe(true); // fit, 75
  });
  it('does not pass a borderline/weak_fit/reject candidate regardless of score', () => {
    expect(isPassing(REALISTIC_CANDIDATES[2])).toBe(false); // borderline, 55
    expect(isPassing(REALISTIC_CANDIDATES[3])).toBe(false); // weak_fit, 20
    expect(isPassing(REALISTIC_CANDIDATES[4])).toBe(false); // reject, 10
  });
  it('does not pass a fit candidate scoring under 70', () => {
    expect(isPassing({ ...REALISTIC_CANDIDATES[1], overall_score: '69' })).toBe(false);
  });
});

describe('computeDashboardKpis', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T15:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('computes real counts from a realistic payload', () => {
    const kpis = computeDashboardKpis(REALISTIC_CANDIDATES);
    expect(kpis.totalCount).toBe(5);
    expect(kpis.newToday).toBe(1); // s2 created 2026-03-02, matches frozen "today"
    expect(kpis.needsReviewCount).toBe(1); // s3, borderline
    // scores: 92,75,55,20,10 -> avg = 50.4 -> rounds to 50
    expect(kpis.averageScore).toBe(50);
    // passing: s1 (strong_fit,92), s2 (fit,75) = 2 of 5 scored
    expect(kpis.passRate).toBe(40);
  });

  it('handles an empty array without throwing, all nulls/zeros', () => {
    const kpis = computeDashboardKpis(EMPTY_CANDIDATES);
    expect(kpis.totalCount).toBe(0);
    expect(kpis.averageScore).toBeNull();
    expect(kpis.passRate).toBeNull();
    expect(kpis.needsReviewCount).toBe(0);
  });

  it('handles a payload missing every optional field (no score/verdict/createdat)', () => {
    const kpis = computeDashboardKpis(MINIMAL_CANDIDATES);
    expect(kpis.totalCount).toBe(1);
    expect(kpis.newToday).toBe(0);
    expect(kpis.averageScore).toBeNull();
    expect(kpis.passRate).toBeNull();
    expect(kpis.needsReviewCount).toBe(0);
  });
});

describe('topRolesByVolume', () => {
  it('groups by jobtitle and sorts by count descending', () => {
    const roles = topRolesByVolume(REALISTIC_CANDIDATES);
    expect(roles[0]).toMatchObject({ jobtitle: 'Data Engineer - Entry Level', count: 2 });
    const total = roles.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(5);
  });

  it('returns an empty array for an empty payload', () => {
    expect(topRolesByVolume(EMPTY_CANDIDATES)).toEqual([]);
  });

  it('groups a missing jobtitle under "Unknown" rather than throwing', () => {
    const roles = topRolesByVolume([{ ...MINIMAL_CANDIDATES[0], jobtitle: '' }]);
    expect(roles[0].jobtitle).toBe('Unknown');
  });
});

describe('computeSavedViews / filterBySavedView', () => {
  it('counts match the real enum-based buckets exactly', () => {
    const views = computeSavedViews(REALISTIC_CANDIDATES);
    const byId = Object.fromEntries(views.map((v) => [v.id, v.count]));
    expect(byId.all).toBe(5);
    expect(byId['needs-review']).toBe(1);
    expect(byId['awaiting-interview']).toBe(3); // s2, s4, s5
    expect(byId.completed).toBe(1); // s3
    expect(byId.rejected).toBe(1); // s5
  });

  it('marks ai-recommended and shortlisted as not available (null), not zero', () => {
    const views = computeSavedViews(REALISTIC_CANDIDATES);
    const byId = Object.fromEntries(views.map((v) => [v.id, v.count]));
    expect(byId['ai-recommended']).toBeNull();
    expect(byId.shortlisted).toBeNull();
  });

  it('filterBySavedView returns [] for the two not-available buckets, not all/none by accident', () => {
    expect(filterBySavedView(REALISTIC_CANDIDATES, 'ai-recommended')).toEqual([]);
    expect(filterBySavedView(REALISTIC_CANDIDATES, 'shortlisted')).toEqual([]);
  });

  it('filterBySavedView("rejected") returns exactly the reject-verdict candidate', () => {
    const rows = filterBySavedView(REALISTIC_CANDIDATES, 'rejected');
    expect(rows.map((r) => r.sessionid)).toEqual(['s5']);
  });

  it('handles an empty payload without throwing', () => {
    const views = computeSavedViews(EMPTY_CANDIDATES);
    expect(views.find((v) => v.id === 'all')?.count).toBe(0);
  });
});

describe('computeOutcomes', () => {
  it('partitions into passed/needsReview/notPassed summing to the total', () => {
    const outcomes = computeOutcomes(REALISTIC_CANDIDATES);
    expect(outcomes.passed).toBe(2); // s1, s2
    expect(outcomes.needsReview).toBe(1); // s3
    expect(outcomes.notPassed).toBe(2); // s4, s5
    expect(outcomes.passed + outcomes.needsReview + outcomes.notPassed).toBe(5);
  });

  it('handles an empty payload', () => {
    expect(computeOutcomes(EMPTY_CANDIDATES)).toEqual({ passed: 0, needsReview: 0, notPassed: 0 });
  });
});

describe('submissionsOverTime', () => {
  it('buckets by calendar month, sorted chronologically', () => {
    const points = submissionsOverTime(REALISTIC_CANDIDATES);
    const labels = points.map((p) => p.label);
    expect(labels).toEqual([...labels].sort());
    expect(points.find((p) => p.label === '2025-12')?.value).toBe(3); // s3, s4, s5
    expect(points.find((p) => p.label === '2026-02')?.value).toBe(1); // s1
    expect(points.find((p) => p.label === '2026-03')?.value).toBe(1); // s2
  });

  it('skips records with no createdat rather than throwing', () => {
    expect(submissionsOverTime(MINIMAL_CANDIDATES)).toEqual([]);
  });
});

describe('filterByDateRange', () => {
  it('returns everything when no range is set', () => {
    expect(filterByDateRange(REALISTIC_CANDIDATES, null, null)).toHaveLength(5);
  });

  it('filters to records within an inclusive from/to range', () => {
    const rows = filterByDateRange(REALISTIC_CANDIDATES, '2026-01-01', '2026-12-31');
    expect(rows.map((r) => r.sessionid).sort()).toEqual(['s1', 's2']);
  });

  it('excludes records with no createdat when a range is set', () => {
    expect(filterByDateRange(MINIMAL_CANDIDATES, '2026-01-01', null)).toEqual([]);
  });
});
