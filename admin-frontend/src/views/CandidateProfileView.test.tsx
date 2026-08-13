import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { CandidateProfileView } from './CandidateProfileView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

const PATH = '/candidates/:sessionId';

describe('CandidateProfileView', () => {
  it('renders real candidate details for a known session id', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });

    expect(await screen.findByText('Sudheer Reddy')).toBeInTheDocument();
    expect(screen.getByText('Strong match for the role.')).toBeInTheDocument();
    // Sub-scores don't exist in the real feed - always "not scored yet".
    expect(screen.getAllByText(/Not scored yet/i).length).toBeGreaterThan(0);
  });

  it('shows a not-found state for an unknown session id, not a crash', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/does-not-exist', path: PATH });
    expect(await screen.findByText(/No candidate found/i)).toBeInTheDocument();
  });

  it('handles an empty feed without crashing', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    expect(await screen.findByText(/No candidate found/i)).toBeInTheDocument();
  });

  it('renders placeholders for a candidate missing every optional field', async () => {
    mockCandidatesFetch(MINIMAL_CANDIDATES);
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/m1', path: PATH });
    expect(await screen.findByText('Minimal Candidate')).toBeInTheDocument();
    expect(screen.getByText(/no summary text on this record/i)).toBeInTheDocument();
  });
});
