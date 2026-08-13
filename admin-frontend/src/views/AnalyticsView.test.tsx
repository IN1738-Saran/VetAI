import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { AnalyticsView } from './AnalyticsView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

describe('AnalyticsView', () => {
  it('renders real KPIs and the honest skills-gap not-available panel', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<AnalyticsView />);

    expect(await screen.findByText('Candidates in range')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Candidates in range').parentElement).toHaveTextContent('5');
    });
    expect(screen.getByText(/no required\/preferred skill tags exist/i)).toBeInTheDocument();
  });

  it('outcome breakdown sums to the total candidate count', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<AnalyticsView />);
    const heading = await screen.findByText('Interview outcomes');
    // "Needs review" also appears as a KPI card label elsewhere on this page
    // (and Passed/Not passed are both 2/5=40% in this fixture) - scope every
    // query to the outcomes card itself, and to each row within it.
    const card = heading.closest('div.shadow-card') as HTMLElement;
    await waitFor(() => {
      const scoped = within(card);
      expect(scoped.getByText('Passed').closest('li')).toHaveTextContent('2 - 40%');
      expect(scoped.getByText('Needs review').closest('li')).toHaveTextContent('1 - 20%');
      expect(scoped.getByText('Not passed').closest('li')).toHaveTextContent('2 - 40%');
    });
  });

  it('renders an empty state for zero candidates', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<AnalyticsView />);
    expect(await screen.findByText(/No candidates yet/i)).toBeInTheDocument();
  });

  it('degrades gracefully when every optional field is missing', async () => {
    mockCandidatesFetch(MINIMAL_CANDIDATES);
    renderWithProviders(<AnalyticsView />);
    expect(await screen.findByText('Candidates in range')).toBeInTheDocument();
    // No createdat anywhere -> submissionsOverTime is empty -> not-available note.
    expect(await screen.findByText(/no records with a valid createdat/i)).toBeInTheDocument();
  });
});
