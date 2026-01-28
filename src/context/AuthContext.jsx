/**
 * AuthContext - Secure API token management
 *
 * Provides a secure way to access the API token throughout the app
 * without exposing it on the window object.
 *
 * SECURITY: This replaces the insecure window.__apiToken pattern
 * which exposed tokens to XSS attacks and third-party scripts.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

const AuthContext = createContext(null);

/**
 * AuthProvider - Wraps the app to provide secure token access
 */
export function AuthProvider({ children }) {
  const [apiToken, setApiTokenState] = useState(null);

  // Use ref for synchronous access (needed for error handlers)
  const tokenRef = useRef(null);

  // Update both state and ref when token changes
  const setApiToken = useCallback((token) => {
    tokenRef.current = token;
    setApiTokenState(token);
  }, []);

  // Synchronous getter for use in callbacks/error handlers
  const getApiToken = useCallback(() => {
    return tokenRef.current;
  }, []);

  const value = {
    apiToken,
    setApiToken,
    getApiToken
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth - Hook to access auth context
 * @returns {{ apiToken: string|null, setApiToken: Function, getApiToken: Function }}
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * useApiToken - Convenience hook to just get the token
 * @returns {string|null}
 */
export function useApiToken() {
  const { apiToken } = useAuth();
  return apiToken;
}

export default AuthContext;
