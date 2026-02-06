// src/hooks/useSimulatedFetch.js
import { useCallback } from 'react';
import { useRoleSimulation } from '../context/RoleSimulationContext';

/**
 * Returns a fetch function that automatically includes X-Simulated-Role header
 * when an admin is simulating a lower role.
 *
 * Usage:
 *   const simulatedFetch = useSimulatedFetch();
 *   const response = await simulatedFetch(url, options);
 *
 * The hook automatically adds the X-Simulated-Role header when:
 * 1. The user is an actual admin (isActualAdmin is true)
 * 2. A simulation is active (simulatedRole is not null)
 */
export function useSimulatedFetch() {
  const { simulatedRole, isActualAdmin } = useRoleSimulation();

  const simulatedFetch = useCallback(async (url, options = {}) => {
    const headers = new Headers(options.headers || {});

    // Only add simulation header if admin is actually simulating a role
    if (isActualAdmin && simulatedRole) {
      headers.set('X-Simulated-Role', simulatedRole);
    }

    return fetch(url, { ...options, headers });
  }, [simulatedRole, isActualAdmin]);

  return simulatedFetch;
}

export default useSimulatedFetch;
