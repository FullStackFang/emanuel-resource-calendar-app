// src/__tests__/__helpers__/queryClientWrapper.jsx
//
// Test helper: wraps children in a fresh QueryClientProvider for each test
// invocation. Use as the `wrapper` option to `render(...)` from
// @testing-library/react, or wrap inline at the call site.
//
// Each test gets its own isolated QueryClient — no cache bleed between tests.
// Retries are disabled so failed mocked fetches surface immediately rather
// than waiting through 2 retry attempts (the production default in
// queryClient.js). gcTime is set to Infinity so cache entries are not
// automatically discarded mid-test by React Query's internal GC.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Render-wrapper factory.
 *
 *   render(<Component/>, { wrapper: withQueryClient() })
 *
 * Returns a fresh wrapper closed over a fresh client per call so tests stay
 * independent.
 */
export function withQueryClient(client = createTestQueryClient()) {
  return function QueryWrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
