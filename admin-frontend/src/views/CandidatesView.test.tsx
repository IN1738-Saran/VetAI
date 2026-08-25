import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CandidatesView } from './CandidatesView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

// Routes fetch by URL/method instead of the blanket mockCandidatesFetch,
// for tests that need to exercise a second real endpoint (delete) alongside
// the candidates feed.
function mockFetchRouter(handlers: {
  candidates?: unknown;
  onDelete?: (sessionid: string) => { status: number; body: unknown };
}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    const method = (init?.method || 'GET').toUpperCase();

    if (method === 'DELETE') {
      const match = url.match(/\/api\/delete-candidate\/(.+)$/);
      const sessionid = match ? match[1] : '';
      const { status, body } = handlers.onDelete
        ? handlers.onDelete(sessionid)
        : { status: 200, body: { success: true } };
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    return { ok: true, json: async () => handlers.candidates ?? [] } as Response;
  });
}

describe('CandidatesView', () => {
  it('renders the real candidates table with saved-view counts', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidatesView />);

    expect(await screen.findByText('Sudheer Reddy')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // "All candidates" saved view shows the real total count.
    expect(screen.getByText('All candidates').parentElement).toHaveTextContent('5');
  });

  it('Refresh button re-fetches the real candidates feed', async () => {
    const fetchSpy = mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidatesView />);
    await screen.findByText('Sudheer Reddy');

    const callsBefore = fetchSpy.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /^refresh$/i }));

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('sorts by createdat descending by default, matching Old_Version/dashboard.html\'s order:[[7,"desc"]]', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidatesView />);
    await screen.findByText('Sudheer Reddy');

    const names = screen.getAllByRole('row').map((row) => row.textContent).filter(Boolean);
    // REALISTIC_CANDIDATES' createdat values, newest first: Jane Doe
    // (2026-03-02) > Sudheer Reddy (2026-02-26) > John Smith / No Fit
    // Candidate / Rejected Candidate (all 2025-12-23, same order as listed).
    const order = names.map((text) =>
      ['Jane Doe', 'Sudheer Reddy', 'John Smith', 'No Fit Candidate', 'Rejected Candidate'].find((name) =>
        text!.includes(name)
      )
    );
    expect(order.filter(Boolean)).toEqual([
      'Jane Doe',
      'Sudheer Reddy',
      'John Smith',
      'No Fit Candidate',
      'Rejected Candidate',
    ]);
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

  it('restores the Profile Status / Interview Video / Interview Feedback / Actions columns from the old dashboard.html table', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<CandidatesView />);
    await screen.findByText('Sudheer Reddy');

    expect(screen.getByText('Profile Status')).toBeInTheDocument();
    expect(screen.getByText('Interview Video')).toBeInTheDocument();
    expect(screen.getByText('Interview Feedback')).toBeInTheDocument();
    expect(screen.getAllByText('Create Interview').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Delete Sudheer Reddy' })).toBeInTheDocument();
  });

  it('deletes a candidate after confirmation and removes it from the table', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<CandidatesView />);
    await screen.findByText('Sudheer Reddy');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Sudheer Reddy' }));

    await waitFor(() => {
      expect(screen.queryByText('Sudheer Reddy')).not.toBeInTheDocument();
    });
  });

  it('does not delete when the confirmation dialog is cancelled', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(<CandidatesView />);
    await screen.findByText('Sudheer Reddy');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Sudheer Reddy' }));

    expect(screen.getByText('Sudheer Reddy')).toBeInTheDocument();
  });

  it('a 404 delete response (no matching Postgres row) surfaces a specific, non-generic message', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      onDelete: () => ({ status: 404, body: { error: 'Candidate not found' } }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderWithProviders(<CandidatesView />);
    await screen.findByText('Sudheer Reddy');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Sudheer Reddy' }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/no record was found for this candidate/i));
    });
    // The delete didn't actually succeed server-side, so the row must stay.
    expect(screen.getByText('Sudheer Reddy')).toBeInTheDocument();
  });
});
