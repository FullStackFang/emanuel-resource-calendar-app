// src/hooks/useAuthenticatedFetch.js
import { useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { apiRequest } from '../config/authConfig';
import { useAuth } from '../context/AuthContext';
import { useRoleSimulation } from '../context/RoleSimulationContext';
import { logger } from '../utils/logger';

/**
 * useAuthenticatedFetch - Fetch wrapper with automatic auth and 401 retry
 *
 * Features:
 * - Automatically attaches Authorization header with current API token
 * - On 401 with TOKEN_EXPIRED: silently re-acquires token, retries once
 * - On InteractionRequiredAuthError: dispatches 'auth:session-expired' event
 * - Includes X-Simulated-Role header when admin is simulating a role
 *
 * Usage:
 *   const authFetch = useAuthenticatedFetch();
 *   const response = await authFetch(url, options);
 *
 * Note: callers still handle non-401 errors via their existing showError patterns.
 */
export function useAuthenticatedFetch() {
  const { instance } = useMsal();
  const { getApiToken, setApiToken, setSessionExpired } = useAuth();
  const { simulatedRole, isActualAdmin } = useRoleSimulation();

  const authFetch = useCallback(async (url, options = {}) => {
    const buildHeaders = (token, existingHeaders) => {
      const headers = new Headers(existingHeaders || {});
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (isActualAdmin && simulatedRole) {
        headers.set('X-Simulated-Role', simulatedRole);
      }
      return headers;
    };

    const token = getApiToken();
    const headers = buildHeaders(token, options.headers);
    const response = await fetch(url, { ...options, headers });

    // If not a 401, return immediately — caller handles other errors
    if (response.status !== 401) {
      return response;
    }

    // 401 — attempt silent token refresh and retry once
    logger.debug('useAuthenticatedFetch: Got 401, attempting token refresh');
    const accounts = instance.getAllAccounts();
    if (accounts.length === 0) {
      logger.warn('useAuthenticatedFetch: No accounts available for refresh');
      return response;
    }

    try {
      const tokenResponse = await instance.acquireTokenSilent({
        ...apiRequest,
        account: accounts[0],
        forceRefresh: true
      });
      const freshToken = tokenResponse.accessToken;
      setApiToken(freshToken);

      // Retry the original request with the fresh token
      logger.debug('useAuthenticatedFetch: Retrying request with fresh token');
      const retryHeaders = buildHeaders(freshToken, options.headers);
      return fetch(url, { ...options, headers: retryHeaders });
    } catch (refreshError) {
      if (refreshError instanceof InteractionRequiredAuthError) {
        logger.warn('useAuthenticatedFetch: Session expired (24h cliff)');
        setSessionExpired(true);
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      } else {
        logger.error('useAuthenticatedFetch: Token refresh failed:', refreshError);
      }
      // Return the original 401 response — caller's error handling takes over
      return response;
    }
  }, [instance, getApiToken, setApiToken, setSessionExpired, simulatedRole, isActualAdmin]);

  return authFetch;
}

export default useAuthenticatedFetch;
