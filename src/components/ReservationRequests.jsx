// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import { transformEventsToFlatStructure } from '../utils/eventTransformers';
import LoadingSpinner from './shared/LoadingSpinner';
import RoomReservationReview from './RoomReservationReview';
import UnifiedEventForm from './UnifiedEventForm';
import ReviewModal from './shared/ReviewModal';
import EditRequestComparison from './EditRequestComparison';
import './ReservationRequests.css';

export default function ReservationRequests({ apiToken, graphToken }) {
  // Permission check for Approver/Admin role
  const { canApproveReservations, isAdmin } = usePermissions();
  const { showError, showSuccess, showWarning } = useNotification();
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const [actionNotes, setActionNotes] = useState('');

  // Calendar event creation settings
  const [calendarMode, setCalendarMode] = useState(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
  const [createCalendarEvent, setCreateCalendarEvent] = useState(true);
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [defaultCalendar, setDefaultCalendar] = useState('');
  const [selectedTargetCalendar, setSelectedTargetCalendar] = useState('');

  // Editable form state
  const [editableData, setEditableData] = useState(null);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isFormValid, setIsFormValid] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Child component's save function (exposed via callback)
  const childSaveFunctionRef = useRef(null);

  // Memoized callback for receiving the save function from child
  const handleSaveFunctionReady = useCallback((saveFunc) => {
    childSaveFunctionRef.current = saveFunc;
  }, []);

  // Soft hold state
  const [reviewHold, setReviewHold] = useState(null);
  const [holdTimer, setHoldTimer] = useState(null);
  const [holdError, setHoldError] = useState(null);

  // Conflict detection state
  const [conflicts, setConflicts] = useState([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [forceApprove, setForceApprove] = useState(false);

  // Feature flag: Toggle between old and new review form
  const [useUnifiedForm, setUseUnifiedForm] = useState(false);

  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState(null);

  // Delete state
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Edit request state
  const [editRequests, setEditRequests] = useState([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
  const [selectedEditRequest, setSelectedEditRequest] = useState(null);
  const [showEditRequestModal, setShowEditRequestModal] = useState(false);
  const [approvingEditRequest, setApprovingEditRequest] = useState(false);
  const [rejectingEditRequest, setRejectingEditRequest] = useState(false);
  const [editRequestRejectionReason, setEditRequestRejectionReason] = useState('');

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
      loadAllReservations();
    }
  }, [apiToken]);

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

  // Cleanup hold timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimer) {
        clearInterval(holdTimer);
      }
    };
  }, [holdTimer]);

  const loadAllReservations = async () => {
    try {
      setLoading(true);
      setError('');

      // Load ONLY from templeEvents__Events (new unified system)
      const newEventsResponse = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservation-events?limit=1000`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!newEventsResponse.ok) {
        throw new Error('Failed to load room reservation events');
      }

      // Parse response
      const newData = await newEventsResponse.json();

      // Transform events using shared utility (single source of truth)
      const transformedNewEvents = transformEventsToFlatStructure(newData.events || []);

      logger.debug('🔧 TRANSFORMED EVENT (first event) - Series fields:', {
        eventId: transformedNewEvents?.[0]?.eventId,
        hasEventSeriesId: !!transformedNewEvents?.[0]?.eventSeriesId,
        eventSeriesId: transformedNewEvents?.[0]?.eventSeriesId,
        seriesIndex: transformedNewEvents?.[0]?.seriesIndex,
        seriesLength: transformedNewEvents?.[0]?.seriesLength
      });

      // Sort by submission date (newest first)
      transformedNewEvents.sort((a, b) => {
        const dateA = new Date(a.submittedAt || 0);
        const dateB = new Date(b.submittedAt || 0);
        return dateB - dateA;
      });

      logger.info('Loaded room reservation events:', {
        count: transformedNewEvents.length
      });

      setAllReservations(transformedNewEvents);
    } catch (err) {
      logger.error('Error loading reservations:', err);
      setError('Failed to load reservation requests');
    } finally {
      setLoading(false);
    }
  };

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

  // Load edit requests when tab changes to edit-requests
  useEffect(() => {
    if (activeTab === 'edit-requests' && apiToken) {
      loadEditRequests();
    }
  }, [activeTab, apiToken]);

  // Acquire soft hold when opening review modal
  const acquireReviewHold = async (reservationId, isNewUnifiedEvent = false) => {
    // Skip review hold for new unified events (endpoint not implemented yet)
    if (isNewUnifiedEvent) {
      logger.info('Skipping review hold for new unified event');
      setHoldError(null);
      return true;
    }

    try {
      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservationId}/start-review`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (response.status === 423) {
        const data = await response.json();
        setHoldError(`This reservation is currently being reviewed by ${data.reviewingBy}. ` +
                     `The hold will expire in ${data.minutesRemaining} minutes.`);
        return false;
      }

      if (!response.ok) {
        throw new Error('Failed to acquire review hold');
      }

      const data = await response.json();
      const expiresAt = new Date(data.reviewExpiresAt);

      setReviewHold({
        expiresAt,
        durationMinutes: data.durationMinutes
      });
      setHoldError(null);

      // Set up countdown timer
      const timer = setInterval(() => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          setHoldError('Your review session has expired. Please reopen the modal to continue.');
          closeReviewModal();
        }
      }, 60000); // Check every minute

      setHoldTimer(timer);
      return true;

    } catch (error) {
      logger.error('Failed to acquire review hold:', error);
      // Don't set error for network issues - allow modal to open
      setHoldError(null);
      return true;
    }
  };

  // Release soft hold when closing modal
  const releaseReviewHold = async (reservationId) => {
    if (holdTimer) {
      clearInterval(holdTimer);
      setHoldTimer(null);
    }

    if (!reservationId) return;

    try {
      await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservationId}/release-review`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );
    } catch (error) {
      logger.error('Failed to release hold:', error);
    }

    setReviewHold(null);
    setHoldError(null);
  };

  // Check for scheduling conflicts
  const checkConflicts = async (reservation) => {
    try {
      setCheckingConflicts(true);

      // Skip conflict check for new unified events (endpoint not implemented yet)
      if (reservation._isNewUnifiedEvent) {
        logger.info('Skipping pre-check conflicts for new unified event (checked during approval)');
        setConflicts([]);
        return;
      }

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/check-conflicts`,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to check conflicts');
      }

      const data = await response.json();
      setConflicts(data.conflicts || []);

    } catch (error) {
      logger.error('Failed to check conflicts:', error);
      setConflicts([]); // Show as no conflicts on error
    } finally {
      setCheckingConflicts(false);
    }
  };

  // Stats calculation
  const stats = useMemo(() => {
    const pending = allReservations.filter(r => r.status === 'pending').length;
    const approved = allReservations.filter(r => r.status === 'approved').length;
    const rejected = allReservations.filter(r => r.status === 'rejected').length;
    return {
      total: allReservations.length,
      pending,
      approved,
      rejected
    };
  }, [allReservations]);

  // Client-side filtering with memoization
  const filteredReservations = useMemo(() => {
    if (activeTab === 'all') {
      return allReservations;
    }
    return allReservations.filter(reservation => reservation.status === activeTab);
  }, [allReservations, activeTab]);

  // Pagination for filtered results
  const itemsPerPage = 20;
  const totalPages = Math.ceil(filteredReservations.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const paginatedReservations = filteredReservations.slice(startIndex, startIndex + itemsPerPage);

  // Reset page when tab changes
  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    setPage(1);
  };

  // Open review modal (using ReviewModal component)
  const openReviewModal = async (reservation) => {
    // For pending reservations, try to acquire soft hold
    if (reservation.status === 'pending') {
      try {
        const holdAcquired = await acquireReviewHold(reservation._id, reservation._isNewUnifiedEvent);
        if (!holdAcquired && holdError) {
          // Block if someone else is reviewing
          if (holdError.includes('currently being reviewed by')) {
            return;
          }
        }
      } catch (error) {
        // Network error - allow modal to open without hold
        logger.error('Failed to acquire soft hold:', error);
        setHoldError(null);
      }
    }

    // Initialize editable data
    setEditableData({
      eventTitle: reservation.eventTitle || '',
      eventDescription: reservation.eventDescription || '',
      startDateTime: reservation.startDateTime,
      endDateTime: reservation.endDateTime,
      setupTimeMinutes: reservation.setupTimeMinutes || 0,
      teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
      attendeeCount: reservation.attendeeCount || 0,
      requestedRooms: reservation.requestedRooms || [],
      specialRequirements: reservation.specialRequirements || '',
      requesterName: reservation.roomReservationData?.requestedBy?.name || reservation.requesterName || '',
      requesterEmail: reservation.roomReservationData?.requestedBy?.email || reservation.requesterEmail || '',
      contactName: reservation.roomReservationData?.contactPerson?.name || reservation.contactName || '',
      contactEmail: reservation.roomReservationData?.contactPerson?.email || reservation.contactEmail || '',
      phone: reservation.roomReservationData?.requestedBy?.phone || reservation.phone || '',
      department: reservation.roomReservationData?.requestedBy?.department || reservation.department || '',
      sponsoredBy: reservation.sponsoredBy || '',
      isOnBehalfOf: reservation.roomReservationData?.contactPerson?.isOnBehalfOf || reservation.isOnBehalfOf || false
    });

    setOriginalChangeKey(reservation.changeKey);
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

    // Check for scheduling conflicts
    await checkConflicts(reservation);
  };

  // Close review modal and release hold
  const closeReviewModal = async () => {
    if (selectedReservation) {
      await releaseReviewHold(selectedReservation._id);
    }

    setShowReviewModal(false);
    setSelectedReservation(null);
    setEditableData(null);
    setOriginalChangeKey(null);
    setHasChanges(false);
    setActionNotes('');
    setCalendarMode(APP_CONFIG.CALENDAR_CONFIG.DEFAULT_MODE);
    setCreateCalendarEvent(true);
    setConflicts([]);
    setForceApprove(false);
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

    // Re-check conflicts if time or room fields changed
    if (['startDateTime', 'endDateTime', 'setupTimeMinutes', 'teardownTimeMinutes', 'requestedRooms'].includes(field)) {
      checkConflicts({
        ...selectedReservation,
        ...editableData,
        [field]: value
      });
    }
  };

  // Save changes with ETag validation
  // This function is now mainly called as a callback from RoomReservationReview
  // RoomReservationReview handles the actual API call and passes the result here
  const handleSaveChanges = async (result) => {
    // If result is provided, it means RoomReservationReview already saved
    // Just update our local state with the new changeKey and refresh the data
    if (result && result.changeKey) {
      logger.debug('📝 Updating reservation data after save:', result);

      setOriginalChangeKey(result.changeKey);
      setHasChanges(false);

      // Update the selected reservation with the saved data
      if (result.reservation) {
        logger.debug('🔄 Updating selectedReservation with saved data');
        setSelectedReservation(result.reservation);

        // Also update the reservation in allReservations array
        setAllReservations(prev => {
          return prev.map(res =>
            res._id === result.reservation._id ? result.reservation : res
          );
        });
        logger.debug('✅ Updated allReservations array');
      }

      setError('✅ Changes saved successfully');
      setTimeout(() => setError(''), 3000);
      return;
    }

    // Legacy path (in case called without result) - kept for backwards compatibility
    if (!hasChanges) return;

    try {
      setIsSaving(true);

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${selectedReservation._id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`,
            'If-Match': originalChangeKey || ''
          },
          body: JSON.stringify(editableData)
        }
      );

      if (response.status === 409) {
        const data = await response.json();
        const changes = data.changes || [];
        const changesList = changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n');

        const message = `This reservation was modified by ${data.lastModifiedBy} while you were editing.\n\n` +
                       `Changes made:\n${changesList}\n\n` +
                       `Your changes have NOT been saved. Would you like to refresh to see the latest version?\n` +
                       `(Your changes will be lost)`;

        if (window.confirm(message)) {
          await loadAllReservations();
          closeReviewModal();
        }
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to save changes');
      }

      const saveResult = await response.json();

      // Update local state
      setAllReservations(prev => prev.map(r =>
        r._id === selectedReservation._id ? { ...r, ...editableData, changeKey: saveResult.changeKey } : r
      ));

      setOriginalChangeKey(saveResult.changeKey);
      setHasChanges(false);
      setError('✅ Changes saved successfully');
      setTimeout(() => setError(''), 3000);

    } catch (error) {
      logger.error('Error saving changes:', error);
      setError(`Failed to save changes: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleApprove = async (reservation) => {
    try {
      logger.debug('🚀 Starting reservation approval process:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle,
        calendarMode,
        createCalendarEvent,
        hasConflicts: conflicts.length > 0,
        forceApprove
      });

      const requestBody = {
        notes: actionNotes,
        calendarMode: calendarMode,
        createCalendarEvent: createCalendarEvent,
        graphToken: graphToken,
        forceApprove: forceApprove,
        targetCalendar: selectedTargetCalendar || defaultCalendar
      };

      logger.debug('📤 Sending approval request:', requestBody);

      // Use new endpoint for unified events, old endpoint for legacy reservations
      const approveEndpoint = reservation._isNewUnifiedEvent
        ? `${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}/approve`
        : `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/approve`;

      logger.debug('🔗 Using endpoint:', approveEndpoint, '(isNew:', reservation._isNewUnifiedEvent, ')');

      const response = await fetch(approveEndpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'If-Match': originalChangeKey || reservation.changeKey || ''
        },
        body: JSON.stringify(requestBody)
      });

      // Handle ETag conflict (409)
      if (response.status === 409) {
        const data = await response.json();

        // Check if it's a scheduling conflict or ETag conflict
        if (data.error === 'SchedulingConflict') {
          setConflicts(data.conflicts || []);
          setError(`⚠️ Cannot approve: ${data.conflicts.length} scheduling conflict(s) detected. ` +
                  `Please review conflicts below and either modify the reservation or check "Override conflicts" to force approval.`);
          return;
        } else if (data.error === 'ConflictError') {
          const changes = data.changes || [];
          const changesList = changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n');

          const message = `This reservation was modified by ${data.lastModifiedBy} while you were editing.\n\n` +
                         `Changes made:\n${changesList}\n\n` +
                         `Would you like to refresh to see the latest version?`;

          if (window.confirm(message)) {
            await loadAllReservations();
            closeReviewModal();
          }
          return;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ Approval request failed:', response.status, errorText);
        throw new Error(`Failed to approve reservation: ${response.status} ${errorText}`);
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
          setError(`✅ Reservation approved and calendar event created in ${calendarEventResult.targetCalendar}`);
        } else {
          logger.error('📅 Calendar event creation failed:', calendarEventResult.error);
          setError(`⚠️ Reservation approved but calendar event creation failed: ${calendarEventResult.error}`);
        }
      } else if (createCalendarEvent) {
        logger.warn('📅 Calendar event creation was requested but no result received');
        setError('⚠️ Reservation approved but calendar event creation status unknown');
      } else {
        logger.debug('✅ Reservation approved (calendar event creation disabled)');
        setError('✅ Reservation approved successfully');
      }
      
      // Update local state
      setAllReservations(prev => prev.map(r => 
        r._id === reservation._id 
          ? { ...r, status: 'approved', actionDate: new Date(), calendarEventId: calendarEventResult?.eventId }
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
      setError(`Failed to approve reservation: ${err.message}`);
    }
  };
  
  const handleReject = async (reservation) => {
    if (!actionNotes.trim()) {
      showWarning('Please provide a reason for rejection');
      return;
    }
    
    try {
      // Use new endpoint for unified events, old endpoint for legacy reservations
      const rejectEndpoint = reservation._isNewUnifiedEvent
        ? `${APP_CONFIG.API_BASE_URL}/admin/events/${reservation._id}/reject`
        : `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/reject`;

      const response = await fetch(rejectEndpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ reason: actionNotes })
      });
      
      if (!response.ok) throw new Error('Failed to reject reservation');
      
      // Update local state
      setAllReservations(prev => prev.map(r => 
        r._id === reservation._id 
          ? { ...r, status: 'rejected', actionDate: new Date(), rejectionReason: actionNotes }
          : r
      ));
      
      setSelectedReservation(null);
      setActionNotes('');
    } catch (err) {
      logger.error('Error rejecting reservation:', err);
      setError('Failed to reject reservation');
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
          calendarId: reservation.calendarId
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ Delete request failed:', response.status, errorText);
        throw new Error(`Failed to delete reservation: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      logger.debug('✅ Reservation deleted successfully:', result);

      // Remove from local state
      setAllReservations(prev => prev.filter(r => r._id !== reservation._id));

      // Close the review modal
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

  const handleSync = async (reservation) => {
    try {
      logger.debug('🔄 Starting reservation calendar sync:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle,
        calendarMode,
        hasCalendarEventId: !!reservation.calendarEventId
      });

      const requestBody = { 
        calendarMode: calendarMode,
        graphToken: graphToken
      };

      logger.debug('📤 Sending sync request:', requestBody);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}/sync`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('❌ Sync request failed:', response.status, errorText);
        throw new Error(`Failed to sync calendar event: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      logger.debug('✅ Sync response received:', result);

      // Check for calendar event sync results
      const calendarEventResult = result.calendarEvent;
      
      if (calendarEventResult && calendarEventResult.success) {
        logger.debug('📅 Calendar event synced successfully:', {
          eventId: calendarEventResult.eventId,
          calendar: calendarEventResult.targetCalendar
        });
        setError(`🔄 Calendar event synced successfully in ${calendarEventResult.targetCalendar}`);
      } else {
        logger.error('📅 Calendar event sync failed:', calendarEventResult?.error);
        setError(`⚠️ Calendar event sync failed: ${calendarEventResult?.error || 'Unknown error'}`);
      }
      
      // Refresh reservations to show updated data
      await loadAllReservations();
      
      setSelectedReservation(null);
      setActionNotes('');
      
      // Clear success message after 5 seconds
      setTimeout(() => setError(''), 5000);
      
    } catch (err) {
      logger.error('❌ Error in sync process:', err);
      logger.error('Error syncing reservation:', err);
      setError(`Failed to sync calendar event: ${err.message}`);
    }
  };
  
  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };
  
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'approved': return 'status-approved';
      case 'rejected': return 'status-rejected';
      case 'cancelled': return 'status-cancelled';
      default: return '';
    }
  };

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
          <h1>Reservation Requests</h1>
          <p className="rr-header-subtitle">Review and manage room reservation requests</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="rr-stats-row">
        <div className="rr-stat-card total">
          <div className="rr-stat-icon total">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="rr-stat-content">
            <h4>{stats.total}</h4>
            <p>Total Requests</p>
          </div>
        </div>
        <div className="rr-stat-card pending">
          <div className="rr-stat-icon pending">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="rr-stat-content">
            <h4>{stats.pending}</h4>
            <p>Pending</p>
          </div>
        </div>
        <div className="rr-stat-card approved">
          <div className="rr-stat-icon approved">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="rr-stat-content">
            <h4>{stats.approved}</h4>
            <p>Approved</p>
          </div>
        </div>
        <div className="rr-stat-card rejected">
          <div className="rr-stat-icon rejected">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div className="rr-stat-content">
            <h4>{stats.rejected}</h4>
            <p>Rejected</p>
          </div>
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
            <span className="count">({allReservations.length})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => handleTabChange('pending')}
          >
            Pending
            <span className="count">({allReservations.filter(r => r.status === 'pending').length})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'approved' ? 'active' : ''}`}
            onClick={() => handleTabChange('approved')}
          >
            Approved
            <span className="count">({allReservations.filter(r => r.status === 'approved').length})</span>
          </button>
          <button
            className={`event-type-tab ${activeTab === 'rejected' ? 'active' : ''}`}
            onClick={() => handleTabChange('rejected')}
          >
            Rejected
            <span className="count">({allReservations.filter(r => r.status === 'rejected').length})</span>
          </button>
          <button
            className={`event-type-tab edit-requests-tab ${activeTab === 'edit-requests' ? 'active' : ''}`}
            onClick={() => handleTabChange('edit-requests')}
          >
            Edit Requests
            <span className="count">({editRequests.filter(r => r.status === 'pending').length})</span>
          </button>
        </div>
      </div>
      
      {/* Edit Requests Table - shown when edit-requests tab is active */}
      {activeTab === 'edit-requests' && (
        <div className="reservations-table-container">
          {editRequestsLoading ? (
            <LoadingSpinner message="Loading edit requests..." />
          ) : (
            <>
              <table className="reservations-table edit-requests-table">
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Event Details</th>
                    <th>Requester</th>
                    <th>Proposed Changes</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {editRequests.map(editRequest => (
                    <tr key={editRequest._id} className={editRequest.status === 'pending' ? 'pending-row' : ''}>
                      <td className="submitted-date">
                        {new Date(editRequest.submittedAt).toLocaleDateString()}
                      </td>
                      <td className="event-details">
                        <strong>{editRequest.eventTitle}</strong>
                        <div className="original-event-link" title={`Original: ${editRequest.originalEventId}`}>
                          Edit Request
                        </div>
                      </td>
                      <td className="requester-info">
                        <div>{editRequest.requesterName}</div>
                        <div className="email">{editRequest.requesterEmail}</div>
                      </td>
                      <td className="proposed-changes">
                        {editRequest.proposedChanges && editRequest.proposedChanges.length > 0 ? (
                          <ul className="changes-list">
                            {editRequest.proposedChanges.slice(0, 3).map((change, idx) => (
                              <li key={idx}>{change.field}</li>
                            ))}
                            {editRequest.proposedChanges.length > 3 && (
                              <li className="more-changes">+{editRequest.proposedChanges.length - 3} more</li>
                            )}
                          </ul>
                        ) : (
                          <span className="no-changes">General update</span>
                        )}
                      </td>
                      <td className="change-reason">
                        <div className="reason-text" title={editRequest.changeReason}>
                          {editRequest.changeReason?.length > 50
                            ? editRequest.changeReason.substring(0, 50) + '...'
                            : editRequest.changeReason || 'No reason provided'}
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${getStatusBadgeClass(editRequest.status)}`}>
                          {editRequest.status}
                        </span>
                        {editRequest.reviewNotes && editRequest.status === 'rejected' && (
                          <div className="rejection-reason" title={editRequest.reviewNotes}>
                            {editRequest.reviewNotes}
                          </div>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          className="view-btn"
                          onClick={() => openEditRequestModal(editRequest)}
                        >
                          {editRequest.status === 'pending' ? 'Review' : 'Details'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editRequests.length === 0 && (
                <div className="no-reservations">
                  No edit requests found.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Reservations Table - shown for all other tabs */}
      {activeTab !== 'edit-requests' && (
        <div className="reservations-table-container">
          <table className="reservations-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Event Details</th>
                <th>Requester</th>
                <th>Date & Time</th>
                <th>Rooms</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedReservations.map(reservation => (
              <tr key={reservation._id}>
                <td className="submitted-date">
                  {new Date(reservation.submittedAt).toLocaleDateString()}
                </td>
                <td className="event-details">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong>{reservation.eventTitle}</strong>
                    {reservation._isNewUnifiedEvent}
                  </div>
                  {reservation.eventDescription && (
                    <div className="event-desc">{reservation.eventDescription}</div>
                  )}
                  {reservation.attendeeCount > 0 && (
                    <div className="attendee-count">👥 {reservation.attendeeCount} attendees</div>
                  )}
                </td>
                <td className="requester-info">
                  <div className="submitter-info">
                    <strong>Submitted by:</strong>
                    <div>{reservation.roomReservationData?.requestedBy?.name || reservation.requesterName}</div>
                    <div className="email">{reservation.roomReservationData?.requestedBy?.email || reservation.requesterEmail}</div>
                  </div>
                  {(reservation.roomReservationData?.contactPerson?.isOnBehalfOf || reservation.isOnBehalfOf) && (reservation.roomReservationData?.contactPerson?.name || reservation.contactName) && (
                    <div className="contact-info">
                      <strong>Contact Person:</strong>
                      <div>{reservation.roomReservationData?.contactPerson?.name || reservation.contactName}</div>
                      <div className="email">{reservation.roomReservationData?.contactPerson?.email || reservation.contactEmail}</div>
                      <div className="delegation-badge">📋 On Behalf Of</div>
                    </div>
                  )}
                  {(reservation.roomReservationData?.requestedBy?.department || reservation.department) && (
                    <div className="department">{reservation.roomReservationData?.requestedBy?.department || reservation.department}</div>
                  )}
                  {reservation.sponsoredBy && (
                    <div className="sponsor">Sponsored by: {reservation.sponsoredBy}</div>
                  )}
                </td>
                <td className="datetime">
                  <div>{formatDateTime(reservation.startDateTime)}</div>
                  <div className="to">to</div>
                  <div>{formatDateTime(reservation.endDateTime)}</div>
                </td>
                <td className="rooms">
                  {reservation.requestedRooms.map(roomId => {
                    const roomDetails = getRoomDetails(roomId);
                    return (
                      <div 
                        key={roomId} 
                        className="room-badge"
                        title={roomDetails.location ? `${roomDetails.name} - ${roomDetails.location}` : roomDetails.name}
                      >
                        {roomDetails.name}
                      </div>
                    );
                  })}
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadgeClass(reservation.status)}`}>
                    {reservation.status}
                  </span>
                  {reservation.rejectionReason && (
                    <div className="rejection-reason" title={reservation.rejectionReason}>
                      ❌ {reservation.rejectionReason}
                    </div>
                  )}
                </td>
                <td className="actions">
                  <button
                    className="view-btn"
                    onClick={() => openReviewModal(reservation)}
                  >
                    {reservation.status === 'pending' ? 'Review' : 'Details'}
                  </button>
                  {reservation.status === 'approved' && reservation.createdEventIds?.length > 0 && (
                    <button className="view-event-btn">
                      View Event
                    </button>
                  )}
                  <button
                    className={`delete-btn ${confirmDeleteId === reservation._id ? 'confirm' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClick(reservation);
                    }}
                    disabled={deletingId === reservation._id}
                    title={`Delete reservation: ${reservation.eventTitle}`}
                  >
                    {deletingId === reservation._id
                      ? 'Deleting...'
                      : confirmDeleteId === reservation._id
                        ? 'Confirm?'
                        : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {paginatedReservations.length === 0 && !loading && (
          <div className="no-reservations">
            {activeTab === 'all'
              ? 'No reservation requests found.'
              : `No ${activeTab} reservation requests found.`}
          </div>
        )}
        </div>
      )}

      {/* Pagination - only show for non-edit-requests tabs */}
      {activeTab !== 'edit-requests' && totalPages > 1 && (
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
          onApprove={() => handleApprove(selectedReservation)}
          onReject={() => handleReject(selectedReservation)}
          onSave={handleSaveChanges}
          onDelete={() => handleDelete(selectedReservation)}
          isPending={selectedReservation?.status === 'pending'}
          hasChanges={hasChanges}
          isFormValid={isFormValid}
          isSaving={isSaving}
          isAdmin={isAdmin}
          showFormToggle={true}
          useUnifiedForm={useUnifiedForm}
          onFormToggle={() => setUseUnifiedForm(!useUnifiedForm)}
        >
          {useUnifiedForm ? (
            <UnifiedEventForm
              mode="reservation"
              reservation={selectedReservation}
              apiToken={apiToken}
              onApprove={(updatedData, notes) => handleApprove(selectedReservation)}
              onReject={(notes) => handleReject(selectedReservation)}
              onCancel={closeReviewModal}
              onSave={handleSaveChanges}
              onHasChangesChange={setHasChanges}
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
            />
          )}
        </ReviewModal>
      )}
    </div>
  );
}