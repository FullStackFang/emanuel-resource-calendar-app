// src/components/MyReservations.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import DatePickerInput from './DatePickerInput';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { useReviewModal } from '../hooks/useReviewModal';
import { usePolling } from '../hooks/usePolling';
import { useDataRefreshBus } from '../hooks/useDataRefreshBus';
import { transformEventToFlatStructure, transformEventsToFlatStructure } from '../utils/eventTransformers';
import { computeApproverChanges } from '../utils/editRequestUtils';
import ReviewModal from './shared/ReviewModal';
import RoomReservationReview from './RoomReservationReview';
import ConflictDialog from './shared/ConflictDialog';
import LoadingSpinner from './shared/LoadingSpinner';
import FreshnessIndicator from './shared/FreshnessIndicator';
import './shared/FilterBar.css';
import './MyReservations.css';

export default function MyReservations({ apiToken }) {
  const { canSubmitReservation, canEditEvents, canApproveReservations, permissionsLoading } = usePermissions();
  const { showError } = useNotification();
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

  // Use room context for efficient room name resolution
  const { getRoomDetails } = useRooms();

  // --- useReviewModal hook (replaces manual modal state) ---
  const reviewModal = useReviewModal({
    apiToken,
    onSuccess: (result) => {
      loadMyReservations();
      if (result?.conflictDowngradedToPending) {
        const rc = result.recurringConflicts;
        showError(`Recurring event sent to pending: ${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrence(s) have scheduling conflicts. An admin must review before publishing.`);
      }
    },
    onError: (error) => { showError(error, { context: 'MyReservations' }); }
  });

  // Local state for requester actions in ReviewModal
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Local state for pending edit (owner editing pending events)
  // Local state for rejected edit (owner editing rejected events + resubmitting)

  // Local state for edit request mode (requester requesting edits on published events)
  const [isEditRequestMode, setIsEditRequestMode] = useState(false);

  // Local state for viewing existing edit requests on published events
  const [existingEditRequest, setExistingEditRequest] = useState(null);
  const [isViewingEditRequest, setIsViewingEditRequest] = useState(false);
  const [originalEventData, setOriginalEventData] = useState(null);

  // Edit request approval/rejection state (for approvers/admins viewing edit requests)
  // Transform originalEventData to flat structure for inline diff comparison
  const flatOriginalEventData = useMemo(() =>
    originalEventData ? transformEventToFlatStructure(originalEventData) : null,
  [originalEventData]);
  const [loadingEditRequest, setLoadingEditRequest] = useState(false);

  // Helper to get event field with calendarData fallback
  const getEventField = (event, field, defaultValue = undefined) => {
    if (!event) return defaultValue;
    if (event.calendarData?.[field] !== undefined) return event.calendarData[field];
    if (event[field] !== undefined) return event[field];
    return defaultValue;
  };

  // Extract and transform pendingEditRequest from an event
  const fetchExistingEditRequest = useCallback((event) => {
    if (!event) return null;

    setLoadingEditRequest(true);
    try {
      if (event.pendingEditRequest && event.pendingEditRequest.status === 'pending') {
        const pendingReq = event.pendingEditRequest;
        return {
          _id: event._id,
          eventId: event.eventId,
          editRequestId: pendingReq.id,
          status: pendingReq.status,
          requestedBy: pendingReq.requestedBy,
          changeReason: pendingReq.changeReason,
          proposedChanges: pendingReq.proposedChanges,
          reviewedBy: pendingReq.reviewedBy,
          reviewedAt: pendingReq.reviewedAt,
          reviewNotes: pendingReq.reviewNotes,
          eventTitle: pendingReq.proposedChanges?.eventTitle || event.eventTitle,
          eventDescription: pendingReq.proposedChanges?.eventDescription || event.eventDescription,
          startDateTime: pendingReq.proposedChanges?.startDateTime || event.startDateTime,
          endDateTime: pendingReq.proposedChanges?.endDateTime || event.endDateTime,
          startDate: pendingReq.proposedChanges?.startDateTime?.split('T')[0] || event.startDate,
          startTime: pendingReq.proposedChanges?.startDateTime?.split('T')[1]?.substring(0, 5) || event.startTime,
          endDate: pendingReq.proposedChanges?.endDateTime?.split('T')[0] || event.endDate,
          endTime: pendingReq.proposedChanges?.endDateTime?.split('T')[1]?.substring(0, 5) || event.endTime,
          attendeeCount: pendingReq.proposedChanges?.attendeeCount ?? getEventField(event, 'attendeeCount'),
          locations: pendingReq.proposedChanges?.locations || getEventField(event, 'locations', []),
          locationDisplayNames: pendingReq.proposedChanges?.locationDisplayNames || getEventField(event, 'locationDisplayNames', ''),
          requestedRooms: pendingReq.proposedChanges?.requestedRooms || getEventField(event, 'requestedRooms', []),
          categories: pendingReq.proposedChanges?.categories || getEventField(event, 'categories', []),
          services: pendingReq.proposedChanges?.services || getEventField(event, 'services', {}),
          setupTimeMinutes: pendingReq.proposedChanges?.setupTimeMinutes ?? getEventField(event, 'setupTimeMinutes'),
          teardownTimeMinutes: pendingReq.proposedChanges?.teardownTimeMinutes ?? getEventField(event, 'teardownTimeMinutes'),
          reservationStartMinutes: pendingReq.proposedChanges?.reservationStartMinutes ?? getEventField(event, 'reservationStartMinutes'),
          reservationEndMinutes: pendingReq.proposedChanges?.reservationEndMinutes ?? getEventField(event, 'reservationEndMinutes'),
          setupTime: pendingReq.proposedChanges?.setupTime || getEventField(event, 'setupTime', ''),
          teardownTime: pendingReq.proposedChanges?.teardownTime || getEventField(event, 'teardownTime', ''),
          reservationStartTime: pendingReq.proposedChanges?.reservationStartTime || getEventField(event, 'reservationStartTime', ''),
          reservationEndTime: pendingReq.proposedChanges?.reservationEndTime || getEventField(event, 'reservationEndTime', ''),
          doorOpenTime: pendingReq.proposedChanges?.doorOpenTime || getEventField(event, 'doorOpenTime', ''),
          doorCloseTime: pendingReq.proposedChanges?.doorCloseTime || getEventField(event, 'doorCloseTime', ''),
          setupNotes: pendingReq.proposedChanges?.setupNotes ?? getEventField(event, 'setupNotes'),
          doorNotes: pendingReq.proposedChanges?.doorNotes ?? getEventField(event, 'doorNotes'),
          eventNotes: pendingReq.proposedChanges?.eventNotes ?? getEventField(event, 'eventNotes'),
          specialRequirements: pendingReq.proposedChanges?.specialRequirements ?? getEventField(event, 'specialRequirements'),
          isOffsite: pendingReq.proposedChanges?.isOffsite ?? getEventField(event, 'isOffsite', false),
          offsiteName: pendingReq.proposedChanges?.offsiteName || getEventField(event, 'offsiteName', ''),
          offsiteAddress: pendingReq.proposedChanges?.offsiteAddress || getEventField(event, 'offsiteAddress', ''),
          createdAt: pendingReq.requestedBy?.requestedAt
        };
      }
      return null;
    } finally {
      setLoadingEditRequest(false);
    }
  }, []);

  // Check for existing edit requests when ReviewModal opens with a published event
  useEffect(() => {
    if (reviewModal.isOpen && reviewModal.currentItem?.status === 'published') {
      const editRequest = fetchExistingEditRequest(reviewModal.currentItem);
      setExistingEditRequest(editRequest);
    } else if (!reviewModal.isOpen) {
      setExistingEditRequest(null);
      setIsViewingEditRequest(false);
      setOriginalEventData(null);
    }
  }, [reviewModal.isOpen, reviewModal.currentItem, fetchExistingEditRequest]);

  // View the edit request data in the form
  const handleViewEditRequest = useCallback(() => {
    if (existingEditRequest) {
      const currentData = reviewModal.editableData;
      if (currentData) {
        setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
      }
      const proposedChanges = existingEditRequest.proposedChanges || {};

      // Decompose startDateTime/endDateTime into separate date/time fields
      // so the form comparison can detect individual field changes
      const decomposed = { ...proposedChanges };
      if (proposedChanges.startDateTime) {
        try {
          const dt = new Date(proposedChanges.startDateTime);
          if (!isNaN(dt.getTime())) {
            decomposed.startDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            decomposed.startTime = dt.toTimeString().slice(0, 5);
          }
        } catch (e) { /* ignore parse errors */ }
      }
      if (proposedChanges.endDateTime) {
        try {
          const dt = new Date(proposedChanges.endDateTime);
          if (!isNaN(dt.getTime())) {
            decomposed.endDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            decomposed.endTime = dt.toTimeString().slice(0, 5);
          }
        } catch (e) { /* ignore parse errors */ }
      }

      reviewModal.updateData({
        ...existingEditRequest,
        calendarData: {
          ...(currentData?.calendarData || {}),
          ...decomposed
        }
      });
      setIsViewingEditRequest(true);
    }
  }, [existingEditRequest, reviewModal]);

  // Toggle back to the original published event (view-only toggle, not a user edit)
  const handleViewOriginalEvent = useCallback(() => {
    if (originalEventData) {
      reviewModal.restoreData(originalEventData);
      setIsViewingEditRequest(false);
    }
  }, [originalEventData, reviewModal]);

  // Reset local state when modal closes
  useEffect(() => {
    if (!reviewModal.isOpen) {
      setIsEditRequestMode(false);
    }
  }, [reviewModal.isOpen]);

  const isRequesterOnly = !canEditEvents && !canApproveReservations;

  const loadMyReservations = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      // Load all user's reservations including deleted (API automatically filters by user)
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list?view=my-events&limit=1000&includeDeleted=true`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) throw new Error('Failed to load reservations');

      const data = await response.json();
      // Transform events to flatten calendarData fields to top-level for easier access
      const transformedReservations = transformEventsToFlatStructure(data.events || []);
      setAllReservations(transformedReservations);
      setLastFetchedAt(Date.now());
    } catch (err) {
      logger.error('Error loading user reservations:', err);
      setError('Failed to load your reservation requests');
    } finally {
      setLoading(false);
    }
  }, [apiToken]);

  // Load all user's reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadMyReservations();
    }
  }, [loadMyReservations]);

  // Listen for refresh events from other views (draft submission, approval actions, etc.)
  useDataRefreshBus('my-reservations', loadMyReservations, !!apiToken);

  // Poll for updates every 60s (silent — no loading spinner, skip while modal is open)
  const silentRefresh = useCallback(async () => {
    if (reviewModal.isOpen) return;
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/list?view=my-events&limit=1000&includeDeleted=true`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      setAllReservations(transformEventsToFlatStructure(data.events || []));
      setLastFetchedAt(Date.now());
    } catch {
      // Silently fail on poll errors
    }
  }, [apiToken, reviewModal.isOpen]);
  usePolling(silentRefresh, 300_000, !!apiToken);

  // Manual refresh handler for FreshnessIndicator
  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await loadMyReservations();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [loadMyReservations]);

  // Wrappers for hook's edit request approve/reject handlers
  const handleApproveEditRequest = useCallback(() => {
    const approverChanges = computeApproverChanges(reviewModal.editableData, originalEventData);
    return reviewModal.handleApproveEditRequest(approverChanges);
  }, [reviewModal, originalEventData]);

  const handleRejectEditRequest = useCallback(() => {
    return reviewModal.handleRejectEditRequest();
  }, []);

  // Stage 1: Apply search + date filters against all reservations
  const searchFiltered = useMemo(() => {
    let results = allReservations;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      results = results.filter(r =>
        (r.eventTitle || '').toLowerCase().includes(term) ||
        (r.requesterName || '').toLowerCase().includes(term) ||
        (r.roomReservationData?.requestedBy?.name || '').toLowerCase().includes(term) ||
        (r.department || '').toLowerCase().includes(term) ||
        (r.roomReservationData?.requestedBy?.department || '').toLowerCase().includes(term) ||
        (r.locationDisplayNames || '').toLowerCase().includes(term) ||
        (r.eventDescription || '').toLowerCase().includes(term)
      );
    }

    if (dateFrom) {
      results = results.filter(r => r.startDate >= dateFrom);
    }
    if (dateTo) {
      results = results.filter(r => r.startDate <= dateTo);
    }

    return results;
  }, [allReservations, searchTerm, dateFrom, dateTo]);

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
  const sortedReservations = useMemo(() => {
    const sorted = [...filteredReservations];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':
          return (a.startDate || '').localeCompare(b.startDate || '');
        case 'submitted_desc':
          return (b.submittedAt || '').localeCompare(a.submittedAt || '');
        case 'submitted_asc':
          return (a.submittedAt || '').localeCompare(b.submittedAt || '');
        case 'date_desc':
        default:
          return (b.startDate || '').localeCompare(a.startDate || '');
      }
    });
    return sorted;
  }, [filteredReservations, sortBy]);

  const hasActiveFilters = searchTerm || dateFrom || dateTo || statusFilter || sortBy !== 'date_desc';

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('');
    setSortBy('date_desc');
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchTerm, dateFrom, dateTo, statusFilter, sortBy]);

  // Pagination for sorted results
  const itemsPerPage = 20;
  const totalPages = Math.ceil(sortedReservations.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const paginatedReservations = sortedReservations.slice(startIndex, startIndex + itemsPerPage);

  // Status badge helper for card display
  const getStatusBadgeInfo = useCallback((reservation) => {
    if (reservation.status === 'draft') {
      return { label: 'Draft', className: 'status-draft' };
    }
    if (reservation.status === 'pending') {
      return { label: 'Pending', className: 'status-pending' };
    }
    if (reservation.status === 'published' && reservation.pendingEditRequest?.status === 'pending') {
      return { label: 'Edit Requested', className: 'status-published-edit' };
    }
    if (reservation.status === 'published') {
      return { label: 'Published', className: 'status-published' };
    }
    if (reservation.status === 'rejected') {
      return { label: 'Rejected', className: 'status-rejected' };
    }
    if (reservation.status === 'deleted') {
      return { label: 'Deleted', className: 'status-deleted' };
    }
    return { label: reservation.status, className: 'status-pending' };
  }, []);

  // Calculate days until draft auto-deletes
  const getDaysUntilDelete = (draftCreatedAt) => {
    if (!draftCreatedAt) return null;
    const createdDate = new Date(draftCreatedAt);
    const deleteDate = new Date(createdDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const daysRemaining = Math.ceil((deleteDate - now) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysRemaining);
  };

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
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/resubmit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ _version: item._version || null })
      });

      if (!response.ok) throw new Error('Failed to resubmit reservation');

      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error resubmitting reservation:', err);
      showError(err, { context: 'MyReservations.handleResubmit' });
    } finally {
      setIsResubmitting(false);
    }
  }, [reviewModal, apiToken, loadMyReservations, showError]);

  // Restore (owner, deleted events) — used by ReviewModal's onRestore button
  const handleRestore = useCallback(async () => {
    const item = reviewModal.currentItem;
    if (!item) return;

    setIsRestoring(true);
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/restore`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
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
      reviewModal.closeModal(true);
      loadMyReservations();
    } catch (err) {
      logger.error('Error restoring reservation:', err);
      showError(err, { context: 'MyReservations.handleRestore' });
    } finally {
      setIsRestoring(false);
    }
  }, [reviewModal, apiToken, loadMyReservations, showError]);

  // Edit request handlers (requester requesting edits on published events)
  const handleRequestEdit = useCallback(() => {
    // Store the original data before enabling edit mode (for inline diff)
    const currentData = reviewModal.editableData;
    if (currentData) {
      setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
    }
    setIsEditRequestMode(true);
  }, [reviewModal.editableData]);

  const handleCancelEditRequest = useCallback(() => {
    setIsEditRequestMode(false);
  }, []);

  // Wrapper for hook's handleSubmitEditRequest (no change detection in MyReservations context)
  const handleSubmitEditRequest = useCallback(() => {
    return reviewModal.handleSubmitEditRequest();
  }, [reviewModal]);

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
          const isOnBehalfOf = reservation.roomReservationData?.contactPerson?.isOnBehalfOf;
          const contactName = reservation.roomReservationData?.contactPerson?.name;
          const isDraft = reservation.status === 'draft';

          return (
            <div key={reservation._id} className={`mr-card ${isDraft ? 'mr-card-draft' : ''}`}>
              {/* Card Header - Event Title + Actions */}
              <div className="mr-card-header">
                <div className="mr-card-title-row">
                  <h3 className="mr-card-title">{reservation.isHold ? `[Hold] ${reservation.eventTitle || 'Untitled'}` : reservation.eventTitle || 'Untitled'}</h3>
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
                    {reservation.startDateTime && reservation.endDateTime ? (
                      <>
                        <span className="mr-date">
                          {new Date(reservation.startDateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <span className="mr-time">
                          {new Date(reservation.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          {' – '}
                          {new Date(reservation.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </span>
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
                    {isDraft ? 'Expires' : (reservation.status === 'rejected' && reservation.reviewNotes) ? 'Reason' : 'Last Modified'}
                  </span>
                  <div className="mr-info-value mr-status-info">
                    {isDraft && reservation.draftCreatedAt ? (
                      <span className="mr-expires">in {getDaysUntilDelete(reservation.draftCreatedAt)} days</span>
                    ) : (reservation.status === 'rejected' && reservation.reviewNotes) ? (
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

        {paginatedReservations.length === 0 && !loading && (
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

      {/* ReviewModal — unified event form (replaces old details-modal) */}
      <ReviewModal
        isOpen={reviewModal.isOpen}
        title={getModalTitle()}
        modalMode={getModalMode()}
        onClose={reviewModal.closeModal}
        // Admin/approver actions from hook
        onApprove={!isRequesterOnly ? reviewModal.handleApprove : null}
        onReject={!isRequesterOnly ? reviewModal.handleReject : null}
        onSave={!isRequesterOnly && !reviewModal.isDraft && reviewModal.currentItem?.status !== 'pending' ? reviewModal.handleSave : null}
        onDelete={(!isRequesterOnly || reviewModal.currentItem?.status === 'pending') ? reviewModal.handleDelete : null}
        // Mode and status
        mode={reviewModal.currentItem?.status === 'pending' ? 'review' : 'edit'}
        isPending={reviewModal.currentItem?.status === 'pending'}
        isFormValid={reviewModal.isFormValid}
        isSaving={reviewModal.isSaving}
        isDeleting={reviewModal.isDeleting}
        isApproving={reviewModal.isApproving}
        showActionButtons={true}
        isRequesterOnly={isRequesterOnly}
        itemStatus={reviewModal.currentItem?.status || null}
        eventVersion={reviewModal.eventVersion}
        requesterName={
          reviewModal.currentItem?.roomReservationData?.requestedBy?.name
          || reviewModal.currentItem?.calendarData?.requesterName
          || reviewModal.currentItem?.requesterName
          || ''
        }
        requesterDepartment={
          reviewModal.currentItem?.roomReservationData?.requestedBy?.department
          || reviewModal.currentItem?.calendarData?.department
          || reviewModal.currentItem?.department
          || ''
        }
        hasChanges={isEditRequestMode ? reviewModal.hasChanges : reviewModal.hasChanges}
        // Admin confirmation states from hook
        isDeleteConfirming={reviewModal.pendingDeleteConfirmation}
        onCancelDelete={reviewModal.cancelDeleteConfirmation}
        isApproveConfirming={reviewModal.pendingApproveConfirmation}
        onCancelApprove={reviewModal.cancelApproveConfirmation}
        isRejectConfirming={reviewModal.pendingRejectConfirmation}
        onCancelReject={reviewModal.cancelRejectConfirmation}
        isRejecting={reviewModal.isRejecting}
        rejectionReason={reviewModal.rejectionReason}
        onRejectionReasonChange={reviewModal.setRejectionReason}
        rejectInputRef={reviewModal.rejectInputRef}
        isSaveConfirming={reviewModal.pendingSaveConfirmation}
        onCancelSave={reviewModal.cancelSaveConfirmation}
        // Delete reason (for owner-pending delete)
        deleteReason={reviewModal.deleteReason}
        onDeleteReasonChange={reviewModal.setDeleteReason}
        deleteInputRef={reviewModal.deleteInputRef}
        // Requester action buttons
        onResubmit={isRequesterOnly && reviewModal.currentItem?.status === 'rejected' ? handleResubmit : null}
        isResubmitting={isResubmitting}
        onRestore={isRequesterOnly && reviewModal.currentItem?.status === 'deleted' ? handleRestore : null}
        isRestoring={isRestoring}
        // Owner pending edit (requester editing their own pending event)
        onSavePendingEdit={isRequesterOnly && reviewModal.currentItem?.status === 'pending' ? reviewModal.handleOwnerEdit : null}
        savingPendingEdit={reviewModal.isSavingOwnerEdit}
        // Rejected edit props (editing rejected events + resubmitting)
        onSaveRejectedEdit={isRequesterOnly && reviewModal.currentItem?.status === 'rejected' ? reviewModal.handleOwnerEdit : null}
        savingRejectedEdit={reviewModal.isSavingOwnerEdit}
        // Existing edit request props (viewing pending edit requests)
        existingEditRequest={existingEditRequest}
        isViewingEditRequest={isViewingEditRequest}
        loadingEditRequest={loadingEditRequest}
        onViewEditRequest={handleViewEditRequest}
        onViewOriginalEvent={handleViewOriginalEvent}
        // Edit request approval/rejection props (for approvers/admins)
        onApproveEditRequest={canApproveReservations ? handleApproveEditRequest : null}
        onRejectEditRequest={canApproveReservations ? handleRejectEditRequest : null}
        isApprovingEditRequest={reviewModal.isApprovingEditRequest}
        isRejectingEditRequest={reviewModal.isRejectingEditRequest}
        editRequestRejectionReason={reviewModal.editRequestRejectionReason}
        onEditRequestRejectionReasonChange={reviewModal.setEditRequestRejectionReason}
        isEditRequestApproveConfirming={reviewModal.pendingEditRequestApproveConfirmation}
        isEditRequestRejectConfirming={reviewModal.pendingEditRequestRejectConfirmation}
        onCancelEditRequestApprove={reviewModal.cancelEditRequestApproveConfirmation}
        onCancelEditRequestReject={reviewModal.cancelEditRequestRejectConfirmation}
        // Edit request props (requester requesting edits on published events)
        canRequestEdit={isRequesterOnly && reviewModal.currentItem?.status === 'published' && reviewModal.currentItem?.pendingEditRequest?.status !== 'pending' && !isEditRequestMode && !isViewingEditRequest}
        onRequestEdit={handleRequestEdit}
        isEditRequestMode={isEditRequestMode}
        onSubmitEditRequest={handleSubmitEditRequest}
        onCancelEditRequest={handleCancelEditRequest}
        isSubmittingEditRequest={reviewModal.isSubmittingEditRequest}
        detectedChanges={reviewModal.hasChanges ? [{ field: 'changes' }] : []}
        // Edit request submission via modal button
        onSubmitEditRequestModal={isEditRequestMode ? handleSubmitEditRequest : null}
        submittingEditRequestModal={reviewModal.isSubmittingEditRequest}
        // Draft props from hook
        isDraft={reviewModal.isDraft}
        onSaveDraft={reviewModal.isDraft ? reviewModal.handleSaveDraft : null}
        savingDraft={reviewModal.savingDraft}
        isDraftConfirming={reviewModal.pendingDraftConfirmation}
        onCancelDraft={reviewModal.cancelDraftConfirmation}
        canSaveDraft={reviewModal.canSaveDraft}
        showDraftDialog={reviewModal.showDraftDialog}
        onDraftDialogSave={reviewModal.handleDraftDialogSave}
        onDraftDialogDiscard={reviewModal.handleDraftDialogDiscard}
        onDraftDialogCancel={reviewModal.handleDraftDialogCancel}
        onSubmitDraft={reviewModal.isDraft ? reviewModal.handleSubmitDraft : null}
        showRecurrenceWarning={reviewModal.showRecurrenceWarning}
        onRecurrenceWarningCreateAndSave={reviewModal.handleRecurrenceWarningCreateAndSave}
        onRecurrenceWarningSaveWithout={reviewModal.handleRecurrenceWarningSaveWithout}
        onRecurrenceWarningCancel={reviewModal.handleRecurrenceWarningCancel}
        createRecurrenceRef={reviewModal.createRecurrenceRef}
        onHasUncommittedRecurrence={reviewModal.setHasUncommittedRecurrence}
        isSchedulingCheckComplete={reviewModal.isSchedulingCheckComplete}
        // Scheduling conflicts
        hasSchedulingConflicts={reviewModal.hasSchedulingConflicts}
        hasSoftConflicts={reviewModal.hasSoftConflicts}
        hasPendingReservationConflicts={reviewModal.hasPendingReservationConflicts}
        isHold={reviewModal.isHold}
        // Inline diff data (flat-transformed for comparison with formData)
        originalData={flatOriginalEventData}
      >
        {reviewModal.currentItem && (
          <RoomReservationReview
            key={reviewModal.reinitKey}
            reservation={reviewModal.editableData}
            prefetchedAvailability={reviewModal.prefetchedAvailability}
            prefetchedSeriesEvents={reviewModal.prefetchedSeriesEvents}
            apiToken={apiToken}
            onDataChange={reviewModal.updateData}
            onFormDataReady={reviewModal.setFormDataGetter}
            onFormValidChange={reviewModal.setIsFormValid}
            readOnly={!canEditEvents && !canApproveReservations && !isEditRequestMode && !reviewModal.isDraft && reviewModal.currentItem?.status !== 'pending' && reviewModal.currentItem?.status !== 'rejected'}
            editScope={reviewModal.editScope}
            onSchedulingConflictsChange={(hasConflicts, conflictInfo) => {
              reviewModal.setSchedulingConflictInfo(conflictInfo || null);
            }}
            onHoldChange={reviewModal.setIsHold}
          />
        )}
      </ReviewModal>

      {/* Conflict Dialog for version conflicts */}
      <ConflictDialog
        isOpen={!!reviewModal.conflictInfo}
        onClose={() => {
          reviewModal.dismissConflict();
          reviewModal.closeModal(true);
          loadMyReservations();
        }}
        onRefresh={() => {
          reviewModal.dismissConflict();
          reviewModal.closeModal(true);
          loadMyReservations();
        }}
        conflictType={reviewModal.conflictInfo?.conflictType}
        eventTitle={reviewModal.conflictInfo?.eventTitle}
        details={reviewModal.conflictInfo?.details}
        staleData={reviewModal.conflictInfo?.staleData}
      />

      {/* Soft Conflict Confirmation Dialog */}
      {reviewModal.softConflictConfirmation && (
        <ConflictDialog
          isOpen={true}
          onClose={reviewModal.dismissSoftConflictConfirmation}
          onConfirm={reviewModal.softConflictConfirmation.retryFn}
          conflictType="soft_conflict"
          eventTitle={reviewModal.currentItem?.eventTitle || 'Event'}
          details={{ message: reviewModal.softConflictConfirmation.message }}
        />
      )}

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
