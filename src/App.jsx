import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useMsal } from '@azure/msal-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { loginRequest, apiRequest } from './config/authConfig';
import queryClient from './config/queryClient';
import AppHeader from './components/AppHeader';
import CalendarSelector from './components/CalendarSelector';
import UnifiedEventForm from './components/UnifiedEventForm';
import ReviewModal from './components/shared/ReviewModal';
import NewReservationModal from './components/NewReservationModal';
import LoadingSpinner from './components/shared/LoadingSpinner';
import ErrorReportModal from './components/shared/ErrorReportModal';
import { useReviewModal } from './hooks/useReviewModal';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navigation from './components/Navigation';
import { TimezoneProvider } from './context/TimezoneContext';
import { RoomProvider } from './context/LocationContext';
import { RoleSimulationProvider } from './context/RoleSimulationContext';
import { useNotification } from './context/NotificationContext';
import { useAuth } from './context/AuthContext';
import APP_CONFIG, { fetchRuntimeConfig } from './config/config';
import { logger } from './utils/logger';
import calendarDebug from './utils/calendarDebug';
import './App.css';

// Skeleton screen component - renders immediately while auth initializes
const AppSkeleton = () => (
  <div className="app-skeleton">
    <div className="app-skeleton-header">
      <div className="app-skeleton-header-title" />
    </div>
    <div className="app-skeleton-nav">
      <div className="app-skeleton-nav-item skeleton" />
      <div className="app-skeleton-nav-item skeleton" />
      <div className="app-skeleton-nav-item skeleton" />
    </div>
    <div className="app-skeleton-content">
      <div className="app-skeleton-toolbar">
        <div className="app-skeleton-toolbar-left">
          <div className="app-skeleton-toolbar-btn skeleton" />
          <div className="app-skeleton-toolbar-btn skeleton" />
        </div>
        <div className="app-skeleton-toolbar-right">
          <div className="app-skeleton-toolbar-icon skeleton" />
          <div className="app-skeleton-toolbar-icon skeleton" />
          <div className="app-skeleton-toolbar-icon skeleton" />
        </div>
      </div>
      <div className="app-skeleton-calendar">
        <div className="app-skeleton-calendar-header">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="app-skeleton-weekday" />
          ))}
        </div>
        <div className="app-skeleton-calendar-grid">
          {[...Array(35)].map((_, i) => (
            <div key={i} className="app-skeleton-day">
              <div className="app-skeleton-day-number skeleton" />
              {i % 3 === 0 && <div className="app-skeleton-event skeleton" />}
              {i % 5 === 0 && <div className="app-skeleton-event skeleton" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

// Lazy load components to reduce initial bundle size
// These components are only loaded when their routes are accessed
const Calendar = lazy(() => import('./components/Calendar'));
const MySettings = lazy(() => import('./components/MySettings'));
const MyReservations = lazy(() => import('./components/MyReservations'));

// Admin-only components - loaded when accessed by admin users
const UserAdmin = lazy(() => import('./components/UserAdmin'));
const CategoryManagement = lazy(() => import('./components/CategoryManagement'));
const CalendarConfigAdmin = lazy(() => import('./components/CalendarConfigAdmin'));
const LocationReview = lazy(() => import('./components/LocationReview'));
const ReservationRequests = lazy(() => import('./components/ReservationRequests'));
const FeatureManagement = lazy(() => import('./components/FeatureManagement'));
const EmailTestAdmin = lazy(() => import('./components/EmailTestAdmin'));
const ErrorLogAdmin = lazy(() => import('./components/ErrorLogAdmin'));
const EventManagement = lazy(() => import('./components/EventManagement'));
const AIChat = lazy(() => import('./components/AIChat'));

function App() {
  const { showError, showWarning, showSuccess } = useNotification();
  const { apiToken, setApiToken } = useAuth();
  const [graphToken, setGraphToken] = useState(null);
  const [signedOut, setSignedOut] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const { instance } = useMsal();

  const [selectedCalendarId, setSelectedCalendarId] = useState(null);
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [changingCalendar, setChangingCalendar] = useState(false);
  const [showRegistrationTimes, setShowRegistrationTimes] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [reservationPrefillData, setReservationPrefillData] = useState(null);
  const [reservationHasChanges, setReservationHasChanges] = useState(false);
  const [reservationIsFormValid, setReservationIsFormValid] = useState(false);
  const [reservationIsSaving, setReservationIsSaving] = useState(false);
  const [reservationSaveFunction, setReservationSaveFunction] = useState(null);
  const [reservationIsConfirming, setReservationIsConfirming] = useState(false);

  // Draft modal state
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftPrefillData, setDraftPrefillData] = useState(null);
  const [draftFormData, setDraftFormData] = useState(null); // Track current form data
  const [draftHasChanges, setDraftHasChanges] = useState(false);
  const draftInitializedRef = useRef(false); // Track if initial reset has happened
  const [draftIsFormValid, setDraftIsFormValid] = useState(false);
  const [draftIsSaving, setDraftIsSaving] = useState(false);
  const [draftSaveFunction, setDraftSaveFunction] = useState(null);
  const [draftIsConfirming, setDraftIsConfirming] = useState(false);
  const [draftIsDraft, setDraftIsDraft] = useState(true);
  const [draftId, setDraftId] = useState(null);
  const [showDraftSaveDialog, setShowDraftSaveDialog] = useState(false);
  const [savingDraftInProgress, setSavingDraftInProgress] = useState(false);

  // Pending edit modal state
  const [showPendingEditModal, setShowPendingEditModal] = useState(false);
  const [pendingEditPrefillData, setPendingEditPrefillData] = useState(null);
  const [pendingEditFormData, setPendingEditFormData] = useState(null);
  const [pendingEditHasChanges, setPendingEditHasChanges] = useState(false);
  const pendingEditInitializedRef = useRef(false);
  const [pendingEditIsFormValid, setPendingEditIsFormValid] = useState(false);
  const [pendingEditIsSaving, setPendingEditIsSaving] = useState(false);
  const [pendingEditEventId, setPendingEditEventId] = useState(null);
  const [pendingEditVersion, setPendingEditVersion] = useState(null);
  const [showPendingEditDiscardDialog, setShowPendingEditDiscardDialog] = useState(false);

  // Edit request modal state (for requesting edits on approved/published events)
  const [showEditRequestModal, setShowEditRequestModal] = useState(false);
  const [editRequestPrefillData, setEditRequestPrefillData] = useState(null);
  const [editRequestFormData, setEditRequestFormData] = useState(null);
  const [editRequestHasChanges, setEditRequestHasChanges] = useState(false);
  const editRequestInitializedRef = useRef(false);
  const [editRequestIsFormValid, setEditRequestIsFormValid] = useState(false);
  const [editRequestIsSaving, setEditRequestIsSaving] = useState(false);
  const [editRequestEventId, setEditRequestEventId] = useState(null);
  const [editRequestVersion, setEditRequestVersion] = useState(null);
  const [showEditRequestDiscardDialog, setShowEditRequestDiscardDialog] = useState(false);

  // Error reporting modal state
  const [pendingError, setPendingError] = useState(null);
  const [showErrorModal, setShowErrorModal] = useState(false);

  // Expose error modal setter globally for error handlers
  // Note: API token is now securely managed via AuthContext
  useEffect(() => {
    window.__showErrorModal = (errorInfo) => {
      setPendingError(errorInfo);
      setShowErrorModal(true);
    };

    return () => {
      window.__showErrorModal = null;
    };
  }, []);

  // Handle calendar change
  const handleCalendarChange = useCallback((newCalendarId) => {
    // Don't allow changing if already changing
    if (changingCalendar) {
      return;
    }

    // Validate that the calendar exists
    const calendarExists = availableCalendars.some(cal => cal.id === newCalendarId);
    if (!calendarExists) {
      calendarDebug.logError('Invalid calendar selection', new Error('Calendar not found'), {
        newCalendarId,
        availableCalendarIds: availableCalendars.map(c => c.id)
      });
      return;
    }

    // Don't change if it's the same calendar
    if (selectedCalendarId === newCalendarId) {
      return;
    }

    calendarDebug.logCalendarChange(selectedCalendarId, newCalendarId, availableCalendars);
    calendarDebug.logStateChange('changingCalendar', false, true);

    // Update both states in the same batch
    setChangingCalendar(true);
    setSelectedCalendarId(newCalendarId);
  }, [selectedCalendarId, changingCalendar, availableCalendars]);

  // Handle registration times toggle
  const handleRegistrationTimesToggle = useCallback((enabled) => {
    setShowRegistrationTimes(enabled);
    logger.debug('Registration times toggled:', enabled);
  }, []);

  // Listen for AI chat reservation modal event
  useEffect(() => {
    const handleOpenReservationModal = (event) => {
      const { formData } = event.detail;

      // Get calendar owner from availableCalendars for the selected calendar
      const selectedCalendar = availableCalendars.find(cal => cal.id === selectedCalendarId);
      const calendarOwner = selectedCalendar?.owner?.address?.toLowerCase() || null;

      // Add calendarId and calendarOwner to prefill data so the event shows up in calendar view
      const enrichedFormData = {
        ...formData,
        calendarId: selectedCalendarId,
        calendarOwner: calendarOwner
      };

      logger.debug('Opening reservation modal with prefill data:', enrichedFormData);
      setReservationPrefillData(enrichedFormData);
      setShowReservationModal(true);
    };

    window.addEventListener('ai-chat-open-reservation-modal', handleOpenReservationModal);
    return () => window.removeEventListener('ai-chat-open-reservation-modal', handleOpenReservationModal);
  }, [selectedCalendarId, availableCalendars]);

  // Listen for draft modal event (from MyReservations)
  useEffect(() => {
    const handleOpenDraftModal = (event) => {
      const { draft } = event.detail;
      if (!draft) return;

      logger.debug('Opening draft modal with data:', draft);

      // Transform draft data for the form
      // Helper to parse datetime - handles both UTC (with Z) and local formats
      const parseDateTime = (dateTimeStr) => {
        if (!dateTimeStr) return { date: '', time: '' };

        // If it contains 'Z' (UTC indicator), parse as Date and convert to local timezone
        if (dateTimeStr.includes('Z')) {
          const d = new Date(dateTimeStr);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          return {
            date: `${year}-${month}-${day}`,
            time: `${hours}:${minutes}`
          };
        }

        // Otherwise parse directly from string (already local format)
        return {
          date: dateTimeStr.split('T')[0] || '',
          time: dateTimeStr.split('T')[1]?.slice(0, 5) || ''
        };
      };

      const startParsed = parseDateTime(draft.startDateTime);
      const endParsed = parseDateTime(draft.endDateTime);

      const prefillData = {
        eventTitle: draft.eventTitle || '',
        eventDescription: draft.eventDescription || '',
        // Use separate fields first (for partial draft support), fall back to parsed startDateTime/endDateTime
        startDate: draft.startDate || startParsed.date,
        endDate: draft.endDate || endParsed.date,
        startTime: draft.startTime || startParsed.time,
        endTime: draft.endTime || endParsed.time,
        requestedRooms: draft.requestedRooms || draft.locations || [],
        locations: draft.requestedRooms || draft.locations || [],
        attendeeCount: draft.attendeeCount || '',
        setupTime: draft.setupTime || '',
        teardownTime: draft.teardownTime || '',
        doorOpenTime: draft.doorOpenTime || '',
        doorCloseTime: draft.doorCloseTime || '',
        categories: draft.categories || draft.mecCategories || [],  // categories is the correct field, mecCategories is deprecated
        services: draft.services || {},
        specialRequirements: draft.specialRequirements || '',
        virtualMeetingUrl: draft.virtualMeetingUrl || '',
        isOffsite: draft.isOffsite || false,
        offsiteName: draft.offsiteName || '',
        offsiteAddress: draft.offsiteAddress || '',
        offsiteLat: draft.offsiteLat || null,
        offsiteLon: draft.offsiteLon || null,
        department: draft.roomReservationData?.department || '',
        phone: draft.roomReservationData?.phone || '',
        _id: draft._id
      };

      logger.log('📂 Opening draft - raw draft data:', draft);
      logger.log('📂 Opening draft - draft.categories:', draft.categories);
      logger.log('📂 Opening draft - draft.mecCategories:', draft.mecCategories);
      logger.log('📂 Opening draft - draft.services:', draft.services);
      logger.log('📂 Opening draft - prefillData:', prefillData);
      logger.log('📂 Opening draft - prefillData.categories:', prefillData.categories);
      logger.log('📂 Opening draft - prefillData.services:', prefillData.services);

      setDraftId(draft._id);
      setDraftPrefillData(prefillData);
      setDraftFormData(null); // Reset form data to ensure fresh state
      setDraftIsDraft(true);
      setDraftHasChanges(false); // Reset - opening a draft is not a "change"
      setShowDraftModal(true);
    };

    window.addEventListener('open-draft-modal', handleOpenDraftModal);
    return () => window.removeEventListener('open-draft-modal', handleOpenDraftModal);
  }, []);

  // Reset hasChanges after draft modal form initializes (prevents false "unsaved changes" on load)
  // Only do this ONCE per modal open session to avoid race conditions with user changes
  useEffect(() => {
    if (showDraftModal && draftPrefillData && !draftInitializedRef.current) {
      // Small delay to allow form to initialize with prefill data, then reset hasChanges
      const timer = setTimeout(() => {
        // Only reset if we haven't already initialized (prevents race condition)
        if (!draftInitializedRef.current) {
          setDraftHasChanges(false);
          draftInitializedRef.current = true;
        }
      }, 150);
      return () => clearTimeout(timer);
    }
    // Reset the ref when modal closes
    if (!showDraftModal) {
      draftInitializedRef.current = false;
    }
  }, [showDraftModal, draftPrefillData]);

  // Listen for pending edit modal event (from MyReservations)
  useEffect(() => {
    const handleOpenPendingEditModal = (event) => {
      const { event: pendingEvent } = event.detail;
      if (!pendingEvent) return;

      logger.debug('Opening pending edit modal with data:', pendingEvent);

      // Transform event data for the form (same parseDateTime helper as draft modal)
      const parseDateTime = (dateTimeStr) => {
        if (!dateTimeStr) return { date: '', time: '' };
        if (dateTimeStr.includes('Z')) {
          const d = new Date(dateTimeStr);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
        }
        return {
          date: dateTimeStr.split('T')[0] || '',
          time: dateTimeStr.split('T')[1]?.slice(0, 5) || ''
        };
      };

      const startParsed = parseDateTime(pendingEvent.startDateTime);
      const endParsed = parseDateTime(pendingEvent.endDateTime);

      const prefillData = {
        eventTitle: pendingEvent.eventTitle || '',
        eventDescription: pendingEvent.eventDescription || '',
        startDate: pendingEvent.startDate || startParsed.date,
        endDate: pendingEvent.endDate || endParsed.date,
        startTime: pendingEvent.startTime || startParsed.time,
        endTime: pendingEvent.endTime || endParsed.time,
        requestedRooms: pendingEvent.requestedRooms || pendingEvent.locations || [],
        locations: pendingEvent.requestedRooms || pendingEvent.locations || [],
        attendeeCount: pendingEvent.attendeeCount || '',
        setupTime: pendingEvent.setupTime || '',
        teardownTime: pendingEvent.teardownTime || '',
        doorOpenTime: pendingEvent.doorOpenTime || '',
        doorCloseTime: pendingEvent.doorCloseTime || '',
        categories: pendingEvent.categories || pendingEvent.mecCategories || [],
        services: pendingEvent.services || {},
        specialRequirements: pendingEvent.specialRequirements || '',
        virtualMeetingUrl: pendingEvent.virtualMeetingUrl || '',
        isOffsite: pendingEvent.isOffsite || false,
        offsiteName: pendingEvent.offsiteName || '',
        offsiteAddress: pendingEvent.offsiteAddress || '',
        offsiteLat: pendingEvent.offsiteLat || null,
        offsiteLon: pendingEvent.offsiteLon || null,
        department: pendingEvent.roomReservationData?.department || pendingEvent.department || '',
        phone: pendingEvent.roomReservationData?.phone || pendingEvent.phone || '',
        _id: pendingEvent._id
      };

      setPendingEditEventId(pendingEvent._id);
      setPendingEditVersion(pendingEvent._version);
      setPendingEditPrefillData(prefillData);
      setPendingEditFormData(null);
      setPendingEditHasChanges(false);
      setShowPendingEditModal(true);
    };

    window.addEventListener('open-edit-pending-modal', handleOpenPendingEditModal);
    return () => window.removeEventListener('open-edit-pending-modal', handleOpenPendingEditModal);
  }, []);

  // Reset hasChanges after pending edit modal form initializes
  useEffect(() => {
    if (showPendingEditModal && pendingEditPrefillData && !pendingEditInitializedRef.current) {
      const timer = setTimeout(() => {
        if (!pendingEditInitializedRef.current) {
          setPendingEditHasChanges(false);
          pendingEditInitializedRef.current = true;
        }
      }, 150);
      return () => clearTimeout(timer);
    }
    if (!showPendingEditModal) {
      pendingEditInitializedRef.current = false;
    }
  }, [showPendingEditModal, pendingEditPrefillData]);

  // Listen for edit request modal event (from MyReservations — approved/published events)
  useEffect(() => {
    const handleOpenEditRequestModal = (event) => {
      const { event: approvedEvent } = event.detail;
      if (!approvedEvent) return;

      logger.debug('Opening edit request modal with data:', approvedEvent);

      const parseDateTime = (dateTimeStr) => {
        if (!dateTimeStr) return { date: '', time: '' };
        if (dateTimeStr.includes('Z')) {
          const d = new Date(dateTimeStr);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
        }
        return {
          date: dateTimeStr.split('T')[0] || '',
          time: dateTimeStr.split('T')[1]?.slice(0, 5) || ''
        };
      };

      const startParsed = parseDateTime(approvedEvent.startDateTime);
      const endParsed = parseDateTime(approvedEvent.endDateTime);

      const prefillData = {
        eventTitle: approvedEvent.eventTitle || '',
        eventDescription: approvedEvent.eventDescription || '',
        startDate: approvedEvent.startDate || startParsed.date,
        endDate: approvedEvent.endDate || endParsed.date,
        startTime: approvedEvent.startTime || startParsed.time,
        endTime: approvedEvent.endTime || endParsed.time,
        requestedRooms: approvedEvent.requestedRooms || approvedEvent.locations || [],
        locations: approvedEvent.requestedRooms || approvedEvent.locations || [],
        attendeeCount: approvedEvent.attendeeCount || '',
        setupTime: approvedEvent.setupTime || '',
        teardownTime: approvedEvent.teardownTime || '',
        doorOpenTime: approvedEvent.doorOpenTime || '',
        doorCloseTime: approvedEvent.doorCloseTime || '',
        categories: approvedEvent.categories || approvedEvent.mecCategories || [],
        services: approvedEvent.services || {},
        specialRequirements: approvedEvent.specialRequirements || '',
        virtualMeetingUrl: approvedEvent.virtualMeetingUrl || '',
        isOffsite: approvedEvent.isOffsite || false,
        offsiteName: approvedEvent.offsiteName || '',
        offsiteAddress: approvedEvent.offsiteAddress || '',
        offsiteLat: approvedEvent.offsiteLat || null,
        offsiteLon: approvedEvent.offsiteLon || null,
        department: approvedEvent.roomReservationData?.department || approvedEvent.department || '',
        phone: approvedEvent.roomReservationData?.phone || approvedEvent.phone || '',
        _id: approvedEvent._id
      };

      setEditRequestEventId(approvedEvent._id);
      setEditRequestVersion(approvedEvent._version);
      setEditRequestPrefillData(prefillData);
      setEditRequestFormData(null);
      setEditRequestHasChanges(false);
      setShowEditRequestModal(true);
    };

    window.addEventListener('open-edit-request-modal', handleOpenEditRequestModal);
    return () => window.removeEventListener('open-edit-request-modal', handleOpenEditRequestModal);
  }, []);

  // Reset hasChanges after edit request modal form initializes
  useEffect(() => {
    if (showEditRequestModal && editRequestPrefillData && !editRequestInitializedRef.current) {
      const timer = setTimeout(() => {
        if (!editRequestInitializedRef.current) {
          setEditRequestHasChanges(false);
          editRequestInitializedRef.current = true;
        }
      }, 150);
      return () => clearTimeout(timer);
    }
    if (!showEditRequestModal) {
      editRequestInitializedRef.current = false;
    }
  }, [showEditRequestModal, editRequestPrefillData]);

  // Memoized token acquisition function
  // Note: Graph token is no longer required - backend uses app-only authentication
  // We only need the API token to authenticate users to our backend
  const acquireTokens = useCallback(async (account) => {
    if (!account) {
      logger.warn('No account provided for token acquisition');
      return;
    }

    logger.log('Acquiring tokens for account:', account.username);

    // Acquire API token (required for backend authentication)
    try {
      logger.debug('Attempting to acquire API token silently');
      const apiResponse = await instance.acquireTokenSilent({
        ...apiRequest,
        account
      });
      logger.debug('API token acquired successfully');
      setApiToken(apiResponse.accessToken);
      // Set graphToken to a placeholder for backward compatibility
      // Components can check for apiToken instead
      setGraphToken('app-auth-mode');
    } catch (error) {
      logger.error('Silent API token acquisition failed:', error);
      try {
        logger.debug('Falling back to popup for API token');
        const apiPopup = await instance.acquireTokenPopup({
          ...apiRequest,
          account
        });
        logger.debug('API token acquired via popup');
        setApiToken(apiPopup.accessToken);
        setGraphToken('app-auth-mode');
      } catch (popupError) {
        logger.error('API token popup failed:', popupError);
      }
    }

    // Note: Graph token acquisition removed - backend now handles all Graph API calls
    // using application permissions (client credentials flow)
  }, [instance]);

  // Fetch runtime config from backend (controls sandbox vs production mode)
  useEffect(() => {
    const loadRuntimeConfig = async () => {
      try {
        const config = await fetchRuntimeConfig();
        if (config?.defaultDisplayCalendar) {
          // Update APP_CONFIG so all components use the backend-controlled value
          APP_CONFIG.DEFAULT_DISPLAY_CALENDAR = config.defaultDisplayCalendar;
          logger.log('Runtime config loaded, calendar mode:', config.calendarMode);
        }
      } catch (error) {
        logger.warn('Failed to load runtime config, using defaults');
      }
    };
    loadRuntimeConfig();
  }, []);

  // Initialize MSAL
  useEffect(() => {
    const initializeMsal = async () => {
      try {
        logger.log('Initializing MSAL...');
        // Wait for MSAL to be ready (if not already)
        if (!instance.getActiveAccount() && instance.getAllAccounts().length > 0) {
          instance.setActiveAccount(instance.getAllAccounts()[0]);
        }
        setIsInitialized(true);
        logger.log('MSAL initialized successfully');
      } catch (error) {
        logger.error('MSAL initialization error:', error);
      }
    };

    initializeMsal();
  }, [instance]);

  // Handle silent token acquisition after initialization
  useEffect(() => {
    const silentLogin = async () => {
      if (!isInitialized) {
        logger.debug('MSAL not yet initialized, skipping token acquisition');
        return;
      }

      logger.debug('Attempting silent login after initialization');
      const accounts = instance.getAllAccounts();
      if (accounts.length > 0) {
        logger.debug('Found existing account, acquiring tokens');
        await acquireTokens(accounts[0]);
      } else {
        logger.debug('No existing accounts found');
      }
    };

    silentLogin();
  }, [isInitialized, instance, acquireTokens]);

  const handleSignIn = async () => {
    const accounts = instance.getAllAccounts();
    if (accounts.length > 0) {
      await acquireTokens(accounts[0]);
      setSignedOut(false);
    }
  };

  const handleSignOut = () => {
    setGraphToken(null);
    setApiToken(null);
    setSignedOut(true);
  };

  // Add/remove body class based on authentication state
  useEffect(() => {
    if (!apiToken || !graphToken) {
      document.body.classList.add('signed-out');
    } else {
      document.body.classList.remove('signed-out');
    }
    
    // Cleanup on unmount
    return () => {
      document.body.classList.remove('signed-out');
    };
  }, [apiToken, graphToken]);


  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <RoleSimulationProvider>
        <div className={`app-container ${(!apiToken || !graphToken) ? 'signed-out' : ''}`}>
        <AppHeader onSignIn={handleSignIn} onSignOut={handleSignOut} />
        <main>
          {apiToken && graphToken ? (
            // Wrap authenticated routes with providers
            <TimezoneProvider
              apiToken={apiToken}
              apiBaseUrl={APP_CONFIG.API_BASE_URL}
              initialTimezone="UTC"
            >
              <RoomProvider apiToken={apiToken}>
              <Navigation apiToken={apiToken} />
              <Suspense fallback={<LoadingSpinner minHeight={200} />}>
                <Routes>
                  <Route path="/" element={
                    <Calendar
                      apiToken={apiToken}
                      graphToken={graphToken}
                      selectedCalendarId={selectedCalendarId}
                      setSelectedCalendarId={setSelectedCalendarId}
                      availableCalendars={availableCalendars}
                      setAvailableCalendars={setAvailableCalendars}
                      changingCalendar={changingCalendar}
                      setChangingCalendar={setChangingCalendar}
                      showRegistrationTimes={showRegistrationTimes}
                    />
                  } />
                  <Route path="/settings" element={<Navigate to="/my-settings" replace />} />
                  <Route path="/my-settings" element={<MySettings apiToken={apiToken} />} />
                  <Route path="/admin/users" element={<UserAdmin apiToken={apiToken} />} />
                  <Route path="/admin/categories" element={<CategoryManagement apiToken={apiToken} />} />
                  <Route path="/admin/calendar-config" element={<CalendarConfigAdmin apiToken={apiToken} />} />

                  {/* Unified Event Form Routes */}
                  <Route path="/booking" element={<UnifiedEventForm mode="create" apiToken={apiToken} />} />
                  <Route path="/booking/public/:token" element={<UnifiedEventForm mode="create" isPublic={true} />} />

                  <Route path="/my-reservations" element={<MyReservations apiToken={apiToken} />} />
                  <Route path="/admin/locations" element={<LocationReview apiToken={apiToken} />} />
                  <Route path="/admin/reservation-requests" element={<ReservationRequests apiToken={apiToken} graphToken={graphToken} />} />
                  <Route path="/admin/feature-management" element={<FeatureManagement apiToken={apiToken} />} />
                  <Route path="/admin/email-test" element={<EmailTestAdmin apiToken={apiToken} />} />
                  <Route path="/admin/error-logs" element={<ErrorLogAdmin apiToken={apiToken} />} />
                  <Route path="/admin/events" element={<EventManagement apiToken={apiToken} />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>

              {/* AI Chat - lazy loaded */}
              <Suspense fallback={null}>
                <AIChat
                  isOpen={showAIChat}
                  onClose={() => setShowAIChat(false)}
                  apiToken={apiToken}
                />
              </Suspense>
              <button
                className="ai-chat-fab"
                onClick={() => setShowAIChat(true)}
                title="Open Chat Assistant"
              >
                <img src="/emanuel_logo.png" alt="Chat" className="ai-chat-fab-icon" />
              </button>

              {/* AI Chat Reservation Modal - wrapped with zoom to match calendar page scaling */}
              <div className="scale-80">
                <ReviewModal
                  isOpen={showReservationModal}
                  title="Add Event - AI Assistant"
                  mode="create"
                  onClose={() => {
                    setShowReservationModal(false);
                    setReservationPrefillData(null);
                    setReservationHasChanges(false);
                    setReservationIsFormValid(false);
                    setReservationSaveFunction(null);
                    setReservationIsConfirming(false);
                  }}
                  onSave={() => {
                    if (!reservationIsConfirming) {
                      // First click: show confirmation
                      setReservationIsConfirming(true);
                    } else {
                      // Second click: actually submit
                      if (reservationSaveFunction) {
                        reservationSaveFunction();
                      }
                      setReservationIsConfirming(false);
                    }
                  }}
                  hasChanges={reservationHasChanges}
                  isFormValid={reservationIsFormValid}
                  isSaving={reservationIsSaving}
                  isSaveConfirming={reservationIsConfirming}
                  onCancelSave={() => setReservationIsConfirming(false)}
                  showTabs={true}
                >
                  <UnifiedEventForm
                    mode="create"
                    apiToken={apiToken}
                    prefillData={reservationPrefillData}
                    hideActionBar={true}
                    onHasChangesChange={setReservationHasChanges}
                    onFormValidChange={setReservationIsFormValid}
                    onIsSavingChange={setReservationIsSaving}
                    onSaveFunctionReady={(fn) => setReservationSaveFunction(() => fn)}
                    onCancel={() => {
                      setShowReservationModal(false);
                      setReservationPrefillData(null);
                      setReservationHasChanges(false);
                      setReservationIsFormValid(false);
                      setReservationSaveFunction(null);
                      setReservationIsConfirming(false);
                    }}
                    onSuccess={() => {
                      setShowReservationModal(false);
                      setReservationPrefillData(null);
                      setReservationHasChanges(false);
                      setReservationIsFormValid(false);
                      setReservationSaveFunction(null);
                      setReservationIsConfirming(false);
                      // Trigger calendar refresh
                      window.dispatchEvent(new CustomEvent('ai-chat-calendar-refresh'));
                    }}
                  />
                </ReviewModal>
              </div>

              {/* Draft Edit Modal - for editing drafts from MyReservations */}
              <div className="scale-80">
                <ReviewModal
                  isOpen={showDraftModal}
                  title={draftPrefillData?.eventTitle ? `Edit Draft: ${draftPrefillData.eventTitle}` : 'Edit Draft'}
                  itemStatus="draft"
                  mode="create"
                  onClose={() => {
                    // Check for unsaved changes
                    if (draftHasChanges) {
                      setShowDraftSaveDialog(true);
                      return;
                    }
                    setShowDraftModal(false);
                    setDraftPrefillData(null);
                    setDraftHasChanges(false);
                    setDraftIsFormValid(false);
                    setDraftSaveFunction(null);
                    setDraftIsConfirming(false);
                    setDraftId(null);
                    draftInitializedRef.current = false;
                  }}
                  // Draft-specific props
                  isDraft={draftIsDraft}
                  onSaveDraft={async () => {
                    // Merge prefillData with formData to preserve all fields
                    // draftFormData may only have changed fields, so we need prefillData as base
                    const formData = { ...draftPrefillData, ...draftFormData };
                    if (!formData || !formData.eventTitle?.trim()) {
                      showWarning('Event title is required to save as draft');
                      return;
                    }

                    setSavingDraftInProgress(true);
                    try {
                      // Debug: log what we're saving
                      logger.log('🔍 Draft save - draftPrefillData:', draftPrefillData);
                      logger.log('🔍 Draft save - draftFormData:', draftFormData);
                      logger.log('🔍 Draft save - draftFormData?.categories:', draftFormData?.categories);
                      logger.log('🔍 Draft save - merged formData:', formData);
                      logger.log('🔍 Draft save - formData.categories:', formData.categories);
                      logger.log('🔍 Draft save - formData.mecCategories:', formData.mecCategories);

                      // Build draft payload
                      const payload = {
                        eventTitle: formData.eventTitle || '',
                        eventDescription: formData.eventDescription || '',
                        startDateTime: formData.startDate && formData.startTime
                          ? `${formData.startDate}T${formData.startTime}`
                          : null,
                        endDateTime: formData.endDate && formData.endTime
                          ? `${formData.endDate}T${formData.endTime}`
                          : null,
                        // Separate date/time fields for partial draft support
                        startDate: formData.startDate || null,
                        startTime: formData.startTime || null,
                        endDate: formData.endDate || null,
                        endTime: formData.endTime || null,
                        attendeeCount: parseInt(formData.attendeeCount) || 0,
                        requestedRooms: formData.requestedRooms || formData.locations || [],
                        specialRequirements: formData.specialRequirements || '',
                        department: formData.department || '',
                        phone: formData.phone || '',
                        setupTime: formData.setupTime || null,
                        teardownTime: formData.teardownTime || null,
                        doorOpenTime: formData.doorOpenTime || null,
                        doorCloseTime: formData.doorCloseTime || null,
                        categories: formData.categories || formData.mecCategories || [],  // categories is the correct field
                        services: formData.services || {},
                        virtualMeetingUrl: formData.virtualMeetingUrl || null,
                        isOffsite: formData.isOffsite || false,
                        offsiteName: formData.offsiteName || '',
                        offsiteAddress: formData.offsiteAddress || ''
                      };

                      const endpoint = draftId
                        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}`
                        : `${APP_CONFIG.API_BASE_URL}/room-reservations/draft`;

                      logger.log('🔍 Draft save - sending payload:', payload);
                      logger.log('🔍 Draft save - payload.categories:', payload.categories);
                      logger.log('🔍 Draft save - payload.services:', payload.services);
                      logger.log('🔍 Draft save - endpoint:', endpoint);
                      logger.log('🔍 Draft save - method:', draftId ? 'PUT' : 'POST');

                      const response = await fetch(endpoint, {
                        method: draftId ? 'PUT' : 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${apiToken}`
                        },
                        body: JSON.stringify(payload)
                      });

                      logger.log('🔍 Draft save - response status:', response.status);

                      if (!response.ok) {
                        const errorText = await response.text();
                        console.error('🔍 Draft save - error response:', errorText);
                        throw new Error('Failed to save draft: ' + errorText);
                      }

                      const result = await response.json();
                      logger.log('🔍 Draft save - success result:', result);
                      if (!draftId) {
                        setDraftId(result._id);
                      }
                      setDraftHasChanges(false);
                      logger.log('Draft saved:', result);

                      // Refresh my reservations list
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    } catch (error) {
                      logger.error('Error saving draft:', error);
                      showError(error, { context: 'App.onSaveDraft', userMessage: 'Failed to save draft' });
                    } finally {
                      setSavingDraftInProgress(false);
                    }
                  }}
                  onSubmitDraft={async () => {
                    if (!draftId) {
                      showWarning('No draft to submit');
                      return;
                    }

                    setDraftIsSaving(true);
                    try {
                      const response = await fetch(
                        `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}/submit`,
                        {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiToken}`
                          }
                        }
                      );

                      if (!response.ok) {
                        const errorData = await response.json();
                        if (errorData.validationErrors) {
                          throw new Error(`Incomplete draft: ${errorData.validationErrors.join(', ')}`);
                        }
                        throw new Error(errorData.error || 'Failed to submit draft');
                      }

                      const result = await response.json();
                      logger.log('Draft submitted:', result);

                      // Role-aware success feedback
                      if (result.autoApproved) {
                        showSuccess('Event created and published to calendar');
                      } else {
                        showSuccess('Request submitted for review');
                      }

                      // Close modal and reset state
                      setShowDraftModal(false);
                      setDraftPrefillData(null);
                      setDraftHasChanges(false);
                      setDraftIsFormValid(false);
                      setDraftSaveFunction(null);
                      setDraftIsConfirming(false);
                      setDraftId(null);
                      draftInitializedRef.current = false;

                      // Refresh my reservations
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    } catch (error) {
                      logger.error('Error submitting draft:', error);
                      showError(error, { context: 'App.onSubmitDraft', userMessage: 'Failed to submit draft' });
                    } finally {
                      setDraftIsSaving(false);
                    }
                  }}
                  savingDraft={savingDraftInProgress}
                  showDraftDialog={showDraftSaveDialog}
                  onDraftDialogSave={async () => {
                    // Merge prefillData with formData to preserve all fields
                    const formData = { ...draftPrefillData, ...draftFormData };
                    if (!formData || !formData.eventTitle?.trim()) {
                      // Can't save without title, just close
                      setShowDraftSaveDialog(false);
                      setShowDraftModal(false);
                      setDraftFormData(null);
                      setDraftPrefillData(null);
                      setDraftHasChanges(false);
                      setDraftId(null);
                      draftInitializedRef.current = false;
                      return;
                    }

                    setSavingDraftInProgress(true);
                    try {
                      const payload = {
                        eventTitle: formData.eventTitle || '',
                        eventDescription: formData.eventDescription || '',
                        startDateTime: formData.startDate && formData.startTime
                          ? `${formData.startDate}T${formData.startTime}`
                          : null,
                        endDateTime: formData.endDate && formData.endTime
                          ? `${formData.endDate}T${formData.endTime}`
                          : null,
                        attendeeCount: parseInt(formData.attendeeCount) || 0,
                        requestedRooms: formData.requestedRooms || formData.locations || [],
                        specialRequirements: formData.specialRequirements || '',
                        categories: formData.categories || formData.mecCategories || [],  // categories is the correct field
                        services: formData.services || {},
                        // Include additional fields that might be in prefillData
                        setupTime: formData.setupTime || null,
                        teardownTime: formData.teardownTime || null,
                        doorOpenTime: formData.doorOpenTime || null,
                        doorCloseTime: formData.doorCloseTime || null,
                        virtualMeetingUrl: formData.virtualMeetingUrl || null,
                        isOffsite: formData.isOffsite || false,
                        offsiteName: formData.offsiteName || '',
                        offsiteAddress: formData.offsiteAddress || ''
                      };

                      const endpoint = draftId
                        ? `${APP_CONFIG.API_BASE_URL}/room-reservations/draft/${draftId}`
                        : `${APP_CONFIG.API_BASE_URL}/room-reservations/draft`;

                      await fetch(endpoint, {
                        method: draftId ? 'PUT' : 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${apiToken}`
                        },
                        body: JSON.stringify(payload)
                      });

                      // Refresh my reservations list
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    } catch (error) {
                      logger.error('Error saving draft before close:', error);
                    } finally {
                      setSavingDraftInProgress(false);
                    }

                    setShowDraftSaveDialog(false);
                    setShowDraftModal(false);
                    setDraftFormData(null);
                    setDraftPrefillData(null);
                    setDraftHasChanges(false);
                    setDraftIsFormValid(false);
                    setDraftSaveFunction(null);
                    setDraftId(null);
                    draftInitializedRef.current = false;
                  }}
                  onDraftDialogDiscard={() => {
                    setShowDraftSaveDialog(false);
                    setShowDraftModal(false);
                    setDraftFormData(null);
                    setDraftPrefillData(null);
                    setDraftHasChanges(false);
                    setDraftIsFormValid(false);
                    setDraftSaveFunction(null);
                    setDraftId(null);
                    draftInitializedRef.current = false;
                  }}
                  onDraftDialogCancel={() => {
                    setShowDraftSaveDialog(false);
                  }}
                  canSaveDraft={!!(draftFormData?.eventTitle?.trim() || draftPrefillData?.eventTitle?.trim()) && draftHasChanges}
                  hasChanges={draftHasChanges}
                  isFormValid={draftIsFormValid}
                  isSaving={draftIsSaving}
                  showTabs={true}
                >
                  <UnifiedEventForm
                    key={draftId || 'new-draft'}  // Force remount when draft changes to ensure fresh state
                    mode="create"
                    apiToken={apiToken}
                    prefillData={draftPrefillData}
                    hideActionBar={true}
                    onHasChangesChange={setDraftHasChanges}
                    onFormValidChange={setDraftIsFormValid}
                    onIsSavingChange={setDraftIsSaving}
                    onSaveFunctionReady={(fn) => setDraftSaveFunction(() => fn)}
                    onDataChange={(updatedData) => {
                      logger.log('🔄 Draft onDataChange received:', updatedData);
                      logger.log('🔄 Draft onDataChange - categories:', updatedData?.categories);
                      logger.log('🔄 Draft onDataChange - services:', updatedData?.services);
                      setDraftFormData(prev => {
                        const merged = {
                          ...(prev || draftPrefillData || {}),
                          ...updatedData
                        };
                        logger.log('🔄 Draft onDataChange - merged result:', merged);
                        logger.log('🔄 Draft onDataChange - merged.categories:', merged?.categories);
                        return merged;
                      });
                    }}
                    onCancel={() => {
                      if (draftHasChanges) {
                        setShowDraftSaveDialog(true);
                        return;
                      }
                      setShowDraftModal(false);
                      setDraftFormData(null);
                      setDraftPrefillData(null);
                      setDraftHasChanges(false);
                      setDraftIsFormValid(false);
                      setDraftSaveFunction(null);
                      setDraftId(null);
                      draftInitializedRef.current = false;
                    }}
                    onSuccess={() => {
                      setShowDraftModal(false);
                      setDraftFormData(null);
                      setDraftPrefillData(null);
                      setDraftHasChanges(false);
                      setDraftIsFormValid(false);
                      setDraftSaveFunction(null);
                      setDraftId(null);
                      draftInitializedRef.current = false;
                      // Refresh my reservations
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    }}
                  />
                </ReviewModal>
              </div>

              {/* Pending Edit Modal - for editing pending events from MyReservations */}
              <div className="scale-80">
                <ReviewModal
                  isOpen={showPendingEditModal}
                  title={pendingEditPrefillData?.eventTitle ? `Edit Pending: ${pendingEditPrefillData.eventTitle}` : 'Edit Pending Reservation'}
                  itemStatus="pending"
                  mode="create"
                  onClose={() => {
                    if (pendingEditHasChanges) {
                      setShowPendingEditDiscardDialog(true);
                      return;
                    }
                    setShowPendingEditModal(false);
                    setPendingEditPrefillData(null);
                    setPendingEditFormData(null);
                    setPendingEditHasChanges(false);
                    setPendingEditIsFormValid(false);
                    setPendingEditEventId(null);
                    setPendingEditVersion(null);
                    pendingEditInitializedRef.current = false;
                  }}
                  isDraft={false}
                  onSavePendingEdit={async () => {
                    const formData = { ...pendingEditPrefillData, ...pendingEditFormData };
                    if (!formData || !formData.eventTitle?.trim()) {
                      showWarning('Event title is required');
                      return;
                    }
                    if (!formData.startDate || !formData.endDate) {
                      showWarning('Start date and end date are required');
                      return;
                    }
                    if (!formData.startTime || !formData.endTime) {
                      showWarning('Start time and end time are required');
                      return;
                    }

                    setPendingEditIsSaving(true);
                    try {
                      const payload = {
                        _version: pendingEditVersion,
                        eventTitle: formData.eventTitle || '',
                        eventDescription: formData.eventDescription || '',
                        startDateTime: formData.startDate && formData.startTime
                          ? `${formData.startDate}T${formData.startTime}`
                          : null,
                        endDateTime: formData.endDate && formData.endTime
                          ? `${formData.endDate}T${formData.endTime}`
                          : null,
                        startDate: formData.startDate || null,
                        startTime: formData.startTime || null,
                        endDate: formData.endDate || null,
                        endTime: formData.endTime || null,
                        attendeeCount: parseInt(formData.attendeeCount) || 0,
                        requestedRooms: formData.requestedRooms || formData.locations || [],
                        specialRequirements: formData.specialRequirements || '',
                        department: formData.department || '',
                        phone: formData.phone || '',
                        setupTime: formData.setupTime || null,
                        teardownTime: formData.teardownTime || null,
                        doorOpenTime: formData.doorOpenTime || null,
                        doorCloseTime: formData.doorCloseTime || null,
                        categories: formData.categories || formData.mecCategories || [],
                        services: formData.services || {},
                        virtualMeetingUrl: formData.virtualMeetingUrl || null,
                        isOffsite: formData.isOffsite || false,
                        offsiteName: formData.offsiteName || '',
                        offsiteAddress: formData.offsiteAddress || '',
                      };

                      const response = await fetch(
                        `${APP_CONFIG.API_BASE_URL}/room-reservations/${pendingEditEventId}/edit`,
                        {
                          method: 'PUT',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiToken}`
                          },
                          body: JSON.stringify(payload)
                        }
                      );

                      if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Failed to save changes');
                      }

                      const result = await response.json();
                      setPendingEditVersion(result._version);

                      // Close modal and reset state
                      setShowPendingEditModal(false);
                      setPendingEditPrefillData(null);
                      setPendingEditFormData(null);
                      setPendingEditHasChanges(false);
                      setPendingEditIsFormValid(false);
                      setPendingEditEventId(null);
                      setPendingEditVersion(null);
                      pendingEditInitializedRef.current = false;

                      showSuccess('Reservation updated successfully');
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    } catch (error) {
                      logger.error('Error saving pending edit:', error);
                      showError(error, { context: 'App.onSavePendingEdit', userMessage: 'Failed to save changes' });
                    } finally {
                      setPendingEditIsSaving(false);
                    }
                  }}
                  savingPendingEdit={pendingEditIsSaving}
                  showDiscardDialog={showPendingEditDiscardDialog}
                  onDiscardDialogDiscard={() => {
                    setShowPendingEditDiscardDialog(false);
                    setShowPendingEditModal(false);
                    setPendingEditPrefillData(null);
                    setPendingEditFormData(null);
                    setPendingEditHasChanges(false);
                    setPendingEditIsFormValid(false);
                    setPendingEditEventId(null);
                    setPendingEditVersion(null);
                    pendingEditInitializedRef.current = false;
                  }}
                  onDiscardDialogCancel={() => {
                    setShowPendingEditDiscardDialog(false);
                  }}
                  hasChanges={pendingEditHasChanges}
                  isFormValid={pendingEditIsFormValid}
                  isSaving={pendingEditIsSaving}
                  showTabs={true}
                >
                  <UnifiedEventForm
                    key={pendingEditEventId || 'pending-edit'}
                    mode="create"
                    apiToken={apiToken}
                    prefillData={pendingEditPrefillData}
                    hideActionBar={true}
                    onHasChangesChange={setPendingEditHasChanges}
                    onFormValidChange={setPendingEditIsFormValid}
                    onDataChange={(updatedData) => {
                      setPendingEditFormData(prev => ({
                        ...(prev || pendingEditPrefillData || {}),
                        ...updatedData
                      }));
                    }}
                    onCancel={() => {
                      if (pendingEditHasChanges) {
                        setShowPendingEditDiscardDialog(true);
                        return;
                      }
                      setShowPendingEditModal(false);
                      setPendingEditPrefillData(null);
                      setPendingEditFormData(null);
                      setPendingEditHasChanges(false);
                      setPendingEditIsFormValid(false);
                      setPendingEditEventId(null);
                      setPendingEditVersion(null);
                      pendingEditInitializedRef.current = false;
                    }}
                    onSuccess={() => {
                      setShowPendingEditModal(false);
                      setPendingEditPrefillData(null);
                      setPendingEditFormData(null);
                      setPendingEditHasChanges(false);
                      setPendingEditIsFormValid(false);
                      setPendingEditEventId(null);
                      setPendingEditVersion(null);
                      pendingEditInitializedRef.current = false;
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    }}
                  />
                </ReviewModal>
              </div>

              {/* Edit Request Modal - for requesting edits on approved/published events from MyReservations */}
              <div className="scale-80">
                <ReviewModal
                  isOpen={showEditRequestModal}
                  title={editRequestPrefillData?.eventTitle ? `Request Edit: ${editRequestPrefillData.eventTitle}` : 'Request Edit'}
                  itemStatus="approved"
                  mode="create"
                  onClose={() => {
                    if (editRequestHasChanges) {
                      setShowEditRequestDiscardDialog(true);
                      return;
                    }
                    setShowEditRequestModal(false);
                    setEditRequestPrefillData(null);
                    setEditRequestFormData(null);
                    setEditRequestHasChanges(false);
                    setEditRequestIsFormValid(false);
                    setEditRequestEventId(null);
                    setEditRequestVersion(null);
                    editRequestInitializedRef.current = false;
                  }}
                  isDraft={false}
                  onSubmitEditRequestModal={async () => {
                    const formData = { ...editRequestPrefillData, ...editRequestFormData };
                    if (!formData || !formData.eventTitle?.trim()) {
                      showWarning('Event title is required');
                      return;
                    }
                    if (!formData.startDate || !formData.endDate) {
                      showWarning('Start date and end date are required');
                      return;
                    }
                    if (!formData.startTime || !formData.endTime) {
                      showWarning('Start time and end time are required');
                      return;
                    }

                    setEditRequestIsSaving(true);
                    try {
                      const payload = {
                        _version: editRequestVersion,
                        eventTitle: formData.eventTitle || '',
                        eventDescription: formData.eventDescription || '',
                        startDateTime: formData.startDate && formData.startTime
                          ? `${formData.startDate}T${formData.startTime}`
                          : null,
                        endDateTime: formData.endDate && formData.endTime
                          ? `${formData.endDate}T${formData.endTime}`
                          : null,
                        attendeeCount: parseInt(formData.attendeeCount) || 0,
                        requestedRooms: formData.requestedRooms || formData.locations || [],
                        specialRequirements: formData.specialRequirements || '',
                        department: formData.department || '',
                        phone: formData.phone || '',
                        setupTime: formData.setupTime || null,
                        teardownTime: formData.teardownTime || null,
                        doorOpenTime: formData.doorOpenTime || null,
                        doorCloseTime: formData.doorCloseTime || null,
                        categories: formData.categories || formData.mecCategories || [],
                        services: formData.services || {},
                        virtualMeetingUrl: formData.virtualMeetingUrl || null,
                        isOffsite: formData.isOffsite || false,
                        offsiteName: formData.offsiteName || '',
                        offsiteAddress: formData.offsiteAddress || '',
                      };

                      const response = await fetch(
                        `${APP_CONFIG.API_BASE_URL}/events/${editRequestEventId}/request-edit`,
                        {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiToken}`
                          },
                          body: JSON.stringify(payload)
                        }
                      );

                      if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Failed to submit edit request');
                      }

                      // Close modal and reset state
                      setShowEditRequestModal(false);
                      setEditRequestPrefillData(null);
                      setEditRequestFormData(null);
                      setEditRequestHasChanges(false);
                      setEditRequestIsFormValid(false);
                      setEditRequestEventId(null);
                      setEditRequestVersion(null);
                      editRequestInitializedRef.current = false;

                      showSuccess('Edit request submitted');
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    } catch (error) {
                      logger.error('Error submitting edit request:', error);
                      showError(error, { context: 'App.onSubmitEditRequest', userMessage: 'Failed to submit edit request' });
                    } finally {
                      setEditRequestIsSaving(false);
                    }
                  }}
                  submittingEditRequestModal={editRequestIsSaving}
                  showDiscardDialog={showEditRequestDiscardDialog}
                  onDiscardDialogDiscard={() => {
                    setShowEditRequestDiscardDialog(false);
                    setShowEditRequestModal(false);
                    setEditRequestPrefillData(null);
                    setEditRequestFormData(null);
                    setEditRequestHasChanges(false);
                    setEditRequestIsFormValid(false);
                    setEditRequestEventId(null);
                    setEditRequestVersion(null);
                    editRequestInitializedRef.current = false;
                  }}
                  onDiscardDialogCancel={() => {
                    setShowEditRequestDiscardDialog(false);
                  }}
                  hasChanges={editRequestHasChanges}
                  isFormValid={editRequestIsFormValid}
                  isSaving={editRequestIsSaving}
                  showTabs={true}
                >
                  <UnifiedEventForm
                    key={editRequestEventId || 'edit-request'}
                    mode="create"
                    apiToken={apiToken}
                    prefillData={editRequestPrefillData}
                    hideActionBar={true}
                    onHasChangesChange={setEditRequestHasChanges}
                    onFormValidChange={setEditRequestIsFormValid}
                    onDataChange={(updatedData) => {
                      setEditRequestFormData(prev => ({
                        ...(prev || editRequestPrefillData || {}),
                        ...updatedData
                      }));
                    }}
                    onCancel={() => {
                      if (editRequestHasChanges) {
                        setShowEditRequestDiscardDialog(true);
                        return;
                      }
                      setShowEditRequestModal(false);
                      setEditRequestPrefillData(null);
                      setEditRequestFormData(null);
                      setEditRequestHasChanges(false);
                      setEditRequestIsFormValid(false);
                      setEditRequestEventId(null);
                      setEditRequestVersion(null);
                      editRequestInitializedRef.current = false;
                    }}
                    onSuccess={() => {
                      setShowEditRequestModal(false);
                      setEditRequestPrefillData(null);
                      setEditRequestFormData(null);
                      setEditRequestHasChanges(false);
                      setEditRequestIsFormValid(false);
                      setEditRequestEventId(null);
                      setEditRequestVersion(null);
                      editRequestInitializedRef.current = false;
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    }}
                  />
                </ReviewModal>
              </div>

              {/* New Reservation Modal - triggered from MyReservations */}
              <NewReservationModal
                apiToken={apiToken}
                selectedCalendarId={selectedCalendarId}
                availableCalendars={availableCalendars}
              />
              </RoomProvider>
            </TimezoneProvider>
          ) : signedOut ? (
            <div className="signed-out-landing">
              <h2>See you next time!</h2>
              <p>You've successfully signed out.</p>
            </div>
          ) : !isInitialized ? (
            // Show skeleton while MSAL is initializing
            <AppSkeleton />
          ) : (
            <div className="welcome-message">
              <p>Welcome to the Outlook Custom Calendar App.</p>
              <p>Please sign in with your Microsoft account to view your calendar.</p>
            </div>
          )}
        </main>

        {/* Global Error Report Modal */}
        <ErrorReportModal
          isOpen={showErrorModal}
          onClose={() => {
            setShowErrorModal(false);
            setPendingError(null);
          }}
          error={pendingError}
          apiToken={apiToken}
        />

      </div>
        </RoleSimulationProvider>
      </Router>
      {/* TanStack Query DevTools - disabled to avoid UI clutter
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      */}
    </QueryClientProvider>
  );
}

export default App;