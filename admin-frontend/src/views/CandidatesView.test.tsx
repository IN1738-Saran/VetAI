import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CandidatesView } from './CandidatesView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

describe('CandidatesView', () => {
  it('renders the real candidates table with saved-view counts', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidatesView />);

    expect(await screen.findByText('Sudheer Reddy')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // "All candidates" saved view shows the real total count.
    expect(screen.getByText('All candidates').parentElement).toHaveTextContent('5');
  });

  it('filtering to a saved view narrows the visible rows', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidatesView />);
    await screen.findByText('Sudheer Reddy');

    await userEvent.click(screen.getByText('Rejected'));

    await waitFor(() => {
      expect(screen.getByText('Rejected Candidate')).toBeInTheDocument();
      expect(screen.queryByText('Sudheer Reddy')).not.toBeInTheDocument();
    });
  });

  it('renders an empty state for zero candidates', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<CandidatesView />);
    expect(await screen.findByText(/No candidates yet/i)).toBeInTheDocument();
  });

  it('renders N/A for a candidate missing every optional field, without crashing', async () => {
    mockCandidatesFetch(MINIMAL_CANDIDATES);
    renderWithProviders(<CandidatesView />);
    expect(await screen.findByText('Minimal Candidate')).toBeInTheDocument();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });
});
