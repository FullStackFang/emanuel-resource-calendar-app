// src/config/queryClient.js
/**
 * TanStack Query client configuration with localStorage persistence
 * Provides automatic caching, background refetching, and data persistence
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

// Only persist cache in browser environment with localStorage available
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: 'emanuelCalendar_queryCache',
    });

    persistQueryClient({
      queryClient,
      persister,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours max cache age
      dehydrateOptions: {
        // Only persist successful queries
        shouldDehydrateQuery: (query) => query.state.status === 'success',
      },
    });
  } catch (error) {
    // Graceful degradation if localStorage unavailable (private browsing, etc.)
    console.warn('localStorage not available, query cache will not persist:', error.message);
  }
}

export default queryClient;
