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
import LoadingSpinner from './shared/LoadingSpinner';
import { formatRecurrenceSummaryEnhanced } from '../utils/recurrenceUtils';
import { extractTextFromHtml } from '../utils/textUtils';
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
  onFormValidChange = null,     // Callback when form validity changes

  // Pre-fetched data
  prefetchedAvailability = null, // Pre-fetched room availability data from parent

  // Edit request mode props (Option C: inline diff style)
  isEditRequestMode = false,    // When true, show inline diffs and allow editing
  isViewingEditRequest = false, // When true, show inline diffs but keep form read-only
  originalData = null           // Original form data for comparison (shows strikethrough when changed)
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
    offsiteLat: null,
    offsiteLon: null,
    // Allow concurrent scheduling (admin-only field)
    isAllowedConcurrent: false,
    // Allowed categories for concurrent events (only applies when isAllowedConcurrent is true)
    allowedConcurrentCategories: [],
    ...initialData
  });

  const [availability, setAvailability] = useState(prefetchedAvailability || []);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  // Track if we used prefetched data (to skip initial fetch)
  const usedPrefetchedData = useRef(!!prefetchedAvailability);
  const [availabilityLoading, setAvailabilityLoading] = useState(false); // Day availability loading for SchedulingAssistant
  const [timeErrors, setTimeErrors] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Ad hoc dates state - persistent container of additional dates
  const [showAdHocPicker, setShowAdHocPicker] = useState(false); // Show/hide calendar picker
  const [adHocDates, setAdHocDates] = useState([]); // Array of YYYY-MM-DD strings for ad hoc dates

  // Series navigation state
  const [seriesEvents, setSeriesEvents] = useState([]); // Array of events in the series
  const [currentEventId, setCurrentEventId] = useState(initialData?.eventId || null); // Current event ID for highlighting
  const [loadingEventId, setLoadingEventId] = useState(null); // Event ID currently being loaded

  // Recurrence state
  const [showRecurrenceModal, setShowRecurrenceModal] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState(
    initialData?.recurrence || initialData?.graphData?.recurrence || null
  ); // { pattern, range }

  // Category state - check categories first (correct field), mecCategories is deprecated
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState(
    initialData?.categories || initialData?.mecCategories || initialData?.internalData?.categories || initialData?.internalData?.mecCategories || []
  );

  // Refs to track latest values (prevents stale closure issues in callbacks)
  const selectedCategoriesRef = useRef(selectedCategories);
  const selectedServicesRef = useRef({});

  // Available categories for concurrent event restrictions (fetched from API)
  const [availableCategories, setAvailableCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // Fetch available categories when isAllowedConcurrent is checked (for admin)
  useEffect(() => {
    if (isAdmin && formData.isAllowedConcurrent && availableCategories.length === 0) {
      const fetchCategories = async () => {
        try {
          setCategoriesLoading(true);
          const response = await fetch(`${APP_CONFIG.API_BASE_URL}/categories`);
          if (response.ok) {
            const data = await response.json();
            setAvailableCategories(data);
          }
        } catch (err) {
          console.error('Error fetching categories:', err);
        } finally {
          setCategoriesLoading(false);
        }
      };
      fetchCategories();
    }
  }, [isAdmin, formData.isAllowedConcurrent, availableCategories.length]);

  // Sync selectedCategories when initialData changes (e.g., when loading an existing event)
  // Use JSON.stringify for more reliable dependency tracking
  const categoriesKey = JSON.stringify(initialData?.categories || initialData?.mecCategories || initialData?.internalData?.categories || initialData?.internalData?.mecCategories || []);
  useEffect(() => {
    const newCategories = initialData?.categories || initialData?.mecCategories || initialData?.internalData?.categories || initialData?.internalData?.mecCategories || [];
    if (newCategories.length > 0) {
      setSelectedCategories(newCategories);
      selectedCategoriesRef.current = newCategories;
    }
  }, [categoriesKey]);

  // Keep refs in sync with state (prevents stale closures)
  useEffect(() => {
    selectedCategoriesRef.current = selectedCategories;
  }, [selectedCategories]);

  // Sync form fields when initialData changes (e.g., from AI chat prefill or shared transformer)
  // This handles the case where initialData is set after component mounts
  useEffect(() => {
    // If data is pre-processed by the shared transformer, use simple spread
    // The _isPreProcessed flag indicates all fields are already in the correct format
    if (initialData?._isPreProcessed) {
      logger.debug('Syncing pre-processed form fields from initialData');
      setFormData(prev => ({ ...prev, ...initialData }));
      return;
    }

    // Legacy fallback: Only sync if initialData has actual content (not just empty defaults)
    const hasEventData = initialData?.eventTitle || initialData?.startDate || initialData?.selectedLocations?.length || initialData?.requestedRooms?.length;
    if (hasEventData) {
      logger.debug('Syncing form fields from initialData (legacy path):', initialData);
      setFormData(prev => ({
        ...prev,
        eventTitle: initialData.eventTitle || prev.eventTitle,
        eventDescription: initialData.eventDescription || prev.eventDescription,
        startDate: initialData.startDate || prev.startDate,
        endDate: initialData.endDate || prev.endDate,
        // Support both naming conventions: eventStartTime/eventEndTime and startTime/endTime
        startTime: initialData.startTime || initialData.eventStartTime || prev.startTime,
        endTime: initialData.endTime || initialData.eventEndTime || prev.endTime,
        setupTime: initialData.setupTime || prev.setupTime,
        teardownTime: initialData.teardownTime || prev.teardownTime,
        doorOpenTime: initialData.doorOpenTime || prev.doorOpenTime,
        doorCloseTime: initialData.doorCloseTime || prev.doorCloseTime,
        // Support both naming conventions: requestedRooms and selectedLocations
        requestedRooms: initialData.requestedRooms || initialData.selectedLocations || prev.requestedRooms,
        attendeeCount: initialData.attendeeCount || prev.attendeeCount,
        // Concurrent event settings (admin-only)
        isAllowedConcurrent: initialData.isAllowedConcurrent ?? prev.isAllowedConcurrent,
        allowedConcurrentCategories: initialData.allowedConcurrentCategories || prev.allowedConcurrentCategories
      }));
    }
  }, [initialData?._isPreProcessed, initialData?.eventTitle, initialData?.startDate, initialData?.selectedLocations, initialData?.requestedRooms, initialData?.startTime, initialData?.isAllowedConcurrent, initialData?.allowedConcurrentCategories]);

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

  // Sync selectedServices when initialData changes (e.g., when loading an existing event)
  // Use JSON.stringify for more reliable dependency tracking
  const servicesKey = JSON.stringify(initialData?.services || {});
  useEffect(() => {
    console.log('🛎️ RoomReservationFormBase - services sync useEffect triggered');
    console.log('🛎️ RoomReservationFormBase - initialData:', initialData);
    console.log('🛎️ RoomReservationFormBase - initialData?.services:', initialData?.services);
    console.log('🛎️ RoomReservationFormBase - servicesKey:', servicesKey);
    const newServices = initialData?.services;
    if (newServices && Object.keys(newServices).length > 0) {
      console.log('🛎️ RoomReservationFormBase - Setting selectedServices to:', newServices);
      setSelectedServices(newServices);
      selectedServicesRef.current = newServices;
    } else {
      console.log('🛎️ RoomReservationFormBase - newServices is empty/undefined, NOT updating selectedServices');
    }
  }, [servicesKey]);

  // Keep services ref in sync with state (prevents stale closures)
  useEffect(() => {
    selectedServicesRef.current = selectedServices;
  }, [selectedServices]);

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

  // Compute assistant rooms from selected room IDs - useMemo prevents unnecessary re-renders
  // MUST be defined before any useEffects that depend on it
  const assistantRooms = useMemo(() => {
    return rooms.filter(room =>
      formData.requestedRooms.includes(room._id)
    );
  }, [formData.requestedRooms, rooms]);

  // Expose formData, timeErrors, and validation function to parent
  // Include recurrencePattern, selectedCategories, and services in the returned data so they're available for saving
  useEffect(() => {
    if (onFormDataRef) {
      onFormDataRef(() => ({ ...formData, recurrence: recurrencePattern, categories: selectedCategories, services: selectedServices }));  // Use 'categories' (mecCategories is deprecated)
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
  // Note: callback intentionally excluded from deps to prevent render loop
  useEffect(() => {
    console.log('[hasChanges useEffect] hasChanges =', hasChanges, ', callback exists:', !!onHasChangesChange);
    if (onHasChangesChange) {
      onHasChangesChange(hasChanges);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges]);

  // Notify parent when navigation loading state changes
  // Note: callback intentionally excluded from deps to prevent render loop
  useEffect(() => {
    if (onIsNavigatingChange) {
      onIsNavigatingChange(!!loadingEventId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingEventId]);

  // Notify parent when availability changes
  // Note: callback intentionally excluded from deps to prevent render loop
  useEffect(() => {
    if (onAvailabilityChange) {
      onAvailabilityChange(availability);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability]);

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
    const isFirstInit = !isInitializedRef.current;
    const shouldInitialize = hasInitialData && (isFirstInit || isNewReservation);

    // Skip first initialization if data was pre-processed by parent
    // (data is already in formData via useState spread, auxiliary state also initialized)
    if (isFirstInit && initialData?._isPreProcessed) {
      // Just mark as initialized, skip all state updates
      isInitializedRef.current = true;
      lastReservationIdRef.current = currentReservationId;
      return;
    }

    if (shouldInitialize) {
      logger.debug('[RoomReservationFormBase] Initializing form data', {
        isFirstInit,
        isNewReservation,
        reservationId: currentReservationId
      });

      const newData = {
        ...initialData
      };

      // Strip HTML from eventDescription if it contains HTML tags
      if (newData.eventDescription && !initialData._isPreProcessed) {
        newData.eventDescription = extractTextFromHtml(newData.eventDescription);
      }

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
      // Always clear the checkingAvailability loading state
      // Assistant mode has its own loading state (availabilityLoading)
      setCheckingAvailability(false);
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
    // Skip initial fetch if we have prefetched data (prevents duplicate API call on modal open)
    if (usedPrefetchedData.current) {
      usedPrefetchedData.current = false; // Clear flag so future changes trigger fetch
      return;
    }
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
  // Note: onFormValidChange intentionally excluded from deps to prevent render loop
  // (parent creates new callback reference each render)
  useEffect(() => {
    if (onFormValidChange) {
      onFormValidChange(isFormValid);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormValid]);

  // Helper function to notify parent of data changes
  // Uses refs to always get latest categories/services (prevents stale closure issues)
  const notifyDataChange = useCallback((updatedData) => {
    if (onDataChange) {
      onDataChange({
        ...updatedData,
        categories: selectedCategoriesRef.current,  // Use 'categories' (mecCategories is deprecated)
        services: selectedServicesRef.current
      });
    }
  }, [onDataChange]); // Removed state dependencies - using refs instead

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

    notifyDataChange(updatedData);
  };

  const handleRoomSelectionChange = (newSelectedRooms) => {
    const updatedData = {
      ...formData,
      requestedRooms: newSelectedRooms
    };
    setFormData(updatedData);
    setHasChanges(true);

    // Notify parent component of change so save button gets enabled
    notifyDataChange(updatedData);
  };

  const handleRemoveAssistantRoom = (room) => {
    // Update formData.requestedRooms - assistantRooms is derived from this via useMemo
    setFormData(prev => ({
      ...prev,
      requestedRooms: prev.requestedRooms.filter(id => id !== room._id)
    }));
    setHasChanges(true);
  };

  const handleEventTimeChange = ({ startTime, endTime, setupTime, teardownTime, doorOpenTime, doorCloseTime }) => {
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

    // Notify parent of data change (consistent with handleInputChange)
    notifyDataChange(updatedData);
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
    notifyDataChange({ ...formData, adHocDates: newDates });
  };

  // Handle recurrence pattern save (memoized to prevent infinite loops)
  const handleRecurrenceSave = useCallback((pattern) => {
    setRecurrencePattern(pattern);
    setHasChanges(true);

    // Notify parent component
    notifyDataChange({ ...formData, recurrence: pattern });
  }, [formData, notifyDataChange]);

  // Handle remove recurrence
  const handleRemoveRecurrence = () => {
    logger.debug('Recurrence removed');
    setRecurrencePattern(null);
    setHasChanges(true);

    // Notify parent component
    notifyDataChange({ ...formData, recurrence: null });
  };

  // Handle virtual meeting URL save
  const handleVirtualMeetingSave = (url) => {
    setVirtualMeetingUrl(url);
    setFormData(prev => ({ ...prev, virtualMeetingUrl: url }));
    setHasChanges(true);

    // Notify parent component
    notifyDataChange({ ...formData, virtualMeetingUrl: url });
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

  // Handle toggling allowed concurrent categories
  const handleAllowedCategoryToggle = (categoryId) => {
    const currentAllowed = formData.allowedConcurrentCategories || [];
    const categoryIdStr = String(categoryId);
    let updatedAllowed;

    // Use string comparison to handle ObjectId vs string mismatch
    if (currentAllowed.some(id => String(id) === categoryIdStr)) {
      // Remove category
      updatedAllowed = currentAllowed.filter(id => String(id) !== categoryIdStr);
    } else {
      // Add category (store as string)
      updatedAllowed = [...currentAllowed, categoryIdStr];
    }

    const updatedData = {
      ...formData,
      allowedConcurrentCategories: updatedAllowed
    };

    setFormData(updatedData);
    setHasChanges(true);
    notifyDataChange(updatedData);
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
  // In edit request mode, allow editing even if readOnly is true (for requesters to propose changes)
  // In viewing edit request mode, keep fields disabled (read-only view of proposed changes)
  const fieldsDisabled = isViewingEditRequest || (readOnly && !isEditRequestMode) || (!isAdmin && !isEditRequestMode && reservationStatus && reservationStatus !== 'pending');

  // Whether to show diff highlighting (both edit request mode and viewing edit request)
  const showDiffMode = isEditRequestMode || isViewingEditRequest;

  // Helper to check if a field value has changed from the original (for edit request mode or viewing)
  const hasFieldChanged = useCallback((fieldName) => {
    if (!showDiffMode || !originalData) return false;
    const originalValue = originalData[fieldName];
    const currentValue = formData[fieldName];

    // Handle arrays (like requestedRooms, categories)
    if (Array.isArray(originalValue) && Array.isArray(currentValue)) {
      return JSON.stringify(originalValue) !== JSON.stringify(currentValue);
    }

    // Handle empty strings vs undefined/null
    const normalizedOriginal = originalValue ?? '';
    const normalizedCurrent = currentValue ?? '';
    return normalizedOriginal !== normalizedCurrent;
  }, [showDiffMode, originalData, formData]);

  // Helper to get the original value for display
  const getOriginalValue = useCallback((fieldName) => {
    if (!originalData) return null;
    return originalData[fieldName];
  }, [originalData]);

  // Helper to format time values for display
  const formatTimeForDisplay = (timeStr) => {
    if (!timeStr) return '(empty)';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Helper to check if categories have changed from original
  const haveCategoriesChanged = useCallback(() => {
    if (!showDiffMode || !originalData) return false;
    const originalCategories = originalData.categories || [];
    return JSON.stringify([...selectedCategories].sort()) !== JSON.stringify([...originalCategories].sort());
  }, [showDiffMode, originalData, selectedCategories]);

  // Helper to check if services have changed from original
  const haveServicesChanged = useCallback(() => {
    if (!showDiffMode || !originalData) return false;
    const originalServices = originalData.services || {};
    return JSON.stringify(selectedServices) !== JSON.stringify(originalServices);
  }, [showDiffMode, originalData, selectedServices]);

  // Helper to check if locations/rooms have changed from original
  const haveLocationsChanged = useCallback(() => {
    if (!showDiffMode || !originalData) return false;
    const originalRooms = originalData.requestedRooms || originalData.locations || [];
    const currentRooms = formData.requestedRooms || [];
    return JSON.stringify([...currentRooms].sort()) !== JSON.stringify([...originalRooms].sort());
  }, [showDiffMode, originalData, formData.requestedRooms]);

  // Helper to get original categories for display
  const getOriginalCategories = useCallback(() => {
    if (!originalData) return [];
    return originalData.categories || [];
  }, [originalData]);

  // Helper to get original locations for display
  const getOriginalLocations = useCallback(() => {
    if (!originalData) return [];
    return originalData.requestedRooms || originalData.locations || [];
  }, [originalData]);

  return (
    <div style={{ width: '100%' }}>
      {/* Tab: Event Details */}
      {(showAllTabs || activeTab === 'details') && (
        <div className="event-and-rooms-container">
          {/* Event Details - Left Side */}
          <section className="form-section event-details-compact">
            <h2>Event Details</h2>

            {/* Edit Request Mode Banner */}
            {isEditRequestMode && (
              <div className="edit-request-mode-banner">
                <span className="edit-request-mode-banner-icon">✏️</span>
                <span className="edit-request-mode-banner-text">
                  You are requesting changes to this approved event. Modified fields will show the original value with strikethrough.
                </span>
              </div>
            )}

            {/* Viewing Edit Request Banner */}
            {isViewingEditRequest && (
              <div className="edit-request-mode-banner viewing-mode">
                <span className="edit-request-mode-banner-icon">📋</span>
                <span className="edit-request-mode-banner-text">
                  Viewing pending edit request. Changed fields show the original value with strikethrough.
                </span>
              </div>
            )}

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
              <div className={`form-group full-width required-field ${isFieldValid('eventTitle') ? 'field-valid' : ''} ${hasFieldChanged('eventTitle') ? 'field-changed' : ''}`}>
                <label htmlFor="eventTitle">Event Title</label>
                {/* Inline diff for edit request mode */}
                {hasFieldChanged('eventTitle') && (
                  <div className="inline-diff">
                    <span className="diff-old">{getOriginalValue('eventTitle') || '(empty)'}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="text"
                  id="eventTitle"
                  name="eventTitle"
                  value={formData.eventTitle}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  required
                  className={hasFieldChanged('eventTitle') ? 'input-changed' : ''}
                />
              </div>

              <div className={`form-group full-width ${hasFieldChanged('eventDescription') ? 'field-changed' : ''}`}>
                <label htmlFor="eventDescription">Event Description</label>
                {/* Inline diff for edit request mode */}
                {hasFieldChanged('eventDescription') && (
                  <div className="inline-diff">
                    <span className="diff-old">{(getOriginalValue('eventDescription') || '(empty)').substring(0, 100)}{(getOriginalValue('eventDescription') || '').length > 100 ? '...' : ''}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <textarea
                  id="eventDescription"
                  name="eventDescription"
                  value={formData.eventDescription}
                  onChange={handleInputChange}
                  rows="3"
                  disabled={fieldsDisabled}
                  className={hasFieldChanged('eventDescription') ? 'input-changed' : ''}
                />
              </div>
            </div>

            {/* Expected Attendees + Add Services Row */}
            <div className="time-field-row">
              <div className={`form-group ${hasFieldChanged('attendeeCount') ? 'field-changed' : ''}`}>
                <label htmlFor="attendeeCount">Expected Attendees</label>
                {/* Inline diff for edit request mode */}
                {hasFieldChanged('attendeeCount') && (
                  <div className="inline-diff">
                    <span className="diff-old">{getOriginalValue('attendeeCount') || '(empty)'}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
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
                  className={hasFieldChanged('attendeeCount') ? 'input-changed' : ''}
                />
              </div>
            </div>

            {/* Categories & Services Buttons Row - Side by Side */}
            <div className="time-field-row">
              <div className={`form-group required-field ${selectedCategories.length > 0 ? 'field-valid' : ''}`}>
                <button
                  type="button"
                  className={`all-day-toggle ${selectedCategories.length > 0 ? 'active' : ''}`}
                  onClick={() => setShowCategoryModal(true)}
                  disabled={fieldsDisabled}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  🏷️ Edit Categories *
                </button>
              </div>
              <div className="form-group">
                <button
                  type="button"
                  className={`all-day-toggle ${Object.keys(selectedServices).length > 0 ? 'active' : ''}`}
                  onClick={() => setShowServicesModal(true)}
                  disabled={fieldsDisabled}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {Object.keys(selectedServices).length > 0 ? '🛎️ Edit Services' : '🛎️ Add Services'}
                </button>
              </div>
            </div>

            {/* Categories & Services Summaries - Stacked */}
            {(selectedCategories.length > 0 || haveCategoriesChanged() || (Object.keys(selectedServices).length > 0 &&
             Object.values(selectedServices).some(v =>
               (Array.isArray(v) && v.length > 0) ||
               (typeof v === 'string' && v !== '') ||
               (typeof v === 'boolean')
             )) || haveServicesChanged()) && (
              <div className="categories-services-summary-container">
                {/* Category Summary with Diff - inline format like locations */}
                {(selectedCategories.length > 0 || haveCategoriesChanged()) && (
                  <div className={`category-summary-display ${haveCategoriesChanged() ? 'summary-changed' : ''}`}>
                    <div className="category-summary-content">
                      <span className="category-summary-icon">🏷️</span>
                      {haveCategoriesChanged() ? (
                        <div className="inline-diff">
                          <span className="diff-label">Categories:</span>
                          <span className="diff-old">{getOriginalCategories().join(', ') || '(none)'}</span>
                          <span className="diff-arrow">→</span>
                          <span className="diff-new">{selectedCategories.length > 0 ? selectedCategories.join(', ') : '(none)'}</span>
                        </div>
                      ) : (
                        <span className="category-summary-text">
                          {selectedCategories.join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="category-summary-actions">
                      <button
                        type="button"
                        className="category-clear-btn"
                        onClick={() => {
                          setSelectedCategories([]);
                          setHasChanges(true);
                        }}
                        disabled={fieldsDisabled}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                {/* Services Summary with Diff - inline format like locations */}
                {((Object.keys(selectedServices).length > 0 &&
                 Object.values(selectedServices).some(v =>
                   (Array.isArray(v) && v.length > 0) ||
                   (typeof v === 'string' && v !== '') ||
                   (typeof v === 'boolean')
                 )) || haveServicesChanged()) && (
                  <div className={`services-summary-display ${haveServicesChanged() ? 'summary-changed' : ''}`}>
                    <div className="services-summary-content">
                      <span className="services-summary-icon">🛎️</span>
                      {haveServicesChanged() ? (
                        <div className="inline-diff">
                          <span className="diff-label">Services:</span>
                          <span className="diff-old">Modified</span>
                          <span className="diff-arrow">→</span>
                          <span className="diff-new">
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
                                summaryParts.push(`Beverages: ${beverageCount}`);
                              }
                              if (selectedServices.avEquipment?.length > 0) {
                                summaryParts.push(`A/V: ${selectedServices.avEquipment.length}`);
                              }
                              if (selectedServices.photographer === true || selectedServices.videographer === true) {
                                const photoVideo = [];
                                if (selectedServices.photographer === true) photoVideo.push('Photo');
                                if (selectedServices.videographer === true) photoVideo.push('Video');
                                summaryParts.push(photoVideo.join('+'));
                              }
                              return summaryParts.length > 0 ? summaryParts.join(' • ') : 'Configured';
                            })()}
                          </span>
                        </div>
                      ) : (
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
                      )}
                    </div>
                    <div className="services-summary-actions">
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
              </div>
            )}

            {/* Make Recurring Button Row */}
            {((!initialData.eventId && !initialData.id && editScope !== 'thisEvent') ||
              editScope === 'allEvents') && (
              <div className="time-field-row">
                <div className="form-group">
                  <button
                    type="button"
                    className={`all-day-toggle ${recurrencePattern || initialData.graphData?.recurrence ? 'active' : ''}`}
                    onClick={() => setShowRecurrenceModal(true)}
                    disabled={fieldsDisabled}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {(recurrencePattern || initialData.graphData?.recurrence) ? '↻ Edit Recurrence' : '↻ Make Recurring'}
                  </button>
                </div>
                <div className="form-group"></div>
              </div>
            )}

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

            {/* Date Fields - Always visible */}
            <div className="time-field-row">
              <div className={`form-group required-field ${isFieldValid('startDate') ? 'field-valid' : ''} ${hasFieldChanged('startDate') ? 'field-changed' : ''}`}>
                <label htmlFor="startDate">Event Date</label>
                {hasFieldChanged('startDate') && (
                  <div className="inline-diff">
                    <span className="diff-old">{getOriginalValue('startDate') || '(empty)'}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="date"
                  id="startDate"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  required
                  className={hasFieldChanged('startDate') ? 'input-changed' : ''}
                />
              </div>

              <div className={`form-group required-field ${isFieldValid('endDate') ? 'field-valid' : ''} ${hasFieldChanged('endDate') ? 'field-changed' : ''}`}>
                <label htmlFor="endDate">End Date</label>
                {hasFieldChanged('endDate') && (
                  <div className="inline-diff">
                    <span className="diff-old">{getOriginalValue('endDate') || '(empty)'}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="date"
                  id="endDate"
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleInputChange}
                  min={formData.startDate}
                  disabled={fieldsDisabled}
                  required
                  className={hasFieldChanged('endDate') ? 'input-changed' : ''}
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
              <div className={`form-group required-field ${isFieldValid('setupTime') ? 'field-valid' : ''} ${hasFieldChanged('setupTime') ? 'field-changed' : ''}`}>
                <label htmlFor="setupTime">Setup Start Time</label>
                {hasFieldChanged('setupTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('setupTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="time"
                  id="setupTime"
                  name="setupTime"
                  value={formData.setupTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  required
                  className={hasFieldChanged('setupTime') ? 'input-changed' : ''}
                />
                <div className="help-text">When setup can begin</div>
              </div>

              <div className={`form-group required-field ${isFieldValid('doorOpenTime') ? 'field-valid' : ''} ${hasFieldChanged('doorOpenTime') ? 'field-changed' : ''}`}>
                <label htmlFor="doorOpenTime">Door Open Time</label>
                {hasFieldChanged('doorOpenTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('doorOpenTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="time"
                  id="doorOpenTime"
                  name="doorOpenTime"
                  value={formData.doorOpenTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  className={hasFieldChanged('doorOpenTime') ? 'input-changed' : ''}
                  required
                />
                <div className="help-text">When attendees can start entering</div>
              </div>

              <div className={`form-group required-field ${isFieldValid('startTime') ? 'field-valid' : ''} ${hasFieldChanged('startTime') ? 'field-changed' : ''}`}>
                <label htmlFor="startTime">Event Start Time</label>
                {hasFieldChanged('startTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('startTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="time"
                  id="startTime"
                  name="startTime"
                  value={formData.startTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  required
                  className={hasFieldChanged('startTime') ? 'input-changed' : ''}
                />
                <div className="help-text">When the event begins</div>
              </div>

              <div className={`form-group required-field ${isFieldValid('endTime') ? 'field-valid' : ''} ${hasFieldChanged('endTime') ? 'field-changed' : ''}`}>
                <label htmlFor="endTime">Event End Time</label>
                {hasFieldChanged('endTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('endTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="time"
                  id="endTime"
                  name="endTime"
                  value={formData.endTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  required
                  className={hasFieldChanged('endTime') ? 'input-changed' : ''}
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

              <div className={`form-group ${hasFieldChanged('teardownTime') ? 'field-changed' : ''}`}>
                <label htmlFor="teardownTime">Teardown End Time</label>
                {hasFieldChanged('teardownTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('teardownTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <input
                  type="time"
                  id="teardownTime"
                  name="teardownTime"
                  value={formData.teardownTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  className={hasFieldChanged('teardownTime') ? 'input-changed' : ''}
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
          <section className={`form-section ${haveLocationsChanged() ? 'section-changed' : ''}`}>
            <h2>Resource Details</h2>

            {/* Inline diff for locations */}
            {haveLocationsChanged() && (
              <div className="inline-diff-section">
                <div className="inline-diff">
                  <span className="diff-label">Locations:</span>
                  <span className="diff-old">
                    {getOriginalLocations().length > 0
                      ? getOriginalLocations().map(roomId => rooms.find(r => r._id === roomId)?.name || roomId).join(', ')
                      : '(none)'}
                  </span>
                  <span className="diff-arrow">→</span>
                  <span className="diff-new">
                    {formData.requestedRooms.length > 0
                      ? formData.requestedRooms.map(roomId => rooms.find(r => r._id === roomId)?.name || roomId).join(', ')
                      : '(none)'}
                  </span>
                </div>
              </div>
            )}

            {(formData.setupTime || formData.requestedRooms.length > 0 || virtualMeetingUrl || formData.isOffsite) && (
              <div className="event-summary-pill">
                {formData.setupTime && formData.teardownTime && (
                  <span className="summary-time">
                    {formatTimeString(formData.setupTime)} to {formatTimeString(formData.teardownTime)}
                  </span>
                )}
                {formData.setupTime && formData.teardownTime && (formData.requestedRooms.length > 0 || virtualMeetingUrl || formData.isOffsite) && (
                  <span className="summary-separator">•</span>
                )}
                {/* Virtual Meeting - show platform name */}
                {virtualMeetingUrl && (
                  <span className="summary-rooms" title={virtualMeetingUrl}>
                    🎥 {getVirtualPlatform(virtualMeetingUrl)} Meeting
                  </span>
                )}
                {/* Offsite Location */}
                {!virtualMeetingUrl && formData.isOffsite && formData.offsiteName && (
                  <span className="summary-rooms" title={formData.offsiteName}>
                    📍 Offsite: {formData.offsiteName}
                  </span>
                )}
                {/* Regular rooms - only if not virtual and not offsite */}
                {!virtualMeetingUrl && !formData.isOffsite && formData.requestedRooms.length > 0 && (
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
              <LoadingSpinner minHeight={100} size={40} />
            )}

            <div className="room-selection-container">
              <div className="room-cards-section">
                {roomsLoading ? (
                  <LoadingSpinner minHeight={100} size={40} />
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
                    disabled={fieldsDisabled}
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
                    {/* Show static map if coordinates are available */}
                    {formData.offsiteLat && formData.offsiteLon && import.meta.env.VITE_AZURE_MAPS_KEY ? (
                      <div className="offsite-map-container">
                        <img
                          src={`https://atlas.microsoft.com/map/static/png?api-version=1.0&subscription-key=${import.meta.env.VITE_AZURE_MAPS_KEY}&center=${formData.offsiteLon},${formData.offsiteLat}&zoom=14&width=600&height=350&pins=default||${formData.offsiteLon} ${formData.offsiteLat}`}
                          alt={`Map of ${formData.offsiteName}`}
                          className="offsite-map-image"
                        />
                      </div>
                    ) : (
                      <div className="offsite-display-icon">📍</div>
                    )}
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
                    disabled={fieldsDisabled}
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

            {/* Concurrent Events Setting (Admin only) */}
            {isAdmin && (
              <div className="concurrent-events-section" style={{ marginBottom: '20px', padding: '12px 16px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                <label className="concurrent-checkbox-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="isAllowedConcurrent"
                    checked={formData.isAllowedConcurrent || false}
                    onChange={handleInputChange}
                    disabled={fieldsDisabled}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <span style={{ fontWeight: 500, color: '#0369a1' }}>Allow concurrent events</span>
                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                      Enable for events like Shabbat Services that can host nested events (e.g., B&apos;nei Mitzvahs) at the same time without triggering conflict warnings.
                    </p>
                  </div>
                </label>

                {/* Allowed Categories Selector (shown when concurrent is enabled) */}
                {formData.isAllowedConcurrent && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #bae6fd' }}>
                    <label style={{ display: 'block', fontWeight: 500, color: '#0369a1', marginBottom: '8px' }}>
                      Restrict to specific categories (optional)
                    </label>
                    <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: '#64748b' }}>
                      Leave empty to allow any event. Select categories to restrict which events can overlap.
                    </p>

                    {categoriesLoading ? (
                      <div style={{ padding: '10px', color: '#64748b' }}>Loading categories...</div>
                    ) : availableCategories.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {availableCategories.map(cat => {
                          // Use string comparison to handle ObjectId vs string mismatch
                          const isSelected = (formData.allowedConcurrentCategories || []).some(
                            id => String(id) === String(cat._id)
                          );
                          return (
                            <label
                              key={cat._id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                border: `1px solid ${isSelected ? cat.color || '#0ea5e9' : '#e2e8f0'}`,
                                backgroundColor: isSelected ? `${cat.color || '#0ea5e9'}15` : '#fff',
                                cursor: fieldsDisabled ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleAllowedCategoryToggle(cat._id)}
                                disabled={fieldsDisabled}
                                style={{ margin: 0 }}
                              />
                              <span
                                style={{
                                  width: '10px',
                                  height: '10px',
                                  borderRadius: '2px',
                                  backgroundColor: cat.color || '#64748b'
                                }}
                              />
                              <span style={{ fontSize: '0.9rem', color: '#334155' }}>{cat.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ padding: '10px', color: '#64748b', fontSize: '0.85rem' }}>
                        No categories available
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Read-only Concurrent Events Indicator (Non-admins) */}
            {!isAdmin && formData.isAllowedConcurrent && (
              <div className="concurrent-events-badge" style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '6px', border: '1px dashed #0ea5e9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.1rem' }}>🔄</span>
                  <span style={{ fontSize: '0.9rem', color: '#0369a1' }}>This event allows concurrent scheduling</span>
                </div>
                {(formData.allowedConcurrentCategories || []).length > 0 && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #bae6fd' }}>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      Restricted to categories: {(formData.allowedConcurrentCategories || []).length} selected
                    </span>
                  </div>
                )}
              </div>
            )}

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

            {/* Internal Notes Section (Staff Use Only) */}
            <section className="form-section internal-notes-section">
              <h2>🔒 Internal Notes</h2>
              <div className="internal-notes-disclaimer" style={{ marginBottom: '12px', fontSize: '0.85rem', color: '#64748b' }}>
                These notes are for internal staff coordination and will not be visible to the requester.
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label htmlFor="setupNotes">Setup Notes</label>
                <textarea
                  id="setupNotes"
                  name="setupNotes"
                  value={formData.setupNotes}
                  onChange={handleInputChange}
                  rows="2"
                  disabled={fieldsDisabled}
                  placeholder="Notes for setup crew..."
                />
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label htmlFor="doorNotes">Door/Access Notes</label>
                <textarea
                  id="doorNotes"
                  name="doorNotes"
                  value={formData.doorNotes}
                  onChange={handleInputChange}
                  rows="2"
                  disabled={fieldsDisabled}
                  placeholder="Notes about door/access requirements..."
                />
              </div>

              <div className="form-group">
                <label htmlFor="eventNotes">Event Notes</label>
                <textarea
                  id="eventNotes"
                  name="eventNotes"
                  value={formData.eventNotes}
                  onChange={handleInputChange}
                  rows="2"
                  disabled={fieldsDisabled}
                  placeholder="General event notes..."
                />
              </div>
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
        onSave={(name, address, lat, lon) => {
          let updatedData;
          if (name && address) {
            updatedData = {
              ...formData,
              isOffsite: true,
              offsiteName: name,
              offsiteAddress: address,
              offsiteLat: lat,
              offsiteLon: lon
            };
          } else {
            // Remove was clicked - clear offsite data
            updatedData = {
              ...formData,
              isOffsite: false,
              offsiteName: '',
              offsiteAddress: '',
              offsiteLat: null,
              offsiteLon: null
            };
          }
          setFormData(updatedData);
          setHasChanges(true);
          // Notify parent component of offsite data change
          notifyDataChange(updatedData);
        }}
        initialName={formData.offsiteName}
        initialAddress={formData.offsiteAddress}
        initialLat={formData.offsiteLat}
        initialLon={formData.offsiteLon}
      />

      {/* Category Selector Modal */}
      <CategorySelectorModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        onSave={(categories) => {
          setSelectedCategories(categories);
          selectedCategoriesRef.current = categories;
          setHasChanges(true);
          if (onDataChange) {
            onDataChange({
              ...formData,
              categories: categories,
              services: selectedServicesRef.current
            });
          }
        }}
        initialCategories={selectedCategories}
      />

      {/* Services Selector Modal */}
      <ServicesSelectorModal
        isOpen={showServicesModal}
        onClose={() => setShowServicesModal(false)}
        onSave={(services) => {
          setSelectedServices(services);
          selectedServicesRef.current = services; // Update ref immediately
          setHasChanges(true);
          // Notify parent component of services change
          // Use 'categories' field (mecCategories is deprecated)
          if (onDataChange) {
            onDataChange({
              ...formData,
              categories: selectedCategoriesRef.current,
              services
            });
          }
        }}
        initialServices={selectedServices}
      />
    </div>
  );
}
