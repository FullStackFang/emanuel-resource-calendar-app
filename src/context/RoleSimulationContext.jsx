// src/context/RoleSimulationContext.jsx
import React, { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { fetchPermissions, clearPermissionCache } from '../services/permissionService';
import { apiRequest } from '../config/authConfig';
import { logger } from '../utils/logger';
import { usePolling } from '../hooks/usePolling';

// Storage key for localStorage persistence
const STORAGE_KEY = 'role_simulation_session';

// How often to re-check the user's role while the tab is visible. Keeps an
// admin's role change from requiring the affected user to hard-reload.
const PERMISSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Role templates with their permission sets
// IMPORTANT: These MUST match backend ROLE_PERMISSIONS in permissionUtils.js
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
      canViewAllReservations: false,
      canGenerateReservationTokens: false,
      canManageUsers: false,
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
      canViewAllReservations: false,
      canGenerateReservationTokens: false,
      canManageUsers: false,
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
      canViewAllReservations: true,
      canGenerateReservationTokens: true,
      // Approvers may manage users, capped to viewer/requester (see userManagementPolicy.js)
      canManageUsers: true,
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
      canViewAllReservations: true,
      canGenerateReservationTokens: true,
      canManageUsers: true,
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

  // Fetch permissions from the backend. Shared by the initial load, the
  // periodic poll, and the tab-refocus refresh so an admin's role change takes
  // effect without the affected user having to hard-reload or sign out/in.
  //
  // - isInitial: only the first load may downgrade to viewer (the safe default)
  //   on a missing token or error. A *background* refresh that fails must keep
  //   the last good permissions — otherwise a transient blip would yank a
  //   working user's UI down to viewer.
  // - forceRefresh: bypass the permissionService cache so a refocus right after
  //   a role change reflects the new role instead of a stale 5-minute cache hit.
  const loadPermissions = useCallback(async ({ isInitial = false, forceRefresh = false } = {}) => {
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
        const permissions = await fetchPermissions(tokenResponse.accessToken, forceRefresh);
        setActualRole(permissions.role || 'viewer');
        setActualDepartment(permissions.department || null);
        setDepartmentEditableFields(permissions.departmentEditableFields || []);
        setIsActualAdmin(permissions.isAdmin === true);
        setActualPermissions(permissions);
      } else if (isInitial) {
        // No token on first load - fall back to viewer
        setActualRole('viewer');
        setActualDepartment(null);
        setDepartmentEditableFields([]);
        setIsActualAdmin(false);
      }
    } catch (error) {
      logger.error('Error fetching permissions for role simulation:', error);
      // Only the initial load downgrades to viewer; a failed background refresh
      // keeps the last good permissions so it can't hide the UI on a blip.
      if (isInitial) {
        setActualRole('viewer');
        setActualDepartment(null);
        setDepartmentEditableFields([]);
        setIsActualAdmin(false);
      }
    } finally {
      if (isInitial) {
        setPermissionsLoading(false);
      }
    }
    // Use stable account ID rather than the accounts array (MSAL returns a new
    // array reference on every render, which would re-fire this needlessly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, accounts[0]?.homeAccountId, inProgress]);

  // Initial permission load (re-runs if the active account or MSAL state changes)
  useEffect(() => {
    loadPermissions({ isInitial: true });
  }, [loadPermissions]);

  // Manual/triggered refresh: bypass the cache for an immediate up-to-date role.
  const refreshPermissions = useCallback(
    () => loadPermissions({ forceRefresh: true }),
    [loadPermissions]
  );

  // Keep permissions fresh without a manual reload. usePolling is visibility-
  // aware: it re-fetches on tab refocus and every interval while visible, and
  // pauses when the tab is hidden. Gated on having an account so it stays idle
  // when logged out.
  usePolling(refreshPermissions, PERMISSION_REFRESH_INTERVAL_MS, accounts.length > 0);

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
        logger.error('Failed to restore role simulation session:', error);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [isActualAdmin]);

  // Start simulating a role
  const startSimulation = useCallback((roleKey) => {
    if (!isActualAdmin) {
      logger.warn('Only admins can use role simulation');
      return false;
    }

    if (!ROLE_TEMPLATES[roleKey]) {
      logger.error('Invalid role key:', roleKey);
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
        canViewAllReservations: actualPermissions.canViewAllReservations ?? false,
        canGenerateReservationTokens: actualPermissions.canGenerateReservationTokens ?? false,
        // MUST mirror the simulated branch (ROLE_TEMPLATES) and the backend
        // ROLE_PERMISSIONS. Omitting this dropped User Management from the nav
        // for every real (non-simulated) admin/approver session.
        canManageUsers: actualPermissions.canManageUsers ?? false,
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
    refreshPermissions, // Force an immediate re-fetch of the user's real role
    clearPermissionCache, // Expose for logout cleanup

    // Permissions
    effectivePermissions: getEffectivePermissions(),

    // Role templates for UI
    roleTemplates: ROLE_TEMPLATES
  }), [simulatedRole, isActualAdmin, actualRole, actualDepartment, departmentEditableFields, actualPermissions, permissionsLoading, startSimulation, endSimulation, refreshPermissions, getEffectivePermissions]);

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
      refreshPermissions: () => Promise.resolve(),
      clearPermissionCache: () => {},
      effectivePermissions: DEFAULT_PERMISSIONS,
      roleTemplates: ROLE_TEMPLATES
    };
  }

  return context;
}
