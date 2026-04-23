// src/context/SSEContext.jsx
/**
 * SSE (Server-Sent Events) context provider.
 *
 * Wraps useServerEvents at the app level so there is exactly one SSE connection
 * per browser tab. Components can use useSSE() to check connection status.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useServerEvents } from '../hooks/useServerEvents';
import { useAuth } from './AuthContext';

const SSEContext = createContext({ isConnected: false, sseStatus: 'offline' });

export function SSEProvider({ children, userEmail }) {
  const { apiToken } = useAuth();
  const { isConnected, sseStatus } = useServerEvents({ apiToken, userEmail });
  // Memoize so consumers that only read a subset (e.g. isConnected) don't
  // re-render when the provider re-renders without a value change.
  const value = useMemo(() => ({ isConnected, sseStatus }), [isConnected, sseStatus]);

  return (
    <SSEContext.Provider value={value}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE() {
  return useContext(SSEContext);
}
