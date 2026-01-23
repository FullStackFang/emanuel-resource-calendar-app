  // src/components/Calendar.jsx
  import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
  import { msalConfig } from '../config/authConfig';
  import Modal from './Modal';
  import EventForm from './EventForm';
  import MultiSelect from './MultiSelect';
  import ExportToPdfButton from './CalendarExport';
  import EventSearch from './EventSearch';
  import MonthView from './MonthView';
  import WeekView from './WeekView';
  import DayView from './DayView';
  import RegistrationTimesToggle from './RegistrationTimesToggle';
  import WeekTimelineModal from './WeekTimelineModal';
  import DayTimelineModal from './DayTimelineModal';
  import { logger } from '../utils/logger';
  import calendarDebug from '../utils/calendarDebug';
  import { transformRecurrenceForGraphAPI, expandRecurringSeries } from '../utils/recurrenceUtils';
  import './Calendar.css';
  import APP_CONFIG from '../config/config';
  import './DayEventPanel.css';
  import DayEventPanel from './DayEventPanel';
  import eventDataService from '../services/eventDataService';
  import unifiedEventService from '../services/unifiedEventService';
  import DatePicker from 'react-datepicker';
  import "react-datepicker/dist/react-datepicker.css";
  import calendarDataService from '../services/calendarDataService';
  import { useReviewModal } from '../hooks/useReviewModal';
  import ReviewModal from './shared/ReviewModal';
  import RecurringScopeDialog from './shared/RecurringScopeDialog';
  import LoadingSpinner from './shared/LoadingSpinner';
  import RoomReservationReview from './RoomReservationReview';
    // import { getCalendars } from '../services/graphService';
  import { 
    createLinkedEvents,
    findLinkedEvent,
    updateLinkedEvent,
    deleteLinkedEvent
  } from '../services/graphService';
  import { useTimezone } from '../context/TimezoneContext';
  import { useRooms, useLocations } from '../context/LocationContext';
  import { useNotification } from '../context/NotificationContext';
  import { usePermissions } from '../hooks/usePermissions';
  import { useQueryClient } from '@tanstack/react-query';
  import { useBaseCategoriesQuery, useOutlookCategoriesQuery, OUTLOOK_CATEGORIES_QUERY_KEY } from '../hooks/useCategoriesQuery';
  import {
    TimezoneSelector,
    formatEventTime,
    formatDateHeader,
    formatDateRangeForAPI,
    calculateEndDate,
    snapToStartOfWeek,
    formatDateObjectForGraph,
    getOutlookTimezone
  } from '../utils/timezoneUtils';
  import CalendarHeader from './CalendarHeader';

  // API endpoint - use the full URL to your API server
  const API_BASE_URL = APP_CONFIG.API_BASE_URL;
  // const API_BASE_URL = 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api'
  // const API_BASE_URL = 'http://localhost:3001/api';

  /*****************************************************************************
   * CONSTANTS AND CONFIGURATION
   *****************************************************************************/
  const categories = [
  ];

  /*****************************************************************************
   * MAIN CALENDAR COMPONENT
   *****************************************************************************/
  function Calendar({ 
    graphToken, 
    apiToken,
    selectedCalendarId,
    setSelectedCalendarId,
    availableCalendars,
    setAvailableCalendars,
    changingCalendar,
    setChangingCalendar,
    showRegistrationTimes: showRegistrationTimesProp
  }) {
    //---------------------------------------------------------------------------
    // STATE MANAGEMENT
    //---------------------------------------------------------------------------
    // Loading state
    const initializationStarted = useRef(false);

    // Demo variables
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [demoData, setDemoData] = useState(null);
    const [isUploadingDemo, setIsUploadingDemo] = useState(false);

    const [initializing, setInitializing] = useState(true);
    const [loading, setLoading] = useState(false);
    const [savingEvent, setSavingEvent] = useState(false);
    const [loadingState, setLoadingState] = useState({
      user: true,
      categories: true,
      extensions: true,
      events: true
    });

    // Calendar access error (when user has no access to any allowed calendars)
    const [calendarAccessError, setCalendarAccessError] = useState(null);

    // Core calendar data
    const [allEvents, setAllEventsState] = useState([]);
    // Ref to always have access to current allEvents in callbacks (prevents stale closure)
    const allEventsRef = useRef(allEvents);
    const [showSearch, setShowSearch] = useState(false);
    const [schemaExtensions, setSchemaExtensions] = useState([]);

    // Use TanStack Query for categories - provides automatic caching and background refresh
    const queryClient = useQueryClient();
    const { data: baseCategories = [] } = useBaseCategoriesQuery(apiToken);
    const { data: outlookCategories = [] } = useOutlookCategoriesQuery(graphToken);

    // Track last summary time to prevent duplicate summaries
    const lastSummaryTimeRef = useRef(0);

    // Memoization cache for recurring event expansion (prevents redundant calculations)
    const expansionCacheRef = useRef(new Map());
    const MAX_EXPANSION_CACHE_SIZE = 5; // Keep last 5 expansions

    // Safe wrapper for setAllEvents to prevent accidentally clearing events
    const setAllEvents = useCallback((newEvents) => {
      // Validate the new events
      if (!Array.isArray(newEvents)) {
        logger.error('setAllEvents: Invalid input - not an array', { type: typeof newEvents });
        return;
      }
      
      // Setting events

      // High-level summary logging for event state updates (throttled to once per 2 seconds)
      const now = Date.now();
      const timeSinceLastSummary = now - lastSummaryTimeRef.current;

      if (newEvents.length > 0 && timeSinceLastSummary > 2000) {
        lastSummaryTimeRef.current = now;

        // Group events by category
        const categoryCounts = {};
        const locationCounts = {};
        newEvents.forEach(event => {
          // Extract categories from either top-level or graphData
          const categories = event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
          const primaryCategory = categories[0] || 'Uncategorized';
          const location = event.location?.displayName || 'Unspecified';
          categoryCounts[primaryCategory] = (categoryCounts[primaryCategory] || 0) + 1;
          locationCounts[location] = (locationCounts[location] || 0) + 1;
        });

        logger.debug(`Events loaded: ${newEvents.length} (${Object.keys(categoryCounts).length} categories, ${Object.keys(locationCounts).length} locations)`);
      }

      // Warn if clearing events
      if (newEvents.length === 0 && allEvents.length > 0) {
        logger.warn('setAllEvents: Clearing all events (was ' + allEvents.length + ' events)');
      }

      setAllEventsState(newEvents);
    }, [allEvents]);

    // Update ref whenever allEvents changes to prevent stale closures in callbacks
    useEffect(() => {
      allEventsRef.current = allEvents;
    }, [allEvents]);

    // UI state
    const [groupBy, setGroupBy] = useState('locations');
    const [viewType, setViewType] = useState('week');
    const [zoomLevel, setZoomLevel] = useState(100);
    const [selectedFilter, setSelectedFilter] = useState(''); 
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [selectedLocations, setSelectedLocations] = useState([]);

    const [currentDate, setCurrentDate] = useState(new Date());

    // Separate filters for month view
    const [, setSelectedCategoryFilter] = useState('');
    const [, setSelectedLocationFilter] = useState('');
    
    // Registration times toggle state
    const [showRegistrationTimes, setShowRegistrationTimes] = useState(showRegistrationTimesProp || false);

    // Profile states
    const { userTimezone, setUserTimezone } = useTimezone();
    const { rooms } = useRooms();
    const { generalLocations, loading: locationsLoading } = useLocations();
    const { showError, showSuccess, showWarning, showNotification } = useNotification();
    const hasUserManuallyChangedTimezone = useRef(false);
    const [currentUser, setCurrentUser] = useState(null);

    // Role Simulation permissions - these override hardcoded permissions for UI testing
    const {
      canCreateEvents,
      canEditEvents,
      canDeleteEvents,
      canSubmitReservation,
      canApproveReservations,
      isAdmin: isSimulatedAdmin,
      isSimulating
    } = usePermissions();

    // Timezone context initialized

    const [, setUserProfile] = useState(null);
    const [userPermissions, setUserPermissions] = useState({
      startOfWeek: 'Monday',
      defaultView: 'week',
      defaultGroupBy: 'categories',
      preferredZoomLevel: 100,
      preferredTimeZone: 'America/New_York',
      createEvents: true, // TEMPORARY: Set to true for testing
      editEvents: true,   // TEMPORARY: Set to true for testing
      deleteEvents: true, // TEMPORARY: Set to true for testing
      isAdmin: true,      // TEMPORARY: Set to true for testing
    });

    // User permissions initialized

    // Effective permissions: Role Simulation overrides action permissions when simulating
    const effectivePermissions = useMemo(() => ({
      // User preferences (always from userPermissions state)
      startOfWeek: userPermissions.startOfWeek,
      defaultView: userPermissions.defaultView,
      defaultGroupBy: userPermissions.defaultGroupBy,
      preferredZoomLevel: userPermissions.preferredZoomLevel,
      preferredTimeZone: userPermissions.preferredTimeZone,
      // Action permissions: use Role Simulation when simulating, otherwise use userPermissions
      createEvents: isSimulating ? canCreateEvents : userPermissions.createEvents,
      editEvents: isSimulating ? canEditEvents : userPermissions.editEvents,
      deleteEvents: isSimulating ? canDeleteEvents : userPermissions.deleteEvents,
      submitReservation: isSimulating ? canSubmitReservation : (userPermissions.submitReservation ?? true),
      isAdmin: isSimulating ? isSimulatedAdmin : userPermissions.isAdmin,
    }), [userPermissions, isSimulating, canCreateEvents, canEditEvents, canDeleteEvents, canSubmitReservation, isSimulatedAdmin]);

    // Calculate date range based on current view and user preferences
    const dateRange = useMemo(() => {
      let start = new Date(currentDate);
      let end;

      if (viewType === 'week') {
        start = snapToStartOfWeek(currentDate, userPermissions.startOfWeek);
        end = calculateEndDate(start, 'week');
      } else if (viewType === 'month') {
        start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        end = calculateEndDate(start, 'month');
      } else {
        // day view
        end = calculateEndDate(start, 'day');
      }

      return { start, end };
    }, [currentDate, viewType, userPermissions.startOfWeek]);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalType, setModalType] = useState('add'); // 'add', 'edit', 'view', 'delete'
    const [currentEvent, setCurrentEvent] = useState(null);

    // Event creation ReviewModal state
    const [eventReviewModal, setEventReviewModal] = useState({
      isOpen: false,
      event: null,
      mode: 'event', // 'event' for direct creation, 'create' for reservation requests
      hasChanges: false, // Track if form has been modified
      isFormValid: true, // Track if all required fields are filled
      isNavigating: false // Track if navigating between series events
    });

    // Multi-day event confirmation state
    const [pendingMultiDayConfirmation, setPendingMultiDayConfirmation] = useState(null); // { eventCount: number } or null

    // Event delete confirmation state
    const [pendingEventDeleteConfirmation, setPendingEventDeleteConfirmation] = useState(false);

    // Save/Create confirmation state (for single events - multi-day has its own confirmation)
    const [pendingSaveConfirmation, setPendingSaveConfirmation] = useState(false);

    // Draft state for reservation requests
    const [draftId, setDraftId] = useState(null);
    const [savingDraft, setSavingDraft] = useState(false);
    const [showDraftSaveDialog, setShowDraftSaveDialog] = useState(false);

    // Edit request mode state (for inline editing to create edit requests)
    const [isEditRequestMode, setIsEditRequestMode] = useState(false);
    const [editRequestChangeReason, setEditRequestChangeReason] = useState('');
    const [originalEventData, setOriginalEventData] = useState(null);
    const [isSubmittingEditRequest, setIsSubmittingEditRequest] = useState(false);
    const [pendingEditRequestConfirmation, setPendingEditRequestConfirmation] = useState(false);
    // Existing edit request state (for viewing pending edit requests)
    const [existingEditRequest, setExistingEditRequest] = useState(null);
    const [isViewingEditRequest, setIsViewingEditRequest] = useState(false);
    const [loadingEditRequest, setLoadingEditRequest] = useState(false);
    // Edit request approval/rejection state (for admins)
    const [isApprovingEditRequest, setIsApprovingEditRequest] = useState(false);
    const [isRejectingEditRequest, setIsRejectingEditRequest] = useState(false);
    const [editRequestRejectionReason, setEditRequestRejectionReason] = useState('');
    const [isEditRequestApproveConfirming, setIsEditRequestApproveConfirming] = useState(false);
    const [isEditRequestRejectConfirming, setIsEditRequestRejectConfirming] = useState(false);
    // Cancel edit request state (for requesters)
    const [isCancelingEditRequest, setIsCancelingEditRequest] = useState(false);
    const [isCancelEditRequestConfirming, setIsCancelEditRequestConfirming] = useState(false);

    // Timeline modal state for location view
    const [timelineModal, setTimelineModal] = useState({
      isOpen: false,
      locationName: '',
      dateRange: [],
      events: [],
      viewType: 'week' // 'week' or 'day'
    });

    // Navigation state for reviewModal
    const [reviewModalIsNavigating, setReviewModalIsNavigating] = useState(false);

    // Recurring event scope dialog state
    const [recurringScopeDialog, setRecurringScopeDialog] = useState({
      isOpen: false,
      pendingEvent: null
    });

    // Review modal hook for handling review functionality
    const reviewModal = useReviewModal({
      apiToken,
      graphToken,
      selectedCalendarId, // Pass current calendar so approved events go to correct calendar
      onSuccess: () => {
        // Reload events after successful approval/rejection
        loadEvents(true);
        // Reset edit request mode
        setIsEditRequestMode(false);
        setEditRequestChangeReason('');
        setOriginalEventData(null);
      },
      onError: (error) => {
        logger.error('Review modal error:', error);
        showError(error, { context: 'Calendar.reviewModal' });
      }
    });

    // Reset hasChanges after event review modal form initializes
    // This prevents false "unsaved changes" prompts when opening and immediately closing
    useEffect(() => {
      if (eventReviewModal.isOpen && eventReviewModal.event) {
        // Small delay to allow form to initialize, then reset hasChanges
        const timer = setTimeout(() => {
          setEventReviewModal(prev => {
            // Only reset if still open and hasChanges was set during initialization
            if (prev.isOpen && prev.hasChanges) {
              return { ...prev, hasChanges: false };
            }
            return prev;
          });
        }, 150);
        return () => clearTimeout(timer);
      }
    }, [eventReviewModal.isOpen, eventReviewModal.event?._id, eventReviewModal.event?.eventId]);

    // Reset edit request mode when review modal closes
    useEffect(() => {
      if (!reviewModal.isOpen && isEditRequestMode) {
        setIsEditRequestMode(false);
        setEditRequestChangeReason('');
        setOriginalEventData(null);
      }
    }, [reviewModal.isOpen, isEditRequestMode]);

    //---------------------------------------------------------------------------
    // SIMPLE UTILITY FUNCTIONS (no dependencies on other functions)
    //---------------------------------------------------------------------------

    /**
     * Generate save confirmation button text with event summary
     * Format: ⚠️ Create "Event Name" at Location (Start - End)?
     */
    const getSaveConfirmationText = useCallback(() => {
      if (!pendingSaveConfirmation || !eventReviewModal.event) return null;

      const event = eventReviewModal.event;
      const title = event.eventTitle || 'Untitled Event';

      // Get location names - check requestedRooms first (current form state), then locations
      const locationIds = event.requestedRooms?.length > 0
        ? event.requestedRooms
        : (event.locations || []);
      const locationNames = locationIds
        .map(id => rooms.find(r => r._id === id || r._id?.toString() === id?.toString())?.name)
        .filter(Boolean)
        .join(', ') || 'No location';

      // Format time
      const startTime = event.startTime || '';
      const endTime = event.endTime || '';
      const timeStr = startTime && endTime ? `${startTime} - ${endTime}` : '';

      // Determine if creating new or editing existing
      const isEditing = !!(event.eventId || event.id);
      const actionWord = isEditing ? 'Save' : 'Create';

      return `⚠️ ${actionWord} "${title}" at ${locationNames} (${timeStr})?`;
    }, [pendingSaveConfirmation, eventReviewModal.event, rooms]);

    /**
     * Generate approve confirmation button text with event summary and target calendar
     * Format: ⚠️ Approve "Event Name" to [Calendar Name]?
     */
    const getApproveConfirmationText = useCallback(() => {
      if (!reviewModal.pendingApproveConfirmation || !reviewModal.currentItem) return null;

      const item = reviewModal.currentItem;
      const title = item.graphData?.subject || item.eventTitle || 'Untitled Event';

      // Get target calendar display name
      const targetCalendar = availableCalendars?.find(c => c.id === selectedCalendarId);
      const calendarName = targetCalendar?.name || selectedCalendarId || 'Default Calendar';

      return `⚠️ Approve "${title}" to ${calendarName}?`;
    }, [reviewModal.pendingApproveConfirmation, reviewModal.currentItem, availableCalendars, selectedCalendarId]);

    /**
     * Handle registration times toggle
     */
    const handleRegistrationTimesToggle = useCallback((enabled) => {
      setShowRegistrationTimes(enabled);
      // Registration times toggled
    }, []);
    /**
     * @param {*} event 
     * @returns 
     */
    const handleDemoDataUpload = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      
      if (!file.name.endsWith('.json')) {
        showWarning('Please select a JSON file');
        return;
      }
      
      setIsUploadingDemo(true);
      
      try {
        const text = await file.text();
        const rawJsonData = JSON.parse(text);
        
        logger.debug('Raw uploaded JSON:', rawJsonData);
        
        // Validate the structure - your JSON has a different structure
        if (!rawJsonData.events || !Array.isArray(rawJsonData.events)) {
          throw new Error('Invalid format: JSON must contain an "events" array');
        }
        
        if (rawJsonData.events.length === 0) {
          throw new Error('No events found in the uploaded file');
        }
        
        // Transform events to match your data format
        const transformedEvents = rawJsonData.events.map((event, index) => {
          try {
            // Your JSON uses "startDateTime" and "endDateTime" directly (no nested structure)
            const startDateTime = event.startDateTime;
            const endDateTime = event.endDateTime;
            
            if (!startDateTime) {
              throw new Error(`Event ${index + 1}: Missing startDateTime`);
            }
            
            if (!endDateTime) {
              throw new Error(`Event ${index + 1}: Missing endDateTime`);
            }
            
            // Parse dates - your format is like "2025-05-30T15:00:00.0000000"
            let startDate, endDate;
            
            try {
              // Handle the .0000000 format by parsing directly
              startDate = new Date(startDateTime);
              endDate = new Date(endDateTime);
            } catch (dateError) {
              throw new Error(`Invalid date format in event ${index + 1}`);
            }
            
            if (isNaN(startDate.getTime())) {
              throw new Error(`Event ${index + 1}: Invalid start date format: ${startDateTime}`);
            }
            
            if (isNaN(endDate.getTime())) {
              throw new Error(`Event ${index + 1}: Invalid end date format: ${endDateTime}`);
            }
            
            if (endDate <= startDate) {
              throw new Error(`Event ${index + 1}: End date must be after start date`);
            }

            // Use locationDisplayNames instead of deprecated location field
            const location = event.locationDisplayNames || '';

            // Your categories field is an array
            const categories = event.categories || [];
            const category = categories.length > 0 ? categories[0] : 'Uncategorized';
            
            return {
              ...event, // Keep all original fields
              id: event.id || `demo_event_${Date.now()}_${index}`,
              subject: event.subject || `Event ${index + 1}`,
              // Store as ISO strings for consistency
              startDateTime: startDate.toISOString(),
              endDateTime: endDate.toISOString(),
              location: location,
              categories: categories,
              category: category
            };
          } catch (error) {
            throw new Error(`Event ${index + 1} validation failed: ${error.message}`);
          }
        });
        
        const processedData = {
          ...rawJsonData,
          events: transformedEvents,
          totalEvents: transformedEvents.length,
          uploadDate: new Date().toISOString()
        };
        
        logger.debug('Processed demo data:', processedData);
        
        // Set demo data
        setDemoData(processedData);
        
        // Configure service for demo mode
        calendarDataService.setDemoMode(processedData);
        setIsDemoMode(true);
        
        logger.log('Demo mode activated, loading events...');
        
        // Test loading events for current date range
        const events = await calendarDataService.getEvents(dateRange);
        logger.debug('Loaded demo events for current range:', events);
        
        if (events.length === 0) {
          logger.warn('No events in current date range. Navigating to events...');
          
          // Find the date range of your events and navigate there
          const eventDates = transformedEvents.map(e => new Date(e.startDateTime));
          const earliestEvent = new Date(Math.min(...eventDates));
          const latestEvent = new Date(Math.max(...eventDates));
          
          logger.debug('Event date range:', {
            earliest: earliestEvent.toLocaleDateString(),
            latest: latestEvent.toLocaleDateString(),
            currentViewStart: dateRange.start.toLocaleDateString(),
            currentViewEnd: dateRange.end.toLocaleDateString()
          });
          
          // Navigate to the earliest event
          let newStart;
          if (viewType === 'week') {
            newStart = snapToStartOfWeek(earliestEvent);
          } else if (viewType === 'month') {
            newStart = new Date(earliestEvent.getFullYear(), earliestEvent.getMonth(), 1);
          } else {
            newStart = new Date(earliestEvent);
          }
          
          const newEnd = calculateEndDate(newStart, viewType);
          setDateRange({ start: newStart, end: newEnd });
          
          // alert(`Successfully loaded ${transformedEvents.length} events. Calendar navigated to show events starting from ${earliestEvent.toLocaleDateString()}`);
        } else {
          setAllEvents(events);
          // alert(`Successfully loaded ${transformedEvents.length} events for demo mode`);
        }
        
      } catch (error) {
        logger.error('Error uploading demo data:', error);
        showError(error, { context: 'Calendar.handleDemoDataUpload', userMessage: 'Error loading demo data' });
      } finally {
        setIsUploadingDemo(false);
        event.target.value = '';
      }
    };
    
    /**
     * TBD
     * */
    const handleModeToggle = async () => {
      if (isDemoMode) {
        // Switching from demo to API mode
        const confirmSwitch = window.confirm('Switch to API mode? This will clear your demo data.');
        if (confirmSwitch) {
          calendarDataService.setApiMode();
          setIsDemoMode(false);
          setDemoData(null);
          
          // Reload events from API
          await loadEvents();
        }
      } else {
        // Switching from API to demo mode - need to upload data first
        showWarning('Please upload JSON data to enable demo mode');
      }
    };
    
    /*
    * TBD
    */
    const renderModeToggle = () => {
      const demoStats = calendarDataService.getDemoDataStats();
      
      return (
        <div className="mode-toggle-container" style={{
          padding: '12px 16px',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px', flexWrap: 'wrap' }}>
            {/* Left side - Mode controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                
                <button
                  onClick={handleModeToggle}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: isDemoMode ? '#28a745' : '#0078d4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  {isDemoMode ? '📊 Demo Mode' : '🌐 API Mode'}
                </button>
              </div>
              
              {!isDemoMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label htmlFor="demo-upload" style={{
                    padding: '6px 14px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}>
                    📁 Upload Demo Data
                  </label>
                  <input
                    id="demo-upload"
                    type="file"
                    accept=".json"
                    onChange={handleDemoDataUpload}
                    disabled={isUploadingDemo}
                    style={{ display: 'none' }}
                  />
                  {isUploadingDemo && <span>Uploading...</span>}
                </div>
              )}
              
              {isDemoMode && demoStats && (
                <div style={{ fontSize: '0.9rem', color: '#6c757d' }}>
                  📊 {demoStats.totalEvents} events loaded
                  {demoStats.year && ` | 📅 ${demoStats.year}`}
                  {demoStats.dateRange?.start && demoStats.dateRange?.end && (
                    ` | 📅 ${new Date(demoStats.dateRange.start).toLocaleDateString()} - ${new Date(demoStats.dateRange.end).toLocaleDateString()}`
                  )}
                </div>
              )}
            </div>

            {/* Right side - Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Cache Control Buttons (only show when API token is available) */}
              <button
                className="search-button"
                onClick={() => setShowSearch(true)}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: '#0078d4',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                🔍 Search & Export
              </button>
              <ExportToPdfButton 
                events={filteredEvents} 
                dateRange={dateRange} 
              />
            </div>
          </div>
        </div>
      );
    };

            
      /**
       * Check if an event has no location assigned
       * Checks if the locations array (ObjectIds) is empty AND locationDisplayNames is empty
       */
      const isUnspecifiedLocation = useCallback((event) => {
        // Offsite events are NOT unspecified - they have their own group
        if (event.isOffsite) return false;
        // Has locations array with items = not unspecified
        if (event.locations && Array.isArray(event.locations) && event.locations.length > 0) return false;
        // Has locationDisplayNames (raw location name from Graph API) = not unspecified
        if (event.locationDisplayNames && event.locationDisplayNames.trim()) return false;
        // Also check graphData.location.displayName as fallback
        if (event.graphData?.location?.displayName && event.graphData.location.displayName.trim()) return false;
        // No location data found = unspecified
        return true;
      }, []);

      /** 
       * Helper function to detect if a location is a virtual meeting
       * @param {string} location - The location string to check
       * @returns {boolean} True if the location appears to be virtual
       */
      const isVirtualLocation = useCallback((location) => {
        if (!location || typeof location !== 'string') return false;
        
        const lowerLocation = location.toLowerCase().trim();
        
        // Check for common virtual meeting patterns
        const virtualPatterns = [
          // Zoom patterns
          /zoom\.us/i,
          /zoom\.com/i,
          /zoommtg:/i,
          /zoom meeting/i,
          
          // Teams patterns
          /teams\.microsoft\.com/i,
          /teams\.live\.com/i,
          /microsoft teams/i,
          
          // Google Meet patterns
          /meet\.google\.com/i,
          /hangouts\.google\.com/i,
          /google meet/i,
          
          // WebEx patterns
          /webex\.com/i,
          /cisco\.webex\.com/i,
          
          // GoToMeeting patterns
          /gotomeeting\.com/i,
          /gotomeet\.me/i,
          
          // Generic virtual meeting indicators
          /^https?:\/\//i, // Any URL starting with http/https
          /meeting.*id/i,
          /join.*meeting/i,
          /conference.*call/i,
          /dial.*in/i,
          /phone.*conference/i,
        ];
        
        // Check for explicit virtual keywords
        const virtualKeywords = [
          'virtual',
          'online',
          'remote',
          'video call',
          'video conference',
          'web conference',
          'microsoft teams meeting',
          'zoom meeting',
          'google meet',
          'webex meeting',
          'skype meeting',
          'conference call',
          'dial-in',
          'phone conference',
          'teleconference',
          'video chat',
          'online meeting',
          'web meeting',
        ];
        
        // Check patterns first
        if (virtualPatterns.some(pattern => pattern.test(lowerLocation))) {
          return true;
        }
        
        // Check keywords
        if (virtualKeywords.some(keyword => lowerLocation.includes(keyword))) {
          return true;
        }
        
        return false;
      }, []);
      
      /**
       * TBD
       */
      const isEventVirtual = useCallback((event) => {
        const locationText = event.location?.displayName?.trim() || '';
        if (!locationText) return false;
        
        // Check all locations in the event (handle multiple locations separated by semicolons or commas)
        const eventLocations = locationText
          .split(/[;,]/)
          .map(loc => loc.trim())
          .filter(loc => loc.length > 0);
        
        // Return true if ANY location is virtual
        return eventLocations.some(location => isVirtualLocation(location));
      }, [isVirtualLocation]);

      /**
       * TBD
       */
      const hasPhysicalLocation = useCallback((event, targetLocation) => {
        const locationText = event.location?.displayName?.trim() || '';
        if (!locationText) return false;

        const eventLocations = locationText
          .split(/[;,]/)
          .map(loc => loc.trim())
          .filter(loc => loc.length > 0);

        return eventLocations.some(location =>
          location === targetLocation
        );
      }, []);

      /**
       * Helper to extract categories from event (checks both top-level and graphData)
       */
      const getEventCategories = useCallback((event) => {
        // Check top-level categories array first
        if (event.categories && Array.isArray(event.categories) && event.categories.length > 0) {
          return event.categories;
        }
        // Check graphData.categories (events from backend API)
        if (event.graphData?.categories && Array.isArray(event.graphData.categories) && event.graphData.categories.length > 0) {
          return event.graphData.categories;
        }
        // Check legacy singular category field
        if (event.category && event.category.trim() !== '' && event.category !== 'Uncategorized') {
          return [event.category];
        }
        return [];
      }, []);

      /**
       * TBD
       */
      const isUncategorizedEvent = useCallback((event) => {
        const categories = getEventCategories(event);
        return categories.length === 0;
      }, [getEventCategories]);
  
      /**
       * Standardize date for API operations, ensuring consistent time zone handling
       * @param {Date} date - Local date to standardize
       * @returns {string} ISO date string in UTC
       */
      const standardizeDate = useCallback((date) => {
        if (!date) return '';
        return date.toISOString();
      }, []);
  
      
      /**
       * TBD
       */
      const getMonthDayEventPosition = useCallback((event, day) => {
        try {
          // Special handling for all-day events
          // Check both the isAllDay flag and time patterns (consistent with EventForm detection)
          const isAllDayEvent = event.isAllDay || (
            event.start?.dateTime && event.end?.dateTime &&
            event.start.dateTime.includes('T00:00:00') && 
            (event.end.dateTime.includes('T00:00:00') || event.end.dateTime.includes('T23:59:59'))
          );
          
          if (isAllDayEvent) {
            // For all-day events, use the start date in the user's timezone
            const startUtcString = event.start.dateTime.endsWith('Z') ? 
              event.start.dateTime : `${event.start.dateTime}Z`;
            const startDateUTC = new Date(startUtcString);
            
            if (isNaN(startDateUTC.getTime())) {
              logger.error('Invalid all-day event start date:', event.start.dateTime, event);
              return false;
            }
            
            // Convert to user timezone and get the date
            const eventInUserTZ = new Date(startDateUTC.toLocaleString('en-US', {
              timeZone: userTimezone
            }));
            
            // Reset to midnight for date comparison
            const eventDay = new Date(eventInUserTZ);
            eventDay.setHours(0, 0, 0, 0);
            
            const compareDay = new Date(day);
            compareDay.setHours(0, 0, 0, 0);
            
            return eventDay.getTime() === compareDay.getTime();
          }
          
          // Regular timed events
          // Ensure proper UTC format
          const utcDateString = event.start.dateTime.endsWith('Z') ? 
            event.start.dateTime : `${event.start.dateTime}Z`;
          const eventDateUTC = new Date(utcDateString);
          
          if (isNaN(eventDateUTC.getTime())) {
            logger.error('Invalid event date:', event.start.dateTime, event);
            return false;
          }
          
          // Convert to user timezone for comparison
          const eventInUserTZ = new Date(eventDateUTC.toLocaleString('en-US', {
            timeZone: userTimezone
          }));
          
          // Reset to midnight for date comparison
          const eventDay = new Date(eventInUserTZ);
          eventDay.setHours(0, 0, 0, 0);
          
          const compareDay = new Date(day);
          compareDay.setHours(0, 0, 0, 0);
          
          return eventDay.getTime() === compareDay.getTime();
        } catch (err) {
          logger.error('Error comparing event date in month view:', err, event);
          return false;
        }
      }, [userTimezone]);
  
      /**
       * Check if an event occurs on a specific day
       * @param {Object} event - The event object
       * @param {Date} day - The day to check
       * @returns {boolean} True if the event occurs on the day
       */
      const getEventPosition = useCallback((event, day) => {
        try {
          // Use event.start.dateTime - the canonical date field
          if (event.start?.dateTime) {
            const eventDateStr = event.start.dateTime.split('T')[0];
            const compareDay = new Date(day);
            const compareDateStr = compareDay.toISOString().split('T')[0];
            return eventDateStr === compareDateStr;
          }

          logger.error('Event missing start.dateTime:', event);
          return false;
        } catch (err) {
          logger.error('Error comparing event date:', err, event);
          return false;
        }
      }, []);

      
    //---------------------------------------------------------------------------
    // DATA FUNCTIONS
    //---------------------------------------------------------------------------
    const updateUserProfilePreferences = async (updates) => {
      // No User Updates if in Demo Mode
      if (isDemoMode) {
        return false;
      }

      // No User Updates if no API Token
      if (!apiToken) {
        logger.warn("No API token available for updating preferences");
        return false;
      }

      try {
        
        const response = await fetch(`${API_BASE_URL}/users/current/preferences`, {
          method: 'PATCH',  // Or whatever method your API expects
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });
        
        if (!response.ok) {
          logger.error("Failed to update user preferences:", response.status);
          return false;
        }
        
        // Also update local state to match
        setUserPermissions(prev => ({
          ...prev,
          ...updates
        }));
        
        return true;
      } catch (error) {
        logger.error("Error updating user preferences:", error);
        return false;
      }
    };

    /**
     * Load current user information from API
     */
    const loadCurrentUser = useCallback(async () => {
      if (!apiToken) {
        return;
      }

      try {
        
        const response = await fetch(`${API_BASE_URL}/users/current`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          logger.error("Failed to load current user:", response.status);
          return;
        }
        
        const userData = await response.json();
        
        setCurrentUser({
          name: userData.name || userData.displayName,
          email: userData.email,
          id: userData.id || userData._id
        });
        
      } catch (error) {
        logger.error("Error loading current user:", error);
      }
    }, [apiToken]);

    /**
     * Load schema extensions available for this application
     */
    const loadSchemaExtensions = useCallback(async () => {
      try {
        // Get your app ID
        const schemaOwnerId = msalConfig.auth.clientId;
        
        // Filter for schema extensions owned by your app
        const response = await fetch(`https://graph.microsoft.com/v1.0/schemaExtensions?$filter=owner eq '${schemaOwnerId}'`, {
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
        
        if (!response.ok) {
          logger.error('Failed to load schema extensions');
          return [];
        }
        
        const data = await response.json();
        
        // Filter to extensions that target events
        const eventExtensions = data.value.filter(ext => 
          ext.status === 'Available' && 
          ext.targetTypes.includes('event')
        );
        
        // Store in state for use in UI
        setSchemaExtensions(eventExtensions);
        
        return eventExtensions;
      } catch (err) {
        logger.error('Error loading schema extensions:', err);
        return [];
      }
    }, [graphToken]);

    // NOTE: loadBaseCategories and loadOutlookCategories have been replaced by TanStack Query hooks
    // useBaseCategoriesQuery and useOutlookCategoriesQuery (see state declarations above)

    // Helper function to fetch allowed calendars configuration from backend
    const fetchAllowedCalendarsConfig = useCallback(async () => {
      if (!apiToken) return null;

      try {
        const response = await fetch(`${API_BASE_URL}/calendar-display-config`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });

        if (!response.ok) {
          logger.warn('Failed to fetch allowed calendars config, showing all calendars');
          return null;
        }

        return await response.json();
      } catch (error) {
        logger.error('Error fetching allowed calendars config:', error);
        return null;
      }
    }, [apiToken]);

    // Loads the current user's available calendars (both owned and shared)
    // Filters to only show admin-configured allowed calendars
    const loadAvailableCalendars = useCallback(async () => {
      if (!graphToken) return [];

      try {
        // Fetch all calendars from Graph API
        const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,owner,canEdit,isDefaultCalendar&$orderby=name', {
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch calendars');
        }

        const data = await response.json();
        let calendars = data.value.map(calendar => ({
          id: calendar.id,
          name: calendar.name,
          owner: calendar.owner,  // Keep full owner object for shared calendars
          canEdit: calendar.canEdit || false,
          isDefaultCalendar: calendar.isDefaultCalendar || false,
          // Determine if shared based on owner info
          isShared: calendar.owner && calendar.owner.address && !calendar.isDefaultCalendar || false
        }));

        // Fetch allowed calendars configuration from backend
        const allowedConfig = await fetchAllowedCalendarsConfig();

        if (allowedConfig && allowedConfig.allowedDisplayCalendars && allowedConfig.allowedDisplayCalendars.length > 0) {
          // Filter calendars to only include those in the allowed list
          const allowedEmails = allowedConfig.allowedDisplayCalendars.map(e => e.toLowerCase());

          calendars = calendars.filter(cal => {
            const ownerEmail = cal.owner?.address?.toLowerCase();
            return ownerEmail && allowedEmails.includes(ownerEmail);
          });

          // Check if user has access to any allowed calendars
          if (calendars.length === 0) {
            logger.warn('User does not have access to any allowed calendars');
            setCalendarAccessError('You do not have access to any configured calendars. Please contact your administrator.');
          } else {
            setCalendarAccessError(null);
          }
        } else {
          // No allowed calendars configured - clear any previous error
          setCalendarAccessError(null);
        }

        // Update parent state with calendars
        setAvailableCalendars(calendars);

        return calendars;
      } catch (error) {
        logger.error('Error fetching calendars:', error);
        return [];
      }
    }, [graphToken, apiToken, setAvailableCalendars, fetchAllowedCalendarsConfig]);

    /**
     * TBD
     */
    const loadDemoEvents = useCallback(async () => {
      if (!isDemoMode || !demoData) {
        logger.debug("Not in demo mode or no demo data available");
        return false;
      }
      
      setLoading(true);
      try {
        // Initialize the service with current settings
        calendarDataService.initialize(
          graphToken, 
          apiToken, 
          selectedCalendarId, 
          schemaExtensions
        );
        
        // Get events through the service (demo mode)
        const events = await calendarDataService.getEvents(dateRange);

        setAllEvents(events);
        return true;
        
      } catch (error) {
        logger.error('loadDemoEvents failed:', error);
        showNotification('Failed to load demo events: ' + error.message);
        return false;
      } finally {
        setLoading(false);
      }
    }, [isDemoMode, demoData, graphToken, apiToken, selectedCalendarId, schemaExtensions, dateRange]);


    /**
     * Load events using unified delta sync
     * @param {boolean} forceRefresh - Force full sync instead of delta
     * @param {Array} calendarsData - Optional calendar data to use instead of state
     */
    const loadEventsUnified = useCallback(async (forceRefresh = false, calendarsData = null) => {
      if (!graphToken || !apiToken) {
        logger.debug("loadEventsUnified: Missing tokens - returning false");
        return false;
      }

      setLoading(true);
      
      try {
        // Prepare parameters for sync
        const { start, end } = formatDateRangeForAPI(dateRange.start, dateRange.end);
        
        // Get calendar IDs to sync - include both user calendar and TempleRegistration
        const calendarIds = [];
        
        // Use passed calendar data or fallback to state
        const calendarsToUse = calendarsData || availableCalendars;
        
        // Resolve calendar IDs for sync
        if (selectedCalendarId) {
          calendarIds.push(selectedCalendarId);
          calendarDebug.logApiCall('loadEventsUnified', 'sync', { selectedCalendarId });
        } else {
          // If no specific calendar selected, find and use the actual primary calendar ID
          const primaryCalendar = calendarsToUse.find(cal => cal.isDefaultCalendar || cal.owner?.name === currentUser?.name);
          if (primaryCalendar) {
            calendarIds.push(primaryCalendar.id);
          } else if (calendarsToUse.length > 0) {
            // Fallback to first available calendar
            calendarIds.push(calendarsToUse[0].id);
          } else {
            logger.warn('loadEventsUnified: No available calendars found');
          }
        }

        // Final validation of calendar IDs
        if (calendarIds.length === 0) {
          logger.error('loadEventsUnified: No calendar IDs resolved', {
            selectedCalendarId,
            availableCalendarsCount: availableCalendars?.length || 0,
            hasCurrentUser: !!currentUser
          });
          throw new Error('No valid calendar IDs found for sync');
        }
        
        // Log which calendars we're actually syncing from
        const calendarDetails = calendarIds.map(id => {
          const calendar = calendarsToUse.find(c => c.id === id);
          return { id, name: calendar?.name || 'Unknown', isSelected: id === selectedCalendarId };
        });

        // Consolidated calendar load message
        const selectedCalendar = calendarsToUse.find(c => c.id === selectedCalendarId);
        const dateRangeStr = `${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}`;
        logger.debug(`Loading calendars: ${calendarDetails.map(c => c.name).join(', ')} | ${dateRangeStr}${forceRefresh ? ' | Force refresh' : ''}`);

        // Initialize unified event service
        unifiedEventService.setApiToken(apiToken);
        unifiedEventService.setGraphToken(graphToken);

        // Get calendarOwners (email addresses) for the selected calendars
        const calendarOwners = calendarIds
          .map(id => calendarsToUse.find(c => c.id === id)?.owner?.address)
          .filter(Boolean)
          .map(email => email.toLowerCase());

        // Perform regular events loading (replaces problematic delta sync)
        let loadResult;
        try {
          loadResult = await unifiedEventService.loadEvents({
            calendarOwners: calendarOwners,
            calendarIds: calendarIds, // Keep for Graph API
            startTime: start,
            endTime: end,
            forceRefresh: forceRefresh
          });
        } catch (backendError) {
          logger.error('Backend events load error:', backendError);
          throw backendError;
        }

        // Check if loadResult is valid
        if (!loadResult) {
          logger.error('Backend returned no results');
          throw new Error('Backend service returned null/undefined');
        }

        // DEBUG: Log what we received from backend
        console.log('🔍 DEBUG loadResult:', {
          hasEvents: !!loadResult.events,
          eventsLength: loadResult.events?.length,
          source: loadResult.source,
          count: loadResult.count,
          firstEvent: loadResult.events?.[0]?.subject
        });

        // Only update events if we got actual results
        // Don't clear existing events if regular load returns empty
        if (loadResult.events && loadResult.events.length > 0) {
          
          // Get selected calendar name for logging
          const selectedCalendar = availableCalendars.find(c => c.id === selectedCalendarId);
          const selectedCalendarName = selectedCalendar?.name || 'Unknown Calendar';
          
          // Backend now returns only events from the selected calendars
          // No need to filter on frontend anymore
          let eventsToDisplay = loadResult.events;

          // FILTER OUT GRAPH API OCCURRENCES: Remove occurrence records from Graph's /calendarView
          // We'll expand masters ourselves to have more control
          eventsToDisplay = eventsToDisplay.filter(event => {
            // Keep series masters (we'll expand them)
            if (event.graphData?.type === 'seriesMaster') return true;

            // Keep standalone events (no series master)
            if (!event.graphData?.seriesMasterId) return true;

            // Skip occurrences from Graph - we'll generate them from the master
            logger.debug(`Filtering out Graph API occurrence: ${event.graphData?.subject} (${event.eventId})`);
            return false;
          });

          // Track event count before expansion for accurate metrics
          const eventsBeforeExpansion = eventsToDisplay.length;
          const seriesMastersWithRecurrence = eventsToDisplay.filter(e =>
            e.graphData?.type === 'seriesMaster' && e.graphData?.recurrence
          );

          // EXPAND RECURRING SERIES: Convert series masters into individual occurrences
          // With memoization to avoid redundant calculations
          calendarDebug.startPhase('recurring_expansion');

          // Create cache key from date range and series master IDs
          const seriesMasters = eventsToDisplay.filter(e =>
            e.graphData?.type === 'seriesMaster' && e.graphData?.recurrence
          );
          const masterIds = seriesMasters.map(m => m.eventId).sort().join(',');
          const expandStart = start.split('T')[0];
          const expandEndDate = new Date(end);
          expandEndDate.setDate(expandEndDate.getDate() + 1);
          const expandEnd = expandEndDate.toISOString().split('T')[0];
          const cacheKey = `${expandStart}-${expandEnd}-${masterIds}`;

          // Check cache first
          let expandedOccurrences = [];
          const cachedExpansion = expansionCacheRef.current.get(cacheKey);

          if (cachedExpansion) {
            logger.debug(`Using cached recurring expansion (${cachedExpansion.length} occurrences)`);
            expandedOccurrences = cachedExpansion;
          } else {
            // Expand each series master
            for (const event of seriesMasters) {
              const recurrence = event.graphData.recurrence;
              if (!recurrence.pattern || !recurrence.range) {
                logger.warn('Series master has malformed recurrence data:', event.graphData?.subject);
                continue;
              }

              try {
                // Prepare master event in format expected by expandRecurringSeries
                const masterForExpansion = {
                  ...event.graphData,
                  eventId: event.graphData.id
                };

                // Expand the master into occurrences for the current view range
                const occurrences = expandRecurringSeries(
                  masterForExpansion,
                  expandStart,
                  expandEnd
                );

                // Convert each occurrence to our event format
                occurrences.forEach(occurrence => {
                  const occurrenceDate = occurrence.start.dateTime.split('T')[0];

                  expandedOccurrences.push({
                    ...event,
                    eventId: `${event.eventId}-occurrence-${occurrenceDate}`,
                    graphData: {
                      ...occurrence,
                      id: `${event.graphData.id}-occurrence-${occurrenceDate}`,
                      type: 'occurrence',
                      seriesMasterId: event.graphData.id
                    },
                    start: occurrence.start,
                    end: occurrence.end,
                    startDate: occurrenceDate,
                    startDateTime: occurrence.start.dateTime,
                    endDateTime: occurrence.end.dateTime,
                    endDate: occurrence.end.dateTime.split('T')[0],
                    endTime: occurrence.end.dateTime.split('T')[1]?.substring(0, 5),
                    startTime: occurrence.start.dateTime.split('T')[1]?.substring(0, 5),
                    isRecurringOccurrence: true,
                    masterEventId: event.eventId
                  });
                });
              } catch (error) {
                logger.error('Error expanding recurring series:', event.graphData?.subject, error);
              }
            }

            // Store in cache (with size limit)
            if (masterIds.length > 0) {
              expansionCacheRef.current.set(cacheKey, expandedOccurrences);

              // Limit cache size
              if (expansionCacheRef.current.size > MAX_EXPANSION_CACHE_SIZE) {
                const firstKey = expansionCacheRef.current.keys().next().value;
                expansionCacheRef.current.delete(firstKey);
              }

              logger.debug(`Cached recurring expansion: ${expandedOccurrences.length} occurrences`);
            }
          }

          // Combine: non-recurring events + expanded occurrences (skip series masters)
          const expandedEvents = eventsToDisplay
            .filter(e => e.graphData?.type !== 'seriesMaster')
            .concat(expandedOccurrences);

          eventsToDisplay = expandedEvents;
          calendarDebug.endPhase('recurring_expansion', { count: expandedOccurrences.length, cached: !!cachedExpansion });
          logger.debug(`Loaded ${eventsToDisplay.length} events (${eventsToDisplay.length - eventsBeforeExpansion} expanded from recurring)`);

          // Log the events we're setting
          calendarDebug.logEventsLoaded(selectedCalendarId, selectedCalendarName, eventsToDisplay);

          // DEBUG: Log event details before setting state
          console.log('🔍 DEBUG: Setting allEvents with', eventsToDisplay.length, 'events');
          console.log('🔍 DEBUG: First event sample:', eventsToDisplay[0] ? {
            subject: eventsToDisplay[0].subject,
            start: eventsToDisplay[0].start,
            categories: eventsToDisplay[0].categories,
            location: eventsToDisplay[0].location,
            locationDisplayNames: eventsToDisplay[0].locationDisplayNames
          } : 'No events');

          setAllEvents(eventsToDisplay);
          calendarDebug.logEventLoadingComplete(selectedCalendarId, eventsToDisplay.length, Date.now() - (window._calendarLoadStart || Date.now()));
          return true;
        } else if (loadResult.loadResults && loadResult.loadResults.errors && loadResult.loadResults.errors.length > 0) {
          // If there were errors, don't clear events - keep existing ones
          logger.warn('loadEventsUnified: Regular load had errors, keeping existing events', {
            errorCount: loadResult.loadResults.errors.length,
            errors: loadResult.loadResults.errors
          });
          return false;
        } else {
          // No events returned but no errors - this might be legitimate (empty calendar)
          // Clear events when 0 events returned, regardless of loading strategy
          if (loadResult.loadResults?.totalEvents === 0) {
            setAllEvents([]);
            logger.info(`Cleared events - selected calendar has 0 events (source: ${loadResult.source})`);
            return true;
          } else {
            logger.warn('loadEventsUnified: No events returned, keeping existing events');
            return false;
          }
        }
        
      } catch (error) {
        logger.error('loadEventsUnified failed:', error);
        return false;
      } finally {
        setLoading(false);
      }
    }, [graphToken, apiToken, selectedCalendarId, availableCalendars, dateRange, formatDateRangeForAPI]);

    /**
     * Load events from MongoDB (source of truth)
     * @param {boolean} forceRefresh - Force refresh from backend
     * @param {Array} calendarsData - Optional calendar data to use instead of state
     */
    const loadEvents = useCallback(async (forceRefresh = false, calendarsData = null) => {
      calendarDebug.logApiCall('loadEvents', 'start', { forceRefresh, isDemoMode });

      try {
        if (isDemoMode) {
          return await loadDemoEvents();
        }

        // Load events from MongoDB via unified service
        const result = await loadEventsUnified(forceRefresh, calendarsData);
        calendarDebug.logApiCall('loadEvents', 'complete', { method: 'unified' });
        return result;
      } catch (error) {
        calendarDebug.logError('loadEvents', error);
        throw error;
      }
    }, [isDemoMode, loadDemoEvents, loadEventsUnified]);

    // Listen for AI chat calendar refresh events
    useEffect(() => {
      const handleAIChatRefresh = () => {
        logger.debug('AI Chat triggered calendar refresh');
        loadEvents(true);
      };

      window.addEventListener('ai-chat-calendar-refresh', handleAIChatRefresh);
      return () => window.removeEventListener('ai-chat-calendar-refresh', handleAIChatRefresh);
    }, [loadEvents]);

    /**
     * Sync events to internal database 
     * @param {Date} startDate - Start date of the range to sync
     * @param {Date} endDate - End date of the range to sync
     * @returns {Promise<Object>} Success indicator and result  
     */
    const syncEventsToInternal = useCallback(async (startDate, endDate) => {
      if (!graphToken || !apiToken) {
        logger.error('Missing tokens for sync');
        return { success: false, error: 'Authentication required' };
      }
      
      try {
        // Fetch events from Graph for the date range
        const { start, end } = formatDateRangeForAPI(startDate, endDate);
        
        const calendarPath = selectedCalendarId ? 
          `/me/calendars/${selectedCalendarId}/events` : 
          '/me/events';
        
        let allEvents = [];
        let nextLink = `https://graph.microsoft.com/v1.0${calendarPath}?$top=100&$filter=start/dateTime ge '${start}' and start/dateTime le '${end}'`;
        
        while (nextLink) {
          const resp = await fetch(nextLink, {
            headers: { Authorization: `Bearer ${graphToken}` }
          });
          
          if (!resp.ok) {
            throw new Error('Failed to fetch events from Graph');
          }
          
          const data = await resp.json();
          allEvents = allEvents.concat(data.value || []);
          nextLink = data['@odata.nextLink'] || null;
        }
        
        // Sync to internal database
        const syncResult = await eventDataService.syncEvents(allEvents, selectedCalendarId);

        // Reload events to show updated data
        await loadEvents(true);

        return { success: true, result: syncResult };
      } catch (error) {
        logger.error('Sync failed:', error);
        return { success: false, error: error.message };
      }
    }, [graphToken, apiToken, selectedCalendarId, loadEvents]);


    /**
     * Manual sync of loaded events to database
     * Creates enriched templeEvents__Events records for currently loaded events
     */
    const handleManualSync = useCallback(async () => {
      if (!allEvents || allEvents.length === 0) {
        showWarning('No events to sync. Please load events first.');
        return;
      }

      if (!apiToken) {
        showWarning('Authentication required for sync.');
        return;
      }

      setLoading(true);
      logger.debug('Starting manual sync of events to database', { eventCount: allEvents.length });

      try {
        logger.debug('Making manual sync request', {
          url: `${API_BASE_URL}/internal-events/sync`,
          eventCount: allEvents.length,
          hasApiToken: !!apiToken
        });

        // Call the manual sync endpoint
        const response = await fetch(`${API_BASE_URL}/internal-events/sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            events: allEvents,
            dateRange: {
              start: dateRange.start.toISOString(),
              end: dateRange.end.toISOString()
            }
          })
        });

        logger.debug('Manual sync response received', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('Manual sync HTTP error', {
            status: response.status,
            statusText: response.statusText,
            errorText
          });
          throw new Error(`Sync failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        logger.debug('Manual sync completed successfully', result);

        showSuccess(`Successfully synced ${result.enrichedCount || result.totalProcessed || allEvents.length} events to database. Created: ${result.createdCount}, Updated: ${result.updatedCount}`);

      } catch (error) {
        logger.error('Manual sync failed:', error);
        showError(error, { context: 'Calendar.handleManualSync', userMessage: 'Sync failed' });
      } finally {
        setLoading(false);
      }
    }, [allEvents, apiToken, dateRange, API_BASE_URL]);

    /**
     * Load user profile and permissions
     * @returns {Promise<boolean>} Success indicator
     */
    const loadUserProfile = useCallback(async () => {
      if (!apiToken) {
        logger.debug("No API token available");
        return false;
      }
      
      try {
        logger.debug("API token length:", apiToken.length);
        logger.debug("Fetching user profile for calendar permissions from:", `${API_BASE_URL}/users/current`);
        
        const response = await fetch(`${API_BASE_URL}/users/current`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });
        
        logger.debug("User profile response status:", response.status);
        
        if (response.status === 404) {
          logger.debug("User profile not found - permissions will use defaults");
          return false;
        }
        
        if (response.status === 401) {
          logger.debug("Unauthorized - authentication issue with API token");
          // TEMPORARY: Don't reset permissions for testing
          logger.debug("401 error but keeping test permissions");
          /*
          setUserPermissions({
            startOfWeek: 'Monday',
            defaultView: 'week',
            defaultGroupBy: 'categories',
            preferredZoomLevel: 100,
            preferredTimeZone: 'America/New_York',
            createEvents: false, 
            editEvents: false,  
            deleteEvents: false, 
            isAdmin: false
          });
          */
          return true;
        }
        
        if (response.ok) {
          const data = await response.json();
          logger.debug("Full user profile data from API:", data);
          setUserProfile(data);
          
          // Based on UserAdmin component, permissions are stored in preferences
          const hasCreatePermission = data.preferences?.createEvents ?? true;  // Default to true if not set
          const hasEditPermission = data.preferences?.editEvents ?? true;      // Default to true if not set
          const hasDeletePermission = data.preferences?.deleteEvents ?? false; // Default to false if not set
          const isAdmin = data.preferences?.isAdmin ?? false;                  // Default to false if not set
          
          const permissions = {
            startOfWeek: data.preferences?.startOfWeek || 'Monday',
            defaultView: data.preferences?.defaultView || 'week',
            defaultGroupBy: data.preferences?.defaultGroupBy || 'categories',
            preferredZoomLevel: data.preferences?.preferredZoomLevel || 100,
            preferredTimeZone: data.preferences?.preferredTimeZone || 'America/New_York',
            createEvents: hasCreatePermission,
            editEvents: hasEditPermission,
            deleteEvents: hasDeletePermission,  
            isAdmin: isAdmin,
          };
          
          // TEMPORARY: Don't overwrite test permissions
          // setUserPermissions(permissions);
          if (data.preferences?.preferredTimeZone) {
            setUserTimezone(data.preferences.preferredTimeZone);
          }
          return true;
        }
        return false;
      } catch (error) {
        logger.error("Error fetching user permissions:", error);
        // TEMPORARY: Don't reset permissions for testing
        // Error loading profile but keeping test permissions
        /*
        setUserPermissions({
          startOfWeek: 'Monday',
          defaultView: 'week',
          defaultGroupBy: 'categories',
          preferredZoomLevel: 100,
          preferredTimeZone: 'America/New_York',
          createEvents: false,
          editEvents: false,
          deleteEvents: false,
          isAdmin: false
        });
        */
        return true;
      }
    }, [apiToken, API_BASE_URL]);  

    // Add this function to your component to coordinate the loading sequence
    const initializeApp = useCallback(async () => {
      // Initialize app called

      // Check if initialization has already started
      if (initializationStarted.current) {
        logger.debug("Initialization already in progress, skipping");
        return;
      }

      // Mark initialization as started immediately
      initializationStarted.current = true;

      if (!graphToken || !apiToken) {
        logger.error("Cannot initialize: Missing authentication tokens");
        return;
      }

      // Add timeout protection (30 seconds)
      const timeoutId = setTimeout(() => {
        logger.error("Initialization timeout - forcing completion of loading states");
        setLoadingState({
          user: false,
          categories: false,
          extensions: false,
          events: false
        });
        setInitializing(false);
      }, 30000);

      logger.debug("Starting application initialization...");
      try {
        // Load user profile and permissions first
        const userLoaded = await loadUserProfile();
        setLoadingState(prev => ({ ...prev, user: false }));
        
        if (!userLoaded) {
          logger.warn("Could not load user profile, continuing with defaults");
        }

        // Load current user information
        // Load current user information
        await loadCurrentUser();

        // Load available calendars
        // Load available calendars
        const calendars = await loadAvailableCalendars();
        setAvailableCalendars(calendars);
        
        // Check if the currently selected calendar still exists
        if (selectedCalendarId && !calendars.some(cal => cal.id === selectedCalendarId)) {
          calendarDebug.logError('Selected calendar no longer available', 
            new Error('Calendar removed or permissions changed'), 
            { selectedCalendarId, availableCalendarIds: calendars.map(c => c.id) }
          );
          setSelectedCalendarId(null);
        }
        
        // Set default calendar if none selected
        if (!selectedCalendarId && calendars.length > 0) {
          let defaultCalToSelect = null;

          // First, try to use the admin-configured default calendar from database
          const allowedConfig = await fetchAllowedCalendarsConfig();
          if (allowedConfig?.defaultCalendar) {
            defaultCalToSelect = calendars.find(cal =>
              cal.owner?.address?.toLowerCase() === allowedConfig.defaultCalendar.toLowerCase()
            );
          }

          // If admin default not found, fallback to APP_CONFIG default
          if (!defaultCalToSelect) {
            defaultCalToSelect = calendars.find(cal =>
              cal.owner?.address?.toLowerCase() === APP_CONFIG.DEFAULT_DISPLAY_CALENDAR.toLowerCase()
            );
          }

          // Fallback to Graph API default
          if (!defaultCalToSelect) {
            defaultCalToSelect = calendars.find(cal => cal.isDefaultCalendar);
          }

          // Final fallback to first calendar
          if (!defaultCalToSelect) {
            defaultCalToSelect = calendars[0];
          }

          if (defaultCalToSelect) {
            calendarDebug.logStateChange('selectedCalendarId', null, defaultCalToSelect.id);
            setSelectedCalendarId(defaultCalToSelect.id);
          }
        }
        
        // Categories are now loaded via TanStack Query hooks (useBaseCategoriesQuery, useOutlookCategoriesQuery)
        // They are automatically cached and refreshed in the background
        // Mark categories as loaded immediately since TanStack Query handles the loading state
        setLoadingState(prev => ({ ...prev, categories: false }));

        // Step 3: Load schema extensions
        // Load schema extensions
        await loadSchemaExtensions();
        setLoadingState(prev => ({ ...prev, extensions: false }));
        
        // Step 4: Finally load events (using cache-first approach)
        // Load calendar events - pass calendar data directly to avoid race condition
        await loadEvents(false, calendars);
        setLoadingState(prev => ({ ...prev, events: false }));

        logger.log("Application initialized successfully");
        setInitializing(false);

        // Clear timeout on successful completion
        clearTimeout(timeoutId);

      } catch (error) {
        logger.error("Error during initialization:", error);
        // Ensure we exit loading state even on error
        setLoadingState({
          user: false,
          categories: false,
          extensions: false,
          events: false
        });
        setInitializing(false);

        // Clear timeout on error
        clearTimeout(timeoutId);
      }
    }, [graphToken, apiToken, loadUserProfile, loadCurrentUser, loadSchemaExtensions, loadEvents]);

    //---------------------------------------------------------------------------
    // CACHE MANAGEMENT FUNCTIONS
    //---------------------------------------------------------------------------
    
    /**
     * Refresh events with cache control
     * @param {boolean} forceRefresh - Force refresh from Graph API
     */
    const refreshEvents = useCallback(async (forceRefresh = false) => {
      logger.debug('refreshEvents called', { forceRefresh });
      const startTime = Date.now();
      await loadEvents(forceRefresh);
      const duration = Date.now() - startTime;
      logger.debug(`Refresh complete in ${duration}ms - ${allEvents.length} events`);
    }, [loadEvents, allEvents]);

    //---------------------------------------------------------------------------
    // UTILITY/HELPER FUNCTIONS
    //---------------------------------------------------------------------------

    /**
     * Retry loading events after creation to ensure the new event appears
     * @param {string} eventId - The ID of the newly created event
     * @param {string} eventSubject - The subject of the newly created event for logging
     */
    const retryEventLoadAfterCreation = useCallback(async (eventId, eventSubject) => {
      // For updates (eventId already exists), just refresh once immediately
      if (eventId) {
        logger.debug(`Refreshing after update: ${eventSubject}`);
        try {
          await loadEvents(true); // Force refresh to show the updated event - this bypasses cache
          logger.debug(`Refresh complete for updated event: ${eventSubject}`);
        } catch (error) {
          logger.error(`Error refreshing after update:`, error);
          showNotification(`Event updated but refresh failed. Try manual refresh if needed.`, 'warning');
        }
        return;
      }

      // For new events (no eventId yet), use retry logic with delays
      // This handles propagation delays in Graph API for newly created events
      const maxRetries = 3;
      const baseDelay = 500; // Start with 500ms delay

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          logger.debug(`[retryEventLoadAfterCreation] Attempt ${attempt}/${maxRetries} for new event: ${eventSubject}`);

          // Wait before loading events (exponential backoff: 500ms, 1s, 2s)
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));

          // Reload events from the API
          await loadEvents(true); // Force refresh to ensure we get the latest data

          // For new events, we just assume success after loading
          // The stale closure issue prevented proper checking anyway
          logger.debug(`[retryEventLoadAfterCreation] Loaded events after ${attempt} attempt(s) for: ${eventSubject}`);
          return;

        } catch (error) {
          logger.error(`[retryEventLoadAfterCreation] Error in attempt ${attempt}:`, error);

          if (attempt === maxRetries) {
            logger.warn(`[retryEventLoadAfterCreation] Failed to load event after ${maxRetries} attempts. Event may appear after manual refresh.`);
            showNotification(`Event created but may take a moment to appear. Try refreshing if needed.`, 'warning');
          }
        }
      }
    }, [loadEvents, showNotification]); // Removed allEvents from dependencies to avoid stale closure

    /**
     * Get the target calendar name for event creation/editing
     * @returns {string} The name of the target calendar
     */
    const getTargetCalendarName = useCallback(() => {
      let targetCalendarId = selectedCalendarId;
      
      if (!targetCalendarId) {
        // Use same logic as handleSaveApiEvent to determine target calendar
        const writableCalendars = availableCalendars.filter(cal => 
          cal.canEdit !== false && 
          !cal.name?.toLowerCase().includes('birthday') &&
          !cal.name?.toLowerCase().includes('holiday') &&
          !cal.name?.toLowerCase().includes('vacation')
        );
        
        const preferredCalendar = writableCalendars.find(cal => 
          cal.name?.toLowerCase().includes('temple events') || 
          cal.name?.toLowerCase() === 'calendar'
        ) || writableCalendars[0];
        
        return preferredCalendar?.name || 'Unknown Calendar';
      } else {
        const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
        return selectedCalendar?.name || 'Unknown Calendar';
      }
    }, [selectedCalendarId, availableCalendars]);

    /**
     * Get categories from the database (base categories only)
     * @param {string} targetCalendarId - The ID of the target calendar (not used, kept for compatibility)
     * @returns {Array} Array of category names from the database
     */
    const getCalendarSpecificCategories = useCallback((targetCalendarId) => {
      // Return all base categories from database, sorted by displayOrder
      if (baseCategories && baseCategories.length > 0) {
        const categoryNames = baseCategories
          .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999))
          .map(cat => cat.name);

        // Always include 'Uncategorized' as first option if not present
        if (!categoryNames.includes('Uncategorized')) {
          categoryNames.unshift('Uncategorized');
        }

        return categoryNames;
      }

      // Fallback if base categories haven't loaded yet
      return ['Uncategorized'];
    }, [baseCategories]);

    /**
     * Get the target calendar ID for event creation/editing
     * @returns {string} The ID of the target calendar
     */
    const getTargetCalendarId = useCallback(() => {
      let targetCalendarId = selectedCalendarId;
      
      if (!targetCalendarId) {
        // Use same logic as handleSaveApiEvent to determine target calendar
        const writableCalendars = availableCalendars.filter(cal => 
          cal.canEdit !== false && 
          !cal.name?.toLowerCase().includes('birthday') &&
          !cal.name?.toLowerCase().includes('holiday') &&
          !cal.name?.toLowerCase().includes('vacation')
        );
        
        const preferredCalendar = writableCalendars.find(cal => 
          cal.name?.toLowerCase().includes('temple events') || 
          cal.name?.toLowerCase() === 'calendar'
        ) || writableCalendars[0];
        
        targetCalendarId = preferredCalendar?.id;
      }
      
      return targetCalendarId;
    }, [selectedCalendarId, availableCalendars]);

    const makeBatchBody = (eventId, coreBody, extPayload, calendarId) => {
      // Determine the base URL based on whether a calendar is selected
      const baseUrl = calendarId 
        ? `/me/calendars/${calendarId}/events` 
        : '/me/events';
      
      return {
        requests: [
          {
            id: '1', 
            method: eventId ? 'PATCH' : 'POST',
            url: eventId ? `${baseUrl}/${eventId}` : baseUrl,
            headers: { 'Content-Type': 'application/json' },
            body: coreBody
          },
          ...(
            Object.keys(extPayload).length && eventId
              ? [{ 
                  id: '2', 
                  method: 'PATCH', 
                  url: `${baseUrl}/${eventId}`, 
                  headers: { 'Content-Type': 'application/json' }, 
                  body: extPayload 
                }]
              : []
          )
        ]
      };
    };

    const patchEventBatch = async (eventId, coreBody, extPayload, calendarId, internalFields) => {
      const targetCalendarId = calendarId || selectedCalendarId;
      // Get calendar owner from the selected calendar
      const targetCalendar = availableCalendars.find(cal => cal.id === targetCalendarId);
      const calendarOwner = targetCalendar?.owner?.address?.toLowerCase() || null;

      // Prepare Graph API fields
      const graphFields = { ...coreBody };

      // Add schema extensions to Graph fields if provided
      if (extPayload && Object.keys(extPayload).length > 0) {
        graphFields.extensions = [];
        for (const [extId, extProps] of Object.entries(extPayload)) {
          if (Object.keys(extProps).length > 0) {
            graphFields.extensions.push({
              '@odata.type': `microsoft.graph.openTypeExtension`,
              extensionName: extId,
              ...extProps
            });
          }
        }
      }

      // Debug logging for unified audit request
      logger.debug('[patchEventBatch] Using unified audit endpoint:', {
        eventId,
        hasGraphFields: Object.keys(graphFields).length > 0,
        hasInternalFields: !!internalFields && Object.keys(internalFields).length > 0,
        targetCalendarId,
        graphFields,
        internalFields
      });

      // Ensure we have an API token for the unified audit endpoint
      if (!apiToken) {
        throw new Error('API token not available for unified audit update');
      }

      // Call unified audit update endpoint
      const response = await fetch(`${API_BASE_URL}/events/${eventId || 'new'}/audit-update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          graphFields: Object.keys(graphFields).length > 0 ? graphFields : null,
          internalFields: internalFields && Object.keys(internalFields).length > 0 ? internalFields : null,
          calendarId: targetCalendarId,
          calendarOwner: calendarOwner,
          graphToken: graphToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[patchEventBatch] Unified audit update failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Unified audit update failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      logger.debug('[patchEventBatch] Unified audit update successful:', {
        auditChanges: result.auditChanges,
        graphUpdated: result.graphUpdated,
        internalUpdated: result.internalUpdated,
        eventId: result.event?.id
      });

      // For new events, handle the case where we need to create the event first
      if (!eventId && !result.event?.id) {
        // Fall back to direct Graph API creation for new events
        logger.debug('[patchEventBatch] Creating new event via direct Graph API');

        const batchBody = makeBatchBody(null, coreBody, extPayload, targetCalendarId);
        const resp = await fetch('https://graph.microsoft.com/v1.0/$batch', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(batchBody)
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error?.message || `New event creation failed: ${resp.status}`);
        }

        const batchResponse = await resp.json();
        let createdEventData = null;

        if (batchResponse.responses && batchResponse.responses.length > 0) {
          const mainResponse = batchResponse.responses.find(r => r.id === '1');
          if (mainResponse && mainResponse.status >= 200 && mainResponse.status < 300) {
            createdEventData = mainResponse.body;
            logger.debug('[patchEventBatch] New event created:', createdEventData.id);

            // Now update with internal fields using the new event ID
            if (internalFields && Object.keys(internalFields).length > 0) {
              await fetch(`${API_BASE_URL}/events/${createdEventData.id}/audit-update`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  internalFields: internalFields,
                  calendarId: targetCalendarId,
                  calendarOwner: calendarOwner,
                  graphToken: graphToken
                })
              });
            }

            return createdEventData;
          }
        }

        throw new Error('Failed to create new event');
      }

      // Return the event data from the unified update
      return result.event || { id: eventId };
    };

    //---------------------------------------------------------------------------
    // DEPENDENT UTILITY FUNCTIONS - functions that depend on state or other functions
    //---------------------------------------------------------------------------
    /** 
     * Get dynamic locations from events and rooms, grouping virtual meetings
     */
    const getDynamicLocations = useCallback(() => {
      const locationsSet = new Set();

      // Add all locations from templeEvents__Locations collection (primary source)
      generalLocations.forEach(location => {
        if (location.name) {
          locationsSet.add(location.name);
        }
      });

      // Track if we need to add Unspecified, Virtual, or Offsite for events
      let hasEventsWithoutLocation = false;
      let hasOffsiteEvents = false;

      // Process events to find locations and check for special cases
      allEvents.forEach(event => {
        // First check if this is an offsite event
        if (event.isOffsite) {
          hasOffsiteEvents = true;
          return; // Offsite events go to "Offsite" group, not processed further
        }

        // Check if this event has a virtual meeting URL
        if (event.virtualMeetingUrl) {
          // This is a virtual meeting - use "Virtual Meeting" as the location
          const virtualLocation = generalLocations.find(loc =>
            loc.name && loc.name.toLowerCase() === 'virtual meeting'
          );
          if (virtualLocation) {
            locationsSet.add(virtualLocation.name);
          }
          return;
        }

        // Read from top-level locationDisplayNames (app field), with fallback to location.displayName for Graph events
        const locationText = event.locationDisplayNames?.trim() || event.location?.displayName?.trim() || '';

        if (!locationText) {
          // Empty or null location - we'll need Unspecified
          hasEventsWithoutLocation = true;
          return;
        }

        // Split multiple locations by semicolon or comma
        const eventLocations = locationText
          .split(/[;,]/)
          .map(loc => loc.trim())
          .filter(loc => loc.length > 0);

        if (eventLocations.length === 0) {
          // Empty location list - we'll need Unspecified
          hasEventsWithoutLocation = true;
          return;
        }

        // Add all locations from events
        eventLocations.forEach(location => {
          // Check if this location matches a general location name (case-insensitive)
          const matchingGeneral = generalLocations.find(loc =>
            loc.name && loc.name.toLowerCase() === location.toLowerCase()
          );

          if (matchingGeneral) {
            // Use the canonical name from the general locations database
            locationsSet.add(matchingGeneral.name);
          } else {
            // Location doesn't match any database location - will go to Unspecified
            hasEventsWithoutLocation = true;
          }
        });
      });

      // Add "Unspecified" if there are events without locations
      if (hasEventsWithoutLocation) {
        // Check if there's an "Unspecified" in the database
        const unspecifiedInDb = generalLocations.find(loc =>
          loc.name && loc.name.toLowerCase() === 'unspecified'
        );
        if (unspecifiedInDb) {
          locationsSet.add(unspecifiedInDb.name);
        } else {
          // Add "Unspecified" even if not in database
          locationsSet.add('Unspecified');
        }
      }

      // Add "Offsite" if there are offsite events
      if (hasOffsiteEvents) {
        locationsSet.add('Offsite');
      }

      // Convert to sorted array - alphabetical with Offsite and Unspecified last
      const locationsArray = Array.from(locationsSet).sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();

        // Sort with Unspecified last
        if (aLower === 'unspecified' && bLower !== 'unspecified') return 1;
        if (bLower === 'unspecified' && aLower !== 'unspecified') return -1;

        // Sort Offsite second to last (before Unspecified)
        if (aLower === 'offsite' && bLower !== 'offsite' && bLower !== 'unspecified') return 1;
        if (bLower === 'offsite' && aLower !== 'offsite' && aLower !== 'unspecified') return -1;

        return a.localeCompare(b);
      });

      // Return only database locations
      return locationsArray;
    }, [allEvents, generalLocations]);

    /**
     * Get categories: base categories from database + dynamic categories from events
     */
    const getDynamicCategories = useCallback(() => {
      const categoriesSet = new Set();

      // First, add all base categories from database
      if (baseCategories && baseCategories.length > 0) {
        baseCategories.forEach(cat => {
          if (cat.name && cat.name.trim() !== '') {
            categoriesSet.add(cat.name.trim());
          }
        });
      }

      // Then add dynamic categories from events
      allEvents.forEach(event => {
        // Get categories from event using same logic as getEventCategories helper
        const eventCategories = getEventCategories(event);

        if (eventCategories.length > 0) {
          eventCategories.forEach(cat => {
            if (cat && cat.trim() !== '') {
              categoriesSet.add(cat.trim());
            }
          });
        } else {
          // No category found, add 'Uncategorized'
          categoriesSet.add('Uncategorized');
        }
      });

      // Add fallback categories from Outlook when no base categories and no event categories
      if (categoriesSet.size === 0 || (categoriesSet.size === 1 && categoriesSet.has('Uncategorized'))) {
        // Use Outlook categories as fallback when no base categories and no events
        if (outlookCategories && outlookCategories.length > 0) {
          outlookCategories.forEach(cat => {
            if (cat.name && cat.name.trim() !== '') {
              categoriesSet.add(cat.name.trim());
            }
          });
          logger.debug('Added fallback categories from Outlook:', outlookCategories.length);
        }
      }

      // Convert to array and sort
      const categoriesArray = Array.from(categoriesSet).sort();

      // Categories extracted from events (or fallback categories if no events)

      // Add special options
      const finalCategories = [
        'Uncategorized',
        ...categoriesArray.filter(cat => cat !== 'Uncategorized')
      ];

      return finalCategories;
    }, [baseCategories, allEvents, outlookCategories, getEventCategories]);
    
    /**
     * TBD
     */
    const isKnownCategory = useCallback((categoryName) => {
      if (isUncategorizedEvent({ category: categoryName })) {
        return true; 
      }
      return outlookCategories.some(cat => cat.name === categoryName);
    }, [outlookCategories, isUncategorizedEvent]);

    /**
     * TBD
     */
    const getDynamicLocationColor = useCallback((locationName) => {
      // Simple hash function to generate color
      const hash = locationName.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      
      // Pre-defined colors for locations
      const colors = [
        '#4285F4', '#EA4335', '#FBBC05', '#34A853', '#8E24AA',
        '#FB8C00', '#00ACC1', '#039BE5', '#795548', '#607D8B',
        '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3'
      ];
      
      return colors[Math.abs(hash) % colors.length];
    }, []);

    /**
     * TBD
     */
    const getDynamicCategoryColor = useCallback((categoryName) => {
      // Simple hash function to generate color
      const hash = categoryName.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      
      // Pre-defined colors
      const colors = [
        '#FF6B6B', '#4ECDC4', '#556270', '#C7F464', '#FF8C94',
        '#9DE0AD', '#45ADA8', '#547980', '#594F4F', '#FE4365',
        '#83AF9B', '#FC9D9A', '#F18D9E', '#3A89C9', '#F9CDAD'
      ];
      
      return colors[Math.abs(hash) % colors.length];
    }, []); 

    /**
     * Get the color associated with a category from Outlook
     * @param {string} categoryName - The name of the category
     * @returns {string} The hex color code
     */
    const getCategoryColor = useCallback((categoryName) => {
      const category = outlookCategories.find(cat => cat.name === categoryName);
      
      if (category) {
        // Color mapping logic
        const colorMap = {
          'preset0': '#ff8c00',   // Orange
          'preset1': '#e51400',   // Red
          'preset2': '#60a917',   // Green
          'preset3': '#f472d0',   // Pink
          'preset4': '#00aba9',   // Teal
          'preset5': '#008a00',   // Dark Green
          'preset6': '#ba141a',   // Dark Red
          'preset7': '#fa6800',   // Dark Orange
          'preset8': '#1ba1e2',   // Blue
          'preset9': '#0050ef',   // Dark Blue
          'preset10': '#6a00ff',  // Purple
          'preset11': '#aa00ff',  // Dark Purple
          'preset12': '#825a2c',  // Brown
          'preset13': '#6d8764',  // Olive
          'preset14': '#647687',  // Steel
          'preset15': '#76608a',  // Mauve
        };
        return colorMap[category.color] || '#cccccc';
      } else if (isUncategorizedEvent({ category: categoryName })) {
        return '#cccccc'; // Default gray for uncategorized
      } else {
        return getDynamicCategoryColor(categoryName);
      }
    }, [outlookCategories, isUncategorizedEvent, getDynamicCategoryColor]);

    /**
     * Get the color associated with a location
     * @param {string} locationName - The name of the location
     * @returns {string} The hex color code
     */
    const getLocationColor = useCallback((locationName) => {
      // Map location names to specific colors
      const locationColorMap = {
        'TPL': '#4285F4', // Blue
        'CPL': '#EA4335', // Red
        'MUS': '#FBBC05', // Yellow
        'Nursery School': '#34A853', // Green
        '402': '#8E24AA', // Purple
        '602': '#FB8C00', // Orange
        'Virtual': '#00ACC1', // Cyan
        'Microsoft Teams Meeting': '#039BE5', // Light Blue
        'Offsite': '#FF7043', // Deep Orange - for offsite events
        'Unspecified': '#9E9E9E' // Gray
      };
      
      return locationColorMap[locationName] || getDynamicLocationColor(locationName);
      // return locationColorMap[locationName] || '#9E9E9E';
    }, [getDynamicLocationColor]);

    /**
     * TBD
     */
    const getEventContentStyle = useCallback((viewType) => {
      switch(viewType) {
        case 'day':
          return {
            fontSize: '14px',
            lineHeight: '1.4',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical'
          };
        // Other cases...
        default:
          return {};
      }
    }, []);

    /**
     * TBD
     */
    const renderEventContent = useCallback((event, viewType) => {
      const styles = getEventContentStyle(viewType);
      // Get source timezone from event data for correct time interpretation
      const sourceTimezone = event.start?.timeZone || event.graphData?.start?.timeZone;

      return (
        <>
          <div className="event-time" style={styles}>
            {formatEventTime(event.start.dateTime, userTimezone, event.subject, sourceTimezone)}
            {viewType !== 'month' && ` - ${formatEventTime(event.end.dateTime, userTimezone, event.subject, sourceTimezone)}`}
          </div>
          
          <div className="event-title" style={styles}>
            {event.subject}
          </div>
          
          {viewType !== 'month' && event.location?.displayName && (
            <div className="event-location" style={styles}>
              {event.location.displayName}
            </div>
          )}
          
          {viewType === 'day' && 
            Object.entries(event).filter(([key, value]) => 
              key !== 'id' && 
              key !== 'subject' && 
              key !== 'start' && 
              key !== 'end' && 
              key !== 'location' && 
              key !== 'category' &&
              key !== 'extensions' &&
              key !== 'calendarId' && 
              key !== 'organizer' && 
              key !== 'body' &&
              key !== 'isAllDay' &&
              value !== undefined &&
              value !== null &&
              value !== ''
            ).map(([key, value]) => (
              <div key={key} className="event-extension" style={styles}>
                <small>{key}: {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value.toString()}</small>
              </div>
            ))
          }
        </>
      );
    }, [getEventContentStyle, userTimezone]);

    //---------------------------------------------------------------------------
    // MEMOIZED VALUES - derived state
    //---------------------------------------------------------------------------
    /**
     * TBD
     */
    const getWeekdayHeaders = useCallback(() => {
      const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      if (userPermissions.startOfWeek === 'Sunday') {
        weekdays.unshift(weekdays.pop());
      }
      return weekdays;
    }, [userPermissions.startOfWeek]);

    /**
     * TBD
     */
    const getEventsForDay = useCallback((day) => {
      return allEvents.filter(event => {
        const eventDate = new Date(event.start.dateTime);
        return (
          eventDate.getFullYear() === day.getFullYear() &&
          eventDate.getMonth() === day.getMonth() &&
          eventDate.getDate() === day.getDate()
        );
      });
    }, [allEvents]);

    /**
     * TBD
     */
    const getMonthWeeks = useCallback(() => {
      const days = [];
      const year = dateRange.start.getFullYear();
      const month = dateRange.start.getMonth();
      
      // Get first day of month and last day of month
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      // Get days from previous month to fill first week
      const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
      
      // Adjust based on user preference for start of week
      const startOfWeekIndex = userPermissions.startOfWeek === 'Sunday' ? 0 : 1; // 0 for Sunday, 1 for Monday
      
      // Calculate how many days from previous month to include
      let prevMonthDays;
      if (startOfWeekIndex === 0) { // Sunday start
        prevMonthDays = firstDayOfWeek;
      } else { // Monday start
        prevMonthDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
      }
      
      for (let i = prevMonthDays; i > 0; i--) {
        const day = new Date(year, month, 1 - i);
        days.push({ date: day, isCurrentMonth: false });
      }
      
      // Add all days from current month (same as before)
      for (let i = 1; i <= lastDay.getDate(); i++) {
        const day = new Date(year, month, i);
        days.push({ date: day, isCurrentMonth: true });
      }
      
      // Add days from next month to complete the grid
      const totalDaysAdded = days.length;
      const nextMonthDays = Math.ceil(totalDaysAdded / 7) * 7 - totalDaysAdded;
      
      for (let i = 1; i <= nextMonthDays; i++) {
        const day = new Date(year, month + 1, i);
        days.push({ date: day, isCurrentMonth: false });
      }
      
      // Group days into weeks
      const weeks = [];
      for (let i = 0; i < days.length; i += 7) {
        weeks.push(days.slice(i, i + 7));
      }
      
      return weeks;
    }, [dateRange.start, userPermissions.startOfWeek]);

    /**
     * Get all days within the current date range for the calendar view
     * @returns {Array} Array of Date objects for each day in the range
     */
    const getDaysInRange = useCallback(() => {
      const days = [];
      const currentDate = new Date(dateRange.start);
      
      while (currentDate <= dateRange.end) {
        days.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return days;
    }, [dateRange.start, dateRange.end]);

    const dynamicLocations = useMemo(() => getDynamicLocations(), [getDynamicLocations, generalLocations.length]);
    const dynamicCategories = useMemo(() => getDynamicCategories(), [getDynamicCategories]);

    /**
     * Get location names from database (generalLocations) for simple arrays
     */
    const getDatabaseLocationNames = useCallback(() => {
      return generalLocations.map(location => location.name).filter(name => name);
    }, [generalLocations]);

    /**
     * Get filtered locations for MultiSelect components (EventForm)
     * Returns only locations from templeEvents__Locations database collection
     */
    const getFilteredLocationsForMultiSelect = useCallback(() => {
      return getDatabaseLocationNames();
    }, [getDatabaseLocationNames]);

    /**
     * Normalize location name for matching
     * Handles common abbreviations and variations
     */
    const normalizeLocationName = useCallback((locationName) => {
      if (!locationName) return '';

      let normalized = locationName.toLowerCase().trim();

      // Handle common abbreviations
      normalized = normalized
        .replace(/\bconf\.\s*/gi, 'conference ')
        .replace(/\bconference\b/gi, 'conf')
        .replace(/\brm\b\.?\s*/gi, 'room ')
        .replace(/\broom\s+(\d+)/gi, '$1')  // "Room 402" -> "402"
        .replace(/\bfloor\b/gi, 'fl')
        .replace(/\bfl\b\.?\s*/gi, 'floor ')
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .trim();

      return normalized;
    }, []);

    /**
     * Check if two location names match (case-insensitive, handles abbreviations)
     */
    const locationsMatch = useCallback((loc1, loc2) => {
      if (!loc1 || !loc2) return false;

      const norm1 = normalizeLocationName(loc1);
      const norm2 = normalizeLocationName(loc2);

      // Direct match
      if (norm1 === norm2) return true;

      // Check if one contains the other (for partial matches)
      if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

      return false;
    }, [normalizeLocationName]);

    /**
     * Filter and sort events based on selected categories and locations
     */
    const filteredEvents = useMemo(() => {
      const filtered = allEvents.filter(event => {

        // UNIFIED FILTERING FOR ALL VIEWS - Use same logic for month, week, and day
        let categoryMatch = true;
        let locationMatch = true;

        // CATEGORY FILTERING - Show all events if all categories are selected
        if (selectedCategories.length === 0) {
          // No categories selected = show NO events
          categoryMatch = false;
        } else if (selectedCategories.length === dynamicCategories.length) {
          // All categories selected = show ALL events regardless of category
          categoryMatch = true;
        } else {
          // Partial categories selected, check if event matches
          if (isUncategorizedEvent(event)) {
            categoryMatch = selectedCategories.includes('Uncategorized');
          } else {
            // Get event categories using helper (checks top-level and graphData)
            const eventCategories = getEventCategories(event);
            // Match if any of the event's categories are selected
            categoryMatch = eventCategories.some(cat => selectedCategories.includes(cat));
          }
        }

        // LOCATION FILTERING - Show all events if all locations are selected
        if (selectedLocations.length === 0) {
          // No locations selected = show NO events
          locationMatch = false;
        } else if (selectedLocations.length === dynamicLocations.length) {
          // All locations selected = show ALL events regardless of location
          locationMatch = true;
        } else {
          // Partial locations selected, check if event matches
          // Check for offsite events first
          if (event.isOffsite) {
            locationMatch = selectedLocations.includes('Offsite');
          }
          // Check for virtual meeting
          else if (event.virtualMeetingUrl) {
            // This is a virtual meeting - check if "Virtual Meeting" is selected
            locationMatch = selectedLocations.includes('Virtual Meeting');
          }
          // Handle unspecified locations
          else if (isUnspecifiedLocation(event)) {
            locationMatch = selectedLocations.includes('Unspecified');
          }
          // Handle all events with locations
          else {
            // Read from top-level locationDisplayNames (app field), with fallback to location.displayName for Graph events
            const locationText = event.locationDisplayNames?.trim() || event.location?.displayName?.trim() || '';
            const eventLocations = locationText
              .split(/[;,]/)
              .map(loc => loc.trim())
              .filter(loc => loc.length > 0);

            if (eventLocations.length === 0) {
              // Edge case: location parsing resulted in empty - treat as Unspecified
              locationMatch = selectedLocations.includes('Unspecified');
            } else {
              // Check if any event location matches selected locations (with abbreviation handling)
              locationMatch = eventLocations.some(location => {
                const matches = selectedLocations.some(selectedLoc =>
                  locationsMatch(location, selectedLoc)
                );
                return matches;
              });

              // If no match, check if location exists in database at all
              // Unknown locations should go to "Unspecified"
              if (!locationMatch) {
                const hasKnownLocation = eventLocations.some(loc =>
                  generalLocations.some(dbLoc =>
                    dbLoc.name && dbLoc.name.toLowerCase() === loc.toLowerCase()
                  )
                );
                if (!hasKnownLocation) {
                  // Event has unknown location - treat as Unspecified
                  locationMatch = selectedLocations.includes('Unspecified');
                }
              }
            }
          }
        }

        // Event must pass BOTH category AND location filters
        const finalResult = categoryMatch && locationMatch;
        return finalResult;
      });
      
      // Sort the filtered events by start time
      const sorted = [...filtered].sort((a, b) => {
        const aStartTime = new Date(a.start.dateTime);
        const bStartTime = new Date(b.start.dateTime);

        if (aStartTime.getTime() !== bStartTime.getTime()) {
          return aStartTime - bStartTime;
        }

        const aEndTime = new Date(a.end.dateTime);
        const bEndTime = new Date(b.end.dateTime);
        return aEndTime - bEndTime;
      });

      // Log filter summary
      console.log(`🔍 FILTER DEBUG: allEvents=${allEvents.length}, filtered=${sorted.length}, selectedCategories=${selectedCategories.length}/${dynamicCategories.length}, selectedLocations=${selectedLocations.length}/${dynamicLocations.length}`);

      if (allEvents.length > 0 && sorted.length !== allEvents.length) {
        logger.info(`\n🔍 FILTER SUMMARY`);
        logger.info(`   Total events: ${allEvents.length}`);
        logger.info(`   After filters: ${sorted.length}`);
        logger.info(`   Filtered out: ${allEvents.length - sorted.length}`);
        logger.info(`   Selected categories: ${selectedCategories.length}/${dynamicCategories.length}`);
        logger.info(`   Selected locations: ${selectedLocations.length}/${dynamicLocations.length}`);
      }

      return sorted;
    }, [
      allEvents,
      selectedCategories,
      selectedLocations,
      dynamicCategories,
      dynamicLocations,
      isUncategorizedEvent,
      isUnspecifiedLocation,
      locationsMatch
    ]);

    /**
     * Group events by location for location-based calendar views
     * Groups are keyed by location NAME (to match selectedLocations)
     * Events are matched to groups using their locationCodes (rsKey values)
     */
    const getLocationGroups = useCallback(() => {
      if (groupBy !== 'locations') return {};

      const groups = {};

      // Initialize groups for all selected locations using location NAME as key
      selectedLocations.forEach(locationName => {
        const locationObj = generalLocations.find(loc => loc.name === locationName);

        // Use location NAME as the key (matches selectedLocations format)
        groups[locationName] = {
          rsKey: locationObj?.locationCode || locationObj?.rsKey || '',
          locationId: locationObj?._id?.toString() || null,
          displayName: locationName,
          events: []
        };
      });

      // Group filtered events by matching their locationCodes to group rsKeys
      filteredEvents.forEach((event) => {
        // Check for virtual meeting first
        if (event.virtualMeetingUrl) {
          if (!groups['Virtual Meeting']) {
            const virtualLoc = generalLocations.find(l => l.name === 'Virtual Meeting');
            groups['Virtual Meeting'] = {
              rsKey: virtualLoc?.locationCode || virtualLoc?.rsKey || 'VIRTUAL',
              locationId: virtualLoc?._id?.toString() || null,
              displayName: 'Virtual Meeting',
              events: []
            };
          }
          groups['Virtual Meeting'].events.push(event);
        }
        // Events with locationCodes (rsKey array)
        else if (event.locationCodes && Array.isArray(event.locationCodes) && event.locationCodes.length > 0) {
          let addedToAnyGroup = false;

          event.locationCodes.forEach(code => {
            // Find group that has this rsKey
            const matchingGroupKey = Object.keys(groups).find(groupKey =>
              groups[groupKey].rsKey === code
            );

            if (matchingGroupKey) {
              groups[matchingGroupKey].events.push(event);
              addedToAnyGroup = true;
            }
          });

          // If event has codes but none matched selected groups, add to Unspecified
          if (!addedToAnyGroup) {
            if (!groups['Unspecified']) {
              groups['Unspecified'] = {
                rsKey: '',
                locationId: null,
                displayName: 'Unspecified',
                events: []
              };
            }
            groups['Unspecified'].events.push(event);
          }
        }
        // Events without locationCodes - try to match by locations ObjectIds
        else if (event.locations && Array.isArray(event.locations) && event.locations.length > 0) {
          let addedToAnyGroup = false;

          event.locations.forEach(locationId => {
            if (!locationId) return; // Skip null/undefined location IDs
            const locationIdStr = locationId.toString();
            // Find the location object to get its rsKey
            const matchingLoc = generalLocations.find(loc =>
              loc._id?.toString() === locationIdStr
            );
            if (matchingLoc?.locationCode || matchingLoc?.rsKey) {
              // Find the group that has this rsKey/locationCode
              const locCode = matchingLoc.locationCode || matchingLoc.rsKey;
              const matchingGroupKey = Object.keys(groups).find(groupKey =>
                groups[groupKey].rsKey === locCode
              );
              if (matchingGroupKey) {
                groups[matchingGroupKey].events.push(event);
                addedToAnyGroup = true;
              }
            }
          });

          if (!addedToAnyGroup) {
            if (!groups['Unspecified']) {
              groups['Unspecified'] = {
                rsKey: '',
                locationId: null,
                displayName: 'Unspecified',
                events: []
              };
            }
            groups['Unspecified'].events.push(event);
          }
        }
        // Events without any location info go to Unspecified group
        else {
          if (!groups['Unspecified']) {
            groups['Unspecified'] = {
              rsKey: '',
              locationId: null,
              displayName: 'Unspecified',
              events: []
            };
          }
          groups['Unspecified'].events.push(event);
        }
      });

      return groups;
    }, [groupBy, selectedLocations, filteredEvents, generalLocations]);
    

    /**
     * TBD
     */
    const getFilteredMonthEvents = useCallback((day) => {
      if (!selectedFilter) return [];
      
      // Use allEvents directly instead of filteredEvents
      return allEvents.filter(event => {
        // First filter by date
        if (!getMonthDayEventPosition(event, day)) return false;
        
        // Then apply all the same filters used in filteredEvents
        // Remove unused eventDate variable
        // const eventDate = new Date(event.start.dateTime);
        
        // Filter by category or location based on groupBy
        if (groupBy === 'categories') {
          if (isUncategorizedEvent(event)) {
            return selectedFilter === 'Uncategorized';
          }
          // Get event categories and check if selectedFilter matches any of them
          const eventCategories = getEventCategories(event);
          return eventCategories.includes(selectedFilter);
        } else {
          // For locations
          const eventLocations = event.location?.displayName 
            ? event.location.displayName.split('; ').map(loc => loc.trim())
            : [];
            
          if (selectedFilter === 'Unspecified') {
            return eventLocations.length === 0 || eventLocations.every(loc => loc === '');
          } else {
            return eventLocations.includes(selectedFilter);
          }
        }
      });
    }, [selectedFilter, allEvents, getMonthDayEventPosition, dateRange.start, dateRange.end, groupBy, isKnownCategory, isUncategorizedEvent]);

    /**
     * Create default categories in Outlook if none exist
     */
    const createDefaultCategories = async () => {
      try {
        const defaultCategories = [
        ];
        
        const createdCategories = [];
        
        for (const cat of defaultCategories) {
          const response = await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${graphToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(cat)
          });
          
          if (response.ok) {
            const data = await response.json();
            createdCategories.push({
              id: data.id,
              name: data.displayName,
              color: data.color
            });
          } else {
            logger.error(`Failed to create category ${cat.displayName}`);
          }
        }
        
        // Invalidate the Outlook categories cache to trigger a refetch
        queryClient.invalidateQueries({ queryKey: OUTLOOK_CATEGORIES_QUERY_KEY });
        return createdCategories;
      } catch (err) {
        logger.error('Error creating default categories:', err);
        return [];
      }
    };

    /**
     * Create a new category in Outlook
     * @param {string} categoryName - The name of the new category
     * @returns {Object|null} The created category or null if failed
     */
    const createOutlookCategory = useCallback(async (categoryName) => {
      try {
        // Define a list of possible colors to use
        const colors = [
          'preset0', 'preset1', 'preset2', 'preset3', 'preset4', 
          'preset5', 'preset6', 'preset7', 'preset8', 'preset9',
          'preset10', 'preset11', 'preset12', 'preset13', 'preset14', 'preset15'
        ];
        
        // Pick a random color
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        const response = await fetch('https://graph.microsoft.com/v1.0/me/outlook/masterCategories', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            displayName: categoryName,
            color: randomColor
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          logger.error(`Failed to create category ${categoryName}:`, errorData);
          return null;
        }
        
        const data = await response.json();
        logger.debug(`Created new Outlook category: ${categoryName}`, data);
        
        // Create the category object
        const newCategory = {
          id: data.id,
          name: data.displayName,
          color: data.color
        };

        // Invalidate the Outlook categories cache to trigger a refetch
        queryClient.invalidateQueries({ queryKey: OUTLOOK_CATEGORIES_QUERY_KEY });

        return newCategory;
      } catch (err) {
        logger.error(`Error creating category ${categoryName}:`, err);
        return null;
      }
    }, [graphToken]);
    
    //---------------------------------------------------------------------------
    // EVENT HANDLERS
    //---------------------------------------------------------------------------
    const handleDatePickerChange = useCallback((selectedDate) => {
      setCurrentDate(new Date(selectedDate));
    }, []);

    const handleEventSelect = (event, viewOnly = false) => {
      // Close the search panel
      setShowSearch(false);
      
      // Navigate to the event's date in the calendar
      const eventDate = new Date(event.start.dateTime);
      
      // Set calendar to day view centered on the event date
      setViewType('day');
      setDateRange({
        start: eventDate,
        end: calculateEndDate(eventDate, 'day')
      });
      
      // Only open the edit form if not viewOnly
      if (!viewOnly) {
        setCurrentEvent(event);
        setModalType('edit');
        setIsModalOpen(true);
      }
    };

    /**
     * Handle the month filter change
     */
    const handleCategoryFilterChange = useCallback((value) => {
      setSelectedCategoryFilter(value);
    }, []);

    /**
     * Handle location filter change in month view
     */
    const handleLocationFilterChange = useCallback((value) => {
      setSelectedLocationFilter(value);
    }, []);

    /**
     * Add this new handler for the month filter dropdown
     * 
     */
    const handleMonthFilterChange = useCallback((value) => {
      setSelectedFilter(value);
    },[]);

    /**
     * Handle calendar zoom in and zoom out
     * @param {string} direction - The new direction
     */
    // 
    const handleZoom = useCallback((direction) => {
      if (direction === 'in' && zoomLevel < 150) {
        setZoomLevel(zoomLevel + 10);
      } else if (direction === 'out' && zoomLevel > 70) {
        setZoomLevel(zoomLevel - 10);
      }
    },[zoomLevel]);

    /**
     * Open the Add, Edit, Delete, Save modal
     */
    const handleAddEvent = useCallback(() => {
      logger.debug('handleAddEvent called');
      logger.debug('Permissions:', userPermissions);

      // Block if user has no creation permissions at all (Viewer role)
      if (!effectivePermissions.createEvents && !effectivePermissions.submitReservation) {
        logger.debug('User has no creation permissions - blocking modal open');
        return;
      }

      const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);

      // Check if user can edit the selected calendar
      if (selectedCalendar && !selectedCalendar.isDefault && !selectedCalendar.canEdit) {
        showNotification("You don't have permission to create events in this calendar");
        return;
      }

      // Determine mode based on permissions
      // Users WITH createEvents permission: create events directly (mode='event')
      // Users WITHOUT createEvents permission: create reservation requests (mode='create')
      const mode = effectivePermissions.createEvents ? 'event' : 'create';

      // Debug logging for reservation mode determination
      logger.debug('handleAddEvent: Mode determination', {
        mode,
        isSimulating,
        effectivePermissions: {
          createEvents: effectivePermissions.createEvents,
          submitReservation: effectivePermissions.submitReservation
        }
      });

      // Create blank event template with current date/time
      const now = new Date();
      const startTime = new Date(now);
      startTime.setHours(9, 0, 0, 0); // Default to 9 AM

      const endTime = new Date(startTime);
      endTime.setHours(startTime.getHours() + 1); // 1 hour duration

      // Create reservation object structure (not event structure)
      // RoomReservationReview expects reservation fields like startDateTime, eventTitle, etc.
      const newReservation = {
        // Submitter Information
        requesterName: currentUser?.name || '',
        requesterEmail: currentUser?.email || '',
        department: '',
        phone: '',
        contactEmail: '',
        contactName: '',
        isOnBehalfOf: false,

        // Event Details
        eventTitle: '',
        eventDescription: '',
        startDateTime: standardizeDate(startTime),
        endDateTime: standardizeDate(endTime),
        isAllDayEvent: false,

        // Location & Setup
        requestedRooms: [],
        setupTime: '',
        teardownTime: '',
        doorOpenTime: '',
        doorCloseTime: '',
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        setupNotes: '',
        doorNotes: '',
        eventNotes: '',

        // Additional Details
        attendeeCount: '',
        specialRequirements: '',
        reviewNotes: '',

        // Calendar Info
        calendarId: selectedCalendarId,
        calendarName: selectedCalendar?.name,

        // Virtual Meeting
        virtualMeetingUrl: null,
        graphData: null
      };

      // Open ReviewModal with appropriate mode
      setEventReviewModal({
        isOpen: true,
        event: newReservation,
        mode: mode,
        hasChanges: false
      });

      logger.debug('EventReviewModal opened for adding new event', { mode });
    }, [availableCalendars, effectivePermissions.createEvents, effectivePermissions.submitReservation, selectedCalendarId, showNotification, standardizeDate, currentUser]);

    /**
     * Handle changing the calendar view type (day/week/month)
     * @param {string} newView - The new view type
     */
    const handleViewChange = useCallback((newView) => {
      setViewType(newView);
      // currentDate stays the same, dateRange will recalculate via useMemo
    }, []);

    /**
     * Handle viewing an event in the calendar
     * @param {Object} event - The event object
     * @param {string} targetViewType - The view type to switch to ('day', 'week', 'month')
     * @param {string} explicitCalendarId - Optional explicit calendar ID to switch to (overrides event.calendarId)
     */
    const handleViewInCalendar = (event, targetViewType = 'day', explicitCalendarId = null) => {
      logger.debug("View in calendar clicked", { event, targetViewType, explicitCalendarId });

      // Navigate to the event's date in the calendar
      const eventDate = new Date(event.start.dateTime);

      // Use explicit calendarId if provided, otherwise fall back to event.calendarId
      const targetCalendarId = explicitCalendarId || event.calendarId;

      // Switch to the target calendar if different from current
      if (targetCalendarId && targetCalendarId !== selectedCalendarId) {
        setSelectedCalendarId(targetCalendarId);
      }

      // Set calendar to specified view centered on the event date
      // dateRange is a useMemo that recalculates based on currentDate and viewType
      setViewType(targetViewType);
      setCurrentDate(eventDate);
    };

    /**
     * Navigate to today
     */
    const handleToday = useCallback(() => {
      setCurrentDate(new Date());
    }, []);

    /**
     * Navigate to the next time period
     */
    const handleNext = useCallback(() => {
      let newDate = new Date(currentDate);
      
      switch(viewType) {
        case 'day':
          newDate.setDate(newDate.getDate() + 1);
          break;
        case 'week':
          newDate.setDate(newDate.getDate() + 7);
          break;
        case 'month':
          newDate.setMonth(newDate.getMonth() + 1);
          break;
      }
      
      setCurrentDate(newDate);
    }, [viewType, currentDate]);

    /**
     * Navigate to the previous time period
     */
    const handlePrevious = useCallback(() => {
      let newDate = new Date(currentDate);
      
      switch(viewType) {
        case 'day':
          newDate.setDate(newDate.getDate() - 1);
          break;
        case 'week':
          newDate.setDate(newDate.getDate() - 7);
          break;
        case 'month':
          newDate.setMonth(newDate.getMonth() - 1);
          break;
      }
      
      setCurrentDate(newDate);
    }, [viewType, currentDate]);

    const handleDayCellClick = useCallback(async (day, category = null, location = null) => {
      // Block if user has no creation permissions at all (Viewer role)
      if (!effectivePermissions.createEvents && !effectivePermissions.submitReservation) {
        logger.debug('User has no creation permissions - blocking modal open');
        return;
      }

      // Determine mode based on permissions
      // Users WITH createEvents permission: create events directly (mode='event')
      // Users WITHOUT createEvents permission: create reservation requests (mode='create')
      const mode = effectivePermissions.createEvents ? 'event' : 'create';

      // Debug logging for reservation mode determination
      logger.debug('handleDayCellClick: Mode determination', {
        mode,
        isSimulating,
        effectivePermissions: {
          createEvents: effectivePermissions.createEvents,
          submitReservation: effectivePermissions.submitReservation
        }
      });

      // Get the date string without times - let user fill in times
      const dateString = day.toISOString().split('T')[0];

      // Set the category based on what view we're in
      let eventCategory = 'Uncategorized';
      let eventLocation = 'Unspecified';

      if (groupBy === 'categories' && category) {
        eventCategory = category;

        // Check if this category exists in Outlook categories
        if (category !== 'Uncategorized') {
          const categoryExists = outlookCategories.some(cat => cat.name === category);

          if (!categoryExists) {
            logger.debug(`Category ${category} doesn't exist in Outlook categories, creating it...`);
            await createOutlookCategory(category);
          }
        }
      } else if (groupBy === 'locations' && location && location !== 'Unspecified') {
        eventLocation = location;
      }

      // Create reservation object structure (not event structure)
      // RoomReservationReview expects reservation fields like startDateTime, eventTitle, etc.
      const newReservation = {
        // Submitter Information
        requesterName: currentUser?.name || '',
        requesterEmail: currentUser?.email || '',
        department: '',
        phone: '',
        contactEmail: '',
        contactName: '',
        isOnBehalfOf: false,

        // Event Details
        eventTitle: '',
        eventDescription: '',
        startDate: dateString,
        startTime: '',
        endDate: dateString,
        endTime: '',
        isAllDayEvent: false,

        // Location & Setup
        locations: (() => {
          // Convert location display name to ObjectId reference
          if (groupBy === 'locations' && eventLocation !== 'Unspecified') {
            const locationDoc = rooms.find(loc =>
              loc.name === eventLocation || loc.displayName === eventLocation
            );
            return locationDoc ? [locationDoc._id] : [];
          }
          return [];
        })(),
        setupTime: '',
        teardownTime: '',
        doorOpenTime: '',
        doorCloseTime: '',
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        setupNotes: '',
        doorNotes: '',
        eventNotes: '',

        // Additional Details
        attendeeCount: '',
        specialRequirements: '',
        reviewNotes: '',

        // Calendar Info
        calendarId: selectedCalendarId,
        calendarName: availableCalendars.find(cal => cal.id === selectedCalendarId)?.name,

        // Virtual Meeting
        virtualMeetingUrl: null,
        graphData: null
      };

      // Open ReviewModal with appropriate mode
      setEventReviewModal({
        isOpen: true,
        event: newReservation,
        mode: mode,
        hasChanges: false
      });

      logger.debug('EventReviewModal opened from day cell click', { mode, day });
    }, [effectivePermissions.createEvents, effectivePermissions.submitReservation, groupBy, selectedCalendarId, availableCalendars, outlookCategories, createOutlookCategory, standardizeDate, currentUser]);

    /**
     * Handle clicking on a location row to open timeline modal
     * @param {string} locationName - The name of the location
     * @param {Date|Array<Date>} dateOrDates - Single date for day view, array of dates for week view
     * @param {string} viewType - 'day' or 'week'
     * @param {string|null} locationId - Optional ObjectId of the location for precise matching
     */
    const handleLocationRowClick = useCallback((locationName, dateOrDates, viewType, locationId = null) => {
      // Filter events by location and date range
      let filteredModalEvents = [];
      let dateRangeArray = [];

      if (viewType === 'week' && Array.isArray(dateOrDates)) {
        // Week view: dateOrDates is array of Date objects
        const startDate = dateOrDates[0];
        const endDate = dateOrDates[dateOrDates.length - 1];

        // Format dates as YYYY-MM-DD
        const formatDate = (date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };

        dateRangeArray = [formatDate(startDate), formatDate(endDate)];

        // Filter events within date range and matching location
        filteredModalEvents = allEventsRef.current.filter(event => {
          const eventStart = new Date(event.start.dateTime);

          // Check date range
          const inDateRange = eventStart >= startDate &&
            eventStart <= new Date(endDate.getTime() + 24 * 60 * 60 * 1000);

          if (!inDateRange) return false;

          // Check location match using ObjectId if available
          if (locationId) {
            // Direct ObjectId matching
            return event.locations && Array.isArray(event.locations) &&
              event.locations.some(locId => locId.toString() === locationId);
          } else {
            // Fallback for special locations (Virtual Meeting, Unspecified)
            if (locationName === 'Virtual Meeting') {
              return !!event.virtualMeetingUrl;
            } else if (locationName === 'Unspecified') {
              return isUnspecifiedLocation(event);
            }
            return false;
          }
        });
      } else if (viewType === 'day') {
        // Day view: dateOrDates is a single Date object
        const currentDay = dateOrDates;
        const year = currentDay.getFullYear();
        const month = String(currentDay.getMonth() + 1).padStart(2, '0');
        const day = String(currentDay.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        dateRangeArray = [dateStr, dateStr]; // Same start and end for single day

        // Filter events for this specific day and location
        filteredModalEvents = allEventsRef.current.filter(event => {
          const eventStart = new Date(event.start.dateTime);
          const eventDateStr = `${eventStart.getFullYear()}-${String(eventStart.getMonth() + 1).padStart(2, '0')}-${String(eventStart.getDate()).padStart(2, '0')}`;

          // Check date match
          if (eventDateStr !== dateStr) return false;

          // Check location match using ObjectId if available
          if (locationId) {
            // Direct ObjectId matching
            return event.locations && Array.isArray(event.locations) &&
              event.locations.some(locId => locId.toString() === locationId);
          } else {
            // Fallback for special locations (Virtual Meeting, Unspecified)
            if (locationName === 'Virtual Meeting') {
              return !!event.virtualMeetingUrl;
            } else if (locationName === 'Unspecified') {
              return isUnspecifiedLocation(event);
            }
            return false;
          }
        });
      }

      logger.debug(`Found ${filteredModalEvents.length} events for location "${locationName}" (ID: ${locationId})`, filteredModalEvents);

      // Open the appropriate timeline modal
      setTimelineModal({
        isOpen: true,
        locationName,
        locationId, // Include locationId for future use
        dateRange: dateRangeArray,
        events: filteredModalEvents,
        viewType
      });
    }, [isUnspecifiedLocation]);

    /**
     * Check if an event is part of a recurring series
     * @param {Object} event - The event to check
     * @returns {boolean} - True if the event is recurring
     */
    const isRecurringEvent = useCallback((event) => {
      return !!(
        event.seriesMasterId ||
        event.graphData?.seriesMasterId ||
        event.graphData?.recurrence ||
        event.graphData?.type === 'seriesMaster'
      );
    }, []);

    /**
     * Handle clicking on an event to open the context menu
     * @param {Object} event - The event that was clicked
     * @param {Object} e - The click event
     */
    const handleEventClick = useCallback((event, e) => {
      e.stopPropagation();

      // Check if this is a recurring event
      if (isRecurringEvent(event)) {
        // Show scope selection dialog for recurring events
        setRecurringScopeDialog({
          isOpen: true,
          pendingEvent: event
        });
      } else {
        // Non-recurring: open review modal directly
        (async () => {
          try {
            await reviewModal.openModal(event);
          } catch (error) {
            logger.error('Error opening review modal:', error);
            showError(error, { context: 'Calendar.handleEventClick', userMessage: 'Failed to open review modal' });
          }
        })();
      }
    }, [reviewModal, isRecurringEvent, showError]);

    /**
     * Handle scope selection from recurring scope dialog
     * @param {string} scope - 'thisEvent' or 'allEvents'
     */
    const handleRecurringScopeSelected = useCallback(async (scope) => {
      const event = recurringScopeDialog.pendingEvent;

      // Close the scope dialog
      setRecurringScopeDialog({ isOpen: false, pendingEvent: null });

      if (!event) return;

      try {
        // Open review modal with the selected scope
        await reviewModal.openModal(event, { editScope: scope });
      } catch (error) {
        logger.error('Error opening review modal:', error);
        showError(error, { context: 'Calendar.handleRecurringScopeSelected', userMessage: 'Failed to open review modal' });
      }
    }, [recurringScopeDialog.pendingEvent, reviewModal, showError]);

    /**
     * Handle closing the recurring scope dialog
     */
    const handleRecurringScopeClose = useCallback(() => {
      setRecurringScopeDialog({ isOpen: false, pendingEvent: null });
    }, []);

    /**
     * Handle review button click
     * Opens the review modal for the selected event
     */
    const handleReviewClick = useCallback(async (event) => {
      // Close the event form modal
      setIsModalOpen(false);

      // Use the event data we already have - no transformation needed
      try {
        // Events now have top-level fields from backend
        await reviewModal.openModal(event);
      } catch (error) {
        logger.error('Error opening review modal:', error);
        showError(error, { context: 'Calendar.handleReviewClick', userMessage: 'Failed to open review modal' });
      }
    }, [reviewModal, showError]);

    /**
     * TBD
     * @returns
     */
    const handleDeleteEvent = () => {
      const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
    
      if (!effectivePermissions.deleteEvents || (selectedCalendar && !selectedCalendar.isDefault && !selectedCalendar.canEdit)) {
        showNotification("You don't have permission to delete events in this calendar");
        return;
      }
      
      // Show modal confirmation
      setModalType('delete');
      setIsModalOpen(true);
    };

    /**
     * TBD
     */
    const handleSaveDemoEvent = async (data) => {
      const isNew = !data.id || data.id.includes('demo_event_') || data.id.includes('event_');
      
      try {
        // Initialize the service
        calendarDataService.initialize(
          graphToken, 
          apiToken, 
          selectedCalendarId, 
          schemaExtensions
        );
        
        // Save through the service (demo mode)
        if (isNew) {
          await calendarDataService.createEvent(data);
        } else {
          await calendarDataService.updateEvent(data);
        }
        
        // Reload demo events to show changes
        await loadDemoEvents();
        
        logger.debug(`[handleSaveDemoEvent] ${isNew ? 'Created' : 'Updated'} demo event:`, data.subject);
        return true;
        
      } catch (error) {
        logger.error('Demo save failed:', error);
        throw error;
      }
    };

    /**
     * Handle creation of registration events for TempleEvents
     * @param {Object} eventData - The event data that was just saved
     * @param {string} calendarId - The calendar ID where the event was saved
     */
    const handleRegistrationEventCreation = async (eventData, calendarId) => {
      try {
        logger.debug('handleRegistrationEventCreation called with:', {
          calendarId,
          availableCalendars: availableCalendars.map(c => ({ id: c.id, name: c.name })),
          eventData: { 
            id: eventData.id, 
            subject: eventData.subject,
            createRegistrationEvent: eventData.createRegistrationEvent,
            setupMinutes: eventData.setupMinutes,
            teardownMinutes: eventData.teardownMinutes
          }
        });
        
        // Find the current calendar info
        const currentCalendar = availableCalendars.find(cal => cal.id === calendarId);
        if (!currentCalendar) {
          logger.debug('Calendar not found, skipping registration event creation');
          return;
        }

        // Check if this is a TempleEvents calendar (temporarily disabled for testing)
        const isTempleEventsCalendar = currentCalendar.name && 
          currentCalendar.name.toLowerCase().includes('templeevents');

        // TODO: Re-enable this check for production
        // if (!isTempleEventsCalendar) {
        //   logger.debug('Not a TempleEvents calendar, skipping registration event creation');
        //   return;
        // }
        
        logger.debug(`Creating registration event for calendar: ${currentCalendar.name} (TempleEvents: ${isTempleEventsCalendar})`);
        logger.debug('Event data for registration:', {
          createRegistrationEvent: eventData.createRegistrationEvent,
          setupMinutes: eventData.setupMinutes,
          teardownMinutes: eventData.teardownMinutes
        });

        // Check if registration event creation is enabled
        if (!eventData.createRegistrationEvent) {
          logger.debug('Registration event creation disabled, skipping');
          return;
        }

        // Check if setup/teardown times are specified
        const hasSetupTeardown = (eventData.setupMinutes && eventData.setupMinutes > 0) || 
                                (eventData.teardownMinutes && eventData.teardownMinutes > 0);

        if (!hasSetupTeardown) {
          logger.debug('No setup/teardown times specified, skipping registration event creation');
          return;
        }

        // Find Temple Event Registrations calendar (check various naming patterns)
        const registrationCalendar = availableCalendars.find(cal => 
          cal.name && (
            cal.name.toLowerCase().includes('templeregistrations') ||
            cal.name.toLowerCase().includes('temple event registrations') ||
            cal.name.toLowerCase().includes('temple registrations')
          )
        );

        if (!registrationCalendar) {
          logger.debug('Temple Registrations calendar not found, skipping registration event creation');
          logger.debug('Available calendars:', availableCalendars.map(c => c.name));
          return;
        }

        // Prepare main event data (this will be created or updated)
        const mainEventData = {
          subject: eventData.subject,
          start: eventData.start,
          end: eventData.end,
          location: eventData.location,
          categories: eventData.categories || [],
          body: eventData.body,
          isAllDay: eventData.isAllDay || false
        };

        // Calculate extended times
        const originalStart = new Date(eventData.start.dateTime);
        const originalEnd = new Date(eventData.end.dateTime);
        
        const setupMinutes = eventData.setupMinutes || 0;
        const teardownMinutes = eventData.teardownMinutes || 0;
        
        const registrationStart = new Date(originalStart.getTime() - (setupMinutes * 60 * 1000));
        const registrationEnd = new Date(originalEnd.getTime() + (teardownMinutes * 60 * 1000));

        // Create registration event data
        const registrationEventData = {
          subject: `[SETUP/TEARDOWN] ${eventData.subject}`,
          start: {
            dateTime: formatDateObjectForGraph(registrationStart),
            timeZone: eventData.start.timeZone || 'UTC'
          },
          end: {
            dateTime: formatDateObjectForGraph(registrationEnd),
            timeZone: eventData.end.timeZone || 'UTC'
          },
          location: eventData.location,
          categories: ['Security/Maintenance'],
          body: {
            content: `Setup and teardown time for: ${eventData.subject}\n\n` +
                    `Original event: ${originalStart.toLocaleString()} - ${originalEnd.toLocaleString()}\n` +
                    `Setup time: ${setupMinutes} minutes before\n` +
                    `Teardown time: ${teardownMinutes} minutes after\n\n` +
                    `${eventData.assignedTo ? `Assigned to: ${eventData.assignedTo}\n\n` : ''}` +
                    `${eventData.registrationNotes ? `Notes: ${eventData.registrationNotes}\n\n` : ''}` +
                    `This event is for security and maintenance staff to prepare and clean up the venue.`,
            contentType: 'text'
          },
          isAllDay: eventData.isAllDay || false
        };

        // Use new linked events creation for new events
        if (!eventData.id) {
          logger.debug('Creating new linked events with extended properties');
          
          const linkedEvents = await createLinkedEvents(
            graphToken,
            mainEventData,
            registrationEventData,
            calendarId,
            registrationCalendar.id
          );
          
          logger.debug('Successfully created linked events:', {
            mainEvent: linkedEvents.mainEvent.id,
            registrationEvent: linkedEvents.registrationEvent.id
          });
          
          // Update the eventData object with the new main event ID for subsequent processing
          eventData.id = linkedEvents.mainEvent.id;
          
          // Return the created event information for caching
          const result = {
            mainEventId: linkedEvents.mainEvent.id,
            registrationEventId: linkedEvents.registrationEvent.id,
            registrationCalendarId: registrationCalendar.id
          };
          
          // Store backup linking in internal data
          if (eventDataService.apiToken) {
            try {
              await eventDataService.updateInternalFields(linkedEvents.mainEvent.id, {
                registrationEventId: linkedEvents.registrationEvent.id,
                registrationCalendarId: registrationCalendar.id,
                setupMinutes: setupMinutes,
                teardownMinutes: teardownMinutes
              });
            } catch (error) {
              logger.error('Failed to store internal linking data:', error);
            }
          }
          
          // Return the result for caching
          return result;
        } else {
          // For existing events, check if a linked registration event already exists
          const existingLinkedEvent = await findLinkedEvent(graphToken, eventData.id, calendarId);
          
          if (existingLinkedEvent) {
            logger.debug('Updating existing linked registration event');
            
            // Update the linked event with new times
            await updateLinkedEvent(
              graphToken,
              eventData.id,
              mainEventData,
              calendarId,
              setupMinutes,
              teardownMinutes
            );
          } else {
            logger.debug('No existing linked event found, creating new registration event');
            
            // Fall back to old method for existing events without links
            const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${registrationCalendar.id}/events`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${graphToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(registrationEventData)
            });

            if (response.ok) {
              const createdEvent = await response.json();
              logger.debug('Successfully created registration event:', createdEvent.id);
              
              // Store linking in internal data
              if (eventDataService.apiToken) {
                try {
                  await eventDataService.updateInternalFields(eventData.id, {
                    registrationEventId: createdEvent.id,
                    registrationCalendarId: registrationCalendar.id,
                    setupMinutes: setupMinutes,
                    teardownMinutes: teardownMinutes
                  });
                } catch (error) {
                  logger.error('Failed to link registration event:', error);
                }
              }
            } else {
              const error = await response.json();
              logger.error('Failed to create registration event:', error);
            }
          }
        }
      } catch (error) {
        logger.error('Error in handleRegistrationEventCreation:', error);
        // Don't throw - registration event creation is supplementary
        return null;
      }
    };

    /**
     * TBD
     */
    const handleSaveApiEvent = async (data) => {
      try {
        // Transform recurrence to Graph API format if present
        const graphRecurrence = data.recurrence
          ? transformRecurrenceForGraphAPI(data.recurrence, data.start?.timeZone || 'Eastern Standard Time')
          : null;

        // Debug logging for recurrence transformation
        if (data.recurrence) {
          logger.debug('[handleSaveApiEvent] Recurrence transformation:', {
            'original': data.recurrence,
            'transformed': graphRecurrence,
            'timeZone': data.start?.timeZone || 'Eastern Standard Time'
          });
        }

        // Core payload
        const core = {
          subject: data.subject,
          start: data.start,
          end: data.end,
          location: data.location,
          locations: data.locations, // Array of separate location objects for Graph API
          categories: data.categories,
          isAllDay: data.isAllDay,
          body: data.body,
          // Include recurrence pattern if exists (in Graph API format)
          ...(graphRecurrence && { recurrence: graphRecurrence })
        };

        // Debug logging for category mapping
        logger.debug('[handleSaveApiEvent] Event data received:', {
          'data.category': data.category,
          'data.categories': data.categories,
          'core.categories': core.categories
        });
        
        // Extensions payload
        const ext = {};
        schemaExtensions.forEach(extDef => {
          const props = {};
          extDef.properties.forEach(p => {
            const v = data[extDef.id]?.[p.name];
            if (v !== undefined) props[p.name] = v;
          });
          if (Object.keys(props).length) ext[extDef.id] = props;
        });
        
        // Internal fields payload (for setup/teardown and other internal data)
        const internal = {
          locations: data.locationIds || [], // Room IDs for internal storage
          setupMinutes: data.setupMinutes || 0,
          teardownMinutes: data.teardownMinutes || 0,
          setupTime: data.setupTime || '',
          teardownTime: data.teardownTime || '',
          doorOpenTime: data.doorOpenTime || '',
          doorCloseTime: data.doorCloseTime || '',
          setupNotes: data.setupNotes || '',
          doorNotes: data.doorNotes || '',
          eventNotes: data.eventNotes || '',
          registrationNotes: data.registrationNotes || '',
          assignedTo: data.assignedTo || '',
          // Multi-day event series metadata
          eventSeriesId: data.eventSeriesId !== undefined ? data.eventSeriesId : null,
          seriesLength: data.seriesLength || null,
          seriesIndex: data.seriesIndex !== undefined ? data.seriesIndex : null,
          // Recurrence pattern (for internal tracking)
          recurrence: data.recurrence || null,
          // Offsite location fields
          isOffsite: data.isOffsite || false,
          offsiteName: data.offsiteName || '',
          offsiteAddress: data.offsiteAddress || '',
          offsiteLat: data.offsiteLat || null,
          offsiteLon: data.offsiteLon || null,
          // Services (internal use only)
          services: data.services || {}
        };

        // Use the selected calendar from the calendar toggle
        let targetCalendarId = selectedCalendarId;
        if (!targetCalendarId) {
          // If no calendar is selected, find the first writable calendar
          // Filter out read-only calendars like Birthdays, Holidays, etc.
          const writableCalendars = availableCalendars.filter(cal => 
            cal.canEdit !== false && 
            !cal.name?.toLowerCase().includes('birthday') &&
            !cal.name?.toLowerCase().includes('holiday') &&
            !cal.name?.toLowerCase().includes('vacation')
          );
          
          // Prefer Temple Events or main Calendar, otherwise use first writable calendar
          const preferredCalendar = writableCalendars.find(cal => 
            cal.name?.toLowerCase().includes('temple events') || 
            cal.name?.toLowerCase() === 'calendar'
          ) || writableCalendars[0];
          
          targetCalendarId = preferredCalendar?.id;
          logger.debug('[handleSaveApiEvent] No calendar selected, using first writable calendar:', preferredCalendar?.name);
        } else {
          const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
          logger.debug('[handleSaveApiEvent] Creating event in selected calendar:', selectedCalendar?.name);
          
          // Check if the selected calendar is read-only
          if (selectedCalendar && selectedCalendar.canEdit === false) {
            showNotification(`Cannot create events in read-only calendar: ${selectedCalendar.name}`, 'error');
            return false;
          }
        }
        
        // Final check to ensure we have a valid target calendar
        if (!targetCalendarId) {
          showNotification('No writable calendar available for event creation', 'error');
          return false;
        }
        
        // For new events with registration, use createLinkedEvents directly
        if (!data.id && data.createRegistrationEvent && (data.setupMinutes > 0 || data.teardownMinutes > 0)) {
          // Skip the regular batch creation and use linked events creation instead
          const registrationResult = await handleRegistrationEventCreation({
            ...data,
            createRegistrationEvent: data.createRegistrationEvent,
            setupMinutes: data.setupMinutes,
            teardownMinutes: data.teardownMinutes,
            registrationNotes: data.registrationNotes,
            assignedTo: data.assignedTo
          }, targetCalendarId);

          // Registration events are automatically stored in unified events collection
          // No manual caching needed
        } else {
          // For existing events or events without registration, use normal batch update
          const createdEvent = await patchEventBatch(data.id, core, ext, targetCalendarId, internal);
          
          // Update the data object with the actual created event ID if this was a new event
          if (createdEvent && createdEvent.id && !data.id) {
            data.id = createdEvent.id;
            logger.debug('Updated event data with new ID from Graph API:', data.id);
          }
          
          // For existing events that need registration event updates
          if (data.id && data.createRegistrationEvent) {
            const eventDataForRegistration = createdEvent || data;
            await handleRegistrationEventCreation({
              ...eventDataForRegistration,
              createRegistrationEvent: data.createRegistrationEvent,
              setupMinutes: data.setupMinutes,
              teardownMinutes: data.teardownMinutes,
              registrationNotes: data.registrationNotes,
              assignedTo: data.assignedTo
            }, targetCalendarId);
          }
        }

        // Event is now automatically stored in unified events collection via audit-update endpoint
        // No manual caching needed

        // Reload events with retry logic to ensure newly created event appears
        await retryEventLoadAfterCreation(data.id, data.subject);
        
        logger.debug(`[handleSaveApiEvent] ${data.id ? 'Updated' : 'Created'} API event:`, data.subject);
        return true;
        
      } catch (error) {
        logger.error('API save failed:', error);
        throw error;
      }
    };

    /**
     * Batch create multiple events efficiently using the batch API endpoint
     * @param {Array} eventsData - Array of event data objects (same format as handleSaveApiEvent)
     * @param {Function} onProgress - Optional callback for progress updates (current, total)
     * @returns {Object} { successCount, failCount, results }
     */
    const handleBatchCreateEvents = async (eventsData, onProgress = null) => {
      try {
        if (!eventsData || eventsData.length === 0) {
          return { successCount: 0, failCount: 0, results: [] };
        }

        logger.debug(`[handleBatchCreateEvents] Creating ${eventsData.length} events in batches of 5`);

        // Validate that tokens are available (they come from component props)
        if (!apiToken || !graphToken) {
          throw new Error('Authentication tokens not available');
        }

        // Get target calendar ID (same logic as handleSaveApiEvent)
        let targetCalendarId = selectedCalendarId;
        if (!targetCalendarId) {
          const writableCalendars = availableCalendars.filter(cal =>
            cal.canEdit !== false &&
            !cal.name?.toLowerCase().includes('birthday') &&
            !cal.name?.toLowerCase().includes('holiday') &&
            !cal.name?.toLowerCase().includes('vacation')
          );

          const preferredCalendar = writableCalendars.find(cal =>
            cal.name?.toLowerCase().includes('temple events') ||
            cal.name?.toLowerCase() === 'calendar'
          ) || writableCalendars[0];

          targetCalendarId = preferredCalendar?.id;
        }

        if (!targetCalendarId) {
          throw new Error('No writable calendar available for event creation');
        }

        // Split events into batches of 5
        const batchSize = 5;
        const batches = [];
        for (let i = 0; i < eventsData.length; i += batchSize) {
          batches.push(eventsData.slice(i, i + batchSize));
        }

        logger.debug(`[handleBatchCreateEvents] Split into ${batches.length} batches`);

        let allResults = [];
        let totalSuccessCount = 0;
        let totalFailCount = 0;

        // Process each batch
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];

          logger.debug(`[handleBatchCreateEvents] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} events`);

          // Format events for batch API
          const formattedEvents = batch.map(data => {
            // Prepare graph fields
            const graphFields = {
              subject: data.subject,
              start: data.start,
              end: data.end,
              location: data.location,
              locations: data.locations, // Array of separate location objects for Graph API
              categories: data.categories || [],
              isAllDay: data.isAllDay || false,
              body: data.body || { contentType: 'text', content: '' }
            };

            // Prepare internal fields
            const internalFields = {
              locations: data.locationIds || [], // Room IDs for internal storage
              setupMinutes: data.setupMinutes || 0,
              teardownMinutes: data.teardownMinutes || 0,
              setupTime: data.setupTime || '',
              teardownTime: data.teardownTime || '',
              doorOpenTime: data.doorOpenTime || '',
              doorCloseTime: data.doorCloseTime || '',
              setupNotes: data.setupNotes || '',
              doorNotes: data.doorNotes || '',
              eventNotes: data.eventNotes || '',
              registrationNotes: data.registrationNotes || '',
              assignedTo: data.assignedTo || '',
              eventSeriesId: data.eventSeriesId !== undefined ? data.eventSeriesId : null,
              seriesLength: data.seriesLength || null,
              seriesIndex: data.seriesIndex !== undefined ? data.seriesIndex : null,
              // Offsite location fields
              isOffsite: data.isOffsite || false,
              offsiteName: data.offsiteName || '',
              offsiteAddress: data.offsiteAddress || '',
              offsiteLat: data.offsiteLat || null,
              offsiteLon: data.offsiteLon || null
            };

            return {
              graphFields,
              internalFields,
              calendarId: targetCalendarId
            };
          });

          // Call batch API
          const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/batch`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'x-graph-token': graphToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ events: formattedEvents })
          });

          if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Batch ${batchIndex + 1} failed:`, errorText);
            // Mark all events in this batch as failed
            totalFailCount += batch.length;
            allResults.push(...batch.map((_, idx) => ({
              index: batchIndex * batchSize + idx,
              success: false,
              error: `Batch API call failed: ${response.status}`
            })));
            continue;
          }

          const result = await response.json();
          logger.debug(`Batch ${batchIndex + 1} result:`, result);

          totalSuccessCount += result.successCount || 0;
          totalFailCount += result.failCount || 0;
          allResults.push(...result.results);

          // Report progress
          if (onProgress) {
            const currentProgress = Math.min((batchIndex + 1) * batchSize, eventsData.length);
            onProgress(currentProgress, eventsData.length);
          }
        }

        logger.debug(`[handleBatchCreateEvents] Complete: ${totalSuccessCount} succeeded, ${totalFailCount} failed`);

        return {
          successCount: totalSuccessCount,
          failCount: totalFailCount,
          results: allResults
        };

      } catch (error) {
        logger.error('[handleBatchCreateEvents] Error:', error);
        throw error;
      }
    };

    /**
     * Called by EventForm or EventSearch when the user hits "Save"
     * @param {Object} data - The payload from EventForm.handleSubmit
     * @returns {boolean} Success indicator
     */
    const handleSaveEvent = async (data) => {
      const isNew = !data.id || data.id.includes('demo_event_') || data.id.includes('event_');

      // Permission checks
      if (isNew && !effectivePermissions.createEvents) {
        showWarning("You don't have permission to create events");
        return false;
      }
      if (!isNew && !effectivePermissions.editEvents) {
        showWarning("You don't have permission to edit events");
        return false;
      }

      // Set loading state
      setSavingEvent(true);

      try {
        // Dispatch to the appropriate handler based on mode
        if (isDemoMode) {
          await handleSaveDemoEvent(data);
        } else {
          await handleSaveApiEvent(data);
        }

        // Close modal if it's open (common to both modes)
        if (isModalOpen) {
          setIsModalOpen(false);
        }

        showNotification('Event saved successfully!', 'success');
        return true;

      } catch (error) {
        logger.error('Save failed:', error);
        showError(error, { context: 'Calendar.handleSaveEvent', userMessage: 'Save failed' });
        return false;
      } finally {
        // Clear loading state
        setSavingEvent(false);
      }
    };

    /**
     * Handle save from EventReviewModal
     * Routes to appropriate handler based on mode:
     * - mode='event': Direct calendar event creation
     * - mode='create': Reservation request submission
     *
     * Note: Receives parameter from ReviewModal but uses eventReviewModal.event state
     * which is updated via onDataChange callback in RoomReservationReview
     */
    const handleEventReviewModalSave = useCallback(async () => {
      const { mode: originalMode, event: reservationData } = eventReviewModal;

      console.log('Form data being saved:', reservationData);

      if (!reservationData) {
        logger.error('No event data available to save');
        return;
      }

      // Safety check: Override mode if user can only submit reservations (not create events)
      // This handles edge cases where mode was set incorrectly or permissions changed after modal opened
      const mode = !effectivePermissions.createEvents && effectivePermissions.submitReservation
        ? 'create'
        : originalMode;

      // Debug logging for mode verification
      if (mode !== originalMode) {
        logger.debug('handleEventReviewModalSave: Mode overridden based on current permissions', {
          originalMode,
          newMode: mode,
          createEvents: effectivePermissions.createEvents,
          submitReservation: effectivePermissions.submitReservation
        });
      }

      try {
        if (mode === 'event') {
          // Direct event creation - transform reservation structure to event structure

          // Validate required fields - date range is always required (even if ad hoc dates are added)
          const hasDateRange = reservationData.startDate && reservationData.endDate;
          const hasTimes = reservationData.startTime && reservationData.endTime;

          if (!hasDateRange || !hasTimes) {
            showNotification('Date range and times are required');
            return;
          }

          // Detect if editing existing event or creating new one
          const isEditingExistingEvent = !!(reservationData.eventId || reservationData.id);

          // Check for multi-day event creation - combines date range with ad hoc dates
          const hasAdHocDates = reservationData.adHocDates && reservationData.adHocDates.length > 0;
          const isMultiDayRange = reservationData.startDate !== reservationData.endDate;
          const isMultiDay = hasAdHocDates || isMultiDayRange;

          // Two-step save confirmation for SINGLE-DAY events only
          // (multi-day events already have their own confirmation via pendingMultiDayConfirmation)
          if (!isMultiDay && !pendingSaveConfirmation) {
            setPendingSaveConfirmation(true);
            return; // Exit early on first click - button text will change to show confirmation
          }

          // Reset single-day confirmation after second click (user confirmed)
          if (!isMultiDay && pendingSaveConfirmation) {
            setPendingSaveConfirmation(false);
          }

          if (isMultiDay) {

            // Generate list of dates based on whether this is new or existing event
            const allDates = new Set();

            if (isEditingExistingEvent) {
              // EDITING EXISTING EVENT: Only create events for NEW ad hoc dates
              // Don't regenerate the date range - those events already exist
              if (hasAdHocDates) {
                reservationData.adHocDates.forEach(dateStr => allDates.add(dateStr));
              }
            } else {
              // CREATING NEW EVENT: Combine range + ad hoc dates
              // Add dates from range
              const startDate = new Date(reservationData.startDate);
              const endDate = new Date(reservationData.endDate);
              const rangeDayCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
              for (let i = 0; i < rangeDayCount; i++) {
                const currentDate = new Date(startDate);
                currentDate.setDate(startDate.getDate() + i);
                const dateStr = currentDate.toISOString().split('T')[0];
                allDates.add(dateStr);
              }

              // Add ad hoc dates (if any)
              if (hasAdHocDates) {
                reservationData.adHocDates.forEach(dateStr => allDates.add(dateStr));
              }
            }

            const dayCount = allDates.size;

            // Two-step confirmation: First click shows confirmation, second click creates
            if (!pendingMultiDayConfirmation) {
              // First click: Set pending confirmation state and return
              setPendingMultiDayConfirmation({ eventCount: dayCount });
              return;
            }

            // Second click: User confirmed, proceed with creation
            setPendingMultiDayConfirmation(null); // Reset confirmation state
            setSavingEvent(true); // Show "Saving..." message

            // Generate unique series ID for linking events
            const eventSeriesId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            logger.debug(`Creating multi-day event series: ${dayCount} events`);

            // Convert Set to sorted array
            const dates = Array.from(allDates).sort();

            // Transform locations array to Graph API location format (once for all events)
            // FIX: Prioritize requestedRooms (current form state) over locations (may be stale from initial load)
            const multiDayRoomIds = reservationData.requestedRooms?.length > 0
              ? reservationData.requestedRooms
              : (reservationData.locations || []);
            let locationField = undefined;
            let locationsArray = [];
            if (multiDayRoomIds.length > 0) {
              const locationDocs = rooms.filter(room =>
                multiDayRoomIds.includes(room._id)
              );
              if (locationDocs.length > 0) {
                // Build array of separate location objects for Graph API
                locationsArray = locationDocs.map(loc => ({
                  displayName: loc.displayName || loc.name,
                  locationType: 'default'
                }));
                // Primary location is the first one (for backwards compatibility)
                locationField = locationsArray[0];
              }
            }

            // Create events using batch API for better performance
            logger.debug(`Creating ${dates.length} events using batch API`);

            // Show progress notification
            showNotification(`Creating ${dates.length} events...`, 'info');

            // Prepare all events data
            const eventsData = dates.map((dateStr, i) => {
              const startDateTime = `${dateStr}T${reservationData.startTime}:00`;
              const endDateTime = `${dateStr}T${reservationData.endTime}:00`;

              return {
                subject: reservationData.eventTitle || 'Untitled Event',
                start: {
                  dateTime: startDateTime,
                  timeZone: getOutlookTimezone(userTimezone)
                },
                end: {
                  dateTime: endDateTime,
                  timeZone: getOutlookTimezone(userTimezone)
                },
                location: locationField,
                locations: locationsArray.length > 0 ? locationsArray : undefined, // Graph API locations array
                body: {
                  contentType: 'text',
                  content: reservationData.eventDescription || ''
                },
                categories: reservationData.categories || [], // Syncs with Outlook categories
                isAllDay: reservationData.isAllDayEvent || false,
                attendees: reservationData.attendeeCount ? [{
                  emailAddress: {
                    address: '',
                    name: `${reservationData.attendeeCount} attendees`
                  }
                }] : [],
                calendarId: reservationData.calendarId,
                // Include internal enrichments (use whichever field exists)
                locationIds: multiDayRoomIds, // Internal room IDs for database storage
                setupMinutes: reservationData.setupTimeMinutes || 0,
                teardownMinutes: reservationData.teardownTimeMinutes || 0,
                setupTime: reservationData.setupTime || '',
                teardownTime: reservationData.teardownTime || '',
                doorOpenTime: reservationData.doorOpenTime || '',
                doorCloseTime: reservationData.doorCloseTime || '',
                setupNotes: reservationData.setupNotes || '',
                doorNotes: reservationData.doorNotes || '',
                eventNotes: reservationData.eventNotes || '',
                requesterName: reservationData.requesterName || '',
                requesterEmail: reservationData.requesterEmail || '',
                // Add event series metadata
                eventSeriesId: eventSeriesId,
                seriesLength: dayCount,
                seriesIndex: i,
                // Offsite location fields
                isOffsite: reservationData.isOffsite || false,
                offsiteName: reservationData.offsiteName || '',
                offsiteAddress: reservationData.offsiteAddress || '',
                offsiteLat: reservationData.offsiteLat || null,
                offsiteLon: reservationData.offsiteLon || null,
                // Services (internal use only)
                services: reservationData.services || {}
              };
            });

            try {
              // Create all events in batches with progress callback
              const result = await handleBatchCreateEvents(eventsData, (current, total) => {
                showNotification(`Creating events... ${current}/${total}`, 'info');
              });

              const { successCount, failCount } = result;

              // Show summary notification
              if (successCount === dayCount) {
                showNotification(`Successfully created ${successCount} events`);
              } else if (successCount > 0) {
                showNotification(`Created ${successCount} events, ${failCount} failed`, 'warning');
              } else {
                showNotification(`Failed to create events`, 'error');
              }

              logger.debug(`Multi-day batch creation complete: ${successCount} succeeded, ${failCount} failed`);

            } catch (error) {
              logger.error('Batch creation error:', error);
              showNotification('Error creating multi-day events', 'error');
            } finally {
              // Always clear the saving state
              setSavingEvent(false);
            }

            // Close modal and refresh calendar ONCE after all events are created
            setEventReviewModal({ isOpen: false, event: null, mode: 'event', hasChanges: false });
            loadEvents(true);
          } else {
            // Single day event - existing logic
            let startDateTime, endDateTime;

            if (reservationData.startDate && reservationData.startTime) {
              startDateTime = `${reservationData.startDate}T${reservationData.startTime}:00`;
            } else if (reservationData.startDateTime) {
              startDateTime = reservationData.startDateTime;
            }

            if (reservationData.endDate && reservationData.endTime) {
              endDateTime = `${reservationData.endDate}T${reservationData.endTime}:00`;
            } else if (reservationData.endDateTime) {
              endDateTime = reservationData.endDateTime;
            }

            // Transform locations array to Graph API location format
            // FIX: Prioritize requestedRooms (current form state) over locations (may be stale from initial load)
            const roomIds = reservationData.requestedRooms?.length > 0
              ? reservationData.requestedRooms
              : (reservationData.locations || []);
            let locationField = undefined;
            let locationsArray = [];
            if (roomIds.length > 0) {
              const locationDocs = rooms.filter(room =>
                roomIds.includes(room._id)
              );
              if (locationDocs.length > 0) {
                // Build array of separate location objects for Graph API
                locationsArray = locationDocs.map(loc => ({
                  displayName: loc.displayName || loc.name,
                  locationType: 'default'
                }));
                // Primary location is the first one (for backwards compatibility)
                locationField = locationsArray[0];
              }
            }

            // Transform reservation structure to event structure expected by handleSaveEvent
            const eventData = {
              subject: reservationData.eventTitle || 'Untitled Event',
              start: {
                dateTime: startDateTime,
                timeZone: getOutlookTimezone(userTimezone)
              },
              end: {
                dateTime: endDateTime,
                timeZone: getOutlookTimezone(userTimezone)
              },
              location: locationField,
              locations: locationsArray.length > 0 ? locationsArray : undefined, // Graph API locations array
              body: {
                contentType: 'text',
                content: reservationData.eventDescription || ''
              },
              categories: reservationData.categories || [], // Syncs with Outlook categories
              isAllDay: reservationData.isAllDayEvent || false,
              attendees: reservationData.attendeeCount ? [{
                emailAddress: {
                  address: '',
                  name: `${reservationData.attendeeCount} attendees`
                }
              }] : [],
              calendarId: reservationData.calendarId,
              // Include recurrence pattern if exists
              recurrence: reservationData.recurrence || null,
              // Include internal enrichments (use whichever field exists)
              locationIds: roomIds, // Internal room IDs for database storage
              setupMinutes: reservationData.setupTimeMinutes || 0,
              teardownMinutes: reservationData.teardownTimeMinutes || 0,
              setupTime: reservationData.setupTime || '',
              teardownTime: reservationData.teardownTime || '',
              doorOpenTime: reservationData.doorOpenTime || '',
              doorCloseTime: reservationData.doorCloseTime || '',
              setupNotes: reservationData.setupNotes || '',
              doorNotes: reservationData.doorNotes || '',
              eventNotes: reservationData.eventNotes || '',
              requesterName: reservationData.requesterName || '',
              requesterEmail: reservationData.requesterEmail || '',
              // Single event has null eventSeriesId (recurring events will have this set by backend)
              eventSeriesId: reservationData.recurrence ? undefined : null,
              // Offsite location fields
              isOffsite: reservationData.isOffsite || false,
              offsiteName: reservationData.offsiteName || '',
              offsiteAddress: reservationData.offsiteAddress || '',
              offsiteLat: reservationData.offsiteLat || null,
              offsiteLon: reservationData.offsiteLon || null,
              // Services (internal use only)
              services: reservationData.services || {}
            };

            const success = await handleSaveEvent(eventData);

            if (success) {
              showNotification('Event created successfully');
              setEventReviewModal({ isOpen: false, event: null, mode: 'event', hasChanges: false });
              loadEvents(true);
            }
          }
        } else if (mode === 'create') {
          // Reservation request submission - transform data to match API expectations
          logger.debug('Creating reservation request', reservationData);

          // Two-step submit confirmation for reservation requests
          if (!pendingSaveConfirmation) {
            setPendingSaveConfirmation(true);
            return; // Exit early on first click - button text will change to show confirmation
          }

          // Reset confirmation after second click (user confirmed)
          setPendingSaveConfirmation(false);
          setSavingEvent(true); // Show "Submitting..." with disabled button

          try {
            // Transform data to match /api/events/request endpoint expectations
            const requestPayload = {
              eventTitle: reservationData.eventTitle || reservationData.subject || '',
              eventDescription: reservationData.eventDescription || reservationData.description || '',
              // Combine date + time into ISO datetime format expected by API
              startDateTime: `${reservationData.startDate}T${reservationData.startTime}:00`,
              endDateTime: `${reservationData.endDate}T${reservationData.endTime}:00`,
              // Ensure requestedRooms is passed (API requires this field)
              requestedRooms: reservationData.requestedRooms || reservationData.locations || [],
              attendeeCount: reservationData.attendeeCount || 0,
              department: reservationData.department || '',
              phone: reservationData.phone || '',
              specialRequirements: reservationData.specialRequirements || '',
              setupTimeMinutes: reservationData.setupTimeMinutes || 0,
              teardownTimeMinutes: reservationData.teardownTimeMinutes || 0,
              setupTime: reservationData.setupTime || '',
              teardownTime: reservationData.teardownTime || '',
              doorOpenTime: reservationData.doorOpenTime || '',
              doorCloseTime: reservationData.doorCloseTime || '',
              setupNotes: reservationData.setupNotes || '',
              doorNotes: reservationData.doorNotes || '',
              eventNotes: reservationData.eventNotes || '',
              requesterName: reservationData.requesterName || userProfile?.displayName || '',
              requesterEmail: reservationData.requesterEmail || userProfile?.mail || '',
              // Include calendarId and calendarOwner so the event shows up in the user's calendar view
              calendarId: reservationData.calendarId || selectedCalendarId,
              calendarOwner: availableCalendars.find(cal => cal.id === (reservationData.calendarId || selectedCalendarId))?.owner?.address?.toLowerCase() || null,
              // Offsite location fields
              isOffsite: reservationData.isOffsite || false,
              offsiteName: reservationData.offsiteName || '',
              offsiteAddress: reservationData.offsiteAddress || '',
              offsiteLat: reservationData.offsiteLat || null,
              offsiteLon: reservationData.offsiteLon || null,
              // Categories (syncs with Outlook) and Services (internal use only)
              categories: reservationData.categories || [],
              services: reservationData.services || {}
            };

            logger.debug('Transformed request payload', requestPayload);

            const response = await fetch(`${API_BASE_URL}/events/request`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiToken}`
              },
              body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || `Failed to create reservation request: ${response.statusText}`);
            }

            showNotification('Reservation request submitted for approval');
            setEventReviewModal({ isOpen: false, event: null, mode: 'create', hasChanges: false });
            loadEvents(true);
          } finally {
            setSavingEvent(false);
          }
        }
      } catch (error) {
        logger.error('Error saving event from ReviewModal:', error);
        showNotification(`Error: ${error.message}`);
        throw error;
      }
    }, [eventReviewModal, apiToken, handleSaveEvent, handleSaveApiEvent, loadEvents, showNotification, pendingMultiDayConfirmation, pendingSaveConfirmation, userTimezone, getOutlookTimezone, effectivePermissions]);

    /**
     * Handle closing the EventReviewModal
     */
    const handleEventReviewModalClose = useCallback((force = false) => {
      // Show draft save dialog if there are unsaved changes in create mode (not for edit mode)
      if (!force && eventReviewModal.mode === 'create' && eventReviewModal.hasChanges && !draftId) {
        setShowDraftSaveDialog(true);
        return;
      }
      setEventReviewModal({ isOpen: false, event: null, mode: 'event', hasChanges: false });
      setPendingEventDeleteConfirmation(false); // Reset delete confirmation
      setPendingMultiDayConfirmation(null); // Reset multi-day confirmation
      setPendingSaveConfirmation(false); // Reset save confirmation
      setDraftId(null); // Reset draft ID
      setShowDraftSaveDialog(false);
    }, [eventReviewModal.mode, eventReviewModal.hasChanges, draftId]);

    /**
     * Handle enabling edit request mode for approved events
     * This allows requesters to edit the form inline and submit changes for approval
     */
    const handleRequestEdit = useCallback(() => {
      // Store the original data before enabling edit mode
      const currentData = reviewModal.editableData;
      if (currentData) {
        setOriginalEventData(JSON.parse(JSON.stringify(currentData))); // Deep clone
      }
      setIsEditRequestMode(true);
      setEditRequestChangeReason('');
    }, [reviewModal.editableData]);

    /**
     * Handle canceling edit request mode
     */
    const handleCancelEditRequest = useCallback(() => {
      setIsEditRequestMode(false);
      setEditRequestChangeReason('');
      setOriginalEventData(null);
      // Revert to original data
      if (originalEventData && reviewModal.editableData) {
        reviewModal.updateData(originalEventData);
      }
    }, [originalEventData, reviewModal]);

    /**
     * Get existing edit request from event's embedded pendingEditRequest field
     * Falls back to API call if needed (for backward compatibility)
     */
    const fetchExistingEditRequest = useCallback(async (event) => {
      if (!event) return null;

      setLoadingEditRequest(true);
      try {
        // EMBEDDED MODEL: Check for pendingEditRequest directly on the event
        if (event.pendingEditRequest && event.pendingEditRequest.status === 'pending') {
          const pendingReq = event.pendingEditRequest;
          // Transform to the format expected by the frontend
          return {
            _id: event._id,
            eventId: event.eventId,
            editRequestId: pendingReq.id,
            status: pendingReq.status,
            requestedBy: pendingReq.requestedBy,
            changeReason: pendingReq.changeReason,
            proposedChanges: pendingReq.proposedChanges,
            originalValues: pendingReq.originalValues,
            reviewedBy: pendingReq.reviewedBy,
            reviewedAt: pendingReq.reviewedAt,
            reviewNotes: pendingReq.reviewNotes,
            // Merge proposed changes with original values for form display
            eventTitle: pendingReq.proposedChanges?.eventTitle || event.eventTitle,
            eventDescription: pendingReq.proposedChanges?.eventDescription || event.eventDescription,
            startDateTime: pendingReq.proposedChanges?.startDateTime || event.startDateTime,
            endDateTime: pendingReq.proposedChanges?.endDateTime || event.endDateTime,
            startDate: pendingReq.proposedChanges?.startDateTime?.split('T')[0] || event.startDate,
            startTime: pendingReq.proposedChanges?.startDateTime?.split('T')[1]?.substring(0, 5) || event.startTime,
            endDate: pendingReq.proposedChanges?.endDateTime?.split('T')[0] || event.endDate,
            endTime: pendingReq.proposedChanges?.endDateTime?.split('T')[1]?.substring(0, 5) || event.endTime,
            attendeeCount: pendingReq.proposedChanges?.attendeeCount ?? event.attendeeCount,
            locations: pendingReq.proposedChanges?.locations || event.locations,
            locationDisplayNames: pendingReq.proposedChanges?.locationDisplayNames || event.locationDisplayNames,
            requestedRooms: pendingReq.proposedChanges?.requestedRooms || event.requestedRooms,
            categories: pendingReq.proposedChanges?.categories || event.categories,
            services: pendingReq.proposedChanges?.services || event.services,
            setupTimeMinutes: pendingReq.proposedChanges?.setupTimeMinutes ?? event.setupTimeMinutes,
            teardownTimeMinutes: pendingReq.proposedChanges?.teardownTimeMinutes ?? event.teardownTimeMinutes,
            setupTime: pendingReq.proposedChanges?.setupTime || event.setupTime,
            teardownTime: pendingReq.proposedChanges?.teardownTime || event.teardownTime,
            doorOpenTime: pendingReq.proposedChanges?.doorOpenTime || event.doorOpenTime,
            doorCloseTime: pendingReq.proposedChanges?.doorCloseTime || event.doorCloseTime,
            setupNotes: pendingReq.proposedChanges?.setupNotes ?? event.setupNotes,
            doorNotes: pendingReq.proposedChanges?.doorNotes ?? event.doorNotes,
            eventNotes: pendingReq.proposedChanges?.eventNotes ?? event.eventNotes,
            specialRequirements: pendingReq.proposedChanges?.specialRequirements ?? event.specialRequirements,
            isOffsite: pendingReq.proposedChanges?.isOffsite ?? event.isOffsite,
            offsiteName: pendingReq.proposedChanges?.offsiteName || event.offsiteName,
            offsiteAddress: pendingReq.proposedChanges?.offsiteAddress || event.offsiteAddress,
            createdAt: pendingReq.requestedBy?.requestedAt
          };
        }

        // Fallback: API call for events that may have been loaded without full data
        const eventId = event._id || event.eventId;
        if (!eventId || !apiToken) return null;

        const response = await fetch(
          `${APP_CONFIG.API_BASE_URL}/events/${eventId}/edit-requests`,
          {
            headers: {
              'Authorization': `Bearer ${apiToken}`
            }
          }
        );

        if (response.ok) {
          const data = await response.json();
          // Return the first pending edit request (there should only be one)
          const pendingRequest = data.editRequests?.find(r => r.status === 'pending');
          return pendingRequest || null;
        }
        return null;
      } catch (err) {
        logger.error('Error fetching edit requests:', err);
        return null;
      } finally {
        setLoadingEditRequest(false);
      }
    }, [apiToken]);

    /**
     * Effect to check for existing edit requests when modal opens with approved event
     */
    useEffect(() => {
      const checkForEditRequest = async () => {
        if (reviewModal.isOpen && reviewModal.currentItem?.status === 'approved') {
          // Pass the entire event object to check embedded pendingEditRequest first
          const editRequest = await fetchExistingEditRequest(reviewModal.currentItem);
          setExistingEditRequest(editRequest);
        } else if (!reviewModal.isOpen) {
          // Reset when modal closes
          setExistingEditRequest(null);
          setIsViewingEditRequest(false);
        }
      };

      checkForEditRequest();
    }, [reviewModal.isOpen, reviewModal.currentItem, fetchExistingEditRequest]);

    /**
     * Handle viewing an existing edit request
     */
    const handleViewEditRequest = useCallback(() => {
      if (existingEditRequest) {
        // Store the original event data
        const currentData = reviewModal.editableData;
        if (currentData) {
          setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
        }
        // Load the edit request data into the form
        reviewModal.updateData(existingEditRequest);
        setIsViewingEditRequest(true);
      }
    }, [existingEditRequest, reviewModal]);

    /**
     * Handle toggling back to the original published event
     */
    const handleViewOriginalEvent = useCallback(() => {
      if (originalEventData) {
        reviewModal.updateData(originalEventData);
        setIsViewingEditRequest(false);
      }
    }, [originalEventData, reviewModal]);

    /**
     * Handle approving an edit request (Admin only)
     */
    const handleApproveEditRequest = useCallback(async () => {
      // First click shows confirmation
      if (!isEditRequestApproveConfirming) {
        setIsEditRequestApproveConfirming(true);
        return;
      }

      // Second click confirms
      const currentItem = reviewModal.currentItem;
      if (!currentItem || !existingEditRequest) {
        logger.error('No edit request to approve');
        return;
      }

      try {
        setIsApprovingEditRequest(true);
        const eventId = currentItem._id || currentItem.eventId;

        const response = await fetch(
          `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/approve-edit`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiToken}`
            },
            body: JSON.stringify({
              notes: '',
              graphToken
            })
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to approve edit request');
        }

        logger.info('Edit request approved:', eventId);

        // Reset state
        setIsEditRequestApproveConfirming(false);
        setIsViewingEditRequest(false);
        setExistingEditRequest(null);
        setOriginalEventData(null);

        // Close the modal
        reviewModal.closeModal();

        // Refresh events to show updated data
        if (refreshEvents) {
          refreshEvents();
        }

        showNotification('Edit request approved. Changes have been applied.', 'success');

      } catch (error) {
        logger.error('Error approving edit request:', error);
        showNotification(`Failed to approve edit request: ${error.message}`, 'error');
      } finally {
        setIsApprovingEditRequest(false);
        setIsEditRequestApproveConfirming(false);
      }
    }, [isEditRequestApproveConfirming, reviewModal, existingEditRequest, apiToken, graphToken, refreshEvents, showNotification]);

    /**
     * Handle rejecting an edit request (Admin only)
     */
    const handleRejectEditRequest = useCallback(async () => {
      // First click shows confirmation
      if (!isEditRequestRejectConfirming) {
        setIsEditRequestRejectConfirming(true);
        return;
      }

      // Second click needs reason
      if (!editRequestRejectionReason.trim()) {
        showNotification('Please provide a reason for rejecting the edit request.', 'error');
        return;
      }

      const currentItem = reviewModal.currentItem;
      if (!currentItem || !existingEditRequest) {
        logger.error('No edit request to reject');
        return;
      }

      try {
        setIsRejectingEditRequest(true);
        const eventId = currentItem._id || currentItem.eventId;

        const response = await fetch(
          `${APP_CONFIG.API_BASE_URL}/admin/events/${eventId}/reject-edit`,
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

        logger.info('Edit request rejected:', eventId);

        // Reset state
        setIsEditRequestRejectConfirming(false);
        setEditRequestRejectionReason('');
        setIsViewingEditRequest(false);
        setExistingEditRequest(null);
        setOriginalEventData(null);

        // Close the modal
        reviewModal.closeModal();

        // Refresh events
        if (refreshEvents) {
          refreshEvents();
        }

        showNotification('Edit request rejected.', 'success');

      } catch (error) {
        logger.error('Error rejecting edit request:', error);
        showNotification(`Failed to reject edit request: ${error.message}`, 'error');
      } finally {
        setIsRejectingEditRequest(false);
        setIsEditRequestRejectConfirming(false);
      }
    }, [isEditRequestRejectConfirming, editRequestRejectionReason, reviewModal, existingEditRequest, apiToken, refreshEvents, showNotification]);

    /**
     * Cancel edit request approval confirmation
     */
    const cancelEditRequestApproveConfirmation = useCallback(() => {
      setIsEditRequestApproveConfirming(false);
    }, []);

    /**
     * Cancel edit request rejection confirmation
     */
    const cancelEditRequestRejectConfirmation = useCallback(() => {
      setIsEditRequestRejectConfirming(false);
      setEditRequestRejectionReason('');
    }, []);

    /**
     * Handle canceling own pending edit request (Requester only)
     */
    const handleCancelPendingEditRequest = useCallback(async () => {
      // First click shows confirmation
      if (!isCancelEditRequestConfirming) {
        setIsCancelEditRequestConfirming(true);
        return;
      }

      // Second click confirms
      const currentItem = reviewModal.currentItem;
      if (!currentItem || !existingEditRequest) {
        logger.error('No edit request to cancel');
        return;
      }

      try {
        setIsCancelingEditRequest(true);
        const eventId = currentItem._id || currentItem.eventId;

        const response = await fetch(
          `${APP_CONFIG.API_BASE_URL}/events/edit-requests/${eventId}/cancel`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiToken}`
            }
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to cancel edit request');
        }

        logger.info('Edit request canceled:', eventId);

        // Reset state
        setIsCancelEditRequestConfirming(false);
        setIsViewingEditRequest(false);
        setExistingEditRequest(null);
        setOriginalEventData(null);

        // Close the modal
        reviewModal.closeModal();

        // Refresh events
        if (refreshEvents) {
          refreshEvents();
        }

        showNotification('Edit request canceled.', 'success');

      } catch (error) {
        logger.error('Error canceling edit request:', error);
        showNotification(`Failed to cancel edit request: ${error.message}`, 'error');
      } finally {
        setIsCancelingEditRequest(false);
        setIsCancelEditRequestConfirming(false);
      }
    }, [isCancelEditRequestConfirming, reviewModal, existingEditRequest, apiToken, refreshEvents, showNotification]);

    /**
     * Cancel cancel edit request confirmation
     */
    const cancelCancelEditRequestConfirmation = useCallback(() => {
      setIsCancelEditRequestConfirming(false);
    }, []);

    /**
     * Compute detected changes between original and current data
     */
    const computeDetectedChanges = useCallback(() => {
      if (!originalEventData || !reviewModal.editableData || !isEditRequestMode) {
        return [];
      }

      const changes = [];
      const fieldConfig = [
        { key: 'eventTitle', label: 'Event Title' },
        { key: 'eventDescription', label: 'Description' },
        { key: 'startDate', label: 'Start Date' },
        { key: 'startTime', label: 'Start Time' },
        { key: 'endDate', label: 'End Date' },
        { key: 'endTime', label: 'End Time' },
        { key: 'attendeeCount', label: 'Attendee Count' },
        { key: 'specialRequirements', label: 'Special Requirements' },
        { key: 'setupTime', label: 'Setup Time' },
        { key: 'teardownTime', label: 'Teardown Time' },
        { key: 'doorOpenTime', label: 'Door Open Time' },
        { key: 'doorCloseTime', label: 'Door Close Time' },
      ];

      const current = reviewModal.editableData;
      const original = originalEventData;

      for (const { key, label } of fieldConfig) {
        const oldVal = original[key] || '';
        const newVal = current[key] || '';
        if (String(oldVal) !== String(newVal)) {
          changes.push({
            field: key,
            label,
            oldValue: String(oldVal),
            newValue: String(newVal)
          });
        }
      }

      // Handle arrays (locations, categories)
      const originalLocations = (original.requestedRooms || original.locations || []).join(', ');
      const currentLocations = (current.requestedRooms || current.locations || []).join(', ');
      if (originalLocations !== currentLocations) {
        changes.push({
          field: 'locations',
          label: 'Locations',
          oldValue: originalLocations || '(none)',
          newValue: currentLocations || '(none)'
        });
      }

      const originalCategories = (original.categories || original.mecCategories || []).join(', ');
      const currentCategories = (current.categories || current.mecCategories || []).join(', ');
      if (originalCategories !== currentCategories) {
        changes.push({
          field: 'categories',
          label: 'Categories',
          oldValue: originalCategories || '(none)',
          newValue: currentCategories || '(none)'
        });
      }

      return changes;
    }, [originalEventData, reviewModal.editableData, isEditRequestMode]);

    /**
     * Handle submitting the edit request
     * Uses two-step inline confirmation
     */
    const handleSubmitEditRequest = useCallback(async () => {
      if (!reviewModal.currentItem) {
        return;
      }

      const detectedChanges = computeDetectedChanges();
      if (detectedChanges.length === 0) {
        showNotification('No changes detected. Please modify some fields before submitting.', 'error');
        return;
      }

      // Two-step confirmation: First click shows confirmation, second click submits
      if (!pendingEditRequestConfirmation) {
        setPendingEditRequestConfirmation(true);
        return;
      }

      // Second click: User confirmed, proceed with submission
      setPendingEditRequestConfirmation(false);
      setIsSubmittingEditRequest(true);

      try {
        const eventId = reviewModal.currentItem._id || reviewModal.currentItem.eventId;
        const currentData = reviewModal.editableData;

        // Build the edit request payload
        const requestBody = {
          eventTitle: currentData.eventTitle,
          eventDescription: currentData.eventDescription,
          startDateTime: currentData.startDate && currentData.startTime
            ? `${currentData.startDate}T${currentData.startTime}`
            : null,
          endDateTime: currentData.endDate && currentData.endTime
            ? `${currentData.endDate}T${currentData.endTime}`
            : null,
          attendeeCount: parseInt(currentData.attendeeCount) || 0,
          requestedRooms: currentData.requestedRooms || currentData.locations || [],
          specialRequirements: currentData.specialRequirements,
          setupTime: currentData.setupTime,
          teardownTime: currentData.teardownTime,
          doorOpenTime: currentData.doorOpenTime,
          doorCloseTime: currentData.doorCloseTime,
          categories: currentData.categories || currentData.mecCategories || [],
          services: currentData.services || {}
        };

        const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${eventId}/request-edit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to submit edit request');
        }

        showNotification('Edit request submitted successfully! An admin will review your changes.', 'success');

        // Reset edit request mode and close modal
        setIsEditRequestMode(false);
        setEditRequestChangeReason('');
        setOriginalEventData(null);
        setPendingEditRequestConfirmation(false);
        reviewModal.closeModal();

        // Refresh events to show the pending edit indicator
        if (refreshEvents) {
          refreshEvents();
        }

      } catch (err) {
        logger.error('Error submitting edit request:', err);
        showNotification(err.message || 'Failed to submit edit request', 'error');
      } finally {
        setIsSubmittingEditRequest(false);
      }
    }, [reviewModal, computeDetectedChanges, apiToken, showNotification, pendingEditRequestConfirmation, refreshEvents]);

    /**
     * Cancel edit request confirmation
     */
    const cancelEditRequestConfirmation = useCallback(() => {
      setPendingEditRequestConfirmation(false);
    }, []);

    /**
     * Build draft payload from event data
     */
    const buildDraftPayload = useCallback((eventData) => {
      // Helper function to convert time difference to minutes
      const calculateTimeBufferMinutes = (eventTime, bufferTime) => {
        if (!eventTime || !bufferTime) return 0;
        const eventDate = new Date(`1970-01-01T${eventTime}:00`);
        const bufferDate = new Date(`1970-01-01T${bufferTime}:00`);
        const diffMs = Math.abs(eventDate.getTime() - bufferDate.getTime());
        return Math.floor(diffMs / (1000 * 60));
      };

      // Combine date and time if both exist
      const startDateTime = eventData.startDate && eventData.startTime
        ? `${eventData.startDate}T${eventData.startTime}`
        : null;
      const endDateTime = eventData.endDate && eventData.endTime
        ? `${eventData.endDate}T${eventData.endTime}`
        : null;

      let setupTimeMinutes = eventData.setupTimeMinutes || 0;
      let teardownTimeMinutes = eventData.teardownTimeMinutes || 0;

      if (eventData.setupTime && eventData.startTime) {
        setupTimeMinutes = calculateTimeBufferMinutes(eventData.startTime, eventData.setupTime);
      }
      if (eventData.teardownTime && eventData.endTime) {
        teardownTimeMinutes = calculateTimeBufferMinutes(eventData.endTime, eventData.teardownTime);
      }

      return {
        eventTitle: eventData.eventTitle || eventData.subject || '',
        eventDescription: eventData.eventDescription || eventData.description || '',
        startDateTime,
        endDateTime,
        attendeeCount: parseInt(eventData.attendeeCount) || 0,
        requestedRooms: eventData.requestedRooms || eventData.locations || [],
        requiredFeatures: eventData.requiredFeatures || [],
        specialRequirements: eventData.specialRequirements || '',
        department: eventData.department || '',
        phone: eventData.phone || '',
        setupTimeMinutes,
        teardownTimeMinutes,
        setupTime: eventData.setupTime || null,
        teardownTime: eventData.teardownTime || null,
        doorOpenTime: eventData.doorOpenTime || null,
        doorCloseTime: eventData.doorCloseTime || null,
        setupNotes: eventData.setupNotes || '',
        doorNotes: eventData.doorNotes || '',
        eventNotes: eventData.eventNotes || '',
        isOnBehalfOf: eventData.isOnBehalfOf || false,
        contactName: eventData.contactName || '',
        contactEmail: eventData.contactEmail || '',
        mecCategories: eventData.mecCategories || [],
        services: eventData.services || {},
        recurrence: eventData.recurrence || null,
        virtualMeetingUrl: eventData.virtualMeetingUrl || null,
        isOffsite: eventData.isOffsite || false,
        offsiteName: eventData.offsiteName || '',
        offsiteAddress: eventData.offsiteAddress || '',
        offsiteLat: eventData.offsiteLat || null,
        offsiteLon: eventData.offsiteLon || null
      };
    }, []);

    /**
     * Save current form as draft
     */
    const handleSaveDraft = useCallback(async () => {
      const eventData = eventReviewModal.event;
      if (!eventData) {
        showNotification('No form data to save', 'error');
        return;
      }

      // Minimal validation - only eventTitle required
      if (!eventData.eventTitle?.trim()) {
        showNotification('Event title is required to save as draft', 'error');
        return;
      }

      setSavingDraft(true);

      try {
        const payload = buildDraftPayload(eventData);

        const endpoint = draftId
          ? `${API_BASE_URL}/room-reservations/draft/${draftId}`
          : `${API_BASE_URL}/room-reservations/draft`;

        const method = draftId ? 'PUT' : 'POST';

        const response = await fetch(endpoint, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to save draft');
        }

        const result = await response.json();
        logger.log('Draft saved:', result);

        // Update draft ID if this was a new draft
        if (!draftId) {
          setDraftId(result._id);
        }

        setEventReviewModal(prev => ({ ...prev, hasChanges: false }));
        showNotification('Draft saved successfully', 'success');

      } catch (error) {
        logger.error('Error saving draft:', error);
        showNotification(`Failed to save draft: ${error.message}`, 'error');
      } finally {
        setSavingDraft(false);
      }
    }, [eventReviewModal.event, draftId, apiToken, buildDraftPayload, showNotification]);

    /**
     * Handle draft dialog save
     */
    const handleDraftDialogSave = useCallback(async () => {
      await handleSaveDraft();
      setShowDraftSaveDialog(false);
      handleEventReviewModalClose(true);
    }, [handleSaveDraft, handleEventReviewModalClose]);

    /**
     * Handle draft dialog discard
     */
    const handleDraftDialogDiscard = useCallback(() => {
      setShowDraftSaveDialog(false);
      handleEventReviewModalClose(true);
    }, [handleEventReviewModalClose]);

    /**
     * Handle draft dialog cancel (continue editing)
     */
    const handleDraftDialogCancel = useCallback(() => {
      setShowDraftSaveDialog(false);
    }, []);

    /**
     * Check if draft can be saved (requires title AND changes)
     */
    const canSaveDraft = useCallback(() => {
      return !!eventReviewModal.event?.eventTitle?.trim() && eventReviewModal.hasChanges;
    }, [eventReviewModal.event, eventReviewModal.hasChanges]);

    /**
     * Handle navigation to another event in the series (close and reopen modal)
     * @param {string} targetEventId - The eventId to navigate to
     */
    const handleNavigateToSeriesEvent = useCallback((targetEventId) => {
      logger.debug('Navigating to series event:', targetEventId);

      // Find the target event in allEvents
      const targetEvent = allEvents.find(event => event.eventId === targetEventId);

      if (!targetEvent) {
        logger.error('Could not find target event in allEvents:', targetEventId);
        showNotification('Could not find the selected event', 'error');
        return;
      }

      logger.debug('Found target event, reopening modal:', targetEvent);

      // Determine which modal is open and reopen with new event
      if (eventReviewModal.isOpen) {
        // Close and reopen eventReviewModal with new event
        setEventReviewModal({
          isOpen: true,
          event: targetEvent,
          mode: eventReviewModal.mode,
          hasChanges: false,
          isNavigating: false
        });

        // Clear any pending confirmations
        setPendingMultiDayConfirmation(null);
        setPendingEventDeleteConfirmation(false);
        setPendingSaveConfirmation(false);
      } else if (reviewModal.isOpen) {
        // Close current modal
        reviewModal.closeModal();

        // Reopen with new event after a brief delay to ensure clean state
        setTimeout(() => {
          reviewModal.openModal(targetEvent);
        }, 100);
      }

      logger.debug('Modal reopened with new event');
    }, [allEvents, showNotification, eventReviewModal, reviewModal]);

    /**
     * Handle navigation state changes for event review modal
     */
    const handleEventReviewIsNavigatingChange = useCallback((isNavigating) => {
      setEventReviewModal(prev => ({
        ...prev,
        isNavigating
      }));
    }, []);

    /**
     * Handle form validity changes for event review modal
     */
    const handleEventReviewFormValidChange = useCallback((isValid) => {
      setEventReviewModal(prev => ({ ...prev, isFormValid: isValid }));
    }, []);

    /**
     * Handle deletion of registration events when a TempleEvents event is deleted
     * @param {string} eventId - The event ID that was deleted
     */
    const handleRegistrationEventDeletion = async (eventId) => {
      try {
        // First try the new linked events deletion method
        const linkedEventDeleted = await deleteLinkedEvent(graphToken, eventId, selectedCalendarId);
        
        if (linkedEventDeleted) {
          logger.debug('Successfully deleted linked registration event using extended properties');
          return;
        }

        // Fall back to legacy method using internal data
        if (!eventDataService.apiToken) {
          logger.debug('No API token for event data service, skipping registration event deletion');
          return;
        }

        // Try to get the internal data to find the registration event ID
        const response = await fetch(`${API_BASE_URL}/internal-events/enrich`, {
          method: 'POST',
          headers: eventDataService.getAuthHeaders(),
          body: JSON.stringify({ eventIds: [eventId] })
        });

        if (!response.ok) {
          logger.debug('Failed to fetch internal data for registration event deletion');
          return;
        }

        const enrichmentMap = await response.json();
        const internalData = enrichmentMap[eventId];

        if (!internalData || !internalData.registrationEventId) {
          logger.debug('No linked registration event found for event:', eventId);
          return;
        }

        // Delete the registration event using legacy method
        const registrationEventId = internalData.registrationEventId;
        const registrationCalendarId = internalData.registrationCalendarId;

        if (registrationCalendarId) {
          const deleteUrl = `https://graph.microsoft.com/v1.0/me/calendars/${registrationCalendarId}/events/${registrationEventId}`;
          
          const deleteResponse = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${graphToken}`
            }
          });

          if (deleteResponse.ok) {
            logger.debug('Successfully deleted registration event (legacy method):', registrationEventId);
          } else if (deleteResponse.status === 404) {
            // 404 means the registration event doesn't exist in Graph API (already deleted)
            logger.debug('Registration event already deleted from Microsoft Calendar (404 - Not Found):', registrationEventId);
          } else {
            logger.error('Failed to delete registration event:', deleteResponse.status);
          }
        }
      } catch (error) {
        logger.error('Error in handleRegistrationEventDeletion:', error);
        // Don't throw - registration event deletion is supplementary
      }
    };
    
    /**
     * TBD
     */
    const handleDeleteDemoEvent = async (eventId) => {
      try {
        // Initialize the service
        calendarDataService.initialize(
          graphToken, 
          apiToken, 
          selectedCalendarId, 
          schemaExtensions
        );
        
        // Delete through the service (demo mode)
        await calendarDataService.deleteEvent(eventId);
        
        // Update local state immediately
        setAllEvents(allEvents.filter(event => event.id !== eventId));
        
        // Reload demo events to ensure consistency
        await loadDemoEvents();
        
        logger.debug(`[handleDeleteDemoEvent] Deleted demo event:`, eventId);
        return true;
        
      } catch (error) {
        logger.error('Demo delete failed:', error);
        throw error;
      }
    };

    /**
     * TBD
     */
    const handleDeleteApiEvent = async (eventId) => {
      let graphDeleted = false;
      let mongoDeleted = false;
      
      try {
        // Step 1: Delete linked registration events first (from Graph API)
        await handleRegistrationEventDeletion(eventId);
        
        // Step 2: Delete main event from Microsoft Graph API
        const apiUrl = selectedCalendarId
          ? `https://graph.microsoft.com/v1.0/me/calendars/${selectedCalendarId}/events/${eventId}`
          : `https://graph.microsoft.com/v1.0/me/events/${eventId}`;
            
        const graphResponse = await fetch(apiUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${graphToken}`
          }
        });
    
        if (!graphResponse.ok) {
          if (graphResponse.status === 404) {
            // 404 means the event doesn't exist in Graph API (already deleted)
            // This is actually a success case - treat as if deletion succeeded
            graphDeleted = true;
            logger.debug('Event already deleted from Microsoft Calendar (404 - Not Found)');
          } else {
            // Other errors are actual failures
            const error = await graphResponse.json();
            logger.error('Failed to delete event from Graph:', error);
            throw new Error(`Graph API delete failed: ${graphResponse.status}`);
          }
        } else {
          graphDeleted = true;
          logger.debug('Event deleted from Microsoft Calendar');
        }
        
        // Step 3: Delete event from MongoDB collections
        if (apiToken) {
          try {
            const mongoResponse = await fetch(`${API_BASE_URL}/internal-events/${eventId}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (mongoResponse.ok) {
              const result = await mongoResponse.json();
              mongoDeleted = true;
              logger.debug('Event deleted from MongoDB:', result);
            } else {
              // If MongoDB deletion fails, log but don't fail the whole operation
              // since Graph deletion succeeded
              const mongoError = await mongoResponse.json().catch(() => ({}));
              logger.warn(`MongoDB deletion failed (${mongoResponse.status}):`, mongoError);
              // Continue with the rest of the flow
            }
          } catch (mongoError) {
            logger.warn('Error deleting from MongoDB:', mongoError);
            // Continue with the rest of the flow
          }
        }
        
        // Step 4: Update local state immediately
        setAllEvents(allEvents.filter(event => event.id !== eventId));

        // Step 5: Reload events to ensure consistency
        await loadEvents();
        
        logger.debug(`[handleDeleteApiEvent] Successfully deleted event:`, {
          eventId,
          graphDeleted,
          mongoDeleted
        });
        
        return true;
        
      } catch (error) {
        logger.error('Event deletion failed:', {
          eventId,
          graphDeleted,
          mongoDeleted,
          error: error.message
        });
        
        // If we're here, Graph deletion likely failed
        // Don't attempt MongoDB cleanup if Graph delete failed
        throw error;
      }
    };

    /**
     * Handle event deletion with inline two-step confirmation
     */
    const handleEventReviewModalDelete = useCallback(async () => {
      if (!eventReviewModal.event) return;

      // Two-step confirmation: First click shows confirmation, second click deletes
      if (!pendingEventDeleteConfirmation) {
        // First click: Set pending confirmation state and return
        setPendingEventDeleteConfirmation(true);
        return;
      }

      // Second click: User confirmed, proceed with deletion
      setPendingEventDeleteConfirmation(false);

      const event = eventReviewModal.event;

      try {
        if (isDemoMode) {
          const eventId = event.eventId || event.id;
          await handleDeleteDemoEvent(eventId);
        } else {
          // Use MongoDB _id to call backend DELETE endpoint (same logic as useReviewModal.jsx)
          const mongoId = event._id;

          // Determine if this is a room reservation by checking status field
          const isRoomReservation = event.status && (
            event.status === 'pending' ||
            event.status === 'room-reservation-request' ||
            event.status === 'approved' ||
            event.status === 'rejected'
          );

          // Choose the appropriate endpoint (API_BASE_URL already includes /api)
          const endpoint = isRoomReservation
            ? `${API_BASE_URL}/admin/room-reservations/${mongoId}`
            : `${API_BASE_URL}/admin/events/${mongoId}`;

          const response = await fetch(endpoint, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              graphToken: graphToken // Backend will use it if needed
            })
          });

          if (!response.ok) {
            throw new Error(`Failed to delete: ${response.status}`);
          }

          await response.json();

          // Update local state - remove event from allEvents
          setAllEvents(allEvents.filter(e => e._id !== mongoId));

          // Note: NOT calling loadEvents() here to avoid race condition with Graph API deletion propagation
          // The local state update is sufficient, and the next natural refresh will sync properly
        }

        handleEventReviewModalClose();
        showNotification('Event deleted successfully', 'success');
      } catch (error) {
        logger.error('Error deleting event:', error);
        showNotification(`Error deleting event: ${error.message}`, 'error');
      }
    }, [eventReviewModal.event, pendingEventDeleteConfirmation, isDemoMode, handleDeleteDemoEvent, handleEventReviewModalClose, showNotification, apiToken, graphToken, API_BASE_URL, allEvents]);

    /**
     * Delete an event
     */
    const handleDeleteConfirm = async () => {
      if (!currentEvent?.id) {
        showWarning('No event selected for deletion');
        return;
      }
      
      try {
        // Dispatch to the appropriate handler based on mode
        if (isDemoMode) {
          await handleDeleteDemoEvent(currentEvent.id);
          
          // Close modal and clear current event
          setIsModalOpen(false);
          setCurrentEvent(null);
          
          showNotification('Event deleted successfully!', 'success');
        } else {
          // For live events, we need to handle potential partial failures
          const result = await handleDeleteApiEvent(currentEvent.id);
          
          // Close modal and clear current event if deletion succeeded
          setIsModalOpen(false);
          setCurrentEvent(null);
          
          // Check if we have specific deletion information in the logs
          // This is a bit of a workaround since handleDeleteApiEvent doesn't return detailed status
          // In a future iteration, we could enhance this by returning deletion details
          showNotification('Event deleted successfully!', 'success');
        }
        
      } catch (error) {
        logger.error('Delete failed:', error);
        
        // Enhanced error messaging
        let errorMessage = 'Delete failed: ';
        
        if (error.message.includes('Graph API delete failed: 404')) {
          // This should not happen anymore since we handle 404s gracefully
          errorMessage += 'Event no longer exists in Microsoft Calendar but failed to clean up internal data.';
        } else if (error.message.includes('Graph API delete failed')) {
          errorMessage += 'Unable to delete event from Microsoft Calendar. You may not have permission to delete it.';
        } else if (error.message.includes('MongoDB')) {
          errorMessage += 'Event was deleted from Microsoft Calendar but failed to clean up internal data. The event should still be removed from your calendar.';
        } else {
          errorMessage += error.message;
        }
        
        // Use showNotification for consistent error display
        showNotification(errorMessage, 'error');
        
        // Also log the detailed error for debugging
        logger.error('Detailed deletion error:', {
          eventId: currentEvent?.id,
          eventSubject: currentEvent?.subject,
          error: error.message,
          stack: error.stack
        });
      }
    };

    //---------------------------------------------------------------------------
    // DEBUGGING FUNCTIONS
    //---------------------------------------------------------------------------
    const debugDemoData = () => {
      if (demoData?.events) {
        logger.debug('=== DEMO DATA DEBUG ===');
        logger.debug('Total events:', demoData.events.length);
        logger.debug('Date range of demo data:', demoData.searchCriteria?.dateRange);
        logger.debug('Current calendar view:', {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString()
        });
        
        // Show first few events
        const sampleEvents = demoData.events.slice(0, 5);
        logger.debug('Sample events:');
        sampleEvents.forEach((event, i) => {
          logger.debug(`${i + 1}. ${event.subject}`);
          logger.debug(`   Start: ${event.startDateTime}`);
          logger.debug(`   End: ${event.endDateTime}`);
          logger.debug(`   Location: ${event.locationDisplayNames}`);
          logger.debug(`   Categories: ${JSON.stringify(event.categories)}`);
        });
        
        // Check if any events fall in current date range
        const eventsInRange = demoData.events.filter(event => {
          const eventDate = new Date(event.startDateTime);
          return eventDate >= dateRange.start && eventDate <= dateRange.end;
        });
        logger.debug(`Events in current range (${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}):`, eventsInRange.length);
        
        if (eventsInRange.length === 0) {
          const eventDates = demoData.events.map(e => new Date(e.startDateTime));
          const earliestEvent = new Date(Math.min(...eventDates));
          const latestEvent = new Date(Math.max(...eventDates));
          logger.debug('Event date range in data:');
          logger.debug(`  Earliest: ${earliestEvent.toLocaleDateString()}`);
          logger.debug(`  Latest: ${latestEvent.toLocaleDateString()}`);
          logger.debug('SUGGESTION: Navigate calendar to these dates to see events');
        }
        logger.debug('======================');
      }
    };

    //---------------------------------------------------------------------------
    // MAIN INITIALIZATION FUNCTION
    //---------------------------------------------------------------------------
    useEffect(() => {
      // Check if tokens are available for initialization
      if (graphToken && apiToken && initializing) {
        logger.debug("Tokens available, starting initialization");
        initializeApp();
      }
    }, [graphToken, apiToken, initializing, initializeApp]);

    useEffect(() => {
      if (apiToken) {
        eventDataService.setApiToken(apiToken);
      }
    }, [apiToken]);

    const dateRangeString = useMemo(() => 
      `${dateRange.start.toISOString()}-${dateRange.end.toISOString()}`, 
      [dateRange.start, dateRange.end]
    );

    // Consolidated event loading effect to prevent duplicate API calls
    useEffect(() => {

      if (graphToken && !initializing && selectedCalendarId && availableCalendars.length > 0) {
        calendarDebug.logEventLoading(selectedCalendarId, dateRange, 'useEffect trigger');
        window._calendarLoadStart = Date.now();
        const startTime = Date.now();

        // Set a timeout to ensure changingCalendar is reset even if loading hangs
        const timeoutId = setTimeout(() => {
          logger.error('[Calendar useEffect] TIMEOUT - Forcing changingCalendar to false');
          calendarDebug.logError('Calendar loading timeout', new Error('Loading took too long'), { selectedCalendarId });
          setChangingCalendar(false);
        }, 30000); // 30 second timeout

        // Load events with force refresh to get fresh body content
        loadEvents(true)  // true = forceRefresh to bypass stale cache
          .then((result) => {
            const duration = Date.now() - startTime;
            calendarDebug.logEventLoadingComplete(selectedCalendarId, allEvents.length, duration);
          })
          .catch((error) => {
            logger.error('Event loading failed:', error);
            calendarDebug.logError('loadEvents in useEffect', error, { selectedCalendarId });
          })
          .finally(() => {
            clearTimeout(timeoutId);
            calendarDebug.logStateChange('changingCalendar', true, false);
            setChangingCalendar(false);
          });
      }
      // Skipping event loading if requirements not met
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateRangeString, selectedCalendarId, graphToken, initializing, availableCalendars.length]);

    // Set user time zone from user permissions
    useEffect(() => {
    // Only set timezone from user permissions if we haven't set one yet
    // and if the user permissions actually have a timezone preference
    if (userPermissions.preferredTimeZone && 
        userPermissions.preferredTimeZone !== userTimezone &&
        !hasUserManuallyChangedTimezone.current) {
      // Setting initial timezone from userPermissions
      setUserTimezone(userPermissions.preferredTimeZone);
    }
  }, [userPermissions.preferredTimeZone, userTimezone]); 

    // Update selected locations when dynamic locations change - smart merging
    useEffect(() => {
      if (dynamicLocations.length > 0) {
        if (selectedLocations.length === 0) {
          // Initial selection: select all locations
          setSelectedLocations(dynamicLocations);
        } else {
          // Smart merging: add new locations to existing selection
          const newLocations = dynamicLocations.filter(loc => !selectedLocations.includes(loc));
          if (newLocations.length > 0) {
            setSelectedLocations(prev => [...prev, ...newLocations]);
          }
        }
      }
    }, [dynamicLocations]);

    // Update selected categories when dynamic categories change - smart merging
    useEffect(() => {
      if (dynamicCategories.length > 0) {
        if (selectedCategories.length === 0) {
          // Initial selection: select all categories
          setSelectedCategories(dynamicCategories);
          // Initial category selection: all categories
        } else {
          // Smart merging: add new categories to existing selection
          const newCategories = dynamicCategories.filter(cat => !selectedCategories.includes(cat));
          if (newCategories.length > 0) {
            setSelectedCategories(prev => [...prev, ...newCategories]);
            // Added new categories to selection
          } else {
            // No new categories to add
          }
        }
      }
    }, [dynamicCategories]);

    

    // Initialize filter for month view
    useEffect(() => {
      // Set default filter based on the groupBy setting
      if (groupBy === 'categories' && dynamicCategories.length > 0) {
        setSelectedFilter('Uncategorized');
      } else if (groupBy === 'locations') {
        setSelectedFilter('Unspecified');
      }
    }, [groupBy, dynamicCategories]);


    // Location debugging removed for performance

    useEffect(() => {
      const handleKeyPress = (e) => {
        // Press 'G' to focus the date picker (like Google Calendar)
        if (e.key === 'g' || e.key === 'G') {
          // Don't trigger if user is typing in an input, textarea, or contenteditable element
          const activeElement = document.activeElement;
          const isTyping = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.contentEditable === 'true'
          );
          
          if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTyping) {
            e.preventDefault();
            // Focus the date picker
            const datePicker = document.querySelector('.date-picker-input');
            if (datePicker) {
              datePicker.click();
            }
          }
        }
      };
    
      document.addEventListener('keydown', handleKeyPress);
      return () => document.removeEventListener('keydown', handleKeyPress);
    }, []);

    /*
    // Debugging
    useEffect(() => {
      if (isDemoMode && demoData) {
        debugDemoData();
      }
    }, [isDemoMode, demoData, dateRange, debugDemoData]);
    */

    //---------------------------------------------------------------------------
    // LOADING SCREEN
    //---------------------------------------------------------------------------
    const LoadingOverlay = () => {
      // Get loading status text
      const loadingText = (() => {
        if (loadingState.user) return "Loading user profile...";
        if (loadingState.categories) return "Loading categories...";
        if (loadingState.extensions) return "Loading extensions...";
        if (loadingState.events) return "Loading calendar events...";
        return "Loading your calendar...";
      })();
    
      return (
        <div className="loading-overlay">
          <div className="loading-content">
            <LoadingSpinner size={64} minHeight={100} />
            <p>{loadingText}</p>
          </div>
        </div>
      );
    };
    
    const locationGroups = useMemo(() => {
      if (groupBy === 'locations') {
        return getLocationGroups();
      }
      return {};
    }, [groupBy, getLocationGroups, generalLocations.length]);

    //---------------------------------------------------------------------------
    // RENDERING
    //---------------------------------------------------------------------------
    return (
      <div className="calendar-container">
        {(loading || initializing || locationsLoading) && <LoadingOverlay/>}
        
        {/* Calendar Header */}
        <CalendarHeader
          viewType={viewType}
          currentDate={currentDate}
          dateRange={dateRange}
          onViewChange={(newView) => {
            handleViewChange(newView);
            updateUserProfilePreferences({ defaultView: newView });
          }}
          onDateChange={handleDatePickerChange}
          onNavigate={(action) => {
            if (action === 'previous') handlePrevious();
            else if (action === 'next') handleNext();
            else if (action === 'today') handleToday();
          }}
          timezone={userTimezone}
          weekStart={userPermissions.startOfWeek}
          onTimezoneChange={(newTz) => {
            logger.debug('Timezone dropdown changed to:', newTz);
            hasUserManuallyChangedTimezone.current = true;
            setUserTimezone(newTz);
          }}
          onWeekStartChange={(e) => {
            const newValue = e.target.value;

            setUserPermissions(prev => ({
              ...prev,
              startOfWeek: newValue
            }));
            updateUserProfilePreferences({ startOfWeek: newValue });

            if (viewType === 'week') {
              const currentStartDate = new Date(dateRange.start);
              let newStart;

              if (newValue === 'Monday' && userPermissions.startOfWeek === 'Sunday') {
                newStart = new Date(currentStartDate);
                newStart.setDate(currentStartDate.getDate() + 1);
              }
              else if (newValue === 'Sunday' && userPermissions.startOfWeek === 'Monday') {
                newStart = new Date(currentStartDate);
                newStart.setDate(currentStartDate.getDate() - 1);
              }
              else {
                newStart = currentStartDate;
              }

              const newEnd = calculateEndDate(newStart, 'week');

              setDateRange({
                start: newStart,
                end: newEnd
              });
            }
          }}
          groupBy={groupBy}
          onGroupByChange={async (mode) => {
            setLoading(true);
            setGroupBy(mode);
            await updateUserProfilePreferences({ defaultGroupBy: mode });
            setLoading(false);
          }}
          selectedCalendarId={selectedCalendarId}
          availableCalendars={availableCalendars}
          onCalendarChange={setSelectedCalendarId}
          changingCalendar={changingCalendar}
          calendarAccessError={calendarAccessError}
          updateUserProfilePreferences={updateUserProfilePreferences}
        />

        {/* Mode Toggle with Action Buttons */}
        {renderModeToggle()}

        {/* MAIN LAYOUT CONTAINER */}
        <div className="calendar-layout-container">
          {/* Calendar Main Content */}
          <div className="calendar-main-content">
            {/* Calendar grid section */}
            <div className="calendar-grid-container">
                  {viewType === 'month' ? (
                    <div className="calendar-content-wrapper">
                      <div 
                        className="calendar-grid month-view"
                        style={{ 
                          transform: `scale(${zoomLevel / 100})`, 
                          transformOrigin: 'top left',
                          width: '100%',
                          flex: 1
                        }}
                      >
                        <MonthView
                          getMonthWeeks={getMonthWeeks}
                          getWeekdayHeaders={getWeekdayHeaders}
                          selectedFilter={selectedFilter}
                          handleDayCellClick={handleDayCellClick}
                          handleEventClick={handleEventClick}
                          getEventContentStyle={getEventContentStyle}
                          formatEventTime={formatEventTime}
                          getCategoryColor={getCategoryColor}
                          getLocationColor={getLocationColor}
                          groupBy={groupBy}
                          filteredEvents={filteredEvents}
                          outlookCategories={outlookCategories}
                          availableLocations={getDatabaseLocationNames()}
                          dynamicLocations={dynamicLocations}
                          getFilteredMonthEvents={getFilteredMonthEvents}
                          getMonthDayEventPosition={getMonthDayEventPosition}
                          allEvents={allEvents}
                          handleMonthFilterChange={handleMonthFilterChange}
                          selectedCategories={selectedCategories}
                          selectedLocations={selectedLocations}
                          setSelectedCategories={setSelectedCategories}
                          setSelectedLocations={setSelectedLocations}
                          updateUserProfilePreferences={updateUserProfilePreferences}
                          dynamicCategories={dynamicCategories}
                          isEventVirtual={isEventVirtual}
                          isUnspecifiedLocation={isUnspecifiedLocation}
                          hasPhysicalLocation={hasPhysicalLocation}
                          isVirtualLocation={isVirtualLocation}
                          showRegistrationTimes={showRegistrationTimes}
                          onRequestEdit={handleRequestEdit}
                        />
                      </div>
                    </div>
                  ) : (
                    <div 
                      className={`calendar-grid ${viewType}-view`}
                      style={{ 
                        transform: `scale(${zoomLevel / 100})`, 
                        transformOrigin: 'top left',
                        width: '100%'
                      }}
                    >
                      {viewType === 'week' ? (
                        <WeekView
                          groupBy={groupBy}
                          outlookCategories={outlookCategories}
                          selectedCategories={selectedCategories}
                          availableLocations={getDatabaseLocationNames()}
                          dynamicLocations={dynamicLocations}
                          selectedLocations={selectedLocations}
                          getDaysInRange={getDaysInRange}
                          formatDateHeader={formatDateHeader}
                          getEventPosition={getEventPosition}
                          filteredEvents={filteredEvents}
                          locationGroups={locationGroups}
                          getCategoryColor={getCategoryColor}
                          getLocationColor={getLocationColor}
                          handleDayCellClick={handleDayCellClick}
                          handleEventClick={handleEventClick}
                          renderEventContent={renderEventContent}
                          viewType={viewType}
                          dynamicCategories={dynamicCategories}
                          isEventVirtual={isEventVirtual}
                          isUnspecifiedLocation={isUnspecifiedLocation}
                          hasPhysicalLocation={hasPhysicalLocation}
                          isVirtualLocation={isVirtualLocation}
                          setSelectedCategories={setSelectedCategories}
                          setSelectedLocations={setSelectedLocations}
                          updateUserProfilePreferences={updateUserProfilePreferences}
                          showRegistrationTimes={showRegistrationTimes}
                          handleLocationRowClick={handleLocationRowClick}
                        />
                      ) : (
                        <DayView
                          groupBy={groupBy}
                          outlookCategories={outlookCategories}
                          selectedCategories={selectedCategories}
                          availableLocations={getDatabaseLocationNames()}
                          dynamicLocations={dynamicLocations}
                          selectedLocations={selectedLocations}
                          formatDateHeader={formatDateHeader}
                          getEventPosition={getEventPosition}
                          filteredEvents={filteredEvents}
                          locationGroups={locationGroups}
                          getCategoryColor={getCategoryColor}
                          getLocationColor={getLocationColor}
                          handleDayCellClick={handleDayCellClick}
                          handleEventClick={handleEventClick}
                          renderEventContent={renderEventContent}
                          viewType={viewType}
                          dynamicCategories={dynamicCategories}
                          dateRange={dateRange}
                          isEventVirtual={isEventVirtual}
                          isUnspecifiedLocation={isUnspecifiedLocation}
                          hasPhysicalLocation={hasPhysicalLocation}
                          isVirtualLocation={isVirtualLocation}
                          setSelectedCategories={setSelectedCategories}
                          setSelectedLocations={setSelectedLocations}
                          updateUserProfilePreferences={updateUserProfilePreferences}
                          showRegistrationTimes={showRegistrationTimes}
                          handleLocationRowClick={handleLocationRowClick}
                        />
                      )}
                    </div>
                  )}
            </div>
          </div>

          {/* SIDEBAR - Always present for layout stability */}
          {viewType !== 'month' ? (
            <div className="calendar-right-sidebar">
              {(loading || initializing) ? (
                /* Placeholder content during loading */
                <div className="sidebar-loading-placeholder">
                  <div className="loading-placeholder-section">
                    <div className="loading-placeholder-title">Categories</div>
                    <div className="loading-placeholder-content"></div>
                  </div>
                  <div className="loading-placeholder-section">
                    <div className="loading-placeholder-title">Locations</div>
                    <div className="loading-placeholder-content"></div>
                  </div>
                  <div className="loading-placeholder-section">
                    <div className="loading-placeholder-title">Filters</div>
                    <div className="loading-placeholder-content"></div>
                  </div>
                </div>
              ) : (
                /* Actual sidebar content */
                <>
                  {/* FILTERS CONTAINER */}
                  <div className="filters-container">
                    {/* CATEGORIES FILTER SECTION */}
                    <div className="filter-section">
                      <h3 className="filter-title">Categories</h3>
                      <MultiSelect 
                            options={dynamicCategories}
                            selected={selectedCategories}
                            onChange={val => {
                              setSelectedCategories(val);
                              updateUserProfilePreferences({ selectedCategories: val });
                            }}
                            label="categories"
                            maxHeight={200}
                          />
                        </div>

                        {/* LOCATIONS FILTER SECTION */}
                        <div className="filter-section">
                          <h3 className="filter-title">Locations</h3>
                          <MultiSelect 
                            options={dynamicLocations}
                            selected={selectedLocations}
                            onChange={val => {
                              setSelectedLocations(val);
                              updateUserProfilePreferences({ selectedLocations: val });
                            }}
                            label="locations"
                            maxHeight={200}
                          />
                        </div>
                      </div>

                      {/* FILTER STATUS SECTION */}
                      <div className="filter-status">
                        <div className="status-title">Active Filters:</div>
                        <div className="status-info">Categories ({selectedCategories?.length || 0}), Locations ({selectedLocations?.length || 0})</div>
                        <div className="status-events">Events: {filteredEvents?.length || 0} visible / {allEvents?.length || 0} total</div>
                      </div>

                      {/* GROUPING INFO SECTION */}
                      <div className="grouping-info">
                        <h4 className="grouping-title">Current Grouping</h4>
                        <p className="grouping-description">
                          Events are visually grouped by <strong>{groupBy === 'categories' ? 'Categories' : 'Locations'}</strong>.
                          Use the buttons above to change grouping.
                        </p>
                      </div>
                </>
              )}
            </div>
          ) : (
            /* Month view - no sidebar, but add a placeholder to maintain consistent spacing */
            <div className="calendar-sidebar-spacer"></div>
          )}
        </div>

        {/* Modal for Add/Edit Event */}
        <Modal 
          isOpen={isModalOpen && (modalType === 'add' || modalType === 'edit' || modalType === 'view')} 
          onClose={() => setIsModalOpen(false)}
          title={
            modalType === 'add' ? `Add Event - ${getTargetCalendarName()}` : 
            modalType === 'edit' ? `Edit Event - ${getTargetCalendarName()}` : 
            `View Event - ${getTargetCalendarName()}`
          }
          hideTitle={false}
        >
          <EventForm
            event={currentEvent}
            categories={(() => {
              const targetCalendarId = getTargetCalendarId();
              const calendarSpecificCategories = getCalendarSpecificCategories(targetCalendarId);
              return calendarSpecificCategories;
            })()}
            availableLocations={getFilteredLocationsForMultiSelect()}
            dynamicLocations={dynamicLocations}
            schemaExtensions={schemaExtensions}
            onSave={handleSaveEvent}
            onCancel={() => setIsModalOpen(false)}
            onDelete={effectivePermissions.deleteEvents ? handleDeleteEvent : null}
            onReview={handleReviewClick}
            readOnly={modalType === 'view'}
            userTimeZone={userTimezone}
            savingEvent={savingEvent}
            apiToken={apiToken}
          />
        </Modal>

        {/* Modal for Delete Confirmation */}
        <Modal
          isOpen={isModalOpen && modalType === 'delete'}
          onClose={() => setIsModalOpen(false)}
          hideTitle={true}
        >
          <div className="delete-confirmation" style={{
            padding: '24px',
            textAlign: 'center'
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '500',
              color: '#202124',
              marginBottom: '16px',
              margin: '0 0 16px 0'
            }}>
              Delete Event
            </h2>
            <p style={{
              fontSize: '14px',
              color: '#5f6368',
              marginBottom: '24px',
              lineHeight: '1.5'
            }}>
              Are you sure you want to delete "{currentEvent?.subject}"?<br />
              This action cannot be undone.
            </p>
            <div className="form-actions" style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '12px',
              marginTop: '24px'
            }}>
              <button 
                className="cancel-button" 
                onClick={() => setIsModalOpen(false)}
                style={{
                  padding: '10px 24px',
                  background: '#f8f9fa',
                  color: '#5f6368',
                  border: '1px solid #dadce0',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button 
                className="delete-button" 
                onClick={handleDeleteConfirm}
                style={{
                  padding: '10px 24px',
                  background: '#ea4335',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
        
        {showSearch && (
          <EventSearch
            graphToken={graphToken}
            apiToken={apiToken}
            onEventSelect={handleEventSelect}
            onViewInCalendar={handleViewInCalendar}
            onClose={() => setShowSearch(false)}
            outlookCategories={outlookCategories}
            availableLocations={getDatabaseLocationNames()}
            dynamicLocations={dynamicLocations}
            onSaveEvent={handleSaveEvent}
            selectedCalendarId={selectedCalendarId}
            availableCalendars={availableCalendars}
          />
        )}

        {/* Timeline Modals for Location Views */}
        {timelineModal.viewType === 'week' && (
          <WeekTimelineModal
            isOpen={timelineModal.isOpen}
            onClose={() => setTimelineModal(prev => ({ ...prev, isOpen: false }))}
            locationName={timelineModal.locationName}
            locationId={timelineModal.locationId}
            dateRange={timelineModal.dateRange}
            events={timelineModal.events}
            calendarName={availableCalendars.find(cal => cal.id === selectedCalendarId)?.name || ''}
            generalLocations={generalLocations}
          />
        )}

        {timelineModal.viewType === 'day' && (
          <DayTimelineModal
            isOpen={timelineModal.isOpen}
            onClose={() => setTimelineModal(prev => ({ ...prev, isOpen: false }))}
            location={(() => {
              // Find the full location object by locationId if available
              if (timelineModal.locationId) {
                const fullLocation = generalLocations.find(loc =>
                  loc._id && loc._id.toString() === timelineModal.locationId
                );
                return fullLocation || { name: timelineModal.locationName };
              }
              return { name: timelineModal.locationName };
            })()}
            date={timelineModal.dateRange[0]}
            events={timelineModal.events}
            calendarName={availableCalendars.find(cal => cal.id === selectedCalendarId)?.name || ''}
          />
        )}

        {/* Recurring Event Scope Selection Dialog */}
        <RecurringScopeDialog
          isOpen={recurringScopeDialog.isOpen}
          onClose={handleRecurringScopeClose}
          onSelectScope={handleRecurringScopeSelected}
          eventSubject={recurringScopeDialog.pendingEvent?.subject || recurringScopeDialog.pendingEvent?.eventTitle || 'Recurring Event'}
          eventDate={recurringScopeDialog.pendingEvent?.start?.dateTime
            ? new Date(recurringScopeDialog.pendingEvent.start.dateTime).toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })
            : ''
          }
        />

        {/* Review Modal for Room Reservations and Event Review */}
        <ReviewModal
          isOpen={reviewModal.isOpen}
          title={`${reviewModal.currentItem?.status === 'pending' ? 'Review' : 'Edit'} ${reviewModal.editableData?.eventTitle || 'Event'}`}
          onClose={reviewModal.closeModal}
          onApprove={reviewModal.handleApprove}
          onReject={reviewModal.handleReject}
          onSave={reviewModal.handleSave}
          onDelete={reviewModal.handleDelete}
          mode={reviewModal.currentItem?.status === 'pending' ? 'review' : 'edit'}
          isPending={reviewModal.currentItem?.status === 'pending'}
          isFormValid={reviewModal.isFormValid}
          isSaving={reviewModal.isSaving}
          isDeleting={reviewModal.isDeleting}
          isApproving={reviewModal.isApproving}
          isNavigating={reviewModalIsNavigating}
          showActionButtons={true}
          isAdmin={effectivePermissions.isAdmin}
          isRequesterOnly={!canEditEvents && !canApproveReservations}
          itemStatus={reviewModal.currentItem?.status}
          deleteButtonText={
            reviewModal.pendingDeleteConfirmation
              ? '⚠️ Confirm Delete?'
              : null
          }
          isDeleteConfirming={reviewModal.pendingDeleteConfirmation}
          onCancelDelete={reviewModal.cancelDeleteConfirmation}
          isApproveConfirming={reviewModal.pendingApproveConfirmation}
          approveButtonText={getApproveConfirmationText()}
          onCancelApprove={reviewModal.cancelApproveConfirmation}
          isRejectConfirming={reviewModal.pendingRejectConfirmation}
          onCancelReject={reviewModal.cancelRejectConfirmation}
          isSaveConfirming={reviewModal.pendingSaveConfirmation}
          onCancelSave={reviewModal.cancelSaveConfirmation}
          onRequestEdit={handleRequestEdit}
          canRequestEdit={effectivePermissions.submitReservation && !isEditRequestMode && !isViewingEditRequest}
          // Existing edit request props (for viewing pending edit requests)
          existingEditRequest={existingEditRequest}
          isViewingEditRequest={isViewingEditRequest}
          loadingEditRequest={loadingEditRequest}
          onViewEditRequest={handleViewEditRequest}
          onViewOriginalEvent={handleViewOriginalEvent}
          // Edit request mode props (for creating new edit requests)
          isEditRequestMode={isEditRequestMode}
          editRequestChangeReason={editRequestChangeReason}
          onEditRequestChangeReasonChange={setEditRequestChangeReason}
          onSubmitEditRequest={handleSubmitEditRequest}
          onCancelEditRequest={handleCancelEditRequest}
          isSubmittingEditRequest={isSubmittingEditRequest}
          isEditRequestConfirming={pendingEditRequestConfirmation}
          onCancelEditRequestConfirm={cancelEditRequestConfirmation}
          originalData={originalEventData}
          detectedChanges={computeDetectedChanges()}
          hasChanges={isEditRequestMode ? computeDetectedChanges().length > 0 : reviewModal.hasChanges}
          // Edit request approval/rejection props (for admins)
          onApproveEditRequest={canApproveReservations ? handleApproveEditRequest : null}
          onRejectEditRequest={canApproveReservations ? handleRejectEditRequest : null}
          isApprovingEditRequest={isApprovingEditRequest}
          isRejectingEditRequest={isRejectingEditRequest}
          editRequestRejectionReason={editRequestRejectionReason}
          onEditRequestRejectionReasonChange={setEditRequestRejectionReason}
          isEditRequestApproveConfirming={isEditRequestApproveConfirming}
          isEditRequestRejectConfirming={isEditRequestRejectConfirming}
          onCancelEditRequestApprove={cancelEditRequestApproveConfirmation}
          onCancelEditRequestReject={cancelEditRequestRejectConfirmation}
          // Edit request cancellation props (for requesters)
          onCancelPendingEditRequest={handleCancelPendingEditRequest}
          isCancelingEditRequest={isCancelingEditRequest}
          isCancelEditRequestConfirming={isCancelEditRequestConfirming}
          onCancelCancelEditRequest={cancelCancelEditRequestConfirmation}
        >
          {reviewModal.currentItem && (
            <RoomReservationReview
              reservation={reviewModal.editableData}
              prefetchedAvailability={reviewModal.prefetchedAvailability}
              apiToken={apiToken}
              graphToken={graphToken}
              onDataChange={reviewModal.updateData}
              onFormDataReady={reviewModal.setFormDataGetter}
              onIsNavigatingChange={setReviewModalIsNavigating}
              onNavigateToSeriesEvent={handleNavigateToSeriesEvent}
              onFormValidChange={reviewModal.setIsFormValid}
              readOnly={!canEditEvents && !canApproveReservations && !isEditRequestMode}
              isAdmin={effectivePermissions.isAdmin}
              editScope={reviewModal.editScope}
            />
          )}
        </ReviewModal>

        {/* Review Modal for Event Creation */}
        <ReviewModal
          isOpen={eventReviewModal.isOpen}
          title={eventReviewModal.mode === 'create'
            ? `Request Event - ${getTargetCalendarName()}`
            : (eventReviewModal.event?.id ? `Edit Event - ${getTargetCalendarName()}` : `Add Event - ${getTargetCalendarName()}`)}
          onClose={handleEventReviewModalClose}
          onSave={handleEventReviewModalSave}
          onDelete={eventReviewModal.mode === 'event' && (eventReviewModal.event?.id || eventReviewModal.event?.eventId) ? handleEventReviewModalDelete : null}
          mode={eventReviewModal.mode === 'create' ? 'create' : 'edit'}
          isPending={false}
          hasChanges={eventReviewModal.hasChanges}
          isFormValid={eventReviewModal.isFormValid}
          isSaving={savingEvent}
          isNavigating={eventReviewModal.isNavigating}
          showActionButtons={true}
          showTabs={true}
          isAdmin={effectivePermissions.isAdmin}
          saveButtonText={
            pendingMultiDayConfirmation
              ? (eventReviewModal.event?.eventId || eventReviewModal.event?.id
                  ? `⚠️ Confirm Adding (${pendingMultiDayConfirmation.eventCount}) Events to Series`
                  : `⚠️ Confirm Creating (${pendingMultiDayConfirmation.eventCount}) Events`)
              : pendingSaveConfirmation
                ? getSaveConfirmationText()
                : (!eventReviewModal.event?.id && effectivePermissions.isAdmin
                  ? '✨ Create'
                  : null)
          }
          deleteButtonText={
            pendingEventDeleteConfirmation
              ? '⚠️ Confirm Delete?'
              : null
          }
          isDeleteConfirming={pendingEventDeleteConfirmation}
          onCancelDelete={() => setPendingEventDeleteConfirmation(false)}
          isSaveConfirming={pendingSaveConfirmation}
          onCancelSave={() => setPendingSaveConfirmation(false)}
          // Draft-related props - show for new event creation (not editing existing events)
          onSaveDraft={!(eventReviewModal.event?.id || eventReviewModal.event?.eventId) ? handleSaveDraft : null}
          savingDraft={savingDraft}
          showDraftDialog={showDraftSaveDialog}
          onDraftDialogSave={handleDraftDialogSave}
          onDraftDialogDiscard={handleDraftDialogDiscard}
          onDraftDialogCancel={handleDraftDialogCancel}
          canSaveDraft={canSaveDraft()}
        >
          {eventReviewModal.isOpen && eventReviewModal.event && (
            <RoomReservationReview
              reservation={eventReviewModal.event}
              apiToken={apiToken}
              graphToken={graphToken}
              onDataChange={(updatedData) => {
                setEventReviewModal(prev => ({
                  ...prev,
                  event: {
                    ...prev.event,  // Preserve original fields like calendarId, calendarName
                    ...updatedData  // Merge in updated form data
                  },
                  hasChanges: true
                }));
                // Reset multi-day confirmation when form data changes
                if (pendingMultiDayConfirmation) {
                  setPendingMultiDayConfirmation(null);
                }
                // Reset delete confirmation when form data changes
                if (pendingEventDeleteConfirmation) {
                  setPendingEventDeleteConfirmation(false);
                }
                // Reset save confirmation when form data changes
                if (pendingSaveConfirmation) {
                  setPendingSaveConfirmation(false);
                }
              }}
              onIsNavigatingChange={handleEventReviewIsNavigatingChange}
              onNavigateToSeriesEvent={handleNavigateToSeriesEvent}
              onFormValidChange={handleEventReviewFormValidChange}
              readOnly={false}
              isAdmin={effectivePermissions.isAdmin}
            />
          )}
        </ReviewModal>
      </div>
    );
  }

  export default Calendar;