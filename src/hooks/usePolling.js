import { useEffect, useRef } from 'react';

/**
 * Visibility-aware polling hook with jitter.
 * Calls `callback` every `intervalMs` (±10% jitter) while the tab is visible.
 * Pauses when tab is hidden; staggers refocus refetches over 0-3 seconds to
 * prevent thundering herd when multiple users return to the app at once.
 * Does NOT fire on mount — callers handle their own initial fetch.
 *
 * @param {Function} callback - async-safe function to call each interval
 * @param {number} intervalMs - polling interval in milliseconds
 * @param {boolean} enabled - set false to disable polling entirely
 */
export function usePolling(callback, intervalMs, enabled = true) {
  const callbackRef = useRef(callback);
  const intervalRef = useRef(null);
  const refocusTimerRef = useRef(null);

  // Keep callback ref current without re-running effect
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const start = () => {
      stop();
      // Add ±10% random jitter to prevent synchronized polling across users
      const jitter = intervalMs * 0.1;
      const jitteredInterval = intervalMs + (Math.random() * 2 - 1) * jitter;
      intervalRef.current = setInterval(() => callbackRef.current(), jitteredInterval);
    };

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (refocusTimerRef.current) {
        clearTimeout(refocusTimerRef.current);
        refocusTimerRef.current = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Fire immediately so users don't stare at stale data after refocus.
        // Small 0-300ms jitter desyncs simultaneous refocus across clients
        // without the perceptible lag the prior 0-3s stagger introduced.
        refocusTimerRef.current = setTimeout(() => {
          callbackRef.current();
          start();
        }, Math.random() * 300);
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
