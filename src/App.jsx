// src/App.jsx
import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from './config/authConfig';
import Authentication from './components/Authentication';
import Calendar from './components/Calendar';
import SchemaExtensionAdmin from './components/SchemaExtensionAdmin';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navigation from './components/Navigation'
import './App.css';

function App() {
  const [accessToken, setAccessToken] = useState(null);
  const [signedOut, setSignedOut] = useState(false);
  const { instance } = useMsal();

  const handleSignIn = (token) => {
    setAccessToken(token);
    setSignedOut(false);
  };

  const handleSignOut = () => {
    setAccessToken(null);
    setSignedOut(true);
  };

  // Try silent login on refresh
  useEffect(() => {
    const trySilentLogin = async () => {
      const accounts = instance.getAllAccounts();
      if (accounts.length > 0) {
        try {
          const response = await instance.acquireTokenSilent({
            ...loginRequest,
            account: accounts[0]
          });
          setAccessToken(response.accessToken);
        } catch (err) {
          console.error('Silent token acquisition failed:', err);
        }
      }
    };

    setTimeout(trySilentLogin, 0);
  }, [instance]);

  return (
    <Router>
      <div className="app-container">
        <header>
          <h1>Outlook Resource Scheduler</h1>
          <Authentication
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
          />
        </header>
        <main>
          {accessToken ? (
            <>
              <Navigation />
              <Routes>
                <Route path="/" element={<Calendar accessToken={accessToken} />} />
                <Route path="/admin" element={<SchemaExtensionAdmin accessToken={accessToken} />} />
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
