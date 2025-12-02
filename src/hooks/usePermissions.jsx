// src/hooks/usePermissions.jsx
import { useRoleSimulation } from '../context/RoleSimulationContext';

/**
 * Hook to access effective permissions based on role simulation state.
 * When simulating a role, returns that role's permissions.
 * When not simulating, returns full admin permissions.
 */
export function usePermissions() {
  const { effectivePermissions, isSimulating, simulatedRoleName, isActualAdmin } = useRoleSimulation();

  return {
    // Permission flags
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
    isActualAdmin
  };
}

export default usePermissions;
