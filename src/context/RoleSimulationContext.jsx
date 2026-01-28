// src/context/RoleSimulationContext.jsx
import React, { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { fetchPermissions, clearPermissionCache } from '../services/permissionService';
import { apiRequest } from '../config/authConfig';

// Storage key for localStorage persistence
const STORAGE_KEY = 'role_simulation_session';

// Role templates with their permission sets
export const ROLE_TEMPLATES = {
  viewer: {
    name: 'Viewer',
    description: 'View calendar only',
    permissions: {
      canViewCalendar: true,
      canSubmitReservation: false,
      canCreateEvents: false,
      canEditEvents: false,
      canDeleteEvents: false,
      canApproveReservations: false,
      isAdmin: false
    }
  },
  requester: {
    name: 'Requester',
    description: 'Submit & manage own requests',
    permissions: {
      canViewCalendar: true,
      canSubmitReservation: true,
      canCreateEvents: false,
      canEditEvents: false,
      canDeleteEvents: false,
      canApproveReservations: false,
      isAdmin: false
    }
  },
  approver: {
    name: 'Approver',
    description: 'Manage all events & requests',
    permissions: {
      canViewCalendar: true,
      canSubmitReservation: true,
      canCreateEvents: true,
      canEditEvents: true,
      canDeleteEvents: true,
      canApproveReservations: true,
      isAdmin: false
    }
  },
  admin: {
    name: 'Admin',
    description: 'Full system access',
    permissions: {
      canViewCalendar: true,
      canSubmitReservation: true,
      canCreateEvents: true,
      canEditEvents: true,
      canDeleteEvents: true,
      canApproveReservations: true,
      isAdmin: true
    }
  }
};

// Default permissions while loading or on error (most restrictive - viewer level)
const DEFAULT_PERMISSIONS = ROLE_TEMPLATES.viewer.permissions;

// Create context
const RoleSimulationContext = createContext();

// Create provider component
export function RoleSimulationProvider({ children }) {
  const { instance, accounts, inProgress } = useMsal();
  const [simulatedRole, setSimulatedRole] = useState(null);
  const [isActualAdmin, setIsActualAdmin] = useState(false);
  const [actualRole, setActualRole] = useState('viewer');
  const [actualDepartment, setActualDepartment] = useState(null);
  const [departmentEditableFields, setDepartmentEditableFields] = useState([]);
  const [actualPermissions, setActualPermissions] = useState(null);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  // Fetch permissions from backend to determine actual admin status
  useEffect(() => {
    const checkPermissions = async () => {
      // Wait for MSAL to finish initializing
      if (inProgress !== InteractionStatus.None) {
        return;
      }

      const activeAccount = instance.getActiveAccount() || accounts[0];
      if (!activeAccount) {
        // No account yet - keep loading state true, permissions will be fetched when account is available
        return;
      }

      try {
        // Get API token (must use apiRequest scopes for custom API, not Graph scopes)
        const tokenResponse = await instance.acquireTokenSilent({
          ...apiRequest,
          account: activeAccount
        });

        if (tokenResponse?.accessToken) {
          const permissions = await fetchPermissions(tokenResponse.accessToken);
          setActualRole(permissions.role || 'viewer');
          setActualDepartment(permissions.department || null);
          setDepartmentEditableFields(permissions.departmentEditableFields || []);
          setIsActualAdmin(permissions.isAdmin === true);
          setActualPermissions(permissions);
        } else {
          // No token - fall back to viewer
          setActualRole('viewer');
          setActualDepartment(null);
          setDepartmentEditableFields([]);
          setIsActualAdmin(false);
        }
      } catch (error) {
        console.error('Error fetching permissions for role simulation:', error);
        // Fall back to viewer role on error
        setActualRole('viewer');
        setActualDepartment(null);
        setDepartmentEditableFields([]);
        setIsActualAdmin(false);
      } finally {
        setPermissionsLoading(false);
      }
    };

    checkPermissions();
  }, [instance, accounts, inProgress]);

  // Load simulation state from localStorage on mount
  useEffect(() => {
    const storedSession = localStorage.getItem(STORAGE_KEY);
    if (storedSession && isActualAdmin) {
      try {
        const session = JSON.parse(storedSession);
        if (session.roleKey && ROLE_TEMPLATES[session.roleKey]) {
          setSimulatedRole(session.roleKey);
        }
      } catch (error) {
        console.error('Failed to restore role simulation session:', error);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [isActualAdmin]);

  // Start simulating a role
  const startSimulation = useCallback((roleKey) => {
    if (!isActualAdmin) {
      console.warn('Only admins can use role simulation');
      return false;
    }

    if (!ROLE_TEMPLATES[roleKey]) {
      console.error('Invalid role key:', roleKey);
      return false;
    }

    const session = {
      roleKey,
      startedAt: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setSimulatedRole(roleKey);
    return true;
  }, [isActualAdmin]);

  // End simulation and return to normal
  const endSimulation = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSimulatedRole(null);
  }, []);

  // Get effective permissions based on simulation state
  const getEffectivePermissions = useCallback(() => {
    if (simulatedRole && ROLE_TEMPLATES[simulatedRole]) {
      return ROLE_TEMPLATES[simulatedRole].permissions;
    }
    // Use actual permissions from backend if available
    if (actualPermissions) {
      return {
        canViewCalendar: actualPermissions.canViewCalendar ?? true,
        canSubmitReservation: actualPermissions.canSubmitReservation ?? false,
        canCreateEvents: actualPermissions.canCreateEvents ?? false,
        canEditEvents: actualPermissions.canEditEvents ?? false,
        canDeleteEvents: actualPermissions.canDeleteEvents ?? false,
        canApproveReservations: actualPermissions.canApproveReservations ?? false,
        isAdmin: actualPermissions.isAdmin ?? false
      };
    }
    return DEFAULT_PERMISSIONS;
  }, [simulatedRole, actualPermissions]);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    // Simulation state
    simulatedRole,
    isSimulating: simulatedRole !== null,
    simulatedRoleName: simulatedRole ? ROLE_TEMPLATES[simulatedRole].name : null,

    // Actual user status (from backend)
    isActualAdmin,
    actualRole,
    actualDepartment,
    departmentEditableFields,
    canEditDepartmentFields: departmentEditableFields.length > 0,
    actualPermissions,
    permissionsLoading,

    // Actions
    startSimulation,
    endSimulation,
    clearPermissionCache, // Expose for logout cleanup

    // Permissions
    effectivePermissions: getEffectivePermissions(),

    // Role templates for UI
    roleTemplates: ROLE_TEMPLATES
  }), [simulatedRole, isActualAdmin, actualRole, actualDepartment, departmentEditableFields, actualPermissions, permissionsLoading, startSimulation, endSimulation, getEffectivePermissions]);

  return (
    <RoleSimulationContext.Provider value={value}>
      {children}
    </RoleSimulationContext.Provider>
  );
}

// Custom hook for using the context
export function useRoleSimulation() {
  const context = useContext(RoleSimulationContext);
  if (context === undefined) {
    throw new Error('useRoleSimulation must be used within a RoleSimulationProvider');
  }
  return context;
}

// Safe version that returns default values when called outside the provider
// Use this in components that may render before authentication (e.g., Authentication.jsx)
export function useRoleSimulationSafe() {
  const context = useContext(RoleSimulationContext);

  // Return default values if not within provider
  if (context === undefined) {
    return {
      simulatedRole: null,
      isSimulating: false,
      simulatedRoleName: null,
      isActualAdmin: false,
      actualRole: 'viewer',
      actualDepartment: null,
      departmentEditableFields: [],
      canEditDepartmentFields: false,
      actualPermissions: null,
      permissionsLoading: true,
      startSimulation: () => false,
      endSimulation: () => {},
      clearPermissionCache: () => {},
      effectivePermissions: DEFAULT_PERMISSIONS,
      roleTemplates: ROLE_TEMPLATES
    };
  }

  return context;
}
