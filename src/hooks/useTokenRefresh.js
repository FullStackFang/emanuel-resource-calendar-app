// src/hooks/useTokenRefresh.js
import { useEffect, useRef, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { apiRequest } from '../config/authConfig';
import { useAuth } from '../context/AuthContext';
import { logger } from '../utils/logger';

// Refresh 15 minutes before the 60-minute token expiry
const REFRESH_INTERVAL_MS = 45 * 60 * 1000;

/**
 * useTokenRefresh - Proactively refreshes the API token before expiry
 *
 * - Runs acquireTokenSilent every 45 minutes (15 min before 1-hour expiry)
 * - Refreshes on tab visibility change (handles idle-then-return scenario)
 * - Dispatches 'auth:session-expired' event when refresh tokens are exhausted (24h cliff)
 *
 * @param {Object} options
 * @param {boolean} options.isInitialized - Whether MSAL is initialized
 * @param {Function} options.setGraphToken - Setter for backward-compat graphToken
 */
export function useTokenRefresh({ isInitialized, setGraphToken }) {
  const { instance } = useMsal();
  const { setApiToken, setSessionExpired } = useAuth();
  const intervalRef = useRef(null);

  const refreshToken = useCallback(async () => {
    const accounts = instance.getAllAccounts();
    if (accounts.length === 0) {
      logger.debug('useTokenRefresh: No accounts, skipping refresh');
      return;
    }

    const account = accounts[0];
    try {
      logger.debug('useTokenRefresh: Refreshing API token silently');
      const response = await instance.acquireTokenSilent({
        ...apiRequest,
        account,
        forceRefresh: false
      });
      logger.debug('useTokenRefresh: Token refreshed successfully');
      setApiToken(response.accessToken);
      setGraphToken('app-auth-mode');
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        logger.warn('useTokenRefresh: Refresh token expired (24h cliff), session expired');
        setSessionExpired(true);
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      } else {
        logger.error('useTokenRefresh: Silent refresh failed:', error);
        // Non-interaction error — try popup as fallback
        try {
          const popupResponse = await instance.acquireTokenPopup({
            ...apiRequest,
            account
          });
          setApiToken(popupResponse.accessToken);
          setGraphToken('app-auth-mode');
        } catch (popupError) {
          logger.error('useTokenRefresh: Popup fallback also failed:', popupError);
        }
      }
    }
  }, [instance, setApiToken, setGraphToken, setSessionExpired]);

  // Initial token acquisition (replaces the old silentLogin effect)
  useEffect(() => {
    if (!isInitialized) return;

    logger.debug('useTokenRefresh: Initial token acquisition');
    refreshToken();
  }, [isInitialized, refreshToken]);

  // Set up periodic refresh interval
  useEffect(() => {
    if (!isInitialized) return;

    intervalRef.current = setInterval(() => {
      logger.debug('useTokenRefresh: Periodic refresh triggered');
      refreshToken();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isInitialized, refreshToken]);

  // Refresh on tab visibility change (user returns after being idle)
  useEffect(() => {
    if (!isInitialized) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        logger.debug('useTokenRefresh: Tab became visible, refreshing token');
        refreshToken();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isInitialized, refreshToken]);
}

export default useTokenRefresh;
