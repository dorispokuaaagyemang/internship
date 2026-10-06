import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AuthContext } from '../features/auth/auth-context';

// Shows where navigation ended up, so tests can assert redirects.
export function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

export function makeAuth(overrides = {}) {
  return {
    status: 'signedIn',
    user: { id: 7, email: 'ada@example.com', role: 'student', status: 'active', phoneE164: '+254712345678', emailVerifiedAt: '2026-10-06T00:00:00Z' },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
    reloadUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// Renders `routes` (a <Route> tree, or a single element at `path`) at `route`, with a fresh
// query client and the given auth state. A catch-all route shows the final location.
export function renderApp(ui, { route = '/', path = '/', auth = makeAuth() } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const routes = ui.type === Route || Array.isArray(ui) ? ui : <Route path={path} element={ui} />;
  return {
    auth,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              {routes}
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    ),
  };
}
