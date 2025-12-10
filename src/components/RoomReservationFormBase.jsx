// src/components/RoomReservationFormBase.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import SchedulingAssistant from './SchedulingAssistant';
import LocationListSelect from './LocationListSelect';
import MultiDatePicker from './MultiDatePicker';
import RecurrencePatternModal from './RecurrencePatternModal';
import VirtualMeetingModal from './VirtualMeetingModal';
import OffsiteLocationModal from './OffsiteLocationModal';
import CategorySelectorModal from './CategorySelectorModal';
import ServicesSelectorModal from './ServicesSelectorModal';
import { formatRecurrenceSummaryEnhanced } from '../utils/recurrenceUtils';
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
  onIsNavigatingChange = null,  // Called when navigation loading state changes
  onAvailabilityChange = null,  // Called when availability data updates

  // Mode-specific props
  readOnly = false,             // Whether form fields are read-only
  isAdmin = false,              // Admin users can edit regardless of status
  reservationStatus = null,     // Status of reservation (for Review mode)
  currentReservationId = null,  // ID of current reservation (for Review mode)
  onLockedEventClick = null,    // Callback for locked events in scheduling assistant
  onNavigateToSeriesEvent = null, // Callback for navigating to another event in series
  defaultCalendar = '',         // Default calendar for scheduling assistant
  apiToken = null,              // API token for authenticated requests

  // Rendering control
  activeTab = 'details',        // Which tab is active (for Review mode)
  showAllTabs = false,          // If true, render all content inline (for Creation mode)
  renderAdditionalContent = null, // Function to render additional content after form
  editScope = null,             // For recurring events: 'thisEvent' | 'allEvents' | null

  // Data exposure
  onFormDataRef = null,         // Callback to expose formData getter
  onTimeErrorsRef = null,       // Callback to expose timeErrors getter
  onValidateRef = null,         // Callback to expose validation function
  onFormValidChange = null      // Callback when form validity changes
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
    // Offsite location fields
    isOffsite: false,
    offsiteName: '',
    offsiteAddress: '',
    ...initialData
  });

  const [availability, setAvailability] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false); // Day availability loading for SchedulingAssistant
  const [assistantRooms, setAssistantRooms] = useState([]);
  const [timeErrors, setTimeErrors] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Ad hoc dates state - persistent container of additional dates
  const [showAdHocPicker, setShowAdHocPicker] = useState(false); // Show/hide calendar picker
  const [adHocDates, setAdHocDates] = useState([]); // Array of YYYY-MM-DD strings for ad hoc dates

  // Series navigation state
  const [seriesEvents, setSeriesEvents] = useState([]); // Array of events in the series
  const [currentEventId, setCurrentEventId] = useState(null); // Current event ID for highlighting
  const [loadingEventId, setLoadingEventId] = useState(null); // Event ID currently being loaded

  // Recurrence state
  const [showRecurrenceModal, setShowRecurrenceModal] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState(null); // { pattern, range }

  // Category state
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState(
    initialData?.mecCategories || initialData?.internalData?.mecCategories || []
  );

  // Virtual meeting state
  const [showVirtualModal, setShowVirtualModal] = useState(false);
  const [virtualMeetingUrl, setVirtualMeetingUrl] = useState(initialData.virtualMeetingUrl || '');

  // Offsite location modal state
  const [showOffsiteModal, setShowOffsiteModal] = useState(false);

  // Services state
  const [showServicesModal, setShowServicesModal] = useState(false);
  const [selectedServices, setSelectedServices] = useState(
    initialData?.services || {}
  );

  const { rooms, loading: roomsLoading } = useRooms();

  // Refs to prevent unnecessary re-initialization of form data
  const isInitializedRef = useRef(false);
  const lastReservationIdRef = useRef(null);

  // AbortController to cancel stale availability requests (prevents race condition)
  const availabilityAbortController = useRef(null);
  // Request ID counter to ignore stale responses that arrive after newer ones
  const availabilityRequestId = useRef(0);
  // Track last fetch params to prevent duplicate fetches (race condition fix)
  const lastFetchParamsRef = useRef({ roomIds: '', date: null });
  // Ref to track current assistantRooms for stale closure protection
  const assistantRoomsRef = useRef([]);

  // Expose formData, timeErrors, and validation function to parent
  // Include recurrencePattern, selectedCategories, and services in the returned data so they're available for saving
  useEffect(() => {
    if (onFormDataRef) {
      onFormDataRef(() => ({ ...formData, recurrence: recurrencePattern, mecCategories: selectedCategories, services: selectedServices }));
    }
  }, [formData, recurrencePattern, selectedCategories, selectedServices, onFormDataRef]);

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
    console.log('[hasChanges useEffect] hasChanges =', hasChanges, ', callback exists:', !!onHasChangesChange);
    if (onHasChangesChange) {
      onHasChangesChange(hasChanges);
    }
  }, [hasChanges, onHasChangesChange]);

  // Notify parent when navigation loading state changes
  useEffect(() => {
    if (onIsNavigatingChange) {
      onIsNavigatingChange(!!loadingEventId);
    }
  }, [loadingEventId, onIsNavigatingChange]);

  // Notify parent when availability changes
  useEffect(() => {
    if (onAvailabilityChange) {
      onAvailabilityChange(availability);
    }
  }, [availability, onAvailabilityChange]);

  // Clear loading state when event changes (navigation completed)
  useEffect(() => {
    logger.debug('Checking if navigation completed:', {
      loadingEventId,
      initialDataEventId: initialData.eventId,
      match: loadingEventId && initialData.eventId && loadingEventId === initialData.eventId
    });

    if (loadingEventId && initialData.eventId && loadingEventId === initialData.eventId) {
      // Navigation completed - clear loading state
      logger.debug('✅ Navigation completed, clearing loading state');
      setLoadingEventId(null);
    }
  }, [initialData.eventId, loadingEventId]);

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

      // Update virtual meeting URL state if it exists in initialData
      if (newData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl) {
        const url = newData.virtualMeetingUrl || initialData.graphData?.onlineMeetingUrl;
        setVirtualMeetingUrl(url);
      }

      // Initialize recurrence pattern from existing event data (for editing entire series)
      if (initialData.graphData?.recurrence || initialData.recurrence) {
        const existingRecurrence = initialData.recurrence || initialData.graphData?.recurrence;
        setRecurrencePattern(existingRecurrence);
        logger.debug('[RoomReservationFormBase] Initialized recurrence pattern from existing event:', existingRecurrence);
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
    // Use ref to check CURRENT value, not potentially stale closure value
    // This prevents overwriting checkDayAvailability results when rooms are selected
    if (assistantRoomsRef.current.length > 0) {
      console.log('[checkAvailability] Skipping - assistant mode active');
      return;
    }

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

      // Double-check BEFORE setting: rooms might have been selected while we were fetching
      // This prevents overwriting checkDayAvailability results during initialization race
      if (assistantRoomsRef.current.length > 0) {
        console.log('[checkAvailability] Discarding response - assistant mode now active');
        return;
      }

      setAvailability(data);
    } catch (err) {
      logger.error('Error checking availability:', err);
    } finally {
      // Only clear loading if assistant mode didn't take over
      if (assistantRoomsRef.current.length === 0) {
        setCheckingAvailability(false);
      }
    }
  };

  // Check availability for the entire day for scheduling assistant
  const checkDayAvailability = async (roomIds, date) => {
    if (!roomIds.length || !date) {
      setAvailabilityLoading(false); // Clear loading if nothing to fetch
      return;
    }

    // Cancel any in-flight request to prevent stale responses from overwriting fresh data
    if (availabilityAbortController.current) {
      availabilityAbortController.current.abort();
    }

    // Create new abort controller for this request
    availabilityAbortController.current = new AbortController();

    // Increment request ID to track this specific request
    // This ensures stale responses are ignored even if they arrive after abort
    const thisRequestId = ++availabilityRequestId.current;

    // Note: setAvailabilityLoading(true) is called in the useEffect BEFORE this function
    // to prevent race conditions with SchedulingAssistant rendering
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

      const response = await fetch(
        `${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`,
        { signal: availabilityAbortController.current.signal }
      );
      if (!response.ok) throw new Error('Failed to check day availability');

      const data = await response.json();

      // Only update state if this is still the latest request
      if (thisRequestId === availabilityRequestId.current) {
        setAvailability(data);
      } else {
        console.log('[checkDayAvailability] Ignoring stale response', { thisRequestId, currentId: availabilityRequestId.current });
      }
    } catch (err) {
      // Ignore abort errors - request was intentionally cancelled
      if (err.name === 'AbortError') {
        return;
      }
      logger.error('Error checking day availability:', err);
    } finally {
      // Only clear loading if this is still the latest request
      if (thisRequestId === availabilityRequestId.current) {
        setAvailabilityLoading(false);
      }
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

      // Skip if params haven't changed (prevents race condition from duplicate fetches)
      const roomIdsStr = roomIds.sort().join(',');
      if (lastFetchParamsRef.current.roomIds === roomIdsStr && lastFetchParamsRef.current.date === dateToCheck) {
        console.log('[checkDayAvailability] Skipping duplicate fetch - params unchanged');
        return;
      }

      // Update last fetch params
      lastFetchParamsRef.current = { roomIds: roomIdsStr, date: dateToCheck };

      // Set loading IMMEDIATELY to prevent SchedulingAssistant from clearing events
      // before the fetch starts (fixes race condition between room selection and data fetch)
      setAvailabilityLoading(true);
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

  // Cleanup: abort any in-flight availability requests on unmount
  useEffect(() => {
    return () => {
      if (availabilityAbortController.current) {
        availabilityAbortController.current.abort();
      }
    };
  }, []);

  // Reset fetch params when rooms are deselected (allows re-fetch when rooms are re-selected)
  useEffect(() => {
    if (assistantRooms.length === 0) {
      lastFetchParamsRef.current = { roomIds: '', date: null };
    }
  }, [assistantRooms.length]);

  // Keep assistantRoomsRef in sync for reliable access in async functions (prevents stale closures)
  useEffect(() => {
    assistantRoomsRef.current = assistantRooms;
  }, [assistantRooms]);

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

    // Helper to adjust midnight (00:00) to end-of-day (1440) when comparing end times
    const adjustForMidnight = (minutes, referenceMinutes) => {
      // If this time is 00:00 (midnight) and the reference time is later in the day,
      // treat midnight as end-of-day (24:00 = 1440 minutes)
      if (minutes === 0 && referenceMinutes !== null && referenceMinutes > 0) {
        return 1440; // 24 hours in minutes
      }
      return minutes;
    };

    const setup = timeToMinutes(setupTime);
    const doorOpen = timeToMinutes(doorOpenTime);
    const eventStartMinutes = timeToMinutes(startTime);
    const eventEndMinutes = timeToMinutes(endTime);
    const doorCloseRaw = timeToMinutes(doorCloseTime);
    const teardownRaw = timeToMinutes(teardownTime);

    // Adjust doorClose and teardown for midnight edge case
    const doorClose = adjustForMidnight(doorCloseRaw, eventEndMinutes);
    const teardown = adjustForMidnight(teardownRaw, doorCloseRaw !== null ? Math.max(eventEndMinutes || 0, doorCloseRaw) : eventEndMinutes);

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

  // Required field validation
  const isFieldValid = useCallback((fieldName) => {
    const value = formData[fieldName];
    return value !== undefined && value !== null && value !== '';
  }, [formData]);

  const isFormValid = useMemo(() => {
    const requiredFields = ['eventTitle', 'startDate', 'endDate', 'setupTime', 'doorOpenTime', 'startTime', 'endTime'];
    return requiredFields.every(field => isFieldValid(field)) && timeErrors.length === 0 && selectedCategories.length > 0;
  }, [isFieldValid, timeErrors, selectedCategories]);

  // Notify parent when form validity changes
  useEffect(() => {
    if (onFormValidChange) {
      onFormValidChange(isFormValid);
    }
  }, [isFormValid, onFormValidChange]);

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
    console.log('[handleEventTimeChange] Called with:', { startTime, endTime, setupTime, teardownTime });

    const updatedData = {
      ...formData,
      startTime,
      endTime,
      ...(setupTime && { setupTime }),
      ...(teardownTime && { teardownTime }),
      ...(doorOpenTime && { doorOpenTime }),
      ...(doorCloseTime && { doorCloseTime })
    };

    setFormData(updatedData);
    setHasChanges(true);
    console.log('[handleEventTimeChange] setHasChanges(true) called');

    // Notify parent of data change (consistent with handleInputChange)
    console.log('[handleEventTimeChange] onDataChange exists:', !!onDataChange);
    if (onDataChange) {
      console.log('[handleEventTimeChange] Calling onDataChange with:', updatedData);
      onDataChange(updatedData);
    }
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

  // Handle recurrence pattern save (memoized to prevent infinite loops)
  const handleRecurrenceSave = useCallback((pattern) => {
    setRecurrencePattern(pattern);
    setHasChanges(true);

    // Notify parent component
    if (onDataChange) {
      onDataChange({ ...formData, recurrence: pattern });
    }
  }, [formData, onDataChange]);

  // Handle remove recurrence
  const handleRemoveRecurrence = () => {
    logger.debug('Recurrence removed');
    setRecurrencePattern(null);
    setHasChanges(true);

    // Notify parent component
    if (onDataChange) {
      onDataChange({ ...formData, recurrence: null });
    }
  };

  // Handle virtual meeting URL save
  const handleVirtualMeetingSave = (url) => {
    setVirtualMeetingUrl(url);
    setFormData(prev => ({ ...prev, virtualMeetingUrl: url }));
    setHasChanges(true);

    // Notify parent component
    if (onDataChange) {
      onDataChange({ ...formData, virtualMeetingUrl: url });
    }
  };

  // Handle series event navigation click (from MultiDatePicker - handles inline confirmation internally)
  const handleSeriesEventClick = (event) => {
    logger.debug('Series event navigation confirmed:', event);

    // Set loading state
    setLoadingEventId(event.eventId);

    // Call parent callback to handle in-place modal update
    if (onNavigateToSeriesEvent) {
      onNavigateToSeriesEvent(event.eventId);
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

            {/* Edit Scope Indicator for Recurring Events */}
            {editScope === 'thisEvent' && (
              <div className="edit-scope-indicator single-occurrence">
                <span className="edit-scope-icon">📌</span>
                <span className="edit-scope-text">Editing this occurrence only. Changes will not affect other events in the series.</span>
              </div>
            )}
            {editScope === 'allEvents' && (
              <div className="edit-scope-indicator all-events">
                <span className="edit-scope-icon">🔄</span>
                <span className="edit-scope-text">Editing entire series. Changes will apply to all events in the series.</span>
              </div>
            )}

            <div className="form-grid">
              <div className={`form-group full-width required-field ${isFieldValid('eventTitle') ? 'field-valid' : ''}`}>
                <label htmlFor="eventTitle">Event Title</label>
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

            {/* Expected Attendees + Add Services Row */}
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
                  style={{ width: '100%', maxWidth: 'none' }}
                />
              </div>
              <div className="form-group">
                <label>&nbsp;</label>
                <button
                  type="button"
                  className={`all-day-toggle ${Object.keys(selectedServices).length > 0 ? 'active' : ''}`}
                  onClick={() => setShowServicesModal(true)}
                  disabled={fieldsDisabled}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {Object.keys(selectedServices).length > 0 ? '🛎️ Edit Services' : '🛎️ Add Services'}
                </button>
                <div className="services-hint">E.g., Catering, Seating, Audio Visual, etc.</div>
              </div>
            </div>

            {/* Services Summary - Show when services are selected */}
            {Object.keys(selectedServices).length > 0 &&
             Object.values(selectedServices).some(v =>
               (Array.isArray(v) && v.length > 0) ||
               (typeof v === 'string' && v !== '') ||
               (typeof v === 'boolean')
             ) && (
              <div className="services-summary-display">
                <div className="services-summary-content">
                  <span className="services-summary-icon">🛎️</span>
                  <span className="services-summary-text">
                    {(() => {
                      const summaryParts = [];
                      if (selectedServices.seatingArrangement) {
                        summaryParts.push(`Seating: ${selectedServices.seatingArrangement}`);
                      }
                      if (selectedServices.cateringApproach && selectedServices.cateringApproach !== 'No catering needed') {
                        summaryParts.push(`Catering: ${selectedServices.cateringApproach}`);
                      }
                      if ((selectedServices.nonAlcoholicBeverages?.length > 0) || (selectedServices.alcoholicBeverages?.length > 0)) {
                        const beverageCount = (selectedServices.nonAlcoholicBeverages?.length || 0) + (selectedServices.alcoholicBeverages?.length || 0);
                        summaryParts.push(`Beverages: ${beverageCount} selected`);
                      }
                      if (selectedServices.avEquipment?.length > 0) {
                        summaryParts.push(`A/V: ${selectedServices.avEquipment.length} items`);
                      }
                      if (selectedServices.photographer === true || selectedServices.videographer === true) {
                        const photoVideo = [];
                        if (selectedServices.photographer === true) photoVideo.push('Photo');
                        if (selectedServices.videographer === true) photoVideo.push('Video');
                        summaryParts.push(photoVideo.join(' + '));
                      }
                      return summaryParts.length > 0 ? summaryParts.join(' • ') : 'Services configured';
                    })()}
                  </span>
                </div>
                <div className="services-summary-actions">
                  <button
                    type="button"
                    className="services-edit-btn"
                    onClick={() => setShowServicesModal(true)}
                    disabled={fieldsDisabled}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="services-clear-btn"
                    onClick={() => {
                      setSelectedServices({});
                      setHasChanges(true);
                    }}
                    disabled={fieldsDisabled}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Manage Categories + Make Recurring Buttons Row */}
            <div className="time-field-row">
              <div className={`form-group required-field ${selectedCategories.length > 0 ? 'field-valid' : ''}`}>
                {/* Manage Categories Button - Always show, mandatory field */}
                <button
                  type="button"
                  className={`all-day-toggle ${selectedCategories.length > 0 ? 'active' : ''}`}
                  onClick={() => setShowCategoryModal(true)}
                  disabled={fieldsDisabled}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  🏷️ Manage Categories *
                </button>
              </div>

              <div className="form-group">
                {/* Make Recurring Button - Show for:
                    1. New events (no eventId) when not editing single occurrence
                    2. Existing events when editing entire series (editScope === 'allEvents') */}
                {((!initialData.eventId && !initialData.id && editScope !== 'thisEvent') ||
                  editScope === 'allEvents') && (
                  <button
                    type="button"
                    className={`all-day-toggle ${recurrencePattern || initialData.graphData?.recurrence ? 'active' : ''}`}
                    onClick={() => setShowRecurrenceModal(true)}
                    disabled={fieldsDisabled}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {(recurrencePattern || initialData.graphData?.recurrence) ? '↻ Edit Recurrence' : '↻ Make Recurring'}
                  </button>
                )}
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
                  hasUnsavedChanges={hasChanges}
                  loadingEventId={loadingEventId}
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

            {/* Recurrence Summary - Moved above date fields */}
            {/* Show when: recurrencePattern exists AND not editing single occurrence */}
            {/* Also use initialData.graphData?.recurrence as fallback for existing events */}
            {(recurrencePattern || (editScope === 'allEvents' && initialData.graphData?.recurrence)) && editScope !== 'thisEvent' && (
              <div className="recurrence-summary-display">
                <div className="recurrence-summary-content">
                  <span className="recurrence-icon">↻</span>
                  <span className="recurrence-text">
                    {(() => {
                      // Use recurrencePattern state, or fall back to initialData for existing events
                      const activeRecurrence = recurrencePattern || initialData.graphData?.recurrence || initialData.recurrence;
                      if (!activeRecurrence) return 'Recurring event';

                      const summary = formatRecurrenceSummaryEnhanced(
                        activeRecurrence.pattern,
                        activeRecurrence.range,
                        activeRecurrence.additions,
                        activeRecurrence.exclusions
                      );

                      return (
                        <>
                          {summary.base}
                          {summary.exclusions && summary.exclusions.length > 0 && (
                            <> {summary.exclusions.map((d, i) => (
                              <span key={`exc-${i}`} style={{color: 'red', fontWeight: '500'}}>
                                {i === 0 ? ' (excluded: ' : ', '}{d.text}
                              </span>
                            ))}<span style={{color: 'red'}}>)</span></>
                          )}
                          {summary.additions && summary.additions.length > 0 && (
                            <> {summary.additions.map((d, i) => (
                              <span key={`add-${i}`} style={{color: 'green', fontWeight: '500'}}>
                                {i === 0 ? ' (ad-hoc: ' : ', '}{d.text}
                              </span>
                            ))}<span style={{color: 'green'}}>)</span></>
                          )}
                        </>
                      );
                    })()}
                  </span>
                </div>
              </div>
            )}

            {/* Category Summary - Show when categories are selected */}
            {selectedCategories.length > 0 && (
              <div className="category-summary-display">
                <div className="category-summary-content">
                  <span className="category-summary-icon">🏷️</span>
                  <span className="category-summary-text">
                    {selectedCategories.join(', ')}
                  </span>
                </div>
              </div>
            )}

            {/* Date Fields - Always visible */}
            <div className="time-field-row">
              <div className={`form-group required-field ${isFieldValid('startDate') ? 'field-valid' : ''}`}>
                <label htmlFor="startDate">Event Date</label>
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

              <div className={`form-group required-field ${isFieldValid('endDate') ? 'field-valid' : ''}`}>
                <label htmlFor="endDate">End Date</label>
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

            {/* All Day Event Toggle and Virtual Meeting Toggle */}
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
                {formData.isAllDayEvent ? '✓ ' : ''}Set All Day
              </button>

              <button
                type="button"
                className={`all-day-toggle ${virtualMeetingUrl ? 'active' : ''}`}
                onClick={() => setShowVirtualModal(true)}
                disabled={fieldsDisabled}
              >
                {virtualMeetingUrl ? '✓ ' : ''}Set Virtual
              </button>
            </div>

            {/* Virtual Meeting Link Display - Only show when URL exists */}
            {virtualMeetingUrl && (
              <div className="virtual-link-wrapper">
                <a
                  href={virtualMeetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="virtual-link-pill"
                >
                  <span className="virtual-link-icon">🌐</span>
                  <span className="virtual-link-text">
                    Join {getVirtualPlatform(virtualMeetingUrl)} Meeting
                  </span>
                </a>
              </div>
            )}

            {/* Time Fields Stacked in Chronological Order */}
            <div className="time-fields-stack">
              <div className={`form-group required-field ${isFieldValid('setupTime') ? 'field-valid' : ''}`}>
                <label htmlFor="setupTime">Setup Start Time</label>
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

              <div className={`form-group required-field ${isFieldValid('doorOpenTime') ? 'field-valid' : ''}`}>
                <label htmlFor="doorOpenTime">Door Open Time</label>
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

              <div className={`form-group required-field ${isFieldValid('startTime') ? 'field-valid' : ''}`}>
                <label htmlFor="startTime">Event Start Time</label>
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

              <div className={`form-group required-field ${isFieldValid('endTime') ? 'field-valid' : ''}`}>
                <label htmlFor="endTime">Event End Time</label>
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
                    isOffsite={formData.isOffsite}
                    offsiteName={formData.offsiteName}
                    onOffsiteToggle={() => {
                      // Clear selected rooms when opening offsite modal
                      setFormData(prev => ({ ...prev, requestedRooms: [] }));
                      setShowOffsiteModal(true);
                    }}
                  />
                )}
              </div>

              {/* Show either Offsite Location Display OR Scheduling Assistant */}
              {formData.isOffsite && formData.offsiteName ? (
                <div className="offsite-location-display">
                  <div className="offsite-display-header">
                    <h3>📍 Offsite Location</h3>
                    <div className="offsite-display-date">
                      {formData.startDate && new Date(formData.startDate + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                  </div>
                  <div className="offsite-display-content">
                    <div className="offsite-display-icon">📍</div>
                    <div className="offsite-display-name">{formData.offsiteName}</div>
                    <div className="offsite-display-address">{formData.offsiteAddress}</div>
                  </div>
                </div>
              ) : (
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
                    availabilityLoading={availabilityLoading}
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
              )}
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

      {/* Recurrence Pattern Modal */}
      <RecurrencePatternModal
        isOpen={showRecurrenceModal}
        onClose={() => setShowRecurrenceModal(false)}
        onSave={handleRecurrenceSave}
        initialPattern={recurrencePattern}
        eventStartDate={formData.startDate}
        existingSeriesDates={seriesEvents.map(e => e.startDate?.split('T')[0]).filter(Boolean)}
      />

      {/* Virtual Meeting Modal */}
      <VirtualMeetingModal
        isOpen={showVirtualModal}
        onClose={() => setShowVirtualModal(false)}
        onSave={handleVirtualMeetingSave}
        initialUrl={virtualMeetingUrl}
      />

      {/* Offsite Location Modal */}
      <OffsiteLocationModal
        isOpen={showOffsiteModal}
        onClose={() => setShowOffsiteModal(false)}
        onSave={(name, address) => {
          if (name && address) {
            setFormData(prev => ({
              ...prev,
              isOffsite: true,
              offsiteName: name,
              offsiteAddress: address
            }));
          } else {
            // Remove was clicked - clear offsite data
            setFormData(prev => ({
              ...prev,
              isOffsite: false,
              offsiteName: '',
              offsiteAddress: ''
            }));
          }
          setHasChanges(true);
        }}
        initialName={formData.offsiteName}
        initialAddress={formData.offsiteAddress}
      />

      {/* Category Selector Modal */}
      <CategorySelectorModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        onSave={(categories) => {
          setSelectedCategories(categories);
          setHasChanges(true);
        }}
        initialCategories={selectedCategories}
      />

      {/* Services Selector Modal */}
      <ServicesSelectorModal
        isOpen={showServicesModal}
        onClose={() => setShowServicesModal(false)}
        onSave={(services) => {
          setSelectedServices(services);
          setHasChanges(true);
        }}
        initialServices={selectedServices}
      />
    </div>
  );
}
