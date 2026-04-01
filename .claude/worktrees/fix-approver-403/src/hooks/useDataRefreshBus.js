import { useEffect, useRef } from 'react';

const EVENT_NAME = 'data-refresh';

/**
 * Dispatch a refresh event to notify views that data has changed.
 *
 * @param {string} source - Who triggered the refresh (e.g., 'reservation-requests', 'calendar')
 * @param {string|null} affectedView - Target view to refresh, or null/'all' for all views
 */
export function dispatchRefresh(source, affectedView = null) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { source, affectedView }
  }));
}

/**
 * Subscribe to refresh events for a specific view.
 * Calls `onRefresh` when a relevant refresh event is dispatched
 * (i.e., when affectedView matches viewName, or when affectedView is null/'all').
 *
 * @param {string} viewName - The name of this view (e.g., 'my-reservations', 'calendar')
 * @param {Function} onRefresh - Callback to execute when refresh is needed
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
      const { affectedView } = event.detail || {};
      if (!affectedView || affectedView === 'all' || affectedView === viewName) {
        callbackRef.current();
      }
    };

    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [viewName, enabled]);
}
