// src/components/UnifiedEventForm.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import UnifiedFormLayout from './UnifiedFormLayout';
import SchedulingAssistant from './SchedulingAssistant';
import LocationListSelect from './LocationListSelect';
import ReservationAuditHistory from './ReservationAuditHistory';
import AttachmentsSection from './AttachmentsSection';
import './RoomReservationForm.css'; // Import original form CSS for layout classes

/**
 * UnifiedEventForm - UNIFIED FORM for reservations, events, and new bookings
 * Supports three modes:
 * - 'create': New room reservation request (booking form)
 * - 'reservation': Room reservation review/editing (admin review modal)
 * - 'event': Calendar event editing (calendar click)
 */
export default function UnifiedEventForm({
  mode = 'reservation', // 'create', 'reservation', or 'event'
  // Common props
  apiToken,
  onCancel,
  // Create mode props
  isPublic = false,        // Public guest access (no auth required)
  token,                   // Guest access token for public submissions
  // Reservation-specific props
  reservation,
  onApprove,
  onReject,
  onSave,
  onHasChangesChange,
  onIsSavingChange,
  onSaveFunctionReady,
  onLockedEventClick,
  // Event-specific props
  event,
  categories,
  availableLocations,
  schemaExtensions,
  onDelete,
  readOnly,
  userTimeZone,
  savingEvent,
  // UI customization
  headerContent // Content to show in action bar header
}) {
  // Initialize form data from reservation
  const [formData, setFormData] = useState({
    requesterName: '',
    requesterEmail: '',
    department: '',
    phone: '',
    eventTitle: '',
    eventDescription: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    doorOpenTime: '',
    doorCloseTime: '',
    setupTime: '',
    teardownTime: '',
    setupNotes: '',
    doorNotes: '',
    eventNotes: '',
    attendeeCount: '',
    requestedRooms: [],
    specialRequirements: '',
    priority: 'medium',
    setupTimeMinutes: 0,
    teardownTimeMinutes: 0,
    contactEmail: '',
    contactName: '',
    isOnBehalfOf: false,
    reviewNotes: '',
    isAllDayEvent: false
  });

  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [assistantRooms, setAssistantRooms] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [timeErrors, setTimeErrors] = useState([]);
  const [originalChangeKey, setOriginalChangeKey] = useState(null);
  const [auditRefreshTrigger, setAuditRefreshTrigger] = useState(0);

  // Tab state for Attachments/History section
  const [activeHistoryTab, setActiveHistoryTab] = useState('attachments');

  // Create mode specific state
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [hasAutoFilled, setHasAutoFilled] = useState(false);

  const { rooms, loading: roomsLoading } = useRooms();
  const navigate = useNavigate();
  const { accounts } = useMsal();

  // Auto-fill user email/name in create mode (authenticated users only)
  useEffect(() => {
    if (mode === 'create' && !isPublic && accounts.length > 0 && !hasAutoFilled) {
      const userEmail = accounts[0].username;
      const displayName = accounts[0].name || '';

      setFormData(prev => ({
        ...prev,
        requesterEmail: userEmail,
        requesterName: displayName
      }));

      setHasAutoFilled(true);
      logger.debug('Auto-filled user info for authenticated user:', { userEmail, displayName });
    }
  }, [mode, isPublic, accounts, hasAutoFilled]);

  // Notify parent when hasChanges or isSaving changes
  useEffect(() => {
    if (onHasChangesChange) {
      onHasChangesChange(hasChanges);
    }
  }, [hasChanges, onHasChangesChange]);

  useEffect(() => {
    if (onIsSavingChange) {
      onIsSavingChange(isSaving);
    }
  }, [isSaving, onIsSavingChange]);

  // Initialize form data from reservation or event based on mode
  useEffect(() => {
    if (mode === 'reservation' && reservation) {
      console.log('📋 Initializing form data from reservation:', {
        id: reservation._id,
        startDateTime: reservation.startDateTime,
        endDateTime: reservation.endDateTime
      });

      const startDateTime = new Date(reservation.startDateTime);
      const endDateTime = new Date(reservation.endDateTime);

      // Validate dates
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        console.error('❌ Invalid date values in reservation:', {
          startDateTime: reservation.startDateTime,
          endDateTime: reservation.endDateTime
        });
        return;
      }

      setFormData({
        requesterName: reservation.requesterName || '',
        requesterEmail: reservation.requesterEmail || '',
        department: reservation.department || '',
        phone: reservation.phone || '',
        eventTitle: reservation.eventTitle || '',
        eventDescription: reservation.eventDescription || '',
        startDate: startDateTime.toISOString().split('T')[0],
        startTime: startDateTime.toTimeString().slice(0, 5),
        endDate: endDateTime.toISOString().split('T')[0],
        endTime: endDateTime.toTimeString().slice(0, 5),
        doorOpenTime: reservation.doorOpenTime || '',
        doorCloseTime: reservation.doorCloseTime || '',
        setupTime: reservation.setupTime || '',
        teardownTime: reservation.teardownTime || '',
        setupNotes: reservation.setupNotes || '',
        doorNotes: reservation.doorNotes || '',
        eventNotes: reservation.eventNotes || '',
        attendeeCount: reservation.attendeeCount || '',
        requestedRooms: reservation.requestedRooms || [],
        specialRequirements: reservation.specialRequirements || '',
        priority: reservation.priority || 'medium',
        setupTimeMinutes: reservation.setupTimeMinutes || 0,
        teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
        contactEmail: reservation.contactEmail || '',
        contactName: reservation.contactName || '',
        isOnBehalfOf: reservation.isOnBehalfOf || false,
        reviewNotes: reservation.reviewNotes || ''
      });

      setOriginalChangeKey(reservation.changeKey);
    } else if (mode === 'event' && event) {
      console.log('📋 Initializing form data from event:', {
        id: event.id,
        subject: event.subject,
        start: event.start
      });

      // Parse event dates (Graph API format)
      const startDateTime = event.start?.dateTime ? new Date(event.start.dateTime) : new Date();
      const endDateTime = event.end?.dateTime ? new Date(event.end.dateTime) : new Date();

      // Extract location names from event.location
      const locationString = typeof event.location === 'object'
        ? event.location?.displayName || ''
        : event.location || '';

      setFormData({
        // Map event fields to form data
        eventTitle: event.subject || '',
        eventDescription: event.body?.content || event.bodyPreview || '',
        startDate: startDateTime.toISOString().split('T')[0],
        startTime: startDateTime.toTimeString().slice(0, 5),
        endDate: endDateTime.toISOString().split('T')[0],
        endTime: endDateTime.toTimeString().slice(0, 5),
        // Event-specific fields
        requestedRooms: locationString ? locationString.split('; ').filter(Boolean) : [],
        attendeeCount: event.attendees?.length || '',
        // Internal enrichment fields (if available)
        setupTimeMinutes: event.internalEnrichment?.setupTimeMinutes || 0,
        teardownTimeMinutes: event.internalEnrichment?.teardownTimeMinutes || 0,
        setupTime: event.internalEnrichment?.setupTime || '',
        teardownTime: event.internalEnrichment?.teardownTime || '',
        doorOpenTime: event.internalEnrichment?.doorOpenTime || '',
        doorCloseTime: event.internalEnrichment?.doorCloseTime || '',
        setupNotes: event.internalEnrichment?.setupNotes || '',
        eventNotes: event.internalEnrichment?.notes || '',
        // For events, these fields may not be relevant
        requesterName: '',
        requesterEmail: '',
        department: '',
        phone: '',
        specialRequirements: '',
        priority: 'medium',
        contactEmail: '',
        contactName: '',
        isOnBehalfOf: false,
        reviewNotes: ''
      });

      setOriginalChangeKey(event.changeKey);
    }
  }, [mode, reservation, event]);

  // Check availability when dates or times change
  useEffect(() => {
    if (formData.startDate && formData.startTime && formData.endDate && formData.endTime) {
      checkAvailability();
    }
  }, [formData.startDate, formData.startTime, formData.endDate, formData.endTime, formData.setupTimeMinutes, formData.teardownTimeMinutes]);

  const checkAvailability = async () => {
    try {
      setCheckingAvailability(true);
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        setupTimeMinutes: formData.setupTimeMinutes || 0,
        teardownTimeMinutes: formData.teardownTimeMinutes || 0
      });

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`);
      if (!response.ok) throw new Error('Failed to check availability');

      const data = await response.json();
      setAvailability(data);
    } catch (err) {
      logger.error('Error checking availability:', err);
    } finally {
      setCheckingAvailability(false);
    }
  };

  // Check availability for the entire day for scheduling assistant
  const checkDayAvailability = async (roomIds, date) => {
    if (!roomIds.length || !date) return;

    try {
      const startDateTime = `${date}T00:00:00`;
      const endDateTime = `${date}T23:59:59`;

      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        roomIds: roomIds.join(','),
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0
      });

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`);
      if (!response.ok) throw new Error('Failed to check day availability');

      const data = await response.json();
      setAvailability(data);
    } catch (err) {
      logger.error('Error checking day availability:', err);
    }
  };

  // Update assistant rooms when selected rooms change
  useEffect(() => {
    const selectedRoomObjects = rooms.filter(room =>
      formData.requestedRooms.includes(room._id)
    );
    setAssistantRooms(selectedRoomObjects);
  }, [formData.requestedRooms, rooms]);

  // Check day availability when rooms or date change
  useEffect(() => {
    if (assistantRooms.length > 0 && formData.startDate) {
      const roomIds = assistantRooms.map(room => room._id);
      checkDayAvailability(roomIds, formData.startDate);
    }
  }, [assistantRooms, formData.startDate]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setHasChanges(true);
  };

  const handleRoomSelectionChange = (newSelectedRooms) => {
    setFormData(prev => ({
      ...prev,
      requestedRooms: newSelectedRooms
    }));
    setHasChanges(true);
  };

  const handleRemoveAssistantRoom = (room) => {
    setAssistantRooms(prev => prev.filter(r => r._id !== room._id));
    setFormData(prev => ({
      ...prev,
      requestedRooms: prev.requestedRooms.filter(id => id !== room._id)
    }));
    setHasChanges(true);
  };

  const checkRoomCapacity = (room) => {
    if (formData.attendeeCount && room.capacity < parseInt(formData.attendeeCount)) {
      return {
        meetsCapacity: false,
        issue: `Capacity too small (needs ${formData.attendeeCount}, has ${room.capacity})`
      };
    }
    return { meetsCapacity: true, issue: null };
  };

  // Validate time fields are in chronological order
  const validateTimes = useCallback(() => {
    const errors = [];
    const { setupTime, doorOpenTime, startTime, endTime, doorCloseTime, teardownTime, startDate, endDate } = formData;

    // Helper to create full datetime for comparison
    const createDateTime = (date, timeStr) => {
      if (!date || !timeStr) return null;
      return new Date(`${date}T${timeStr}`);
    };

    // Helper for same-day time comparison (for setup/teardown on same day)
    const timeToMinutes = (timeStr) => {
      if (!timeStr) return null;
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const setup = timeToMinutes(setupTime);
    const doorOpen = timeToMinutes(doorOpenTime);
    const eventStartMinutes = timeToMinutes(startTime);
    const eventEndMinutes = timeToMinutes(endTime);
    const doorClose = timeToMinutes(doorCloseTime);
    const teardown = timeToMinutes(teardownTime);

    // Create full datetime objects for start and end
    const eventStartDateTime = createDateTime(startDate, startTime);
    const eventEndDateTime = createDateTime(endDate, endTime);

    if (!startTime) errors.push('Event Start Time is required');
    if (!endTime) errors.push('Event End Time is required');

    // Compare full datetimes instead of just times
    if (eventStartDateTime && eventEndDateTime && eventStartDateTime >= eventEndDateTime) {
      errors.push('Event End Time must be after Event Start Time');
    }

    if (setup !== null && doorOpen !== null && setup > doorOpen) {
      errors.push('Door Open Time must be after Setup Start Time');
    }

    if (setup !== null && eventStartMinutes !== null && setup > eventStartMinutes) {
      errors.push('Event Start Time must be after Setup Start Time');
    }

    if (doorOpen !== null && eventStartMinutes !== null && doorOpen > eventStartMinutes) {
      errors.push('Event Start Time must be after Door Open Time');
    }

    if (eventEndMinutes !== null && doorClose !== null && eventEndMinutes > doorClose) {
      errors.push('Door Close Time must be after Event End Time');
    }

    if (eventEndMinutes !== null && teardown !== null && eventEndMinutes > teardown) {
      errors.push('Teardown End Time must be after Event End Time');
    }

    if (doorClose !== null && teardown !== null && doorClose > teardown) {
      errors.push('Teardown End Time must be after Door Close Time');
    }

    setTimeErrors(errors);
    return errors.length === 0;
  }, [formData]);

  // Validate times whenever time fields change
  useEffect(() => {
    if (formData.startTime || formData.endTime) {
      validateTimes();
    } else {
      setTimeErrors([]);
    }
  }, [formData.setupTime, formData.doorOpenTime, formData.startTime, formData.endTime, formData.doorCloseTime, formData.teardownTime, validateTimes]);

  const handleEventTimeChange = ({ startTime, endTime, setupTime, teardownTime, doorOpenTime, doorCloseTime }) => {
    setFormData(prev => ({
      ...prev,
      startTime,
      endTime,
      ...(setupTime && { setupTime }),
      ...(teardownTime && { teardownTime }),
      ...(doorOpenTime && { doorOpenTime }),
      ...(doorCloseTime && { doorCloseTime })
    }));
    setHasChanges(true);
  };

  const handleSaveChanges = useCallback(async () => {
    console.log('💾 Save button clicked', { hasChanges, reservation: reservation?._id });

    if (!hasChanges) {
      console.log('⚠️ No changes to save, returning early');
      return;
    }

    if (!validateTimes()) {
      console.log('❌ Time validation failed');
      alert('Cannot save: Please fix time validation errors');
      return;
    }

    console.log('✅ Validation passed, starting save...');
    setIsSaving(true);
    try {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const updatedData = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0
      };

      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/admin/room-reservations/${reservation._id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`,
            'If-Match': originalChangeKey || ''
          },
          body: JSON.stringify(updatedData)
        }
      );

      if (response.status === 409) {
        const data = await response.json();
        alert(`This reservation was modified by ${data.lastModifiedBy} while you were editing. Please refresh.`);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Save successful:', result);

      setOriginalChangeKey(result.changeKey);
      setHasChanges(false);
      setAuditRefreshTrigger(prev => prev + 1);

      if (onSave) {
        onSave(result);
      }

    } catch (error) {
      console.error('❌ Save error:', error);
      alert(`Failed to save changes: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [hasChanges, validateTimes, formData, reservation, apiToken, originalChangeKey, onSave]);

  // Expose save function to parent
  useEffect(() => {
    if (onSaveFunctionReady) {
      onSaveFunctionReady(handleSaveChanges);
    }
  }, [onSaveFunctionReady, handleSaveChanges]);

  // Handle new booking submission (create mode)
  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault();

    // Validate times before submission
    if (!validateTimes()) {
      setSubmitError('Please fix the time validation errors before submitting');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const payload = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0
      };

      // Remove separate date/time fields
      delete payload.startDate;
      delete payload.startTime;
      delete payload.endDate;
      delete payload.endTime;
      delete payload.reviewNotes; // Not needed for new submissions

      // Determine endpoint based on public/authenticated access
      const endpoint = isPublic
        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/public/${token}`
        : `${APP_CONFIG.API_BASE_URL}/events/request`;

      logger.debug('Submitting room reservation request:', { endpoint, isPublic });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken && { 'Authorization': `Bearer ${apiToken}` })
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit reservation');
      }

      const result = await response.json();
      logger.log('Room reservation submitted successfully:', result);

      setSuccess(true);

    } catch (err) {
      logger.error('Error submitting reservation:', err);
      setSubmitError(err.message || 'Failed to submit reservation request');
    } finally {
      setSubmitting(false);
    }
  }, [validateTimes, formData, isPublic, token, apiToken]);

  const handleApprove = () => {
    if (!validateTimes()) {
      logger.warn('Cannot approve - time validation errors exist');
      return;
    }

    if (onApprove) {
      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      const updatedData = {
        ...formData,
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(formData.attendeeCount) || 0,
        changeKey: originalChangeKey
      };

      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      onApprove(updatedData, formData.reviewNotes, originalChangeKey);
    }
  };

  const handleReject = () => {
    if (onReject) {
      onReject(formData.reviewNotes);
    }
  };

  // Determine if form fields should be disabled
  const isFormDisabled = mode === 'reservation'
    ? reservation?.status !== 'pending'
    : mode === 'event'
      ? readOnly
      : false; // Create mode - always editable

  // Configure actions for UnifiedFormLayout based on mode
  const actions = mode === 'create' ? [
    // Create mode actions
    {
      label: 'Submit Request',
      onClick: handleSubmit,
      className: 'submit-btn',
      icon: '✓',
      disabled: submitting || formData.requestedRooms.length === 0 || timeErrors.length > 0
    },
    {
      label: 'Cancel',
      onClick: onCancel || (() => navigate('/')),
      className: 'cancel-btn',
      disabled: submitting
    }
  ] : mode === 'reservation' ? [
    {
      label: 'Approve',
      onClick: handleApprove,
      className: 'approve-btn',
      icon: '✓',
      disabled: isSaving || timeErrors.length > 0 || reservation?.status !== 'pending'
    },
    {
      label: 'Reject',
      onClick: handleReject,
      className: 'reject-btn',
      icon: '✗',
      disabled: isSaving || reservation?.status !== 'pending'
    },
    {
      label: 'Save',
      onClick: handleSaveChanges,
      className: 'save-btn',
      icon: '💾',
      disabled: !hasChanges || isSaving
    },
    {
      label: 'Cancel',
      onClick: onCancel,
      className: 'cancel-btn',
      disabled: isSaving
    }
  ] : [
    // Event mode actions
    {
      label: 'Save',
      onClick: () => {
        if (onSave) {
          // Format event data for save
          const eventData = {
            id: event?.id,
            subject: formData.eventTitle,
            body: { content: formData.eventDescription, contentType: 'Text' },
            start: {
              dateTime: `${formData.startDate}T${formData.startTime}`,
              timeZone: userTimeZone || 'America/New_York'
            },
            end: {
              dateTime: `${formData.endDate}T${formData.endTime}`,
              timeZone: userTimeZone || 'America/New_York'
            },
            location: {
              displayName: formData.requestedRooms.join('; ')
            },
            // Internal enrichments
            internalEnrichment: {
              setupTimeMinutes: formData.setupTimeMinutes,
              teardownTimeMinutes: formData.teardownTimeMinutes,
              setupTime: formData.setupTime,
              teardownTime: formData.teardownTime,
              doorOpenTime: formData.doorOpenTime,
              doorCloseTime: formData.doorCloseTime,
              setupNotes: formData.setupNotes,
              notes: formData.eventNotes
            }
          };
          onSave(eventData);
        }
      },
      className: 'save-btn',
      icon: '💾',
      disabled: savingEvent || readOnly
    },
    {
      label: 'Delete',
      onClick: onDelete,
      className: 'reject-btn', // Use reject-btn for red delete button
      icon: '🗑',
      hidden: !onDelete || readOnly
    },
    {
      label: 'Cancel',
      onClick: onCancel,
      className: 'cancel-btn',
      disabled: savingEvent
    }
  ];

  // Determine title based on mode - use event title for more context
  const formTitle = mode === 'create'
    ? 'Space Booking Request'
    : mode === 'reservation'
      ? (formData.eventTitle
          ? `"${formData.eventTitle}" Details`
          : (reservation?.status === 'pending' ? 'Review Reservation Request' : 'View Reservation Details'))
      : (readOnly ? 'View Event' : 'Edit Event');

  // Success screen for create mode
  if (mode === 'create' && success) {
    return (
      <div className="room-reservation-form">
        <div className="success-message">
          <h2>✅ Reservation Request Submitted!</h2>
          <p>Your space booking request has been submitted successfully.</p>
          <p>You will receive a confirmation email once it has been reviewed.</p>

          <div className="form-actions" style={{ marginTop: '30px' }}>
            <button
              type="button"
              className="submit-btn"
              onClick={() => {
                if (isPublic) {
                  window.location.href = '/';
                } else {
                  navigate('/');
                }
              }}
            >
              Return to Calendar
            </button>

            {!isPublic && (
              <button
                type="button"
                className="cancel-btn"
                onClick={() => {
                  setSuccess(false);
                  setFormData({
                    requesterName: '',
                    requesterEmail: '',
                    department: '',
                    phone: '',
                    eventTitle: '',
                    eventDescription: '',
                    startDate: '',
                    startTime: '',
                    endDate: '',
                    endTime: '',
                    doorOpenTime: '',
                    doorCloseTime: '',
                    setupTime: '',
                    teardownTime: '',
                    setupNotes: '',
                    doorNotes: '',
                    eventNotes: '',
                    attendeeCount: '',
                    requestedRooms: [],
                    specialRequirements: '',
                    priority: 'medium',
                    setupTimeMinutes: 0,
                    teardownTimeMinutes: 0,
                    contactEmail: '',
                    contactName: '',
                    isOnBehalfOf: false,
                    reviewNotes: ''
                  });
                  setHasAutoFilled(false); // Allow re-autofill
                }}
              >
                Submit Another Request
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <UnifiedFormLayout
      title={formTitle}
      actions={actions}
      hasChanges={hasChanges}
      errors={{}}
      headerContent={headerContent}
    >
      {/* Error message display */}
      {submitError && (
        <div className="error-message" style={{ margin: '10px' }}>
          ❌ {submitError}
        </div>
      )}

      {/* Custom layout matching original RoomReservationReview */}
      <div className="room-reservation-form" style={{ maxWidth: '100%' }}>

        {/* Event Details (Left) + Room Selection/Timeline (Right) */}
        <div className="event-and-rooms-container">
          {/* Left Side - Event Details */}
          <section className="form-section event-details-compact">
            <h2>Event Details</h2>

            <div className="form-grid">
              <div className="form-group full-width">
                <label htmlFor="eventTitle">Event Title *</label>
                <input
                  type="text"
                  id="eventTitle"
                  name="eventTitle"
                  value={formData.eventTitle}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
              </div>

              <div className="form-group full-width">
                <label htmlFor="eventDescription">Event Description</label>
                <textarea
                  id="eventDescription"
                  name="eventDescription"
                  value={formData.eventDescription}
                  onChange={handleInputChange}
                  rows="3"
                  disabled={isFormDisabled}
                />
              </div>

              <div className="form-group">
                <label htmlFor="attendeeCount">Expected Attendees</label>
                <input
                  type="number"
                  id="attendeeCount"
                  name="attendeeCount"
                  value={formData.attendeeCount}
                  onChange={handleInputChange}
                  min="1"
                  disabled={isFormDisabled}
                />
              </div>

              <div className="form-group">
                <label htmlFor="priority">Priority</label>
                <select
                  id="priority"
                  name="priority"
                  value={formData.priority}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            {/* Date Fields */}
            <div className="time-field-row">
              <div className="form-group">
                <label htmlFor="startDate">Event Date *</label>
                <input
                  type="date"
                  id="startDate"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
              </div>

              <div className="form-group">
                <label htmlFor="endDate">End Date *</label>
                <input
                  type="date"
                  id="endDate"
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleInputChange}
                  min={formData.startDate}
                  disabled={isFormDisabled}
                />
              </div>
            </div>

            {/* All Day Event Toggle */}
            <div className="all-day-toggle-wrapper">
              <button
                type="button"
                className={`all-day-toggle ${formData.isAllDayEvent ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, isAllDayEvent: !prev.isAllDayEvent }))}
                disabled={isFormDisabled}
              >
                {formData.isAllDayEvent ? '✓ ' : ''}All Day Event
              </button>
              <span className="all-day-toggle-help">Display as all-day in calendar</span>
            </div>

            {/* Time Fields Stacked */}
            <div className="time-fields-stack">
              <div className="form-group">
                <label htmlFor="setupTime">Setup Start Time</label>
                <input
                  type="time"
                  id="setupTime"
                  name="setupTime"
                  value={formData.setupTime}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
                <div className="help-text">When setup can begin</div>
              </div>

              <div className="form-group">
                <label htmlFor="doorOpenTime">Door Open Time</label>
                <input
                  type="time"
                  id="doorOpenTime"
                  name="doorOpenTime"
                  value={formData.doorOpenTime}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
                <div className="help-text">When attendees can start entering</div>
              </div>

              <div className="form-group">
                <label htmlFor="startTime">Event Start Time *</label>
                <input
                  type="time"
                  id="startTime"
                  name="startTime"
                  value={formData.startTime}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
                <div className="help-text">When the event begins</div>
              </div>

              <div className="form-group">
                <label htmlFor="endTime">Event End Time *</label>
                <input
                  type="time"
                  id="endTime"
                  name="endTime"
                  value={formData.endTime}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
                <div className="help-text">When the event ends</div>
              </div>

              <div className="form-group">
                <label htmlFor="doorCloseTime">Door Close Time</label>
                <input
                  type="time"
                  id="doorCloseTime"
                  name="doorCloseTime"
                  value={formData.doorCloseTime}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
                <div className="help-text">When doors will be locked</div>
              </div>

              <div className="form-group">
                <label htmlFor="teardownTime">Teardown End Time</label>
                <input
                  type="time"
                  id="teardownTime"
                  name="teardownTime"
                  value={formData.teardownTime}
                  onChange={handleInputChange}
                  disabled={isFormDisabled}
                />
                <div className="help-text">When cleanup must be completed</div>
              </div>
            </div>
          </section>

          {/* Right Side - Resource Details */}
          <section className="form-section">
            <h2>Resource Details</h2>

            <div className="room-selection-container">
              {/* Scheduling Assistant + Room List */}
              <div className={`scheduling-assistant-container ${formData.isAllDayEvent ? 'scheduling-assistant-disabled' : ''}`}>
                {formData.isAllDayEvent && (
                  <div className="scheduling-assistant-disabled-message">
                    <h4>All Day Event</h4>
                    <p>Time-specific scheduling not needed for all-day events</p>
                  </div>
                )}
                {assistantRooms.length > 0 ? (
                  <SchedulingAssistant
                    selectedRooms={assistantRooms}
                    selectedDate={formData.startDate}
                    eventStartTime={formData.startTime}
                    eventEndTime={formData.endTime}
                    setupTime={formData.setupTime}
                    teardownTime={formData.teardownTime}
                    doorOpenTime={formData.doorOpenTime}
                    doorCloseTime={formData.doorCloseTime}
                    eventTitle={formData.eventTitle}
                    availability={availability}
                    onRoomRemove={handleRemoveAssistantRoom}
                    onEventTimeChange={handleEventTimeChange}
                    currentReservationId={reservation?._id}
                    onLockedEventClick={onLockedEventClick}
                    isAllDayEvent={formData.isAllDayEvent}
                  />
                ) : (
                  <p style={{ textAlign: 'center', color: '#6b7280', padding: '20px' }}>
                    Select rooms below to see schedule visualization
                  </p>
                )}
              </div>

              <div className="room-cards-section">
                <LocationListSelect
                  rooms={rooms}
                  selectedRooms={formData.requestedRooms}
                  onRoomSelectionChange={handleRoomSelectionChange}
                  availability={availability}
                  checkingAvailability={checkingAvailability}
                  checkRoomCapacity={checkRoomCapacity}
                  disabled={isFormDisabled}
                />
              </div>
            </div>
          </section>
        </div>

        {/* Additional Information (Left) + Contact Info + History (Right) */}
        <div className="section-row-2col">
          {/* Left Column - Additional Information */}
          <section className="form-section">
            <h2>Additional Information</h2>

            {/* Special Requirements - show in create and reservation modes */}
            {(mode === 'create' || mode === 'reservation') && (
              <div className="form-group full-width" style={{ marginBottom: '20px' }}>
                <label htmlFor="specialRequirements">Special Requirements</label>
                <textarea
                  id="specialRequirements"
                  name="specialRequirements"
                  value={formData.specialRequirements}
                  onChange={handleInputChange}
                  rows="2"
                  placeholder="Additional notes or special setup requirements..."
                  disabled={isFormDisabled}
                />
              </div>
            )}

            {mode === 'reservation' && (
              <>

                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ color: '#333', marginBottom: '10px', fontSize: '1rem' }}>
                    Admin Notes / Rejection Reason
                  </h4>
                  <div className="form-group full-width">
                    <label htmlFor="reviewNotes">Notes</label>
                    <textarea
                      id="reviewNotes"
                      name="reviewNotes"
                      value={formData.reviewNotes}
                      onChange={handleInputChange}
                      rows="2"
                      placeholder="Add any notes or provide a reason for rejection..."
                    />
                  </div>
                </div>
              </>
            )}

            <div className="internal-notes-section">
              <h4>🔒 Internal Notes (Staff Use Only)</h4>
              <div className="internal-notes-disclaimer">
                These notes are for internal staff coordination and will not be visible to the requester.
              </div>

              <div className="notes-field-row">
                <div className="form-group">
                  <label htmlFor="setupNotes">Setup Notes</label>
                  <textarea
                    id="setupNotes"
                    name="setupNotes"
                    value={formData.setupNotes}
                    onChange={handleInputChange}
                    rows="1"
                  />
                </div>
              </div>

              <div className="notes-field-row">
                <div className="form-group">
                  <label htmlFor="doorNotes">Door/Access Notes</label>
                  <textarea
                    id="doorNotes"
                    name="doorNotes"
                    value={formData.doorNotes}
                    onChange={handleInputChange}
                    rows="1"
                  />
                </div>
              </div>

              <div className="notes-field-row">
                <div className="form-group">
                  <label htmlFor="eventNotes">Event Notes</label>
                  <textarea
                    id="eventNotes"
                    name="eventNotes"
                    value={formData.eventNotes}
                    onChange={handleInputChange}
                    rows="1"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Right Column - Contact Info */}
          {(mode === 'create' || mode === 'reservation') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="form-section">
                <h2>{mode === 'create' ? 'Your Information' : 'Submitter Information'}</h2>

                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="requesterName">Name *</label>
                    <input
                      type="text"
                      id="requesterName"
                      name="requesterName"
                      value={formData.requesterName}
                      onChange={handleInputChange}
                      readOnly={mode === 'reservation'}
                      className={mode === 'reservation' ? 'readonly-field' : ''}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="requesterEmail">Email *</label>
                    <input
                      type="email"
                      id="requesterEmail"
                      name="requesterEmail"
                      value={formData.requesterEmail}
                      onChange={handleInputChange}
                      readOnly={mode === 'reservation'}
                      className={mode === 'reservation' ? 'readonly-field' : ''}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="department">Department</label>
                    <input
                      type="text"
                      id="department"
                      name="department"
                      value={formData.department}
                      onChange={handleInputChange}
                      disabled={mode === 'reservation' && isFormDisabled}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="phone">Phone</label>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      disabled={mode === 'reservation' && isFormDisabled}
                    />
                  </div>
                </div>
              </section>

              {/* Attachments & History Tabs - only in reservation mode */}
              {mode === 'reservation' && (
                <section className="form-section">
                  {/* Nested Tab Headers */}
                  <div className="history-tabs-container">
                    <div className="history-tabs">
                      <div
                        className={`history-tab ${activeHistoryTab === 'attachments' ? 'active' : ''}`}
                        onClick={() => setActiveHistoryTab('attachments')}
                      >
                        📎 Attachments
                      </div>
                      <div
                        className={`history-tab ${activeHistoryTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveHistoryTab('history')}
                      >
                        📝 History
                      </div>
                    </div>
                  </div>

                  {/* Tab Content */}
                  <div className="history-tab-content">
                    {activeHistoryTab === 'attachments' ? (
                      <AttachmentsSection
                        resourceId={reservation?.eventId}
                        resourceType="event"
                        apiToken={apiToken}
                        readOnly={reservation?.status === 'inactive'}
                      />
                    ) : (
                      <ReservationAuditHistory
                        reservationId={reservation?._id}
                        apiToken={apiToken}
                        refreshTrigger={auditRefreshTrigger}
                      />
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

      </div>
    </UnifiedFormLayout>
  );
}
