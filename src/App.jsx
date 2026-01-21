import { useState, useEffect, useCallback, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { loginRequest, apiRequest } from './config/authConfig';
import queryClient from './config/queryClient';
import AppHeader from './components/AppHeader';
import Calendar from './components/Calendar';
import Settings from './components/Settings';
import MySettings from './components/MySettings';
import CalendarSelector from './components/CalendarSelector';
import UserAdmin from './components/UserAdmin';
import UnifiedEventsAdmin from './components/UnifiedEventsAdmin';
import CategoryManagement from './components/CategoryManagement';
import CalendarConfigAdmin from './components/CalendarConfigAdmin';
import UnifiedEventForm from './components/UnifiedEventForm';
import MyReservations from './components/MyReservations';
import LocationReview from './components/LocationReview';
import ReservationRequests from './components/ReservationRequests';
import FeatureManagement from './components/FeatureManagement';
import EmailTestAdmin from './components/EmailTestAdmin';
import AIChat from './components/AIChat';
import ReviewModal from './components/shared/ReviewModal';
import { useReviewModal } from './hooks/useReviewModal';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navigation from './components/Navigation';
import { TimezoneProvider } from './context/TimezoneContext';
import { RoomProvider } from './context/LocationContext';
import { RoleSimulationProvider } from './context/RoleSimulationContext';
import APP_CONFIG from './config/config';
import { logger } from './utils/logger';
import calendarDebug from './utils/calendarDebug';
import './App.css';

function App() {
  const [graphToken, setGraphToken] = useState(null);
  const [apiToken, setApiToken] = useState(null);
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

      console.log('📂 Opening draft - raw draft data:', draft);
      console.log('📂 Opening draft - draft.categories:', draft.categories);
      console.log('📂 Opening draft - draft.mecCategories:', draft.mecCategories);
      console.log('📂 Opening draft - draft.services:', draft.services);
      console.log('📂 Opening draft - prefillData:', prefillData);
      console.log('📂 Opening draft - prefillData.categories:', prefillData.categories);
      console.log('📂 Opening draft - prefillData.services:', prefillData.services);

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

  // Memoized token acquisition function
  const acquireTokens = useCallback(async (account) => {
    if (!account) {
      logger.warn('No account provided for token acquisition');
      return;
    }

    logger.log('Acquiring tokens for account:', account.username);

    // Acquire Graph token
    try {
      logger.debug('Attempting to acquire Graph token silently');
      const graphResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account
      });
      logger.debug('Graph token acquired successfully');
      setGraphToken(graphResponse.accessToken);
    } catch (error) {
      logger.error('Silent Graph token acquisition failed:', error);
      try {
        logger.debug('Falling back to popup for Graph token');
        const graphPopup = await instance.acquireTokenPopup({
          ...loginRequest,
          account
        });
        logger.debug('Graph token acquired via popup');
        setGraphToken(graphPopup.accessToken);
      } catch (popupError) {
        logger.error('Graph token popup failed:', popupError);
      }
    }

    // Acquire API token
    try {
      logger.debug('Attempting to acquire API token silently');
      const apiResponse = await instance.acquireTokenSilent({
        ...apiRequest,
        account
      });
      logger.debug('API token acquired successfully');
      setApiToken(apiResponse.accessToken);
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
      } catch (popupError) {
        logger.error('API token popup failed:', popupError);
      }
    }
  }, [instance]);

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
                <Route path="/settings" element={<Settings graphToken={graphToken} />} />
                <Route path="/my-settings" element={<MySettings apiToken={apiToken} />} />
                <Route path="/admin/users" element={<UserAdmin apiToken={apiToken} />} />
                <Route path="/admin/events" element={<UnifiedEventsAdmin apiToken={apiToken} graphToken={graphToken} />} />
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
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>

              {/* AI Chat */}
              <AIChat
                isOpen={showAIChat}
                onClose={() => setShowAIChat(false)}
                apiToken={apiToken}
              />
              <button
                className="ai-chat-fab"
                onClick={() => setShowAIChat(true)}
                title="Open Chat Assistant"
              >
                <img src="/emanuel_logo.png" alt="Chat" className="ai-chat-fab-icon" />
              </button>

              {/* AI Chat Reservation Modal - wrapped with zoom to match calendar page scaling */}
              <div style={{ zoom: 0.8 }}>
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
              <div style={{ zoom: 0.8 }}>
                <ReviewModal
                  isOpen={showDraftModal}
                  title="Edit Draft"
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
                      alert('Event title is required to save as draft');
                      return;
                    }

                    setSavingDraftInProgress(true);
                    try {
                      // Debug: log what we're saving
                      console.log('🔍 Draft save - draftPrefillData:', draftPrefillData);
                      console.log('🔍 Draft save - draftFormData:', draftFormData);
                      console.log('🔍 Draft save - draftFormData?.categories:', draftFormData?.categories);
                      console.log('🔍 Draft save - merged formData:', formData);
                      console.log('🔍 Draft save - formData.categories:', formData.categories);
                      console.log('🔍 Draft save - formData.mecCategories:', formData.mecCategories);

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

                      console.log('🔍 Draft save - sending payload:', payload);
                      console.log('🔍 Draft save - payload.categories:', payload.categories);
                      console.log('🔍 Draft save - payload.services:', payload.services);
                      console.log('🔍 Draft save - endpoint:', endpoint);
                      console.log('🔍 Draft save - method:', draftId ? 'PUT' : 'POST');

                      const response = await fetch(endpoint, {
                        method: draftId ? 'PUT' : 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${apiToken}`
                        },
                        body: JSON.stringify(payload)
                      });

                      console.log('🔍 Draft save - response status:', response.status);

                      if (!response.ok) {
                        const errorText = await response.text();
                        console.error('🔍 Draft save - error response:', errorText);
                        throw new Error('Failed to save draft: ' + errorText);
                      }

                      const result = await response.json();
                      console.log('🔍 Draft save - success result:', result);
                      if (!draftId) {
                        setDraftId(result._id);
                      }
                      setDraftHasChanges(false);
                      logger.log('Draft saved:', result);

                      // Refresh my reservations list
                      window.dispatchEvent(new CustomEvent('refresh-my-reservations'));
                    } catch (error) {
                      logger.error('Error saving draft:', error);
                      alert('Failed to save draft: ' + error.message);
                    } finally {
                      setSavingDraftInProgress(false);
                    }
                  }}
                  onSubmitDraft={async () => {
                    if (!draftId) {
                      alert('No draft to submit');
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
                      alert('Failed to submit draft: ' + error.message);
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
                      console.log('🔄 Draft onDataChange received:', updatedData);
                      console.log('🔄 Draft onDataChange - categories:', updatedData?.categories);
                      console.log('🔄 Draft onDataChange - services:', updatedData?.services);
                      setDraftFormData(prev => {
                        const merged = {
                          ...(prev || draftPrefillData || {}),
                          ...updatedData
                        };
                        console.log('🔄 Draft onDataChange - merged result:', merged);
                        console.log('🔄 Draft onDataChange - merged.categories:', merged?.categories);
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
              </RoomProvider>
            </TimezoneProvider>
          ) : signedOut ? (
            <div className="signed-out-landing">
              <h2>See you next time!</h2>
              <p>You've successfully signed out.</p>
            </div>
          ) : (
            <div className="welcome-message">
              <p>Welcome to the Outlook Custom Calendar App.</p>
              <p>Please sign in with your Microsoft account to view your calendar.</p>
            </div>
          )}
        </main>
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