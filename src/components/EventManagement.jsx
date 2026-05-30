// src/components/EventManagement.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '../hooks/usePermissions';
import { useNotification } from '../context/NotificationContext';
import { useRooms } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { useAuthenticatedFetch } from '../hooks/useAuthenticatedFetch';
import DatePickerInput from './DatePickerInput';
import { useSSE } from '../context/SSEContext';
import { dispatchRefresh, useDataRefreshBus } from '../hooks/useDataRefreshBus';
import { keys } from '../queries/keys';
import ConflictDialog from './shared/ConflictDialog';
import FreshnessIndicator from './shared/FreshnessIndicator';
import LoadingSpinner from './shared/LoadingSpinner';
import EmptyStateRefreshButton from './shared/EmptyStateRefreshButton';
import EventReviewExperience from './shared/EventReviewExperience';
import RecurringScopeDialog from './shared/RecurringScopeDialog';
import { useEventReviewExperience } from '../hooks/useEventReviewExperience';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { deleteEvent } from '../utils/eventPayloadBuilder';
import { deriveListLoadingState } from '../utils/listLoadingState';
import { formatTimeString } from '../utils/appTimeUtils';
import './EventManagement.css';

const TABS = [
  { key: 'all', label: 'All', statusParam: 'all' },
  { key: 'published', label: 'Published', statusParam: 'published' },
  { key: 'pending', label: 'Pending', statusParam: 'pending' },
  { key: 'rejected', label: 'Rejected', statusParam: 'rejected' },
  { key: 'deleted', label: 'Deleted', statusParam: 'deleted' },
];

const PAGE_SIZE = 20;

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}


export default function EventManagement() {
  const { isAdmin } = usePermissions();
  const { showSuccess, showError } = useNotification();
  const { getRoomName } = useRooms();
  const { apiToken } = useAuth();
  const { isConnected } = useSSE();
  const authFetch = useAuthenticatedFetch();

  const queryClient = useQueryClient();

  // Server data state (events, counts, loading, isSilentRefreshing, totalPages,
  // lastFetchedAt) is now derived from the React Query cache below. Local UI
  // state for filters, pagination, and modal-confirm flags continues to live
  // in component state.

  // Filter state
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  // UI state
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState(null);
  const [conflictDialog, setConflictDialog] = useState(null);
  const [restoreConflicts, setRestoreConflicts] = useState(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // --- Recurring scope dialog (parity with Calendar/MyReservations/ReservationRequests) ---
  // Restore-via-Recurrence-tab is unreachable from EventManagement unless the
  // user can route a series master through useEventReviewExperience with a
  // chosen scope. This wires that path without disturbing the existing
  // em-details-modal which still handles non-recurring view+restore actions.
  const [recurringScopeDialog, setRecurringScopeDialog] = useState({
    isOpen: false,
    pendingEvent: null,
    isLoading: false,
  });

  const anyConfirming = confirmDeleteId !== null || confirmRestoreId !== null;

  const searchTimeoutRef = useRef(null);
  const debouncedSearchRef = useRef('');

  // ─── Server data: admin-browse list + counts ───────────────────────────
  // The admin browse view is server-paginated (page + limit + status + search
  // + date range). Each filter combination is its own queryKey, so changing
  // page/tab/search/dates produces a fresh fetch (or cache hit if previously
  // visited within staleTime). RQ's `keepPreviousData` keeps the prior page's
  // data visible while the new page fetches — no spinner flash on pagination.
  const listScope = {
    view: 'admin-browse',
    page,
    limit: PAGE_SIZE,
    status: activeTab === 'all' ? 'all' : (TABS.find(t => t.key === activeTab)?.statusParam || 'all'),
    search: debouncedSearchRef.current || '',
    startDate: startDate || '',
    endDate: endDate || '',
  };
  const listKey = keys.events.list(listScope);
  const countsKey = keys.events.counts({ view: 'admin-browse' });

  const eventsQuery = useQuery({
    queryKey: listKey,
    queryFn: async ({ queryKey, signal }) => {
      const scope = queryKey[2] || {};
      const params = new URLSearchParams({
        page: String(scope.page || 1),
        limit: String(scope.limit || PAGE_SIZE),
        status: scope.status || 'all',
      });
      if (scope.search) params.set('search', scope.search);
      if (scope.startDate) params.set('startDate', scope.startDate);
      if (scope.endDate) params.set('endDate', scope.endDate);

      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list?view=admin-browse&${params}`,
        { signal }
      );
      if (!res.ok) throw new Error('Failed to load events');
      const data = await res.json();
      const total = data.pagination?.totalCount || data.total || 0;
      return {
        events: data.events || [],
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      };
    },
    enabled: !!apiToken && isAdmin,
    staleTime: 5 * 60 * 1000,
    refetchInterval: isConnected ? 5 * 60 * 1000 : 30 * 1000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev, // keep previous-page data while paginating
  });

  const countsQuery = useQuery({
    queryKey: countsKey,
    queryFn: async ({ signal }) => {
      const res = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/events/list/counts?view=admin-browse`,
        { signal }
      );
      if (!res.ok) throw new Error('Failed to load counts');
      return res.json();
    },
    enabled: !!apiToken && isAdmin,
    staleTime: 5 * 60 * 1000,
    refetchInterval: isConnected ? 5 * 60 * 1000 : 30 * 1000,
    refetchIntervalInBackground: false,
  });

  // Derived bindings preserved for downstream consumers.
  const events = eventsQuery.data?.events ?? [];
  const totalPages = eventsQuery.data?.totalPages ?? 1;
  const counts = countsQuery.data ?? { total: 0, published: 0, pending: 0, rejected: 0, deleted: 0, draft: 0 };
  // Loading primitives from the shared deriveListLoadingState(): the first-load
  // gate tracks the LIST query's isPending (a pending counts query does not
  // extend the spinner); a silent refetch of either list or counts dims rather
  // than blanks. See CLAUDE.md "React Query loading primitives".
  const { isFirstLoad: loading, isSilentRefreshing } = deriveListLoadingState(eventsQuery, { countsQuery });
  const lastFetchedAt = Math.max(
    eventsQuery.dataUpdatedAt || 0,
    countsQuery.dataUpdatedAt || 0
  ) || null;

  // Token rotation guard — refetch on warm→warm token transition (401-retry).
  const lastSeenTokenRef = useRef(null);
  useEffect(() => {
    if (!apiToken) return;
    if (lastSeenTokenRef.current && lastSeenTokenRef.current !== apiToken) {
      queryClient.refetchQueries({ queryKey: keys.events.list({ view: 'admin-browse' }) });
      queryClient.refetchQueries({ queryKey: keys.events.counts({ view: 'admin-browse' }) });
    }
    lastSeenTokenRef.current = apiToken;
  }, [apiToken, queryClient]);

  // Backward-compat shims for legacy call sites (modal onRefresh, manual refresh,
  // conflict-dialog close handler) that still call fetchEvents() / fetchCounts().
  const fetchEvents = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: keys.events.list({ view: 'admin-browse' }) });
  }, [queryClient]);

  const fetchCounts = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: keys.events.counts({ view: 'admin-browse' }) });
  }, [queryClient]);

  // Bus subscription: invalidate the cache instead of refetching directly.
  // Will retire in §15 once every consumer is on RQ.
  const onBusRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: keys.events.list({ view: 'admin-browse' }) });
    queryClient.invalidateQueries({ queryKey: keys.events.counts({ view: 'admin-browse' }) });
  }, [queryClient]);
  useDataRefreshBus('event-management', onBusRefresh, !!apiToken);

  // --- Unified review modal experience (parity with Calendar et al.) ---
  // Used only when the user clicks a recurring series master. Non-recurring
  // events keep the existing em-details-modal flow with its dedicated
  // soft-deleted-master Restore action (a different operation that targets
  // PUT /api/admin/events/:id/restore — preserved on purpose).
  const reviewModal = useEventReviewExperience({
    apiToken,
    authFetch,
    onRefresh: () => {
      fetchEvents();
      fetchCounts();
    },
    onError: (error) => { showError(error, { context: 'EventManagement.reviewModal' }); },
  });

  const isRecurringSeriesMaster = useCallback((evt) => {
    if (!evt) return false;
    return evt.eventType === 'seriesMaster'
      || (!!evt.recurrence?.pattern && !!evt.recurrence?.range);
  }, []);

  const openReviewWithScopeDialog = useCallback((evt) => {
    if (isRecurringSeriesMaster(evt)) {
      setRecurringScopeDialog({ isOpen: true, pendingEvent: evt, isLoading: false });
    } else {
      // Non-recurring: keep the existing em-details-modal path (preserves
      // status history view, deletion info, soft-deleted-master Restore, etc.)
      setSelectedEvent(evt);
    }
  }, [isRecurringSeriesMaster]);

  const handleRecurringScopeSelected = useCallback(async (scope) => {
    const evt = recurringScopeDialog.pendingEvent;
    if (!evt) return;
    setRecurringScopeDialog({ isOpen: false, pendingEvent: null, isLoading: false });
    try {
      await reviewModal.openModal(evt, { editScope: scope });
    } catch (err) {
      logger.error('Error opening review modal from EventManagement scope dialog:', err);
      showError(err, { context: 'EventManagement.handleRecurringScopeSelected', userMessage: 'Failed to open review modal' });
    }
  }, [recurringScopeDialog.pendingEvent, reviewModal, showError]);

  const handleRecurringScopeClose = useCallback(() => {
    setRecurringScopeDialog({ isOpen: false, pendingEvent: null, isLoading: false });
  }, []);

  // Manual refresh handler for FreshnessIndicator
  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([fetchEvents(), fetchCounts()]);
    } finally {
      setIsManualRefreshing(false);
    }
  }, [fetchEvents, fetchCounts]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      debouncedSearchRef.current = searchTerm;
      setPage(1);
      fetchEvents();
    }, 500);
    return () => clearTimeout(searchTimeoutRef.current);
  }, [searchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when tab or dates change
  useEffect(() => {
    setPage(1);
    setSelectedEvent(null);
  }, [activeTab, startDate, endDate]);

  // Get location display for an event
  const getLocationDisplay = (event) => {
    // Try locationDisplayNames first (array of strings, or single string)
    if (Array.isArray(event.locationDisplayNames) && event.locationDisplayNames.length > 0) {
      return event.locationDisplayNames.join(', ');
    }
    if (typeof event.locationDisplayNames === 'string' && event.locationDisplayNames) {
      return event.locationDisplayNames;
    }
    // Try locations array (ObjectIds) with room name resolution
    if (Array.isArray(event.locations) && event.locations.length > 0) {
      const names = event.locations.map(id => getRoomName(String(id)) || String(id));
      return names.join(', ');
    }
    // Try graphData location
    if (event.graphData?.location?.displayName) {
      return event.graphData.location.displayName;
    }
    // Try calendarData
    if (event.calendarData?.locationDisplayName) {
      return event.calendarData.locationDisplayName;
    }
    return '—';
  };

  // Get requester display
  const getRequester = (event) => {
    return event.roomReservationData?.requestedBy?.name
      || event.createdBy
      || '—';
  };

  // Get event date range display
  const getDateDisplay = (event) => {
    const start = event.calendarData?.startDateTime || event.startDateTime || event.graphData?.start?.dateTime;
    const end = event.calendarData?.endDateTime || event.endDateTime || event.graphData?.end?.dateTime;
    if (!start) return '—';
    const startStr = formatDate(start);
    const startTime = event.calendarData?.startTime || event.startTime || '';
    const endTime = event.calendarData?.endTime || event.endTime || '';
    if (startTime && endTime) {
      return `${startStr}, ${formatTimeString(startTime)} – ${formatTimeString(endTime)}`;
    }
    if (end) {
      return `${startStr} – ${formatDate(end)}`;
    }
    return startStr;
  };

  // Get event title
  const getTitle = (event) => {
    const title = event.calendarData?.eventTitle || event.eventTitle || event.graphData?.subject || 'Untitled Event';
    const cd = event.calendarData;
    const isHold = cd && !cd.startTime && !cd.endTime && (cd.reservationStartTime || cd.reservationEndTime);
    return isHold && !title?.startsWith('[Hold]') ? `[Hold] ${title}` : title;
  };

  // ─── Mutations: admin delete and restore ──────────────────────────────
  // Each mutation:
  //   - applies an optimistic patch to the active list cache (mark deleted /
  //     mark restoring) so the UI flips immediately;
  //   - rolls back to the prior cache snapshot on error;
  //   - preserves the existing 409 SchedulingConflict + VERSION_CONFLICT
  //     surface (sets restoreConflicts / conflictDialog from onError, NOT
  //     a generic toast);
  //   - invalidates list + counts on settled.

  const adminBrowsePrefix = { queryKey: ['events', 'list'], predicate: (q) => q.queryKey[2]?.view === 'admin-browse' };

  const deleteMutation = useMutation({
    mutationFn: async ({ event }) => {
      const result = await deleteEvent(String(event._id), {
        apiToken,
        version: event._version,
      });
      if (!result.ok && result.status === 409) {
        const err = new Error('VersionConflict');
        err.conflictPayload = result.data;
        err.staleEvent = event;
        throw err;
      }
      return event;
    },
    onMutate: async ({ event }) => {
      await queryClient.cancelQueries(adminBrowsePrefix);
      const previousEntries = queryClient.getQueriesData(adminBrowsePrefix);
      // Optimistic: mark this row deleted in any cached admin-browse list.
      queryClient.setQueriesData(adminBrowsePrefix, (old) => {
        if (!old || !Array.isArray(old.events)) return old;
        return {
          ...old,
          events: old.events.map(r =>
            String(r._id) === String(event._id) ? { ...r, status: 'deleted', isDeleted: true } : r
          ),
        };
      });
      return { previousEntries };
    },
    onError: (err, { event }, ctx) => {
      if (ctx?.previousEntries) {
        for (const [key, value] of ctx.previousEntries) queryClient.setQueryData(key, value);
      }
      if (err?.message === 'VersionConflict') {
        setConflictDialog({ ...err.conflictPayload, eventTitle: getTitle(err.staleEvent), staleData: err.staleEvent });
        return;
      }
      showError(err, { context: 'EventManagement.handleDelete' });
    },
    onSuccess: () => {
      showSuccess('Event deleted');
      setSelectedEvent(null);
      dispatchRefresh('event-management', 'navigation-counts');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.events.list({ view: 'admin-browse' }) });
      queryClient.invalidateQueries({ queryKey: keys.events.counts({ view: 'admin-browse' }) });
    },
  });

  const handleDeleteClick = (event) => {
    if (confirmDeleteId === String(event._id)) {
      setConfirmDeleteId(null);
      deleteMutation.mutate({ event });
    } else {
      setConfirmDeleteId(String(event._id));
    }
  };
  // Internal wrapper kept for callers that pass `event` directly (e.g., the
  // conflict-dialog override flow).
  const handleDelete = (event) => deleteMutation.mutate({ event });
  const deletingId = deleteMutation.isPending ? String(deleteMutation.variables?.event?._id) : null;

  const restoreMutation = useMutation({
    mutationFn: async ({ event, forceRestore = false }) => {
      const eventId = String(event._id);
      const res = await authFetch(`${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/restore`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _version: event._version, forceRestore }),
      });
      if (res.status === 409) {
        const data = await res.json();
        const err = new Error(data.error === 'SchedulingConflict' ? 'SchedulingConflict' : 'VersionConflict');
        err.conflictPayload = data;
        err.staleEvent = event;
        throw err;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed to restore event');
      }
      return res.json();
    },
    onError: (err, _vars) => {
      if (err?.message === 'SchedulingConflict' && err.conflictPayload) {
        setRestoreConflicts({ ...err.conflictPayload, event: err.staleEvent });
        return;
      }
      if (err?.message === 'VersionConflict') {
        setConflictDialog({ ...err.conflictPayload, eventTitle: getTitle(err.staleEvent), staleData: err.staleEvent });
        return;
      }
      showError(err, { context: 'EventManagement.handleRestore' });
    },
    onSuccess: () => {
      showSuccess('Event restored');
      setSelectedEvent(null);
      dispatchRefresh('event-management', 'navigation-counts');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.events.list({ view: 'admin-browse' }) });
      queryClient.invalidateQueries({ queryKey: keys.events.counts({ view: 'admin-browse' }) });
    },
  });

  const handleRestoreClick = (event) => {
    if (confirmRestoreId === String(event._id)) {
      setConfirmRestoreId(null);
      restoreMutation.mutate({ event });
    } else {
      setConfirmRestoreId(String(event._id));
    }
  };
  const handleRestore = (event, forceRestore = false) => restoreMutation.mutate({ event, forceRestore });
  const restoringId = restoreMutation.isPending ? String(restoreMutation.variables?.event?._id) : null;

  // Handle conflict dialog close
  const handleConflictClose = () => {
    setConflictDialog(null);
    fetchEvents();
    fetchCounts();
  };

  // Tab count lookup
  const getTabCount = (key) => {
    switch (key) {
      case 'all': return counts.total;
      case 'pending': return counts.pending;
      case 'published': return counts.published;
      case 'rejected': return counts.rejected;
      case 'deleted': return counts.deleted;
      default: return 0;
    }
  };

  // Access denied
  if (!isAdmin) {
    return (
      <div className="em-access-denied">
        <div className="em-access-denied-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <h2>Access Denied</h2>
        <p>You need admin privileges to access Event Management.</p>
      </div>
    );
  }

  return (
    <div className="em-container">
      {/* Page Header */}
      <div className="em-page-header">
        <h2>Event Management</h2>
        <p className="em-page-header-subtitle">
          Browse, search, and manage all events across the system
          <FreshnessIndicator
            lastFetchedAt={lastFetchedAt}
            onRefresh={handleManualRefresh}
            isRefreshing={isManualRefreshing}
          />
        </p>
      </div>

      {/* Stats Cards */}
      <div className="em-stats-row">
        <div className="em-stat-card total">
          <div className="em-stat-icon total">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="em-stat-content">
            <h4>{counts.total.toLocaleString()}</h4>
            <p>Total Events</p>
          </div>
        </div>
        <div className="em-stat-card published">
          <div className="em-stat-icon published">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="em-stat-content">
            <h4>{counts.published.toLocaleString()}</h4>
            <p>Published Events</p>
          </div>
        </div>
        <div className="em-stat-card deleted">
          <div className="em-stat-icon deleted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
          <div className="em-stat-content">
            <h4>{counts.deleted.toLocaleString()}</h4>
            <p>Deleted Events</p>
          </div>
        </div>
      </div>

      {/* Controls Row */}
      <div className="em-controls-row">
        <div className="em-search-container">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="em-search-input"
            placeholder="Search events by title, description, or location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="em-date-filters">
          <label>From</label>
          <DatePickerInput
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label>To</label>
          <DatePickerInput
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="em-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`em-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="em-tab-count">{getTabCount(tab.key).toLocaleString()}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="em-loading">
          <LoadingSpinner variant="card" size={40} text="Loading events..." />
        </div>
      ) : (
        <>
          {/* Event Cards */}
          <div className="em-events-grid">
            {events.map(event => {
              const eventId = String(event._id);
              const status = event.status || 'draft';
              const isDeleted = event.isDeleted || status === 'deleted';

              return (
                <div
                  key={eventId}
                  className={`em-event-card status-${status}`}
                >
                  {/* Card Header */}
                  <div className="em-event-card-header">
                    <div className="em-card-title-row">
                      <h3>{getTitle(event)}</h3>
                      <span className={`em-status-badge ${status}`}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </span>
                    </div>
                    <button
                      className="em-view-details-btn"
                      onClick={() => openReviewWithScopeDialog(event)}
                    >
                      View Details
                    </button>
                  </div>

                  {/* Info Grid */}
                  <div className="em-event-info">
                    <div className="em-event-info-item">
                      <span className="em-event-info-label">When</span>
                      <span className="em-event-info-value">{getDateDisplay(event)}</span>
                    </div>
                    <div className="em-event-info-item">
                      <span className="em-event-info-label">Where</span>
                      <span className="em-event-info-value">{getLocationDisplay(event)}</span>
                    </div>
                    <div className="em-event-info-item">
                      <span className="em-event-info-label">Requested By</span>
                      <span className="em-event-info-value">{getRequester(event)}</span>
                    </div>
                    {isDeleted && event.deletedAt && (
                      <div className="em-event-info-item">
                        <span className="em-event-info-label">Deleted At</span>
                        <span className="em-event-info-value">{formatDateTime(event.deletedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {events.length === 0 && !loading && !isSilentRefreshing && (
            <div className="em-empty-state">
              <div className="em-empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h3>No events found</h3>
              <p>
                {activeTab === 'deleted'
                  ? 'No deleted events to display.'
                  : searchTerm
                    ? `No events match "${searchTerm}".`
                    : 'No events match the current filters.'}
              </p>
              <EmptyStateRefreshButton
                onClick={handleManualRefresh}
                isRefreshing={isManualRefreshing}
              />
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="em-pagination">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="em-pagination-info">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Details Modal */}
      {selectedEvent && (() => {
        const event = selectedEvent;
        const eventId = String(event._id);
        const status = event.status || 'draft';
        const isDeleted = event.isDeleted || status === 'deleted';
        const requesterEmail = event.roomReservationData?.requestedBy?.email || '';
        const department = event.roomReservationData?.requestedBy?.department || event.roomReservationData?.department || '';
        const phone = event.roomReservationData?.requestedBy?.phone || event.roomReservationData?.phone || '';
        const description = event.calendarData?.eventDescription || event.eventDescription || '';
        const categories = event.calendarData?.categories || event.categories || [];
        const setupTime = event.calendarData?.setupTime || event.setupTime || '';
        const teardownTime = event.calendarData?.teardownTime || event.teardownTime || '';
        const reservationStartTime = event.calendarData?.reservationStartTime || event.reservationStartTime || '';
        const reservationEndTime = event.calendarData?.reservationEndTime || event.reservationEndTime || '';
        const doorOpenTime = event.calendarData?.doorOpenTime || event.doorOpenTime || '';
        const doorCloseTime = event.calendarData?.doorCloseTime || event.doorCloseTime || '';
        const notes = event.roomReservationData?.internalNotes?.eventNotes || event.calendarData?.eventNotes || event.eventNotes || '';

        return (
          <div className="em-details-modal-overlay" onClick={() => setSelectedEvent(null)}>
            <div className="em-details-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Event Details</h2>

              <div className="em-details-body">
                {/* Core Info */}
                <div className="em-detail-row">
                  <label>Event</label>
                  <span>{getTitle(event)}</span>
                </div>
                <div className="em-detail-row">
                  <label>Date & Time</label>
                  <span>{getDateDisplay(event)}</span>
                </div>
                <div className="em-detail-row">
                  <label>Location</label>
                  <span>{getLocationDisplay(event)}</span>
                </div>
                <div className="em-detail-row">
                  <label>Status</label>
                  <span>
                    <span className={`em-status-badge ${status}`}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </span>
                  </span>
                </div>

                {/* Requester Info */}
                <div className="em-detail-row">
                  <label>Requested By</label>
                  <span>{getRequester(event)}</span>
                </div>
                {requesterEmail && (
                  <div className="em-detail-row">
                    <label>Email</label>
                    <span>{requesterEmail}</span>
                  </div>
                )}
                {department && (
                  <div className="em-detail-row">
                    <label>Department</label>
                    <span>{department}</span>
                  </div>
                )}
                {phone && (
                  <div className="em-detail-row">
                    <label>Phone</label>
                    <span>{phone}</span>
                  </div>
                )}

                {/* Description */}
                {description && (
                  <div className="em-detail-row">
                    <label>Description</label>
                    <span>{description}</span>
                  </div>
                )}

                {/* Categories */}
                {categories.length > 0 && (
                  <div className="em-detail-row">
                    <label>Categories</label>
                    <span>{categories.join(', ')}</span>
                  </div>
                )}

                {/* Timing */}
                {(reservationStartTime || reservationEndTime) && (
                  <div className="em-detail-row">
                    <label>Reservation</label>
                    <span>
                      {reservationStartTime && `Start: ${formatTimeString(reservationStartTime)}`}
                      {reservationStartTime && reservationEndTime && ' · '}
                      {reservationEndTime && `End: ${formatTimeString(reservationEndTime)}`}
                    </span>
                  </div>
                )}
                {(setupTime || teardownTime) && (
                  <div className="em-detail-row">
                    <label>Setup / Teardown</label>
                    <span>
                      {setupTime && `Setup: ${formatTimeString(setupTime)}`}
                      {setupTime && teardownTime && ' · '}
                      {teardownTime && `Teardown: ${formatTimeString(teardownTime)}`}
                    </span>
                  </div>
                )}
                {(doorOpenTime || doorCloseTime) && (
                  <div className="em-detail-row">
                    <label>Doors</label>
                    <span>
                      {doorOpenTime && `Open: ${formatTimeString(doorOpenTime)}`}
                      {doorOpenTime && doorCloseTime && ' · '}
                      {doorCloseTime && `Close: ${formatTimeString(doorCloseTime)}`}
                    </span>
                  </div>
                )}

                {/* Notes */}
                {notes && (
                  <div className="em-detail-row">
                    <label>Notes</label>
                    <span>{notes}</span>
                  </div>
                )}

                {/* Deletion Info */}
                {isDeleted && (event.deletedByEmail || event.deletedAt) && (
                  <div className="em-deletion-info">
                    {event.deletedByEmail && <div>Deleted by: {event.deletedByEmail}</div>}
                    {event.deletedAt && <div>Deleted at: {formatDateTime(event.deletedAt)}</div>}
                  </div>
                )}

                {/* Status History */}
                {event.statusHistory?.length > 0 && (
                  <div className="em-detail-section">
                    <h4>Status History</h4>
                    <div className="em-status-history">
                      {event.statusHistory.map((entry, idx) => (
                        <div key={idx} className="em-status-history-item">
                          <span className={`em-status-badge ${entry.status}`}>
                            {entry.status}
                          </span>
                          <span className="em-history-date">{formatDateTime(entry.changedAt)}</span>
                          {entry.changedByEmail && (
                            <span>by {entry.changedByEmail}</span>
                          )}
                          {entry.reason && (
                            <span>— {entry.reason}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="em-modal-actions">
                {isDeleted ? (
                  <div className="confirm-button-group">
                    <button
                      className={`em-restore-btn ${confirmRestoreId === eventId ? 'confirming' : ''}`}
                      onClick={() => handleRestoreClick(event)}
                      disabled={restoringId === eventId}
                    >
                      {restoringId === eventId ? (
                        'Restoring...'
                      ) : confirmRestoreId === eventId ? (
                        'Confirm?'
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                          </svg>
                          Restore
                        </>
                      )}
                    </button>
                    {confirmRestoreId === eventId && (
                      <button
                        className="cancel-confirm-x restore-cancel-x"
                        onClick={(e) => { e.stopPropagation(); setConfirmRestoreId(null); }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="confirm-button-group">
                    <button
                      className={`em-delete-btn ${confirmDeleteId === eventId ? 'confirming' : ''}`}
                      onClick={() => handleDeleteClick(event)}
                      disabled={deletingId === eventId}
                    >
                      {deletingId === eventId ? (
                        'Deleting...'
                      ) : confirmDeleteId === eventId ? (
                        'Confirm?'
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          Delete
                        </>
                      )}
                    </button>
                    {confirmDeleteId === eventId && (
                      <button
                        className="cancel-confirm-x"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
                <button className="em-close-btn" onClick={() => setSelectedEvent(null)} disabled={anyConfirming}>
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Scheduling Conflict Modal */}
      {restoreConflicts && (
        <div className="em-modal-overlay" onClick={() => setRestoreConflicts(null)}>
          <div className="em-scheduling-conflict-modal" onClick={e => e.stopPropagation()}>
            <h3>Scheduling Conflict</h3>
            <p>
              Cannot restore &quot;{getTitle(restoreConflicts.event)}&quot; to <strong>{restoreConflicts.previousStatus}</strong> because
              {' '}{restoreConflicts.conflicts.length} conflicting event{restoreConflicts.conflicts.length > 1 ? 's' : ''} now
              {' '}occupy the same room and time:
            </p>
            <ul className="em-conflict-list">
              {restoreConflicts.conflicts.map(c => (
                <li key={c.id}>
                  <strong>{c.eventTitle}</strong>
                  <span className="em-conflict-time">
                    {formatDateTime(c.startDateTime)} &ndash; {formatDateTime(c.endDateTime)}
                  </span>
                  <span className={`em-status-badge em-status-${c.status}`}>{c.status}</span>
                </li>
              ))}
            </ul>
            <div className="em-conflict-actions">
              <button
                className="em-btn em-btn-secondary"
                onClick={() => setRestoreConflicts(null)}
              >
                Cancel
              </button>
              <button
                className="em-btn em-btn-warning"
                onClick={() => {
                  const event = restoreConflicts.event;
                  setRestoreConflicts(null);
                  handleRestore(event, true);
                }}
              >
                Override &amp; Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict Dialog */}
      {conflictDialog && (
        <ConflictDialog
          isOpen={true}
          onClose={handleConflictClose}
          conflictData={conflictDialog}
          staleData={conflictDialog.staleData}
        />
      )}

      {/* Recurring Event Scope Selection Dialog (parity with Calendar et al.) */}
      <RecurringScopeDialog
        isOpen={recurringScopeDialog.isOpen}
        onClose={handleRecurringScopeClose}
        onSelectScope={handleRecurringScopeSelected}
        eventSubject={
          recurringScopeDialog.pendingEvent?.calendarData?.eventTitle
          || recurringScopeDialog.pendingEvent?.eventTitle
          || 'Recurring Event'
        }
        eventDate={recurringScopeDialog.pendingEvent?.calendarData?.startDate
          ? new Date(recurringScopeDialog.pendingEvent.calendarData.startDate + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
            })
          : ''
        }
        isLoading={recurringScopeDialog.isLoading}
      />

      {/* Unified Review Modal (used only for recurring series masters; non-recurring
          events use the em-details-modal above which preserves status history,
          deletion info, and the dedicated soft-deleted-master Restore button) */}
      <EventReviewExperience
        experience={reviewModal}
        title={reviewModal.editableData?.eventTitle || reviewModal.editableData?.calendarData?.eventTitle || 'Event'}
        defaultCalendar={reviewModal.editableData?.calendarOwner || undefined}
      />
    </div>
  );
}
