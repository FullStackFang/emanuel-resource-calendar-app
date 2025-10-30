// src/components/RoomReservationReview.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import SchedulingAssistant from './SchedulingAssistant';
import LocationListSelect from './LocationListSelect';
import ReservationAuditHistory from './ReservationAuditHistory';
import EventAuditHistory from './EventAuditHistory';
import AttachmentsSection from './AttachmentsSection';
import './RoomReservationForm.css';

/**
 * RoomReservationReview - Edit mode for existing reservations
 * Reuses RoomReservationForm UI/styling but for reviewing/editing pending requests
 */
export default function RoomReservationReview({
  reservation,
  apiToken,
  onApprove,
  onReject,
  onCancel,
  onSave,
  onHasChangesChange,
  onIsSavingChange,
  onSaveFunctionReady,
  onDataChange, // Callback to update parent's editableData for real-time title updates
  onLockedEventClick, // Callback when a locked reservation is clicked in scheduling assistant
  availableCalendars = [],
  defaultCalendar = '',
  selectedTargetCalendar = '',
  onTargetCalendarChange = () => {},
  createCalendarEvent = true,
  onCreateCalendarEventChange = () => {},
  activeTab = 'details' // Received from ReviewModal
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

  const { rooms, loading: roomsLoading } = useRooms();

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

  // Initialize form data from reservation
  useEffect(() => {
    if (reservation) {
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
          endDateTime: reservation.endDateTime,
          parsedStart: startDateTime,
          parsedEnd: endDateTime
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

      // Store original changeKey for optimistic concurrency control
      setOriginalChangeKey(reservation.changeKey);
    }
  }, [reservation]);

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
    if (!roomIds.length || !date) {
      console.log('[RoomReservationReview] checkDayAvailability skipped - no rooms or date');
      return;
    }

    try {
      // Set time range for the entire day (24 hours)
      const startDateTime = `${date}T00:00:00`;
      const endDateTime = `${date}T23:59:59`;

      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        roomIds: roomIds.join(','),
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0
      });

      const url = `${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`;
      console.log('[RoomReservationReview] Fetching day availability:', {
        url,
        roomIds,
        date,
        startDateTime,
        endDateTime
      });

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to check day availability');

      const data = await response.json();
      console.log('[RoomReservationReview] Day availability response:', data);
      console.log('[RoomReservationReview] Total reservations returned:', data[0]?.conflicts?.reservations?.length || 0);
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

  // Check availability when assistant rooms or dates change
  // NOTE: We only check when DATE changes, not TIME - this ensures all events for the day remain visible
  // Time changes (like drag operations) should not trigger a new API call
  useEffect(() => {
    if (assistantRooms.length > 0) {
      const roomIds = assistantRooms.map(room => room._id);
      const getTodayDate = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const dateToCheck = formData.startDate || getTodayDate();
      checkDayAvailability(roomIds, dateToCheck);
    }
  }, [assistantRooms, formData.startDate, formData.endDate]); // Removed formData.startTime and formData.endTime

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const updatedData = {
      ...formData,
      [name]: value
    };
    setFormData(updatedData);
    setHasChanges(true);

    // Notify parent of data change for real-time updates (e.g., modal title)
    if (onDataChange) {
      onDataChange(updatedData);
    }
  };

  const handleRoomSelectionChange = (newSelectedRooms) => {
    setFormData(prev => ({
      ...prev,
      requestedRooms: newSelectedRooms
    }));
    setHasChanges(true);
  };

  const handleRemoveAssistantRoom = (room) => {
    // Remove from both assistant rooms and form data to ensure it persists
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

    // Convert times to comparable numbers (minutes since midnight) for same-day comparisons
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

    // Check required times exist
    if (!startTime) {
      errors.push('Event Start Time is required');
    }
    if (!endTime) {
      errors.push('Event End Time is required');
    }

    // Validate chronological order using full datetimes
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
    // Update form times when user drags the event in scheduling assistant
    setFormData(prev => ({
      ...prev,
      startTime,
      endTime,
      // Update setupTime/teardownTime if provided (they represent the new blocking times)
      ...(setupTime && { setupTime }),
      ...(teardownTime && { teardownTime }),
      // Update doorOpenTime/doorCloseTime if provided
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

    // Validate times before saving
    if (!validateTimes()) {
      console.log('❌ Time validation failed');
      logger.warn('Cannot save - time validation errors exist');
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

      // Remove separate date/time fields
      delete updatedData.startDate;
      delete updatedData.startTime;
      delete updatedData.endDate;
      delete updatedData.endTime;

      console.log('📤 Sending save request to API...', { reservationId: reservation._id });

      // Make API call with If-Match header for optimistic concurrency control
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

      console.log('📥 API response received:', { status: response.status, ok: response.ok });

      // Handle conflict (409)
      if (response.status === 409) {
        const data = await response.json();
        const changes = data.changes || [];
        const changesList = changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n');

        const message = `This reservation was modified by ${data.lastModifiedBy} while you were editing.\n\n` +
                       `Changes made:\n${changesList}\n\n` +
                       `Your changes have NOT been saved. Please refresh to see the latest version.\n` +
                       `(Your changes will be lost)`;

        console.log('⚠️ Conflict detected (409):', data);
        alert(message);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to save changes: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Save successful:', result);

      // Update originalChangeKey with the new changeKey from server
      setOriginalChangeKey(result.changeKey);
      setHasChanges(false);

      // Refresh audit history
      setAuditRefreshTrigger(prev => prev + 1);

      // Notify parent of successful save (so it can update its changeKey if needed)
      if (onSave) {
        onSave(result);
      }

    } catch (error) {
      console.error('❌ Save error:', error);
      logger.error('Error saving changes:', error);
      alert(`Failed to save changes: ${error.message}`);
    } finally {
      setIsSaving(false);
      console.log('💾 Save process complete');
    }
  }, [hasChanges, validateTimes, formData, reservation, apiToken, originalChangeKey, onSave]);

  // Expose save function to parent
  useEffect(() => {
    if (onSaveFunctionReady) {
      console.log('🔄 Updating save function reference in parent');
      onSaveFunctionReady(handleSaveChanges);
    }
  }, [onSaveFunctionReady, handleSaveChanges]);

  const handleApprove = () => {
    // Validate times before approval
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
        changeKey: originalChangeKey  // Include changeKey for optimistic concurrency control
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

  return (
    <div className="room-reservation-form" style={{ maxWidth: '100%', padding: '10px' }}>
      <form onSubmit={(e) => e.preventDefault()}>
        {/* Tab: Event Details */}
        {activeTab === 'details' && (
        <div className="event-and-rooms-container">
          {/* Event Details - Left Side */}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                name="priority"
                value={formData.priority}
                onChange={handleInputChange}
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
              />
            </div>
          </div>

          {/* All Day Event Toggle */}
          <div className="all-day-toggle-wrapper">
            <button
              type="button"
              className={`all-day-toggle ${formData.isAllDayEvent ? 'active' : ''}`}
              onClick={() => setFormData(prev => ({ ...prev, isAllDayEvent: !prev.isAllDayEvent }))}
              disabled={reservation?.status !== 'pending'}
            >
              {formData.isAllDayEvent ? '✓ ' : ''}All Day Event
            </button>
            <span className="all-day-toggle-help">Display as all-day in calendar</span>
          </div>

          {/* Time Fields Stacked in Chronological Order */}
          <div className="time-fields-stack">
            <div className="form-group">
              <label htmlFor="setupTime">Setup Start Time</label>
              <input
                type="time"
                id="setupTime"
                name="setupTime"
                value={formData.setupTime}
                onChange={handleInputChange}
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
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
                disabled={reservation?.status !== 'pending'}
              />
              <div className="help-text">When cleanup must be completed</div>
            </div>
          </div>

          {/* Time Validation Errors */}
          {timeErrors.length > 0 && (
            <div className="time-validation-errors">
              <h4>⚠️ Time Validation Issues:</h4>
              <ul>
                {timeErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
              <p className="validation-help">
                Times should follow this order: Setup Start → Door Open → Event Start → Event End → Door Close → Teardown End
              </p>
            </div>
          )}

          </section>

          {/* Resource Details - Right Side */}
          <section className="form-section">
            <h2>Resource Details</h2>

          {checkingAvailability && (
            <div className="loading-message">Checking availability...</div>
          )}

          <div className="room-selection-container">
            <div className={`scheduling-assistant-container ${formData.isAllDayEvent ? 'scheduling-assistant-disabled' : ''}`}>
              {formData.isAllDayEvent && (
                <div className="scheduling-assistant-disabled-message">
                  <h4>All Day Event</h4>
                  <p>Time-specific scheduling not needed for all-day events</p>
                </div>
              )}
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
                defaultCalendar={defaultCalendar}
                isAllDayEvent={formData.isAllDayEvent}
              />
            </div>

            <div className="room-cards-section">
              {roomsLoading ? (
                <div className="loading-message">Loading locations...</div>
              ) : (
                <LocationListSelect
                  rooms={rooms}
                  availability={availability}
                  selectedRooms={formData.requestedRooms}
                  onRoomSelectionChange={handleRoomSelectionChange}
                  checkRoomCapacity={checkRoomCapacity}
                  label="Requested locations"
                  eventStartTime={formData.startTime}
                  eventEndTime={formData.endTime}
                  eventDate={formData.startDate}
                />
              )}
            </div>
          </div>
          </section>
        </div>
        )}
        {/* End of Event Details Tab */}

        {/* Tab: Additional Info */}
        {activeTab === 'additional' && (
        <div className="section-row-2col">
          {/* Left Column: Additional Information */}
          <section className="form-section">
            <h2>Additional Information</h2>

            {/* Special Requirements */}
            <div className="form-group full-width" style={{ marginBottom: '20px' }}>
              <label htmlFor="specialRequirements">Special Requirements</label>
              <textarea
                id="specialRequirements"
                name="specialRequirements"
                value={formData.specialRequirements}
                onChange={handleInputChange}
                rows="2"
                disabled={reservation?.status !== 'pending'}
                placeholder="Additional notes or special setup requirements..."
              />
            </div>

            {/* Admin Notes */}
            {reservation?.status === 'pending' && (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ color: '#333', marginBottom: '10px', fontSize: '1rem' }}>Admin Notes / Rejection Reason</h4>
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
            )}

            {/* Internal Notes Section */}
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
                    disabled={reservation?.status !== 'pending'}
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
                    disabled={reservation?.status !== 'pending'}
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
                    disabled={reservation?.status !== 'pending'}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: Submitter Info + Reservation History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Submitter Information */}
            <section className="form-section">
              <h2>Submitter Information</h2>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="requesterName">Requester Name</label>
                  <input
                    type="text"
                    id="requesterName"
                    name="requesterName"
                    value={formData.requesterName}
                    readOnly
                    className="readonly-field"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="requesterEmail">Requester Email</label>
                  <input
                    type="email"
                    id="requesterEmail"
                    name="requesterEmail"
                    value={formData.requesterEmail}
                    readOnly
                    className="readonly-field"
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
                  />
                </div>
              </div>

              {formData.isOnBehalfOf && formData.contactName && (
                <div className="form-grid" style={{ marginTop: '15px' }}>
                  <div className="form-group">
                    <label>Contact Person</label>
                    <input
                      type="text"
                      value={`${formData.contactName} (${formData.contactEmail})`}
                      readOnly
                      className="readonly-field"
                    />
                    <div className="delegation-info" style={{ marginTop: '8px' }}>
                      📋 This request was submitted on behalf of this person
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
        )}
        {/* End of Additional Info Tab */}

        {/* Tab: Attachments */}
        {activeTab === 'attachments' && reservation && apiToken && (
          <div style={{ padding: '20px' }}>
            <AttachmentsSection
              resourceId={reservation?.eventId}
              resourceType="event"
              apiToken={apiToken}
              readOnly={reservation?.status === 'inactive'}
            />
          </div>
        )}

        {/* Tab: History */}
        {activeTab === 'history' && reservation && apiToken && (
          <div style={{ padding: '20px' }}>
            {reservation._isNewUnifiedEvent ? (
              <EventAuditHistory
                eventId={reservation.eventId}
                apiToken={apiToken}
              />
            ) : (
              <ReservationAuditHistory
                reservationId={reservation._id}
                apiToken={apiToken}
                refreshTrigger={auditRefreshTrigger}
              />
            )}
          </div>
        )}
      </form>
    </div>
  );
}
