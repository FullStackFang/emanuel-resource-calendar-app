// src/components/ReservationRequests.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import { usePermissions } from '../hooks/usePermissions';
import LoadingSpinner from './shared/LoadingSpinner';
import RoomReservationReview from './RoomReservationReview';
import UnifiedEventForm from './UnifiedEventForm';
import ReviewModal from './shared/ReviewModal';
import './ReservationRequests.css';

export default function ReservationRequests({ apiToken, graphToken }) {
  // Permission check for Approver/Admin role
  const { canApproveReservations, isAdmin } = usePermissions();
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

      // Transform new events to match old reservation format for display
      logger.debug('🔧 RAW BACKEND EVENT (first event):', newData.events?.[0]);
      logger.debug('🔧 RAW BACKEND - First event series fields:', {
        eventId: newData.events?.[0]?.eventId,
        hasEventSeriesId: !!newData.events?.[0]?.eventSeriesId,
        eventSeriesId: newData.events?.[0]?.eventSeriesId,
        seriesIndex: newData.events?.[0]?.seriesIndex,
        seriesLength: newData.events?.[0]?.seriesLength
      });

      const transformedNewEvents = (newData.events || []).map(event => {
        logger.debug('🔧 Transforming event:', {
          eventId: event.eventId,
          hasEventSeriesId: !!event.eventSeriesId,
          eventSeriesId: event.eventSeriesId,
          seriesIndex: event.seriesIndex,
          seriesLength: event.seriesLength
        });

        return {
        _id: event._id,
        eventId: event.eventId,
        eventTitle: event.graphData?.subject || 'Untitled Event',
        eventDescription: event.graphData?.bodyPreview || '',
        startDateTime: event.graphData?.start?.dateTime,
        endDateTime: event.graphData?.end?.dateTime,
        requestedRooms: event.roomReservationData?.requestedRooms || [],
        requesterName: event.roomReservationData?.requestedBy?.name || '',
        requesterEmail: event.roomReservationData?.requestedBy?.email || '',
        department: event.roomReservationData?.requestedBy?.department || '',
        phone: event.roomReservationData?.requestedBy?.phone || '',
        attendeeCount: event.roomReservationData?.attendeeCount || 0,
        priority: event.roomReservationData?.priority || 'medium',
        specialRequirements: event.roomReservationData?.specialRequirements || '',
        status: event.status === 'room-reservation-request' ? 'pending' : event.status,
        submittedAt: event.roomReservationData?.submittedAt || event.lastModifiedDateTime,
        changeKey: event.roomReservationData?.changeKey,
        setupTime: event.roomReservationData?.timing?.setupTime || '',
        teardownTime: event.roomReservationData?.timing?.teardownTime || '',
        doorOpenTime: event.roomReservationData?.timing?.doorOpenTime || '',
        doorCloseTime: event.roomReservationData?.timing?.doorCloseTime || '',
        setupTimeMinutes: event.roomReservationData?.timing?.setupTimeMinutes || 0,
        teardownTimeMinutes: event.roomReservationData?.timing?.teardownTimeMinutes || 0,
        setupNotes: event.roomReservationData?.internalNotes?.setupNotes || '',
        doorNotes: event.roomReservationData?.internalNotes?.doorNotes || '',
        eventNotes: event.roomReservationData?.internalNotes?.eventNotes || '',
        contactName: event.roomReservationData?.contactPerson?.name || '',
        contactEmail: event.roomReservationData?.contactPerson?.email || '',
        isOnBehalfOf: event.roomReservationData?.contactPerson?.isOnBehalfOf || false,
        reviewNotes: event.roomReservationData?.reviewNotes || '',
        eventSeriesId: event.eventSeriesId || null,
        seriesIndex: event.seriesIndex || null,
        seriesLength: event.seriesLength || null,
        _isNewUnifiedEvent: true // Flag to identify source
      };
      });

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

  // Handle locked event click from SchedulingAssistant
  const handleLockedEventClick = async (reservationId) => {
    logger.debug('[ReservationRequests] Locked event clicked:', reservationId);

    // Find the reservation in our list
    const targetReservation = allReservations.find(r => r._id === reservationId);

    if (!targetReservation) {
      logger.error('[ReservationRequests] Could not find reservation with ID:', reservationId);
      alert('Could not find the selected reservation. It may have been deleted.');
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
      alert('Please provide a reason for rejection');
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

  const handleDelete = async (reservation) => {
    // Confirm deletion
    const confirmMessage = `Are you sure you want to permanently delete this reservation?\n\nEvent: ${reservation.eventTitle}\nRequester: ${reservation.roomReservationData?.requestedBy?.name || reservation.requesterName}\n\nThis action cannot be undone.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
    
    try {
      logger.debug('🗑️ Starting reservation deletion:', {
        reservationId: reservation._id,
        eventTitle: reservation.eventTitle
      });

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
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
      setError(`✅ Reservation "${result.eventTitle}" deleted successfully`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setError(''), 3000);
      
    } catch (err) {
      logger.error('❌ Error deleting reservation:', err);
      logger.error('Error deleting reservation:', err);
      setError(`Failed to delete reservation: ${err.message}`);
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
      <h1>Reservation Requests</h1>
      
      {error && (
        <div className="error-message">
          ❌ {error}
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
        </div>
      </div>
      
      {/* Reservations Table */}
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
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(reservation);
                    }}
                    title={`Delete reservation: ${reservation.eventTitle}`}
                  >
                    🗑️
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

      {/* Review Modal (using ReviewModal component) */}
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