// src/App.jsx
import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from './config/authConfig';
import Authentication from './components/Authentication';
import Calendar from './components/Calendar';
import './App.css';

function App() {
  const [accessToken, setAccessToken] = useState(null);
  const { instance } = useMsal();

  const handleSignIn = (token) => {
    setAccessToken(token);
  };

  // Handle token on refresh
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
  
    // Defer slightly to allow MSAL to initialize
    setTimeout(trySilentLogin, 0);
  }, [instance]);

  return (
    <div className="app-container">
      <header>
        <h1>Outlook Resource Scheduler</h1>
        <Authentication onSignIn={handleSignIn} />
      </header>
      
      <main>
        {accessToken ? (
          <Calendar accessToken={accessToken} />
        ) : (
          <div className="welcome-message">
            <p>Welcome to the Outlook Custom Calendar App.</p>
            <p>Please sign in with your Microsoft account to view your calendar.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;