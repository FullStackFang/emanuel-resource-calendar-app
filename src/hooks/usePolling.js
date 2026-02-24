import { useEffect, useRef } from 'react';

/**
 * Visibility-aware polling hook.
 * Calls `callback` every `intervalMs` while the tab is visible.
 * Pauses when tab is hidden; fires immediately + resets interval on re-focus.
 * Does NOT fire on mount — callers handle their own initial fetch.
 *
 * @param {Function} callback - async-safe function to call each interval
 * @param {number} intervalMs - polling interval in milliseconds
 * @param {boolean} enabled - set false to disable polling entirely
 */
export function usePolling(callback, intervalMs, enabled = true) {
  const callbackRef = useRef(callback);
  const intervalRef = useRef(null);

  // Keep callback ref current without re-running effect
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const start = () => {
      stop();
      intervalRef.current = setInterval(() => callbackRef.current(), intervalMs);
    };

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        callbackRef.current();
        start();
      } else {
        stop();
      }
    };

    // Only start interval if tab is currently visible
    if (document.visibilityState === 'visible') {
      start();
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs, enabled]);
}
