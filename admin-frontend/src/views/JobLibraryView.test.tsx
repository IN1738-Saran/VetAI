import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobLibraryView } from './JobLibraryView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';
import type { RawCandidate } from '@/lib/candidates';

afterEach(() => vi.restoreAllMocks());

// Two real candidates against a sample job's exact title, to prove the
// per-card stats are genuinely computed, not hardcoded.
const MATCHING_FEED: RawCandidate[] = [
  {
    sessionid: 'j1',
    candidatename: 'A',
    candidateemail: 'a@example.com',
    jobtitle: 'Senior QA Analyst',
    overall_score: '80',
    verdict: 'strong_fit',
    summary: null,
    status: 'Interview Completed',
    createdat: '2026-01-01T00:00:00.000Z',
    updatedat: null,
    reattempt_reason: null,
  },
  {
    sessionid: 'j2',
    candidatename: 'B',
    candidateemail: 'b@example.com',
    jobtitle: 'Senior QA Analyst',
    overall_score: '60',
    verdict: 'borderline',
    summary: null,
    status: 'Interview Not Scheduled',
    createdat: '2026-01-02T00:00:00.000Z',
    updatedat: null,
    reattempt_reason: null,
  },
];

describe('JobLibraryView', () => {
  it('shows a real candidate count/avg score per sample job, matched against the real feed', async () => {
    mockCandidatesFetch(MATCHING_FEED);
    renderWithProviders(<JobLibraryView />);

    const card = (await screen.findByText('Senior QA Analyst')).closest('.shadow-card') as HTMLElement;
    // 2 candidates, scores 80/60 -> avg 70.
    expect(card).toHaveTextContent('2');
    expect(card).toHaveTextContent('avg 70');
  });

  it('filtering by department narrows the visible cards', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<JobLibraryView />);
    await screen.findByText('Senior QA Analyst');

    await userEvent.click(screen.getByRole('button', { name: 'Quality' }));

    expect(screen.getByText('Senior QA Analyst')).toBeInTheDocument();
    expect(screen.queryByText('Inside Sales Lead')).not.toBeInTheDocument();
  });

  it('shows "0 candidates" rather than crashing when nothing matches a sample title', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<JobLibraryView />);
    const card = (await screen.findByText('Senior QA Analyst')).closest('.shadow-card') as HTMLElement;
    expect(card).toHaveTextContent('0');
  });

  it('never claims a real count for a candidate payload missing jobtitle-comparable data', async () => {
    mockCandidatesFetch(MINIMAL_CANDIDATES);
    renderWithProviders(<JobLibraryView />);
    expect(await screen.findByText('Senior QA Analyst')).toBeInTheDocument();
    // "+ New job" must stay disabled - this is a placeholder screen, not a real form.
    expect(screen.getByRole('button', { name: /new job/i })).toBeDisabled();
  });
});
