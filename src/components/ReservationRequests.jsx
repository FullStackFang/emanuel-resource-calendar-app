// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { transformEventToFlatStructure, transformEventsToFlatStructure } from '../utils/eventTransformers';
import LoadingSpinner from './shared/LoadingSpinner';
import RoomReservationReview from './RoomReservationReview';
import UnifiedEventForm from './UnifiedEventForm';
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
  const [actionNotes, setActionNotes] = useState('');
  const PAGE_SIZE = 20;

  // Calendar event creation settings
  const [calendarMode, setCalendarMode] = useState(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
  const [createCalendarEvent, setCreateCalendarEvent] = useState(true);
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [defaultCalendar, setDefaultCalendar] = useState('');
  const [selectedTargetCalendar, setSelectedTargetCalendar] = useState('');

  // Editable form state
  const [editableData, setEditableData] = useState(null);
  const [eventVersion, setEventVersion] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isFormValid, setIsFormValid] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Child component's save function (exposed via callback)
  const childSaveFunctionRef = useRef(null);

  // Memoized callback for receiving the save function from child
  const handleSaveFunctionReady = useCallback((saveFunc) => {
    childSaveFunctionRef.current = saveFunc;
  }, []);

  // Conflict detection state
  const [forcePublish, setForcePublish] = useState(false);

  // Feature flag: Toggle between old and new review form
  // Default to UnifiedEventForm to match the draft edit form in MyReservations
  const [useUnifiedForm, setUseUnifiedForm] = useState(true);

  // Details modal state (lightweight info modal before full review)
  const [selectedDetailsReservation, setSelectedDetailsReservation] = useState(null);

  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState(null);

  // Delete state
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Approval confirmation state (for ReviewModal)
  const [isApproving, setIsApproving] = useState(false);
  const [isApproveConfirming, setIsApproveConfirming] = useState(false);

  // Rejection confirmation state (for ReviewModal)
  const [isRejecting, setIsRejecting] = useState(false);
  const [isRejectConfirming, setIsRejectConfirming] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // Delete confirmation state (for ReviewModal - separate from card delete)
  const [isModalDeleting, setIsModalDeleting] = useState(false);
  const [isModalDeleteConfirming, setIsModalDeleteConfirming] = useState(false);

  // Scheduling conflict state (from SchedulingAssistant via RoomReservationReview)
  const [hasSchedulingConflicts, setHasSchedulingConflicts] = useState(false);

  // Edit request state
  const [editRequests, setEditRequests] = useState([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
  const [selectedEditRequest, setSelectedEditRequest] = useState(null);
  const [showEditRequestModal, setShowEditRequestModal] = useState(false);
  const [approvingEditRequest, setApprovingEditRequest] = useState(false);
  const [rejectingEditRequest, setRejectingEditRequest] = useState(false);
  const [editRequestRejectionReason, setEditRequestRejectionReason] = useState('');

  // Conflict dialog state
  const [conflictDialog, setConflictDialog] = useState({ isOpen: false, conflictType: 'data_changed', details: {} });

  // Use room context for efficient room name resolution
  const { getRoomName, getRoomDetails, loading: roomsLoading } = useRooms();
  
  
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

      logger.debug('🔧 TRANSFORMED EVENT (first event) - Series fields:', {
        eventId: transformedEvents?.[0]?.eventId,
        hasEventSeriesId: !!transformedEvents?.[0]?.eventSeriesId,
        eventSeriesId: transformedEvents?.[0]?.eventSeriesId,
        seriesIndex: transformedEvents?.[0]?.seriesIndex,
        seriesLength: transformedEvents?.[0]?.seriesLength
      });

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

  // Legacy alias for compatibility
  const loadAllReservations = useCallback(() => {
    return loadReservations();
  }, [loadReservations]);

  // Client-side filtering based on active tab
  const filteredReservations = useMemo(() => {
    if (activeTab === 'all') {
      return allReservations.filter(r => r.status !== 'deleted' && !r.isDeleted);
    }
    if (activeTab === 'pending') {
      return allReservations.filter(r => r.status === 'pending' || r.status === 'room-reservation-request');
    }
    if (activeTab === 'published') {
      return allReservations.filter(r => r.status === 'published');
    }
    if (activeTab === 'cancelled') {
      return allReservations.filter(r => r.status === 'cancelled');
    }
    if (activeTab === 'deleted') {
      return allReservations.filter(r => r.status === 'deleted' || r.isDeleted);
    }
    return allReservations.filter(r => r.status === activeTab);
  }, [allReservations, activeTab]);

  // Compute tab counts client-side
  const statusCounts = useMemo(() => ({
    all: allReservations.filter(r => r.status !== 'deleted' && !r.isDeleted).length,
    pending: allReservations.filter(r => r.status === 'pending' || r.status === 'room-reservation-request').length,
    published: allReservations.filter(r => r.status === 'published').length,
    cancelled: allReservations.filter(r => r.status === 'cancelled').length,
    deleted: allReservations.filter(r => r.status === 'deleted' || r.isDeleted).length,
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

  // Note: Edit requests functionality preserved but tab removed from UI
  // Edit requests can be managed through other admin interfaces if needed

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

  // Open review modal (using ReviewModal component)
  const openReviewModal = async (reservation) => {
    // Initialize editable data (includes all fields needed for conflict diff)
    setEditableData({
      eventTitle: reservation.eventTitle || '',
      eventDescription: reservation.eventDescription || '',
      startDateTime: reservation.startDateTime,
      endDateTime: reservation.endDateTime,
      startDate: reservation.startDate || '',
      startTime: reservation.startTime || '',
      endDate: reservation.endDate || '',
      endTime: reservation.endTime || '',
      setupTime: reservation.setupTime || '',
      teardownTime: reservation.teardownTime || '',
      doorOpenTime: reservation.doorOpenTime || '',
      doorCloseTime: reservation.doorCloseTime || '',
      setupTimeMinutes: reservation.setupTimeMinutes || 0,
      teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
      attendeeCount: reservation.attendeeCount || 0,
      requestedRooms: reservation.requestedRooms || [],
      locationDisplayNames: reservation.locationDisplayNames || '',
      categories: reservation.categories || [],
      specialRequirements: reservation.specialRequirements || '',
      status: reservation.status || '',
      requesterName: reservation.roomReservationData?.requestedBy?.name || reservation.requesterName || '',
      requesterEmail: reservation.roomReservationData?.requestedBy?.email || reservation.requesterEmail || '',
      contactName: reservation.roomReservationData?.contactPerson?.name || reservation.contactName || '',
      contactEmail: reservation.roomReservationData?.contactPerson?.email || reservation.contactEmail || '',
      phone: reservation.roomReservationData?.requestedBy?.phone || reservation.phone || '',
      department: reservation.roomReservationData?.requestedBy?.department || reservation.department || '',
      sponsoredBy: reservation.sponsoredBy || '',
      isOnBehalfOf: reservation.roomReservationData?.contactPerson?.isOnBehalfOf || reservation.isOnBehalfOf || false
    });

    setEventVersion(reservation._version || null);
    setHasChanges(false);

    logger.debug('📦 OPENING REVIEW MODAL - Reservation Object:', {
      eventId: reservation.eventId,
      hasEventSeriesId: !!reservation.eventSeriesId,
      eventSeriesId: reservation.eventSeriesId,
      seriesIndex: reservation.seriesIndex,
      seriesLength: reservation.seriesLength,
      fullObject: reservation
    });

    setSelectedReservation(reservation);
    setShowReviewModal(true);
  };

  // Close review modal
  const closeReviewModal = async () => {
    setShowReviewModal(false);
    setSelectedReservation(null);
    setEditableData(null);
    setEventVersion(null);
    setHasChanges(false);
    setActionNotes('');
    setCalendarMode(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
    setCreateCalendarEvent(true);
    setForcePublish(false);
    // Reset confirmation states
    setIsApproveConfirming(false);
    setIsRejectConfirming(false);
    setRejectionReason('');
    setIsModalDeleteConfirming(false);
  };

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
  // END EDIT REQUEST HANDLERS
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
    if (hasChanges) {
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
    await closeReviewModal();

    // Small delay to ensure cleanup completes
    setTimeout(() => {
      openReviewModal(targetReservation);
    }, 100);
  };

  // Handle field changes in editable form
  const handleFieldChange = (field, value) => {
    setEditableData(prev => ({
      ...prev,
      [field]: value
    }));
    setHasChanges(true);
  };

  // Save changes with version validation
  // This function is now mainly called as a callback from RoomReservationReview
  // RoomReservationReview handles the actual API call and passes the result here
  const handleSaveChanges = async (result) => {
    // If result is null, it's a conflict-triggered refresh request
    if (result === null) {
      await loadAllReservations();
      closeReviewModal();
      return;
    }

    // If result is provided, it means RoomReservationReview already saved
    // Just update our local state with the new version and refresh the data
    if (result && result._version) {
      logger.debug('Updating reservation data after save:', result);

      setEventVersion(result._version);
      setHasChanges(false);

      // Update the selected reservation with the saved data (transform to flat structure)
      if (result.reservation) {
        logger.debug('Updating selectedReservation with saved data');
        const flatReservation = transformEventToFlatStructure(result.reservation);
        setSelectedReservation(flatReservation);

        // Also update the reservation in allReservations array
        setAllReservations(prev => {
          return prev.map(res =>
            res._id === result.reservation._id ? flatReservation : res
          );
        });
      }

      setError('Changes saved successfully');
      setTimeout(() => setError(''), 3000);
      return;
    }
  };
  
  // Handle approve click - two-click confirmation pattern
  const handleApproveClick = (reservation) => {
    if (isApproveConfirming) {
      // Already in confirm state, proceed with approve
      handleApprove(reservation);
    } else {
      // First click - enter confirm state
      setIsApproveConfirming(true);
      // Auto-reset after 3 seconds if not confirmed
      setTimeout(() => {
        setIsApproveConfirming(false);
      }, 3000);
    }
  };

  const handleApprove = async (reservation) => {
    try {
      setIsApproving(true);
      setIsApproveConfirming(false);
      logger.debug('🚀 Starting reservation approval process:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle,
        calendarMode,
        createCalendarEvent,
        forcePublish
      });

      const requestBody = {
        notes: actionNotes,
        calendarMode: calendarMode,
        createCalendarEvent: createCalendarEvent,
        graphToken: graphToken,
        forcePublish: forcePublish,
        targetCalendar: selectedTargetCalendar || defaultCalendar,
        _version: eventVersion || reservation._version || null
      };

      logger.debug('Sending approval request:', requestBody);

      const approveEndpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}/publish`;

      const response = await fetch(approveEndpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(requestBody)
      });

      // Handle conflict (409)
      if (response.status === 409) {
        const data = await response.json();

        // Check if it's a scheduling conflict or version conflict
        if (data.error === 'SchedulingConflict') {
          setConflicts(data.conflicts || []);
          setError(`Cannot publish: ${data.conflicts.length} scheduling conflict(s) detected. ` +
                  `Please review conflicts below and either modify the reservation or check "Override conflicts" to force publish.`);
          return;
        }

        // Version conflict - show ConflictDialog
        const conflictDetails = data.details || {};
        const currentStatus = conflictDetails.currentStatus || data.currentStatus;

        logger.warn('Version conflict detected (409)', { details: conflictDetails });

        // Determine conflict type
        const expectedStatus = reservation.status;
        const conflictType = currentStatus && currentStatus !== expectedStatus
          ? (currentStatus === 'published' || currentStatus === 'rejected' ? 'already_actioned' : 'status_changed')
          : 'data_changed';

        setConflictDialog({
          isOpen: true,
          conflictType,
          details: conflictDetails,
          staleData: editableData
        });
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ Publish request failed:', response.status, errorText);
        throw new Error(`Failed to publish reservation: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      logger.debug('✅ Approval response received:', result);

      // Check for calendar event creation results (backend returns as 'calendarEvent')
      const calendarEventResult = result.calendarEvent || result.calendarEventResult;
      
      if (createCalendarEvent && calendarEventResult) {
        if (calendarEventResult.success) {
          logger.debug('📅 Calendar event created successfully:', {
            eventId: calendarEventResult.eventId,
            calendar: calendarEventResult.targetCalendar
          });
          setError(`✅ Reservation published and calendar event created in ${calendarEventResult.targetCalendar}`);
        } else {
          logger.error('📅 Calendar event creation failed:', calendarEventResult.error);
          setError(`⚠️ Reservation published but calendar event creation failed: ${calendarEventResult.error}`);
        }
      } else if (createCalendarEvent) {
        logger.warn('📅 Calendar event creation was requested but no result received');
        setError('⚠️ Reservation published but calendar event creation status unknown');
      } else {
        logger.debug('✅ Reservation published (calendar event creation disabled)');
        setError('✅ Reservation published successfully');
      }

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id
          ? { ...r, status: 'published', actionDate: new Date(), calendarEventId: calendarEventResult?.eventId }
          : r
      ));

      setSelectedReservation(null);
      setActionNotes('');
      setCalendarMode(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
      setCreateCalendarEvent(true);

      // Clear success message after 5 seconds
      setTimeout(() => setError(''), 5000);
      
    } catch (err) {
      logger.error('❌ Error in approval process:', err);
      logger.error('Error approving reservation:', err);
      showError(err, { context: 'ReservationRequests.handleApprove', userMessage: 'Failed to publish reservation' });
    } finally {
      setIsApproving(false);
    }
  };

  // Handle reject click - two-click confirmation pattern with reason input
  const handleRejectClick = (reservation) => {
    if (isRejectConfirming) {
      // Already in confirm state, check for reason and proceed
      if (!rejectionReason.trim()) {
        showWarning('Please provide a reason for rejection');
        return;
      }
      handleReject(reservation);
    } else {
      // First click - enter confirm state (shows reason input)
      setIsRejectConfirming(true);
      // Auto-reset after 10 seconds if not confirmed (longer for typing reason)
      setTimeout(() => {
        setIsRejectConfirming(false);
        setRejectionReason('');
      }, 10000);
    }
  };

  const handleReject = async (reservation) => {
    try {
      setIsRejecting(true);
      setIsRejectConfirming(false);

      const rejectEndpoint = `${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}/reject`;

      const response = await fetch(rejectEndpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reason: rejectionReason, _version: eventVersion || reservation._version || null })
      });

      // Handle version conflict (409)
      if (response.status === 409) {
        const data = await response.json();
        const conflictDetails = data.details || {};
        const currentStatus = conflictDetails.currentStatus;

        const conflictType = currentStatus && currentStatus !== reservation.status
          ? (currentStatus === 'published' || currentStatus === 'rejected' ? 'already_actioned' : 'status_changed')
          : 'data_changed';

        setConflictDialog({ isOpen: true, conflictType, details: conflictDetails, staleData: editableData });
        return;
      }

      if (!response.ok) throw new Error('Failed to reject reservation');

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id
          ? { ...r, status: 'rejected', actionDate: new Date(), rejectionReason: rejectionReason }
          : r
      ));

      setSelectedReservation(null);
      setRejectionReason('');
      showSuccess(`Reservation "${reservation.eventTitle}" rejected`);
    } catch (err) {
      logger.error('Error rejecting reservation:', err);
      showError(err, { context: 'ReservationRequests.handleReject', userMessage: 'Failed to reject reservation' });
    } finally {
      setIsRejecting(false);
    }
  };

  // Handle modal delete click - two-click confirmation pattern (separate from card delete)
  const handleModalDeleteClick = (reservation) => {
    if (isModalDeleteConfirming) {
      // Already in confirm state, proceed with delete
      handleModalDelete(reservation);
    } else {
      // First click - enter confirm state
      setIsModalDeleteConfirming(true);
      // Auto-reset after 3 seconds if not confirmed
      setTimeout(() => {
        setIsModalDeleteConfirming(false);
      }, 3000);
    }
  };

  const handleModalDelete = async (reservation) => {
    try {
      setIsModalDeleting(true);
      setIsModalDeleteConfirming(false);

      logger.debug('🗑️ Starting reservation deletion from modal:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle
      });

      // Only include graphToken if the event has been synced to Graph (has calendarId)
      const hasGraphData = reservation.calendarId || reservation.graphData?.id;

      // Use unified events endpoint
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({
          graphToken: hasGraphData ? graphToken : undefined,
          calendarId: reservation.calendarId,
          _version: eventVersion || reservation._version || null
        })
      });

      // Handle version conflict (409)
      if (response.status === 409) {
        const data = await response.json();
        const conflictDetails = data.details || {};
        setConflictDialog({ isOpen: true, conflictType: 'data_changed', details: conflictDetails, staleData: editableData });
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete reservation: ${response.status} ${errorText}`);
      }

      // Update local state - mark as deleted
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id
          ? { ...r, status: 'deleted', isDeleted: true }
          : r
      ));

      // Close the review modal
      setShowReviewModal(false);
      setSelectedReservation(null);
      showSuccess(`Reservation "${reservation.eventTitle}" deleted successfully`);

    } catch (err) {
      logger.error('Error deleting reservation from modal:', err);
      showError(err, { context: 'ReservationRequests.handleModalDelete', userMessage: 'Failed to delete reservation' });
    } finally {
      setIsModalDeleting(false);
    }
  };

  // First click sets confirm state, second click deletes
  const handleDeleteClick = (reservation) => {
    if (confirmDeleteId === reservation._id) {
      // Already in confirm state, proceed with delete
      handleDelete(reservation);
    } else {
      // First click - enter confirm state
      setConfirmDeleteId(reservation._id);
      // Auto-reset after 3 seconds if not confirmed
      setTimeout(() => {
        setConfirmDeleteId(prev => prev === reservation._id ? null : prev);
      }, 3000);
    }
  };

  const handleDelete = async (reservation) => {
    try {
      setDeletingId(reservation._id);
      setConfirmDeleteId(null);

      logger.debug('🗑️ Starting reservation deletion:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle,
        hasGraphData: !!reservation.graphData?.id,
        calendarId: reservation.calendarId
      });

      // Only include graphToken if the event has been synced to Graph (has calendarId)
      const hasGraphData = reservation.calendarId || reservation.graphData?.id;

      // Use unified events endpoint (reservations are stored in templeEvents__Events)
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
        logger.error('❌ Delete request failed:', response.status, errorText);
        throw new Error(`Failed to delete reservation: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      logger.debug('✅ Reservation deleted successfully:', result);

      // Update local state - mark as deleted instead of removing (for deleted tab)
      setAllReservations(prev => prev.map(r =>
        r._id === reservation._id
          ? { ...r, status: 'deleted', isDeleted: true }
          : r
      ));

      // Close modals
      setSelectedDetailsReservation(null);
      setShowReviewModal(false);
      setSelectedReservation(null);
      setActionNotes('');
      showSuccess(`Reservation "${reservation.eventTitle}" deleted successfully`);

    } catch (err) {
      logger.error('❌ Error deleting reservation:', err);
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
            className={`event-type-tab ${activeTab === 'cancelled' ? 'active' : ''}`}
            onClick={() => handleTabChange('cancelled')}
          >
            Canceled
            <span className="count">({statusCounts.cancelled})</span>
          </button>
          <button
            className={`event-type-tab deleted-tab ${activeTab === 'deleted' ? 'active' : ''}`}
            onClick={() => handleTabChange('deleted')}
          >
            Deleted
            <span className="count">({statusCounts.deleted})</span>
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
                    onClick={() => setSelectedDetailsReservation(reservation)}
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
              {activeTab === 'pending' ? '📋' : activeTab === 'published' ? '✅' : activeTab === 'deleted' ? '🗑️' : '📁'}
            </div>
            <h3>No {activeTab === 'all' ? '' : activeTab} requests</h3>
            <p>
              {activeTab === 'pending'
                ? 'All caught up! No pending requests to review.'
                : activeTab === 'published'
                ? 'No published reservations yet.'
                : activeTab === 'cancelled'
                ? 'No canceled reservations.'
                : activeTab === 'deleted'
                ? 'No deleted reservations.'
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

      {/* Details Modal (lightweight info modal) */}
      {selectedDetailsReservation && (
        <div className="rr-details-modal-overlay" onClick={() => setSelectedDetailsReservation(null)}>
          <div className="rr-details-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reservation Details</h2>
            <div className="rr-reservation-details">
              <div className="rr-detail-row">
                <label>Event:</label>
                <div>{selectedDetailsReservation.eventTitle}</div>
              </div>

              <div className="rr-detail-row">
                <label>Requested By:</label>
                <div>
                  {selectedDetailsReservation.roomReservationData?.requestedBy?.name || selectedDetailsReservation.requesterName}
                  {(selectedDetailsReservation.roomReservationData?.requestedBy?.department || selectedDetailsReservation.department) && (
                    <span className="rr-details-dept"> ({selectedDetailsReservation.roomReservationData?.requestedBy?.department || selectedDetailsReservation.department})</span>
                  )}
                  {(selectedDetailsReservation.roomReservationData?.contactPerson?.isOnBehalfOf || selectedDetailsReservation.isOnBehalfOf) &&
                    (selectedDetailsReservation.roomReservationData?.contactPerson?.name || selectedDetailsReservation.contactName) && (
                    <div className="rr-details-on-behalf">
                      on behalf of {selectedDetailsReservation.roomReservationData?.contactPerson?.name || selectedDetailsReservation.contactName}
                    </div>
                  )}
                </div>
              </div>

              <div className="rr-detail-row">
                <label>Date & Time:</label>
                <div>
                  {new Date(selectedDetailsReservation.startDateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  {', '}
                  {new Date(selectedDetailsReservation.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {' - '}
                  {new Date(selectedDetailsReservation.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>

              <div className="rr-detail-row">
                <label>Rooms:</label>
                <div>
                  {selectedDetailsReservation.requestedRooms.map(roomId => {
                    const roomDetails = getRoomDetails(roomId);
                    return roomDetails.location
                      ? `${roomDetails.name} (${roomDetails.location})`
                      : roomDetails.name;
                  }).join(', ')}
                </div>
              </div>

              <div className="rr-detail-row">
                <label>Status:</label>
                <div>
                  <span className={`status-badge status-${selectedDetailsReservation.status}`}>
                    {selectedDetailsReservation.status.charAt(0).toUpperCase() + selectedDetailsReservation.status.slice(1)}
                  </span>
                </div>
              </div>

              {selectedDetailsReservation.eventDescription && (
                <div className="rr-detail-row">
                  <label>Description:</label>
                  <div>{selectedDetailsReservation.eventDescription}</div>
                </div>
              )}

              {selectedDetailsReservation.specialRequirements && (
                <div className="rr-detail-row">
                  <label>Special Requirements:</label>
                  <div>{selectedDetailsReservation.specialRequirements}</div>
                </div>
              )}

              {selectedDetailsReservation.rejectionReason && (
                <div className="rr-detail-row">
                  <label>Rejection Reason:</label>
                  <div className="rr-details-rejection">{selectedDetailsReservation.rejectionReason}</div>
                </div>
              )}
            </div>

            <div className="rr-modal-actions">
              {/* Pending: Review + Delete + Close */}
              {selectedDetailsReservation.status === 'pending' && (
                <>
                  <button
                    className="rr-btn rr-review-btn"
                    onClick={() => {
                      const reservation = selectedDetailsReservation;
                      setSelectedDetailsReservation(null);
                      openReviewModal(reservation);
                    }}
                  >
                    Review
                  </button>
                  <button
                    className={`rr-btn rr-btn-danger ${confirmDeleteId === selectedDetailsReservation._id ? 'confirm' : ''}`}
                    onClick={() => handleDeleteClick(selectedDetailsReservation)}
                    disabled={deletingId === selectedDetailsReservation._id}
                  >
                    {deletingId === selectedDetailsReservation._id
                      ? 'Deleting...'
                      : confirmDeleteId === selectedDetailsReservation._id
                        ? 'Confirm?'
                        : 'Delete'}
                  </button>
                </>
              )}

              {/* Published: Edit + Delete + Close */}
              {selectedDetailsReservation.status === 'published' && (
                <>
                  <button
                    className="rr-btn rr-review-btn"
                    onClick={() => {
                      const reservation = selectedDetailsReservation;
                      setSelectedDetailsReservation(null);
                      openReviewModal(reservation);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className={`rr-btn rr-btn-danger ${confirmDeleteId === selectedDetailsReservation._id ? 'confirm' : ''}`}
                    onClick={() => handleDeleteClick(selectedDetailsReservation)}
                    disabled={deletingId === selectedDetailsReservation._id}
                  >
                    {deletingId === selectedDetailsReservation._id
                      ? 'Deleting...'
                      : confirmDeleteId === selectedDetailsReservation._id
                        ? 'Confirm?'
                        : 'Delete'}
                  </button>
                </>
              )}

              {/* Rejected: Delete + Close */}
              {selectedDetailsReservation.status === 'rejected' && (
                <button
                  className={`rr-btn rr-btn-danger ${confirmDeleteId === selectedDetailsReservation._id ? 'confirm' : ''}`}
                  onClick={() => handleDeleteClick(selectedDetailsReservation)}
                  disabled={deletingId === selectedDetailsReservation._id}
                >
                  {deletingId === selectedDetailsReservation._id
                    ? 'Deleting...'
                    : confirmDeleteId === selectedDetailsReservation._id
                      ? 'Confirm?'
                      : 'Delete'}
                </button>
              )}

              {/* Cancelled: Delete + Close */}
              {selectedDetailsReservation.status === 'cancelled' && (
                <button
                  className={`rr-btn rr-btn-danger ${confirmDeleteId === selectedDetailsReservation._id ? 'confirm' : ''}`}
                  onClick={() => handleDeleteClick(selectedDetailsReservation)}
                  disabled={deletingId === selectedDetailsReservation._id}
                >
                  {deletingId === selectedDetailsReservation._id
                    ? 'Deleting...'
                    : confirmDeleteId === selectedDetailsReservation._id
                      ? 'Confirm?'
                      : 'Delete'}
                </button>
              )}

              {/* Deleted: Close only (no actions) */}

              <button
                className="rr-btn rr-close-btn"
                onClick={() => setSelectedDetailsReservation(null)}
              >
                Close
              </button>
            </div>
          </div>
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

      {/* Review Modal (using ReviewModal component) - for regular reservations */}
      {showReviewModal && selectedReservation && (
        <ReviewModal
          isOpen={showReviewModal}
          title={`Review ${selectedReservation.eventTitle || 'Reservation Request'}`}
          onClose={closeReviewModal}
          onApprove={() => handleApproveClick(selectedReservation)}
          onReject={() => handleRejectClick(selectedReservation)}
          onDelete={() => handleModalDeleteClick(selectedReservation)}
          isPending={selectedReservation?.status === 'pending'}
          itemStatus={selectedReservation?.status}
          eventVersion={eventVersion}
          hasChanges={hasChanges}
          isFormValid={isFormValid}
          isSaving={isSaving}
          showFormToggle={true}
          useUnifiedForm={useUnifiedForm}
          onFormToggle={() => setUseUnifiedForm(!useUnifiedForm)}
          // Approval confirmation state
          isApproving={isApproving}
          isApproveConfirming={isApproveConfirming}
          onCancelApprove={() => setIsApproveConfirming(false)}
          // Rejection confirmation state
          isRejecting={isRejecting}
          isRejectConfirming={isRejectConfirming}
          onCancelReject={() => {
            setIsRejectConfirming(false);
            setRejectionReason('');
          }}
          rejectionReason={rejectionReason}
          onRejectionReasonChange={setRejectionReason}
          // Delete confirmation state
          isDeleting={isModalDeleting}
          isDeleteConfirming={isModalDeleteConfirming}
          onCancelDelete={() => setIsModalDeleteConfirming(false)}
          hasSchedulingConflicts={hasSchedulingConflicts}
        >
          {useUnifiedForm ? (
            <UnifiedEventForm
              mode="reservation"
              reservation={selectedReservation}
              apiToken={apiToken}
              hideActionBar={true}
              onApprove={(updatedData, notes) => handleApprove(selectedReservation)}
              onReject={(notes) => handleReject(selectedReservation)}
              onCancel={closeReviewModal}
              onSave={handleSaveChanges}
              onHasChangesChange={setHasChanges}
              onFormValidChange={setIsFormValid}
              onIsSavingChange={setIsSaving}
              onSaveFunctionReady={handleSaveFunctionReady}
              onLockedEventClick={handleLockedEventClick}
            />
          ) : (
            <RoomReservationReview
              reservation={selectedReservation}
              apiToken={apiToken}
              onApprove={(updatedData, notes) => handleApprove(selectedReservation)}
              onReject={(notes) => handleReject(selectedReservation)}
              onCancel={closeReviewModal}
              onSave={handleSaveChanges}
              onHasChangesChange={setHasChanges}
              onFormValidChange={setIsFormValid}
              onIsSavingChange={setIsSaving}
              onSaveFunctionReady={handleSaveFunctionReady}
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
      )}
      {/* Conflict Dialog for 409 version conflicts */}
      <ConflictDialog
        isOpen={conflictDialog.isOpen}
        onClose={() => setConflictDialog(prev => ({ ...prev, isOpen: false }))}
        onRefresh={async () => {
          setConflictDialog(prev => ({ ...prev, isOpen: false }));
          await loadAllReservations();
          closeReviewModal();
        }}
        conflictType={conflictDialog.conflictType}
        eventTitle={selectedReservation?.eventTitle || 'Event'}
        details={conflictDialog.details}
        staleData={conflictDialog.staleData}
      />
    </div>
  );
}