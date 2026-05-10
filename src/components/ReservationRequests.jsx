// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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

// Statuses that contribute to the approval-queue 'all' count (pending + publishedTotal + rejected).
// Must stay in sync with the backend counts endpoint's approval-queue branch.
const APPROVAL_QUEUE_COUNTED_STATUSES = new Set(['pending', 'published', 'rejected']);

/**
 * Apply a per-row update to every approval-queue list cache entry whose
 * matching event id is `eventId`. Uses a queryKey predicate so both tab
 * variants ('needs_attention' and 'all') are patched in one pass — the user
 * could be viewing either when the patch fires.
 */
function patchApprovalQueueLists(queryClient, eventId, updater) {
  queryClient.setQueriesData(
    { queryKey: ['events', 'list'], predicate: (q) => {
      const scope = q.queryKey[2];
      return scope?.view === 'approval-queue';
    }},
    (old) => Array.isArray(old)
      ? old.map(r => String(r._id) === String(eventId) ? updater(r) : r)
      : old
  );
}
import { filterBySearchAndDate, sortReservations } from '../utils/reservationFilterUtils';
import { deleteEvent } from '../utils/eventPayloadBuilder';
import LoadingSpinner from './shared/LoadingSpinner';
import EventReviewExperience from './shared/EventReviewExperience';
import DiscardChangesDialog from './shared/DiscardChangesDialog';
import FreshnessIndicator from './shared/FreshnessIndicator';
import './shared/FilterBar.css';
import './ReservationRequests.css';

export default function ReservationRequests({ graphToken }) {
  const { apiToken } = useAuth();
  const { isConnected } = useSSE();
  const authFetch = useAuthenticatedFetch();
  // Permission check for Approver/Admin role
  const { canApproveReservations, isAdmin, permissionsLoading } = usePermissions();
  const { showSuccess, showWarning, showError } = useNotification();
  const queryClient = useQueryClient();

  // ─── UI-only state ──────────────────────────────────────────────────────
  // Server data state (allReservations, loading, error, lastFetchedAt,
  // isSilentRefreshing, serverCounts, countsLoaded) is derived from the
  // React Query cache below. Active-tab is the single piece of UI state
  // that participates in the queryKey — switching tabs produces a new key,
  // RQ either serves cache or fetches.
  const [activeTab, setActiveTab] = useState('needs_attention');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // Search & date filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');

  // Calendar event creation settings
  const [calendarMode, setCalendarMode] = useState(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
  const [createCalendarEvent, setCreateCalendarEvent] = useState(true);
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [defaultCalendar, setDefaultCalendar] = useState('');
  const [selectedTargetCalendar, setSelectedTargetCalendar] = useState('');

  // Card-level delete state — confirmation flag (loading flag derived from mutation below)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Navigation confirmation state (replaces window.confirm for iframe compatibility)
  const [pendingNavTarget, setPendingNavTarget] = useState(null);

  // ─── Refs ───────────────────────────────────────────────────────────────
  // Token rotation guard (warm→warm transition; cold→warm handled by `enabled`).
  const lastSeenTokenRef = useRef(null);
  // bypassEmptyGuardRef: set true before a refetch that should write through
  // even on an empty result (post-mutation, manual refresh, mount, recovery).
  // Reset inside queryFn after each fetch. Mirrors the legacy `postAction: true`
  // semantics inside the original loadReservations.
  const bypassEmptyGuardRef = useRef(false);

  // Scheduling conflict state managed by reviewModal hook (synchronous reset in openModal)

  // Edit-request review uses the unified EventReviewExperience modal — same
  // path as Calendar and MyReservations. The standalone EditRequestComparison
  // modal that lived here previously has been removed; clicking 'View Details'
  // on a queue card opens reviewModal which handles the edit-request diff
  // through its own existingEditRequest fetch path.

  // Use room context for efficient room name resolution
  const { getRoomName, getRoomDetails, loading: roomsLoading } = useRooms();

  const loadCalendarSettings = async () => {
    try {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/calendar-settings`);

      if (response.ok) {
        const data = await response.json();
        setAvailableCalendars(data.availableCalendars || []);
        setDefaultCalendar(data.defaultCalendar || '');
        setSelectedTargetCalendar(data.defaultCalendar || '');
      }
    } catch (err) {
      logger.error('Error loading calendar settings:', err);
      // Continue without calendar settings - will fall back to hardcoded default
    }
  };

  // ─── Server data: approval-queue list (tab-scoped) and counts ──────────
  // Two queries share the same view scope; the list adds a `tab` discriminator
  // so 'needs_attention' and 'all' get independent cache entries (instant
  // tab-switch after first visit). Counts is one query — the badge values
  // are tab-agnostic.
  //
  // Stale-write rule (mirrors MyReservations §3): a refetch returning 0
  // events while we already had populated data is treated as transient
  // (replica lag / 401-retry race) and the prior cache is kept. The legacy
  // `postAction: true` flag is preserved via `bypassEmptyGuardRef` — set
  // true before mutation-driven, manual, mount, and recovery refetches so
  // they write through unconditionally.

  const listKey = keys.events.list({ view: 'approval-queue', tab: activeTab });
  const countsKey = keys.events.counts({ view: 'approval-queue' });

  const queryEnabled = !!apiToken && canApproveReservations && !permissionsLoading;

  const reservationsQuery = useQuery({
    queryKey: listKey,
    queryFn: async ({ queryKey, signal }) => {
      const scope = queryKey[2] || {};
      const tab = scope.tab;
      const statusParam = tab === 'needs_attention' ? '&status=needs_attention' : '';
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list?view=approval-queue&limit=1000${statusParam}`,
        { signal }
      );
      if (!response.ok) {
        throw new Error('Failed to load room reservation events');
      }
      const data = await response.json();
      const transformed = transformEventsToFlatStructure(data.events || []);

      // Stale-write guard: bypass when explicitly flagged (post-mutation,
      // manual refresh, mount, recovery). Otherwise, never blank a populated
      // list on a polling/bus empty result.
      if (transformed.length === 0 && !bypassEmptyGuardRef.current) {
        const previous = queryClient.getQueryData(queryKey);
        if (Array.isArray(previous) && previous.length > 0) {
          logger.warn('ReservationRequests: silent refetch returned 0 events; keeping previous cached data');
          return previous;
        }
      }
      bypassEmptyGuardRef.current = false;
      return transformed;
    },
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: isConnected ? 5 * 60 * 1000 : 30 * 1000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  const countsQuery = useQuery({
    queryKey: countsKey,
    queryFn: async ({ signal }) => {
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list/counts?view=approval-queue`,
        { signal }
      );
      if (!response.ok) throw new Error('Failed to load approval-queue counts');
      const data = await response.json();
      // Prefer the authoritative `needsAttention` field; fall back to the
      // legacy sum for staged-rollout compatibility.
      return {
        needs_attention: data.needsAttention ?? ((data.pending || 0) + (data.published_edit || 0) + (data.published_cancellation || 0)),
        all: data.all || 0,
      };
    },
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: isConnected ? 5 * 60 * 1000 : 30 * 1000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  // Derived bindings — preserve the names the rest of the component expects.
  const allReservations = reservationsQuery.data ?? [];
  // First-load gate: `isPending` covers both `pending && idle` (one-tick window
  // when `enabled` flips true) and `pending && fetching`. Prevents the
  // empty-state from rendering before the fetch starts. See CLAUDE.md
  // "React Query loading primitives" for the convention.
  const loading = reservationsQuery.isPending;
  const error = reservationsQuery.error?.message || '';
  const lastFetchedAt = Math.max(
    reservationsQuery.dataUpdatedAt || 0,
    countsQuery.dataUpdatedAt || 0
  ) || null;
  const isSilentRefreshing =
    (reservationsQuery.isFetching && !reservationsQuery.isPending) ||
    (countsQuery.isFetching && !countsQuery.isPending);
  const serverCounts = countsQuery.data ?? { needs_attention: 0, all: 0 };
  // countsLoaded preserves the legacy gate semantic: flips true after the first
  // load attempt (success OR failure). React Query exposes `isPending` for the
  // pre-first-fetch state and resolves to false on either outcome.
  const countsLoaded = !countsQuery.isPending;

  // Token rotation guard: refetch on warm→warm token transition (401-retry
  // path rotates A→B). The cold-warmup transition (null→A) is handled by RQ's
  // `enabled` flip and does NOT need this effect.
  useEffect(() => {
    if (!apiToken) return;
    if (lastSeenTokenRef.current && lastSeenTokenRef.current !== apiToken) {
      bypassEmptyGuardRef.current = true;
      queryClient.refetchQueries({ queryKey: keys.events.list({ view: 'approval-queue' }) });
      queryClient.refetchQueries({ queryKey: keys.events.counts({ view: 'approval-queue' }) });
    }
    lastSeenTokenRef.current = apiToken;
  }, [apiToken, queryClient]);

  // Calendar settings — one-shot fetch when token first arrives (kept outside
  // RQ; static configuration data, not on the user's hot path).
  const calendarSettingsLoadedRef = useRef(false);
  useEffect(() => {
    if (apiToken && !calendarSettingsLoadedRef.current) {
      calendarSettingsLoadedRef.current = true;
      loadCalendarSettings();
    }
  }, [apiToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Backward-compat shims: external code (incl. onConflictRefresh prop and
  // the experience hook's onSuccess callback) holds references to
  // loadReservations/loadCounts. Implement as thin cache wrappers so call
  // sites keep working without per-site changes during the migration.
  const loadReservations = useCallback(async ({ silent = false, postAction = false, tab } = {}) => {
    // postAction or non-silent calls write through unconditionally. The legacy
    // postAction flag exists because a successful approval/rejection can
    // legitimately empty `needs_attention` — the stale-write guard would
    // otherwise mask the post-mutation empty truth.
    if (postAction || !silent) {
      bypassEmptyGuardRef.current = true;
    }
    const queryKey = tab !== undefined
      ? keys.events.list({ view: 'approval-queue', tab })
      : keys.events.list({ view: 'approval-queue' }); // prefix-match all tabs
    if (silent) {
      await queryClient.invalidateQueries({ queryKey });
    } else {
      await queryClient.refetchQueries({ queryKey });
    }
  }, [queryClient]);

  const loadCounts = useCallback(async () => {
    await queryClient.refetchQueries({
      queryKey: keys.events.counts({ view: 'approval-queue' })
    });
  }, [queryClient]);

  // Refresh callback for the experience hook
  const handleRefresh = useCallback(() => {
    loadReservations();
    loadCounts();
    dispatchRefresh('approval-queue', 'navigation-counts');
  }, [loadReservations, loadCounts]);

  // --- Unified review modal experience (replaces useReviewModal + satellite state) ---
  const reviewModal = useEventReviewExperience({
    apiToken,
    graphToken,
    selectedCalendarId: selectedTargetCalendar || defaultCalendar,
    authFetch,
    onRefresh: handleRefresh,
    onSuccess: (result) => {
      loadReservations({ silent: true, postAction: true });
      loadCounts();
      if (result?.recurringConflicts?.conflictingOccurrences > 0) {
        const rc = result.recurringConflicts;
        showError(`Event published. ${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrences have room conflicts.`);
      } else if (result?.editRequestApproved) {
        showSuccess('Edit request approved and changes applied');
        // Local cache patch: prevent stale-reopen showing old pending badge
        // before the post-mutation refetch completes. Patches every cached
        // approval-queue list entry (both tabs) under the same predicate.
        if (result.eventId) {
          patchApprovalQueueLists(queryClient, result.eventId, r => ({
            ...r,
            pendingEditRequest: { ...(r.pendingEditRequest || {}), status: 'approved' },
          }));
        }
      } else if (result?.editRequestRejected) {
        showSuccess('Edit request rejected');
        if (result.eventId) {
          patchApprovalQueueLists(queryClient, result.eventId, r => ({
            ...r,
            pendingEditRequest: { ...(r.pendingEditRequest || {}), status: 'rejected' },
          }));
        }
      } else if (result?.cancellationApproved) {
        showSuccess('Cancellation approved — event deleted');
      } else if (result?.cancellationRejected) {
        showSuccess('Cancellation request rejected');
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
      }
    },
    onError: (error) => { showError(error, { context: 'ReservationRequests' }); }
  });

  // Load calendar settings + reservations + counts on mount.
  // Guard: only run once when apiToken first becomes available. Token refresh calls
  // setApiToken with a new JWT string every 45 min — without this guard, each refresh
  // would trigger a full non-silent reload that unconditionally writes its result (even 0),
  // causing the approval queue to flash empty. Subsequent refreshes come from SSE/polling.
  // Mount + token-rotation behavior is now handled by:
  //   • RQ's `enabled` flag (cold MSAL warm-up: enabled flips false→true and fires)
  //   • `lastSeenTokenRef` effect above (warm→warm token rotation: explicit refetch)
  //   • `calendarSettingsLoadedRef` effect above (one-shot calendar settings)
  // The legacy mount useEffect that bundled all three is no longer needed.
  //
  // Polling is now handled by `refetchInterval` inside both useQuery calls
  // (30s/5min based on isConnected). The legacy `silentRefresh` + `usePolling`
  // pair is no longer needed.

  // Listen for refresh events from other views. The bus delivers SSE-derived
  // payloads; for state transitions with a clean oldStatus → newStatus diff,
  // we delta-patch the counts cache directly via setQueryData (no network
  // round-trip) and invalidate the list. For sub-status changes (edit /
  // cancellation requests where oldStatus === newStatus) the delta can't
  // capture needs_attention shifts, so we fall back to a full counts refetch.
  const handleApprovalQueueBus = useCallback((detail) => {
    const payload = detail?.payload;
    const { oldStatus, newStatus } = payload || {};

    // No delta data, or sub-status change (main status unchanged) → full refetch.
    if (!payload || (oldStatus == null && newStatus == null) || oldStatus === newStatus) {
      if (!reviewModal.isOpen) {
        queryClient.invalidateQueries({ queryKey: keys.events.list({ view: 'approval-queue' }) });
      }
      queryClient.invalidateQueries({ queryKey: keys.events.counts({ view: 'approval-queue' }) });
      return;
    }

    // Delta-patch counts locally — preserves cross-tab counter consistency
    // (approving a pending event decrements `needs_attention`; rejecting a
    // pending event with a transition to 'rejected' adjusts `all` accordingly).
    queryClient.setQueryData(keys.events.counts({ view: 'approval-queue' }), prev => {
      if (!prev) return prev;
      let { needs_attention, all } = prev;
      if (oldStatus === 'pending') needs_attention--;
      if (newStatus === 'pending') needs_attention++;
      if (APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && !APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all--;
      if (!APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all++;
      return { needs_attention: Math.max(0, needs_attention), all: Math.max(0, all) };
    });

    // Still refresh the event list (counts were patched above without a fetch).
    if (!reviewModal.isOpen) {
      queryClient.invalidateQueries({ queryKey: keys.events.list({ view: 'approval-queue' }) });
    }
  }, [queryClient, reviewModal.isOpen]);
  useDataRefreshBus('approval-queue', handleApprovalQueueBus, !!apiToken);

  // Manual refresh handler for FreshnessIndicator
  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([loadReservations(), loadCounts()]);
    } finally {
      setIsManualRefreshing(false);
    }
  }, [loadReservations, loadCounts]);

  // Stage 1: Apply search + date filters against all reservations
  const searchFiltered = useMemo(
    () => filterBySearchAndDate(allReservations, { searchTerm, dateFrom, dateTo }),
    [allReservations, searchTerm, dateFrom, dateTo]
  );

  // Stage 2: Apply tab status filter + status dropdown filter
  const filteredReservations = useMemo(() => {
    let results = searchFiltered;

    if (activeTab === 'needs_attention') {
      results = results.filter(r =>
        r.status === 'pending' ||
        r.status === 'room-reservation-request' ||
        (r.status === 'published' && r.pendingEditRequest?.status === 'pending') ||
        (r.status === 'published' && r.pendingCancellationRequest?.status === 'pending')
      );
    }

    if (statusFilter) {
      results = results.filter(r => {
        switch (statusFilter) {
          case 'pending':
            return r.status === 'pending' || r.status === 'room-reservation-request';
          case 'published':
            return r.status === 'published' && r.pendingEditRequest?.status !== 'pending' && r.pendingCancellationRequest?.status !== 'pending';
          case 'published_edit':
            return r.status === 'published' && r.pendingEditRequest?.status === 'pending';
          case 'published_cancellation':
            return r.status === 'published' && r.pendingCancellationRequest?.status === 'pending';
          case 'rejected':
            return r.status === 'rejected';
          default:
            return true;
        }
      });
    }

    return results;
  }, [searchFiltered, activeTab, statusFilter]);

  // Tab badge counts come from the server (via loadCounts).
  // This avoids computing cross-tab counts from a tab-scoped dataset.

  // Sort filtered results
  const sortedReservations = useMemo(
    () => sortReservations(filteredReservations, sortBy),
    [filteredReservations, sortBy]
  );

  // hasActiveFilters: used to show the "clear" button area (includes sort, which the user can reset)
  const hasActiveFilters = searchTerm || dateFrom || dateTo || statusFilter || sortBy !== 'date_desc';
  // hasActiveSearchFilters: used for empty-state messaging (sort alone can't filter out results)
  const hasActiveSearchFilters = !!(searchTerm || dateFrom || dateTo || statusFilter);

  // One-shot recovery refetch when counts disagrees with the list. Closes the
  // divergence window without waiting 30s for the next silent poll. Bounded to
  // one refetch per apiToken/activeTab pair so a persistently wrong counts
  // response can't spin us into a loop.
  const recoveryAttemptedRef = useRef(false);
  useEffect(() => { recoveryAttemptedRef.current = false; }, [apiToken, activeTab]);
  useEffect(() => {
    // Permission gate before the cross-check: skip entirely if permissions
    // haven't resolved or the user isn't an approver, otherwise a slow
    // usePermissions() resolve could fire a recovery fetch into a backend
    // that will return 403.
    if (permissionsLoading || !canApproveReservations) return;
    if (!apiToken) return;
    if (loading || isSilentRefreshing) return;
    if (hasActiveSearchFilters) return;    // client filters can legitimately empty the list
    if (!countsLoaded) return;             // no cross-check available yet
    const expected = activeTab === 'needs_attention' ? serverCounts.needs_attention : serverCounts.all;
    if (expected > 0 && allReservations.length === 0 && !recoveryAttemptedRef.current) {
      recoveryAttemptedRef.current = true;
      loadReservations(); // non-silent — updates `loading` and unconditionally writes through
    }
  }, [apiToken, loading, isSilentRefreshing, hasActiveSearchFilters, countsLoaded,
      serverCounts, activeTab, allReservations.length, loadReservations,
      permissionsLoading, canApproveReservations]);

  // Client-side pagination
  const totalPages = Math.ceil(sortedReservations.length / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;
  const paginatedReservations = sortedReservations.slice(startIndex, startIndex + PAGE_SIZE);

  // Handle tab changes. With React Query, the tab is part of the queryKey,
  // so changing `activeTab` triggers an automatic fetch (or cache hit if the
  // tab was previously visited within staleTime). No explicit refetch call
  // is needed — the state change drives the data layer.
  const handleTabChange = useCallback((newTab) => {
    setActiveTab(newTab);
    setPage(1);
    // Clear status filters that don't apply to the "Needs Attention" tab
    if (newTab === 'needs_attention' && (statusFilter === 'published' || statusFilter === 'rejected')) {
      setStatusFilter('');
    }
  }, [statusFilter]);

  // Handle page changes - no API call, pagination is client-side
  const handlePageChange = useCallback((newPage) => {
    setPage(newPage);
  }, []);

  // Reset page when any filter/sort changes
  useEffect(() => {
    setPage(1);
  }, [searchTerm, dateFrom, dateTo, statusFilter, sortBy]);

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('');
    setSortBy('date_desc');
  }, []);


  // Edit-request approve/reject flows live in useReviewModal (the unified
  // hook used here, by Calendar, and by MyReservations). Approver clicks
  // 'View Details' on a card → reviewModal.openModal → click 'View Edit
  // Request' inside the modal → click Approve/Reject. Same flow as Calendar
  // entry, single source of truth.

  // Handle locked event click from SchedulingAssistant
  const handleLockedEventClick = async (reservationId) => {
    logger.debug('[ReservationRequests] Locked event clicked:', reservationId);

    // Find the reservation in our list
    const targetReservation = allReservations.find(r => r._id === reservationId);

    if (!targetReservation) {
      logger.error('[ReservationRequests] Could not find reservation with ID:', reservationId);
      showError('Could not find the selected reservation. It may have been deleted.');
      return;
    }

    // Check if there are unsaved changes — show inline dialog instead of window.confirm
    // (window.confirm is blocked in Teams/Outlook iframe contexts)
    if (reviewModal.hasChanges) {
      setPendingNavTarget(targetReservation);
      return;
    }

    // Close current modal and open the new one
    logger.debug('[ReservationRequests] Navigating to reservation:', targetReservation.eventTitle);
    await reviewModal.closeModal(true);

    // Small delay to ensure cleanup completes
    setTimeout(() => {
      reviewModal.openModal(targetReservation);
    }, 100);
  };

  // Approval is always a series-level action; pending masters have no published
  // children to override, so we open recurring series directly with editScope:
  // 'allEvents' and skip the scope-choice dialog used in other entry points.
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
      logger.error('Error opening review modal from ReservationRequests:', err);
      showError(err, {
        context: 'ReservationRequests.openReviewForReservation',
        userMessage: 'Failed to open review modal',
      });
    }
  }, [isRecurringSeriesMaster, reviewModal, showError]);

  // Card-level delete mutation (separate from modal delete via the experience hook).
  // Optimistically marks the row deleted across both tab variants, rolls back
  // on error, invalidates list + counts on settled. Dual-publishes via
  // dispatchRefresh so non-migrated views still observe the change.
  const deleteMutation = useMutation({
    mutationFn: async ({ reservation }) => {
      const hasGraphData = reservation.calendarId || reservation.graphData?.id;
      await deleteEvent(reservation._id, {
        apiToken,
        version: reservation._version,
        graphToken: hasGraphData ? graphToken : undefined,
        calendarId: reservation.calendarId,
      });
      return reservation;
    },
    onMutate: async ({ reservation }) => {
      const listPrefix = { queryKey: ['events', 'list'], predicate: (q) => q.queryKey[2]?.view === 'approval-queue' };
      await queryClient.cancelQueries(listPrefix);
      // Snapshot every approval-queue list cache entry so we can roll back.
      const previousEntries = queryClient.getQueriesData(listPrefix);
      patchApprovalQueueLists(queryClient, reservation._id, r => ({
        ...r, status: 'deleted', isDeleted: true
      }));
      return { previousEntries };
    },
    onError: (err, _vars, ctx) => {
      // Restore every snapshotted cache entry.
      if (ctx?.previousEntries) {
        for (const [key, value] of ctx.previousEntries) {
          queryClient.setQueryData(key, value);
        }
      }
      logger.error('Error deleting reservation:', err);
      showError(err, { context: 'ReservationRequests.handleDelete', userMessage: 'Failed to delete reservation' });
    },
    onSuccess: () => {
      dispatchRefresh('reservation-requests', 'navigation-counts');
    },
    onSettled: () => {
      bypassEmptyGuardRef.current = true;
      queryClient.invalidateQueries({ queryKey: keys.events.list({ view: 'approval-queue' }) });
      queryClient.invalidateQueries({ queryKey: keys.events.counts({ view: 'approval-queue' }) });
    },
  });

  const handleDeleteClick = (reservation) => {
    if (confirmDeleteId === reservation._id) {
      setConfirmDeleteId(null);
      deleteMutation.mutate({ reservation });
    } else {
      setConfirmDeleteId(reservation._id);
    }
  };

  // Loading flag for delete-in-progress — derived from the mutation's variables
  // so consumers can identify which row is currently being deleted.
  const deletingId = deleteMutation.isPending ? deleteMutation.variables?.reservation?._id : null;

  // Show loading while permissions are being determined
  if (permissionsLoading) {
    return <LoadingSpinner variant="card" text="Loading..." />;
  }

  // Access control - only Approvers and Admins can view this page
  if (!canApproveReservations) {
    return (
      <div className="reservation-requests">
        <div className="access-denied">
          <h2>Access Restricted</h2>
          <p>You do not have permission to view and approve reservation requests.</p>
        </div>
      </div>
    );
  }

  // Hold the spinner until BOTH the list and counts have landed. The empty-state
  // render gate (below) requires counts agreement, so if we cleared this spinner
  // on `!loading` alone we'd briefly render a blank body while countsLoaded is
  // still false (list resolved, counts in flight).
  if ((loading || !countsLoaded) && allReservations.length === 0) {
    return <LoadingSpinner variant="card" text="Loading..." />;
  }

  return (
    <div className="reservation-requests">
      {/* Page Header */}
      <div className="rr-page-header">
        <div className="rr-header-content">
          <h1>Approval Queue</h1>
          <p className="rr-header-subtitle">
            Review and manage reservation requests
          </p>
        </div>
        <FreshnessIndicator
          lastFetchedAt={lastFetchedAt}
          onRefresh={handleManualRefresh}
          isRefreshing={isManualRefreshing}
        />
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tabs-container">
        <div className="event-type-tabs">
          <button
            className={`event-type-tab needs-attention-tab ${activeTab === 'needs_attention' ? 'active' : ''}`}
            onClick={() => handleTabChange('needs_attention')}
          >
            Needs Attention
            <span className="count">({serverCounts.needs_attention})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All Requests
            <span className="count">({serverCounts.all})</span>
          </button>
        </div>
      </div>

      {/* Search & Date Filters */}
      <div className="rr-filter-bar">
        {/* Search — unchanged */}
        <div className="rr-search-container">
          <svg className="rr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="rr-search-input"
            placeholder="Search by title, requester, room, or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="rr-search-clear" onClick={() => setSearchTerm('')} title="Clear search">
              &times;
            </button>
          )}
        </div>

        {/* Secondary filters row */}
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
              <option value="pending">Pending</option>
              {activeTab !== 'needs_attention' && <option value="published">Published</option>}
              <option value="published_edit">Edit Requested</option>
              <option value="published_cancellation">Cancellation Requested</option>
              {activeTab !== 'needs_attention' && <option value="rejected">Rejected</option>}
            </select>
          </div>
          <div className={`rr-sort-filter${sortBy !== 'date_desc' ? ' active' : ''}`}>
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
      <div className="rr-reservations-list">
        {paginatedReservations.map(reservation => {
          const requesterName = reservation.roomReservationData?.requestedBy?.name || reservation.requesterName;
          const isOnBehalfOf = reservation.isOnBehalfOf;
          const contactName = reservation.contactName;

          return (
            <div key={reservation._id} className="rr-card">
              {/* Card Header - Event Title + Actions */}
              <div className="rr-card-header">
                <div className="rr-card-title-row">
                  <h3 className="rr-card-title">{reservation.isHold && !reservation.eventTitle?.startsWith('[Hold]') ? `[Hold] ${reservation.eventTitle}` : reservation.eventTitle}</h3>
                  {(() => {
                    const badge = getStatusBadgeInfo(reservation);
                    return <span className={`rr-status-badge ${badge.className}`}>{badge.label}</span>;
                  })()}
                  {reservation.attendeeCount > 0 && (
                    <span className="rr-attendee-pill">{reservation.attendeeCount} attendees</span>
                  )}
                </div>
                <div className="rr-card-actions">
                  <button
                    className="rr-btn rr-btn-primary"
                    onClick={() => openReviewForReservation(reservation)}
                  >
                    View Details
                  </button>
                </div>
              </div>

              {/* Card Body - Key Info Grid */}
              <div className="rr-card-body">
                {/* When */}
                <div className="rr-info-block">
                  <span className="rr-info-label">When</span>
                  <div className="rr-info-value rr-datetime">
                    <span className="rr-date">{new Date(reservation.startDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    {reservation.startTime && reservation.endTime ? (
                      <span className="rr-time">
                        {new Date(`2000-01-01T${reservation.startTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {' – '}
                        {new Date(`2000-01-01T${reservation.endTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Where */}
                <div className="rr-info-block">
                  <span className="rr-info-label">Where</span>
                  <div className="rr-info-value rr-rooms">
                    {reservation.requestedRooms.map(roomId => {
                      const roomDetails = getRoomDetails(roomId);
                      return (
                        <span key={roomId} className="rr-room-tag" title={roomDetails.location || ''}>
                          {roomDetails.name}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Categories */}
                <div className="rr-info-block">
                  <span className="rr-info-label">Categories</span>
                  <div className="rr-info-value rr-categories">
                    {reservation.categories && reservation.categories.length > 0 ? (
                      reservation.categories.map((cat, i) => (
                        <span key={i} className="rr-category-tag">{cat}</span>
                      ))
                    ) : (
                      <span className="rr-not-set">—</span>
                    )}
                  </div>
                </div>

                {/* Requested By */}
                <div className="rr-info-block">
                  <span className="rr-info-label">Requested By</span>
                  <div className="rr-info-value rr-requester">
                    <span className="rr-requester-name">{requesterName}</span>
                    {isOnBehalfOf && contactName && (
                      <span className="rr-on-behalf">for {contactName}</span>
                    )}
                  </div>
                </div>

                {/* Submitted */}
                <div className="rr-info-block">
                  <span className="rr-info-label">Submitted</span>
                  <div className="rr-info-value rr-submitted">
                    <span>{new Date(reservation.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <span className="rr-submitted-time">{new Date(reservation.submittedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                </div>

                {/* Reason (rejected only) */}
                {reservation.status === 'rejected' && reservation.reviewNotes && (
                  <div className="rr-info-block">
                    <span className="rr-info-label">Reason</span>
                    <div className="rr-info-value rr-status-info">
                      <span className="rr-rejection" title={reservation.reviewNotes}>{reservation.reviewNotes}</span>
                    </div>
                  </div>
                )}

                {/* Cancellation reason (pending cancellation only) */}
                {reservation.pendingCancellationRequest?.status === 'pending' && (
                  <div className="rr-info-block">
                    <span className="rr-info-label">Cancellation Reason</span>
                    <div className="rr-info-value rr-status-info">
                      <span className="rr-rejection" title={reservation.pendingCancellationRequest.reason}>
                        {reservation.pendingCancellationRequest.reason}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Description Preview (if exists) */}
              {reservation.eventDescription && (
                <div className="rr-card-description">
                  {reservation.eventDescription}
                </div>
              )}
            </div>
          );
        })}

        {/*
          Empty-state gate requires counts to corroborate emptiness for the active
          tab. Without this cross-check the Approval Queue rendered "All caught up!"
          while the nav badge showed N>0 — a login-time race where the list query
          transiently returned [] but counts reported the real count. See RC-6.
          hasActiveSearchFilters bypasses the cross-check because counts doesn't
          know about client-side search/date filters.
        */}
        {paginatedReservations.length === 0 && !loading && !isSilentRefreshing && (
          hasActiveSearchFilters ||
          (activeTab === 'needs_attention'
            ? serverCounts.needs_attention === 0
            : serverCounts.all === 0)
        ) && (
          <div className="rr-empty-state">
            <div className="rr-empty-icon">
              {hasActiveSearchFilters ? '🔍' : activeTab === 'needs_attention' ? '✓' : '📁'}
            </div>
            <h3>{hasActiveSearchFilters ? 'No matching requests' : activeTab === 'needs_attention' ? 'All caught up!' : 'No requests'}</h3>
            <p>
              {hasActiveSearchFilters
                ? 'Try adjusting your search or date filters.'
                : activeTab === 'needs_attention'
                ? 'No pending requests or edit requests to review.'
                : 'No reservation requests found.'}
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 1 || loading}
            onClick={() => handlePageChange(page - 1)}
          >
            Previous
          </button>
          <span className="page-info">
            Page {page} of {totalPages}
            {filteredReservations.length > 0 && ` (${filteredReservations.length} total)`}
          </span>
          <button
            disabled={page === totalPages || loading}
            onClick={() => handlePageChange(page + 1)}
          >
            Next
          </button>
        </div>
      )}


      {/* Unified ReviewModal experience (shared hook + component) */}
      <EventReviewExperience
        experience={reviewModal}
        title={reviewModal.editableData?.eventTitle || 'Reservation Request'}
        graphToken={graphToken}
        onLockedEventClick={handleLockedEventClick}
        availableCalendars={availableCalendars}
        defaultCalendar={defaultCalendar}
        selectedTargetCalendar={selectedTargetCalendar}
        onTargetCalendarChange={setSelectedTargetCalendar}
        createCalendarEvent={createCalendarEvent}
        onCreateCalendarEventChange={setCreateCalendarEvent}
        onNavigateToSeriesEvent={reviewModal.navigateToEvent}
        onConflictRefresh={loadReservations}
      />

      {/* Navigation discard dialog (replaces window.confirm for iframe compatibility) */}
      <DiscardChangesDialog
        isOpen={!!pendingNavTarget}
        onDiscard={async () => {
          const target = pendingNavTarget;
          setPendingNavTarget(null);
          await reviewModal.closeModal(true);
          setTimeout(() => reviewModal.openModal(target), 100);
        }}
        onKeepEditing={() => setPendingNavTarget(null)}
      />
    </div>
  );
}
