// src/components/RoomReservationFormBase.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import { useRooms } from '../context/LocationContext';
import SchedulingAssistant from './SchedulingAssistant';
import TimePickerInput from './TimePickerInput';
import DatePickerInput from './DatePickerInput';
import LocationListSelect from './LocationListSelect';
import MultiDatePicker from './MultiDatePicker';
import OffsiteLocationModal from './OffsiteLocationModal';
import CategorySelectorModal from './CategorySelectorModal';
import ServicesSelectorModal from './ServicesSelectorModal';
import LoadingSpinner from './shared/LoadingSpinner';
import { RecurringIcon } from './shared/CalendarIcons';
import { useBaseCategoriesQuery } from '../hooks/useCategoriesQuery';

import { extractTextFromHtml } from '../utils/textUtils';
import {
  clampEventTimesToReservation,
  expandReservationToContainOperationalTimes,
  clampOperationalTimesToReservation,
  validateTimeOrdering,
} from '../utils/timeClampUtils';
import { usePermissions } from '../hooks/usePermissions';
import './RoomReservationForm.css';

// Time field groups for bidirectional enforcement logic
const OPERATIONAL_TIME_FIELDS = ['setupTime', 'teardownTime', 'doorOpenTime', 'doorCloseTime', 'startTime', 'endTime'];
const RESERVATION_TIME_FIELDS = ['reservationStartTime', 'reservationEndTime'];

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

const detectPlatform = (url) => {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('zoom.us')) return { name: 'Zoom', icon: '📹', color: '#2D8CFF' };
  if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com'))
    return { name: 'Teams', icon: '💼', color: '#6264A7' };
  if (lower.includes('meet.google.com')) return { name: 'Google Meet', icon: '🎥', color: '#00897B' };
  if (lower.includes('webex.com')) return { name: 'Webex', icon: '🌐', color: '#07C160' };
  return { name: 'Virtual', icon: '🌐', color: '#1a73e8' };
};

const isValidUrl = (str) => {
  if (!str) return true;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
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
  onDetailsCompleteChange = null, // Callback when date/time completeness changes (for tab gating)

  // Pre-fetched data
  prefetchedAvailability = null, // Pre-fetched room availability data from parent

  // Edit request mode props (Option C: inline diff style)
  isEditRequestMode = false,    // When true, show inline diffs and allow editing
  isViewingEditRequest = false, // When true, show inline diffs but keep form read-only
  originalData = null,          // Original form data for comparison (shows strikethrough when changed)
  onConflictChange = null,      // Callback when scheduling conflicts change: (hasConflicts, totalConflicts) => void
  onHoldChange = null,          // Callback when hold status changes: (isHold) => void

  // Lifted recurrence state (from RoomReservationReview) — when provided, these override internal state
  externalRecurrencePattern = undefined,     // Recurrence pattern object or null
  onRecurrencePatternChange = null,          // Callback: (pattern) => void

  // Pre-fetched series events data from parent (for non-blocking modal open)
  prefetchedSeriesEvents = null,
}) {
  // Form state
  const [formData, setFormData] = useState({
    requesterName: '',
    requesterEmail: '',
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
    reservationStartTime: '',
    reservationEndTime: '',
    setupNotes: '',
    doorNotes: '',
    attendeeCount: '',
    requestedRooms: [],
    setupTimeMinutes: 0,
    teardownTimeMinutes: 0,
    reservationStartMinutes: 0,
    reservationEndMinutes: 0,
    contactEmail: '',
    contactName: '',
    isOnBehalfOf: false,
    organizerName: '',
    organizerPhone: '',
    organizerEmail: '',
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
  // When prefetchedAvailability is null on mount but will arrive later, treat as "in flight"
  const usedPrefetchedData = useRef(!!prefetchedAvailability || prefetchedAvailability === null);
  // Watch for late-arriving prefetched availability (from non-blocking modal open)
  const prefetchArrived = useRef(false);
  // Initialize loading=true when rooms exist but availability data hasn't arrived yet.
  // This prevents SchedulingAssistant from firing a premature onConflictChange with empty data
  // before the availability API response arrives (which causes the loading gate to open too early).
  const hasInitialLocations = initialData?.locations?.length > 0;
  const [availabilityLoading, setAvailabilityLoading] = useState(hasInitialLocations && !prefetchedAvailability);
  const [timeErrors, setTimeErrors] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Absorb prefetched availability into local state on mount (or late arrival).
  // With conditional rendering, form mounts after prefetch completes, so this fires
  // immediately on mount. Kept for safety if prefetch timing changes.
  useEffect(() => {
    if (prefetchedAvailability != null && prefetchedAvailability.length > 0 && !prefetchArrived.current) {
      setAvailability(prefetchedAvailability);
      usedPrefetchedData.current = true; // suppress next time-change trigger
      prefetchArrived.current = true;
    }
  }, [prefetchedAvailability]);

  // Ad hoc dates state - persistent container of additional dates
  const [showAdHocPicker, setShowAdHocPicker] = useState(false); // Show/hide calendar picker
  const [adHocDates, setAdHocDates] = useState([]); // Array of YYYY-MM-DD strings for ad hoc dates

  // Series navigation state
  const [seriesEvents, setSeriesEvents] = useState([]); // Array of events in the series
  const [currentEventId, setCurrentEventId] = useState(initialData?.eventId || null); // Current event ID for highlighting
  const [loadingEventId, setLoadingEventId] = useState(null); // Event ID currently being loaded

  // Recurrence state — uses external (lifted) state when provided, falls back to internal for creation mode
  const [_internalRecurrencePattern, _setInternalRecurrencePattern] = useState(
    initialData?.recurrence || initialData?.graphData?.recurrence || null
  ); // { pattern, range }

  const isRecurrenceLifted = externalRecurrencePattern !== undefined;
  const recurrencePattern = isRecurrenceLifted ? externalRecurrencePattern : _internalRecurrencePattern;
  const setRecurrencePattern = isRecurrenceLifted
    ? (val) => { if (onRecurrencePatternChange) onRecurrencePatternChange(typeof val === 'function' ? val(externalRecurrencePattern) : val); }
    : _setInternalRecurrencePattern;

  // Category state - check categories first (correct field), mecCategories is deprecated
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState(
    initialData?.categories || initialData?.mecCategories || []
  );

  // Refs to track latest values (prevents stale closure issues in callbacks)
  const selectedCategoriesRef = useRef(selectedCategories);
  const selectedServicesRef = useRef({});

  // Get permissions - must be before useEffects that depend on isAdmin
  const { canEditField, isAdmin, canEditEvents } = usePermissions();

  // Available categories via TanStack Query (cached, shared across components)
  const { data: availableCategories = [], isLoading: categoriesLoading } = useBaseCategoriesQuery(apiToken);

  // Build category concurrent rules map: { categoryId: [allowedCategoryIds] }
  const categoryConcurrentRules = useMemo(() => {
    const rules = {};
    for (const cat of availableCategories) {
      const allowed = (cat.allowedConcurrentCategories || []).map(id => String(id));
      if (allowed.length > 0) {
        rules[String(cat._id)] = allowed;
      }
    }
    return rules;
  }, [availableCategories]);

  // Build category name -> ID lookup
  const categoryLookup = useMemo(() => {
    const lookup = {};
    for (const cat of availableCategories) {
      lookup[cat.name] = String(cat._id);
    }
    return lookup;
  }, [availableCategories]);

  // Sync selectedCategories when initialData changes (e.g., when loading an existing event)
  // Use JSON.stringify for more reliable dependency tracking
  const categoriesKey = JSON.stringify(initialData?.categories || initialData?.mecCategories || []);
  useEffect(() => {
    const newCategories = initialData?.categories || initialData?.mecCategories || [];
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
      setFormData(prev => {
        // Exclude fields managed by dedicated state (recurrence, categories, services, occurrenceOverrides)
        // These have their own sync useEffects and should not be overwritten by the formData spread
        const { recurrence, categories, services, occurrenceOverrides, ...rest } = initialData;
        return { ...prev, ...rest };
      });
      return;
    }

    // Legacy fallback: Only sync if initialData has actual content (not just empty defaults)
    const hasEventData = initialData?.eventTitle || initialData?.startDate || initialData?.selectedLocations?.length || initialData?.requestedRooms?.length;
    if (hasEventData) {
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
        reservationStartTime: initialData.reservationStartTime || prev.reservationStartTime,
        reservationEndTime: initialData.reservationEndTime || prev.reservationEndTime,
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

  // Pre-populate organizer fields from requester on NEW events only.
  // Existing events (with _isPreProcessed from transformer) carry their own saved organizer values.
  // Track whether organizer has been initialized to avoid re-defaulting on every render.
  const organizerInitialized = useRef(false);
  useEffect(() => {
    if (organizerInitialized.current) return;
    // Only pre-populate when requester info is available AND organizer is still empty
    // (i.e., not loaded from an existing event via transformer)
    if (formData.requesterName && !formData.organizerName && !initialData?._isPreProcessed) {
      organizerInitialized.current = true;
      setFormData(prev => ({
        ...prev,
        organizerName: prev.organizerName || prev.requesterName,
        organizerEmail: prev.organizerEmail || prev.requesterEmail,
      }));
    } else if (formData.organizerName || initialData?._isPreProcessed) {
      // Already has organizer data (loaded from existing event) — skip pre-population
      organizerInitialized.current = true;
    }
  }, [formData.requesterName, formData.organizerName, initialData?._isPreProcessed]);

  // Virtual meeting state
  const [virtualMeetingUrl, setVirtualMeetingUrl] = useState(initialData.virtualMeetingUrl || '');
  const [virtualUrlError, setVirtualUrlError] = useState('');
  const [showVirtualPopover, setShowVirtualPopover] = useState(false);
  const virtualPopoverRef = useRef(null);


  // Close virtual popover on click outside
  useEffect(() => {
    if (!showVirtualPopover) return;
    const handleClickOutside = (e) => {
      if (virtualPopoverRef.current && !virtualPopoverRef.current.contains(e.target)) {
        setShowVirtualPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showVirtualPopover]);

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
    const newServices = initialData?.services;
    if (newServices && Object.keys(newServices).length > 0) {
      setSelectedServices(newServices);
      selectedServicesRef.current = newServices;
    }
  }, [servicesKey]);

  // Keep services ref in sync with state (prevents stale closures)
  useEffect(() => {
    selectedServicesRef.current = selectedServices;
  }, [selectedServices]);

  // Sync recurrencePattern when initialData changes (e.g., when loading a saved draft)
  // Mirrors the categories/services sync pattern above — only when using internal state
  const recurrenceKey = JSON.stringify(initialData?.recurrence || null);
  useEffect(() => {
    if (isRecurrenceLifted) return; // External state is managed by parent
    const newRecurrence = initialData?.recurrence || null;
    _setInternalRecurrencePattern(newRecurrence);
    recurrencePatternRef.current = newRecurrence;
  }, [recurrenceKey, isRecurrenceLifted]);

  const { rooms, loading: roomsLoading, getLocationName } = useRooms();

  // Refs to prevent unnecessary re-initialization of form data
  const isInitializedRef = useRef(false);
  const lastReservationIdRef = useRef(null);

  // AbortController to cancel stale availability requests (prevents race condition)
  const availabilityAbortController = useRef(null);
  // Request ID counter to ignore stale responses that arrive after newer ones
  const availabilityRequestId = useRef(0);
  // Track last fetch params to prevent duplicate fetches (race condition fix)
  const lastFetchParamsRef = useRef({ roomIds: '', date: null, excludeEventId: null });
  // Seed lastFetchParamsRef when prefetched data arrived before mount.
  // With conditional rendering, the form only mounts after prefetchedAvailability
  // is set (non-null), so this always fires on first mount — preventing the room
  // effect from triggering a duplicate fetch.
  if (prefetchedAvailability != null && lastFetchParamsRef.current.date === null && initialData?.startDate) {
    const seedRoomIds = (initialData.locations || initialData.requestedRooms || [])
      .map(loc => typeof loc === 'string' ? loc : (loc._id || String(loc)))
      .sort().join(',');
    if (seedRoomIds) {
      lastFetchParamsRef.current = { roomIds: seedRoomIds, date: initialData.startDate, excludeEventId: currentReservationId };
    }
  }
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

  // Notify parent when hold status changes (no event times but has reservation times)
  useEffect(() => {
    if (onHoldChange) {
      const isHold = !formData.startTime && !formData.endTime &&
                     !!(formData.reservationStartTime || formData.reservationEndTime);
      onHoldChange(isHold);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.startTime, formData.endTime, formData.reservationStartTime, formData.reservationEndTime]);

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
    if (loadingEventId && initialData.eventId && loadingEventId === initialData.eventId) {
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
      // Sync recurrence before early return (sync useEffects handle categories/services)
      if (initialData.recurrence) {
        setRecurrencePattern(initialData.recurrence);
        recurrencePatternRef.current = initialData.recurrence;
      }
      // Just mark as initialized, skip all state updates
      isInitializedRef.current = true;
      lastReservationIdRef.current = currentReservationId;
      return;
    }

    if (shouldInitialize) {
      const newData = {
        ...initialData
      };

      // Strip HTML from eventDescription if it contains HTML tags
      if (newData.eventDescription && !initialData._isPreProcessed) {
        newData.eventDescription = extractTextFromHtml(newData.eventDescription);
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

  // Track whether prefetched series events have been applied
  const usedPrefetchedSeriesData = useRef(false);

  // Handle late-arriving prefetched series events
  useEffect(() => {
    if (prefetchedSeriesEvents != null && !usedPrefetchedSeriesData.current) {
      setSeriesEvents(prefetchedSeriesEvents);
      usedPrefetchedSeriesData.current = true;
    }
  }, [prefetchedSeriesEvents]);

  // Fetch series events when opening an event with eventSeriesId
  useEffect(() => {
    // Skip if we already received or are expecting prefetched series data
    if (usedPrefetchedSeriesData.current || prefetchedSeriesEvents !== null) {
      return;
    }

    const fetchSeriesEvents = async () => {
      if (!initialData?.eventSeriesId) {
        setSeriesEvents([]);
        return;
      }

      try {
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
        setSeriesEvents(data.events || []);
      } catch (error) {
        logger.error('Error fetching series events:', error);
        setSeriesEvents([]);
      }
    };

    fetchSeriesEvents();
  }, [initialData?.eventSeriesId, apiToken, prefetchedSeriesEvents]);

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
      return;
    }

    try {
      setCheckingAvailability(true);

      const effectiveStartTime = formData.startTime || formData.reservationStartTime;
      const effectiveEndTime = formData.endTime || formData.reservationEndTime;
      const startDateTime = `${formData.startDate}T${effectiveStartTime}`;
      const endDateTime = `${formData.endDate}T${effectiveEndTime}`;

      let reservationStartMinutes = formData.reservationStartMinutes || 0;
      let reservationEndMinutes = formData.reservationEndMinutes || 0;

      if (formData.reservationStartTime) {
        reservationStartMinutes = calculateTimeBufferMinutes(effectiveStartTime, formData.reservationStartTime);
      }
      if (formData.reservationEndTime) {
        reservationEndMinutes = calculateTimeBufferMinutes(effectiveEndTime, formData.reservationEndTime);
      }

      const params = new URLSearchParams({
        startDateTime,
        endDateTime,
        setupTimeMinutes: reservationStartMinutes,
        teardownTimeMinutes: reservationEndMinutes,
        reservationStartMinutes,
        reservationEndMinutes
      });
      if (currentReservationId) params.append('excludeEventId', currentReservationId);

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}/rooms/availability?${params}`);
      if (!response.ok) throw new Error('Failed to check availability');

      const data = await response.json();

      // Double-check BEFORE setting: rooms might have been selected while we were fetching
      // This prevents overwriting checkDayAvailability results during initialization race
      if (assistantRoomsRef.current.length > 0) {
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
      if (currentReservationId) params.append('excludeEventId', currentReservationId);

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
  // 500ms debounce prevents rapid-fire API calls when user adjusts multiple fields quickly
  useEffect(() => {
    // Skip initial fetch if we have prefetched data (prevents duplicate API call on modal open)
    if (usedPrefetchedData.current) {
      usedPrefetchedData.current = false; // Clear flag so future changes trigger fetch
      return;
    }
    if (formData.startDate && (formData.startTime || formData.reservationStartTime) && formData.endDate && (formData.endTime || formData.reservationEndTime) && assistantRooms.length === 0) {
      const timer = setTimeout(() => {
        checkAvailability();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [formData.startDate, formData.startTime, formData.endDate, formData.endTime, formData.reservationStartMinutes, formData.reservationEndMinutes, formData.reservationStartTime, formData.reservationEndTime, assistantRooms.length]);

  // Check day availability when assistant rooms or date changes
  useEffect(() => {
    if (assistantRooms.length === 0) {
      setAvailabilityLoading(false); // No rooms = nothing to load
      return;
    }
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
      if (lastFetchParamsRef.current.roomIds === roomIdsStr
          && lastFetchParamsRef.current.date === dateToCheck
          && lastFetchParamsRef.current.excludeEventId === currentReservationId) {
        return;
      }

      // Update last fetch params
      lastFetchParamsRef.current = { roomIds: roomIdsStr, date: dateToCheck, excludeEventId: currentReservationId };

      // Set loading IMMEDIATELY to prevent SchedulingAssistant from clearing events
      // before the fetch starts (fixes race condition between room selection and data fetch)
      setAvailabilityLoading(true);
      checkDayAvailability(roomIds, dateToCheck);
    }
  }, [assistantRooms, formData.startDate, currentReservationId]);

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
      lastFetchParamsRef.current = { roomIds: '', date: null, excludeEventId: null };
    }
  }, [assistantRooms.length]);

  // Auto-refresh availability every 30s while form is open with valid time fields
  // Ensures conflict detection stays current during long form sessions
  useEffect(() => {
    if (readOnly) return;
    if (!formData.startDate || !(formData.startTime || formData.reservationStartTime) || !formData.endDate || !(formData.endTime || formData.reservationEndTime)) return;

    const interval = setInterval(() => {
      if (assistantRoomsRef.current.length > 0) {
        // Re-check day availability for scheduling assistant rooms
        const roomIds = assistantRoomsRef.current.map(room => room._id);
        const dateToCheck = formData.startDate;
        lastFetchParamsRef.current = { roomIds: '', date: null, excludeEventId: null }; // Reset to force re-fetch
        setAvailabilityLoading(true);
        checkDayAvailability(roomIds, dateToCheck);
      } else {
        // Re-check standard availability
        checkAvailability();
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, [readOnly, formData.startDate, formData.startTime, formData.endDate, formData.endTime, formData.reservationStartTime, formData.reservationEndTime]);

  // Keep assistantRoomsRef in sync for reliable access in async functions (prevents stale closures)
  useEffect(() => {
    assistantRoomsRef.current = assistantRooms;
  }, [assistantRooms]);

  // Validate full time ordering chain:
  // Res Start <= Setup <= Door Open <= Event Start <= Event End <= Door Close <= Teardown <= Res End
  // Each pair only checked when both values are present (operational times are optional).
  const validateTimes = useCallback(() => {
    const errors = [];
    const {
      reservationStartTime, reservationEndTime, startTime, endTime,
      setupTime, teardownTime, doorOpenTime, doorCloseTime,
      startDate, endDate, isAllDayEvent,
    } = formData;

    // Reservation times are auto-filled for all-day events, only require them for timed events
    if (!isAllDayEvent) {
      if (!reservationStartTime) errors.push('Reservation Start Time is required');
      if (!reservationEndTime) errors.push('Reservation End Time is required');
    }

    // Full ordering chain validation (skips multi-day, skips missing pairs)
    const orderErrors = validateTimeOrdering({
      reservationStartTime, setupTime, doorOpenTime, startTime,
      endTime, doorCloseTime, teardownTime, reservationEndTime,
      startDate, endDate,
    });
    errors.push(...orderErrors);

    setTimeErrors(errors);
    return errors.length === 0;
  }, [formData]);

  // Validate times whenever any time field changes
  useEffect(() => {
    const hasAnyTime = formData.reservationStartTime || formData.reservationEndTime ||
      formData.startTime || formData.endTime || formData.setupTime ||
      formData.teardownTime || formData.doorOpenTime || formData.doorCloseTime;
    if (hasAnyTime) {
      validateTimes();
    } else {
      setTimeErrors([]);
    }
  }, [
    formData.reservationStartTime, formData.reservationEndTime,
    formData.startTime, formData.endTime,
    formData.setupTime, formData.teardownTime,
    formData.doorOpenTime, formData.doorCloseTime,
    validateTimes,
  ]);

  // Required field validation
  const isFieldValid = useCallback((fieldName) => {
    const value = formData[fieldName];
    return value !== undefined && value !== null && value !== '';
  }, [formData]);

  const isFormValid = useMemo(() => {
    const requiredFields = formData.isAllDayEvent
      ? ['eventTitle', 'startDate', 'endDate', 'attendeeCount']
      : ['eventTitle', 'startDate', 'endDate', 'reservationStartTime', 'reservationEndTime', 'attendeeCount'];
    return requiredFields.every(field => isFieldValid(field)) && timeErrors.length === 0 && selectedCategories.length > 0;
  }, [isFieldValid, timeErrors, selectedCategories, formData.isAllDayEvent]);

  // Check if core date/time fields are complete (for tab gating — separate from full isFormValid)
  const areDetailsComplete = useMemo(() => {
    if (formData.isAllDayEvent) {
      return isFieldValid('startDate') && isFieldValid('endDate');
    }
    return isFieldValid('startDate') && isFieldValid('endDate') &&
           isFieldValid('reservationStartTime') && isFieldValid('reservationEndTime') &&
           timeErrors.length === 0;
  }, [isFieldValid, timeErrors, formData.isAllDayEvent]);

  // Notify parent when form validity changes
  // Note: onFormValidChange intentionally excluded from deps to prevent render loop
  // (parent creates new callback reference each render)
  useEffect(() => {
    if (onFormValidChange) {
      onFormValidChange(isFormValid);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormValid]);

  // Notify parent when date/time completeness changes (for tab gating)
  useEffect(() => {
    if (onDetailsCompleteChange) {
      onDetailsCompleteChange(areDetailsComplete);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areDetailsComplete]);

  // Helper function to notify parent of data changes
  // Uses refs to always get latest categories/services (prevents stale closure issues)
  // Ref to always have latest recurrencePattern available in notifyDataChange
  const recurrencePatternRef = useRef(recurrencePattern);
  useEffect(() => { recurrencePatternRef.current = recurrencePattern; }, [recurrencePattern]);

  const notifyDataChange = useCallback((updatedData) => {
    if (onDataChange) {
      onDataChange({
        ...updatedData,
        categories: selectedCategoriesRef.current,  // Use 'categories' (mecCategories is deprecated)
        services: selectedServicesRef.current,
        recurrence: updatedData.recurrence !== undefined ? updatedData.recurrence : recurrencePatternRef.current
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

    // Auto-fill endDate when startDate is set and endDate is empty or earlier
    if (name === 'startDate' && value) {
      if (!formData.endDate || formData.endDate < value) {
        updatedData.endDate = value;
      }
    }

    // Auto-adjust endTime (and downstream times) when startTime moves to or past endTime
    if (name === 'startTime' && value && formData.endTime) {
      const [startH, startM] = value.split(':').map(Number);
      const [endH, endM] = formData.endTime.split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      if (startMins >= endMins) {
        // Push endTime to startTime + 30 minutes
        const newEndMins = startMins + 30;
        if (newEndMins < 24 * 60) {
          const newEndTime = `${String(Math.floor(newEndMins / 60)).padStart(2, '0')}:${String(newEndMins % 60).padStart(2, '0')}`;
          updatedData.endTime = newEndTime;
          // Cascade: push reservationEndTime if it's now at or before new endTime
          if (formData.reservationEndTime) {
            const [tdH, tdM] = formData.reservationEndTime.split(':').map(Number);
            const tdMins = tdH * 60 + tdM;
            if (tdMins <= newEndMins) {
              const newTdMins = newEndMins + 30;
              if (newTdMins < 24 * 60) {
                updatedData.reservationEndTime = `${String(Math.floor(newTdMins / 60)).padStart(2, '0')}:${String(newTdMins % 60).padStart(2, '0')}`;
              }
            }
          }
        }
      }
    }

    // Enforce reservation as outer bounds of all operational times
    if (OPERATIONAL_TIME_FIELDS.includes(name)) {
      // Operational time changed -> expand reservation to contain it
      const expansion = expandReservationToContainOperationalTimes(updatedData);
      if (expansion) {
        if (expansion.reservationStartTime) updatedData.reservationStartTime = expansion.reservationStartTime;
        if (expansion.reservationEndTime) updatedData.reservationEndTime = expansion.reservationEndTime;
      }
    } else if (RESERVATION_TIME_FIELDS.includes(name)) {
      // Reservation narrowed -> clamp operational times, then handle event time window
      const clampOps = clampOperationalTimesToReservation(updatedData);
      if (clampOps) Object.assign(updatedData, clampOps);

      const clampResult = clampEventTimesToReservation(updatedData);
      if (clampResult) {
        updatedData.startTime = clampResult.startTime;
        updatedData.endTime = clampResult.endTime;
      }
    }

    setFormData(updatedData);
    setHasChanges(true);

    notifyDataChange(updatedData);
  };

  const handleRoomSelectionChange = (newSelectedRooms) => {
    const updatedData = {
      ...formData,
      requestedRooms: newSelectedRooms,
      locationDisplayNames: newSelectedRooms.map(id => getLocationName(id)).join(', '),
    };
    setFormData(updatedData);
    setHasChanges(true);

    // Notify parent component of change so save button gets enabled
    notifyDataChange(updatedData);
  };

  const handleRemoveAssistantRoom = (room) => {
    // Update formData.requestedRooms - assistantRooms is derived from this via useMemo
    setFormData(prev => {
      const updatedRooms = prev.requestedRooms.filter(id => id !== room._id);
      return {
        ...prev,
        requestedRooms: updatedRooms,
        locationDisplayNames: updatedRooms.map(id => getLocationName(id)).join(', '),
      };
    });
    setHasChanges(true);
  };

  const handleEventTimeChange = (updatedTimes) => {
    // Only update fields that were explicitly included in the update.
    // Optional times (setupTime, teardownTime, doorOpenTime, doorCloseTime) are only
    // included when they have values and were changed; otherwise they're preserved from formData.
    const updatedData = { ...formData };
    if ('startTime' in updatedTimes) updatedData.startTime = updatedTimes.startTime;
    if ('endTime' in updatedTimes) updatedData.endTime = updatedTimes.endTime;
    if ('setupTime' in updatedTimes) updatedData.setupTime = updatedTimes.setupTime;
    if ('teardownTime' in updatedTimes) updatedData.teardownTime = updatedTimes.teardownTime;
    if ('reservationStartTime' in updatedTimes) updatedData.reservationStartTime = updatedTimes.reservationStartTime;
    if ('reservationEndTime' in updatedTimes) updatedData.reservationEndTime = updatedTimes.reservationEndTime;

    // Enforce reservation as outer bounds (bidirectional)
    const isReservationChange = RESERVATION_TIME_FIELDS.some(f => f in updatedTimes);
    const isOperationalChange = OPERATIONAL_TIME_FIELDS.some(f => f in updatedTimes);

    if (isOperationalChange && !isReservationChange) {
      // Pure operational change (SA drag of inner marker) -> expand reservation to contain it
      const expansion = expandReservationToContainOperationalTimes(updatedData);
      if (expansion) {
        if (expansion.reservationStartTime) updatedData.reservationStartTime = expansion.reservationStartTime;
        if (expansion.reservationEndTime) updatedData.reservationEndTime = expansion.reservationEndTime;
      }
    } else if (isReservationChange && !isOperationalChange) {
      // Pure reservation change (SA edge resize) -> clamp inner times to stay within
      const clampOps = clampOperationalTimesToReservation(updatedData);
      if (clampOps) Object.assign(updatedData, clampOps);

      const clampResult = clampEventTimesToReservation(updatedData);
      if (clampResult) {
        updatedData.startTime = clampResult.startTime;
        updatedData.endTime = clampResult.endTime;
      }
    }
    // Whole-block drag (both flags true): SA shifts all times by the same delta,
    // so they remain internally consistent — no expansion or clamping needed.

    setFormData(updatedData);
    setHasChanges(true);

    // Notify parent of data change (consistent with handleInputChange)
    notifyDataChange(updatedData);
  };

  const handleClearEventTime = () => {
    const updatedData = {
      ...formData,
      startTime: '',
      endTime: '',
      setupTime: '',
      teardownTime: '',
      reservationStartTime: '',
      reservationEndTime: '',
      reservationStartMinutes: 0,
      reservationEndMinutes: 0,
    };
    setFormData(updatedData);
    setHasChanges(true);
    notifyDataChange(updatedData);
  };

  const handleTimeSlotClick = (hour) => {
    // Create a 1-hour reservation block at the clicked hour
    const startTime = `${String(hour).padStart(2, '0')}:00`;
    const endHour = Math.min(hour + 1, 23);
    const endMinute = hour >= 23 ? '59' : '00';
    const endTime = `${String(endHour).padStart(2, '0')}:${endMinute}`;
    handleEventTimeChange({ reservationStartTime: startTime, reservationEndTime: endTime });
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
    setRecurrencePattern(null);
    setHasChanges(true);

    // Notify parent component
    notifyDataChange({ ...formData, recurrence: null });
  };

  // Handle virtual meeting URL inline change
  const handleVirtualUrlChange = (e) => {
    const url = e.target.value;
    setVirtualMeetingUrl(url);

    if (url && !isValidUrl(url)) {
      setVirtualUrlError('Please enter a valid URL (e.g., https://zoom.us/j/123)');
    } else {
      setVirtualUrlError('');
      setFormData(prev => ({ ...prev, virtualMeetingUrl: url }));
      setHasChanges(true);
      notifyDataChange({ ...formData, virtualMeetingUrl: url });
    }
  };

  const handleClearVirtualUrl = () => {
    setVirtualMeetingUrl('');
    setVirtualUrlError('');
    setFormData(prev => ({ ...prev, virtualMeetingUrl: '' }));
    setHasChanges(true);
    notifyDataChange({ ...formData, virtualMeetingUrl: '' });
  };

  // Detected platform memo
  const detectedPlatform = useMemo(() => {
    return virtualMeetingUrl && isValidUrl(virtualMeetingUrl) ? detectPlatform(virtualMeetingUrl) : null;
  }, [virtualMeetingUrl]);


  // Handle series event navigation click (from MultiDatePicker - handles inline confirmation internally)
  const handleSeriesEventClick = (event) => {
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
  // In edit request mode, allow editing even if readOnly is true (for requesters to propose changes)
  // In viewing edit request mode, keep fields disabled UNLESS user is admin/approver (they can modify proposed changes)
  // Admins and users with canEditEvents permission can edit published/rejected events
  const isApproverViewingEditRequest = isViewingEditRequest && (isAdmin || canEditEvents);
  const fieldsDisabled = (isViewingEditRequest && !isAdmin && !canEditEvents) || (readOnly && !isEditRequestMode && !isApproverViewingEditRequest) || (!isAdmin && !canEditEvents && !isEditRequestMode && reservationStatus && reservationStatus !== 'pending' && reservationStatus !== 'draft' && reservationStatus !== 'rejected');

  // For Internal Notes fields: department users (Security/Maintenance) can edit their fields
  // even on published events. Only respect isViewingEditRequest for non-admin/non-approver users.
  // because department-based editing is a special override for these specific fields.
  const internalNotesBaseDisabled = isViewingEditRequest && !isAdmin && !canEditEvents;

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
                  You are requesting changes to this published event. Modified fields will show the original value with strikethrough.
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

            {/* Rejection Reason Banner (read-only, shown when viewing rejected events) */}
            {reservationStatus === 'rejected' && formData.reviewNotes && (
              <div className="rejection-reason-banner">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div className="rejection-reason-content">
                  <span className="rejection-reason-label">Rejection Reason</span>
                  <span className="rejection-reason-text">{formData.reviewNotes}</span>
                </div>
              </div>
            )}

            {/* Edit Scope Indicator for Recurring Events */}
            {editScope === 'allEvents' && (
              <div className="edit-scope-indicator all-events">
                <span className="edit-scope-icon"><RecurringIcon size={18} /></span>
                <span className="edit-scope-text">
                  <span className="edit-scope-title">Editing entire series</span>
                  <span className="edit-scope-subtitle">Changes will apply to all events in the series.</span>
                </span>
                <span className="scope-badge series-badge">Series master</span>
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


            {/* Action Bar - Categories, Services, Virtual Meeting */}
            <div className="action-bar-row" ref={virtualPopoverRef}>
              <div className={`form-group required-field ${selectedCategories.length > 0 ? 'field-valid' : ''}`}>
                <button
                  type="button"
                  className={`all-day-toggle ${selectedCategories.length > 0 ? 'active' : ''}`}
                  onClick={() => setShowCategoryModal(true)}
                  disabled={fieldsDisabled}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  🏷️ Categories *
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
                  {Object.keys(selectedServices).length > 0 ? '🛎️ Services' : '🛎️ Services'}
                </button>
              </div>
              <div className="form-group">
                <button
                  type="button"
                  className={`all-day-toggle ${virtualMeetingUrl && !virtualUrlError ? 'active' : ''}`}
                  onClick={() => setShowVirtualPopover(prev => !prev)}
                  disabled={fieldsDisabled}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {detectedPlatform ? `🎥 ${detectedPlatform.name}` : '🎥 Virtual'}
                </button>
              </div>

              {/* Virtual Meeting URL Popover */}
              {showVirtualPopover && (
                <div className="virtual-popover">
                  <div className="virtual-popover-header">
                    <span className="virtual-popover-label">Virtual Meeting URL</span>
                    <button
                      type="button"
                      className="virtual-popover-close"
                      onClick={() => setShowVirtualPopover(false)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="virtual-url-input-wrapper">
                    <input
                      type="url"
                      className={`virtual-url-input ${virtualUrlError ? 'virtual-url-invalid' : virtualMeetingUrl ? 'virtual-url-valid' : ''}`}
                      value={virtualMeetingUrl}
                      onChange={handleVirtualUrlChange}
                      placeholder="https://zoom.us/j/123456789"
                      disabled={fieldsDisabled}
                      autoFocus
                    />
                    {detectedPlatform && !virtualUrlError && (
                      <span className="virtual-platform-badge">
                        {detectedPlatform.icon} {detectedPlatform.name}
                      </span>
                    )}
                    {virtualMeetingUrl && !fieldsDisabled && (
                      <button type="button" className="virtual-url-clear" onClick={handleClearVirtualUrl}
                        aria-label="Clear virtual meeting URL">×</button>
                    )}
                  </div>
                  {virtualUrlError && (
                    <div className="virtual-url-error">{virtualUrlError}</div>
                  )}
                </div>
              )}
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

            {/* Recurrence is managed entirely via the Recurrence tab */}

            {/* Event Organizer — optional, for security/operations contact */}
            <div className="organizer-row">
              <div className="form-group">
                <label htmlFor="organizerName">Organizer Name</label>
                <input
                  type="text"
                  id="organizerName"
                  name="organizerName"
                  value={formData.organizerName}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  placeholder="John Doe"
                />
              </div>
              <div className="form-group">
                <label htmlFor="organizerPhone">Organizer Phone</label>
                <input
                  type="tel"
                  id="organizerPhone"
                  name="organizerPhone"
                  value={formData.organizerPhone}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  placeholder="212-744-1400"
                />
              </div>
              <div className="form-group">
                <label htmlFor="organizerEmail">Organizer Email</label>
                <input
                  type="email"
                  id="organizerEmail"
                  name="organizerEmail"
                  value={formData.organizerEmail}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  placeholder="example@email.com"
                />
              </div>
            </div>

            {/* Date + Attendees Row (3-column compact) */}
            <div className="date-attendees-row">
              <div className={`form-group required-field ${isFieldValid('startDate') ? 'field-valid' : ''} ${hasFieldChanged('startDate') ? 'field-changed' : ''}`}>
                <label htmlFor="startDate">
                  {recurrencePattern ? 'Start Date' : 'Event Date'}
                </label>
                {hasFieldChanged('startDate') && (
                  <div className="inline-diff">
                    <span className="diff-old">{getOriginalValue('startDate') || '(empty)'}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <DatePickerInput
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
                <label htmlFor="endDate">
                  {recurrencePattern ? 'End Date' : 'End Date'}
                </label>
                {hasFieldChanged('endDate') && (
                  <div className="inline-diff">
                    <span className="diff-old">{getOriginalValue('endDate') || '(empty)'}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <DatePickerInput
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

              <div className={`form-group required-field ${isFieldValid('attendeeCount') ? 'field-valid' : ''} ${hasFieldChanged('attendeeCount') ? 'field-changed' : ''}`}>
                <label htmlFor="attendeeCount">Attendees</label>
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
                  placeholder="#"
                  disabled={fieldsDisabled}
                  style={{ width: '100%', maxWidth: 'none' }}
                  className={hasFieldChanged('attendeeCount') ? 'input-changed' : ''}
                />
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

            {/* Time Fields — All times in unified block with group headers + operations accordion */}
            <div className="time-fields-stack">
              {/* Reservation group header with All Day toggle */}
              <div className="time-group-header">
                <span className="group-indicator required" />
                <span>Reservation</span>
                <button
                  type="button"
                  className={`time-block-allday-toggle ${formData.isAllDayEvent ? 'active' : ''}`}
                  onClick={() => {
                    const turningOn = !formData.isAllDayEvent;
                    setFormData(prev => ({
                      ...prev,
                      isAllDayEvent: turningOn,
                      ...(turningOn
                        ? {
                            reservationStartTime: '00:00',
                            reservationEndTime: '23:59',
                            startTime: '',
                            endTime: '',
                          }
                        : {
                            reservationStartTime: '',
                            reservationEndTime: '',
                            startTime: '',
                            endTime: '',
                          }
                      ),
                    }));
                    setHasChanges(true);
                  }}
                  disabled={fieldsDisabled}
                >
                  {formData.isAllDayEvent ? '✓ ' : ''}All Day
                </button>
              </div>

              <div className={`form-group required-field ${isFieldValid('reservationStartTime') ? 'field-valid' : ''} ${hasFieldChanged('reservationStartTime') ? 'field-changed' : ''}`}>
                <label htmlFor="reservationStartTime">Start Time</label>
                {hasFieldChanged('reservationStartTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('reservationStartTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <TimePickerInput
                  id="reservationStartTime"
                  name="reservationStartTime"
                  value={formData.reservationStartTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled || formData.isAllDayEvent}
                  required
                  className={hasFieldChanged('reservationStartTime') ? 'input-changed' : ''}
                />
              </div>

              <div className={`form-group required-field ${isFieldValid('reservationEndTime') ? 'field-valid' : ''} ${hasFieldChanged('reservationEndTime') ? 'field-changed' : ''}`}>
                <label htmlFor="reservationEndTime">End Time</label>
                {hasFieldChanged('reservationEndTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('reservationEndTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <TimePickerInput
                  id="reservationEndTime"
                  name="reservationEndTime"
                  value={formData.reservationEndTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled || formData.isAllDayEvent}
                  required
                  className={hasFieldChanged('reservationEndTime') ? 'input-changed' : ''}
                />
              </div>

              {/* Event & Operations group header */}
              <div className="time-group-header">
                <span className="group-indicator optional" />
                <span>Event & Operations</span>
              </div>

              <div className={`form-group ${hasFieldChanged('startTime') ? 'field-changed' : ''}`}>
                <label htmlFor="startTime">Start Time</label>
                {hasFieldChanged('startTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('startTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <TimePickerInput
                  id="startTime"
                  name="startTime"
                  value={formData.startTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  clearable
                  className={hasFieldChanged('startTime') ? 'input-changed' : ''}
                />
              </div>

              <div className={`form-group ${hasFieldChanged('endTime') ? 'field-changed' : ''}`}>
                <label htmlFor="endTime">End Time</label>
                {hasFieldChanged('endTime') && (
                  <div className="inline-diff">
                    <span className="diff-old">{formatTimeForDisplay(getOriginalValue('endTime'))}</span>
                    <span className="diff-arrow">→</span>
                  </div>
                )}
                <TimePickerInput
                  id="endTime"
                  name="endTime"
                  value={formData.endTime}
                  onChange={handleInputChange}
                  disabled={fieldsDisabled}
                  clearable
                  className={hasFieldChanged('endTime') ? 'input-changed' : ''}
                />
              </div>

              <div className="operations-content expanded">
                <div className={`form-group ${hasFieldChanged('setupTime') ? 'field-changed' : ''}`}>
                  <label htmlFor="setupTime">Setup</label>
                  <TimePickerInput
                    id="setupTime"
                    name="setupTime"
                    value={formData.setupTime}
                    onChange={handleInputChange}
                    disabled={internalNotesBaseDisabled || !canEditField('setupNotes')}
                  />
                </div>
                <div className={`form-group ${hasFieldChanged('teardownTime') ? 'field-changed' : ''}`}>
                  <label htmlFor="teardownTime">Teardown</label>
                  <TimePickerInput
                    id="teardownTime"
                    name="teardownTime"
                    value={formData.teardownTime}
                    onChange={handleInputChange}
                    disabled={internalNotesBaseDisabled || !canEditField('setupNotes')}
                  />
                </div>
                <div className={`form-group ${hasFieldChanged('doorOpenTime') ? 'field-changed' : ''}`}>
                  <label htmlFor="doorOpenTime">Doors Open</label>
                  {hasFieldChanged('doorOpenTime') && (
                    <div className="inline-diff">
                      <span className="diff-old">{formatTimeForDisplay(getOriginalValue('doorOpenTime'))}</span>
                      <span className="diff-arrow">→</span>
                    </div>
                  )}
                  <TimePickerInput
                    id="doorOpenTime"
                    name="doorOpenTime"
                    value={formData.doorOpenTime}
                    onChange={handleInputChange}
                    disabled={internalNotesBaseDisabled || !canEditField('doorNotes')}
                    className={hasFieldChanged('doorOpenTime') ? 'input-changed' : ''}
                  />
                </div>
                <div className={`form-group ${hasFieldChanged('doorCloseTime') ? 'field-changed' : ''}`}>
                  <label htmlFor="doorCloseTime">Doors Close</label>
                  {hasFieldChanged('doorCloseTime') && (
                    <div className="inline-diff">
                      <span className="diff-old">{formatTimeForDisplay(getOriginalValue('doorCloseTime'))}</span>
                      <span className="diff-arrow">→</span>
                    </div>
                  )}
                  <TimePickerInput
                    id="doorCloseTime"
                    name="doorCloseTime"
                    value={formData.doorCloseTime}
                    onChange={handleInputChange}
                    disabled={internalNotesBaseDisabled || !canEditField('doorNotes')}
                    className={hasFieldChanged('doorCloseTime') ? 'input-changed' : ''}
                  />
                </div>
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
                  Times should follow this order: Reservation Start → Setup → Door Open → Event Start → Event End → Door Close → Teardown → Reservation End
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

            {(formData.reservationStartTime || formData.requestedRooms.length > 0 || virtualMeetingUrl || formData.isOffsite) && (
              <div className="event-summary-pill">
                {formData.reservationStartTime && formData.reservationEndTime && (
                  <span className="summary-time">
                    {formatTimeString(formData.reservationStartTime)} to {formatTimeString(formData.reservationEndTime)}
                  </span>
                )}
                {formData.reservationStartTime && formData.reservationEndTime && (formData.requestedRooms.length > 0 || virtualMeetingUrl || formData.isOffsite) && (
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
                    setupTime={formData.reservationStartTime}
                    teardownTime={formData.reservationEndTime}
                    rawSetupTime={formData.setupTime}
                    rawTeardownTime={formData.teardownTime}
                    rawDoorOpenTime={formData.doorOpenTime}
                    rawDoorCloseTime={formData.doorCloseTime}
                    reservationStartTime={formData.reservationStartTime}
                    reservationEndTime={formData.reservationEndTime}
                    eventTitle={formData.eventTitle}
                    availability={availability}
                    availabilityLoading={availabilityLoading}
                    onTimeSlotClick={handleTimeSlotClick}
                    onRoomRemove={handleRemoveAssistantRoom}
                    onEventTimeChange={handleEventTimeChange}
                    onClearEventTime={handleClearEventTime}
                    currentReservationId={currentReservationId}
                    onLockedEventClick={onLockedEventClick}
                    defaultCalendar={defaultCalendar}
                    isAllDayEvent={formData.isAllDayEvent}
                    organizerName={formData.requesterName}
                    organizerEmail={formData.requesterEmail}
                    isAllowedConcurrent={formData.isAllowedConcurrent || false}
                    categories={formData.categories || []}
                    categoryConcurrentRules={categoryConcurrentRules}
                    categoryLookup={categoryLookup}
                    disabled={fieldsDisabled}
                    onConflictChange={onConflictChange}
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

            {/* Internal Notes Section (Staff Use Only) */}
            <div className="internal-notes-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '6px' }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Internal Notes
              </h4>
              <div className="internal-notes-disclaimer">
                These notes are for internal staff coordination and will not be visible to the requester.
              </div>

              <div className="form-group">
                <label htmlFor="setupNotes">Setup Notes (Maintenance)</label>
                <textarea
                  id="setupNotes"
                  name="setupNotes"
                  value={formData.setupNotes}
                  onChange={handleInputChange}
                  rows="2"
                  disabled={internalNotesBaseDisabled || !canEditField('setupNotes')}
                  placeholder="Notes for setup crew..."
                />
              </div>

              <div className="form-group">
                <label htmlFor="doorNotes">Door/Access Notes (Security)</label>
                <textarea
                  id="doorNotes"
                  name="doorNotes"
                  value={formData.doorNotes}
                  onChange={handleInputChange}
                  rows="2"
                  disabled={internalNotesBaseDisabled || !canEditField('doorNotes')}
                  placeholder="Notes about door/access requirements..."
                />
              </div>
            </div>

            {/* Admin Notes (Review mode only) */}
            {reservationStatus === 'pending' && (
              <div className="admin-review-notes-section">
                <h4 className="admin-review-notes-heading">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '6px' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
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
            )}

            {/* Concurrent Scheduling Info (read-only, governed by category rules) */}
            {formData.isAllowedConcurrent && (
              <div className="concurrent-events-badge">
                <div className="concurrent-events-badge-row">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                  <span>This event allows concurrent scheduling</span>
                </div>
                <div className="concurrent-events-badge-sub">
                  Concurrent scheduling rules are managed in Admin &gt; Categories.
                </div>
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

      {/* Render additional content (tabs, attachments, history, etc.) */}
      {renderAdditionalContent && renderAdditionalContent(formData)}

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
