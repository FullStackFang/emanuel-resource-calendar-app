// src/components/MyReservations.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { filterBySearchAndDate, sortReservations } from '../utils/reservationFilterUtils';
import { formatDraftAge } from '../utils/draftAgeUtils';
import EventReviewExperience from './shared/EventReviewExperience';
import LoadingSpinner from './shared/LoadingSpinner';
import FreshnessIndicator from './shared/FreshnessIndicator';
import './shared/FilterBar.css';
import './MyReservations.css';

export default function MyReservations() {
  const { apiToken } = useAuth();
  const { isConnected } = useSSE();
  const authFetch = useAuthenticatedFetch();
  const { canSubmitReservation, canEditEvents, canDeleteEvents, canApproveReservations, permissionsLoading } = usePermissions();
  const { showSuccess, showWarning, showError } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [page, setPage] = useState(1);
  const [restoreConflicts, setRestoreConflicts] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  // Tracks in-flight silent polling fetches so the empty state doesn't flash
  // if the server momentarily returns an empty result during a background refresh.
  const [isSilentRefreshing, setIsSilentRefreshing] = useState(false);

  // Use room context for efficient room name resolution
  const { getRoomDetails } = useRooms();

  const isRequesterOnly = !canEditEvents && !canApproveReservations;

  const loadMyReservations = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
        setError('');
      } else {
        setIsSilentRefreshing(true);
      }

      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/events/list?view=my-events&limit=1000&includeDeleted=true`);

      if (!response.ok) {
        if (!silent) throw new Error('Failed to load reservations');
        logger.warn(`Silent refresh failed with status ${response.status}`);
        return;
      }

      const data = await response.json();
      setAllReservations(transformEventsToFlatStructure(data.events || []));
      setLastFetchedAt(Date.now());
      // Silent success after a prior failure: clear stale banner so the UI recovers.
      if (silent) setError('');
    } catch (err) {
      if (!silent) {
        logger.error('Error loading user reservations:', err);
        setError('Failed to load your reservation requests');
      }
    } finally {
      if (!silent) setLoading(false);
      else setIsSilentRefreshing(false);
    }
  }, [authFetch]);

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

  // Local state for requester actions (unique to MyReservations)
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Cancellation withdrawal state (unique to MyReservations)
  const [isWithdrawingCancellationRequest, setIsWithdrawingCancellationRequest] = useState(false);
  const [isWithdrawCancellationConfirming, setIsWithdrawCancellationConfirming] = useState(false);

  // Load all user's reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadMyReservations();
    }
  }, [loadMyReservations]);

  // Poll for updates every 5 min (silent — no loading spinner, skip while modal is open).
  // Declared before useDataRefreshBus so the bus subscription can reuse the same
  // silent-refresh callback (previously the bus handler used loadMyReservations
  // directly, which caused a jarring spinner flash on cross-view refresh events).
  const silentRefresh = useCallback(() => {
    if (reviewModal.isOpen) return;
    return loadMyReservations({ silent: true });
  }, [loadMyReservations, reviewModal.isOpen]);
  // Tighten poll cadence to 30s while SSE is unavailable so staleness is bounded
  // to tens of seconds; relax to the 5-min sanity cadence while SSE is live.
  usePolling(silentRefresh, isConnected ? 300_000 : 30_000, !!apiToken);

  // Listen for refresh events from other views (draft submission, approval actions, etc.)
  useDataRefreshBus('my-reservations', silentRefresh, !!apiToken);

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

  const hasActiveFilters = searchTerm || dateFrom || dateTo || statusFilter || sortBy !== 'date_desc';

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('');
    setSortBy('date_desc');
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

  // --- Requester action handlers (local, not in hook) ---

  // Resubmit (requester, rejected events) — used by ReviewModal's onResubmit button
  const handleResubmit = useCallback(async () => {
    const item = reviewModal.currentItem;
    if (!item) return;

    setIsResubmitting(true);
    try {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/resubmit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _version: item._version || null })
      });

      if (!response.ok) throw new Error('Failed to resubmit reservation');

      showSuccess('Request resubmitted for approval');
      reviewModal.closeModal(true);
      loadMyReservations();
      dispatchRefresh('my-reservations', 'navigation-counts');
    } catch (err) {
      logger.error('Error resubmitting reservation:', err);
      showError(err, { context: 'MyReservations.handleResubmit' });
    } finally {
      setIsResubmitting(false);
    }
  }, [reviewModal, authFetch, loadMyReservations, showError]);

  // Restore (owner, deleted events) — used by ReviewModal's onRestore button
  const handleRestore = useCallback(async () => {
    const item = reviewModal.currentItem;
    if (!item) return;

    setIsRestoring(true);
    try {
      const response = await authFetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/restore`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _version: item._version || null })
      });

      if (response.status === 409) {
        const data = await response.json();
        if (data.error === 'SchedulingConflict') {
          setRestoreConflicts({ ...data, eventTitle: item.eventTitle });
          return;
        }
        throw new Error(data.message || 'Version conflict');
      }

      if (!response.ok) throw new Error('Failed to restore reservation');

      const result = await response.json();
      showSuccess('Reservation restored');
      reviewModal.closeModal(true);
      loadMyReservations();
      dispatchRefresh('my-reservations', 'navigation-counts');
    } catch (err) {
      logger.error('Error restoring reservation:', err);
      showError(err, { context: 'MyReservations.handleRestore' });
    } finally {
      setIsRestoring(false);
    }
  }, [reviewModal, authFetch, loadMyReservations, showError]);

  // --- Cancellation withdrawal handler (unique to MyReservations) ---
  const handleWithdrawCancellationRequest = useCallback(async () => {
    if (!isWithdrawCancellationConfirming) {
      setIsWithdrawCancellationConfirming(true);
      return;
    }

    const currentItem = reviewModal.currentItem;
    if (!currentItem) return;

    setIsWithdrawingCancellationRequest(true);
    try {
      const eventId = currentItem._id || currentItem.eventId;
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

      showSuccess('Cancellation request withdrawn');
      setIsWithdrawCancellationConfirming(false);
      reviewModal.closeModal();
      loadMyReservations();
      dispatchRefresh('my-reservations', 'navigation-counts');
    } catch (error) {
      showError(error, { context: 'MyReservations.withdrawCancellationRequest' });
    } finally {
      setIsWithdrawingCancellationRequest(false);
      setIsWithdrawCancellationConfirming(false);
    }
  }, [isWithdrawCancellationConfirming, reviewModal, authFetch, loadMyReservations, showSuccess, showError]);

  const cancelWithdrawCancellationConfirmation = useCallback(() => {
    setIsWithdrawCancellationConfirming(false);
  }, []);

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
      <div className="mr-reservations-list">
        {paginatedReservations.map(reservation => {
          const isOnBehalfOf = reservation.isOnBehalfOf;
          const contactName = reservation.contactName;
          const isDraft = reservation.status === 'draft';

          return (
            <div key={reservation._id} className={`mr-card ${isDraft ? 'mr-card-draft' : ''}`}>
              {/* Card Header - Event Title + Actions */}
              <div className="mr-card-header">
                <div className="mr-card-title-row">
                  <h3 className="mr-card-title">{reservation.isHold && !reservation.eventTitle?.startsWith('[Hold]') ? `[Hold] ${reservation.eventTitle || 'Untitled'}` : reservation.eventTitle || 'Untitled'}</h3>
                  <span className={`status-badge ${getStatusBadgeInfo(reservation).className}`}>
                    {getStatusBadgeInfo(reservation).label}
                  </span>
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
                    onClick={() => reviewModal.openModal(reservation)}
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
                    {reservation.startDate ? (
                      <>
                        <span className="mr-date">
                          {new Date(reservation.startDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
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
