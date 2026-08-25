import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailCenterView } from './EmailCenterView';
import { renderWithProviders } from '@/test/testUtils';
import { REALISTIC_CANDIDATES } from '@/test/fixtures';
import type { RawCandidate } from '@/lib/candidates';

const CANDIDATE_MISSING_EMAIL: RawCandidate = {
  sessionid: 'no-email-1',
  candidatename: 'No Email Candidate',
  candidateemail: '',
  jobtitle: 'Data Engineer - Entry Level',
  overall_score: '60',
  verdict: 'fit',
  summary: null,
  status: 'Interview Not Scheduled',
  createdat: '2026-01-01T00:00:00.000Z',
  updatedat: '2026-01-01T00:00:00.000Z',
  reattempt_reason: null,
};

afterEach(() => vi.restoreAllMocks());

function mockFetchRouter(opts: {
  candidates?: unknown;
  configs?: { status?: number; body?: unknown };
  save?: { status?: number; body?: unknown };
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    const method = init?.method || 'GET';

    if (url.includes('/api/job-email-configs') && method === 'POST') {
      const { status = 200, body = { success: true, config: { id: 99, jobtitle: 'new role', emails: 'a@b.com' } } } =
        opts.save ?? {};
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    if (url.includes('/api/job-email-configs')) {
      const {
        status = 200,
        body = { success: true, configs: [{ id: 1, jobtitle: 'senior data engineer - azure', emails: 'team@company.com' }] },
      } = opts.configs ?? {};
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    return { ok: true, json: async () => opts.candidates ?? [] } as Response;
  });
}

describe('EmailCenterView', () => {
  it('renders real notification lists from the backend', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    renderWithProviders(<EmailCenterView />);

    expect(await screen.findByText('senior data engineer - azure')).toBeInTheDocument();
    expect(screen.getByText('team@company.com')).toBeInTheDocument();
  });

  it('shows an honest empty state when no lists exist yet', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES, configs: { body: { success: true, configs: [] } } });
    renderWithProviders(<EmailCenterView />);

    expect(await screen.findByText(/no notification lists have been set up yet/i)).toBeInTheDocument();
  });

  it('lists real candidates missing an email', async () => {
    mockFetchRouter({ candidates: [CANDIDATE_MISSING_EMAIL], configs: { body: { success: true, configs: [] } } });
    renderWithProviders(<EmailCenterView />);

    expect(await screen.findByText('No Email Candidate')).toBeInTheDocument();
  });

  it('saves a new notification list via the real upsert endpoint', async () => {
    const fetchSpy = mockFetchRouter({ candidates: REALISTIC_CANDIDATES, configs: { body: { success: true, configs: [] } } });
    renderWithProviders(<EmailCenterView />);

    await screen.findByText(/no notification lists have been set up yet/i);

    await userEvent.type(screen.getByPlaceholderText(/e.g. senior data engineer/i), 'Data Engineer');
    await userEvent.type(
      screen.getByPlaceholderText(/comma-separated/i),
      'recruiter@company.com'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const saveCall = fetchSpy.mock.calls.find(
        (call) => String(call[0]).includes('/api/job-email-configs') && call[1]?.method === 'POST'
      );
      expect(saveCall).toBeDefined();
      const sentBody = JSON.parse(String(saveCall?.[1]?.body));
      expect(sentBody.jobtitle).toBe('Data Engineer');
      expect(sentBody.emails).toBe('recruiter@company.com');
    });
  });
});
