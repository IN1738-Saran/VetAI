import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileView } from './ProfileView';
import { renderWithProviders } from '@/test/testUtils';

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('ProfileView', () => {
  it('defaults the landing-page preference to Dashboard', () => {
    renderWithProviders(<ProfileView />);
    expect(screen.getByRole('combobox')).toHaveValue('/dashboard');
  });

  it('persists a chosen landing page to localStorage', async () => {
    renderWithProviders(<ProfileView />);
    await userEvent.selectOptions(screen.getByRole('combobox'), '/ai-assistant');

    expect(window.localStorage.getItem('vetai_default_landing_page_v1')).toBe('/ai-assistant');
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('does not claim a personal account exists', () => {
    renderWithProviders(<ProfileView />);
    expect(screen.getByText(/sign-in isn't set up/i)).toBeInTheDocument();
  });
});
