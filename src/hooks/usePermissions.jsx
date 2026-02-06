// src/hooks/usePermissions.jsx
import { useCallback } from 'react';
import { useRoleSimulation } from '../context/RoleSimulationContext';

/**
 * Hook to access effective permissions based on role simulation state.
 * When simulating a role, returns that role's permissions.
 * When not simulating, returns actual permissions from backend.
 * While loading, returns most restrictive (viewer) permissions.
 */
export function usePermissions() {
  const {
    effectivePermissions,
    isSimulating,
    simulatedRole,
    simulatedRoleName,
    isActualAdmin,
    actualRole,
    actualDepartment,
    departmentEditableFields,
    canEditDepartmentFields,
    permissionsLoading
  } = useRoleSimulation();

  /**
   * Check if user can edit a specific field.
   * Admins/Approvers can edit everything (takes priority over department).
   * Viewers/Requesters with a department can edit their department's fields.
   */
  const canEditField = useCallback((fieldName) => {
    // Admins can edit everything (takes priority over department)
    if (effectivePermissions.isAdmin) return true;
    // Approvers can edit everything (takes priority over department)
    if (effectivePermissions.canEditEvents) return true;
    // Viewers/Requesters with department can edit their allowed fields
    if (actualDepartment && departmentEditableFields.length > 0) {
      return departmentEditableFields.includes(fieldName);
    }
    // Regular users without department can't edit these fields
    return false;
  }, [effectivePermissions.isAdmin, effectivePermissions.canEditEvents, actualDepartment, departmentEditableFields]);

  return {
    // Permission flags
    canViewCalendar: effectivePermissions.canViewCalendar,
    canSubmitReservation: effectivePermissions.canSubmitReservation,
    canCreateEvents: effectivePermissions.canCreateEvents,
    canEditEvents: effectivePermissions.canEditEvents,
    canDeleteEvents: effectivePermissions.canDeleteEvents,
    canApproveReservations: effectivePermissions.canApproveReservations,
    isAdmin: effectivePermissions.isAdmin,

    // Department permissions
    department: actualDepartment,
    departmentEditableFields,
    canEditDepartmentFields,
    canEditField,

    // Loading state - components can use this to show loading UI
    permissionsLoading,

    // Simulation state
    isSimulating,
    simulatedRoleName,

    // Actual user status (for showing simulation controls)
    isActualAdmin,
    actualRole,

    // Simulated role value (for role-based filtering during simulation)
    simulatedRole
  };
}

export default usePermissions;
