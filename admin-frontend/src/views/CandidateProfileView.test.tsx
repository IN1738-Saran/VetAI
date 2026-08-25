import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { CandidateProfileView } from './CandidateProfileView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES, MINIMAL_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

const PATH = '/candidates/:sessionId';

// Routes fetch by URL - the candidates feed, the artifacts-meta endpoint,
// and the highlights endpoint (both small JSON, never the raw report body)
// all get hit by this view.
function mockFetchRouter(opts: {
  candidates?: unknown;
  artifacts?: { status?: number; body?: unknown };
  highlights?: { status?: number; body?: unknown };
  sessionTimeline?: { status?: number; body?: unknown };
}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);

    if (url.includes('/highlights')) {
      const { status = 200, body = { configured: true, found: false, strengths: [], gaps: [] } } =
        opts.highlights ?? {};
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    if (url.includes('/candidate-session-timeline/')) {
      const { status = 200, body = { configured: true, found: false } } = opts.sessionTimeline ?? {};
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    if (url.includes('/api/candidate-artifacts/')) {
      const {
        status = 200,
        body = { configured: true, profile: { exists: false, generatedAt: null }, feedback: { exists: false, generatedAt: null }, video: { exists: false, generatedAt: null } },
      } = opts.artifacts ?? {};
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }

    return { ok: true, json: async () => opts.candidates ?? [] } as Response;
  });
}

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
    expect(screen.getByText(/no summary is available for this candidate/i)).toBeInTheDocument();
  });

  it('does NOT dump the full report text on the page - shows a Download card instead', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    await screen.findByText('Sudheer Reddy');

    expect(screen.getByText('Profile match report')).toBeInTheDocument();
    expect(screen.getByText('Interview feedback report')).toBeInTheDocument();
    expect(screen.getAllByText('Download PDF').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a Ready/generated-on state and an enabled download when the report artifact exists', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      artifacts: {
        body: {
          configured: true,
          profile: { exists: true, generatedAt: '2026-02-27T09:00:00.000Z' },
          feedback: { exists: false, generatedAt: null },
          video: { exists: false, generatedAt: null },
        },
      },
    });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    await screen.findByText('Sudheer Reddy');

    expect(await screen.findByText(/Ready to download as a PDF - generated/i)).toBeInTheDocument();
    const downloadLinks = screen.getAllByRole('link', { name: /Download PDF/i });
    expect(downloadLinks[0]).toHaveAttribute('target', '_blank');
    expect(downloadLinks[0]).toHaveAttribute(
      'href',
      expect.stringContaining('/api/download-profile/s1?name=')
    );
  });

  it('shows a not-available state (not a crash) when no report has been generated yet', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    await screen.findByText('Sudheer Reddy');

    expect(await screen.findAllByText(/not generated yet for this candidate/i)).not.toHaveLength(0);
  });

  it('renders real extracted Strengths/Gaps bullets from the highlights endpoint', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      highlights: {
        body: {
          configured: true,
          found: true,
          strengths: ['Deep Snowflake expertise'],
          gaps: ['No CI/CD experience mentioned'],
        },
      },
    });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });

    expect(await screen.findByText('Deep Snowflake expertise')).toBeInTheDocument();
    expect(await screen.findByText('No CI/CD experience mentioned')).toBeInTheDocument();
  });

  it('sends the matching Job Library posting\'s required skills to the highlights endpoint', async () => {
    // s1's jobtitle ("Senior Data Engineer (DBT & Snowflake)") matches a
    // real Job Library posting - confirms the frontend actually looks it up
    // and forwards its tags, not just that the endpoint would accept them.
    const fetchSpy = vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/highlights')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ configured: true, found: false, mode: 'skills', requiredSkills: [], matchedSkills: [], missingSkills: [], strengths: [], gaps: [] }),
        } as Response;
      }
      return { ok: true, json: async () => REALISTIC_CANDIDATES } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    await screen.findByText('Sudheer Reddy');

    // The highlights URL is first built before `data` has loaded (no
    // skills yet), then rebuilt once the candidate/jobtitle are known - so
    // this waits for that second, corrected call rather than checking only
    // the first.
    await waitFor(() => {
      const sentWithSkills = fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes('/highlights') && String(call[0]).includes('skills=dbt')
      );
      expect(sentWithSkills).toBe(true);
    });
  });

  it('renders skill-based Strengths/Gaps (checkmarks/warnings) when the backend reports mode "skills"', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      highlights: {
        body: {
          configured: true,
          found: true,
          mode: 'skills',
          requiredSkills: ['dbt', 'Snowflake', 'Kafka'],
          matchedSkills: ['dbt', 'Snowflake'],
          missingSkills: ['Kafka'],
          strengths: ['dbt', 'Snowflake'],
          gaps: ['Kafka'],
        },
      },
    });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });

    expect(await screen.findByText('dbt')).toBeInTheDocument();
    expect(await screen.findByText(/Kafka - required, not evidenced/i)).toBeInTheDocument();
  });

  it('shows an honest reason, not empty space, when the report has no recognizable Strengths/Gaps section', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      highlights: { body: { configured: true, found: true, strengths: [], gaps: [] } },
    });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });

    expect(
      await screen.findByText(/no specific strengths were called out/i)
    ).toBeInTheDocument();
  });

  it('opens download links in a new tab instead of navigating the SPA away', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    await screen.findByText('Sudheer Reddy');

    const downloadReport = screen.getByRole('link', { name: 'Download report (PDF)' });
    expect(downloadReport).toHaveAttribute('target', '_blank');
    expect(downloadReport).toHaveAttribute('href', expect.stringContaining('/api/download-profile/s1?name='));
  });

  it('shows a not-available placeholder instead of a broken player when the video fails to load', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    await screen.findByText('Sudheer Reddy');

    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    if (video) fireEvent.error(video);

    expect(
      await screen.findByText(/no recording is available for this candidate/i)
    ).toBeInTheDocument();
  });

  it('does not render a Delete action on this page - deletion lives in the Candidates list', async () => {
    mockFetchRouter({ candidates: REALISTIC_CANDIDATES });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });
    await screen.findByText('Sudheer Reddy');

    expect(screen.queryByText(/^Delete$/i)).not.toBeInTheDocument();
  });

  it('renders real Timeline events derived from status/artifacts, not a fixed fake set', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      artifacts: {
        body: {
          configured: true,
          profile: { exists: true, generatedAt: '2026-02-26T10:00:00.000Z' },
          feedback: { exists: false, generatedAt: null },
          video: { exists: false, generatedAt: null },
        },
      },
    });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });

    expect(await screen.findByText('Candidate record created')).toBeInTheDocument();
    expect(await screen.findByText('Profile match report generated')).toBeInTheDocument();
    // s1's status is 'Interview Scheduled' - appears once as the header's
    // Stage badge and again as this Timeline event, hence >= 2, not
    // findByText (which throws on more than one match).
    await screen.findByText('Profile match report generated'); // wait for the timeline to finish rendering
    expect(screen.getAllByText('Interview scheduled').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the granular session events (upload/opened/started/completed) when a real session record is found', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      sessionTimeline: {
        body: {
          configured: true,
          found: true,
          createdAt: '2026-08-04T11:46:00.000Z',
          firstAccessedAt: '2026-08-05T09:20:00.000Z',
          interviewStartedAt: '2026-08-05T09:22:00.000Z',
          completedAt: '2026-08-06T11:06:00.000Z',
          status: 'completed',
        },
      },
    });
    // s3 (John Smith) has status 'Interview Completed' in the fixture.
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s3', path: PATH });

    expect(await screen.findByText('Resume uploaded')).toBeInTheDocument();
    expect(screen.getByText('Interview link opened')).toBeInTheDocument();
    expect(screen.getByText('Interview started')).toBeInTheDocument();
    // "Interview completed" appears here (from the session's own completedAt)
    // and again in the header's Stage badge.
    expect(screen.getAllByText('Interview completed').length).toBeGreaterThanOrEqual(1);
    // The trailing live marker - "now", not a fixed historical timestamp.
    expect(screen.getByText('Awaiting your decision')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('falls back to the generic timeline events when no session record is found for this candidate', async () => {
    mockFetchRouter({
      candidates: REALISTIC_CANDIDATES,
      sessionTimeline: { body: { configured: true, found: false } },
    });
    renderWithProviders(<CandidateProfileView />, { route: '/candidates/s1', path: PATH });

    expect(await screen.findByText('Candidate record created')).toBeInTheDocument();
    expect(screen.queryByText('Resume uploaded')).not.toBeInTheDocument();
    expect(screen.queryByText('Interview link opened')).not.toBeInTheDocument();
  });
});
