import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsView } from './ReportsView';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

describe('ReportsView', () => {
  it('renders real KPIs and the role breakdown table', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<ReportsView />);

    expect(await screen.findByText('Candidates in range')).toBeInTheDocument();
    // Also appears as a job filter <option> - scope to the role-breakdown
    // table cell specifically rather than a page-wide getByText.
    const roleCell = screen.getAllByText('Senior Data Engineer (DBT & Snowflake)').find((el) => el.tagName === 'TD');
    expect(roleCell).toBeTruthy();
    expect(screen.getByText('5 candidates will be included.')).toBeInTheDocument();
  });

  it('renders an empty state for zero candidates', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<ReportsView />);
    expect(await screen.findByText(/No candidates yet/i)).toBeInTheDocument();
  });

  it('triggers a real CSV download of the in-range candidates when exporting', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<ReportsView />);
    await screen.findByText('Candidates in range');

    const createObjectURL = vi.fn((_obj: Blob) => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await userEvent.click(screen.getAllByRole('button', { name: /export csv/i })[0]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toContain('text/csv');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
