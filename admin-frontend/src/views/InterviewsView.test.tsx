import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InterviewsView } from './InterviewsView';
import { renderWithProviders } from '@/test/testUtils';

function pdfFile(name: string, sizeBytes = 2048) {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x25, 0x50, 0x44, 0x46]); // %PDF
  return new File([bytes], name, { type: 'application/pdf' });
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

  it('cosmetic-only controls (length, source, schedule) never gate submission', () => {
    renderWithProviders(<InterviewsView />);
    // "Schedule" is disabled outright - not a working alternate path to "Now".
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeDisabled();
    expect(screen.getByText(/no server-side field today/i)).toBeInTheDocument();
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
});
