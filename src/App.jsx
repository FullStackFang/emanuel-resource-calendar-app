import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useMsal } from '@azure/msal-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { apiRequest } from './config/authConfig';
import queryClient from './config/queryClient';
import AppHeader from './components/AppHeader';
import UnifiedEventForm from './components/UnifiedEventForm';
import ReviewModal from './components/shared/ReviewModal';
import NewReservationModal from './components/NewReservationModal';
import LoadingSpinner from './components/shared/LoadingSpinner';
import ErrorReportModal from './components/shared/ErrorReportModal';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navigation from './components/Navigation';
import { TimezoneProvider } from './context/TimezoneContext';
import { RoomProvider } from './context/LocationContext';
import { RoleSimulationProvider } from './context/RoleSimulationContext';
import { useAuth } from './context/AuthContext';
import APP_CONFIG, { fetchRuntimeConfig } from './config/config';
import { logger } from './utils/logger';
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

              {/* AI Chat Reservation Modal */}
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
