// src/components/Authentication.jsx
import React from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../config/authConfig';
import { useNavigate } from 'react-router-dom';

function Authentication({ onSignIn, onSignOut }) {
  const { instance, accounts } = useMsal();
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      const loginResponse = await instance.loginPopup(loginRequest);
      const account = loginResponse.account;
      const tokenResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account
      });
      if (onSignIn) onSignIn(tokenResponse.accessToken);
    } catch (error) {
      console.error('Microsoft login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await instance.logoutPopup();
    } catch (error) {
      console.error('Microsoft logout failed:', error);
    }
    if (onSignOut) onSignOut();
  };

  return (
    <div className="authentication-container">
      {accounts.length === 0 ? (
        <button onClick={handleLogin} className="login-button">
          Sign in with Microsoft
        </button>
      ) : (
        <div className="authenticated-user">
          <span>Signed in as: {accounts[0].username}</span>
          <button
            onClick={() => navigate('/settings')}
            className="settings-button"
          >
            Settings
          </button>
          <button onClick={handleLogout} className="logout-button">
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

export default Authentication;
