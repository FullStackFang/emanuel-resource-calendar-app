// src/hooks/usePermissions.jsx
import { useRoleSimulation } from '../context/RoleSimulationContext';

/**
 * Hook to access effective permissions based on role simulation state and user role.
 * When simulating a role, returns that role's permissions.
 * When not simulating, returns permissions based on user's actual role from database.
 */
export function usePermissions() {
  const {
    effectivePermissions,
    isSimulating,
    simulatedRoleName,
    isActualAdmin,
    userRole,
    setUserRole
  } = useRoleSimulation();

  return {
    // Permission flags (derived from user's role or simulated role)
    canViewCalendar: effectivePermissions.canViewCalendar,
    canSubmitReservation: effectivePermissions.canSubmitReservation,
    canCreateEvents: effectivePermissions.canCreateEvents,
    canEditEvents: effectivePermissions.canEditEvents,
    canDeleteEvents: effectivePermissions.canDeleteEvents,
    canApproveReservations: effectivePermissions.canApproveReservations,
    isAdmin: effectivePermissions.isAdmin,

    // Simulation state
    isSimulating,
    simulatedRoleName,

    // Actual user status (for showing simulation controls)
    isActualAdmin,

    // User's actual role from database
    userRole,
    setUserRole
  };
}

export default usePermissions;
