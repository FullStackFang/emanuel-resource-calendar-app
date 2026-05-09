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
 * - Reconnect retries indefinitely — backoff is capped but the loop is not
 * - Replays missed events via lastEventId on reconnect
 * - Detects server restarts via serverStartId on the `connected` event and
 *   forces a full refresh of every subscribed view when the id changes
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedFetch } from './useAuthenticatedFetch';
import { dispatchRefresh } from './useDataRefreshBus';
import { keys } from '../queries/keys';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

export const MAX_BACKOFF_MS = 30_000;

/**
 * Pure helper — compute the next reconnect delay given the attempt number.
 *
 * Starts at 1000 ms for attempt 1 and doubles each attempt, clamped to maxMs.
 * Exported so unit tests can exercise the math without standing up an
 * EventSource/timer harness.
 *
 * @param {number} attempt - 1-indexed attempt number (1 = first retry)
 * @param {number} maxMs   - maximum backoff in milliseconds (default 30s)
 * @returns {number} delay in milliseconds before the next reconnect
 */
export function computeReconnectBackoff(attempt, maxMs = MAX_BACKOFF_MS) {
  if (!Number.isFinite(attempt) || attempt < 1) return 1000;
  return Math.min(1000 * Math.pow(2, attempt - 1), maxMs);
}

/**
 * Pure helper — decide what action to take when a `connected` event arrives
 * with (or without) a serverStartId, given the last-seen value.
 *
 * Returns one of:
 *   'baseline'  — first-ever connect in this tab, record incoming, do not dispatch
 *   'match'     — incoming matches last-seen, no action needed
 *   'restart'   — server restart detected, dispatch refresh for all subscribed views
 *   'absent'    — incoming is null/missing; backend predates Phase 2, no action
 *
 * @param {string|null} previous - last-seen serverStartId (or null if none yet)
 * @param {string|null} incoming - incoming serverStartId from this connected event
 * @returns {'baseline' | 'match' | 'restart' | 'absent'}
 */
export function decideServerStartAction(previous, incoming) {
  if (!incoming) return 'absent';
  if (!previous) return 'baseline';
  if (previous === incoming) return 'match';
  return 'restart';
}

/**
 * Pure helper — translate an SSE `event-changed` payload into TanStack Query
 * cache operations. Extracted from the hook body so its behavior is testable
 * without standing up an EventSource/timer harness (matches the established
 * pattern of computeReconnectBackoff and decideServerStartAction).
 *
 * Operations applied:
 *   1. Always: invalidate every query under the `events` resource. RQ
 *      refetches active/observed queries automatically and marks inactive
 *      ones stale for next access.
 *   2. When `data.event` carries the full updated event document: patch
 *      the per-event detail cache via setQueryData so any open detail view
 *      reflects the new state without an additional fetch.
 *
 * Errors thrown by the queryClient are not caught here — the caller is
 * responsible for wrapping in try/catch since SSE delivery should never
 * crash the connection on a cache-bridge failure.
 *
 * @param {Object} data - Parsed SSE event-changed payload
 * @param {Object} data.event - Optional full updated event document
 * @param {string} data.event.eventId - Stable event identifier (preferred over _id)
 * @param {Object} queryClient - TanStack Query client
 * @returns {{ invalidated: boolean, detailPatched: boolean }} What the bridge did
 */
export function bridgeSseToReactQuery(data, queryClient) {
  if (!queryClient) return { invalidated: false, detailPatched: false };

  // 1. Broad-prefix invalidate the events.* cache.
  queryClient.invalidateQueries({ queryKey: keys.events.all() });

  // 2. Targeted detail-cache patch when the SSE payload carries the document.
  let detailPatched = false;
  if (data && data.event) {
    const eventId = data.event.eventId || data.event._id;
    if (eventId) {
      queryClient.setQueryData(keys.events.detail(eventId), data.event);
      detailPatched = true;
    }
  }
  return { invalidated: true, detailPatched };
}

/**
 * Pure helper — apply the cross-cutting cache invalidation that follows a
 * server-restart `connected` event. Invalidates both the events and
 * reservations resource prefixes; preserves unrelated caches (categories,
 * locations) which a server restart doesn't change.
 *
 * @param {Object} queryClient - TanStack Query client
 * @returns {{ eventsInvalidated: boolean, reservationsInvalidated: boolean }}
 */
export function bridgeSseRestartToReactQuery(queryClient) {
  if (!queryClient) {
    return { eventsInvalidated: false, reservationsInvalidated: false };
  }
  queryClient.invalidateQueries({ queryKey: keys.events.all() });
  queryClient.invalidateQueries({ queryKey: keys.reservations.all() });
  return { eventsInvalidated: true, reservationsInvalidated: true };
}

export function useServerEvents({ apiToken, userEmail }) {
  const [isConnected, setIsConnected] = useState(false);
  const [sseStatus, setSseStatus] = useState('offline');
  const authFetch = useAuthenticatedFetch();
  const queryClient = useQueryClient();

  // Refs to persist across renders without triggering re-connections
  const esRef = useRef(null);           // EventSource instance
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const stableConnectionTimerRef = useRef(null); // Delays counter reset until connection is stable
  const lastEventIdRef = useRef(null);
  const connectingRef = useRef(false);   // Prevent concurrent connect attempts
  const mountedRef = useRef(true);
  const lastTokenRef = useRef(null);     // Prevent reconnect on same-value token re-renders
  const serverStartIdRef = useRef(null); // Last-seen serverStartId from `connected` payload
  const serverStartIdLoggedAbsentRef = useRef(false); // Debug-log serverStartId absence once per session

  // Keep authFetch in a ref so connect() always uses the latest version
  // without needing it as a useCallback dependency. This breaks the cascade:
  // RoleSimulationContext change → authFetch recreated → connect recreated →
  // scheduleReconnect recreated → visibility effect re-runs
  const authFetchRef = useRef(authFetch);
  authFetchRef.current = authFetch;

  // Keep queryClient in a ref for the same reason — the SSE bridge logic
  // inside connect() reads it on every event. queryClient identity is stable
  // across renders (per TanStack Query design), but this insulates connect()
  // from any future change to that contract.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const connect = useCallback(async () => {
    if (!apiToken || !mountedRef.current || connectingRef.current) return;
    connectingRef.current = true;

    try {
      // Step 1: Exchange JWT for single-use SSE ticket
      const ticketRes = await authFetchRef.current(`${APP_CONFIG.API_BASE_URL}/sse/ticket`, {
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

      // Guard: if component unmounted during the async ticket fetch above,
      // close immediately to prevent an orphaned EventSource holding a TCP socket.
      if (!mountedRef.current) {
        es.close();
        esRef.current = null;
        return;
      }

      es.addEventListener('connected', (e) => {
        if (!mountedRef.current) return;
        logger.log('[SSE] Connected');
        setIsConnected(true);
        setSseStatus('live');

        // serverStartId is optional — absent payload and missing field both OK.
        let payload = null;
        try {
          payload = e?.data ? JSON.parse(e.data) : null;
        } catch (err) {
          logger.warn('[SSE] Failed to parse connected payload:', err);
        }

        const incomingServerStartId = payload && typeof payload.serverStartId === 'string'
          ? payload.serverStartId
          : null;
        const action = decideServerStartAction(serverStartIdRef.current, incomingServerStartId);
        switch (action) {
          case 'restart':
            logger.log('[SSE] Server restart detected — forcing refresh of all subscribed views');
            // §9.3 — cross-cutting invalidation of every events/reservations
            // cache so RQ-migrated views refetch on next access.
            try {
              bridgeSseRestartToReactQuery(queryClientRef.current);
            } catch (bridgeErr) {
              logger.warn('[SSE] Restart-RQ bridge failed:', bridgeErr.message);
            }
            // Dispatch to all subscribers via the legacy bus too. `null` means every
            // useDataRefreshBus listener receives the event, regardless of
            // affectedView filter. Kept alongside the RQ bridge for back-compat
            // until §15 retires the bus.
            dispatchRefresh('sse-server-restart', null, null);
            serverStartIdRef.current = incomingServerStartId;
            break;
          case 'baseline':
            serverStartIdRef.current = incomingServerStartId;
            break;
          case 'absent':
            // Log once per session to avoid flooding during infinite reconnect.
            if (!serverStartIdLoggedAbsentRef.current) {
              logger.log('[SSE] connected payload has no serverStartId — restart detection disabled');
              serverStartIdLoggedAbsentRef.current = true;
            }
            break;
          case 'match':
          default:
            break;
        }

        // Don't reset reconnect counter immediately — only after connection is
        // stable for 60s. Prevents reconnect storms when the stream drops
        // immediately after the connected event (e.g., Azure idle timeout).
        if (stableConnectionTimerRef.current) clearTimeout(stableConnectionTimerRef.current);
        stableConnectionTimerRef.current = setTimeout(() => {
          reconnectAttemptRef.current = 0;
        }, 60_000);
      });

      es.addEventListener('event-changed', (e) => {
        if (!mountedRef.current) return;
        try {
          // Track last event ID for replay on reconnect
          if (e.lastEventId) {
            lastEventIdRef.current = e.lastEventId;
          }

          const data = JSON.parse(e.data);

          // Process self-actor events too — ensures multi-tab consistency and
          // keeps the acting tab in sync with the canonical SSE projection
          // (mutation responses may lag or be incomplete vs projectEventForSSE).

          // Build payload from enriched SSE data for client-side patching
          const payload = data.event ? {
            event: data.event,
            action: data.action,
            oldStatus: data.oldStatus || null,
            newStatus: data.newStatus || null,
          } : null;

          // ─── §9 SSE → React Query bridge ────────────────────────────────
          // Translate the SSE event into RQ cache operations so any RQ-migrated
          // view (currently MyReservations + ReservationRequests; Calendar +
          // EventManagement to follow in §10/§13) refetches automatically
          // without needing to subscribe to the legacy refresh bus. Wrapped
          // in try/catch so a bridge failure cannot prevent the legacy bus
          // path below.
          try {
            bridgeSseToReactQuery(data, queryClientRef.current);
          } catch (bridgeErr) {
            logger.warn('[SSE] RQ bridge failed:', bridgeErr.message);
          }

          // ─── Legacy bus path (back-compat during migration) ─────────────
          // Kept alongside the RQ bridge so views that haven't migrated to
          // React Query yet (Calendar, EventManagement) still observe changes.
          // Retires in §15 once every consumer is on RQ.

          // Dispatch refresh to each affected view via the existing bus
          if (data.affectedViews) {
            for (const view of data.affectedViews) {
              dispatchRefresh('sse', view, payload);
            }
          }

          // Dispatch counts refresh if badge counts changed
          if (data.countsChanged) {
            dispatchRefresh('sse', 'navigation-counts', payload);
          }
        } catch (err) {
          logger.warn('[SSE] Failed to parse event:', err);
        }
      });

      es.addEventListener('shutdown', () => {
        // Server is shutting down gracefully — don't reconnect aggressively
        logger.log('[SSE] Server shutdown received');
        cleanup();
        setIsConnected(false);
        setSseStatus('offline');
      });

      es.onerror = () => {
        if (!mountedRef.current) return;
        logger.warn('[SSE] Connection error — will reconnect');
        setIsConnected(false);
        setSseStatus('reconnecting');
        cleanup();
        scheduleReconnect();
      };

    } catch (err) {
      logger.warn('[SSE] Connect failed:', err.message);
      setIsConnected(false);
      setSseStatus('reconnecting');
      scheduleReconnect();
    } finally {
      connectingRef.current = false;
      // Belt-and-suspenders: if unmounted while connecting, ensure EventSource is closed
      if (!mountedRef.current && esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    }
  }, [apiToken, userEmail]); // authFetch removed — accessed via ref

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (stableConnectionTimerRef.current) {
      clearTimeout(stableConnectionTimerRef.current);
      stableConnectionTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    reconnectAttemptRef.current++;

    // Infinite retry with 30s backoff cap — never permanently disable SSE.
    const backoff = computeReconnectBackoff(reconnectAttemptRef.current, MAX_BACKOFF_MS);
    logger.log('[SSE] Reconnecting in %dms (attempt %d)', backoff, reconnectAttemptRef.current);

    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current && document.visibilityState === 'visible') {
        connect();
      }
    }, backoff);
  }, [connect]);

  // Main effect: connect when apiToken becomes available
  useEffect(() => {
    mountedRef.current = true;

    // Skip if token string hasn't actually changed (prevents unnecessary
    // reconnects when MSAL returns a different JWT with the same user)
    if (apiToken === lastTokenRef.current) return;
    lastTokenRef.current = apiToken;

    if (apiToken) {
      setSseStatus('reconnecting');
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
        if (!esRef.current && !connectingRef.current) {
          setSseStatus('reconnecting');
          connect();
        }
      } else {
        cleanup();
        setIsConnected(false);
        setSseStatus('offline');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [apiToken, connect, cleanup]);

  return { isConnected, sseStatus };
}
