// src/components/shared/SessionExpiredDialog.jsx
import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { apiRequest } from '../../config/authConfig';
import { useAuth } from '../../context/AuthContext';
import { logger } from '../../utils/logger';
import './SessionExpiredDialog.css';

/**
 * SessionExpiredDialog - Shown when the 24-hour refresh token expires.
 *
 * Listens for the 'auth:session-expired' custom DOM event (dispatched by
 * useTokenRefresh or useAuthenticatedFetch) and presents two options:
 *   1. "Sign In Again" — triggers loginPopup → acquires fresh tokens
 *   2. "Continue in Read-Only Mode" — sets sessionExpired flag, dismisses dialog
 */
export default function SessionExpiredDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { instance } = useMsal();
  const { setApiToken, setSessionExpired } = useAuth();

  // Listen for the session-expired event
  useEffect(() => {
    const handleSessionExpired = () => {
      logger.warn('SessionExpiredDialog: Session expired event received');
      setIsOpen(true);
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, []);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const response = await instance.loginPopup({
        scopes: apiRequest.scopes
      });

      if (response?.account) {
        // Acquire fresh API token with the new session
        const tokenResponse = await instance.acquireTokenSilent({
          ...apiRequest,
          account: response.account
        });
        setApiToken(tokenResponse.accessToken);
        logger.log('SessionExpiredDialog: Re-authenticated successfully');
        setIsOpen(false);
      }
    } catch (error) {
      logger.error('SessionExpiredDialog: Re-authentication failed:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleReadOnly = () => {
    setSessionExpired(true);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="session-expired-overlay">
      <div className="session-expired-dialog" role="alertdialog" aria-labelledby="session-expired-title">
        <div className="session-expired-header">
          <span className="session-expired-icon" aria-hidden="true">&#128274;</span>
          <h3 id="session-expired-title">Your session has expired</h3>
        </div>

        <div className="session-expired-body">
          <p>
            You&apos;ve been signed in for a while and your session has expired.
            Sign in again to continue making changes, or browse in read-only mode.
          </p>
        </div>

        <div className="session-expired-actions">
          <button
            className="session-expired-btn-secondary"
            onClick={handleReadOnly}
            disabled={isSigningIn}
          >
            Continue in Read-Only Mode
          </button>
          <button
            className="session-expired-btn-primary"
            onClick={handleSignIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? 'Signing in...' : 'Sign In Again'}
          </button>
        </div>
      </div>
    </div>
  );
}
