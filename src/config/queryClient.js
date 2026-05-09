// src/config/queryClient.js
/**
 * TanStack Query client configuration with sessionStorage persistence
 * Provides automatic caching and background refetching.
 * Uses sessionStorage (not localStorage) so sensitive event data is cleared on tab close.
 *
 * ─── Query key conventions ────────────────────────────────────────────────
 * Construct query keys via the factory in `src/queries/keys.js` — do NOT
 * inline `['events', someScope]` literals at call sites. Inline keys silently
 * drift over time and break selective invalidation.
 *
 * Shape: keys are arrays. First element is the resource name; subsequent
 * elements are scope discriminators in order of decreasing specificity:
 *
 *   ['<resource>', '<sub-resource-or-action>', <scope params>]
 *
 * Prefix-based invalidation:
 *   queryClient.invalidateQueries({ queryKey: keys.events.all() })
 *     → matches every events.* key (broad invalidate, e.g. on server restart)
 *   queryClient.invalidateQueries({ queryKey: keys.events.list() })
 *     → matches every events.list.* key
 *   queryClient.invalidateQueries({ queryKey: keys.events.detail(id) })
 *     → matches exactly one detail entry
 *
 * See `src/queries/keys.js` for the full factory and per-resource shapes.
 */

import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { logger } from '../utils/logger';

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
    logger.warn('sessionStorage not available, query cache will not persist:', error.message);
  }
}

export default queryClient;
