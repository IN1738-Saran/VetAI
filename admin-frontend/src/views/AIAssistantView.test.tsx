import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIAssistantView } from './AIAssistantView';
import { renderWithProviders } from '@/test/testUtils';
import { REALISTIC_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

function mockFetchRouter(opts: {
  overview?: { status?: number; body?: unknown };
  ask?: { status?: number; body?: unknown };
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);

    if (url.includes('/api/assistant/overview')) {
      const {
        status = 200,
        body = { configured: true, transcriptCount: 5, profileReportCount: 5, feedbackReportCount: 3 },
      } = opts.overview ?? {};
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    if (url.includes('/api/assistant/ask')) {
      const { status = 200, body = { configured: true, answer: 'A real answer.', basedOnCount: 1 } } =
        opts.ask ?? {};
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        _requestBody: init?.body,
      } as unknown as Response;
    }

    return { ok: true, json: async () => REALISTIC_CANDIDATES } as Response;
  });
}

describe('AIAssistantView', () => {
  it('renders real candidate-derived counts in "What it can see"', async () => {
    mockFetchRouter({});
    renderWithProviders(<AIAssistantView />);

    expect(await screen.findByText('What it can see')).toBeInTheDocument();
    // REALISTIC_CANDIDATES has 5 records, all with a scoreable overall_score.
    const resumesRow = (await screen.findByText('Candidate resumes')).closest('li') as HTMLElement;
    expect(resumesRow).toHaveTextContent('5');
    expect(screen.getByText('Not tracked yet')).toBeInTheDocument();
  });

  it('shows an honest not-available state instead of the chat box when the model is not configured', async () => {
    mockFetchRouter({ overview: { body: { configured: false, transcriptCount: null, profileReportCount: null, feedbackReportCount: null } } });
    renderWithProviders(<AIAssistantView />);

    expect(
      await screen.findByText(/isn't connected to a language model in this environment yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask about candidates/i)).not.toBeInTheDocument();
  });

  it('sends the real, capped candidate context alongside the question and renders the answer', async () => {
    const fetchSpy = mockFetchRouter({});
    renderWithProviders(<AIAssistantView />);

    const input = await screen.findByPlaceholderText(/ask about candidates/i);
    await userEvent.type(input, 'Who is the top candidate?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('A real answer.')).toBeInTheDocument();

    await waitFor(() => {
      const askCall = fetchSpy.mock.calls.find((call) => String(call[0]).includes('/api/assistant/ask'));
      expect(askCall).toBeDefined();
      const sentBody = JSON.parse(String(askCall?.[1]?.body));
      expect(sentBody.question).toBe('Who is the top candidate?');
      expect(Array.isArray(sentBody.candidates)).toBe(true);
      expect(sentBody.candidates.length).toBeGreaterThan(0);
      expect(sentBody.candidates[0]).toHaveProperty('candidatename');
    });
  });

  it('clicking a suggested question sends it immediately', async () => {
    mockFetchRouter({});
    renderWithProviders(<AIAssistantView />);

    // "What skills are we short on?" also appears as a plain list item in the
    // "Good questions to ask" panel, so this scopes to the clickable chip
    // specifically rather than a page-wide findByText (which would throw on
    // more than one match).
    const chip = await screen.findByRole('button', { name: 'What skills are we short on?' });
    await userEvent.click(chip);

    expect(await screen.findByText('A real answer.')).toBeInTheDocument();
  });
});
