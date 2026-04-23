// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import DatePickerInput from './DatePickerInput';
import { useRooms } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch';
import { useEventReviewExperience } from '../hooks/useEventReviewExperience';
import { usePolling } from '../hooks/usePolling';
import { useSSE } from '../context/SSEContext';
import { dispatchRefresh, useDataRefreshBus } from '../hooks/useDataRefreshBus';
import { transformEventsToFlatStructure } from '../utils/eventTransformers';
import { getStatusBadgeInfo } from '../utils/statusUtils';

// Statuses that contribute to the approval-queue 'all' count (pending + publishedTotal + rejected).
// Must stay in sync with the backend counts endpoint's approval-queue branch.
const APPROVAL_QUEUE_COUNTED_STATUSES = new Set(['pending', 'published', 'rejected']);
import { filterBySearchAndDate, sortReservations } from '../utils/reservationFilterUtils';
import { deleteEvent } from '../utils/eventPayloadBuilder';
import LoadingSpinner from './shared/LoadingSpinner';
import EditRequestComparison from './EditRequestComparison';
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
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('needs_attention');
  // Ref always holds the current activeTab so polling/SSE closures read the
  // latest value even when they captured an old loadReservations closure.
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab; // synchronous render-time assignment — safe to read in async callbacks
  // Tracks the current in-flight AbortController so a new load can cancel the previous one.
  const abortControllerRef = useRef(null);
  // Tracks whether the in-flight request was started as a silent refresh. A silent
  // refresh (SSE/polling/bus) must NOT abort a live non-silent (UI) load — otherwise
  // the initial approval-queue fetch gets cancelled and the list renders empty while
  // the counts call (which is independent) succeeds, producing a count-vs-empty-list
  // divergence on first mount.
  const currentRequestIsSilentRef = useRef(false);
  const lastTokenRef = useRef(null); // Prevents re-running initial load on 45-min token refresh (matches useServerEvents pattern)
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  // Tracks in-flight silent polling fetches so the empty state doesn't flash
  // if the server momentarily returns an empty result during a background refresh.
  const [isSilentRefreshing, setIsSilentRefreshing] = useState(false);

  // Search & date filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [serverCounts, setServerCounts] = useState({ needs_attention: 0, all: 0 });

  // Calendar event creation settings
  const [calendarMode, setCalendarMode] = useState(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
  const [createCalendarEvent, setCreateCalendarEvent] = useState(true);
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [defaultCalendar, setDefaultCalendar] = useState('');
  const [selectedTargetCalendar, setSelectedTargetCalendar] = useState('');


  // Card-level delete state (separate from modal delete)
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Navigation confirmation state (replaces window.confirm for iframe compatibility)
  const [pendingNavTarget, setPendingNavTarget] = useState(null);

  // Scheduling conflict state managed by reviewModal hook (synchronous reset in openModal)

  // Edit request state (card-level EditRequestComparison modal)
  const [editRequests, setEditRequests] = useState([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
  const [selectedEditRequest, setSelectedEditRequest] = useState(null);
  const [showEditRequestModal, setShowEditRequestModal] = useState(false);
  const [approvingEditRequest, setApprovingEditRequest] = useState(false);
  const [rejectingEditRequest, setRejectingEditRequest] = useState(false);
  const [editRequestRejectionReason, setEditRequestRejectionReason] = useState('');

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

  const loadReservations = useCallback(async ({ silent = false, tab, postAction = false } = {}) => {
    // A silent refresh (SSE/polling/bus) must NOT interrupt a live non-silent
    // UI load. If the current in-flight request is non-silent (e.g. the initial
    // mount fetch), a silent refresh should no-op and let the UI load complete.
    // Without this guard, a silent refresh arriving during the initial load
    // aborts it — the catch block silently swallows AbortError, loading clears,
    // and allReservations stays [] even though counts succeeded independently.
    if (silent && abortControllerRef.current && !currentRequestIsSilentRef.current) {
      return;
    }
    // Cancel any previous in-flight request. A new AbortController is created
    // for each call so the signal is unique per request.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    currentRequestIsSilentRef.current = silent;

    try {
      if (!silent) {
        setLoading(true);
        setError('');
      } else {
        setIsSilentRefreshing(true);
      }

      // Tab-scoped query: 'needs_attention' fetches only actionable events,
      // 'all' fetches every status. Avoids loading hundreds of published events
      // when only pending items are needed.
      // Uses activeTabRef (not the closure value) so polling/SSE callers that
      // hold a stale loadReservations reference always send the correct tab.
      const effectiveTab = tab ?? activeTabRef.current;
      const statusParam = effectiveTab === 'needs_attention' ? '&status=needs_attention' : '';
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list?view=approval-queue&limit=1000${statusParam}`,
        { signal: controller.signal }
      );

      if (!response.ok) {
        if (silent) {
          logger.warn(`Silent refresh failed with status ${response.status}`);
          return;
        }
        throw new Error('Failed to load room reservation events');
      }

      const data = await response.json();

      // Transform events using shared utility (single source of truth)
      const transformedEvents = transformEventsToFlatStructure(data.events || []);

      logger.info('Loaded room reservation events:', {
        count: transformedEvents.length
      });

      // Write rules:
      //   non-silent        → always writes (tab switch, manual refresh, mount)
      //   silent+postAction → always writes (post-action refresh must reflect true state)
      //   silent+background → only writes if non-empty (prevents stale-0 from polling/SSE flash)
      if (!silent || postAction || transformedEvents.length > 0) {
        setAllReservations(transformedEvents);
      }
      setLastFetchedAt(Date.now());
      // Silent success after a prior failure: clear stale banner so the UI recovers.
      if (silent) setError('');
    } catch (err) {
      if (err.name === 'AbortError') return; // Request superseded by a newer one — not an error
      logger.error('Error loading reservations:', err);
      if (!silent) {
        setError('Failed to load reservation requests');
      }
    } finally {
      // Only the current (non-aborted) controller clears the loading flag.
      // A superseded request must not clobber the live request's loading state.
      if (!controller.signal.aborted) {
        if (!silent) {
          setLoading(false);
        } else {
          setIsSilentRefreshing(false);
        }
      }
      // Only reset the silence tracker when the CURRENT (still-live) controller
      // completes. A superseded request must not reset the flag for the live one.
      if (abortControllerRef.current === controller) {
        currentRequestIsSilentRef.current = false;
      }
    }
  }, [authFetch]); // activeTab deliberately excluded — read via activeTabRef to prevent stale-closure bugs

  // Fetch tab badge counts from the server (lightweight aggregation)
  const loadCounts = useCallback(async () => {
    try {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/events/list/counts?view=approval-queue`);
      if (response.ok) {
        const data = await response.json();
        // Prefer the authoritative `needsAttention` field from the backend, which
        // mirrors the list endpoint's needsAttentionFilter as a single atomic count
        // (no double-count for events with both pending edit AND pending cancel).
        // Fallback to the legacy sum preserves behavior during a staged rollout where
        // the frontend deploys before the backend.
        setServerCounts({
          needs_attention: data.needsAttention ?? ((data.pending || 0) + (data.published_edit || 0) + (data.published_cancellation || 0)),
          all: data.all || 0,
        });
      }
    } catch (err) {
      logger.error('Error loading approval queue counts:', err);
    }
  }, [authFetch]);

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
        // Local patch: prevent stale-reopen showing old pending badge before loadReservations completes
        if (result.eventId) {
          setAllReservations(prev => prev.map(r =>
            String(r._id) === String(result.eventId)
              ? { ...r, pendingEditRequest: { ...(r.pendingEditRequest || {}), status: 'approved' } }
              : r
          ));
        }
      } else if (result?.editRequestRejected) {
        showSuccess('Edit request rejected');
        if (result.eventId) {
          setAllReservations(prev => prev.map(r =>
            String(r._id) === String(result.eventId)
              ? { ...r, pendingEditRequest: { ...(r.pendingEditRequest || {}), status: 'rejected' } }
              : r
          ));
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
  useEffect(() => {
    if (apiToken && apiToken !== lastTokenRef.current) {
      lastTokenRef.current = apiToken;
      loadCalendarSettings();
      loadReservations();
      loadCounts();
    }
  }, [apiToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new reservations every 5 min (silent — no loading spinner)
  // Don't refresh while the review modal is open to avoid clobbering in-flight edits
  const silentRefresh = useCallback(() => {
    if (reviewModal.isOpen) return;
    loadReservations({ silent: true });
    loadCounts();
  }, [loadReservations, loadCounts, reviewModal.isOpen]);
  // Tighten poll cadence to 30s while SSE is unavailable so staleness is bounded
  // to tens of seconds; relax to the 5-min sanity cadence while SSE is live.
  usePolling(silentRefresh, isConnected ? 300_000 : 30_000, !!apiToken);

  // Listen for refresh events from other views.
  // Delta-patch counts from SSE payload when a clear main-status transition is available;
  // fall back to full refetch for sub-status changes (edit/cancellation requests) where
  // oldStatus === newStatus and the delta can't capture needs_attention shifts.
  const handleApprovalQueueBus = useCallback((detail) => {
    const payload = detail?.payload;
    const { oldStatus, newStatus } = payload || {};

    // No delta data, or sub-status change (main status unchanged) → full refetch
    if (!payload || (oldStatus == null && newStatus == null) || oldStatus === newStatus) {
      silentRefresh();
      return;
    }

    // Delta patch counts locally (mirrors Navigation.jsx pattern)
    setServerCounts(prev => {
      let { needs_attention, all } = prev;
      if (oldStatus === 'pending') needs_attention--;
      if (newStatus === 'pending') needs_attention++;
      if (APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && !APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all--;
      if (!APPROVAL_QUEUE_COUNTED_STATUSES.has(oldStatus) && APPROVAL_QUEUE_COUNTED_STATUSES.has(newStatus)) all++;
      return { needs_attention: Math.max(0, needs_attention), all: Math.max(0, all) };
    });

    // Still refresh the event list (but NOT counts — those were patched above)
    if (!reviewModal.isOpen) {
      loadReservations({ silent: true });
    }
  }, [silentRefresh, loadReservations, reviewModal.isOpen]);
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

  // Load edit requests (for admin review)
  const loadEditRequests = async () => {
    try {
      setEditRequestsLoading(true);

      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/edit-requests?status=all`);

      if (!response.ok) {
        throw new Error('Failed to load edit requests');
      }

      const data = await response.json();

      // Transform edit requests for display
      const transformedEditRequests = (data.editRequests || []).map(req => ({
        _id: req._id,
        eventId: req.eventId,
        originalEventId: req.originalEventId,
        eventTitle: req.eventTitle,
        eventDescription: req.eventDescription,
        startDateTime: req.startDateTime,
        endDateTime: req.endDateTime,
        requestedRooms: req.requestedRooms || [],
        locations: req.locations || [],
        locationDisplayNames: req.locationDisplayNames,
        requesterName: req.roomReservationData?.requestedBy?.name || req.createdByName || '',
        requesterEmail: req.roomReservationData?.requestedBy?.email || req.createdByEmail || '',
        status: req.status,
        submittedAt: req.roomReservationData?.submittedAt || req.createdAt,
        changeReason: req.editRequestData?.changeReason || '',
        proposedChanges: req.editRequestData?.proposedChanges || {},
        reviewNotes: req.roomReservationData?.reviewNotes || '',
        _isEditRequest: true,
        _fullData: req // Keep full data for approval
      }));

      logger.info('Loaded edit requests:', { count: transformedEditRequests.length });
      setEditRequests(transformedEditRequests);

    } catch (err) {
      logger.error('Error loading edit requests:', err);
      // Don't set error state - edit requests are optional
    } finally {
      setEditRequestsLoading(false);
    }
  };

  // Client-side pagination
  const totalPages = Math.ceil(sortedReservations.length / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;
  const paginatedReservations = sortedReservations.slice(startIndex, startIndex + PAGE_SIZE);

  // Handle tab changes — re-fetches with tab-scoped query
  const handleTabChange = useCallback((newTab) => {
    setActiveTab(newTab);
    setPage(1);
    // Clear status filters that don't apply to the "Needs Attention" tab
    if (newTab === 'needs_attention' && (statusFilter === 'published' || statusFilter === 'rejected')) {
      setStatusFilter('');
    }
    loadReservations({ tab: newTab });
  }, [statusFilter, loadReservations]);

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


  // =========================================================================
  // EDIT REQUEST HANDLERS
  // =========================================================================

  // Open edit request review modal
  const openEditRequestModal = (editRequest) => {
    setSelectedEditRequest(editRequest);
    setShowEditRequestModal(true);
    setEditRequestRejectionReason('');
  };

  // Close edit request review modal
  const closeEditRequestModal = () => {
    setShowEditRequestModal(false);
    setSelectedEditRequest(null);
    setEditRequestRejectionReason('');
  };

  // Approve edit request
  const handleApproveEditRequest = async (notes = '') => {
    if (!selectedEditRequest) return;

    try {
      setApprovingEditRequest(true);

      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${selectedEditRequest._id}/publish-edit`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notes,
            _version: selectedEditRequest?._version ?? null,
          })
        }
      );

      if (response.status === 409) {
        const errorData = await response.json();
        if (errorData.error === 'SchedulingConflict') {
          throw new Error(errorData.message || 'Scheduling conflict detected — please resolve conflicts before approving');
        }
        throw new Error(errorData.error || errorData.details?.message || 'Event was modified by another user — please close and try again');
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve edit request');
      }

      logger.info('Edit request approved:', selectedEditRequest._id);

      // Close modal FIRST so the user sees immediate feedback
      closeEditRequestModal();
      showSuccess('Edit request approved and changes applied');

      // Refresh edit requests (non-blocking)
      loadEditRequests();

      // Notify MyReservations and nav badge to refresh
      dispatchRefresh('reservation-requests');
      dispatchRefresh('reservation-requests', 'navigation-counts');

    } catch (error) {
      logger.error('Error approving edit request:', error);
      showError(error, { context: 'ReservationRequests.approveEditRequest', userMessage: 'Failed to approve edit request' });
    } finally {
      setApprovingEditRequest(false);
    }
  };

  // Reject edit request
  const handleRejectEditRequest = async () => {
    if (!selectedEditRequest) return;

    if (!editRequestRejectionReason.trim()) {
      showError('Please provide a reason for rejecting the edit request.');
      return;
    }

    try {
      setRejectingEditRequest(true);

      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${selectedEditRequest._id}/reject-edit`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: editRequestRejectionReason.trim(),
            _version: selectedEditRequest?._version ?? null,
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject edit request');
      }

      logger.info('Edit request rejected:', selectedEditRequest._id);

      // Close modal FIRST so the user sees immediate feedback
      closeEditRequestModal();
      showSuccess('Edit request rejected');

      // Refresh edit requests (non-blocking)
      loadEditRequests();

      // Notify MyReservations and nav badge to refresh
      dispatchRefresh('reservation-requests');
      dispatchRefresh('reservation-requests', 'navigation-counts');

    } catch (error) {
      logger.error('Error rejecting edit request:', error);
      showError(error, { context: 'ReservationRequests.rejectEditRequest', userMessage: 'Failed to reject edit request' });
    } finally {
      setRejectingEditRequest(false);
    }
  };

  // =========================================================================
  // END CARD-LEVEL EDIT REQUEST HANDLERS
  // =========================================================================

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

  // Card-level delete handlers (separate from modal delete via hook)
  const handleDeleteClick = (reservation) => {
    if (confirmDeleteId === reservation._id) {
      handleDelete(reservation);
    } else {
      setConfirmDeleteId(reservation._id);
    }
  };

  const handleDelete = async (reservation) => {
    try {
      setDeletingId(reservation._id);
      setConfirmDeleteId(null);

      const hasGraphData = reservation.calendarId || reservation.graphData?.id;

      await deleteEvent(reservation._id, {
        apiToken,
        version: reservation._version,
        graphToken: hasGraphData ? graphToken : undefined,
        calendarId: reservation.calendarId,
      });

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id
          ? { ...r, status: 'deleted', isDeleted: true }
          : r
      ));
      dispatchRefresh('reservation-requests', 'navigation-counts');

    } catch (err) {
      logger.error('Error deleting reservation:', err);
      showError(err, { context: 'ReservationRequests.handleDelete', userMessage: 'Failed to delete reservation' });
    } finally {
      setDeletingId(null);
    }
  };

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

  if (loading && allReservations.length === 0) {
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
                    onClick={() => reviewModal.openModal(reservation)}
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

        {paginatedReservations.length === 0 && !loading && !isSilentRefreshing && (
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

      {/* Edit Request Review Modal */}
      {showEditRequestModal && selectedEditRequest && (
        <EditRequestComparison
          editRequest={selectedEditRequest}
          eventCalendarData={selectedEditRequest._fullData?.calendarData}
          eventRoomReservationData={selectedEditRequest._fullData?.roomReservationData}
          onClose={closeEditRequestModal}
          onApprove={handleApproveEditRequest}
          onReject={handleRejectEditRequest}
          rejectionReason={editRequestRejectionReason}
          onRejectionReasonChange={setEditRequestRejectionReason}
          isApproving={approvingEditRequest}
          isRejecting={rejectingEditRequest}
        />
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
