import { useEffect, useRef } from 'react';

const EVENT_NAME = 'data-refresh';

// ── Module-level debounce state ──
// Collapses burst dispatches (e.g., multiple SSE-triggered refreshes within 500ms)
// into one CustomEvent per unique affectedView, carrying the last payload for that view.
const pendingRefreshes = new Map(); // affectedView → detail
let flushTimer = null;

/**
 * Dispatch a refresh event to notify views that data has changed.
 *
 * @param {string} source - Who triggered the refresh (e.g., 'reservation-requests', 'calendar')
 * @param {string|null} affectedView - Target view to refresh, or null/'all' for all views
 * @param {Object|null} payload - Optional event data for local patching (event, action, oldStatus, newStatus)
 */
export function dispatchRefresh(source, affectedView = null, payload = null) {
  const key = affectedView || 'all';
  pendingRefreshes.set(key, { source, affectedView: key, payload });
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const entries = [...pendingRefreshes.entries()];
    pendingRefreshes.clear();
    for (const [, detail] of entries) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
    }
  }, 500);
}

/**
 * Subscribe to refresh events for a specific view.
 * Calls `onRefresh` when a relevant refresh event is dispatched
 * (i.e., when affectedView matches viewName, or when affectedView is null/'all').
 *
 * The callback receives the full event detail object:
 *   { source, affectedView, payload: { event, action, oldStatus, newStatus } | null }
 *
 * When payload is null (polling fallback, old server), subscribers should fall back to full refetch.
 *
 * @param {string} viewName - The name of this view (e.g., 'my-reservations', 'calendar')
 * @param {Function} onRefresh - Callback receiving (detail) when refresh is needed
 * @param {boolean} enabled - Whether to listen (default true)
 */
export function useDataRefreshBus(viewName, onRefresh, enabled = true) {
  const callbackRef = useRef(onRefresh);

  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (event) => {
      const detail = event.detail || {};
      const { affectedView } = detail;
      if (!affectedView || affectedView === 'all' || affectedView === viewName) {
        callbackRef.current(detail);
      }
    };

    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [viewName, enabled]);
}
