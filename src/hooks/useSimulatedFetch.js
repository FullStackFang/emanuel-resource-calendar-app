// src/hooks/useSimulatedFetch.js
import { useAuthenticatedFetch } from './useAuthenticatedFetch';

/**
 * Returns a fetch function that includes auth headers, 401 retry logic,
 * and X-Simulated-Role header when an admin is simulating a lower role.
 *
 * This is a thin wrapper around useAuthenticatedFetch for backward compatibility.
 *
 * Usage:
 *   const simulatedFetch = useSimulatedFetch();
 *   const response = await simulatedFetch(url, options);
 */
export function useSimulatedFetch() {
  return useAuthenticatedFetch();
}

export default useSimulatedFetch;
