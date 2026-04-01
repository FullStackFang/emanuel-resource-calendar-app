// src/config/queryClient.js
/**
 * TanStack Query client configuration with sessionStorage persistence
 * Provides automatic caching and background refetching.
 * Uses sessionStorage (not localStorage) so sensitive event data is cleared on tab close.
 */

import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 minutes - data considered fresh
      gcTime: 30 * 60 * 1000,        // 30 minutes - keep in cache after inactive
      refetchOnWindowFocus: true,    // Refresh when user returns to tab
      retry: 2,                       // Retry failed requests twice
      refetchOnReconnect: true,      // Refetch when network reconnects
    },
  },
});

// Persist cache using sessionStorage so data is cleared when the tab closes.
// This prevents sensitive event data (attendees, rooms, descriptions) from
// surviving across sessions on shared computers.
if (typeof window !== 'undefined' && window.sessionStorage) {
  try {
    const persister = createSyncStoragePersister({
      storage: window.sessionStorage,
      key: 'emanuelCalendar_queryCache',
    });

    persistQueryClient({
      queryClient,
      persister,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours max cache age (within session)
      dehydrateOptions: {
        // Only persist successful queries
        shouldDehydrateQuery: (query) => query.state.status === 'success',
      },
    });
  } catch (error) {
    // Graceful degradation if sessionStorage unavailable (private browsing, etc.)
    console.warn('sessionStorage not available, query cache will not persist:', error.message);
  }
}

export default queryClient;
