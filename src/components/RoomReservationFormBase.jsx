// src/components/RoomReservationFormBase.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import SchedulingAssistant from './SchedulingAssistant';
import LocationListSelect from './LocationListSelect';
import MultiDatePicker from './MultiDatePicker';
import './RoomReservationForm.css';

/**
 * Virtual Event Detection Utilities
 */
const isVirtualLocation = (locationString) => {
  if (!locationString) return false;
  const urlPattern = /^https?:\/\//i;
  return urlPattern.test(locationString.trim());
};

const getVirtualPlatform = (locationString) => {
  if (!locationString) return 'Virtual';
  const lower = locationString.toLowerCase();

  if (lower.includes('zoom.us')) return 'Zoom';
  if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) return 'Teams';
  if (lower.includes('meet.google.com')) return 'Google Meet';
  if (lower.includes('webex.com')) return 'Webex';

  return 'Virtual';
};

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
  apiToken = null,              // API token for authenticated requests

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

  // Ad hoc dates state - persistent container of additional dates
  const [showAdHocPicker, setShowAdHocPicker] = useState(false); // Show/hide calendar picker
  const [adHocDates, setAdHocDates] = useState([]); // Array of YYYY-MM-DD strings for ad hoc dates

  // Series navigation state
  const [seriesEvents, setSeriesEvents] = useState([]); // Array of events in the series
  const [currentEventId, setCurrentEventId] = useState(null); // Current event ID for highlighting

  const { rooms, loading: roomsLoading } = useRooms();

  // Refs to prevent unnecessary re-initialization of form data
  const isInitializedRef = useRef(false);
  const lastReservationIdRef = useRef(null);

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
  // Guard against unnecessary re-initialization to prevent user input from being reset
  useEffect(() => {
    // Only initialize if:
    // 1. We have initialData with content
    // 2. AND (this is first initialization OR reservation ID changed)
    const hasInitialData = initialData && Object.keys(initialData).length > 0;
    const isNewReservation = currentReservationId !== lastReservationIdRef.current;
    const shouldInitialize = hasInitialData && (!isInitializedRef.current || isNewReservation);

    if (shouldInitialize) {
      logger.debug('[RoomReservationFormBase] Initializing form data', {
        isFirstInit: !isInitializedRef.current,
        isNewReservation,
        reservationId: currentReservationId
      });

      const newData = {
        ...initialData
      };

      // Auto-populate doorCloseTime with endTime if endTime exists
      if (newData.endTime && !newData.doorCloseTime) {
        newData.doorCloseTime = newData.endTime;
      }

      // Auto-populate teardownTime with endTime + 1 hour if not already set
      if (newData.endTime && !newData.teardownTime) {
        const [hours, minutes] = newData.endTime.split(':');
        const endTimeDate = new Date();
        endTimeDate.setHours(parseInt(hours), parseInt(minutes));
        endTimeDate.setHours(endTimeDate.getHours() + 1);
        const teardownHours = String(endTimeDate.getHours()).padStart(2, '0');
        const teardownMinutes = String(endTimeDate.getMinutes()).padStart(2, '0');
        newData.teardownTime = `${teardownHours}:${teardownMinutes}`;
      }

      setFormData(prev => ({
        ...prev,
        ...newData
      }));

      // Mark as initialized and store current reservation ID
      isInitializedRef.current = true;
      lastReservationIdRef.current = currentReservationId;

      // Set current event ID for series navigation highlighting
      if (newData.eventId) {
        setCurrentEventId(newData.eventId);
      }
    }
  }, [initialData, currentReservationId]);

  // Fetch series events when opening an event with eventSeriesId
  useEffect(() => {
    const fetchSeriesEvents = async () => {
      console.log('🔍 Series Events Fetch - Initial Data:', {
        hasEventSeriesId: !!initialData?.eventSeriesId,
        eventSeriesId: initialData?.eventSeriesId,
        eventId: initialData?.eventId,
        fullInitialData: initialData
      });

      if (!initialData?.eventSeriesId) {
        console.log('❌ No eventSeriesId in initialData, skipping series fetch');
        setSeriesEvents([]);
        return;
      }

      try {
        logger.debug(`Fetching series events for eventSeriesId: ${initialData.eventSeriesId}`);
        const headers = {
          'Content-Type': 'application/json'
        };

        // Add Authorization header if apiToken is available
        if (apiToken) {
          headers['Authorization'] = `Bearer ${apiToken}`;
        }

        const response = await fetch(
          `${APP_CONFIG.API_BASE_URL}/events/series/${initialData.eventSeriesId}`,
          { headers }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch series events');
        }

        const data = await response.json();
        console.log('✅ Series Events Fetched:', {
          count: data.events?.length || 0,
          events: data.events,
          fullResponse: data
        });
        setSeriesEvents(data.events || []);
        logger.debug(`Loaded ${data.events?.length || 0} events in series`);
      } catch (error) {
        logger.error('Error fetching series events:', error);
        setSeriesEvents([]);
      }
    };

    fetchSeriesEvents();
  }, [initialData?.eventSeriesId, apiToken]);

  // Helper function to convert time difference to minutes
  const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
    if (!eventTime || !bufferTime) return 0;

    const eventDate = new Date(`1970-01-01T${eventTime}:00`);
    const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);

    const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
    return Math.floor(diffMs / (1000 * 60));
  };

  // Helper function to format time string from HH:MM (24-hour) to "H:MM AM/PM" (12-hour)
  const formatTimeString = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${period}`;
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

    // Auto-populate doorCloseTime and teardownTime when endTime changes
    if (name === 'endTime' && value) {
      // Always sync doorCloseTime with endTime
      updatedData.doorCloseTime = value;

      // Pre-populate teardownTime with endTime + 1 hour (only if currently empty)
      if (!formData.teardownTime) {
        const [hours, minutes] = value.split(':');
        const endTimeDate = new Date();
        endTimeDate.setHours(parseInt(hours), parseInt(minutes));
        endTimeDate.setHours(endTimeDate.getHours() + 1);
        const teardownHours = String(endTimeDate.getHours()).padStart(2, '0');
        const teardownMinutes = String(endTimeDate.getMinutes()).padStart(2, '0');
        updatedData.teardownTime = `${teardownHours}:${teardownMinutes}`;
      }
    }

    setFormData(updatedData);
    setHasChanges(true);

    if (onDataChange) {
      onDataChange(updatedData);
    }
  };

  const handleRoomSelectionChange = (newSelectedRooms) => {
    const updatedData = {
      ...formData,
      requestedRooms: newSelectedRooms
    };
    setFormData(updatedData);
    setHasChanges(true);

    // Notify parent component of change so save button gets enabled
    if (onDataChange) {
      onDataChange(updatedData);
    }
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

  // Toggle ad hoc calendar picker visibility
  const handleToggleAdHocPicker = () => {
    setShowAdHocPicker(prev => !prev);
  };

  // Handle changes to ad hoc dates
  const handleAdHocDatesChange = (newDates) => {
    setAdHocDates(newDates);
    setHasChanges(true);

    // Also notify parent component of change
    if (onDataChange) {
      onDataChange({ ...formData, adHocDates: newDates });
    }
  };

  // Handle series event navigation click
  const handleSeriesEventClick = (event) => {
    logger.debug('Series event clicked:', event);

    // Check if there are unsaved changes
    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to navigate to another event in the series? Your changes will be lost.'
      );

      if (!confirmed) {
        return; // User cancelled navigation
      }
    }

    // Call parent callback to handle navigation (close modal and open new event)
    if (onLockedEventClick) {
      // Use onLockedEventClick as the navigation callback
      // Parent components should handle this to close current modal and open the clicked event
      onLockedEventClick({
        eventId: event.eventId,
        graphId: event.graphId,
        startDate: event.startDate,
        subject: event.subject,
        isSeriesNavigation: true
      });
    }
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
            </div>

            {/* Expected Attendees and Toggle Ad Hoc Button Row */}
            <div className="time-field-row">
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
                <label style={{ visibility: 'hidden' }}>.</label>
                <button
                  type="button"
                  onClick={handleToggleAdHocPicker}
                  disabled={fieldsDisabled}
                  style={{
                    padding: '8px 16px',
                    background: showAdHocPicker ? '#e8f0fe' : '#f8f9fa',
                    border: '1px solid #dadce0',
                    borderRadius: '4px',
                    cursor: fieldsDisabled ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: showAdHocPicker ? '#1a73e8' : '#5f6368',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                    width: '100%'
                  }}
                >
                  {showAdHocPicker ? '✓ ' : ''}Toggle Event Series
                </button>
              </div>
            </div>

            {/* Ad Hoc Calendar Picker - Show when toggled on */}
            {showAdHocPicker && (
              <div className="multi-date-picker-wrapper" style={{ marginBottom: '16px' }}>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: '#5f6368' }}>
                  Click dates on the calendar to add additional ad hoc dates
                </div>
                <MultiDatePicker
                  selectedDates={adHocDates}
                  onDatesChange={handleAdHocDatesChange}
                  disabled={fieldsDisabled}
                  seriesEvents={seriesEvents}
                  currentEventId={currentEventId}
                  onSeriesEventClick={handleSeriesEventClick}
                />
              </div>
            )}

            {/* Ad Hoc Dates Container - Always show when there are dates */}
            {!showAdHocPicker && adHocDates.length > 0 && (
              <div style={{ marginBottom: '16px', background: '#f8f9fa', borderRadius: '8px', padding: '16px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '12px'
                }}>
                  <span style={{ fontSize: '13px', fontWeight: '500', color: '#5f6368' }}>
                    {adHocDates.length} ad hoc date{adHocDates.length !== 1 ? 's' : ''} added
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[...adHocDates].sort().map(dateStr => {
                    const date = new Date(dateStr + 'T00:00:00');
                    const formattedDate = date.toLocaleDateString('en-US', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    });
                    return (
                      <div key={dateStr} className="date-chip">
                        <span className="date-text">{formattedDate}</span>
                        <button
                          type="button"
                          className="remove-date-btn"
                          onClick={() => handleAdHocDatesChange(adHocDates.filter(d => d !== dateStr))}
                          disabled={fieldsDisabled}
                          aria-label={`Remove ${formattedDate}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Date Fields - Always visible */}
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

            {/* All Day Event Toggle with Virtual Event Platform */}
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

              {/* Virtual Event Platform Pill - Inline */}
              {(initialData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl) && (
                <div className="virtual-platform-pill">
                  {getVirtualPlatform(initialData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl)}
                </div>
              )}
            </div>

            {/* Virtual Meeting Link Pill */}
            {(initialData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl) && (
              <div className="virtual-link-wrapper">
                <a
                  href={initialData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="virtual-link-pill"
                >
                  <span className="virtual-link-icon">🌐</span>
                  <span className="virtual-link-text">
                    {initialData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl}
                  </span>
                </a>
              </div>
            )}

            {/* Time Fields Stacked in Chronological Order */}
            <div className="time-fields-stack">
              <div className="form-group">
                <label htmlFor="setupTime">Setup Start Time *</label>
                <input
                  type="time"
                  id="setupTime"
                  name="setupTime"
                  value={formData.setupTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  required
                />
                <div className="help-text">When setup can begin</div>
              </div>

              <div className="form-group">
                <label htmlFor="doorOpenTime">Door Open Time *</label>
                <input
                  type="time"
                  id="doorOpenTime"
                  name="doorOpenTime"
                  value={formData.doorOpenTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  required
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
                  readOnly
                  disabled
                  className="readonly-field"
                />
                <div className="help-text">when doors will be locked at end of event</div>
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

            {(formData.setupTime || formData.requestedRooms.length > 0) && (
              <div className="event-summary-pill">
                {formData.setupTime && formData.teardownTime && (
                  <span className="summary-time">
                    {formatTimeString(formData.setupTime)} to {formatTimeString(formData.teardownTime)}
                  </span>
                )}
                {formData.setupTime && formData.teardownTime && formData.requestedRooms.length > 0 && (
                  <span className="summary-separator">•</span>
                )}
                {formData.requestedRooms.length > 0 && (
                  <span className="summary-rooms" title={
                    formData.requestedRooms
                      .map(roomId => rooms.find(r => r._id === roomId)?.name || roomId)
                      .join(', ')
                  }>
                    {formData.requestedRooms.length} {formData.requestedRooms.length === 1 ? 'room' : 'rooms'}: {
                      formData.requestedRooms
                        .map(roomId => rooms.find(r => r._id === roomId)?.name || roomId)
                        .join(', ')
                    }
                  </span>
                )}
              </div>
            )}

            {checkingAvailability && (
              <div className="loading-message">Checking availability...</div>
            )}

            <div className="room-selection-container">
              <div className={`room-cards-section ${
                (initialData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl)
                  ? 'room-cards-disabled'
                  : ''
              }`}>
                {(initialData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl) && (
                  <div className="room-cards-disabled-message">
                    <h4>🌐 Virtual Event</h4>
                    <p>Physical location not required for virtual meetings</p>
                  </div>
                )}
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

              <div className={`scheduling-assistant-container ${
                formData.isAllDayEvent ? 'scheduling-assistant-disabled' : ''
              }`}>
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
                  organizerName={formData.requesterName}
                  organizerEmail={formData.requesterEmail}
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
