// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import DatePickerInput from './DatePickerInput';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { useReviewModal } from '../hooks/useReviewModal';
import { usePolling } from '../hooks/usePolling';
import { dispatchRefresh, useDataRefreshBus } from '../hooks/useDataRefreshBus';
import { transformEventToFlatStructure, transformEventsToFlatStructure } from '../utils/eventTransformers';
import { computeApproverChanges } from '../utils/editRequestUtils';
import LoadingSpinner from './shared/LoadingSpinner';
import RoomReservationReview from './RoomReservationReview';
import ReviewModal from './shared/ReviewModal';
import EditRequestComparison from './EditRequestComparison';
import ConflictDialog from './shared/ConflictDialog';
import DiscardChangesDialog from './shared/DiscardChangesDialog';
import FreshnessIndicator from './shared/FreshnessIndicator';
import './shared/FilterBar.css';
import './ReservationRequests.css';

export default function ReservationRequests({ apiToken, graphToken }) {
  // Permission check for Approver/Admin role
  const { canApproveReservations, isAdmin, permissionsLoading } = usePermissions();
  const { showError, showSuccess, showWarning } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('needs_attention');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
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

  // Feature flag: Toggle between old and new review form
  const [useUnifiedForm, setUseUnifiedForm] = useState(true);

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

  // Edit request state (in-ReviewModal viewing/management — matches Calendar.jsx)
  const [existingEditRequest, setExistingEditRequest] = useState(null);
  const [isViewingEditRequest, setIsViewingEditRequest] = useState(false);
  const [loadingEditRequest, setLoadingEditRequest] = useState(false);
  const [originalEventData, setOriginalEventData] = useState(null);
  // Transform originalEventData to flat structure for inline diff comparison
  const flatOriginalEventData = useMemo(() =>
    originalEventData ? transformEventToFlatStructure(originalEventData) : null,
  [originalEventData]);
  const [isApprovingEditRequestInModal, setIsApprovingEditRequestInModal] = useState(false);
  const [isRejectingEditRequestInModal, setIsRejectingEditRequestInModal] = useState(false);
  const [modalEditRequestRejectionReason, setModalEditRequestRejectionReason] = useState('');
  const [isEditRequestApproveConfirming, setIsEditRequestApproveConfirming] = useState(false);
  const [isEditRequestRejectConfirming, setIsEditRequestRejectConfirming] = useState(false);

  // Use room context for efficient room name resolution
  const { getRoomName, getRoomDetails, loading: roomsLoading } = useRooms();

  // useReviewModal hook — replaces ~17 manual state vars and ~10 handlers
  const reviewModal = useReviewModal({
    apiToken,
    graphToken,
    selectedCalendarId: selectedTargetCalendar || defaultCalendar,
    onSuccess: (result) => {
      loadReservations();
      if (result?.recurringConflicts?.conflictingOccurrences > 0) {
        const rc = result.recurringConflicts;
        showWarning(`Event published. ${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrences have room conflicts.`);
      }
    },
    onError: (error) => { showError(error, { context: 'ReservationRequests' }); }
  });

  // Load calendar settings on mount
  useEffect(() => {
    if (apiToken) {
      loadCalendarSettings();
    }
  }, [apiToken]);

  // Load all reservations once on mount
  useEffect(() => {
    if (apiToken) {
      loadReservations();
    }
  }, [apiToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCalendarSettings = async () => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/calendar-settings`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

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

  const loadReservations = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
        setError('');
      }

      // Load all reservations at once (small dataset, <100 items typically)
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/events/list?view=approval-queue&limit=1000`,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load room reservation events');
      }

      const data = await response.json();

      // Transform events using shared utility (single source of truth)
      const transformedEvents = transformEventsToFlatStructure(data.events || []);

      logger.info('Loaded room reservation events:', {
        count: transformedEvents.length
      });

      setAllReservations(transformedEvents);
      setLastFetchedAt(Date.now());
    } catch (err) {
      logger.error('Error loading reservations:', err);
      if (!silent) {
        setError('Failed to load reservation requests');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [apiToken]);

  // Poll for new reservations every 60s (silent — no loading spinner)
  const silentRefresh = useCallback(() => loadReservations({ silent: true }), [loadReservations]);
  usePolling(silentRefresh, 60_000, !!apiToken);

  // Listen for refresh events from other views
  useDataRefreshBus('approval-queue', silentRefresh, !!apiToken);

  // Manual refresh handler for FreshnessIndicator
  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await loadReservations();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [loadReservations]);

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

  // Stage 2: Apply tab status filter + status dropdown filter
  const filteredReservations = useMemo(() => {
    let results = searchFiltered;

    if (activeTab === 'needs_attention') {
      results = results.filter(r =>
        r.status === 'pending' ||
        r.status === 'room-reservation-request' ||
        (r.status === 'published' && r.pendingEditRequest?.status === 'pending')
      );
    }

    if (statusFilter) {
      results = results.filter(r => {
        switch (statusFilter) {
          case 'pending':
            return r.status === 'pending' || r.status === 'room-reservation-request';
          case 'published':
            return r.status === 'published' && r.pendingEditRequest?.status !== 'pending';
          case 'published_edit':
            return r.status === 'published' && r.pendingEditRequest?.status === 'pending';
          case 'rejected':
            return r.status === 'rejected';
          default:
            return true;
        }
      });
    }

    return results;
  }, [searchFiltered, activeTab, statusFilter]);

  // Compute tab counts from search-filtered results (counts reflect active search/date filters)
  const statusCounts = useMemo(() => ({
    needs_attention: searchFiltered.filter(r =>
      r.status === 'pending' ||
      r.status === 'room-reservation-request' ||
      (r.status === 'published' && r.pendingEditRequest?.status === 'pending')
    ).length,
    all: searchFiltered.length,
  }), [searchFiltered]);

  // Sort filtered results
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

  // Load edit requests (for admin review)
  const loadEditRequests = async () => {
    try {
      setEditRequestsLoading(true);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/edit-requests?status=all`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

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

  // Handle tab changes - no API call, filtering is client-side
  const handleTabChange = useCallback((newTab) => {
    setActiveTab(newTab);
    setPage(1);
  }, []);

  // Handle page changes - no API call, pagination is client-side
  const handlePageChange = useCallback((newPage) => {
    setPage(newPage);
  }, []);

  // Reset to page 1 when search/date/status filters change
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

  // Status badge helper for card display
  const getStatusBadgeInfo = useCallback((reservation) => {
    if (reservation.status === 'pending' || reservation.status === 'room-reservation-request') {
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
    return { label: reservation.status, className: 'status-pending' };
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

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${selectedEditRequest._id}/publish-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            notes
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve edit request');
      }

      logger.info('Edit request approved:', selectedEditRequest._id);

      // Refresh edit requests
      await loadEditRequests();

      // Close modal
      closeEditRequestModal();

      // Notify MyReservations to refresh
      dispatchRefresh('reservation-requests');

      // Show success message
      showSuccess('Edit request approved. Changes have been applied to the original event.');

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
      showWarning('Please provide a reason for rejecting the edit request.');
      return;
    }

    try {
      setRejectingEditRequest(true);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${selectedEditRequest._id}/reject-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            reason: editRequestRejectionReason.trim()
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject edit request');
      }

      logger.info('Edit request rejected:', selectedEditRequest._id);

      // Refresh edit requests
      await loadEditRequests();

      // Close modal
      closeEditRequestModal();

      // Notify MyReservations to refresh
      dispatchRefresh('reservation-requests');

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

  // =========================================================================
  // IN-MODAL EDIT REQUEST VIEWING/MANAGEMENT (Calendar.jsx gold standard)
  // =========================================================================

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

  // Scheduling conflict reset handled by reviewModal.openModal() synchronously

  // Check for existing edit requests when ReviewModal opens with a published event
  useEffect(() => {
    if (reviewModal.isOpen && reviewModal.currentItem?.status === 'published') {
      const editRequest = fetchExistingEditRequest(reviewModal.currentItem);
      setExistingEditRequest(editRequest);
    } else if (!reviewModal.isOpen) {
      setExistingEditRequest(null);
      setIsViewingEditRequest(false);
      setOriginalEventData(null);
      setIsEditRequestApproveConfirming(false);
      setIsEditRequestRejectConfirming(false);
      setModalEditRequestRejectionReason('');
    }
  }, [reviewModal.isOpen, reviewModal.currentItem, fetchExistingEditRequest]);

  // View the edit request data in the form
  const handleViewEditRequest = useCallback(() => {
    if (existingEditRequest) {
      const currentData = reviewModal.editableData;
      if (currentData) {
        setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
      }
      // Spread proposed changes into calendarData so getField() in
      // transformEventToFlatStructure picks up proposed values (it
      // prioritizes calendarData over top-level fields)
      const proposedChanges = existingEditRequest.proposedChanges || {};
      reviewModal.updateData({
        ...existingEditRequest,
        calendarData: {
          ...(currentData?.calendarData || {}),
          ...proposedChanges
        }
      });
      setIsViewingEditRequest(true);
    }
  }, [existingEditRequest, reviewModal]);

  // Toggle back to the original published event
  const handleViewOriginalEvent = useCallback(() => {
    if (originalEventData) {
      reviewModal.updateData(originalEventData);
      setIsViewingEditRequest(false);
    }
  }, [originalEventData, reviewModal]);

  // Approve edit request from within ReviewModal (admin only)
  const handleApproveEditRequestInModal = useCallback(async () => {
    if (!isEditRequestApproveConfirming) {
      setIsEditRequestApproveConfirming(true);
      return;
    }

    const currentItem = reviewModal.currentItem;
    if (!currentItem || !existingEditRequest) {
      logger.error('No edit request to approve');
      return;
    }

    try {
      setIsApprovingEditRequestInModal(true);
      const eventId = currentItem._id || currentItem.eventId;

      // Compute approver's modifications (compares current form state against original published event)
      const approverChanges = computeApproverChanges(reviewModal.editableData, originalEventData);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/publish-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({ notes: '', ...(approverChanges && { approverChanges }) })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve edit request');
      }

      setIsEditRequestApproveConfirming(false);
      setIsViewingEditRequest(false);
      setExistingEditRequest(null);
      setOriginalEventData(null);
      reviewModal.closeModal();
      loadReservations();
      dispatchRefresh('reservation-requests');
      showSuccess('Edit request approved. Changes have been applied.');
    } catch (error) {
      logger.error('Error approving edit request:', error);
      showError(error, { context: 'ReservationRequests.approveEditRequestInModal', userMessage: 'Failed to approve edit request' });
    } finally {
      setIsApprovingEditRequestInModal(false);
      setIsEditRequestApproveConfirming(false);
    }
  }, [isEditRequestApproveConfirming, reviewModal, existingEditRequest, originalEventData, apiToken, graphToken, loadReservations, showSuccess, showError]);

  // Reject edit request from within ReviewModal (admin only)
  const handleRejectEditRequestInModal = useCallback(async () => {
    if (!isEditRequestRejectConfirming) {
      setIsEditRequestRejectConfirming(true);
      return;
    }

    if (!modalEditRequestRejectionReason.trim()) {
      showWarning('Please provide a reason for rejecting the edit request.');
      return;
    }

    const currentItem = reviewModal.currentItem;
    if (!currentItem || !existingEditRequest) {
      logger.error('No edit request to reject');
      return;
    }

    try {
      setIsRejectingEditRequestInModal(true);
      const eventId = currentItem._id || currentItem.eventId;

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/reject-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({ reason: modalEditRequestRejectionReason.trim() })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject edit request');
      }

      setIsEditRequestRejectConfirming(false);
      setModalEditRequestRejectionReason('');
      setIsViewingEditRequest(false);
      setExistingEditRequest(null);
      setOriginalEventData(null);
      reviewModal.closeModal();
      loadReservations();
      dispatchRefresh('reservation-requests');
      showSuccess('Edit request rejected.');
    } catch (error) {
      logger.error('Error rejecting edit request:', error);
      showError(error, { context: 'ReservationRequests.rejectEditRequestInModal', userMessage: 'Failed to reject edit request' });
    } finally {
      setIsRejectingEditRequestInModal(false);
      setIsEditRequestRejectConfirming(false);
    }
  }, [isEditRequestRejectConfirming, modalEditRequestRejectionReason, reviewModal, existingEditRequest, apiToken, loadReservations, showSuccess, showError, showWarning]);

  const cancelEditRequestApproveConfirmation = useCallback(() => {
    setIsEditRequestApproveConfirming(false);
  }, []);

  const cancelEditRequestRejectConfirmation = useCallback(() => {
    setIsEditRequestRejectConfirming(false);
    setModalEditRequestRejectionReason('');
  }, []);

  // =========================================================================
  // END IN-MODAL EDIT REQUEST HANDLERS
  // =========================================================================

  // Handle locked event click from SchedulingAssistant
  const handleLockedEventClick = async (reservationId) => {
    logger.debug('[ReservationRequests] Locked event clicked:', reservationId);

    // Find the reservation in our list
    const targetReservation = allReservations.find(r => r._id === reservationId);

    if (!targetReservation) {
      logger.error('[ReservationRequests] Could not find reservation with ID:', reservationId);
      showWarning('Could not find the selected reservation. It may have been deleted.');
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

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          graphToken: hasGraphData ? graphToken : undefined,
          calendarId: reservation.calendarId,
          _version: reservation._version || null
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete reservation: ${response.status} ${errorText}`);
      }

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id
          ? { ...r, status: 'deleted', isDeleted: true }
          : r
      ));

      showSuccess(`Reservation "${reservation.eventTitle}" deleted successfully`);

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
            <span className="count">({statusCounts.needs_attention})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All Requests
            <span className="count">({statusCounts.all})</span>
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
              <option value="published">Published</option>
              <option value="published_edit">Edit Requested</option>
              <option value="rejected">Rejected</option>
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
          const department = reservation.roomReservationData?.requestedBy?.department || reservation.department;
          const isOnBehalfOf = reservation.roomReservationData?.contactPerson?.isOnBehalfOf || reservation.isOnBehalfOf;
          const contactName = reservation.roomReservationData?.contactPerson?.name || reservation.contactName;

          return (
            <div key={reservation._id} className="rr-card">
              {/* Card Header - Event Title + Actions */}
              <div className="rr-card-header">
                <div className="rr-card-title-row">
                  <h3 className="rr-card-title">{reservation.isHold ? `[Hold] ${reservation.eventTitle}` : reservation.eventTitle}</h3>
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
                    <span className="rr-date">{new Date(reservation.startDateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    <span className="rr-time">
                      {new Date(reservation.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {' – '}
                      {new Date(reservation.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
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
                    {department && <span className="rr-requester-dept">{department}</span>}
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

        {paginatedReservations.length === 0 && !loading && (
          <div className="rr-empty-state">
            <div className="rr-empty-icon">
              {hasActiveFilters ? '🔍' : activeTab === 'needs_attention' ? '✓' : '📁'}
            </div>
            <h3>{hasActiveFilters ? 'No matching requests' : activeTab === 'needs_attention' ? 'All caught up!' : 'No requests'}</h3>
            <p>
              {hasActiveFilters
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
          onClose={closeEditRequestModal}
          onApprove={handleApproveEditRequest}
          onReject={handleRejectEditRequest}
          rejectionReason={editRequestRejectionReason}
          onRejectionReasonChange={setEditRequestRejectionReason}
          isApproving={approvingEditRequest}
          isRejecting={rejectingEditRequest}
        />
      )}

      {/* Review Modal — powered by useReviewModal hook (Calendar.jsx gold standard) */}
      <ReviewModal
        isOpen={reviewModal.isOpen}
        title={`${reviewModal.currentItem?.status === 'pending' ? 'Review' : 'Edit'} ${reviewModal.editableData?.eventTitle || 'Reservation Request'}`}
        onClose={reviewModal.closeModal}
        onApprove={reviewModal.handleApprove}
        onReject={reviewModal.handleReject}
        onSave={reviewModal.currentItem?.status === 'pending' ? null : reviewModal.handleSave}
        onDelete={reviewModal.handleDelete}
        mode={reviewModal.currentItem?.status === 'pending' ? 'review' : 'edit'}
        isPending={reviewModal.currentItem?.status === 'pending'}
        isFormValid={reviewModal.isFormValid}
        isSaving={reviewModal.isSaving}
        isDeleting={reviewModal.isDeleting}
        isApproving={reviewModal.isApproving}
        showActionButtons={true}
        itemStatus={reviewModal.currentItem?.status}
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
        hasChanges={reviewModal.hasChanges}
        // Confirmation states from hook
        isDeleteConfirming={reviewModal.pendingDeleteConfirmation}
        onCancelDelete={reviewModal.cancelDeleteConfirmation}
        isApproveConfirming={reviewModal.pendingApproveConfirmation}
        onCancelApprove={reviewModal.cancelApproveConfirmation}
        isRejectConfirming={reviewModal.pendingRejectConfirmation}
        onCancelReject={reviewModal.cancelRejectConfirmation}
        isRejecting={reviewModal.isRejecting}
        rejectionReason={reviewModal.rejectionReason}
        onRejectionReasonChange={reviewModal.setRejectionReason}
        isSaveConfirming={reviewModal.pendingSaveConfirmation}
        onCancelSave={reviewModal.cancelSaveConfirmation}
        // Existing edit request props (viewing pending edit requests)
        existingEditRequest={existingEditRequest}
        isViewingEditRequest={isViewingEditRequest}
        loadingEditRequest={loadingEditRequest}
        onViewEditRequest={handleViewEditRequest}
        onViewOriginalEvent={handleViewOriginalEvent}
        // Edit request approval/rejection (admin)
        onApproveEditRequest={canApproveReservations ? handleApproveEditRequestInModal : null}
        onRejectEditRequest={canApproveReservations ? handleRejectEditRequestInModal : null}
        isApprovingEditRequest={isApprovingEditRequestInModal}
        isRejectingEditRequest={isRejectingEditRequestInModal}
        editRequestRejectionReason={modalEditRequestRejectionReason}
        onEditRequestRejectionReasonChange={setModalEditRequestRejectionReason}
        isEditRequestApproveConfirming={isEditRequestApproveConfirming}
        isEditRequestRejectConfirming={isEditRequestRejectConfirming}
        onCancelEditRequestApprove={cancelEditRequestApproveConfirmation}
        onCancelEditRequestReject={cancelEditRequestRejectConfirmation}
        // Scheduling conflicts
        isSchedulingCheckComplete={reviewModal.isSchedulingCheckComplete}
        hasSchedulingConflicts={reviewModal.hasSchedulingConflicts}
        hasSoftConflicts={reviewModal.hasSoftConflicts}
        hasPendingReservationConflicts={reviewModal.hasPendingReservationConflicts}
        isHold={reviewModal.isHold}
        // Recurring event data (for Conflicts tab)
        reservation={reviewModal.currentItem}
        // Inline diff data (flat-transformed for comparison with formData)
        originalData={flatOriginalEventData}
        // Form toggle
        showFormToggle={true}
        useUnifiedForm={useUnifiedForm}
        onFormToggle={() => setUseUnifiedForm(!useUnifiedForm)}
      >
        {reviewModal.currentItem && (
          <RoomReservationReview
            reservation={reviewModal.editableData}
            prefetchedAvailability={reviewModal.prefetchedAvailability}
            apiToken={apiToken}
            graphToken={graphToken}
            onDataChange={reviewModal.updateData}
            onFormDataReady={reviewModal.setFormDataGetter}
            onFormValidChange={reviewModal.setIsFormValid}
            onLockedEventClick={handleLockedEventClick}
            availableCalendars={availableCalendars}
            defaultCalendar={defaultCalendar}
            selectedTargetCalendar={selectedTargetCalendar}
            onTargetCalendarChange={setSelectedTargetCalendar}
            createCalendarEvent={createCalendarEvent}
            onCreateCalendarEventChange={setCreateCalendarEvent}
            onHoldChange={reviewModal.setIsHold}
            onSchedulingConflictsChange={(hasConflicts, conflictInfo) => {
              reviewModal.setSchedulingConflictInfo(conflictInfo || null);
            }}
          />
        )}
      </ReviewModal>

      {/* Conflict Dialog for 409 version conflicts */}
      <ConflictDialog
        isOpen={!!reviewModal.conflictInfo}
        onClose={() => {
          reviewModal.dismissConflict();
          reviewModal.closeModal(true);
          loadReservations();
        }}
        onRefresh={() => {
          reviewModal.dismissConflict();
          reviewModal.closeModal(true);
          loadReservations();
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
