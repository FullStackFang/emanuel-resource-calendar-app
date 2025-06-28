import { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest, apiRequest } from './config/authConfig';
import Authentication from './components/Authentication';
import Calendar from './components/Calendar';
import Settings from './components/Settings';
import MySettings from './components/MySettings';
import CalendarSelector from './components/CalendarSelector';
import SchemaExtensionAdmin from './components/SchemaExtensionAdmin';
import UserAdmin from './components/UserAdmin';
import EventSyncAdmin from './components/EventSyncAdmin';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navigation from './components/Navigation';
import { TimezoneProvider } from './context/TimezoneContext'; // Add this import
import APP_CONFIG from './config/config';
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

  // Handle calendar change
  const handleCalendarChange = (newCalendarId) => {
    setChangingCalendar(true);
    setSelectedCalendarId(newCalendarId);
  };


  // Handle registration times toggle
  const handleRegistrationTimesToggle = useCallback((enabled) => {
    setShowRegistrationTimes(enabled);
    console.log('Registration times toggled:', enabled);
  }, []);

  // Memoized token acquisition function
  const acquireTokens = useCallback(async (account) => {
    if (!account) {
      console.log('No account provided for token acquisition');
      return;
    }

    console.log('Acquiring tokens for account:', account.username);

    // Acquire Graph token
    try {
      console.log('Attempting to acquire Graph token silently');
      const graphResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account
      });
      console.log('Graph token acquired successfully');
      setGraphToken(graphResponse.accessToken);
    } catch (error) {
      console.error('Silent Graph token acquisition failed:', error);
      try {
        console.log('Falling back to popup for Graph token');
        const graphPopup = await instance.acquireTokenPopup({
          ...loginRequest,
          account
        });
        console.log('Graph token acquired via popup');
        setGraphToken(graphPopup.accessToken);
      } catch (popupError) {
        console.error('Graph token popup failed:', popupError);
      }
    }

    // Acquire API token
    try {
      console.log('Attempting to acquire API token silently');
      const apiResponse = await instance.acquireTokenSilent({
        ...apiRequest,
        account
      });
      console.log('API token acquired successfully');
      setApiToken(apiResponse.accessToken);
    } catch (error) {
      console.error('Silent API token acquisition failed:', error);
      try {
        console.log('Falling back to popup for API token');
        const apiPopup = await instance.acquireTokenPopup({
          ...apiRequest,
          account
        });
        console.log('API token acquired via popup');
        setApiToken(apiPopup.accessToken);
      } catch (popupError) {
        console.error('API token popup failed:', popupError);
      }
    }
  }, [instance]);

  // Initialize MSAL
  useEffect(() => {
    const initializeMsal = async () => {
      try {
        console.log('Initializing MSAL...');
        // Wait for MSAL to be ready (if not already)
        if (!instance.getActiveAccount() && instance.getAllAccounts().length > 0) {
          instance.setActiveAccount(instance.getAllAccounts()[0]);
        }
        setIsInitialized(true);
        console.log('MSAL initialized successfully');
      } catch (error) {
        console.error('MSAL initialization error:', error);
      }
    };

    initializeMsal();
  }, [instance]);

  // Handle silent token acquisition after initialization
  useEffect(() => {
    const silentLogin = async () => {
      if (!isInitialized) {
        console.log('MSAL not yet initialized, skipping token acquisition');
        return;
      }

      console.log('Attempting silent login after initialization');
      const accounts = instance.getAllAccounts();
      if (accounts.length > 0) {
        console.log('Found existing account, acquiring tokens');
        await acquireTokens(accounts[0]);
      } else {
        console.log('No existing accounts found');
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

  return (
    <Router>
      <div className="app-container">
        <header>
          <h1>Temple Events Scheduler</h1>
          <Authentication onSignIn={handleSignIn} onSignOut={handleSignOut} />
        </header>
        <main>
          {apiToken && graphToken ? (
            // Wrap authenticated routes with TimezoneProvider
            <TimezoneProvider 
              apiToken={apiToken}
              apiBaseUrl={APP_CONFIG.API_BASE_URL}
              initialTimezone="UTC"
            >
              <Navigation 
                selectedCalendarId={selectedCalendarId}
                availableCalendars={availableCalendars}
                onCalendarChange={handleCalendarChange}
                changingCalendar={changingCalendar}
              />
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
                <Route path="/admin" element={<SchemaExtensionAdmin apiToken={apiToken} />} />
                <Route path="/admin/users" element={<UserAdmin apiToken={apiToken} />} />
                <Route path="/admin/event-sync" element={
                  <EventSyncAdmin 
                    graphToken={graphToken} 
                    apiToken={apiToken} 
                    selectedCalendarId={selectedCalendarId}
                    availableCalendars={availableCalendars}
                    onCalendarChange={handleCalendarChange}
                    changingCalendar={changingCalendar}
                  />
                } />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
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
    </Router>
  );
}

export default App;