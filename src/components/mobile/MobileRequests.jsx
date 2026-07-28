// src/components/mobile/MobileRequests.jsx
//
// The REQUESTER's own reservation requests, on a phone.
//
// Read the name carefully — this codebase inverts the obvious reading:
//   ReservationRequests.jsx → the APPROVER's inbox (view=approval-queue)
//   MyReservations.jsx      → the requester's desktop view (view=my-events)
//   MobileRequests.jsx      → THIS FILE, the requester's mobile view
// It shows requests the signed-in user made, never requests awaiting their
// approval. The mobile Approvals tab is a separate, permission-gated change.
//
// Server-side scoping by roomReservationData.requestedBy.email is the endpoint's
// job; this component never filters by owner itself.

import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import APP_CONFIG from '../../config/config';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { useAuthenticatedFetch } from '../../hooks/useAuthenticatedFetch';
import { keys } from '../../queries/keys';
import { transformEventsToFlatStructure } from '../../utils/eventTransformers';
import { deriveListLoadingState } from '../../utils/listLoadingState';
import { logger } from '../../utils/logger';
import EmptyStateRefreshButton from '../shared/EmptyStateRefreshButton';
import MobileEventCard from './MobileEventCard';
import MobileEventDetail from './MobileEventDetail';
import './MobileRequests.css';

// Order matters — this is the chip row, left to right. `countKey` names the
// field on GET /api/events/list/counts?view=my-events. Deleted requests are
// deliberately absent: the counts endpoint excludes them from `all`, so
// offering a Deleted chip would make the chip totals disagree with the list.
const STATUS_FILTERS = [
  { id: 'all', label: 'All', countKey: 'all' },
  { id: 'pending', label: 'Pending', countKey: 'pending' },
  { id: 'published', label: 'Published', countKey: 'published' },
  { id: 'rejected', label: 'Rejected', countKey: 'rejected' },
  { id: 'draft', label: 'Draft', countKey: 'draft' },
];

// Children of a recurring series (exception / addition override documents) are
// rendering units, never approval units — one card per series, not per override.
// The endpoint already excludes them via NON_CHILD_EVENT_TYPE_FILTER; this is
// the client-side half of the same invariant.
const CHILD_EVENT_TYPES = new Set(['exception', 'addition']);

function MobileRequests() {
  const { apiToken } = useAuth();
  const { isConnected } = useSSE();
  const authFetch = useAuthenticatedFetch();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // Same key MyReservations uses, so the two views share one cache entry and a
  // withdrawal on either surface invalidates both. That sharing is only sound
  // because both queryFns resolve to the SAME shape: a flat array from
  // transformEventsToFlatStructure. Do not return a wrapper object here.
  const listKey = keys.events.list({ view: 'my-events', includeDeleted: true });
  const countsKey = keys.events.counts({ view: 'my-events' });

  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: async ({ signal }) => {
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list?view=my-events&limit=1000&includeDeleted=true`,
        { signal }
      );
      if (!response.ok) throw new Error('Failed to load requests');
      const data = await response.json();
      const transformed = transformEventsToFlatStructure(data.events || []);

      // Stale-write guard (mirrors MyReservations): a refetch returning 0 while
      // we already hold populated data is replica lag or a 401-retry race, not
      // truth. First load has no prior data, so an empty response is accepted.
      if (transformed.length === 0) {
        const previous = queryClient.getQueryData(listKey);
        if (Array.isArray(previous) && previous.length > 0) {
          logger.warn('MobileRequests: refetch returned 0 events; keeping previous cached data');
          return previous;
        }
      }
      return transformed;
    },
    enabled: !!apiToken,
    staleTime: 5 * 60 * 1000,
    refetchInterval: isConnected ? 5 * 60 * 1000 : 30 * 1000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  const countsQuery = useQuery({
    queryKey: countsKey,
    queryFn: async ({ signal }) => {
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list/counts?view=my-events`,
        { signal }
      );
      if (!response.ok) throw new Error('Failed to load counts');
      return response.json();
    },
    enabled: !!apiToken,
    staleTime: 5 * 60 * 1000,
    refetchInterval: isConnected ? 5 * 60 * 1000 : 30 * 1000,
    refetchIntervalInBackground: false,
  });

  // The shared, unit-tested definition of first-load vs silent refresh. `loading`
  // binds to isFirstLoad (isPending), NEVER to query.isLoading — isLoading is
  // false during the pending+idle tick and flashes the empty state.
  // See CLAUDE.md "React Query loading primitives".
  const { isFirstLoad: loading, isSilentRefreshing } = deriveListLoadingState(
    listQuery,
    { countsQuery }
  );

  const counts = countsQuery.data ?? {};
  const error = listQuery.error?.message || '';

  const allRequests = useMemo(() => {
    const rows = listQuery.data ?? [];
    return rows.filter(r => !CHILD_EVENT_TYPES.has(r.eventType));
  }, [listQuery.data]);

  const visibleRequests = useMemo(() => {
    const rows = statusFilter === 'all'
      ? allRequests.filter(r => r.status !== 'deleted')
      : allRequests.filter(r => r.status === statusFilter);
    // Soonest first — a request list is read forward in time, unlike the
    // desktop table which defaults to most-recently-submitted.
    return [...rows].sort((a, b) =>
      (a.startDateTime || '').localeCompare(b.startDateTime || '')
    );
  }, [allRequests, statusFilter]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: listKey }),
        queryClient.refetchQueries({ queryKey: countsKey }),
      ]);
    } finally {
      setIsManualRefreshing(false);
    }
    // listKey/countsKey are rebuilt each render but deeply equal; TanStack
    // matches keys structurally, so they are safe to omit from deps.
  }, [queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called after a successful withdraw in the detail sheet: drop the sheet and
  // re-sync both the list and the chip counts.
  const handleWithdrawn = useCallback(() => {
    setSelectedEvent(null);
    queryClient.invalidateQueries({ queryKey: keys.events.list({ view: 'my-events', includeDeleted: true }) });
    queryClient.invalidateQueries({ queryKey: keys.events.counts({ view: 'my-events' }) });
  }, [queryClient]);

  // True empty: the account has no requests at all. Distinct from a filter that
  // matched nothing — only this case earns a recovery affordance.
  const showEmptyState = !loading && !isSilentRefreshing && allRequests.length === 0;

  return (
    <div className="mobile-requests">
      {/* Status ledger. The count leads and the status captions it — both
          because that is the order this screen is read in ("where do things
          stand?" before "which one?"), and because five labelled pills with
          count badges need ~470px of the 351px a 375px phone actually has.
          Stacking is what buys the room; shrinking could not. */}
      <div className="mobile-requests-filters" role="tablist" aria-label="Filter requests by status">
        {STATUS_FILTERS.map(filter => {
          const count = counts[filter.countKey];
          const active = statusFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={[
                'mobile-requests-status',
                active ? 'active' : '',
                count === 0 ? 'empty' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setStatusFilter(filter.id)}
            >
              {/* Non-breaking space holds the line box before counts resolve,
                  so the row never reflows under the user's thumb. */}
              <span className="mobile-requests-status-count">
                {typeof count === 'number' ? count : ' '}
              </span>
              <span className="mobile-requests-status-label">{filter.label}</span>
            </button>
          );
        })}
      </div>

      <div className={`mobile-requests-list ${isSilentRefreshing ? 'refreshing' : ''}`}>
        {loading ? (
          <div className="mobile-requests-skeleton" data-testid="mobile-requests-skeleton">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="mobile-requests-skeleton-card skeleton" />
            ))}
          </div>
        ) : error ? (
          <div className="mobile-requests-empty">
            <p className="mobile-requests-empty-title">Unable to load your requests</p>
            <p className="mobile-requests-empty-desc">{error}</p>
            <EmptyStateRefreshButton
              onClick={handleManualRefresh}
              isRefreshing={isManualRefreshing}
              label="Try Again"
            />
          </div>
        ) : showEmptyState ? (
          <div className="mobile-requests-empty">
            <p className="mobile-requests-empty-title">No requests yet</p>
            <p className="mobile-requests-empty-desc">
              Room requests you submit will appear here.
            </p>
            <EmptyStateRefreshButton
              onClick={handleManualRefresh}
              isRefreshing={isManualRefreshing}
            />
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="mobile-requests-no-match">
            No {statusFilter} requests
          </div>
        ) : (
          visibleRequests.map(request => (
            <MobileEventCard
              key={request.id || request._id}
              event={request}
              onTap={setSelectedEvent}
              showDate
              showStatus
            />
          ))
        )}
      </div>

      <MobileEventDetail
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        showReservationContext
        onWithdrawn={handleWithdrawn}
      />
    </div>
  );
}

export default MobileRequests;
