// src/hooks/useServerEvents.js
/**
 * SSE (Server-Sent Events) connection hook.
 *
 * Manages the lifecycle of an EventSource connection to the backend SSE endpoint.
 * On receiving 'event-changed' notifications, dispatches refresh events to the
 * existing useDataRefreshBus system so all subscribing components auto-refresh.
 *
 * Features:
 * - Ticket-based auth (POST /api/sse/ticket → EventSource with query param)
 * - Automatic reconnect with exponential backoff (1s → 2s → 4s → ... → 30s max)
 * - Visibility-aware: closes on tab hidden, reconnects on visible
 * - Stops retrying after 10 consecutive failures (falls back to polling)
 * - Replays missed events via lastEventId on reconnect
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthenticatedFetch } from './useAuthenticatedFetch';
import { dispatchRefresh } from './useDataRefreshBus';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 30_000;

export function useServerEvents({ apiToken, userEmail }) {
  const [isConnected, setIsConnected] = useState(false);
  const authFetch = useAuthenticatedFetch();

  // Refs to persist across renders without triggering re-connections
  const esRef = useRef(null);           // EventSource instance
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const lastEventIdRef = useRef(null);
  const disabledRef = useRef(false);
  const connectingRef = useRef(false);   // Prevent concurrent connect attempts
  const mountedRef = useRef(true);

  const connect = useCallback(async () => {
    // Guard: skip if disabled, not authenticated, unmounted, or already connecting
    if (disabledRef.current || !apiToken || !mountedRef.current || connectingRef.current) return;
    connectingRef.current = true;

    try {
      // Step 1: Exchange JWT for single-use SSE ticket
      const ticketRes = await authFetch(`${APP_CONFIG.API_BASE_URL}/sse/ticket`, {
        method: 'POST'
      });

      if (!ticketRes.ok) {
        throw new Error(`Ticket request failed: ${ticketRes.status}`);
      }

      const { ticket } = await ticketRes.json();

      // Step 2: Build EventSource URL with ticket + optional lastEventId
      let sseUrl = `${APP_CONFIG.API_BASE_URL}/sse/events?ticket=${ticket}`;
      if (lastEventIdRef.current) {
        sseUrl += `&lastEventId=${lastEventIdRef.current}`;
      }

      // Step 3: Close any existing connection
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      // Step 4: Open EventSource
      const es = new EventSource(sseUrl);
      esRef.current = es;

      es.addEventListener('connected', () => {
        if (!mountedRef.current) return;
        logger.log('[SSE] Connected');
        setIsConnected(true);
        reconnectAttemptRef.current = 0;
      });

      es.addEventListener('event-changed', (e) => {
        if (!mountedRef.current) return;
        try {
          // Track last event ID for replay on reconnect
          if (e.lastEventId) {
            lastEventIdRef.current = e.lastEventId;
          }

          const data = JSON.parse(e.data);

          // Skip if this user performed the action (they already have fresh data)
          if (data.actorEmail && userEmail &&
              data.actorEmail.toLowerCase() === userEmail.toLowerCase()) {
            return;
          }

          // Dispatch refresh to each affected view via the existing bus
          if (data.affectedViews) {
            for (const view of data.affectedViews) {
              dispatchRefresh('sse', view);
            }
          }

          // Dispatch counts refresh if badge counts changed
          if (data.countsChanged) {
            dispatchRefresh('sse', 'navigation-counts');
          }
        } catch (err) {
          logger.warn('[SSE] Failed to parse event:', err);
        }
      });

      es.addEventListener('shutdown', () => {
        // Server is shutting down gracefully — don't reconnect aggressively
        logger.log('[SSE] Server shutdown received');
        cleanup();
      });

      es.onerror = () => {
        if (!mountedRef.current) return;
        logger.warn('[SSE] Connection error — will reconnect');
        setIsConnected(false);
        cleanup();
        scheduleReconnect();
      };

    } catch (err) {
      logger.warn('[SSE] Connect failed:', err.message);
      setIsConnected(false);
      scheduleReconnect();
    } finally {
      connectingRef.current = false;
    }
  }, [apiToken, userEmail, authFetch]);

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    reconnectAttemptRef.current++;
    if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
      logger.warn('[SSE] Max reconnect attempts reached — falling back to polling only');
      disabledRef.current = true;
      setIsConnected(false);
      return;
    }

    const backoff = Math.min(
      1000 * Math.pow(2, reconnectAttemptRef.current - 1),
      MAX_BACKOFF_MS
    );
    logger.log('[SSE] Reconnecting in %dms (attempt %d/%d)',
      backoff, reconnectAttemptRef.current, MAX_RECONNECT_ATTEMPTS);

    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current && document.visibilityState === 'visible') {
        connect();
      }
    }, backoff);
  }, [connect]);

  // Main effect: connect when apiToken becomes available
  useEffect(() => {
    mountedRef.current = true;
    if (apiToken && !disabledRef.current) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [apiToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Visibility effect: disconnect on hidden, reconnect on visible
  useEffect(() => {
    if (!apiToken) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (!esRef.current && !disabledRef.current && !connectingRef.current) {
          connect();
        }
      } else {
        cleanup();
        setIsConnected(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [apiToken, connect, cleanup]);

  return { isConnected };
}
