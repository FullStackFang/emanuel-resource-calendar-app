  // src/components/Calendar.jsx
  import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
  import { useSearchParams } from 'react-router-dom';
  import { apiRequest } from '../config/authConfig';
  import { useMsal } from '@azure/msal-react';
  import { useAuth } from '../context/AuthContext';
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
  import { transformEventToFlatStructure, sortEventsByStartTime, getEventField } from '../utils/eventTransformers';
  import { computeApproverChanges, buildEditRequestViewData, computeDetectedChanges as computeDetectedChangesUtil } from '../utils/editRequestUtils';
  import { buildInternalFields } from '../utils/eventPayloadBuilder';
  import './Calendar.css';
  import APP_CONFIG from '../config/config';
  import eventDataService from '../services/eventDataService';
  import unifiedEventService from '../services/unifiedEventService';
  import DatePicker from 'react-datepicker';
  import "react-datepicker/dist/react-datepicker.css";
  import calendarDataService from '../services/calendarDataService';
  import { useReviewModal } from '../hooks/useReviewModal';
  import { useEventCreation } from '../hooks/useEventCreation';
  import ReviewModal from './shared/ReviewModal';
  import RecurringScopeDialog from './shared/RecurringScopeDialog';
import ConflictDialog from './shared/ConflictDialog';
  import LoadingSpinner from './shared/LoadingSpinner';
  import RoomReservationReview from './RoomReservationReview';
  import {
    setApiToken as setGraphServiceApiToken,
    createLinkedEvents,
    findLinkedEvent,
    updateLinkedEvent,
    deleteLinkedEvent
  } from '../services/graphService';
  import { usePolling } from '../hooks/usePolling';
  import { dispatchRefresh, useDataRefreshBus } from '../hooks/useDataRefreshBus';
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
    // AUTH — wire unifiedEventService to always use freshest token + 401 retry
    //---------------------------------------------------------------------------
    const { instance } = useMsal();
    const { getApiToken, setApiToken: setAuthApiToken } = useAuth();

    useEffect(() => {
      // Token-getter: service reads fresh token from AuthContext ref on every request
      unifiedEventService.setTokenGetter(getApiToken);

      // 401 retry handler: refresh via MSAL and return fresh token
      unifiedEventService.setOnTokenExpired(async () => {
        const accounts = instance.getAllAccounts();
        if (accounts.length === 0) return null;
        try {
          const response = await instance.acquireTokenSilent({
            ...apiRequest,
            account: accounts[0],
            forceRefresh: true
          });
          setAuthApiToken(response.accessToken);
          return response.accessToken;
        } catch {
          return null;
        }
      });
    }, [instance, getApiToken, setAuthApiToken]);

    //---------------------------------------------------------------------------
    // STATE MANAGEMENT
    //---------------------------------------------------------------------------
    // Loading state
    const initializationStarted = useRef(false);
    // (initialLoadComplete and lastLoadedDateRange refs removed — consolidated effect handles first load)

    // Navigation loading state - shows overlay during calendar navigation
    const [isNavigating, setIsNavigating] = useState(false);
    const navigationStartTimeRef = useRef(0);
    const MIN_NAVIGATION_DISPLAY_MS = 500; // Minimum time to show spinner overlay (covers API + render time)

    // Helper to clear navigation state with minimum display time
    const clearNavigationState = useCallback(() => {
      const elapsed = Date.now() - navigationStartTimeRef.current;
      const remaining = MIN_NAVIGATION_DISPLAY_MS - elapsed;
      if (remaining > 0) {
        setTimeout(() => setIsNavigating(false), remaining);
      } else {
        setIsNavigating(false);
      }
    }, []);

    // Helper to start navigation with timestamp tracking
    const startNavigation = useCallback(() => {
      navigationStartTimeRef.current = Date.now();
      setIsNavigating(true);
    }, []);

    // Demo variables
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [demoData, setDemoData] = useState(null);
    const [isUploadingDemo, setIsUploadingDemo] = useState(false);
    const [confirmModeSwitch, setConfirmModeSwitch] = useState(false);

    const [initializing, setInitializing] = useState(true);
    const [loading, setLoading] = useState(false);
    const [savingEvent, setSavingEvent] = useState(false);
    const [lastFetchedAt, setLastFetchedAt] = useState(null);
    const [isManualRefreshing, setIsManualRefreshing] = useState(false);

    // Calendar access error (when user has no access to any allowed calendars)
    const [calendarAccessError, setCalendarAccessError] = useState(null);

    // Core calendar data
    const [allEvents, setAllEventsState] = useState([]);
    // Ref to always have access to current allEvents in callbacks (prevents stale closure)
    const allEventsRef = useRef(allEvents);
    // Deep-link support: auto-open event from email link (?eventId=...)
    const [searchParams, setSearchParams] = useSearchParams();
    const deepLinkProcessedRef = useRef(false);
    const [showSearch, setShowSearch] = useState(false);
    const [schemaExtensions, setSchemaExtensions] = useState([]);

    // Use TanStack Query for categories - provides automatic caching and background refresh
    const queryClient = useQueryClient();
    const { data: baseCategories = [], isLoading: baseCategoriesLoading } = useBaseCategoriesQuery(apiToken);
    const { data: outlookCategories = [], isLoading: outlookCategoriesLoading } = useOutlookCategoriesQuery(apiToken, APP_CONFIG.DEFAULT_DISPLAY_CALENDAR);

    // Combined categories loading state
    const categoriesLoading = baseCategoriesLoading || outlookCategoriesLoading;

    // Track last summary time to prevent duplicate summaries
    const lastSummaryTimeRef = useRef(0);

    // Memoization cache for recurring event expansion (prevents redundant calculations)
    const expansionCacheRef = useRef(new Map());
    const loadInProgressRef = useRef(false);
    const categoriesInitializedRef = useRef(false);
    const locationsInitializedRef = useRef(false);
    const MAX_EXPANSION_CACHE_SIZE = 5; // Keep last 5 expansions

    // Safe wrapper for setAllEvents to prevent accidentally clearing events.
    // Uses functional updater for the warn check so this callback has NO state dependencies
    // and maintains a stable identity (avoids re-creation cascade through loadEventsUnified).
    const setAllEvents = useCallback((newEvents) => {
      if (!Array.isArray(newEvents)) {
        logger.error('setAllEvents: Invalid input - not an array', { type: typeof newEvents });
        return;
      }

      // Throttled summary logging (only when debug is enabled, avoids O(N) work in production)
      if (logger.isDebugEnabled?.()) {
        const now = Date.now();
        const timeSinceLastSummary = now - lastSummaryTimeRef.current;
        if (newEvents.length > 0 && timeSinceLastSummary > 2000) {
          lastSummaryTimeRef.current = now;
          const categoryCounts = {};
          const locationCounts = {};
          newEvents.forEach(event => {
            const cats = (event.isRecurringOccurrence && event.hasOccurrenceOverride && event.categories !== undefined)
              ? event.categories
              : (event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']));
            const primaryCategory = (cats && cats[0]) || 'Uncategorized';
            const location = event.location?.displayName || 'Unspecified';
            categoryCounts[primaryCategory] = (categoryCounts[primaryCategory] || 0) + 1;
            locationCounts[location] = (locationCounts[location] || 0) + 1;
          });
          logger.debug(`Events loaded: ${newEvents.length} (${Object.keys(categoryCounts).length} categories, ${Object.keys(locationCounts).length} locations)`);
        }
      }

      // Use functional updater so we can warn without depending on allEvents state
      setAllEventsState(prev => {
        if (newEvents.length === 0 && prev.length > 0) {
          logger.warn('setAllEvents: Clearing all events (was ' + prev.length + ' events)');
        }
        return newEvents;
      });
    }, []); // stable — no state dependencies

    // Update ref whenever allEvents changes to prevent stale closures in callbacks
    useEffect(() => {
      allEventsRef.current = allEvents;
    }, [allEvents]);

    // UI state - defaults match userPermissions defaults until preferences load
    const [groupBy, setGroupBy] = useState('categories');
    const [viewType, setViewType] = useState('week');
    const [zoomLevel, setZoomLevel] = useState(100);
    const [selectedFilter, setSelectedFilter] = useState(''); 
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [selectedLocations, setSelectedLocations] = useState([]);
    const [favoriteCategories, setFavoriteCategories] = useState([]);
    const [favoriteLocations, setFavoriteLocations] = useState([]);
    const [hideEmptyGroups, setHideEmptyGroups] = useState(false);
    const [selectedMonthDay, setSelectedMonthDay] = useState(null);

    const [currentDate, setCurrentDate] = useState(new Date());

    
    // Registration times toggle state
    const [showRegistrationTimes, setShowRegistrationTimes] = useState(showRegistrationTimesProp || false);

    // Profile states
    const { userTimezone, setUserTimezone } = useTimezone();
    const { rooms } = useRooms();
    const { generalLocations, loading: locationsLoading } = useLocations();
    const { showSuccess, showWarning, showError } = useNotification();
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
      isSimulating,
      simulatedRole,
      isActualAdmin,
      department: userDepartment
    } = usePermissions();

    // Timezone context initialized

    const [userPermissions, setUserPermissions] = useState({
      startOfWeek: 'Monday',
      defaultView: 'week',
      defaultGroupBy: 'categories',
      preferredZoomLevel: 100,
      preferredTimeZone: 'America/New_York',
    });

    // User permissions initialized

    // Effective permissions: always use usePermissions() hook (handles both real roles and simulation)
    const effectivePermissions = useMemo(() => ({
      startOfWeek: userPermissions.startOfWeek,
      defaultView: userPermissions.defaultView,
      defaultGroupBy: userPermissions.defaultGroupBy,
      preferredZoomLevel: userPermissions.preferredZoomLevel,
      preferredTimeZone: userPermissions.preferredTimeZone,
      createEvents: canCreateEvents,
      editEvents: canEditEvents,
      deleteEvents: canDeleteEvents,
      submitReservation: canSubmitReservation,
      isAdmin: isSimulatedAdmin,
    }), [userPermissions, canCreateEvents, canEditEvents, canDeleteEvents, canSubmitReservation, isSimulatedAdmin]);

    // Whether the current user/simulated-role can add events (used by all calendar views)
    const canAddEvent = effectivePermissions.createEvents || effectivePermissions.submitReservation;

    // Calculate date range based on current view and user preferences
    const dateRange = useMemo(() => {
      let start = new Date(currentDate);
      let end;

      if (viewType === 'week') {
        start = snapToStartOfWeek(currentDate, userPermissions.startOfWeek);
        end = calculateEndDate(start, 'week');
      } else if (viewType === 'month') {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        const lastOfMonth = new Date(year, month + 1, 0);

        // Calculate first visible day (mirrors getMonthWeeks overflow logic)
        const firstDayOfWeek = firstOfMonth.getDay();
        const startOfWeekIndex = userPermissions.startOfWeek === 'Sunday' ? 0 : 1;
        let prevMonthDays;
        if (startOfWeekIndex === 0) {
          prevMonthDays = firstDayOfWeek;
        } else {
          prevMonthDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
        }
        start = new Date(year, month, 1 - prevMonthDays);

        // Calculate last visible day
        const totalDaysInGrid = prevMonthDays + lastOfMonth.getDate();
        const nextMonthDays = Math.ceil(totalDaysInGrid / 7) * 7 - totalDaysInGrid;
        end = new Date(year, month + 1, nextMonthDays);
        end.setHours(23, 59, 59, 999);
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

    // Edit request mode state (for inline editing to create edit requests)
    const [isEditRequestMode, setIsEditRequestMode] = useState(false);
    const [originalEventData, setOriginalEventData] = useState(null);
    // Transform originalEventData to flat structure for inline diff comparison
    // (originalEventData is raw/nested, but formData in RoomReservationFormBase is flat)
    const flatOriginalEventData = useMemo(() =>
      originalEventData ? transformEventToFlatStructure(originalEventData) : null,
    [originalEventData]);
    // Existing edit request state (for viewing pending edit requests)
    const [existingEditRequest, setExistingEditRequest] = useState(null);
    const [isViewingEditRequest, setIsViewingEditRequest] = useState(false);
    const [loadingEditRequest, setLoadingEditRequest] = useState(false);
    // Edit request approval/rejection state (for admins)
    // Cancel edit request state (for requesters)
    const [isCancelingEditRequest, setIsCancelingEditRequest] = useState(false);
    const [isCancelEditRequestConfirming, setIsCancelEditRequestConfirming] = useState(false);

    // Cancellation request state
    const [isCancellationRequestMode, setIsCancellationRequestMode] = useState(false);
    const [cancellationReason, setCancellationReason] = useState('');
    const [isSubmittingCancellationRequest, setIsSubmittingCancellationRequest] = useState(false);

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

    // Department colleague edit state (for non-admin users editing pending/rejected events)
    const [isResubmitting, setIsResubmitting] = useState(false);
    // Ref to loadEvents (defined later) so handlers declared before it can call it
    const loadEventsRef = useRef(null);

    // Recurring event scope dialog state
    const [recurringScopeDialog, setRecurringScopeDialog] = useState({
      isOpen: false,
      pendingEvent: null,
      mode: 'edit',
      isLoading: false
    });

    // Review modal hook for handling review functionality
    const reviewModal = useReviewModal({
      apiToken,
      graphToken,
      selectedCalendarId, // Pass current calendar so published events go to correct calendar
      onSuccess: (result) => {
        // Reload events after successful approval/rejection
        loadEvents(true);
        // Reset edit request mode
        setIsEditRequestMode(false);
        setOriginalEventData(null);

        // Show success/warning toast based on action type
        if (result?.conflictDowngradedToPending) {
          const rc = result.recurringConflicts;
          showWarning(`Recurring event sent to pending: ${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrence(s) have scheduling conflicts. An admin must review before publishing.`);
        } else if (result?.restored) {
          showSuccess('Event restored');
        } else if (result?.deleted) {
          showSuccess('Event deleted');
        } else if (result?.occurrenceExcluded) {
          showSuccess('Occurrence excluded from series');
        } else if (result?.savedAsDraft) {
          showSuccess('Draft saved');
        } else if (result?.draftSubmitted) {
          showSuccess(result.autoPublished ? 'Event created and published' : 'Request submitted for approval');
        } else if (result?.ownerEdit) {
          showSuccess('Changes saved');
        } else if (result?.editRequestSubmitted) {
          showSuccess('Edit request submitted for review');
        } else if (result?.editRequestApproved) {
          showSuccess('Edit request approved and published');
        } else if (result?.editRequestRejected) {
          showSuccess('Edit request rejected');
        } else if (result?.duplicated) {
          if (result.failCount > 0) {
            showWarning(`${result.count} of ${result.count + result.failCount} duplicate(s) created — some failed`);
          } else if (result.count === 1 && result.dates?.[0]) {
            const label = new Date(result.dates[0] + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            showSuccess(result.autoPublished
              ? `Event duplicated to ${label}`
              : `Duplicate request for ${label} submitted for approval`);
          } else {
            showSuccess(result.autoPublished
              ? `Event duplicated to ${result.count} dates`
              : `${result.count} duplicate requests submitted for approval`);
          }
        } else if (result?.event?.status === 'published') {
          showSuccess('Event published');
          if (result?.recurringConflicts?.conflictingOccurrences > 0) {
            const rc = result.recurringConflicts;
            showWarning(`${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrences have room conflicts.`);
          }
        } else if (result?.event?.status === 'rejected') {
          showSuccess('Event rejected');
        } else {
          showSuccess('Changes saved');
        }
      },
      onError: (error) => {
        logger.error('Review modal error:', error);
        showError(error, { context: 'Calendar.reviewModal' });
      }
    });

    // Deep-link: auto-open event from email link (?eventId=...)
    // Reads from URL param first, then falls back to sessionStorage.
    // sessionStorage is populated in main.jsx before MSAL init, so the eventId
    // survives even if MSAL's redirect flow strips the query param.
    useEffect(() => {
      if (deepLinkProcessedRef.current || !apiToken) return;

      // Try URL param first, then sessionStorage fallback
      const eventId = searchParams.get('eventId')
        || sessionStorage.getItem('deepLinkEventId');
      if (!eventId) return;

      deepLinkProcessedRef.current = true;
      setSearchParams({}, { replace: true });
      sessionStorage.removeItem('deepLinkEventId');

      // Check if event is already loaded in calendar
      const localEvent = allEventsRef.current.find(e => String(e._id) === eventId);
      if (localEvent) {
        reviewModal.openModal(localEvent);
        return;
      }

      // Fetch from API (event may be outside current date range)
      (async () => {
        try {
          const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${eventId}`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
          });
          if (response.status === 404) {
            showError('The requested event was not found.');
            return;
          }
          if (response.status === 403) {
            showError('You do not have permission to view this event.');
            return;
          }
          if (!response.ok) throw new Error('Failed to fetch event');
          const data = await response.json();
          await reviewModal.openModal(data.event);
        } catch (err) {
          showError('Could not open the requested event.');
        }
      })();
    }, [searchParams, apiToken]); // eslint-disable-line react-hooks/exhaustive-deps

    // Shared creation hook — handles admin publish, requester submit, and draft save
    const eventCreation = useEventCreation({
      apiToken,
      selectedCalendarId,
      availableCalendars,
      onSuccess: () => loadEvents(true),
      refreshSource: 'calendar-creation',
    });

    // Reset edit request mode and cancellation request mode when review modal closes
    useEffect(() => {
      if (!reviewModal.isOpen) {
        if (isEditRequestMode) {
          setIsEditRequestMode(false);
          setOriginalEventData(null);
        }
        if (isCancellationRequestMode) {
          setIsCancellationRequestMode(false);
          setCancellationReason('');
        }
      }
    }, [reviewModal.isOpen, isEditRequestMode, isCancellationRequestMode]);

    // Keep calendarDataService headers in sync with simulation state
    useEffect(() => {
      calendarDataService.setRoleSimulation(simulatedRole, isActualAdmin);
    }, [simulatedRole, isActualAdmin]);

    // Reload calendar data when simulation role changes (not on initial mount)
    // Uses loadEventsRef (not loadEvents directly) to avoid TDZ — loadEvents is declared later.
    const prevSimulatedRoleRef = useRef(simulatedRole);
    useEffect(() => {
      if (prevSimulatedRoleRef.current !== simulatedRole && apiToken) {
        loadEventsRef.current?.(true, null, { silent: true });
      }
      prevSimulatedRoleRef.current = simulatedRole;
    }, [simulatedRole, apiToken]);

    // Per-event edit permission: considers ownership and department match
    const canEditThisEvent = useMemo(() => {
      if (canEditEvents || canApproveReservations) return true; // admin/approver
      if (!reviewModal.currentItem) return false;

      const item = reviewModal.currentItem;

      // Check ownership
      const requesterEmail = (
        item.roomReservationData?.requestedBy?.email
        || item.calendarData?.requesterEmail
        || item.requesterEmail
        || ''
      ).toLowerCase();
      const isOwner = currentUser?.email && requesterEmail === currentUser.email.toLowerCase();
      if (isOwner) return true;

      // Check department match (only for pending/rejected)
      // Uses creator's user profile department, not event's stored fields
      if (['pending', 'rejected'].includes(item.status)) {
        const ownerDept = (item.creatorDepartment || '').toLowerCase().trim();
        const myDept = (userDepartment || '').toLowerCase().trim();
        if (myDept && ownerDept === myDept) return true;
      }

      return false;
    }, [canEditEvents, canApproveReservations, reviewModal.currentItem, currentUser?.email, userDepartment]);

    // Whether the current user can request edits on the current published event (owner OR same department)
    const canRequestEditThisEvent = useMemo(() => {
      if (!reviewModal.currentItem || !currentUser?.email) return false;
      const item = reviewModal.currentItem;

      // Ownerless events (imported/synced without requestedBy) are open to any requester
      const hasOwner = !!item.roomReservationData?.requestedBy?.email;
      if (!hasOwner) return true;

      // Check ownership
      const requesterEmail = (
        item.roomReservationData?.requestedBy?.email
        || item.createdByEmail
        || ''
      ).toLowerCase();
      if (requesterEmail === currentUser.email.toLowerCase()) return true;

      // Check department match — uses the creator's user profile department
      // (enriched by backend as creatorDepartment), not the event's stored fields
      const myDept = (userDepartment || '').toLowerCase().trim();
      if (!myDept) return false;

      const ownerDept = (item.creatorDepartment || '').toLowerCase().trim();
      if (ownerDept === myDept) return true;

      return false;
    }, [reviewModal.currentItem, currentUser?.email, userDepartment]);

    // Whether the current user is a non-admin editor (owner or dept colleague)
    const isNonAdminEditor = canEditThisEvent && !canEditEvents && !canApproveReservations;

    // Resubmit handler (for non-admin users resubmitting rejected events without changes)
    const handleResubmitFromCalendar = useCallback(async () => {
      const item = reviewModal.currentItem;
      if (!item) return;

      setIsResubmitting(true);
      try {
        const response = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${item._id}/resubmit`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
          body: JSON.stringify({ _version: item._version || null })
        });

        if (!response.ok) throw new Error('Failed to resubmit reservation');

        reviewModal.closeModal(true);
        loadEventsRef.current?.(true);
      } catch (err) {
        logger.error('Error resubmitting reservation:', err);
        showError(err, { context: 'Calendar.handleResubmitFromCalendar' });
      } finally {
        setIsResubmitting(false);
      }
    }, [reviewModal, apiToken, showError]);

    //---------------------------------------------------------------------------
    // SIMPLE UTILITY FUNCTIONS (no dependencies on other functions)
    //---------------------------------------------------------------------------

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
        showError('Please select a JSON file');
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

            // Use locationDisplayNames instead of deprecated location field (check calendarData first)
            const location = getEventField(event, 'locationDisplayNames', '');

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
          
          // Navigate calendar to the earliest event date
          // dateRange is a useMemo derived from currentDate, so setting currentDate recalculates it
          setCurrentDate(newStart);
          
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
        // Two-click confirmation: first click shows confirm, second click executes
        if (!confirmModeSwitch) {
          setConfirmModeSwitch(true);
          return;
        }
        setConfirmModeSwitch(false);
        calendarDataService.setApiMode();
        setIsDemoMode(false);
        setDemoData(null);

        // Reload events from API
        await loadEvents();
      } else {
        // Switching from API to demo mode - need to upload data first
        showError('Please upload JSON data to enable demo mode');
      }
    };
    
    /*
    * Admin-only mode controls (API/Demo toggle, upload)
    */
    const renderAdminModeControls = () => {
      const demoStats = calendarDataService.getDemoDataStats();

      return (
        <div className="mode-toggle-container">
          <div className="mode-toggle-row">
            <div className="mode-toggle-controls">
              <div className="mode-toggle-group">
                <button
                  onClick={handleModeToggle}
                  className={`mode-toggle-btn ${isDemoMode ? 'demo-mode' : 'api-mode'}${confirmModeSwitch ? ' confirm' : ''}`}
                >
                  {confirmModeSwitch ? 'Confirm? (clears demo data)' : (isDemoMode ? 'Demo Mode' : 'API Mode')}
                </button>
              </div>

              {!isDemoMode && (
                <div className="mode-toggle-group">
                  <label htmlFor="demo-upload" className="upload-demo-label">
                    📁 Upload Demo Data
                  </label>
                  <input
                    id="demo-upload"
                    type="file"
                    accept=".json"
                    onChange={handleDemoDataUpload}
                    disabled={isUploadingDemo}
                    className="upload-demo-input"
                  />
                  {isUploadingDemo && <span className="upload-status">Uploading...</span>}
                </div>
              )}

              {isDemoMode && demoStats && (
                <div className="demo-stats">
                  📊 {demoStats.totalEvents} events loaded
                  {demoStats.year && ` | 📅 ${demoStats.year}`}
                  {demoStats.dateRange?.start && demoStats.dateRange?.end && (
                    ` | 📅 ${new Date(demoStats.dateRange.start).toLocaleDateString()} - ${new Date(demoStats.dateRange.end).toLocaleDateString()}`
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };

    /*
    * Filter controls - rendered inline in the action bar
    */
    const renderFilterControls = () => {
      if (loading || initializing) return null;

      const hasActiveFilter = (selectedCategories?.length > 0 && selectedCategories?.length < dynamicCategories?.length) || (selectedLocations?.length > 0 && selectedLocations?.length < dynamicLocations?.length);

      return (
        <>
          {/* Categories filter */}
          <div className="action-bar-filter">
            <label className="filter-label">
              <span className="filter-label-icon">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <rect x="1" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <rect x="7.5" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <rect x="1" y="7.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              </span>
              Categories
            </label>
            <MultiSelect
              options={dynamicCategories}
              selected={selectedCategories}
              onChange={val => {
                setSelectedCategories(val);
                updateUserProfilePreferences({ selectedCategories: val });
              }}
              favorites={favoriteCategories}
              onFavoritesChange={val => {
                setFavoriteCategories(val);
                updateUserProfilePreferences({ favoriteCategories: val });
              }}
              label="categories"
              searchable
            />
          </div>

          {/* Locations filter */}
          <div className="action-bar-filter">
            <label className="filter-label">
              <span className="filter-label-icon">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M6.5 1C4.29 1 2.5 2.79 2.5 5C2.5 8 6.5 12 6.5 12C6.5 12 10.5 8 10.5 5C10.5 2.79 8.71 1 6.5 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <circle cx="6.5" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              </span>
              Locations
            </label>
            <MultiSelect
              options={dynamicLocations}
              selected={selectedLocations}
              onChange={val => {
                setSelectedLocations(val);
                updateUserProfilePreferences({ selectedLocations: val });
              }}
              favorites={favoriteLocations}
              onFavoritesChange={val => {
                setFavoriteLocations(val);
                updateUserProfilePreferences({ favoriteLocations: val });
              }}
              label="locations"
              searchable
            />
          </div>

          {/* Filter summary */}
          <div className={`action-bar-filter-summary ${hasActiveFilter ? 'has-active-filter' : ''}`}>
            {hasActiveFilter ? (
              <>
                <span className="action-bar-filter-summary-text">
                  <strong>{filteredEvents?.length || 0}</strong> / {allEvents?.length || 0}
                </span>
                <button
                  className="filter-summary-reset"
                  onClick={() => {
                    setSelectedCategories(dynamicCategories);
                    setSelectedLocations(dynamicLocations);
                    updateUserProfilePreferences({ selectedCategories: dynamicCategories, selectedLocations: dynamicLocations });
                  }}
                >
                  Reset
                </button>
              </>
            ) : (
              <span className="action-bar-filter-summary-text">
                <strong>{allEvents?.length || 0}</strong> events
              </span>
            )}
          </div>
        </>
      );
    };

    /*
    * Action bar - visible to all users (search, group-by, PDF export, filters)
    */
    const renderActionBar = () => {
      return (
        <div className="mode-toggle-container">
          <div className="mode-toggle-row mode-toggle-row--actions-only">
            <div className="action-bar-left">
              <button
                className="search-export-btn"
                onClick={() => setShowSearch(true)}
              >
                Search & Export
              </button>
              <ExportToPdfButton
                events={filteredEvents}
                dateRange={dateRange}
              />
            </div>
            <div className="action-bar-right">
              {viewType !== 'month' && (
                <>
                  <div className="group-by-toggle">
                    <button
                      className={`group-by-btn ${groupBy === 'categories' ? 'active' : ''}`}
                      onClick={() => {
                        setGroupBy('categories');
                        updateUserProfilePreferences({ defaultGroupBy: 'categories' });
                      }}
                    >
                      Group by Category
                    </button>
                    <button
                      className={`group-by-btn ${groupBy === 'locations' ? 'active' : ''}`}
                      onClick={() => {
                        setGroupBy('locations');
                        updateUserProfilePreferences({ defaultGroupBy: 'locations' });
                      }}
                    >
                      Group by Location
                    </button>
                  </div>
                  <button
                    className={`group-by-btn hide-empty-btn ${hideEmptyGroups ? 'active' : ''}`}
                    title="Hides groups without events (pinned groups always stay visible)"
                    onClick={() => {
                      const next = !hideEmptyGroups;
                      setHideEmptyGroups(next);
                      updateUserProfilePreferences({ hideEmptyGroups: next });
                    }}
                  >
                    Hide Empty
                  </button>
                </>
              )}
              {renderFilterControls()}
            </div>
          </div>
        </div>
      );
    };

            
      /**
       * Check if an event has no location assigned
       * Checks if the locations array (ObjectIds) is empty AND locationDisplayNames is empty
       * Also treats "Unspecified" placeholder as unspecified (used when clearing locations via Graph API)
       */
      const isUnspecifiedLocation = useCallback((event) => {
        // Offsite events are NOT unspecified - they have their own group (check calendarData first)
        if (getEventField(event, 'isOffsite', false)) return false;
        // Has locations array with items = not unspecified (check calendarData first)
        const locations = getEventField(event, 'locations', []);
        if (locations && Array.isArray(locations) && locations.length > 0) return false;
        // Has locationDisplayNames (raw location name from Graph API) = not unspecified
        // "Unspecified" is a placeholder used when clearing locations, treat as unspecified (check calendarData first)
        const locationDisplayNames = getEventField(event, 'locationDisplayNames', '')?.trim();
        if (locationDisplayNames && locationDisplayNames !== 'Unspecified') return false;
        // Also check graphData.location.displayName as fallback
        const graphDisplayName = event.graphData?.location?.displayName?.trim();
        if (graphDisplayName && graphDisplayName !== 'Unspecified') return false;
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
        // For recurring occurrences with overrides, top-level categories ARE the override
        if (event.isRecurringOccurrence && event.hasOccurrenceOverride && event.categories && Array.isArray(event.categories) && event.categories.length > 0) {
          return event.categories;
        }
        // Check calendarData.categories first (authoritative for MongoDB documents)
        if (event.calendarData?.categories && Array.isArray(event.calendarData.categories) && event.calendarData.categories.length > 0) {
          return event.calendarData.categories;
        }
        // Check top-level categories array (for non-MongoDB formats)
        if (event.categories && Array.isArray(event.categories) && event.categories.length > 0) {
          return event.categories;
        }
        // Check graphData.categories (legacy fallback)
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
          // Helper to convert a dateTime string to a midnight Date in user timezone
          const toUserTZDay = (dateTimeStr) => {
            const utcStr = dateTimeStr.endsWith('Z') ? dateTimeStr : `${dateTimeStr}Z`;
            const dateUTC = new Date(utcStr);
            if (isNaN(dateUTC.getTime())) return null;
            const inUserTZ = new Date(dateUTC.toLocaleString('en-US', { timeZone: userTimezone }));
            inUserTZ.setHours(0, 0, 0, 0);
            return inUserTZ;
          };

          if (!event.start?.dateTime) return false;

          const startDay = toUserTZDay(event.start.dateTime);
          const endDay = toUserTZDay(event.end?.dateTime || event.start.dateTime);
          if (!startDay || !endDay) {
            logger.error('Invalid event date:', event.start.dateTime, event);
            return false;
          }

          const compareDay = new Date(day);
          compareDay.setHours(0, 0, 0, 0);

          return compareDay.getTime() >= startDay.getTime() && compareDay.getTime() <= endDay.getTime();
        } catch (err) {
          logger.error('Error comparing event date in month view:', err, event);
          return false;
        }
      }, [userTimezone]);
  
      /**
       * Check if an event occurs on a specific day (supports multi-day events)
       * @param {Object} event - The event object
       * @param {Date} day - The day to check
       * @returns {Object|null} Position info object (truthy) or null (falsy)
       *   { position: 'only'|'start'|'middle'|'end', isMultiDay: boolean, totalDays: number }
       */
      const getEventPosition = useCallback((event, day) => {
        try {
          if (!event.start?.dateTime) {
            logger.error('Event missing start.dateTime:', event);
            return null;
          }
          const startDateStr = event.start.dateTime.split('T')[0];
          const endDateStr = (event.end?.dateTime || event.start.dateTime).split('T')[0];
          const compareDay = new Date(day);
          const compareDateStr = compareDay.toISOString().split('T')[0];

          if (compareDateStr < startDateStr || compareDateStr > endDateStr) return null;

          const isMultiDay = startDateStr !== endDateStr;
          if (!isMultiDay) return { position: 'only', isMultiDay: false, totalDays: 1 };

          const totalDays = Math.round((new Date(endDateStr) - new Date(startDateStr)) / 86400000) + 1;
          const dayNumber = Math.round((new Date(compareDateStr) - new Date(startDateStr)) / 86400000) + 1;
          const position = compareDateStr === startDateStr ? 'start'
                         : compareDateStr === endDateStr ? 'end' : 'middle';
          return { position, isMultiDay: true, totalDays, dayNumber };
        } catch (err) {
          logger.error('Error comparing event date:', err, event);
          return null;
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
     * Uses localStorage cache with 5-minute TTL to reduce API calls
     */
    const loadSchemaExtensions = useCallback(async () => {
      if (!apiToken) return [];

      // Check localStorage cache first (5-minute TTL)
      const CACHE_KEY = 'schemaExtensions';
      const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL_MS) {
            logger.debug('Using cached schema extensions');
            setSchemaExtensions(data);
            return data;
          }
        }
      } catch (cacheErr) {
        logger.debug('Schema extensions cache miss or invalid:', cacheErr);
      }

      try {
        // Fetch schema extensions via backend (uses app-only auth)
        const response = await fetch(`${API_BASE_URL}/graph/schema-extensions`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });

        if (!response.ok) {
          logger.error('Failed to load schema extensions');
          return [];
        }

        const data = await response.json();

        // Filter to extensions that target events
        const eventExtensions = (data.value || []).filter(ext =>
          ext.status === 'Available' &&
          ext.targetTypes.includes('event')
        );

        // Cache the result in localStorage
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            data: eventExtensions,
            timestamp: Date.now()
          }));
        } catch (storageErr) {
          logger.debug('Failed to cache schema extensions:', storageErr);
        }

        // Store in state for use in UI
        setSchemaExtensions(eventExtensions);

        return eventExtensions;
      } catch (err) {
        logger.error('Error loading schema extensions:', err);
        return [];
      }
    }, [apiToken]);

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

    // Loads the available calendars using backend proxy (app-only auth)
    // Filters to only show admin-configured allowed calendars
    const loadAvailableCalendars = useCallback(async () => {
      if (!apiToken) return [];

      try {
        // Fetch calendars via backend (uses app-only auth)
        const defaultUserId = APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;
        const params = new URLSearchParams({ userId: defaultUserId });
        const response = await fetch(`${API_BASE_URL}/graph/calendars?${params}`, {
          headers: {
            Authorization: `Bearer ${apiToken}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch calendars');
        }

        const data = await response.json();

        // System calendars to always exclude (read-only, not useful for event creation)
        const systemCalendarPatterns = [
          'birthdays',
          'united states holidays',
          'holiday calendar',
          'holidays in united states',
          'us holidays',
          'holidays'
        ];

        let calendars = (data.value || [])
          // Filter out system calendars (check if name contains any system pattern)
          .filter(calendar => {
            const calName = (calendar.name || '').toLowerCase();
            return !systemCalendarPatterns.some(pattern => calName.includes(pattern));
          })
          .map(calendar => ({
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
    }, [apiToken, setAvailableCalendars, fetchAllowedCalendarsConfig]);

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
        // Get calendar owner for app-only auth
        const currentCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
        const calendarOwner = currentCalendar?.owner?.address || APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        // Initialize the service with current settings
        calendarDataService.initialize(
          graphToken, // Kept for backward compatibility
          apiToken,
          selectedCalendarId,
          schemaExtensions,
          userTimeZone?.timezone,
          calendarOwner
        );

        // Get events through the service (demo mode)
        const events = await calendarDataService.getEvents(dateRange);

        setAllEvents(events);
        return true;
        
      } catch (error) {
        logger.error('loadDemoEvents failed:', error);
        showError('Failed to load demo events: ' + error.message);
        return false;
      } finally {
        setLoading(false);
      }
    }, [isDemoMode, demoData, apiToken, selectedCalendarId, schemaExtensions, dateRange]);


    /**
     * Load events using unified delta sync
     * @param {boolean} forceRefresh - Force full sync instead of delta
     * @param {Array} calendarsData - Optional calendar data to use instead of state
     */
    const loadEventsUnified = useCallback(async (forceRefresh = false, calendarsData = null, { silent = false } = {}) => {
      if (!apiToken) {
        logger.debug("loadEventsUnified: Missing API token - returning false");
        return false;
      }

      if (loadInProgressRef.current) {
        logger.debug('loadEventsUnified: Load already in progress, skipping');
        return false;
      }
      loadInProgressRef.current = true;

      // Clear recurring expansion cache on force refresh so edited series masters
      // are re-expanded with their updated data (locations, times, title, etc.)
      if (forceRefresh) {
        expansionCacheRef.current.clear();
      }

      if (!silent) setLoading(true);

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

        // Initialize graphService for linked events
        // Note: unifiedEventService token is handled via setTokenGetter (always fresh from AuthContext ref)
        setGraphServiceApiToken(apiToken);

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
        logger.log('🔍 DEBUG loadResult:', {
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
            // Check eventType from top-level (authoritative) or graphData (fallback)
            const eventType = event.eventType || event.graphData?.type;
            const seriesMasterId = event.seriesMasterId || event.graphData?.seriesMasterId;

            // Keep series masters (we'll expand them)
            if (eventType === 'seriesMaster') return true;

            // Keep standalone events (no series master)
            if (!seriesMasterId) return true;

            // Skip occurrences from Graph - we'll generate them from the master
            logger.debug(`Filtering out Graph API occurrence: ${event.graphData?.subject} (${event.eventId})`);
            return false;
          });

          // Track event count before expansion for accurate metrics
          const eventsBeforeExpansion = eventsToDisplay.length;
          const seriesMastersWithRecurrence = eventsToDisplay.filter(e => {
            const eventType = e.eventType || e.graphData?.type;
            const recurrence = e.recurrence || e.graphData?.recurrence;
            return eventType === 'seriesMaster' && recurrence;
          });

          // EXPAND RECURRING SERIES: Convert series masters into individual occurrences
          // With memoization to avoid redundant calculations
          calendarDebug.startPhase('recurring_expansion');

          // Create cache key from date range and series master IDs
          const seriesMasters = eventsToDisplay.filter(e => {
            const eventType = e.eventType || e.graphData?.type;
            const recurrence = e.recurrence || e.graphData?.recurrence;
            return eventType === 'seriesMaster' && recurrence;
          });
          const masterIds = seriesMasters.map(m => m.eventId).sort().join(',');
          // Use local date getters — start/end are UTC ISO strings from formatDateRangeForAPI,
          // which shift dates forward in negative-offset timezones (e.g. EDT).
          // dateRange.start/end are local Date objects, safe for local-date expansion.
          const pad = (n) => String(n).padStart(2, '0');
          const expandStart = `${dateRange.start.getFullYear()}-${pad(dateRange.start.getMonth() + 1)}-${pad(dateRange.start.getDate())}`;
          const expandEnd = `${dateRange.end.getFullYear()}-${pad(dateRange.end.getMonth() + 1)}-${pad(dateRange.end.getDate())}`;
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
              // Get recurrence from top-level (authoritative) or graphData (fallback)
              const recurrence = event.recurrence || event.graphData?.recurrence;
              if (!recurrence?.pattern || !recurrence?.range) {
                logger.warn('Series master has malformed recurrence data:', event.graphData?.subject);
                continue;
              }

              try {
                // Prepare master event in format expected by expandRecurringSeries
                // Support both Graph-synced events (with graphData) and internal drafts (without)
                const masterId = event.graphData?.id || event.eventId;
                // Use event.subject (includes [Hold] prefix from backend normalization)
                // rather than event.eventTitle (raw title without prefix)
                const masterForExpansion = event.graphData?.id
                  ? {
                      ...event.graphData,
                      eventId: event.graphData.id,
                      // Override start/end with authoritative values from calendarData/top-level
                      // (graphData.start/end may be stale if Graph sync lagged after admin save)
                      start: event.start || event.graphData?.start,
                      end: event.end || event.graphData?.end,
                      subject: event.subject || event.eventTitle || event.calendarData?.eventTitle || event.graphData?.subject,
                      recurrence: recurrence
                    }
                  : {
                      eventId: event.eventId,
                      start: { dateTime: event.startDateTime || event.calendarData?.startDateTime, timeZone: 'America/New_York' },
                      end: { dateTime: event.endDateTime || event.calendarData?.endDateTime, timeZone: 'America/New_York' },
                      subject: event.subject || event.eventTitle || event.calendarData?.eventTitle,
                      recurrence: recurrence
                    };

                // Expand the master into occurrences for the current view range
                const eventOverrides = event.occurrenceOverrides || [];
                const occurrences = expandRecurringSeries(
                  masterForExpansion,
                  expandStart,
                  expandEnd,
                  [],  // exceptions (Graph API only)
                  eventOverrides
                );

                // Determine if this is an infinite series (no end date)
                const isInfiniteSeries = recurrence.range?.type === 'noEnd';
                const visibleCount = occurrences.length;
                const showOccurrenceNumbers = visibleCount > 1;

                // Convert each occurrence to our event format
                // Use view-relative counting: position within visible occurrences, not absolute series position
                let visibleIndex = 0;
                occurrences.forEach(occurrence => {
                  visibleIndex++;
                  const occurrenceDate = occurrence.start.dateTime.split('T')[0];
                  const occurrenceNumber = visibleIndex;

                  expandedOccurrences.push({
                    ...event,
                    eventId: `${event.eventId}-occurrence-${occurrenceDate}`,
                    // Top-level recurring metadata (authoritative for app)
                    eventType: 'occurrence',
                    seriesMasterId: masterId,
                    recurrence: null, // Occurrences don't have recurrence pattern
                    graphData: event.graphData ? {
                      ...occurrence,
                      id: `${masterId}-occurrence-${occurrenceDate}`,
                      type: 'occurrence',
                      seriesMasterId: masterId
                    } : null,
                    start: occurrence.start,
                    end: occurrence.end,
                    startDate: occurrenceDate,
                    startDateTime: occurrence.start.dateTime,
                    endDateTime: occurrence.end.dateTime,
                    endDate: occurrence.end.dateTime.split('T')[0],
                    endTime: occurrence.end.dateTime.split('T')[1]?.substring(0, 5),
                    startTime: occurrence.start.dateTime.split('T')[1]?.substring(0, 5),
                    isRecurringOccurrence: true,
                    masterEventId: event.eventId,
                    hasOccurrenceOverride: occurrence.hasOccurrenceOverride || false,
                    isAdHocAddition: occurrence.isAdHocAddition || false,
                    // Occurrence position in series (e.g., "2/5" for finite, "2/∞" for infinite)
                    occurrenceNumber,
                    totalOccurrences: visibleCount,
                    isInfiniteSeries,
                    showOccurrenceNumbers,
                    // Apply any title/description overrides from the expansion
                    subject: occurrence.subject || event.subject,
                    eventTitle: occurrence.eventTitle || event.eventTitle || event.calendarData?.eventTitle,
                    // Per-occurrence isHold flag for null-time overrides
                    isHold: occurrence.isHoldOverride || false,
                    // Apply ALL per-occurrence override fields from occurrenceOverrides.
                    // expandRecurringSeries spreads overrides via ...override, but Calendar rebuilds
                    // the occurrence starting from ...event (master). Without re-applying override
                    // fields here, master values win and overrides appear lost in the ReviewModal.
                    ...(occurrence.hasOccurrenceOverride ? {
                      // Location overrides
                      ...(occurrence.locations !== undefined && { locations: occurrence.locations }),
                      ...(occurrence.locationDisplayNames !== undefined && { locationDisplayNames: occurrence.locationDisplayNames }),
                      // Time overrides
                      ...(occurrence.startTime !== undefined && { startTime: occurrence.startTime }),
                      ...(occurrence.endTime !== undefined && { endTime: occurrence.endTime }),
                      ...(occurrence.setupTime !== undefined && { setupTime: occurrence.setupTime }),
                      ...(occurrence.teardownTime !== undefined && { teardownTime: occurrence.teardownTime }),
                      ...(occurrence.reservationStartTime !== undefined && { reservationStartTime: occurrence.reservationStartTime }),
                      ...(occurrence.reservationEndTime !== undefined && { reservationEndTime: occurrence.reservationEndTime }),
                      ...(occurrence.doorOpenTime !== undefined && { doorOpenTime: occurrence.doorOpenTime }),
                      ...(occurrence.doorCloseTime !== undefined && { doorCloseTime: occurrence.doorCloseTime }),
                      // Category/service overrides
                      ...(occurrence.categories !== undefined && { categories: occurrence.categories }),
                      ...(occurrence.services !== undefined && { services: occurrence.services }),
                      ...(occurrence.assignedTo !== undefined && { assignedTo: occurrence.assignedTo }),
                      // Additional Information overrides
                      ...(occurrence.setupNotes !== undefined && { setupNotes: occurrence.setupNotes }),
                      ...(occurrence.doorNotes !== undefined && { doorNotes: occurrence.doorNotes }),
                      ...(occurrence.eventNotes !== undefined && { eventNotes: occurrence.eventNotes }),
                      ...(occurrence.specialRequirements !== undefined && { specialRequirements: occurrence.specialRequirements }),
                      ...(occurrence.eventDescription !== undefined && { eventDescription: occurrence.eventDescription }),
                      // Other overrides
                      ...(occurrence.attendeeCount !== undefined && { attendeeCount: occurrence.attendeeCount }),
                      ...(occurrence.isOffsite !== undefined && { isOffsite: occurrence.isOffsite }),
                      ...(occurrence.offsiteName !== undefined && { offsiteName: occurrence.offsiteName }),
                      ...(occurrence.offsiteAddress !== undefined && { offsiteAddress: occurrence.offsiteAddress }),
                    } : {}),
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
            .filter(e => {
              const eventType = e.eventType || e.graphData?.type;
              return eventType !== 'seriesMaster';
            })
            .concat(expandedOccurrences);

          eventsToDisplay = expandedEvents;
          calendarDebug.endPhase('recurring_expansion', { count: expandedOccurrences.length, cached: !!cachedExpansion });
          logger.debug(`Loaded ${eventsToDisplay.length} events (${eventsToDisplay.length - eventsBeforeExpansion} expanded from recurring)`);

          // Log the events we're setting
          calendarDebug.logEventsLoaded(selectedCalendarId, selectedCalendarName, eventsToDisplay);

          // DEBUG: Log event details before setting state
          logger.log('🔍 DEBUG: Setting allEvents with', eventsToDisplay.length, 'events');
          logger.log('🔍 DEBUG: First event sample:', eventsToDisplay[0] ? {
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
          if (loadResult.count === 0 && loadResult.events?.length === 0) {
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
        loadInProgressRef.current = false;
        if (!silent) setLoading(false);
        setLastFetchedAt(Date.now());
      }
    }, [apiToken, selectedCalendarId, availableCalendars, dateRange, formatDateRangeForAPI]);

    /**
     * Load events from MongoDB (source of truth)
     * @param {boolean} forceRefresh - Force refresh from backend
     * @param {Array} calendarsData - Optional calendar data to use instead of state
     */
    const loadEvents = useCallback(async (forceRefresh = false, calendarsData = null, { silent = false } = {}) => {
      calendarDebug.logApiCall('loadEvents', 'start', { forceRefresh, isDemoMode });

      try {
        if (isDemoMode) {
          return await loadDemoEvents();
        }

        // Load events from MongoDB via unified service
        const result = await loadEventsUnified(forceRefresh, calendarsData, { silent });
        calendarDebug.logApiCall('loadEvents', 'complete', { method: 'unified' });
        return result;
      } catch (error) {
        calendarDebug.logError('loadEvents', error);
        throw error;
      }
    }, [isDemoMode, loadDemoEvents, loadEventsUnified]);
    loadEventsRef.current = loadEvents;

    // Listen for refresh events from other views (AI chat, reservation requests, etc.)
    useDataRefreshBus('calendar', useCallback(() => {
      logger.debug('Data refresh bus triggered calendar refresh');
      loadEvents(true, null, { silent: true });
    }, [loadEvents]), !!apiToken && !isDemoMode);

    // Poll for updates every 120s (silent — no loading spinner, skip in demo mode or while modal is open)
    const silentCalendarRefresh = useCallback(() => {
      if (reviewModal.isOpen || eventCreation.isOpen) return;
      loadEvents(false, null, { silent: true });
    }, [loadEvents, reviewModal.isOpen, eventCreation.isOpen]);
    usePolling(silentCalendarRefresh, 300_000, !!apiToken && !isDemoMode && !initializing);

    // Manual refresh handler for FreshnessIndicator
    const handleManualCalendarRefresh = useCallback(async () => {
      setIsManualRefreshing(true);
      try {
        await loadEvents(true, null, { silent: true });
      } finally {
        setIsManualRefreshing(false);
      }
    }, [loadEvents]);

    /**
     * Sync events to internal database
     * @param {Date} startDate - Start date of the range to sync
     * @param {Date} endDate - End date of the range to sync
     * @returns {Promise<Object>} Success indicator and result
     */
    const syncEventsToInternal = useCallback(async (startDate, endDate) => {
      if (!apiToken) {
        logger.error('Missing API token for sync');
        return { success: false, error: 'Authentication required' };
      }

      try {
        // Fetch events via backend (uses app-only auth)
        const { start, end } = formatDateRangeForAPI(startDate, endDate);
        const userId = APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        const params = new URLSearchParams({
          userId,
          startDateTime: start,
          endDateTime: end
        });
        if (selectedCalendarId) {
          params.append('calendarId', selectedCalendarId);
        }

        const response = await fetch(`${API_BASE_URL}/graph/events?${params}`, {
          headers: { Authorization: `Bearer ${apiToken}` }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch events from Graph');
        }

        const data = await response.json();
        const allEvents = data.value || [];

        // Sync to internal database
        const syncResult = await eventDataService.syncEvents(allEvents, selectedCalendarId);

        // Reload events to show updated data
        await loadEvents(true);

        return { success: true, result: syncResult };
      } catch (error) {
        logger.error('Sync failed:', error);
        return { success: false, error: error.message };
      }
    }, [apiToken, selectedCalendarId, loadEvents]);


    /**
     * Manual sync of loaded events to database
     * Creates enriched templeEvents__Events records for currently loaded events
     */
    const handleManualSync = useCallback(async () => {
      if (!allEvents || allEvents.length === 0) {
        showError('No events to sync. Please load events first.');
        return;
      }

      if (!apiToken) {
        showError('Authentication required for sync.');
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
          setUserPermissions({
            startOfWeek: 'Monday',
            defaultView: 'week',
            defaultGroupBy: 'categories',
            preferredZoomLevel: 100,
            preferredTimeZone: 'America/New_York',
          });
          return false;
        }
        
        if (response.ok) {
          const data = await response.json();
          logger.debug("Full user profile data from API:", data);
          // Set currentUser for requester info (eliminates duplicate API call from loadCurrentUser)
          setCurrentUser({
            name: data.name || data.displayName,
            email: data.email,
            id: data.id || data._id
          });

          // Apply user preferences from database (action permissions come from usePermissions() hook)
          setUserPermissions({
            startOfWeek: data.preferences?.startOfWeek || 'Monday',
            defaultView: data.preferences?.defaultView || 'week',
            defaultGroupBy: data.preferences?.defaultGroupBy || 'categories',
            preferredZoomLevel: data.preferences?.preferredZoomLevel || 100,
            preferredTimeZone: data.preferences?.preferredTimeZone || 'America/New_York',
          });

          // Also update the UI state variables from loaded preferences
          if (data.preferences?.defaultGroupBy) {
            setGroupBy(data.preferences.defaultGroupBy);
          }
          if (data.preferences?.defaultView) {
            setViewType(data.preferences.defaultView);
          }
          if (data.preferences?.preferredZoomLevel) {
            setZoomLevel(data.preferences.preferredZoomLevel);
          }
          if (data.preferences?.preferredTimeZone) {
            setUserTimezone(data.preferences.preferredTimeZone);
          }
          if (data.preferences?.favoriteCategories) {
            setFavoriteCategories(data.preferences.favoriteCategories);
          }
          if (data.preferences?.favoriteLocations) {
            setFavoriteLocations(data.preferences.favoriteLocations);
          }
          if (data.preferences?.hideEmptyGroups != null) {
            setHideEmptyGroups(data.preferences.hideEmptyGroups);
          }
          return true;
        }
        return false;
      } catch (error) {
        logger.error("Error fetching user permissions:", error);
        setUserPermissions({
          startOfWeek: 'Monday',
          defaultView: 'week',
          defaultGroupBy: 'categories',
          preferredZoomLevel: 100,
          preferredTimeZone: 'America/New_York',
        });
        return false;
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

      if (!apiToken) {
        logger.error("Cannot initialize: Missing API token");
        return;
      }

      // Add timeout protection (30 seconds)
      const timeoutId = setTimeout(() => {
        logger.error("Initialization timeout - forcing completion");
        setInitializing(false);
      }, 30000);

      logger.debug("Starting application initialization...");
      try {
        // Phase 1: Run independent API calls in parallel
        // - loadUserProfile: fetches /users/current and sets permissions
        // - loadAvailableCalendars: fetches calendars list
        // - loadSchemaExtensions: fetches Graph schema extensions
        // Note: loadCurrentUser is redundant with loadUserProfile (both call /users/current)
        const [userLoaded, calendars] = await Promise.all([
          loadUserProfile(),
          loadAvailableCalendars(),
          loadSchemaExtensions()
        ]);

        if (!userLoaded) {
          logger.warn("Could not load user profile, continuing with defaults");
        }

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

        // Events are NOT loaded here — the consolidated effect handles the first load
        // after React re-renders with the correct viewType from user preferences.
        // This prevents flicker when saved view preference differs from default.

        logger.log("Application initialized successfully");
        setLoading(true); // Keep loading overlay visible while consolidated effect fetches events
        setInitializing(false);

        // Clear timeout on successful completion
        clearTimeout(timeoutId);

      } catch (error) {
        logger.error("Error during initialization:", error);
        // Ensure we exit loading state even on error
        setInitializing(false);

        // Clear timeout on error
        clearTimeout(timeoutId);
      }
    }, [apiToken, loadUserProfile, loadSchemaExtensions]);

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
          showError(`Event updated but refresh failed. Try manual refresh if needed.`);
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
            showError(`Event created but may take a moment to appear. Try refreshing if needed.`);
          }
        }
      }
    }, [loadEvents, showError]); // Removed allEvents from dependencies to avoid stale closure

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

    const makeBatchBody = (eventId, coreBody, extPayload, calendarId, calendarOwner) => {
      // Determine the base URL using /users/{owner} for app-only auth compatibility
      const userPath = calendarOwner ? `/users/${encodeURIComponent(calendarOwner)}` : '/me';
      const baseUrl = calendarId
        ? `${userPath}/calendars/${calendarId}/events`
        : `${userPath}/events`;

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
      // Get calendar owner from the selected calendar (required for app-only Graph API auth)
      const targetCalendar = availableCalendars.find(cal => cal.id === targetCalendarId);
      const calendarOwner = targetCalendar?.owner?.address?.toLowerCase() || APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

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

      // Legacy fallback for new events created via EventForm (not the primary creation path).
      // Primary creation now goes through useEventCreation → POST /api/events/new/audit-update.
      if (!eventId && !result.event?.id) {
        logger.debug('[patchEventBatch] Creating new event via backend batch API');

        const batchBody = makeBatchBody(null, coreBody, extPayload, targetCalendarId, calendarOwner);
        const resp = await fetch(`${API_BASE_URL}/graph/events/batch`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId: calendarOwner,
            requests: batchBody.requests
          })
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
                  calendarOwner: calendarOwner
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
        // First check if this is an offsite event (check calendarData first, then top-level)
        if (getEventField(event, 'isOffsite', false)) {
          hasOffsiteEvents = true;
          return; // Offsite events go to "Offsite" group, not processed further
        }

        // Check if this event has a virtual meeting URL (check calendarData first, then top-level)
        if (getEventField(event, 'virtualMeetingUrl')) {
          // This is a virtual meeting - use "Virtual Meeting" as the location
          const virtualLocation = generalLocations.find(loc =>
            loc.name && loc.name.toLowerCase() === 'virtual meeting'
          );
          if (virtualLocation) {
            locationsSet.add(virtualLocation.name);
          }
          return;
        }

        // Read locationDisplayNames from calendarData first, then top-level, with fallback to location.displayName for Graph events
        const locationText = getEventField(event, 'locationDisplayNames', '')?.trim() || event.location?.displayName?.trim() || '';

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
          
          {viewType !== 'month' && (() => {
            const locText = getEventField(event, 'locationDisplayNames', '')?.trim() || event.location?.displayName?.trim() || '';
            return locText && locText !== 'Unspecified' ? (
              <div className="event-location" style={styles}>
                {locText}
              </div>
            ) : null;
          })()}
          
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
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      
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
    }, [currentDate, userPermissions.startOfWeek]);

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
     * Check if event is pending (needs role-based filtering during simulation)
     */
    const isPendingEvent = useCallback((event) => {
      const status = event.status;
      return status === 'pending' || status === 'room-reservation-request';
    }, []);

    /**
     * Check if event is a draft
     */
    const isDraftEvent = useCallback((event) => event.status === 'draft', []);

    /**
     * Check if current user owns this event (is the requester)
     * Based on sample event data fields:
     * - roomReservationData.requestedBy.email
     * - calendarData.requesterEmail
     * - createdByEmail
     */
    const isEventOwner = useCallback((event) => {
      if (!event || !currentUser?.email) return false;
      const userEmail = currentUser.email.toLowerCase();

      const requesterEmail = (
        event.roomReservationData?.requestedBy?.email ||
        event.createdByEmail ||
        ''
      ).toLowerCase();

      return requesterEmail === userEmail;
    }, [currentUser?.email]);

    /**
     * Filter and sort events based on selected categories and locations
     */
    const filteredEvents = useMemo(() => {
      const filtered = allEvents.filter(event => {

        // === PENDING EVENT VISIBILITY: Filter based on effective permissions (real or simulated) ===
        // Approver/Admin see all pending — skip the check entirely for them
        if (!canApproveReservations && isPendingEvent(event)) {
          if (!canSubmitReservation) {
            return false; // Viewer: cannot see ANY pending events
          }
          if (!isEventOwner(event)) {
            return false; // Requester: only their OWN pending events
          }
        }

        // === DRAFT EVENTS: Only show to creator (defense in depth, backend already filters) ===
        if (isDraftEvent(event) && !isEventOwner(event)) {
          return false;
        }

        // UNIFIED FILTERING FOR ALL VIEWS - Use same logic for month, week, and day
        let categoryMatch = true;
        let locationMatch = true;

        // CATEGORY FILTERING - Show all events if all categories are selected
        if (selectedCategories.length === 0) {
          // Not initialized yet → show all; user deselected all → hide
          categoryMatch = !categoriesInitializedRef.current;
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
          // Not initialized yet → show all; user deselected all → hide
          locationMatch = !locationsInitializedRef.current;
        } else if (selectedLocations.length === dynamicLocations.length) {
          // All locations selected = show ALL events regardless of location
          locationMatch = true;
        } else {
          // Partial locations selected, check if event matches
          // Check for offsite events first (check calendarData first, then top-level)
          if (getEventField(event, 'isOffsite', false)) {
            locationMatch = selectedLocations.includes('Offsite');
          }
          // Check for virtual meeting (check calendarData first, then top-level)
          else if (getEventField(event, 'virtualMeetingUrl')) {
            // This is a virtual meeting - check if "Virtual Meeting" is selected
            locationMatch = selectedLocations.includes('Virtual Meeting');
          }
          // Handle unspecified locations
          else if (isUnspecifiedLocation(event)) {
            locationMatch = selectedLocations.includes('Unspecified');
          }
          // Handle all events with locations
          else {
            // Read locationDisplayNames from calendarData first, then top-level, with fallback to location.displayName for Graph events
            const locationText = getEventField(event, 'locationDisplayNames', '')?.trim() || event.location?.displayName?.trim() || '';
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
      }).map(event => {
        // Add showPendingEditBadge flag: only visible to owner, admins, and approvers
        if (event.pendingEditRequest?.status !== 'pending') return event;
        const showBadge = isEventOwner(event) || canApproveReservations || effectivePermissions.isAdmin;
        return showBadge ? { ...event, showPendingEditBadge: true } : event;
      });

      // Log filter summary
      logger.log(`🔍 FILTER DEBUG: allEvents=${allEvents.length}, filtered=${sorted.length}, selectedCategories=${selectedCategories.length}/${dynamicCategories.length}, selectedLocations=${selectedLocations.length}/${dynamicLocations.length}`);

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
      locationsMatch,
      canApproveReservations,
      canSubmitReservation,
      isPendingEvent,
      isDraftEvent,
      isEventOwner,
      effectivePermissions.isAdmin
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
        // Get location fields from calendarData first, then top-level
        const virtualMeetingUrl = getEventField(event, 'virtualMeetingUrl');
        const locationCodes = getEventField(event, 'locationCodes', []);
        const locations = getEventField(event, 'locations', []);

        // Check for virtual meeting first
        if (virtualMeetingUrl) {
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
        else if (locationCodes && Array.isArray(locationCodes) && locationCodes.length > 0) {
          let addedToAnyGroup = false;

          locationCodes.forEach(code => {
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
        else if (locations && Array.isArray(locations) && locations.length > 0) {
          let addedToAnyGroup = false;

          locations.forEach(locationId => {
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
          const locDisplayText = getEventField(event, 'locationDisplayNames', '')?.trim() || event.location?.displayName?.trim() || '';
          const eventLocations = locDisplayText
            ? locDisplayText.split('; ').map(loc => loc.trim())
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
      if (!apiToken) return [];

      try {
        const defaultCategories = [
        ];

        const createdCategories = [];
        const userId = APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        for (const cat of defaultCategories) {
          const response = await fetch(`${API_BASE_URL}/graph/categories`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              userId,
              ...cat
            })
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
      if (!apiToken) return null;

      try {
        // Define a list of possible colors to use
        const colors = [
          'preset0', 'preset1', 'preset2', 'preset3', 'preset4',
          'preset5', 'preset6', 'preset7', 'preset8', 'preset9',
          'preset10', 'preset11', 'preset12', 'preset13', 'preset14', 'preset15'
        ];

        // Pick a random color
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const userId = APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        const response = await fetch(`${API_BASE_URL}/graph/categories`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId,
            displayName: categoryName,
            color: randomColor
          })
        });

        if (!response.ok) {
          if (response.status === 409) {
            // Category already exists in Outlook — not an error; refresh cache so we don't retry
            queryClient.invalidateQueries({ queryKey: OUTLOOK_CATEGORIES_QUERY_KEY });
            return null;
          }
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
    }, [apiToken]);
    
    //---------------------------------------------------------------------------
    // EVENT HANDLERS
    //---------------------------------------------------------------------------
    const handleDatePickerChange = useCallback((selectedDate) => {
      startNavigation();
      setCurrentDate(new Date(selectedDate));
    }, [startNavigation]);

    const handleEventSelect = (event, viewOnly = false) => {
      // Close the search panel
      setShowSearch(false);

      // Navigate to the event's date in the calendar
      const eventDate = new Date(event.start.dateTime);

      // Show navigation loading overlay while events load
      startNavigation();

      // Set calendar to day view centered on the event date
      // dateRange is a useMemo derived from currentDate, so setting currentDate recalculates it
      setViewType('day');
      setCurrentDate(eventDate);

      // Only open the edit form if not viewOnly
      if (!viewOnly) {
        setCurrentEvent(event);
        setModalType('edit');
        setIsModalOpen(true);
      }
    };


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
      if (!effectivePermissions.createEvents && !effectivePermissions.submitReservation) return;

      const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
      if (selectedCalendar && !selectedCalendar.isDefault && !selectedCalendar.canEdit) {
        showError("You don't have permission to create events in this calendar");
        return;
      }

      eventCreation.open();
    }, [availableCalendars, effectivePermissions.createEvents, effectivePermissions.submitReservation, selectedCalendarId, showError, eventCreation]);

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
    const handleViewInCalendar = (event, targetViewType = 'day', explicitCalendarId = null, options = {}) => {
      logger.debug("View in calendar clicked", { event, targetViewType, explicitCalendarId });

      // Navigate to the event's date in the calendar
      const eventDate = new Date(event.start.dateTime);

      // Use explicit calendarId if provided, otherwise fall back to event.calendarId
      const targetCalendarId = explicitCalendarId || event.calendarId;

      // Show navigation loading overlay while events load
      startNavigation();

      // Switch to the target calendar if different from current
      if (targetCalendarId && targetCalendarId !== selectedCalendarId) {
        setSelectedCalendarId(targetCalendarId);
      }

      // Set calendar to specified view centered on the event date
      // dateRange is a useMemo that recalculates based on currentDate and viewType
      setViewType(targetViewType);
      setCurrentDate(eventDate);

      // Open the event modal if requested (e.g., from search "View in Calendar")
      if (options.openModal && event._id) {
        (async () => {
          try {
            const response = await fetch(`${APP_CONFIG.API_BASE_URL}/events/${event._id}`, {
              headers: { 'Authorization': `Bearer ${apiToken}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            await reviewModal.openModal(data.event);
          } catch (error) {
            logger.error('Error opening event from search:', error);
          }
        })();
      }
    };

    /**
     * Navigate to today
     */
    const handleToday = useCallback(() => {
      const today = new Date();
      // Check if already showing today based on view type
      if (viewType === 'month') {
        // Month view: skip if already on current month
        if (currentDate.getMonth() === today.getMonth() &&
            currentDate.getFullYear() === today.getFullYear()) {
          return;
        }
      } else if (viewType === 'week') {
        // Week view: skip if today is within the currently displayed week
        if (today >= dateRange.start && today <= dateRange.end) {
          return;
        }
      } else if (viewType === 'day') {
        // Day view: skip if already on today's date
        if (currentDate.getDate() === today.getDate() &&
            currentDate.getMonth() === today.getMonth() &&
            currentDate.getFullYear() === today.getFullYear()) {
          return;
        }
      }
      startNavigation();
      setCurrentDate(today);
    }, [startNavigation, currentDate, viewType, dateRange]);

    /**
     * Navigate to the next time period
     */
    const handleNext = useCallback(() => {
      startNavigation();
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
    }, [viewType, currentDate, startNavigation]);

    /**
     * Navigate to the previous time period
     */
    const handlePrevious = useCallback(() => {
      startNavigation();
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
    }, [viewType, currentDate, startNavigation]);

    const handleDayCellClick = useCallback(async (day, category = null, location = null) => {
      if (!effectivePermissions.createEvents && !effectivePermissions.submitReservation) return;

      const dateString = day.toISOString().split('T')[0];

      // Auto-create Outlook category if it doesn't exist yet
      if (groupBy === 'categories' && category && category !== 'Uncategorized') {
        if (!outlookCategories.some(cat => cat.name === category)) {
          await createOutlookCategory(category);
        }
      }

      // Resolve location ObjectId from display name
      let locationIds = [];
      if (groupBy === 'locations' && location && location !== 'Unspecified') {
        const locationDoc = rooms.find(loc =>
          loc.name === location || loc.displayName === location
        );
        if (locationDoc) locationIds = [locationDoc._id];
      }

      eventCreation.open({
        startDate: dateString,
        endDate: dateString,
        locations: locationIds,
        categories: (category && category !== 'Uncategorized') ? [category] : [],
      });
    }, [effectivePermissions.createEvents, effectivePermissions.submitReservation, groupBy, outlookCategories, createOutlookCategory, rooms, eventCreation]);

    /**
     * Handle quick-add from WeekTimelineModal grid click
     * @param {string} locationId - ObjectId of the location
     * @param {string} dateStr - Date string in YYYY-MM-DD format
     * @param {number} decimalHour - Decimal hour (e.g., 9.5 for 9:30 AM)
     */
    const handleTimelineQuickAdd = useCallback((locationId, dateStr, decimalHour) => {
      if (!effectivePermissions.createEvents && !effectivePermissions.submitReservation) return;

      // Convert decimal hour to HH:MM strings
      const startHours = Math.floor(decimalHour);
      const startMinutes = Math.round((decimalHour - startHours) * 60);
      const startTime = `${String(startHours).padStart(2, '0')}:${String(startMinutes).padStart(2, '0')}`;

      const endDecimal = Math.min(decimalHour + 1, 24);
      const endHours = Math.floor(endDecimal);
      const endMinutes = Math.round((endDecimal - endHours) * 60);
      const endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;

      setTimelineModal(prev => ({ ...prev, isOpen: false }));
      eventCreation.open({
        startDate: dateStr,
        endDate: dateStr,
        reservationStartTime: startTime,
        reservationEndTime: endTime,
        locations: locationId ? [locationId] : [],
      });
    }, [effectivePermissions.createEvents, effectivePermissions.submitReservation, eventCreation]);

    /**
     * Handle clicking on a location row to open timeline modal
     * @param {string} locationName - The name of the location
     * @param {Date|Array<Date>} dateOrDates - Single date for day view, array of dates for week view
     * @param {string} viewType - 'day' or 'week'
     * @param {string|null} locationId - Optional ObjectId of the location for precise matching
     */
    const handleToggleGridFavorite = useCallback((group) => {
      if (groupBy === 'categories') {
        const next = favoriteCategories.includes(group)
          ? favoriteCategories.filter(f => f !== group)
          : [...favoriteCategories, group];
        setFavoriteCategories(next);
        updateUserProfilePreferences({ favoriteCategories: next });
      } else {
        const next = favoriteLocations.includes(group)
          ? favoriteLocations.filter(f => f !== group)
          : [...favoriteLocations, group];
        setFavoriteLocations(next);
        updateUserProfilePreferences({ favoriteLocations: next });
      }
    }, [groupBy, favoriteCategories, favoriteLocations, updateUserProfilePreferences]);

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

          // Check location match using ObjectId if available (check calendarData first)
          if (locationId) {
            // Direct ObjectId matching
            const locations = getEventField(event, 'locations', []);
            return locations && Array.isArray(locations) &&
              locations.some(locId => locId.toString() === locationId);
          } else {
            // Fallback for special locations (Virtual Meeting, Unspecified)
            if (locationName === 'Virtual Meeting') {
              return !!getEventField(event, 'virtualMeetingUrl');
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

          // Check location match using ObjectId if available (check calendarData first)
          if (locationId) {
            // Direct ObjectId matching
            const locations = getEventField(event, 'locations', []);
            return locations && Array.isArray(locations) &&
              locations.some(locId => locId.toString() === locationId);
          } else {
            // Fallback for special locations (Virtual Meeting, Unspecified)
            if (locationName === 'Virtual Meeting') {
              return !!getEventField(event, 'virtualMeetingUrl');
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

    const handleCategoryRowClick = useCallback((categoryName, dateOrDates, viewType) => {
      let filteredModalEvents = [];
      let dateRangeArray = [];

      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const matchesCategory = (event) => {
        const categories = (event.isRecurringOccurrence && event.hasOccurrenceOverride && event.categories !== undefined)
          ? event.categories
          : (event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']));
        return (categories[0] || 'Uncategorized') === categoryName;
      };

      if (viewType === 'week' && Array.isArray(dateOrDates)) {
        const startDate = dateOrDates[0];
        const endDate = dateOrDates[dateOrDates.length - 1];
        dateRangeArray = [formatDate(startDate), formatDate(endDate)];

        filteredModalEvents = allEventsRef.current.filter(event => {
          const eventStart = new Date(event.start.dateTime);
          const inDateRange = eventStart >= startDate &&
            eventStart <= new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
          return inDateRange && matchesCategory(event);
        });
      } else if (viewType === 'day') {
        const currentDay = dateOrDates;
        const dateStr = formatDate(currentDay);
        dateRangeArray = [dateStr, dateStr];

        filteredModalEvents = allEventsRef.current.filter(event => {
          const eventStart = new Date(event.start.dateTime);
          const eventDateStr = formatDate(eventStart);
          return eventDateStr === dateStr && matchesCategory(event);
        });
      }

      setTimelineModal({
        isOpen: true,
        locationName: categoryName,
        locationId: null,
        dateRange: dateRangeArray,
        events: filteredModalEvents,
        viewType: viewType === 'day' ? 'day' : 'week'
      });
    }, []);

    /**
     * Check if an event is part of a recurring series
     * @param {Object} event - The event to check
     * @returns {boolean} - True if the event is recurring
     */
    const isRecurringEvent = useCallback((event) => {
      // Check top-level fields (authoritative) then graphData (fallback)
      const eventType = event.eventType || event.graphData?.type;
      const seriesMasterId = event.seriesMasterId || event.graphData?.seriesMasterId;
      const recurrence = event.recurrence || event.graphData?.recurrence;

      return !!(
        seriesMasterId ||
        recurrence ||
        eventType === 'seriesMaster'
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
      if (!event) return;

      try {
        const needsMasterFetch = scope === 'allEvents' && event.isRecurringOccurrence && event.masterEventId;

        if (needsMasterFetch) {
          // Check if master is already in current view
          const found = allEventsRef.current.find(e => e.eventId === event.masterEventId);
          if (found) {
            // Master available locally — close dialog and open modal directly
            setRecurringScopeDialog({ isOpen: false, pendingEvent: null, isLoading: false });
            await reviewModal.openModal(found, { editScope: scope });
          } else {
            // Keep dialog open with loading state while fetching master
            setRecurringScopeDialog(prev => ({ ...prev, isLoading: true }));
            try {
              const res = await fetch(`${APP_CONFIG.API_BASE_URL}/room-reservations/${event._id}`, {
                headers: { 'Authorization': `Bearer ${apiToken}` }
              });
              const masterEvent = res.ok ? await res.json() : event; // fallback to occurrence
              // Close dialog and open modal with master data — one clean load
              setRecurringScopeDialog({ isOpen: false, pendingEvent: null, isLoading: false });
              await reviewModal.openModal(masterEvent, { editScope: scope });
            } catch (err) {
              logger.warn('Could not fetch series master, using occurrence data');
              setRecurringScopeDialog({ isOpen: false, pendingEvent: null, isLoading: false });
              await reviewModal.openModal(event, { editScope: scope });
            }
          }
        } else {
          // Non-occurrence or 'thisEvent' scope — close dialog and open modal directly
          setRecurringScopeDialog({ isOpen: false, pendingEvent: null, isLoading: false });
          await reviewModal.openModal(event, { editScope: scope });
        }
      } catch (error) {
        logger.error('Error opening review modal:', error);
        showError(error, { context: 'Calendar.handleRecurringScopeSelected', userMessage: 'Failed to open review modal' });
      }
    }, [recurringScopeDialog.pendingEvent, reviewModal, showError, apiToken]);

    /**
     * Handle closing the recurring scope dialog
     */
    const handleRecurringScopeClose = useCallback(() => {
      setRecurringScopeDialog({ isOpen: false, pendingEvent: null, isLoading: false });
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
        showError("You don't have permission to delete events in this calendar");
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
        // Get calendar owner for app-only auth
        const currentCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
        const calendarOwner = currentCalendar?.owner?.address || APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        // Initialize the service
        calendarDataService.initialize(
          graphToken, // Kept for backward compatibility
          apiToken,
          selectedCalendarId,
          schemaExtensions,
          userTimeZone?.timezone,
          calendarOwner
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
        // Get calendar owner email for app-only auth
        const calendarOwner = currentCalendar.owner?.address || APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        if (!eventData.id) {
          logger.debug('Creating new linked events with extended properties');

          const linkedEvents = await createLinkedEvents(
            calendarOwner, // Use calendar owner email instead of graphToken
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
          const existingLinkedEvent = await findLinkedEvent(calendarOwner, eventData.id, calendarId);

          if (existingLinkedEvent) {
            logger.debug('Updating existing linked registration event');

            // Update the linked event with new times
            await updateLinkedEvent(
              calendarOwner, // Use calendar owner email instead of graphToken
              eventData.id,
              mainEventData,
              calendarId,
              setupMinutes,
              teardownMinutes
            );
          } else {
            logger.debug('No existing linked event found, creating new registration event');

            // Fall back to creating event via backend (app-only auth)
            const registrationCalendarOwner = registrationCalendar.owner?.address || calendarOwner;

            try {
              const response = await fetch(`${API_BASE_URL}/graph/events`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  userId: registrationCalendarOwner,
                  calendarId: registrationCalendar.id,
                  eventData: registrationEventData
                })
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
                const errorData = await response.json().catch(() => ({}));
                logger.error('Failed to create registration event:', errorData);
              }
            } catch (fetchError) {
              logger.error('Error creating registration event:', fetchError);
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
        
        // Internal fields payload — use shared builder (single source of truth)
        const internal = {
          ...buildInternalFields(data),
          // Override locations with resolved room IDs from caller
          locations: data.locationIds || data.requestedRooms || data.locations || [],
          // Multi-day event series metadata (caller-specific)
          eventSeriesId: data.eventSeriesId !== undefined ? data.eventSeriesId : null,
          seriesLength: data.seriesLength || null,
          seriesIndex: data.seriesIndex !== undefined ? data.seriesIndex : null,
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
            showError(`Cannot create events in read-only calendar: ${selectedCalendar.name}`);
            return false;
          }
        }
        
        // Final check to ensure we have a valid target calendar
        if (!targetCalendarId) {
          showError('No writable calendar available for event creation');
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

        // Validate that API token is available
        if (!apiToken) {
          throw new Error('API token not available');
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
              reservationStartTime: data.reservationStartTime || '',
              reservationEndTime: data.reservationEndTime || '',
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
        showError("You don't have permission to create events");
        return false;
      }
      if (!isNew && !effectivePermissions.editEvents) {
        showError("You don't have permission to edit events");
        return false;
      }

      // Set loading state
      setSavingEvent(true);

      try {
        // Dispatch to the appropriate handler based on mode
        let success;
        if (isDemoMode) {
          success = await handleSaveDemoEvent(data);
        } else {
          success = await handleSaveApiEvent(data);
        }

        // Check if save was successful
        if (!success) {
          return false;
        }

        // Close modal if it's open (common to both modes)
        if (isModalOpen) {
          setIsModalOpen(false);
        }

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
     * Handle enabling edit request mode for published events
     * This allows requesters to edit the form inline and submit changes for approval
     */
    const handleRequestEdit = useCallback(() => {
      // Store the original data before enabling edit mode
      const currentData = reviewModal.editableData;
      if (currentData) {
        setOriginalEventData(JSON.parse(JSON.stringify(currentData))); // Deep clone
      }
      setIsEditRequestMode(true);
    }, [reviewModal.editableData]);

    /**
     * Handle canceling edit request mode
     */
    const handleCancelEditRequest = useCallback(() => {
      setIsEditRequestMode(false);
      setOriginalEventData(null);
      // Revert to original data (wholesale replacement needs remount to re-initialize form)
      if (originalEventData && reviewModal.editableData) {
        reviewModal.replaceEditableData(originalEventData);
      }
    }, [originalEventData, reviewModal]);

    /**
     * Extract edit request metadata from an event (minimal — just UI display fields).
     * The actual proposed-changes overlay is handled by buildEditRequestViewData in handleViewEditRequest.
     * Falls back to API call if the event was loaded without embedded pendingEditRequest.
     */
    const fetchExistingEditRequest = useCallback(async (event) => {
      if (!event) return null;

      setLoadingEditRequest(true);
      try {
        // EMBEDDED MODEL: Check for pendingEditRequest directly on the event
        const pendingReq = event.pendingEditRequest;
        if (pendingReq?.status === 'pending') {
          return {
            _id: event._id,
            editRequestId: pendingReq.id,
            status: pendingReq.status,
            requestedBy: pendingReq.requestedBy,
            changeReason: pendingReq.changeReason,
            proposedChanges: pendingReq.proposedChanges,
            reviewedBy: pendingReq.reviewedBy,
            reviewedAt: pendingReq.reviewedAt,
            reviewNotes: pendingReq.reviewNotes,
            createdAt: pendingReq.requestedBy?.requestedAt,
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
     * Effect to check for existing edit requests when modal opens with published event
     */
    useEffect(() => {
      const checkForEditRequest = async () => {
        if (reviewModal.isOpen && reviewModal.currentItem?.status === 'published') {
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
     * Handle viewing an existing edit request (overlays proposed changes onto original event)
     */
    const handleViewEditRequest = useCallback(() => {
      if (existingEditRequest) {
        const currentData = reviewModal.editableData;
        if (currentData) {
          setOriginalEventData(JSON.parse(JSON.stringify(currentData)));
        }
        reviewModal.replaceEditableData(
          buildEditRequestViewData(reviewModal.currentItem, currentData)
        );
        setIsViewingEditRequest(true);
      }
    }, [existingEditRequest, reviewModal]);

    /**
     * Handle toggling back to the original published event
     */
    const handleViewOriginalEvent = useCallback(() => {
      if (originalEventData) {
        reviewModal.replaceEditableData(originalEventData);
        setIsViewingEditRequest(false);
      }
    }, [originalEventData, reviewModal]);

    // Wrappers for hook's edit request approve/reject handlers
    const handleApproveEditRequest = useCallback(() => {
      const approverChanges = computeApproverChanges(reviewModal.editableData, originalEventData);
      return reviewModal.handleApproveEditRequest(approverChanges);
    }, [reviewModal, originalEventData]);

    const handleRejectEditRequest = useCallback(() => {
      return reviewModal.handleRejectEditRequest();
    }, [reviewModal]);

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

      } catch (error) {
        logger.error('Error canceling edit request:', error);
        showError(`Failed to cancel edit request: ${error.message}`);
      } finally {
        setIsCancelingEditRequest(false);
        setIsCancelEditRequestConfirming(false);
      }
    }, [isCancelEditRequestConfirming, reviewModal, existingEditRequest, apiToken, refreshEvents, showError]);

    /**
     * Cancel cancel edit request confirmation
     */
    const cancelCancelEditRequestConfirmation = useCallback(() => {
      setIsCancelEditRequestConfirming(false);
    }, []);

    // --- Cancellation request handlers (Calendar) ---

    const handleRequestCancellationFromCalendar = useCallback(() => {
      setIsCancellationRequestMode(true);
      setCancellationReason('');
    }, []);

    const handleCancelCancellationRequestFromCalendar = useCallback(() => {
      setIsCancellationRequestMode(false);
      setCancellationReason('');
    }, []);

    const handleSubmitCancellationRequestFromCalendar = useCallback(async () => {
      const currentItem = reviewModal.currentItem;
      if (!currentItem || !cancellationReason.trim()) return;

      setIsSubmittingCancellationRequest(true);
      try {
        const eventId = currentItem._id || currentItem.eventId;
        const response = await fetch(
          `${APP_CONFIG.API_BASE_URL}/events/${eventId}/request-cancellation`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              reason: cancellationReason.trim(),
              _version: currentItem._version,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to submit cancellation request');
        }

        showSuccess('Cancellation request submitted');
        setIsCancellationRequestMode(false);
        setCancellationReason('');
        reviewModal.closeModal();
      } catch (error) {
        showError(error, { context: 'Calendar.submitCancellationRequest' });
      } finally {
        setIsSubmittingCancellationRequest(false);
      }
    }, [reviewModal, cancellationReason, apiToken, showSuccess, showError]);

    // Compute detected changes using shared utility (extracted from 3x-duplicated inline version)
    const computeDetectedChanges = useCallback(() => {
      if (!isEditRequestMode) return [];
      return computeDetectedChangesUtil(originalEventData, reviewModal.editableData);
    }, [originalEventData, reviewModal.editableData, isEditRequestMode]);

    // Wrapper to pass computeDetectedChanges to the hook's handleSubmitEditRequest
    const handleSubmitEditRequest = useCallback(() => {
      return reviewModal.handleSubmitEditRequest(computeDetectedChanges);
    }, [reviewModal, computeDetectedChanges]);

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
        showError('Could not find the selected event');
        return;
      }

      logger.debug('Found target event, reopening modal:', targetEvent);

      // Determine which modal is open and reopen with new event
      if (eventCreation.isOpen) {
        // Close creation modal and open in the edit/review modal instead
        eventCreation.close(true);
        setTimeout(() => {
          reviewModal.openModal(targetEvent);
        }, 100);
      } else if (reviewModal.isOpen) {
        // Close current modal
        reviewModal.closeModal();

        // Reopen with new event after a brief delay to ensure clean state
        setTimeout(() => {
          reviewModal.openModal(targetEvent);
        }, 100);
      }

      logger.debug('Modal reopened with new event');
    }, [allEvents, showError, eventCreation, reviewModal]);

    /**
     * Handle deletion of registration events when a TempleEvents event is deleted
     * @param {string} eventId - The event ID that was deleted
     */
    const handleRegistrationEventDeletion = async (eventId) => {
      try {
        // Get calendar owner for app-only auth
        const currentCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
        const calendarOwner = currentCalendar?.owner?.address || APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        // First try the new linked events deletion method
        const linkedEventDeleted = await deleteLinkedEvent(calendarOwner, eventId, selectedCalendarId);

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
        const enrichmentData = enrichmentMap[eventId];

        if (!enrichmentData || !enrichmentData.registrationEventId) {
          logger.debug('No linked registration event found for event:', eventId);
          return;
        }

        // Delete the registration event using legacy method (via backend)
        const registrationEventId = enrichmentData.registrationEventId;
        const registrationCalendarId = enrichmentData.registrationCalendarId;

        if (registrationCalendarId && registrationEventId) {
          const params = new URLSearchParams({
            userId: calendarOwner,
            calendarId: registrationCalendarId
          });

          const deleteResponse = await fetch(`${API_BASE_URL}/graph/events/${registrationEventId}?${params}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            }
          });

          if (deleteResponse.ok || deleteResponse.status === 204) {
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
        // Get calendar owner for app-only auth
        const currentCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
        const calendarOwner = currentCalendar?.owner?.address || APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        // Initialize the service
        calendarDataService.initialize(
          graphToken, // Kept for backward compatibility
          apiToken,
          selectedCalendarId,
          schemaExtensions,
          userTimeZone?.timezone,
          calendarOwner
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

        // Step 2: Delete main event via backend (app-only auth)
        // Get calendar owner for app-only auth
        const currentCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
        const calendarOwner = currentCalendar?.owner?.address || APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;

        const params = new URLSearchParams({ userId: calendarOwner });
        if (selectedCalendarId) {
          params.append('calendarId', selectedCalendarId);
        }

        const graphResponse = await fetch(`${API_BASE_URL}/graph/events/${eventId}?${params}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!graphResponse.ok && graphResponse.status !== 204) {
          if (graphResponse.status === 404) {
            // 404 means the event doesn't exist in Graph API (already deleted)
            // This is actually a success case - treat as if deletion succeeded
            graphDeleted = true;
            logger.debug('Event already deleted from Microsoft Calendar (404 - Not Found)');
          } else {
            // Other errors are actual failures
            const errorData = await graphResponse.json().catch(() => ({}));
            logger.error('Failed to delete event from Graph:', errorData);
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
     * Delete an event
     */
    const handleDeleteConfirm = async () => {
      if (!currentEvent?.id) {
        showError('No event selected for deletion');
        return;
      }
      
      try {
        // Dispatch to the appropriate handler based on mode
        if (isDemoMode) {
          await handleDeleteDemoEvent(currentEvent.id);
          
          // Close modal and clear current event
          setIsModalOpen(false);
          setCurrentEvent(null);
          
        } else {
          // For live events, we need to handle potential partial failures
          const result = await handleDeleteApiEvent(currentEvent.id);
          
          // Close modal and clear current event if deletion succeeded
          setIsModalOpen(false);
          setCurrentEvent(null);
          
          // Check if we have specific deletion information in the logs
          // This is a bit of a workaround since handleDeleteApiEvent doesn't return detailed status
          // In a future iteration, we could enhance this by returning deletion details
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
        
        // Use showError for consistent error display
        showError(errorMessage);
        
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
      // Check if API token is available for initialization
      if (apiToken && initializing) {
        logger.debug("API token available, starting initialization");
        initializeApp();
      }
    }, [apiToken, initializing, initializeApp]);

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
    // This effect handles reloading when date range or calendar changes AFTER initialization
    useEffect(() => {
      if (apiToken && !initializing && selectedCalendarId && availableCalendars.length > 0) {
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
            clearNavigationState(); // Use helper to ensure minimum display time
          });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateRangeString, selectedCalendarId, initializing, availableCalendars.length]);

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

    // Update selected locations when dynamic locations change - smart merging with stale pruning
    useEffect(() => {
      if (dynamicLocations.length > 0) {
        locationsInitializedRef.current = true;
        if (selectedLocations.length === 0) {
          // Initial selection: select all locations
          setSelectedLocations(dynamicLocations);
        } else {
          // Prune stale selections that no longer exist in options
          const validSelections = selectedLocations.filter(loc => dynamicLocations.includes(loc));
          // Add new locations to selection
          const newLocations = dynamicLocations.filter(loc => !validSelections.includes(loc));
          const updated = [...validSelections, ...newLocations];
          if (JSON.stringify(updated) !== JSON.stringify(selectedLocations)) {
            setSelectedLocations(updated);
          }
        }
      }
    }, [dynamicLocations]);

    // Update selected categories when dynamic categories change - smart merging with stale pruning
    useEffect(() => {
      if (dynamicCategories.length > 0) {
        categoriesInitializedRef.current = true;
        if (selectedCategories.length === 0) {
          // Initial selection: select all categories
          setSelectedCategories(dynamicCategories);
        } else {
          // Prune stale selections that no longer exist in options
          const validSelections = selectedCategories.filter(cat => dynamicCategories.includes(cat));
          // Add new categories to selection
          const newCategories = dynamicCategories.filter(cat => !validSelections.includes(cat));
          const updated = [...validSelections, ...newCategories];
          if (JSON.stringify(updated) !== JSON.stringify(selectedCategories)) {
            setSelectedCategories(updated);
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
    const overlayClass = `loading-spinner-overlay${
      initializing ? ' visible initial' :
      (isNavigating || loading) ? ' visible' :
      ' hidden'
    }`;

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
        <div className={overlayClass}>
          <div className="loading-spinner-css" style={{ width: 48, height: 48, borderWidth: 3 }} />
          <p className="loading-spinner-card-text">{initializing ? 'Loading your calendar...' : 'Loading events...'}</p>
        </div>

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

              // dateRange is a useMemo derived from currentDate, so setting currentDate recalculates it
              setCurrentDate(newStart);
            }
          }}
          selectedCalendarId={selectedCalendarId}
          availableCalendars={availableCalendars}
          onCalendarChange={setSelectedCalendarId}
          changingCalendar={changingCalendar}
          calendarAccessError={calendarAccessError}
          updateUserProfilePreferences={updateUserProfilePreferences}
          isAdmin={effectivePermissions.isAdmin}
          lastFetchedAt={lastFetchedAt}
          onManualRefresh={handleManualCalendarRefresh}
          isRefreshing={isManualRefreshing}
        />

        {/* Admin-only mode controls */}
        {effectivePermissions.isAdmin && renderAdminModeControls()}

        {/* Action bar - visible to all users */}
        {renderActionBar()}

        {/* MAIN LAYOUT CONTAINER */}
        <div className="calendar-layout-container">
          {/* Calendar Main Content */}
          <div className="calendar-main-content">
            {/* Calendar grid section */}
            <div className="calendar-grid-container">
              <div className={`calendar-grid-wrapper ${isNavigating ? 'navigating' : ''}`}>
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
                          canAddEvent={canAddEvent}
                          selectedDay={selectedMonthDay}
                          onDaySelect={setSelectedMonthDay}
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
                          handleCategoryRowClick={handleCategoryRowClick}
                          canAddEvent={canAddEvent}
                          favorites={groupBy === 'categories' ? favoriteCategories : favoriteLocations}
                          onToggleFavorite={handleToggleGridFavorite}
                          hideEmptyGroups={hideEmptyGroups}
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
                          handleCategoryRowClick={handleCategoryRowClick}
                          canAddEvent={canAddEvent}
                          favorites={groupBy === 'categories' ? favoriteCategories : favoriteLocations}
                          onToggleFavorite={handleToggleGridFavorite}
                          hideEmptyGroups={hideEmptyGroups}
                        />
                      )}
                    </div>
                  )}
              </div>
            </div>
          </div>

          {/* Sidebar removed - filters now in action bar */}
        </div>

        {/* Modal for Add/Edit Event */}
        <Modal 
          isOpen={isModalOpen && (modalType === 'add' || modalType === 'edit' || modalType === 'view')} 
          onClose={() => setIsModalOpen(false)}
          title={
            modalType === 'add' ? 'Add Event' :
            modalType === 'edit' ? 'Edit Event' :
            'View Event'
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
            baseCategories={baseCategories}
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
            onQuickAdd={handleTimelineQuickAdd}
            canAddEvent={canAddEvent}
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
          mode={recurringScopeDialog.mode}
          isLoading={recurringScopeDialog.isLoading}
        />

        {/* Review Modal for Room Reservations and Event Review */}
        <ReviewModal
          {...reviewModal.getReviewModalProps()}
          // Context-dependent props
          title={reviewModal.editableData?.eventTitle || reviewModal.editableData?.subject || reviewModal.editableData?.calendarData?.eventTitle || 'Event'}
          modalMode={reviewModal.currentItem?.status === 'pending' ? 'review' : 'edit'}
          mode={reviewModal.currentItem?.status === 'pending' ? 'review' : 'edit'}
          isPending={reviewModal.currentItem?.status === 'pending'}
          isNavigating={reviewModalIsNavigating}
          isRequesterOnly={!canEditEvents && !canApproveReservations}
          itemStatus={reviewModal.currentItem?.status || 'published'}
          requesterName={
            reviewModal.currentItem?.roomReservationData?.requestedBy?.name
            || reviewModal.currentItem?.calendarData?.requesterName
            || reviewModal.currentItem?.requesterName
            || ''
          }
          hasChanges={isEditRequestMode ? computeDetectedChanges().length > 0 : reviewModal.hasChanges}
          // Conditional action overrides (permission/status-gated)
          onApprove={canApproveReservations ? reviewModal.handleApprove : null}
          onReject={canApproveReservations ? reviewModal.handleReject : null}
          onSave={canApproveReservations && !reviewModal.isDraft ? reviewModal.handleSave : null}
          onDelete={canDeleteEvents && reviewModal.currentItem?.status !== 'deleted' ? reviewModal.handleDelete : null}
          onRestore={canDeleteEvents && reviewModal.currentItem?.status === 'deleted' ? reviewModal.handleRestore : null}
          // Requester action buttons
          onResubmit={isNonAdminEditor && reviewModal.currentItem?.status === 'rejected' ? handleResubmitFromCalendar : null}
          isResubmitting={isResubmitting}
          // Owner edit actions
          onSavePendingEdit={isNonAdminEditor && reviewModal.currentItem?.status === 'pending' ? reviewModal.handleOwnerEdit : null}
          savingPendingEdit={reviewModal.isSavingOwnerEdit}
          onSaveRejectedEdit={isNonAdminEditor && reviewModal.currentItem?.status === 'rejected' ? reviewModal.handleOwnerEdit : null}
          savingRejectedEdit={reviewModal.isSavingOwnerEdit}
          // Edit request local state
          canRequestEdit={canSubmitReservation && !canEditEvents && !canApproveReservations && !isEditRequestMode && !isViewingEditRequest && canRequestEditThisEvent}
          onRequestEdit={handleRequestEdit}
          existingEditRequest={existingEditRequest}
          isViewingEditRequest={isViewingEditRequest}
          loadingEditRequest={loadingEditRequest}
          onViewEditRequest={(canSubmitReservation || canApproveReservations) ? handleViewEditRequest : null}
          onViewOriginalEvent={handleViewOriginalEvent}
          isEditRequestMode={isEditRequestMode}
          onSubmitEditRequest={handleSubmitEditRequest}
          onCancelEditRequest={handleCancelEditRequest}
          originalData={flatOriginalEventData}
          detectedChanges={computeDetectedChanges()}
          onApproveEditRequest={canApproveReservations ? handleApproveEditRequest : null}
          onRejectEditRequest={canApproveReservations ? handleRejectEditRequest : null}
          // Edit request cancellation (requester local state)
          onCancelPendingEditRequest={handleCancelPendingEditRequest}
          isCancelingEditRequest={isCancelingEditRequest}
          isCancelEditRequestConfirming={isCancelEditRequestConfirming}
          onCancelCancelEditRequest={cancelCancelEditRequestConfirmation}
          // Cancellation request local state
          canRequestCancellation={canSubmitReservation && !canEditEvents && !canApproveReservations && !isEditRequestMode && !isViewingEditRequest && canRequestEditThisEvent && reviewModal.currentItem?.pendingEditRequest?.status !== 'pending' && reviewModal.currentItem?.pendingCancellationRequest?.status !== 'pending'}
          onRequestCancellation={handleRequestCancellationFromCalendar}
          isCancellationRequestMode={isCancellationRequestMode}
          cancellationReason={cancellationReason}
          onCancellationReasonChange={setCancellationReason}
          onSubmitCancellationRequest={handleSubmitCancellationRequestFromCalendar}
          onCancelCancellationRequest={handleCancelCancellationRequestFromCalendar}
          isSubmittingCancellationRequest={isSubmittingCancellationRequest}
          existingCancellationRequest={reviewModal.currentItem?.pendingCancellationRequest}
          onApproveCancellationRequest={canApproveReservations ? reviewModal.handleApproveCancellationRequest : null}
          onRejectCancellationRequest={canApproveReservations ? reviewModal.handleRejectCancellationRequest : null}
        >
          {reviewModal.currentItem && (
            <RoomReservationReview
              key={reviewModal.reinitKey}
              reservation={reviewModal.editableData}
              prefetchedAvailability={reviewModal.prefetchedAvailability}
              prefetchedSeriesEvents={reviewModal.prefetchedSeriesEvents}
              apiToken={apiToken}
              graphToken={graphToken}
              onDataChange={reviewModal.updateData}
              onFormDataReady={reviewModal.setFormDataGetter}
              onIsNavigatingChange={setReviewModalIsNavigating}
              onNavigateToSeriesEvent={handleNavigateToSeriesEvent}
              onFormValidChange={reviewModal.setIsFormValid}
              readOnly={!canEditThisEvent && !isEditRequestMode && !reviewModal.isDraft}
              editScope={reviewModal.editScope}
              onSchedulingConflictsChange={(hasConflicts, conflictInfo) => {
                reviewModal.setSchedulingConflictInfo(conflictInfo || null);
              }}
              onHoldChange={reviewModal.setIsHold}
            />
          )}
        </ReviewModal>

        {/* Conflict Dialog for version conflicts in Review Modal */}
        <ConflictDialog
          isOpen={!!reviewModal.conflictInfo}
          onClose={() => {
            reviewModal.dismissConflict();
            reviewModal.closeModal(true);
            loadEvents(true);
          }}
          onRefresh={() => {
            reviewModal.dismissConflict();
            reviewModal.closeModal(true);
            loadEvents(true);
          }}
          conflictType={reviewModal.conflictInfo?.conflictType}
          eventTitle={reviewModal.conflictInfo?.eventTitle}
          details={reviewModal.conflictInfo?.details}
          staleData={reviewModal.conflictInfo?.staleData}
        />

        {/* Soft Conflict Confirmation Dialog */}
        {reviewModal.softConflictConfirmation && (
          <ConflictDialog
            isOpen={true}
            onClose={reviewModal.dismissSoftConflictConfirmation}
            onConfirm={reviewModal.softConflictConfirmation.retryFn}
            conflictType="soft_conflict"
            eventTitle={reviewModal.currentItem?.eventTitle || 'Event'}
            details={{ message: reviewModal.softConflictConfirmation.message }}
          />
        )}

        {/* Review Modal for Event Creation (via useEventCreation hook) */}
        <ReviewModal
          isOpen={eventCreation.isOpen}
          title="Event"
          modalMode={eventCreation.mode === 'create' ? 'new' : 'edit'}
          onClose={eventCreation.close}
          onSave={eventCreation.handleSave}
          mode={eventCreation.mode === 'create' ? 'create' : 'edit'}
          isPending={false}
          hasChanges={eventCreation.hasChanges}
          isFormValid={eventCreation.isFormValid}
          isSaving={eventCreation.isSaving}
          showActionButtons={true}
          showTabs={true}
          saveButtonLabel={eventCreation.mode === 'event' ? 'Publish' : null}
          isSaveConfirming={eventCreation.isConfirming}
          onCancelSave={eventCreation.cancelSaveConfirmation}
          onSaveDraft={eventCreation.handleSaveDraft}
          savingDraft={eventCreation.savingDraft}
          isDraftConfirming={eventCreation.isDraftConfirming}
          onCancelDraft={eventCreation.cancelDraftConfirmation}
          showDraftDialog={eventCreation.showDraftDialog}
          onDraftDialogSave={eventCreation.handleDraftDialogSave}
          onDraftDialogDiscard={eventCreation.handleDraftDialogDiscard}
          onDraftDialogCancel={eventCreation.handleDraftDialogCancel}
          canSaveDraft={eventCreation.canSaveDraft()}
        >
          {eventCreation.isOpen && eventCreation.prefillData && (
            <RoomReservationReview
              reservation={eventCreation.prefillData}
              apiToken={apiToken}
              onDataChange={eventCreation.updateFormData}
              onFormDataReady={eventCreation.setFormDataReady}
              onNavigateToSeriesEvent={handleNavigateToSeriesEvent}
              onFormValidChange={eventCreation.setIsFormValid}
              readOnly={false}
            />
          )}
        </ReviewModal>
      </div>
    );
  }

  export default Calendar;