// Real, working per-browser preferences - persisted to localStorage, same
// mechanism already used for Job Library's custom jobs (lib/jobLibrary.ts).
// There is no user-account system in this app yet (see TopBar.tsx's
// CURRENT_USER comment), so these are workspace-wide-per-browser settings,
// not per-person ones - the Profile page is honest about that distinction.
const LANDING_PAGE_KEY = 'vetai_default_landing_page_v1';

export const LANDING_PAGE_OPTIONS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/interviews', label: 'New interview' },
  { path: '/candidates', label: 'Candidates' },
  { path: '/ai-assistant', label: 'AI Assistant' },
  { path: '/job-library', label: 'Job Library' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/email-center', label: 'Email Center' },
  { path: '/reports', label: 'Reports' },
] as const;

const VALID_PATHS = new Set(LANDING_PAGE_OPTIONS.map((o) => o.path));

export function getDefaultLandingPage(): string {
  try {
    const stored = window.localStorage.getItem(LANDING_PAGE_KEY);
    return stored && VALID_PATHS.has(stored as (typeof LANDING_PAGE_OPTIONS)[number]['path'])
      ? stored
      : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export function setDefaultLandingPage(path: string): void {
  try {
    window.localStorage.setItem(LANDING_PAGE_KEY, path);
  } catch {
    // localStorage unavailable (private browsing, etc.) - preference just
    // won't persist across sessions; not worth surfacing an error for.
  }
}
