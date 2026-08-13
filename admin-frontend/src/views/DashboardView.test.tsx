import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { DashboardView } from './DashboardView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

describe('DashboardView', () => {
  it('renders real KPIs from a realistic payload', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<DashboardView />);

    expect(await screen.findByText('All candidates')).toBeInTheDocument();
    // "5" (totalCount) appears in both the StatCard and the Pipeline's
    // "Applied" row - scope to the StatCard specifically, not a bare '5'.
    await waitFor(() =>
      expect(screen.getByText('All candidates').parentElement).toHaveTextContent('5')
    );
    // Sections with no real data source render an explicit "not available" state.
    expect(screen.getAllByText(/Not available/i).length).toBeGreaterThan(0);
  });

  it('renders an empty state for zero candidates, not a crash', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText(/No candidates yet/i)).toBeInTheDocument();
  });

  it('degrades gracefully when every optional field is missing', async () => {
    mockCandidatesFetch(MINIMAL_CANDIDATES);
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText('All candidates')).toBeInTheDocument();
    // averageScore/passRate are null for an all-unscored payload - rendered as "-".
    await waitFor(() => expect(screen.getAllByText('-').length).toBeGreaterThan(0));
  });

  it('shows a retry affordance on a feed error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText(/Failed to load data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
