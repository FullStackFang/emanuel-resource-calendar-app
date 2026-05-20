// src/components/MyReservations.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import DatePickerInput from './DatePickerInput';
import { useRooms } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch';
import { useEventReviewExperience } from '../hooks/useEventReviewExperience';
import { useSSE } from '../context/SSEContext';
import { dispatchRefresh, useDataRefreshBus } from '../hooks/useDataRefreshBus';
import { transformEventsToFlatStructure } from '../utils/eventTransformers';
import { keys } from '../queries/keys';
import { getStatusBadgeInfo } from '../utils/statusUtils';
import { filterBySearchAndDate, sortReservations } from '../utils/reservationFilterUtils';
import { formatDraftAge } from '../utils/draftAgeUtils';
import { formatRecurrenceSummaryCompact } from '../utils/recurrenceUtils';
import { buildOccurrenceVariants } from '../utils/recurrenceOverrideSummary';
import EventReviewExperience from './shared/EventReviewExperience';
import LoadingSpinner from './shared/LoadingSpinner';
import FreshnessIndicator from './shared/FreshnessIndicator';
import EmptyStateRefreshButton from './shared/EmptyStateRefreshButton';
import './shared/FilterBar.css';
import './MyReservations.css';

/**
 * Inline SVG glyph for a recurrence-exception kind. Three primitives —
 * plus (added), pencil (modified), x (cancelled) — drawn at 14×16 with
 * a 1.75px stroke. Color is inherited from the parent .exceptions-icon
 * cell so each row's kind class drives the hue.
 */
function ExceptionIcon({ kind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (kind === 'added') {
    return (
      <svg {...common}>
        <line x1="8" y1="3" x2="8" y2="13" />
        <line x1="3" y1="8" x2="13" y2="8" />
      </svg>
    );
  }
  if (kind === 'modified') {
    return (
      <svg {...common}>
        <path d="M11.5 3.5 L13 5 L5 13 L3 13 L3 11 Z" />
      </svg>
    );
  }
  if (kind === 'cancelled') {
    return (
      <svg {...common}>
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </svg>
    );
  }
  return null;
}

/**
 * Build a flat virtual-occurrence object suitable for reviewModal.openModal.
 *
 * Mirrors Calendar.jsx's expansion shape (isRecurringOccurrence + masterEventId
 * + occurrenceDate + dates rebuilt from override-merged times) so the modal's
 * existing single-occurrence editing path engages without changes.
 *
 * The hook's hydrateSeriesMaster step re-fetches the master with its enriched
 * occurrenceOverrides, so the virtual we pass only needs to be enough to
 * identify which occurrence the user clicked. We also spread override fields
 * eagerly so the optimistic first paint shows the user's customized values.
 */
function buildVirtualOccurrence(master, variant) {
  const override = variant.override || {};
  const occurrenceDate = variant.occurrenceDate;
  // Master values first, override fields next (override wins for inheritable fields).
  const merged = { ...master, ...override };
  const startTime = merged.startTime || '00:00';
  const endTime = merged.endTime || '23:59';
  return {
    ...merged,
    eventId: `${master.eventId}-occurrence-${occurrenceDate}`,
    _id: `${master._id || master.eventId}-occurrence-${occurrenceDate}`,
    eventType: 'occurrence',
    isRecurringOccurrence: true,
    hasOccurrenceOverride: true,
    isAdHocAddition: variant.kind === 'added',
    masterEventId: master.eventId,
    seriesMasterId: master.eventId,
    seriesMasterEventId: master.eventId,
    occurrenceDate,
    startDate: occurrenceDate,
    endDate: occurrenceDate,
    startTime,
    endTime,
    startDateTime: `${occurrenceDate}T${startTime.length === 5 ? startTime + ':00' : startTime}`,
    endDateTime: `${occurrenceDate}T${endTime.length === 5 ? endTime + ':00' : endTime}`,
    recurrence: null,
    occurrenceOverrides: [],
  };
}

export default function MyReservations() {
  const { apiToken } = useAuth();
  const { isConnected } = useSSE();
  const authFetch = useAuthenticatedFetch();
  const { canSubmitReservation, canEditEvents, canDeleteEvents, canApproveReservations, permissionsLoading } = usePermissions();
  const { showSuccess, showWarning, showError } = useNotification();
  const queryClient = useQueryClient();

  // UI-only state — filters, pagination, modal-confirm flags, etc.
  // Server data state (allReservations, loading, error, lastFetchedAt,
  // isSilentRefreshing) is derived from the React Query cache below.
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('submitted_desc');
  const [page, setPage] = useState(1);
  const [restoreConflicts, setRestoreConflicts] = useState(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isWithdrawCancellationConfirming, setIsWithdrawCancellationConfirming] = useState(false);

  // Use room context for efficient room name resolution
  const { getRoomDetails } = useRooms();

  const isRequesterOnly = !canEditEvents && !canApproveReservations;

  // ─── Server data: my-reservations list ──────────────────────────────────
  // TanStack Query handles deduplication, request cancellation (signal),
  // background refetch, focus refetch, and persisted cache. The only
  // bespoke behavior we preserve from the prior loadMyReservations is the
  // **stale-write rule**: a refetch returning 0 events while we already had
  // populated data is treated as transient (replica lag / 401-retry race)
  // and the prior cache is kept. First load (no prior data) accepts an
  // empty response as truth.
  //
  // Cold MSAL warm-up (apiToken null at first render) is handled by
  // `enabled: !!apiToken` — the query auto-runs when the flag flips true.
  // 401-retry refreshes via authFetch are transparent; no token-identity
  // ref is needed because authFetch reads the latest token internally.

  // queryKey is constructed each render — TanStack Query deeply equates
  // arrays so reference inequality is harmless.
  const myEventsKey = keys.events.list({ view: 'my-events', includeDeleted: true });

  const myReservationsQuery = useQuery({
    queryKey: myEventsKey,
    queryFn: async ({ signal }) => {
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list?view=my-events&limit=1000&includeDeleted=true`,
        { signal }
      );
      if (!response.ok) {
        throw new Error('Failed to load reservations');
      }
      const data = await response.json();
      const transformed = transformEventsToFlatStructure(data.events || []);

      // Stale-write guard: never let a refetch returning 0 events overwrite
      // populated state. Guards against backend replica lag and 401-retry
      // races that would otherwise blank the UI between server-truth syncs.
      if (transformed.length === 0) {
        const previous = queryClient.getQueryData(myEventsKey);
        if (Array.isArray(previous) && previous.length > 0) {
          logger.warn('MyReservations: refetch returned 0 events; keeping previous cached data');
          return previous;
        }
      }
      return transformed;
    },
    enabled: !!apiToken,
    staleTime: 5 * 60 * 1000,
    // Tighten poll cadence to 30s while SSE is unavailable so staleness is
    // bounded; relax to 5 min while SSE is live (sanity re-sync).
    refetchInterval: isConnected ? 5 * 60 * 1000 : 30 * 1000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  const allReservations = myReservationsQuery.data ?? [];
  // First-load gate: `isPending` covers both `pending && idle` (one-tick window
  // when `enabled` flips true) and `pending && fetching`. Prevents the
  // empty-state from rendering before the fetch starts. See CLAUDE.md
  // "React Query loading primitives" for the convention.
  const loading = myReservationsQuery.isPending;
  const error = myReservationsQuery.error?.message || '';
  const lastFetchedAt = myReservationsQuery.dataUpdatedAt || null;
  // Background refetch (polling, bus, manual, mutation invalidate) — UI uses
  // this to suppress the empty-state flash while data is being re-validated.
  const isSilentRefreshing = myReservationsQuery.isFetching && !myReservationsQuery.isPending;

  // Token rotation guard: when `apiToken` changes between two truthy values
  // (e.g., 401-retry flow rotates A → B mid-session), force a refetch so the
  // displayed data re-syncs under the fresh token. The cold-warmup transition
  // (null → A) is handled by RQ's `enabled` flip and does NOT need this effect.
  const lastSeenTokenRef = useRef(null);
  useEffect(() => {
    if (!apiToken) return;
    if (lastSeenTokenRef.current && lastSeenTokenRef.current !== apiToken) {
      queryClient.refetchQueries({
        queryKey: keys.events.list({ view: 'my-events', includeDeleted: true })
      });
    }
    lastSeenTokenRef.current = apiToken;
  }, [apiToken, queryClient]);

  // Backward-compat shim: external code (incl. onConflictRefresh prop and
  // the experience hook's onSuccess callback) holds a reference to
  // `loadMyReservations`. Implement as a thin cache wrapper so call sites
  // keep working without per-site changes during the migration.
  const loadMyReservations = useCallback(async ({ silent = false } = {}) => {
    const queryKey = keys.events.list({ view: 'my-events', includeDeleted: true });
    if (silent) {
      await queryClient.invalidateQueries({ queryKey });
    } else {
      await queryClient.refetchQueries({ queryKey });
    }
  }, [queryClient]);

  // Refresh callback for the experience hook (handles data reload + badge dispatch)
  const handleRefresh = useCallback(() => {
    loadMyReservations();
    dispatchRefresh('my-reservations', 'navigation-counts');
  }, [loadMyReservations]);

  // --- Unified review modal experience (replaces useReviewModal + satellite state) ---
  const reviewModal = useEventReviewExperience({
    apiToken,
    authFetch,
    onRefresh: handleRefresh,
    onSuccess: (result) => {
      loadMyReservations();

      // Show success/warning toast based on action type
      if (result?.conflictDowngradedToPending) {
        const rc = result.recurringConflicts;
        showWarning(`Recurring event sent to pending: ${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrence(s) have scheduling conflicts. An admin must review before publishing.`);
      } else if (result?.ownerEdit) {
        showSuccess('Changes saved');
      } else if (result?.savedAsDraft) {
        showSuccess('Draft saved');
      } else if (result?.draftSubmitted) {
        showSuccess(result.autoPublished ? 'Event created and published' : 'Request submitted for approval');
      } else if (result?.deleted) {
        showSuccess('Event deleted');
      } else if (result?.editRequestSubmitted) {
        showSuccess('Edit request submitted for review');
      } else if (result?.duplicated) {
        if (result.failCount > 0) {
          showWarning(`${result.count} of ${result.count + result.failCount} duplicate(s) created — some failed`);
        } else if (result.count === 1 && result.dates?.[0]) {
          const label = new Date(result.dates[0] + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          showSuccess(result.autoPublished
            ? `Event duplicated to ${label}`
            : `Duplicate request for ${label} submitted for approval`);
        } else {
          showSuccess(result.autoPublished
            ? `Event duplicated to ${result.count} dates`
            : `${result.count} duplicate requests submitted for approval`);
        }
      } else if (result?.event?.status === 'published') {
        showSuccess('Event published');
      } else if (result?.event?.status === 'rejected') {
        showSuccess('Event rejected');
      } else {
        showSuccess('Changes saved');
      }
    },
    onError: (error) => { showError(error, { context: 'MyReservations' }); }
  });

  // Listen for refresh events from other views (draft submission, approval
  // actions, etc.). The bus callback invalidates the cache; RQ refetches
  // automatically if the query is observed. Will retire in §15 after every
  // bus subscriber has migrated to React Query.
  const onBusRefresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: keys.events.list({ view: 'my-events', includeDeleted: true })
    });
  }, [queryClient]);
  useDataRefreshBus('my-reservations', onBusRefresh, !!apiToken);

  // Manual refresh handler for FreshnessIndicator
  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await loadMyReservations();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [loadMyReservations]);

  // Stage 1: Apply search + date filters against all reservations
  const searchFiltered = useMemo(
    () => filterBySearchAndDate(allReservations, { searchTerm, dateFrom, dateTo }),
    [allReservations, searchTerm, dateFrom, dateTo]
  );

  // Stage 2: Apply status dropdown filter
  const filteredReservations = useMemo(() => {
    if (!statusFilter) return searchFiltered;

    return searchFiltered.filter(r => {
      switch (statusFilter) {
        case 'draft':
          return r.status === 'draft';
        case 'pending':
          return r.status === 'pending';
        case 'published':
          return r.status === 'published' && r.pendingEditRequest?.status !== 'pending';
        case 'published_edit':
          return r.status === 'published' && r.pendingEditRequest?.status === 'pending';
        case 'rejected':
          return r.status === 'rejected';
        case 'deleted':
          return r.status === 'deleted';
        default:
          return true;
      }
    });
  }, [searchFiltered, statusFilter]);

  // Stage 3: Sort filtered results
  const sortedReservations = useMemo(
    () => sortReservations(filteredReservations, sortBy),
    [filteredReservations, sortBy]
  );

  const hasActiveFilters = searchTerm || dateFrom || dateTo || statusFilter || sortBy !== 'submitted_desc';

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('');
    setSortBy('submitted_desc');
    setPage(1);
  }, []);

  // Reset page when any filter/sort changes (avoids stale pagination on filter change)
  useEffect(() => {
    setPage(1);
  }, [searchTerm, dateFrom, dateTo, statusFilter, sortBy]);

  // Pagination for sorted results
  const itemsPerPage = 20;
  const totalPages = Math.ceil(sortedReservations.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const paginatedReservations = sortedReservations.slice(startIndex, startIndex + itemsPerPage);


  // Format date/time for conflict modal display
  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // MyReservations operates at the request/series level — clicking a series
  // master from the list opens the master scope directly (editScope: 'allEvents').
  // Instance-level edits are reachable through the inline Recurrence Exceptions
  // table below, which dispatches openModal with editScope: 'thisEvent' per row.
  // This matches ReservationRequests.jsx; only Calendar (occurrence clicks on a
  // date cell) presents the thisEvent vs allEvents choice.
  const isRecurringSeriesMaster = useCallback((reservation) => {
    if (!reservation) return false;
    return reservation.eventType === 'seriesMaster'
      || (!!reservation.recurrence?.pattern && !!reservation.recurrence?.range);
  }, []);

  const openReviewForReservation = useCallback(async (reservation) => {
    const options = isRecurringSeriesMaster(reservation)
      ? { editScope: 'allEvents' }
      : undefined;
    try {
      await reviewModal.openModal(reservation, options);
    } catch (err) {
      logger.error('Error opening review modal from MyReservations:', err);
      showError(err, {
        context: 'MyReservations.openReviewForReservation',
        userMessage: 'Failed to open review modal',
      });
    }
  }, [isRecurringSeriesMaster, reviewModal, showError]);

  // --- Requester action handlers (local, not in hook) ---

  // ─── Mutations: requester actions (unique to MyReservations) ───────────
  // Each mutation:
  //   - applies an optimistic update where the post-state is deterministic
  //     (resubmit → pending; cancellation withdrawal → no client-side state
  //     change; restore → server-determined, no optimistic);
  //   - rolls back to the prior cache snapshot on error (onError);
  //   - invalidates the events list on settled so server truth syncs in;
  //   - dual-publishes via dispatchRefresh so non-migrated views (Calendar,
  //     ReservationRequests, EventManagement, counts badges) keep observing
  //     change notifications until §15 retires the bus.

  const resubmitMutation = useMutation({
    mutationFn: async ({ id, version }) => {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${id}/resubmit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _version: version || null })
      });
      if (!response.ok) throw new Error('Failed to resubmit reservation');
      return response.json();
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: myEventsKey });
      const previous = queryClient.getQueryData(myEventsKey);
      // Optimistic: rejected → pending (deterministic transition)
      queryClient.setQueryData(myEventsKey, (old = []) =>
        Array.isArray(old)
          ? old.map(r => r._id === id ? { ...r, status: 'pending' } : r)
          : old
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous !== undefined) queryClient.setQueryData(myEventsKey, ctx.previous);
      logger.error('Error resubmitting reservation:', err);
      showError(err, { context: 'MyReservations.handleResubmit' });
    },
    onSuccess: () => {
      showSuccess('Request resubmitted for approval');
      reviewModal.closeModal(true);
      dispatchRefresh('my-reservations', 'navigation-counts');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: myEventsKey });
    }
  });

  const handleResubmit = useCallback(() => {
    const item = reviewModal.currentItem;
    if (!item) return;
    resubmitMutation.mutate({ id: item._id, version: item._version });
  }, [reviewModal, resubmitMutation]);

  // Restore (owner, deleted events) — has 409 SchedulingConflict branch
  // that surfaces a conflict modal instead of a generic error toast.
  // No optimistic update because the post-restore status is server-
  // determined (statusHistory walk). The settled invalidate brings truth.
  const restoreMutation = useMutation({
    mutationFn: async ({ id, version, eventTitle }) => {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${id}/restore`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _version: version || null })
      });
      if (response.status === 409) {
        const data = await response.json();
        if (data.error === 'SchedulingConflict') {
          const err = new Error('SchedulingConflict');
          err.conflicts = { ...data, eventTitle };
          throw err;
        }
        throw new Error(data.message || 'Version conflict');
      }
      if (!response.ok) throw new Error('Failed to restore reservation');
      return response.json();
    },
    onError: (err) => {
      // SchedulingConflict surfaces the conflict modal without a generic toast
      if (err?.message === 'SchedulingConflict' && err.conflicts) {
        setRestoreConflicts(err.conflicts);
        return;
      }
      logger.error('Error restoring reservation:', err);
      showError(err, { context: 'MyReservations.handleRestore' });
    },
    onSuccess: () => {
      showSuccess('Reservation restored');
      reviewModal.closeModal(true);
      dispatchRefresh('my-reservations', 'navigation-counts');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: myEventsKey });
    }
  });

  const handleRestore = useCallback(() => {
    const item = reviewModal.currentItem;
    if (!item) return;
    restoreMutation.mutate({ id: item._id, version: item._version, eventTitle: item.eventTitle });
  }, [reviewModal, restoreMutation]);

  // --- Cancellation withdrawal mutation (unique to MyReservations) ---
  const withdrawCancellationMutation = useMutation({
    mutationFn: async ({ eventId }) => {
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/cancellation-requests/${eventId}/cancel`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to withdraw cancellation request');
      }
      return response.json();
    },
    onSuccess: () => {
      showSuccess('Cancellation request withdrawn');
      setIsWithdrawCancellationConfirming(false);
      reviewModal.closeModal();
      dispatchRefresh('my-reservations', 'navigation-counts');
    },
    onError: (error) => {
      setIsWithdrawCancellationConfirming(false);
      showError(error, { context: 'MyReservations.withdrawCancellationRequest' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: myEventsKey });
    }
  });

  const handleWithdrawCancellationRequest = useCallback(() => {
    // Two-click in-button confirmation pattern (per CLAUDE.md UX standard).
    if (!isWithdrawCancellationConfirming) {
      setIsWithdrawCancellationConfirming(true);
      return;
    }
    const currentItem = reviewModal.currentItem;
    if (!currentItem) return;
    const eventId = currentItem._id || currentItem.eventId;
    withdrawCancellationMutation.mutate({ eventId });
  }, [isWithdrawCancellationConfirming, reviewModal, withdrawCancellationMutation]);

  const cancelWithdrawCancellationConfirmation = useCallback(() => {
    setIsWithdrawCancellationConfirming(false);
  }, []);

  // Loading flags used by ReviewModal — derived from each mutation's pending state.
  const isResubmitting = resubmitMutation.isPending;
  const isRestoring = restoreMutation.isPending;
  const isWithdrawingCancellationRequest = withdrawCancellationMutation.isPending;

  // Show loading while permissions are being determined
  if (permissionsLoading) {
    return <LoadingSpinner variant="card" text="Loading..." />;
  }

  // Access control - hide for Viewer role
  if (!canSubmitReservation) {
    return (
      <div className="my-reservations">
        <div className="access-denied">
          <h2>Access Restricted</h2>
          <p>You do not have permission to view reservations.</p>
        </div>
      </div>
    );
  }

  if (loading && allReservations.length === 0) {
    return <LoadingSpinner variant="card" text="Loading..." />;
  }

  // Determine ReviewModal title (event name only — mode is shown via mode pill)
  const getModalTitle = () => {
    const item = reviewModal.currentItem;
    if (!item) return 'Event';
    return reviewModal.editableData?.eventTitle || item.eventTitle || 'Event';
  };

  // Determine ReviewModal mode pill
  const getModalMode = () => {
    const item = reviewModal.currentItem;
    if (!item) return null;
    if (reviewModal.isDraft) return 'edit';
    if (isRequesterOnly) return 'view';
    if (item.status === 'pending') return 'review';
    return 'edit';
  };

  return (
    <div className="my-reservations">
      {/* Page Header - Editorial Style */}
      <div className="my-reservations-header">
        <div className="my-reservations-header-content">
          <h1>My Reservations</h1>
          <p className="my-reservations-header-subtitle">
            Track and manage your room reservation requests
            <FreshnessIndicator
              lastFetchedAt={lastFetchedAt}
              onRefresh={handleManualRefresh}
              isRefreshing={isManualRefreshing}
            />
          </p>
        </div>
        <button
          className="new-reservation-btn"
          onClick={() => window.dispatchEvent(new CustomEvent('open-new-reservation-modal'))}
          disabled={!canSubmitReservation}
          title={!canSubmitReservation ? 'You do not have permission to submit reservations' : 'Create a new reservation request'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          New Reservation
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="rr-filter-bar">
        <div className="rr-search-container">
          <svg className="rr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="rr-search-input"
            placeholder="Search by title, room, or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="rr-search-clear" onClick={() => setSearchTerm('')} title="Clear search">
              &times;
            </button>
          )}
        </div>

        <div className="rr-secondary-filters">
          <div className={`rr-date-filters${dateFrom || dateTo ? ' active' : ''}`}>
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              From
            </label>
            <DatePickerInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <label>To</label>
            <DatePickerInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className={`rr-status-filter${statusFilter ? ' active' : ''}`}>
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Status
            </label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="pending">Pending</option>
              <option value="published">Published</option>
              <option value="published_edit">Edit Requested</option>
              <option value="rejected">Rejected</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>
          <div className={`rr-sort-filter${sortBy !== 'submitted_desc' ? ' active' : ''}`}>
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
              Sort
            </label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date_desc">Event Date (Newest)</option>
              <option value="date_asc">Event Date (Oldest)</option>
              <option value="submitted_desc">Submitted (Newest)</option>
              <option value="submitted_asc">Submitted (Oldest)</option>
            </select>
          </div>
          <div className={`rr-filter-actions${hasActiveFilters ? '' : ' hidden'}`}>
            <button className="rr-clear-filters" onClick={clearFilters}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Clear
            </button>
            <span className="rr-filter-results">
              {sortedReservations.length} of {allReservations.length}
            </span>
          </div>
        </div>
      </div>

      {/* Reservations List */}
      <div className="mr-reservations-list">
        {paginatedReservations.map(reservation => {
          const isOnBehalfOf = reservation.isOnBehalfOf;
          const contactName = reservation.contactName;
          const isDraft = reservation.status === 'draft';

          // Recurring-series aggregation: for a seriesMaster, the card surfaces
          // the recurrence pattern (pill) plus an inline "tree" of any per-
          // occurrence deviations (modified / cancelled / added). Regular
          // pattern occurrences are NEVER enumerated — buildOccurrenceVariants
          // only emits rows for entries in occurrenceOverrides[],
          // recurrence.exclusions[], and recurrence.additions[].
          const isSeriesMaster = reservation.eventType === 'seriesMaster';
          const recurrencePattern = reservation.recurrence?.pattern || null;
          const recurrenceRange = reservation.recurrence?.range || null;
          const recurrenceSummary = isSeriesMaster && recurrencePattern
            ? formatRecurrenceSummaryCompact(recurrencePattern, recurrenceRange)
            : '';
          const variants = isSeriesMaster ? buildOccurrenceVariants(reservation) : [];
          const hasDeviations = variants.length > 0;

          return (
            <div key={reservation._id} className={`mr-card ${isDraft ? 'mr-card-draft' : ''}`}>
              {/* Card Header - Event Title + Actions */}
              <div className="mr-card-header">
                <div className="mr-card-title-row">
                  <h3 className="mr-card-title">{reservation.isHold && !reservation.eventTitle?.startsWith('[Hold]') ? `[Hold] ${reservation.eventTitle || 'Untitled'}` : reservation.eventTitle || 'Untitled'}</h3>
                  <span className={`status-badge ${getStatusBadgeInfo(reservation).className}`}>
                    {getStatusBadgeInfo(reservation).label}
                  </span>
                  {isSeriesMaster && recurrenceSummary && (
                    <span className="mr-recurrence-pill" title={recurrenceSummary}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="17 1 21 5 17 9" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <polyline points="7 23 3 19 7 15" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                      {recurrenceSummary}
                    </span>
                  )}
                  {reservation.attendeeCount > 0 && (
                    <span className="mr-attendee-pill">{reservation.attendeeCount} attendees</span>
                  )}
                  {isOnBehalfOf && contactName && (
                    <span className="mr-delegation-pill">On behalf of {contactName}</span>
                  )}
                </div>
                <div className="mr-card-actions">
                  <button
                    className="mr-btn mr-btn-primary"
                    onClick={() => openReviewForReservation(reservation)}
                  >
                    View Details
                  </button>
                </div>
              </div>

              {/* Card Body - Key Info Grid */}
              <div className="mr-card-body">
                {/* When */}
                <div className="mr-info-block">
                  <span className="mr-info-label">When</span>
                  <div className="mr-info-value mr-datetime">
                    {isSeriesMaster && recurrenceRange?.startDate ? (
                      <>
                        <span className="mr-date">
                          {new Date(recurrenceRange.startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {recurrenceRange.endDate ? (
                            <>
                              {' – '}
                              {new Date(recurrenceRange.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </>
                          ) : null}
                        </span>
                        {reservation.startTime && reservation.endTime ? (
                          <span className="mr-time">
                            {new Date(`2000-01-01T${reservation.startTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            {' – '}
                            {new Date(`2000-01-01T${reservation.endTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        ) : null}
                      </>
                    ) : reservation.startDate ? (
                      <>
                        <span className="mr-date">
                          {new Date(reservation.startDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        {reservation.startTime && reservation.endTime ? (
                          <span className="mr-time">
                            {new Date(`2000-01-01T${reservation.startTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            {' – '}
                            {new Date(`2000-01-01T${reservation.endTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="mr-not-set">Not set</span>
                    )}
                  </div>
                </div>

                {/* Where */}
                <div className="mr-info-block">
                  <span className="mr-info-label">Where</span>
                  <div className="mr-info-value mr-rooms">
                    {reservation.requestedRooms && reservation.requestedRooms.length > 0 ? (
                      reservation.requestedRooms.map(roomId => {
                        const roomDetails = getRoomDetails(roomId);
                        return (
                          <span key={roomId} className="mr-room-tag" title={roomDetails.location || ''}>
                            {roomDetails.name}
                          </span>
                        );
                      })
                    ) : (
                      <span className="mr-not-set">None selected</span>
                    )}
                  </div>
                </div>

                {/* Categories */}
                <div className="mr-info-block">
                  <span className="mr-info-label">Categories</span>
                  <div className="mr-info-value mr-categories">
                    {reservation.categories && reservation.categories.length > 0 ? (
                      reservation.categories.map((cat, i) => (
                        <span key={i} className="mr-category-tag">{cat}</span>
                      ))
                    ) : (
                      <span className="mr-not-set">—</span>
                    )}
                  </div>
                </div>

                {/* Submitted/Saved */}
                <div className="mr-info-block">
                  <span className="mr-info-label">{isDraft ? 'Saved' : 'Submitted'}</span>
                  <div className="mr-info-value mr-submitted">
                    <span>{new Date(isDraft
                      ? (reservation.lastDraftSaved || reservation.submittedAt)
                      : reservation.submittedAt
                    ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <span className="mr-submitted-time">{new Date(isDraft
                      ? (reservation.lastDraftSaved || reservation.submittedAt)
                      : reservation.submittedAt
                    ).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                </div>

                {/* Status Info (contextual) */}
                <div className="mr-info-block">
                  <span className="mr-info-label">
                    {isDraft ? 'Age' : (reservation.status === 'rejected' && reservation.reviewNotes) ? 'Reason' : 'Last Modified'}
                  </span>
                  <div className="mr-info-value mr-status-info">
                    {isDraft ? (() => {
                      const label = formatDraftAge(reservation.lastDraftSaved || reservation.createdAt || reservation.submittedAt);
                      if (!label) return <span className="mr-not-set">&mdash;</span>;
                      return <span className="mr-age">{label}</span>;
                    })() : (reservation.status === 'rejected' && reservation.reviewNotes) ? (
                      <span className="mr-rejection" title={reservation.reviewNotes}>{reservation.reviewNotes}</span>
                    ) : (reservation.actionDate || reservation.lastModifiedDateTime) ? (
                      <span className="mr-last-modified">
                        <span>{new Date(reservation.actionDate || reservation.lastModifiedDateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span className="mr-submitted-time">{new Date(reservation.actionDate || reservation.lastModifiedDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                      </span>
                    ) : (
                      <span className="mr-not-set">&mdash;</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Recurrence exceptions — typographic table inside the master
                  card. Only renders when the master has per-occurrence
                  deviations. Regular pattern occurrences are NOT enumerated;
                  only modified, cancelled, and added occurrences appear. */}
              {isSeriesMaster && hasDeviations && (
                <section className="exceptions-section" aria-label="Recurrence exceptions">
                  <header className="exceptions-header">
                    <span className="exceptions-title">Recurrence Exceptions</span>
                    <span className="exceptions-count">{variants.length}</span>
                  </header>
                  <ul className="exceptions-table">
                    {variants.map(v => {
                      const isClickable = v.kind !== 'cancelled';
                      const handleClick = isClickable
                        ? () => {
                            reviewModal.openModal(
                              buildVirtualOccurrence(reservation, v),
                              { editScope: 'thisEvent' }
                            );
                          }
                        : undefined;
                      const labelText = v.kind === 'modified' ? 'Modified' : v.kind === 'cancelled' ? 'Cancelled' : 'Added';
                      return (
                        <li
                          key={`${v.kind}-${v.occurrenceDate}`}
                          className={`exceptions-row ${v.kind}`}
                          role={isClickable ? 'button' : undefined}
                          tabIndex={isClickable ? 0 : undefined}
                          onClick={handleClick}
                          onKeyDown={isClickable ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleClick();
                            }
                          } : undefined}
                        >
                          <span className="exceptions-icon">
                            <ExceptionIcon kind={v.kind} />
                          </span>
                          <span className="exceptions-date">
                            {new Date(v.occurrenceDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </span>
                          <span className="exceptions-kind">{labelText}</span>
                          <span className="exceptions-label" title={v.label}>{v.label}</span>
                          <span className="exceptions-arrow" aria-hidden="true">
                            {isClickable ? '›' : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Description Preview (if exists) */}
              {reservation.eventDescription && (
                <div className="mr-card-description">
                  {reservation.eventDescription}
                </div>
              )}
            </div>
          );
        })}

        {paginatedReservations.length === 0 && !loading && !isSilentRefreshing && (
          <div className="mr-empty-state">
            <div className="mr-empty-icon">
              {hasActiveFilters ? '🔍' : '📁'}
            </div>
            <h3>{hasActiveFilters ? 'No matching reservations' : 'No reservations'}</h3>
            <p>
              {hasActiveFilters
                ? 'Try adjusting your search or filters.'
                : "You don't have any reservation requests yet."}
            </p>
            <EmptyStateRefreshButton
              onClick={handleManualRefresh}
              isRefreshing={isManualRefreshing}
            />
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span className="page-info">Page {page} of {totalPages}</span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Unified ReviewModal experience (shared hook + component) */}
      <EventReviewExperience
        experience={reviewModal}
        title={getModalTitle()}
        modalMode={getModalMode()}
        defaultCalendar={reviewModal.editableData?.calendarOwner || undefined}
        onResubmit={handleResubmit}
        isResubmitting={isResubmitting}
        onRestore={reviewModal.currentItem?.status === 'deleted' ? handleRestore : null}
        isRestoring={isRestoring}
        onSavePendingEdit={reviewModal.handleOwnerEdit}
        savingPendingEdit={reviewModal.isSavingOwnerEdit}
        onSaveRejectedEdit={reviewModal.handleOwnerEdit}
        savingRejectedEdit={reviewModal.isSavingOwnerEdit}
        onWithdrawCancellationRequest={handleWithdrawCancellationRequest}
        isWithdrawingCancellationRequest={isWithdrawingCancellationRequest}
        isWithdrawCancellationConfirming={isWithdrawCancellationConfirming}
        onCancelWithdrawCancellation={cancelWithdrawCancellationConfirmation}
        onNavigateToSeriesEvent={reviewModal.navigateToEvent}
        onConflictRefresh={loadMyReservations}
      />

      {/* Scheduling Conflict Modal (for restore conflicts) */}
      {restoreConflicts && (
        <div className="mr-modal-overlay" onClick={() => setRestoreConflicts(null)}>
          <div className="mr-scheduling-conflict-modal" onClick={e => e.stopPropagation()}>
            <h3>Scheduling Conflict</h3>
            <p>
              Cannot restore &quot;{restoreConflicts.eventTitle}&quot; because
              {' '}{restoreConflicts.conflicts.length} conflicting event{restoreConflicts.conflicts.length > 1 ? 's' : ''} now
              {' '}occupy the same room and time.
            </p>
            <ul className="mr-conflict-list">
              {restoreConflicts.conflicts.map(c => (
                <li key={c.id}>
                  <strong>{c.eventTitle}</strong>
                  <span className="mr-conflict-time">
                    {formatDateTime(c.startDateTime)} &ndash; {formatDateTime(c.endDateTime)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mr-conflict-guidance">
              Please submit a new reservation with different times, or contact an admin to override.
            </p>
            <div className="mr-conflict-actions">
              <button
                className="mr-btn-close"
                onClick={() => setRestoreConflicts(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
