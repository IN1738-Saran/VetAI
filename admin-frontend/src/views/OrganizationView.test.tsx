import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { OrganizationView } from './OrganizationView';
import { renderWithProviders } from '@/test/testUtils';

afterEach(() => vi.restoreAllMocks());

describe('OrganizationView', () => {
  it('renders real connected/not-configured status from the backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        blobStorage: true,
        voiceInterview: true,
        documentIntelligence: false,
        database: true,
        aiAssistant: false,
      }),
    } as Response);

    renderWithProviders(<OrganizationView />);

    const voiceRow = (await screen.findByText('Voice-to-voice interview')).closest('li') as HTMLElement;
    expect(voiceRow).toHaveTextContent('Connected');

    const assistantRow = (await screen.findByText('AI Assistant chat')).closest('li') as HTMLElement;
    expect(assistantRow).toHaveTextContent('Not configured');
  });

  it('shows an honest error state instead of crashing when the status endpoint fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    renderWithProviders(<OrganizationView />);

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
  });
});
