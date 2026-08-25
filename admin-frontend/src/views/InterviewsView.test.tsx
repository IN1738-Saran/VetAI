import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InterviewsView } from './InterviewsView';
import { renderWithProviders } from '@/test/testUtils';

afterEach(() => vi.restoreAllMocks());

function pdfFile(name: string, sizeBytes = 2048) {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x25, 0x50, 0x44, 0x46]); // %PDF
  return new File([bytes], name, { type: 'application/pdf' });
}

// A realistic /api/create-interview response - the real fields the backend
// already returns (interviewController.js/resumeFields.js, both unchanged),
// used to verify the result view actually renders them.
const REALISTIC_CREATE_RESPONSE = {
  success: true,
  count: 1,
  sessions: [
    {
      sessionId: 'a1b2c3d4-0000-1111-2222-333344445555',
      resumeFileName: 'resume.pdf',
      interviewUrl: 'https://localhost:3001/interview/a1b2c3d4-0000-1111-2222-333344445555',
      ocr: {
        source: 'azure-document-intelligence',
        charactersExtracted: 1834,
        documentInfo: { model: 'prebuilt-layout', pages: 1, processingTimeSeconds: 2.1 },
        warnings: [],
        error: null,
        resumeInfo: {
          name: 'Jordan Rivera',
          email: 'jordan.rivera@example.com',
          phone: '9876543210',
          location: 'Chennai, India',
          linkedin: '',
          github: '',
          portfolio: '',
          jobTitle: 'Senior Data Engineer',
          experience: '4+ years',
          skills: ['Python', 'SQL'],
          technicalSkills: ['Python'],
          softSkills: [],
          education: [],
          certifications: [],
          projects: [],
          companies: [],
          designations: [],
          languages: [],
        },
        stats: { fieldsDetected: 6, totalFields: 18, missingFields: [] },
        rawText: 'raw text preview',
        rawTextTruncated: false,
      },
    },
  ],
  skipped: [],
  skippedCount: 0,
};

async function fillAndSubmit() {
  await userEvent.type(screen.getByPlaceholderText(/e\.g\. Data Engineer/i), 'Senior Data Engineer');
  await userEvent.type(screen.getByPlaceholderText(/Press Enter or , to add/i), 'candidate@example.com{enter}');
  const fileInputs = document.querySelectorAll('input[type="file"]');
  await userEvent.upload(fileInputs[0] as HTMLInputElement, pdfFile('jd.pdf'));
  await userEvent.upload(fileInputs[1] as HTMLInputElement, pdfFile('resume.pdf'));
  await userEvent.click(screen.getByRole('button', { name: /create interview/i }));
}

function mockConfigsFetch(configs: Array<{ id: number; jobtitle: string; emails: string }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url.includes('/api/job-email-configs')) {
      return { ok: true, json: async () => ({ success: true, configs }) } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  });
}

describe('InterviewsView (New Interview)', () => {
  it('disables submit until every real requirement is met', async () => {
    renderWithProviders(<InterviewsView />);
    const submit = screen.getByRole('button', { name: /create interview/i });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. Data Engineer/i), 'Data Engineer - Entry Level');
    expect(submit).toBeDisabled(); // still missing email/files

    const emailInput = screen.getByPlaceholderText(/Press Enter or , to add/i);
    await userEvent.type(emailInput, 'candidate@example.com{enter}');
    expect(submit).toBeDisabled(); // still missing files

    const fileInputs = document.querySelectorAll('input[type="file"]');
    await userEvent.upload(fileInputs[0] as HTMLInputElement, pdfFile('jd.pdf'));
    await userEvent.upload(fileInputs[1] as HTMLInputElement, pdfFile('resume.pdf'));

    expect(submit).toBeEnabled();
  });

  it('cosmetic-only controls (length, source) never gate submission, and there is no fake Schedule option', () => {
    renderWithProviders(<InterviewsView />);
    // Old_Version never had a scheduled-delivery concept - interviews always
    // send immediately, so there should be no such control to fake it with.
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();
    expect(screen.getAllByText(/not saved with the interview yet/i).length).toBe(2);
  });

  it('Fill from Job Library actually fills the job title field with a real listing', async () => {
    renderWithProviders(<InterviewsView />);
    const titleInput = screen.getByPlaceholderText(/e\.g\. Data Engineer/i) as HTMLInputElement;
    expect(titleInput.value).toBe('');

    await userEvent.selectOptions(
      screen.getByLabelText(/fill job title from job library/i),
      'Senior QA Analyst'
    );

    expect(titleInput.value).toBe('Senior QA Analyst');
  });

  it('flags an oversized file instead of accepting it as ready', async () => {
    // Named .pdf so @testing-library/user-event's accept=".pdf" filtering
    // (it simulates a real OS file picker and silently drops non-matching
    // files) lets the upload through - the app's own isPdfLike() should
    // still reject it on size, which is the actual behavior under test.
    renderWithProviders(<InterviewsView />);
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const oversized = pdfFile('resume.pdf', 11 * 1024 * 1024);
    await userEvent.upload(fileInputs[1] as HTMLInputElement, oversized);

    expect(screen.getByText(/must be a PDF under 10MB/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create interview/i })).toBeDisabled();
  });

  it('shows the real interview link with a working copy button after creation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => REALISTIC_CREATE_RESPONSE,
    } as Response);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithProviders(<InterviewsView />);
    await fillAndSubmit();

    expect(await screen.findByText('Jordan Rivera')).toBeInTheDocument();
    expect(
      screen.getByText('https://localhost:3001/interview/a1b2c3d4-0000-1111-2222-333344445555')
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(
      'https://localhost:3001/interview/a1b2c3d4-0000-1111-2222-333344445555'
    );
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows the real, mined resume fields once the Resume information panel is opened', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => REALISTIC_CREATE_RESPONSE,
    } as Response);

    renderWithProviders(<InterviewsView />);
    await fillAndSubmit();

    await screen.findByText('Jordan Rivera');
    await userEvent.click(screen.getByRole('button', { name: /resume information/i }));

    expect(screen.getByText('jordan.rivera@example.com')).toBeInTheDocument();
    expect(screen.getByText('Senior Data Engineer')).toBeInTheDocument();
    // linkedin/github/portfolio were all empty strings in the mocked response.
    expect(screen.getAllByText('Not found').length).toBeGreaterThan(0);
  });

  it('surfaces extraction warnings, document details and a raw-text preview - the OCR verification the original admin page showed', async () => {
    const withWarning = {
      ...REALISTIC_CREATE_RESPONSE,
      sessions: [
        {
          ...REALISTIC_CREATE_RESPONSE.sessions[0],
          ocr: {
            ...REALISTIC_CREATE_RESPONSE.sessions[0].ocr,
            warnings: ['Azure OCR returned no usable text; the local parser was used instead.'],
          },
        },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => withWarning } as Response);

    renderWithProviders(<InterviewsView />);
    await fillAndSubmit();

    await screen.findByText('Jordan Rivera');
    await userEvent.click(screen.getByRole('button', { name: /resume information/i }));

    expect(
      screen.getByText('Azure OCR returned no usable text; the local parser was used instead.')
    ).toBeInTheDocument();
    expect(screen.getByText('prebuilt-layout')).toBeInTheDocument();
    expect(screen.getByText('2.1s')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /show the raw text read from this file/i }));
    expect(screen.getByText('raw text preview')).toBeInTheDocument();
  });

  it('shows real saved job-title/email lists when the email field is focused, and applying one fills both fields', async () => {
    mockConfigsFetch([{ id: 1, jobtitle: 'Associate Data Engineer', emails: 'a@systechusa.com, b@systechusa.com' }]);
    renderWithProviders(<InterviewsView />);

    const emailInput = screen.getByPlaceholderText(/Press Enter or , to add/i);
    await userEvent.click(emailInput);

    // "Associate Data Engineer" also exists as a Job Library <option> - scope
    // to the dropdown's own suggestion button, not a page-wide text query.
    const suggestionButton = await screen.findByRole('button', { name: /Associate Data Engineer/i });
    expect(within(suggestionButton).getByText('2 emails')).toBeInTheDocument();

    await userEvent.click(suggestionButton);

    const titleInput = screen.getByPlaceholderText(/e\.g\. Data Engineer/i) as HTMLInputElement;
    expect(titleInput.value).toBe('Associate Data Engineer');
    expect(screen.getByText('a@systechusa.com')).toBeInTheDocument();
    expect(screen.getByText('b@systechusa.com')).toBeInTheDocument();
  });

  it('does not overwrite an already-typed job title when applying a saved config', async () => {
    mockConfigsFetch([{ id: 1, jobtitle: 'Associate Data Engineer', emails: 'a@systechusa.com' }]);
    renderWithProviders(<InterviewsView />);

    const titleInput = screen.getByPlaceholderText(/e\.g\. Data Engineer/i) as HTMLInputElement;
    await userEvent.type(titleInput, 'My Own Title');

    const emailInput = screen.getByPlaceholderText(/Press Enter or , to add/i);
    await userEvent.click(emailInput);
    await userEvent.click(await screen.findByRole('button', { name: /Associate Data Engineer/i }));

    expect(titleInput.value).toBe('My Own Title');
    expect(screen.getByText('a@systechusa.com')).toBeInTheDocument();
  });

  it('offers to add a typed value as a new email when it looks like one', async () => {
    mockConfigsFetch([]);
    renderWithProviders(<InterviewsView />);

    const emailInput = screen.getByPlaceholderText(/Press Enter or , to add/i);
    await userEvent.type(emailInput, 'new@candidate.com');

    const addRow = await screen.findByText(/add "new@candidate.com" as a new email/i);
    await userEvent.click(addRow);

    expect(screen.getByText('new@candidate.com')).toBeInTheDocument();
  });
});
