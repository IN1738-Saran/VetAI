import { describe, it, expect } from 'vitest';
import { scoreTone, verdictTone, statusTone } from './badgeClass';

describe('scoreTone', () => {
  it('maps the ported getScoreBadgeClass thresholds', () => {
    expect(scoreTone(80)).toBe('green');
    expect(scoreTone(95)).toBe('green');
    expect(scoreTone(79)).toBe('amber');
    expect(scoreTone(60)).toBe('amber');
    expect(scoreTone(59)).toBe('red');
    expect(scoreTone(0)).toBe('red');
  });

  it('accepts numeric strings, matching the real overall_score field type', () => {
    expect(scoreTone('92')).toBe('green');
    expect(scoreTone('0')).toBe('red');
  });

  it('treats null/undefined/empty/non-numeric as blue, not gray', () => {
    expect(scoreTone(null)).toBe('blue');
    expect(scoreTone(undefined)).toBe('blue');
    expect(scoreTone('')).toBe('blue');
    expect(scoreTone('not-a-number')).toBe('blue');
  });
});

describe('verdictTone - against the real confirmed enum', () => {
  it('maps every real verdict value seen in production', () => {
    expect(verdictTone('strong_fit')).toBe('green');
    expect(verdictTone('fit')).toBe('blue');
    expect(verdictTone('borderline')).toBe('amber');
    expect(verdictTone('weak_fit')).toBe('red');
    expect(verdictTone('reject')).toBe('red');
  });

  it('is case/whitespace tolerant (real data had one dirty "Borderline")', () => {
    expect(verdictTone('Borderline')).toBe('amber');
    expect(verdictTone('  strong_fit  ')).toBe('green');
  });

  it('treats missing/null verdict as gray (genuinely unscored), not blue', () => {
    expect(verdictTone(null)).toBe('gray');
    expect(verdictTone(undefined)).toBe('gray');
    expect(verdictTone('')).toBe('gray');
    expect(verdictTone('null')).toBe('gray');
  });

  it('falls back to keyword matching for a value never observed live', () => {
    expect(verdictTone('passed')).toBe('green');
    expect(verdictTone('qualified')).toBe('green');
    expect(verdictTone('failed')).toBe('red');
    expect(verdictTone('some-unknown-value')).toBe('gray');
  });
});

describe('statusTone - against the real confirmed 3-value enum', () => {
  it('maps every real status value seen in production', () => {
    expect(statusTone('Interview Completed')).toBe('green');
    expect(statusTone('Interview Scheduled')).toBe('amber');
    expect(statusTone('Interview Not Scheduled')).toBe('blue');
  });

  it('is case tolerant', () => {
    expect(statusTone('interview completed')).toBe('green');
    expect(statusTone('INTERVIEW NOT SCHEDULED')).toBe('blue');
  });

  it('treats missing status as gray', () => {
    expect(statusTone(null)).toBe('gray');
    expect(statusTone(undefined)).toBe('gray');
    expect(statusTone('')).toBe('gray');
  });

  it('falls back to keyword matching for a value never observed live', () => {
    expect(statusTone('Cancelled')).toBe('red');
    expect(statusTone('Pending review')).toBe('amber');
    expect(statusTone('something else entirely')).toBe('gray');
  });
});
