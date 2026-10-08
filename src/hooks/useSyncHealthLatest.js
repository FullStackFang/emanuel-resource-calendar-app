import { useQuery } from '@tanstack/react-query';
import APP_CONFIG from '../config/config';
import { keys } from '../queries/keys';

const MINUTE = 60 * 1000;

/**
 * Latest SCHEDULED sync health summary (edit-request-approval-graph-sync D6).
 * No SSE carries scheduler results, so it polls: the server runs every few
 * hours and this only needs to notice within a quarter hour.
 *
 * @param {Object} args
 * @param {Function} args.authFetch - from useAuthenticatedFetch
 * @param {boolean} args.enabled - only admins/approvers may read it
 * @returns The TanStack query; `data` is the summary or null.
 */
export function useSyncHealthLatest({ authFetch, enabled }) {
  return useQuery({
    queryKey: keys.syncHealth.latest(),
    enabled: !!enabled && !!authFetch,
    staleTime: 5 * MINUTE,
    refetchInterval: 15 * MINUTE,
    queryFn: async () => {
      const res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/reports/sync-health/latest`);
      if (!res.ok) throw new Error('Could not load the latest sync health run');
      const body = await res.json();
      return body.latest || null;
    },
  });
}

/**
 * Findings someone should act on. `untracked` is chronic and `untethered` has
 * its own reconcile flow, so neither counts — a permanent badge trains people
 * to ignore it.
 */
export function actionableSyncHealthCount(latest) {
  const c = latest?.counts || {};
  return (c.missingFromOutlook || 0) + (c.shouldNotBeInOutlook || 0) + (c.failedDeletion || 0);
}
