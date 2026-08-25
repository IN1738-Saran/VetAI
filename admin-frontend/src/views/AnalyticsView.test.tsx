import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalyticsView } from './AnalyticsView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

describe('AnalyticsView', () => {
  it('renders real KPIs and an honest prompt to pick a role before showing skills gap', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<AnalyticsView />);

    expect(await screen.findByText('Candidates in range')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Candidates in range').parentElement).toHaveTextContent('5');
    });
    expect(screen.getByText(/select a specific role above/i)).toBeInTheDocument();
  });

  it('shows a real, capped skills-gap chart once a Job Library-matched role is selected', async () => {
    // s1's jobtitle matches a real Job Library posting with known tags.
    const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/skills-gap-summary')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.skills).toEqual(expect.arrayContaining(['dbt', 'Snowflake']));
        return {
          ok: true,
          json: async () => ({
            configured: true,
            sampleSize: 1,
            checkedCount: 1,
            missingPercentages: { Kafka: 100, dbt: 0, Snowflake: 0, SQL: 0, Airflow: 0, Python: 0 },
          }),
        } as Response;
      }
      return { ok: true, json: async () => REALISTIC_CANDIDATES } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<AnalyticsView />);
    await screen.findByText('Candidates in range');

    // The Job <select> has a visual (unassociated) label, not htmlFor/id -
    // it's the first combobox on the page (Department, the second, is
    // disabled).
    await userEvent.selectOptions(
      screen.getAllByRole('combobox')[0],
      'Senior Data Engineer (DBT & Snowflake)'
    );

    // "100%" also appears in the Pass rate KPI card for this fixture, so
    // this scopes to the Skills gap card specifically rather than a bare
    // page-wide findByText (which would throw on more than one match).
    const kafkaRow = (await screen.findByText('Kafka')).closest('li') as HTMLElement;
    expect(within(kafkaRow).getByText('100%')).toBeInTheDocument();
    expect(await screen.findByText(/based on the 1 most recent candidate/i)).toBeInTheDocument();
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
    expect(await screen.findByText(/no submissions in the selected date range/i)).toBeInTheDocument();
  });
});
