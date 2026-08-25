import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from './TopBar';
import { renderWithProviders, mockCandidatesFetch } from '@/test/testUtils';
import { REALISTIC_CANDIDATES, EMPTY_CANDIDATES } from '@/test/fixtures';

afterEach(() => vi.restoreAllMocks());

describe('TopBar notifications', () => {
  it('the bell button is interactive, not a disabled stub', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);
    const bell = await screen.findByRole('button', { name: /recent activity/i });
    expect(bell).not.toBeDisabled();
  });

  it('shows real recent activity (candidate name + stage) when clicked', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);

    await userEvent.click(await screen.findByRole('button', { name: /recent activity/i }));

    expect(await screen.findByText('Recent activity')).toBeInTheDocument();
    // s2 (Jane Doe) has the most recent updatedat in the realistic fixture.
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
  });

  it('shows a real red dot when there is activity, no dot when there is none', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    const { container, unmount } = renderWithProviders(<TopBar title="Dashboard" />);
    await screen.findByRole('button', { name: /recent activity/i });
    await waitFor(() => expect(container.querySelector('.bg-status-red')).toBeTruthy());
    unmount();

    mockCandidatesFetch(EMPTY_CANDIDATES);
    const { container: emptyContainer } = renderWithProviders(<TopBar title="Dashboard" />);
    await screen.findByRole('button', { name: /recent activity/i });
    await waitFor(() => expect(emptyContainer.querySelector('.bg-status-red')).toBeFalsy());
  });

  it('shows an honest empty state instead of fake notifications when there is no activity', async () => {
    mockCandidatesFetch(EMPTY_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);

    await userEvent.click(await screen.findByRole('button', { name: /recent activity/i }));
    expect(await screen.findByText(/No candidate updates yet/i)).toBeInTheDocument();
  });

  it('closes the dropdown after selecting a candidate', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);

    await userEvent.click(await screen.findByRole('button', { name: /recent activity/i }));
    await screen.findByText('Recent activity');

    await userEvent.click(screen.getByText(/Jane Doe/));
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
  });
});

describe('TopBar help', () => {
  it('the help button is interactive, not a disabled stub', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);
    const help = await screen.findByRole('button', { name: /^help$/i });
    expect(help).not.toBeDisabled();
  });

  it('opens a real help panel describing actual app behavior and data limits', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);

    await userEvent.click(await screen.findByRole('button', { name: /^help$/i }));

    expect(await screen.findByText('Where the data comes from')).toBeInTheDocument();
    expect(screen.getByText(/doesn't include a\s*Department field/i)).toBeInTheDocument();
  });

  it('closes when clicking outside the panel', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);

    await userEvent.click(await screen.findByRole('button', { name: /^help$/i }));
    await screen.findByText('Where the data comes from');

    await userEvent.click(document.body);
    expect(screen.queryByText('Where the data comes from')).not.toBeInTheDocument();
  });

  it('opening Help closes an already-open notifications dropdown', async () => {
    mockCandidatesFetch(REALISTIC_CANDIDATES);
    renderWithProviders(<TopBar title="Dashboard" />);

    await userEvent.click(await screen.findByRole('button', { name: /recent activity/i }));
    await screen.findByText('Recent activity');

    await userEvent.click(screen.getByRole('button', { name: /^help$/i }));
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
  });
});
