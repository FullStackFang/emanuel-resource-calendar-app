// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { useReviewModal } from '../hooks/useReviewModal';
import { transformEventToFlatStructure, transformEventsToFlatStructure } from '../utils/eventTransformers';
import LoadingSpinner from './shared/LoadingSpinner';
import RoomReservationReview from './RoomReservationReview';
import ReviewModal from './shared/ReviewModal';
import EditRequestComparison from './EditRequestComparison';
import ConflictDialog from './shared/ConflictDialog';
import './ReservationRequests.css';

export default function ReservationRequests({ apiToken, graphToken }) {
  // Permission check for Approver/Admin role
  const { canApproveReservations, isAdmin, permissionsLoading } = usePermissions();
  const { showError, showSuccess, showWarning } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

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

  // Scheduling conflict state (from SchedulingAssistant via RoomReservationReview)
  const [hasSchedulingConflicts, setHasSchedulingConflicts] = useState(false);

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
    onSuccess: () => { loadReservations(); },
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

  const loadReservations = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

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
    } catch (err) {
      logger.error('Error loading reservations:', err);
      setError('Failed to load reservation requests');
    } finally {
      setLoading(false);
    }
  }, [apiToken]);

  // Client-side filtering based on active tab
  const filteredReservations = useMemo(() => {
    if (activeTab === 'all') {
      return allReservations;
    }
    if (activeTab === 'pending') {
      return allReservations.filter(r => r.status === 'pending' || r.status === 'room-reservation-request');
    }
    if (activeTab === 'published') {
      return allReservations.filter(r =>
        r.status === 'published' &&
        (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
      );
    }
    if (activeTab === 'published_edit') {
      return allReservations.filter(r =>
        r.status === 'published' &&
        r.pendingEditRequest?.status === 'pending'
      );
    }
    if (activeTab === 'rejected') {
      return allReservations.filter(r => r.status === 'rejected');
    }
    return allReservations.filter(r => r.status === activeTab);
  }, [allReservations, activeTab]);

  // Compute tab counts client-side
  const statusCounts = useMemo(() => ({
    all: allReservations.length,
    pending: allReservations.filter(r => r.status === 'pending' || r.status === 'room-reservation-request').length,
    published: allReservations.filter(r =>
      r.status === 'published' &&
      (!r.pendingEditRequest || r.pendingEditRequest.status !== 'pending')
    ).length,
    published_edit: allReservations.filter(r =>
      r.status === 'published' &&
      r.pendingEditRequest?.status === 'pending'
    ).length,
    rejected: allReservations.filter(r => r.status === 'rejected').length,
  }), [allReservations]);

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
        proposedChanges: req.editRequestData?.proposedChanges || [],
        originalSnapshot: req.editRequestData?.originalSnapshot || {},
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
  const totalPages = Math.ceil(filteredReservations.length / PAGE_SIZE);
  const startIndex = (page - 1) * PAGE_SIZE;
  const paginatedReservations = filteredReservations.slice(startIndex, startIndex + PAGE_SIZE);

  // Handle tab changes - no API call, filtering is client-side
  const handleTabChange = useCallback((newTab) => {
    setActiveTab(newTab);
    setPage(1);
  }, []);

  // Handle page changes - no API call, pagination is client-side
  const handlePageChange = useCallback((newPage) => {
    setPage(newPage);
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
        `${APP_CONFIG.API_BASE_URL}/admin/events/${selectedEditRequest._id}/approve-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({
            notes,
            graphToken // Pass Graph token for calendar update
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
          originalValues: pendingReq.originalValues,
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
          setupTime: pendingReq.proposedChanges?.setupTime || getEventField(event, 'setupTime', ''),
          teardownTime: pendingReq.proposedChanges?.teardownTime || getEventField(event, 'teardownTime', ''),
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
      reviewModal.updateData(existingEditRequest);
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

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/approve-edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify({ notes: '', graphToken })
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
      showSuccess('Edit request approved. Changes have been applied.');
    } catch (error) {
      logger.error('Error approving edit request:', error);
      showError(error, { context: 'ReservationRequests.approveEditRequestInModal', userMessage: 'Failed to approve edit request' });
    } finally {
      setIsApprovingEditRequestInModal(false);
      setIsEditRequestApproveConfirming(false);
    }
  }, [isEditRequestApproveConfirming, reviewModal, existingEditRequest, apiToken, graphToken, loadReservations, showSuccess, showError]);

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

    // Check if there are unsaved changes
    if (reviewModal.hasChanges) {
      const confirmMessage = `You have unsaved changes to the current reservation.\n\n` +
                            `If you navigate to "${targetReservation.eventTitle}", your changes will be lost.\n\n` +
                            `Do you want to continue?`;

      if (!window.confirm(confirmMessage)) {
        logger.debug('[ReservationRequests] Navigation cancelled - user chose to stay');
        return;
      }
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
    return <LoadingSpinner />;
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
    return <LoadingSpinner />;
  }

  return (
    <div className="reservation-requests">
      {/* Page Header */}
      <div className="rr-page-header">
        <div className="rr-header-content">
          <h1>Approval Queue</h1>
          <p className="rr-header-subtitle">Review and manage reservation requests</p>
        </div>
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
            className={`event-type-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All Requests
            <span className="count">({statusCounts.all})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => handleTabChange('pending')}
          >
            Pending
            <span className="count">({statusCounts.pending})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'published' ? 'active' : ''}`}
            onClick={() => handleTabChange('published')}
          >
            Published
            <span className="count">({statusCounts.published})</span>
          </button>
          <button
            className={`event-type-tab published-edit-tab ${activeTab === 'published_edit' ? 'active' : ''}`}
            onClick={() => handleTabChange('published_edit')}
          >
            Published Edit
            <span className="count">({statusCounts.published_edit})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'rejected' ? 'active' : ''}`}
            onClick={() => handleTabChange('rejected')}
          >
            Rejected
            <span className="count">({statusCounts.rejected})</span>
          </button>
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
                  <h3 className="rr-card-title">{reservation.eventTitle}</h3>
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
                    {new Date(reservation.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
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
              {activeTab === 'pending' ? '📋' : activeTab === 'published' ? '✅' : activeTab === 'rejected' ? '❌' : '📁'}
            </div>
            <h3>No {activeTab === 'all' ? '' : activeTab} requests</h3>
            <p>
              {activeTab === 'pending'
                ? 'All caught up! No pending requests to review.'
                : activeTab === 'published'
                ? 'No published reservations yet.'
                : activeTab === 'rejected'
                ? 'No rejected reservations.'
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
        hasSchedulingConflicts={hasSchedulingConflicts}
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
            onSchedulingConflictsChange={setHasSchedulingConflicts}
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
    </div>
  );
}
