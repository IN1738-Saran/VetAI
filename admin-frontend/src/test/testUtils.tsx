import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render } from '@testing-library/react';
import type { RawCandidate } from '@/lib/candidates';

// Fresh QueryClient per render call - retry:0 so a mocked-fetch failure in a
// test surfaces immediately as isError instead of retrying and timing out.
function newTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', path }: { route?: string; path?: string } = {}
) {
  const client = newTestQueryClient();
  const wrapped: ReactNode = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : (
    ui
  );

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{wrapped}</MemoryRouter>
    </QueryClientProvider>
  );
}

// Mocks the module-level fetch() call every view's useCandidates() hook
// goes through (lib/candidates.ts -> fetchCandidates). Component tests use
// this instead of hitting the real n8n endpoint.
export function mockCandidatesFetch(candidates: RawCandidate[]) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => candidates,
  } as Response);
}
