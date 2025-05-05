import { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest, apiRequest } from './config/authConfig';
import Authentication from './components/Authentication';
import Calendar from './components/Calendar';
import Settings from './components/Settings';
import MySettings from './components/MySettings';
import SchemaExtensionAdmin from './components/SchemaExtensionAdmin';
import UserAdmin from './components/UserAdmin';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navigation from './components/Navigation';
import './App.css';

function App() {
  const [graphToken, setGraphToken] = useState(null);
  const [apiToken, setApiToken] = useState(null);
  const [signedOut, setSignedOut] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const { instance } = useMsal();

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
            <>
              <Navigation />
              <Routes>
                <Route path="/" element={<Calendar apiToken={apiToken} graphToken={graphToken} />} />
                <Route path="/settings" element={<Settings graphToken={graphToken} />} />
                <Route path="/my-settings" element={<MySettings apiToken={apiToken} />} />
                <Route path="/admin" element={<SchemaExtensionAdmin apiToken={apiToken} />} />
                <Route path="/admin/users" element={<UserAdmin apiToken={apiToken} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </>
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