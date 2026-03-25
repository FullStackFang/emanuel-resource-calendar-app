// src/context/SSEContext.jsx
/**
 * SSE (Server-Sent Events) context provider.
 *
 * Wraps useServerEvents at the app level so there is exactly one SSE connection
 * per browser tab. Components can use useSSE() to check connection status.
 */

import React, { createContext, useContext } from 'react';
import { useServerEvents } from '../hooks/useServerEvents';
import { useAuth } from './AuthContext';

const SSEContext = createContext({ isConnected: false });

export function SSEProvider({ children, userEmail }) {
  const { apiToken } = useAuth();
  const { isConnected } = useServerEvents({ apiToken, userEmail });

  return (
    <SSEContext.Provider value={{ isConnected }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE() {
  return useContext(SSEContext);
}
