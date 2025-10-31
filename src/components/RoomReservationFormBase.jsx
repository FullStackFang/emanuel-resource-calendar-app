// src/components/RoomReservationFormBase.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import SchedulingAssistant from './SchedulingAssistant';
import LocationListSelect from './LocationListSelect';
import './RoomReservationForm.css';

/**
 * RoomReservationFormBase - Shared logic and UI for room reservation forms
 * Used by both RoomReservationForm (creation) and RoomReservationReview (editing)
 */
export default function RoomReservationFormBase({
  // Initial data
  initialData = {},

  // Callbacks
  onDataChange = null,          // Called when form data changes (for parent tracking)
  onHasChangesChange = null,    // Called when hasChanges state changes (for Review)
  onAvailabilityChange = null,  // Called when availability data updates

  // Mode-specific props
  readOnly = false,             // Whether form fields are read-only
  isAdmin = false,              // Admin users can edit regardless of status
  reservationStatus = null,     // Status of reservation (for Review mode)
  currentReservationId = null,  // ID of current reservation (for Review mode)
  onLockedEventClick = null,    // Callback for locked events in scheduling assistant
  defaultCalendar = '',         // Default calendar for scheduling assistant

  // Rendering control
  activeTab = 'details',        // Which tab is active (for Review mode)
  showAllTabs = false,          // If true, render all content inline (for Creation mode)
  renderAdditionalContent = null, // Function to render additional content after form

  // Data exposure
  onFormDataRef = null,         // Callback to expose formData getter
  onTimeErrorsRef = null,       // Callback to expose timeErrors getter
  onValidateRef = null          // Callback to expose validation function
}) {
  // Form state
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
    isAllDayEvent: false,
    ...initialData
  });

  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [assistantRooms, setAssistantRooms] = useState([]);
  const [timeErrors, setTimeErrors] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { rooms, loading: roomsLoading } = useRooms();

  // Expose formData, timeErrors, and validation function to parent
  useEffect(() => {
    if (onFormDataRef) {
      onFormDataRef(() => formData);
    }
  }, [formData, onFormDataRef]);

  useEffect(() => {
    if (onTimeErrorsRef) {
      onTimeErrorsRef(() => timeErrors);
    }
  }, [timeErrors, onTimeErrorsRef]);

  useEffect(() => {
    if (onValidateRef) {
      onValidateRef(() => validateTimes);
    }
  }, [onValidateRef]);

  // Notify parent when hasChanges state changes
  useEffect(() => {
    if (onHasChangesChange) {
      onHasChangesChange(hasChanges);
    }
  }, [hasChanges, onHasChangesChange]);

  // Notify parent when availability changes
  useEffect(() => {
    if (onAvailabilityChange) {
      onAvailabilityChange(availability);
    }
  }, [availability, onAvailabilityChange]);

  // Initialize form data when initialData prop changes
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setFormData(prev => ({
        ...prev,
        ...initialData
      }));
    }
  }, [initialData]);

  // Helper function to convert time difference to minutes
  const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
    if (!eventTime || !bufferTime) return 0;

    const eventDate = new Date(`1970-01-01T${eventTime}:00`);
    const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);

    const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
    return Math.floor(diffMs / (1000 * 60));
  };

  // Check room availability
  const checkAvailability = async () => {
    try {
      setCheckingAvailability(true);

      const startDateTime = `${formData.startDate}T${formData.startTime}`;
      const endDateTime = `${formData.endDate}T${formData.endTime}`;

      let setupTimeMinutes = formData.setupTimeMinutes || 0;
      let teardownTimeMinutes = formData.teardownTimeMinutes || 0;

      if (formData.setupTime) {
        setupTimeMinutes = calculateTimeBufferMinutes(formData.startTime, formData.setupTime);
      }
      if (formData.teardownTime) {
        teardownTimeMinutes = calculateTimeBufferMinutes(formData.endTime, formData.teardownTime);
      }

      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        setupTimeMinutes,
        teardownTimeMinutes
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
      return;
    }

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

  // Check availability when dates or times change (for non-assistant mode)
  useEffect(() => {
    if (formData.startDate && formData.startTime && formData.endDate && formData.endTime && assistantRooms.length === 0) {
      checkAvailability();
    }
  }, [formData.startDate, formData.startTime, formData.endDate, formData.endTime, formData.setupTimeMinutes, formData.teardownTimeMinutes, formData.setupTime, formData.teardownTime, assistantRooms.length]);

  // Check day availability when assistant rooms or date changes
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
  }, [assistantRooms, formData.startDate]);

  // Update assistant rooms when selected rooms change
  useEffect(() => {
    const selectedRoomObjects = rooms.filter(room =>
      formData.requestedRooms.includes(room._id)
    );
    setAssistantRooms(selectedRoomObjects);
  }, [formData.requestedRooms, rooms]);

  // Validate time fields are in chronological order
  const validateTimes = useCallback(() => {
    const errors = [];
    const { setupTime, doorOpenTime, startTime, endTime, doorCloseTime, teardownTime, startDate, endDate } = formData;

    const createDateTime = (date, timeStr) => {
      if (!date || !timeStr) return null;
      return new Date(`${date}T${timeStr}`);
    };

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

    const eventStartDateTime = createDateTime(startDate, startTime);
    const eventEndDateTime = createDateTime(endDate, endTime);

    if (!startTime) {
      errors.push('Event Start Time is required');
    }
    if (!endTime) {
      errors.push('Event End Time is required');
    }

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

  // Event handlers
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const updatedData = {
      ...formData,
      [name]: value
    };
    setFormData(updatedData);
    setHasChanges(true);

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
    setAssistantRooms(prev => prev.filter(r => r._id !== room._id));
    setFormData(prev => ({
      ...prev,
      requestedRooms: prev.requestedRooms.filter(id => id !== room._id)
    }));
    setHasChanges(true);
  };

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

  const handleTimeSlotClick = (hour) => {
    logger.debug('Time slot clicked:', hour);
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

  // Determine if fields should be disabled
  const fieldsDisabled = readOnly || (!isAdmin && reservationStatus && reservationStatus !== 'pending');

  return (
    <div style={{ width: '100%' }}>
      {/* Tab: Event Details */}
      {(showAllTabs || activeTab === 'details') && (
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
                  disabled={fieldsDisabled}
                  required
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
                  disabled={fieldsDisabled}
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
                  placeholder="0"
                  disabled={fieldsDisabled}
                />
              </div>

              <div className="form-group">
                <label htmlFor="priority">Priority</label>
                <select
                  id="priority"
                  name="priority"
                  value={formData.priority}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
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
                  disabled={fieldsDisabled}
                  required
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
                  disabled={fieldsDisabled}
                  required
                />
              </div>
            </div>

            {/* All Day Event Toggle */}
            <div className="all-day-toggle-wrapper">
              <button
                type="button"
                className={`all-day-toggle ${formData.isAllDayEvent ? 'active' : ''}`}
                onClick={() => {
                  setFormData(prev => ({ ...prev, isAllDayEvent: !prev.isAllDayEvent }));
                  setHasChanges(true);
                }}
                disabled={fieldsDisabled}
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
                  disabled={fieldsDisabled}
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
                  disabled={fieldsDisabled}
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
                  disabled={fieldsDisabled}
                  required
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
                  disabled={fieldsDisabled}
                  required
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
                  disabled={fieldsDisabled}
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
                  disabled={fieldsDisabled}
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
              <div className="room-cards-section">
                {roomsLoading ? (
                  <div className="loading-message">Loading locations...</div>
                ) : rooms.length === 0 ? (
                  <div className="no-rooms-message">
                    No locations available. Please contact the office for assistance.
                  </div>
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
                  onTimeSlotClick={handleTimeSlotClick}
                  onRoomRemove={handleRemoveAssistantRoom}
                  onEventTimeChange={handleEventTimeChange}
                  currentReservationId={currentReservationId}
                  onLockedEventClick={onLockedEventClick}
                  defaultCalendar={defaultCalendar}
                  isAllDayEvent={formData.isAllDayEvent}
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Additional Information Section */}
      {(showAllTabs || activeTab === 'additional') && (
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
                disabled={fieldsDisabled}
                placeholder="Additional notes or special setup requirements..."
              />
            </div>

            {/* Admin Notes (Review mode only) */}
            {reservationStatus === 'pending' && (
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
                    disabled={fieldsDisabled}
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
                    disabled={fieldsDisabled}
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
                    disabled={fieldsDisabled}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: Submitter Information */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

                <div className="form-group full-width">
                  <label htmlFor="contactEmail">Contact Person Email</label>
                  <input
                    type="email"
                    id="contactEmail"
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={handleInputChange}
                    placeholder="Email for reservation updates (optional)"
                  />
                </div>
              </div>

              {formData.contactEmail && !formData.isOnBehalfOf && (
                <div className="delegation-info" style={{ marginTop: '8px' }}>
                  📧 Reservation updates will be sent to <strong>{formData.contactEmail}</strong>
                </div>
              )}

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

      {/* Render additional content (tabs, attachments, history, etc.) */}
      {renderAdditionalContent && renderAdditionalContent()}
    </div>
  );
}
