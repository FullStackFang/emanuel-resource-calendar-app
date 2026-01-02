// src/context/RoleSimulationContext.jsx
import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';

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

// Default permissions for non-simulating users (admin level)
const DEFAULT_PERMISSIONS = ROLE_TEMPLATES.admin.permissions;

// Helper to get permissions from a role key
export function getPermissionsForRole(roleKey) {
  if (roleKey && ROLE_TEMPLATES[roleKey]) {
    return ROLE_TEMPLATES[roleKey].permissions;
  }
  // Default to viewer permissions for unknown roles
  return ROLE_TEMPLATES.viewer.permissions;
}

// Helper to derive role from legacy granular permissions (for migration)
export function getRoleFromLegacyPermissions(preferences) {
  if (!preferences) return 'viewer';

  if (preferences.isAdmin) return 'admin';
  if (preferences.createEvents && preferences.editEvents && preferences.deleteEvents) return 'approver';
  if (preferences.createEvents || preferences.editEvents) return 'requester';
  return 'viewer';
}

// Create context
const RoleSimulationContext = createContext();

// Create provider component
export function RoleSimulationProvider({ children }) {
  const { instance, accounts } = useMsal();
  const [simulatedRole, setSimulatedRole] = useState(null);
  const [isActualAdmin, setIsActualAdmin] = useState(false);
  const [userRole, setUserRole] = useState('viewer'); // User's actual role from database

  // Check if the actual user is an admin (can use simulation feature)
  useEffect(() => {
    const checkAdminStatus = () => {
      const activeAccount = instance.getActiveAccount() || accounts[0];
      if (activeAccount) {
        const email = activeAccount.username || '';
        // Match the admin check pattern used in the backend
        const adminCheck = email.includes('admin') || email.endsWith('@emanuelnyc.org');
        setIsActualAdmin(adminCheck);
      }
    };
    checkAdminStatus();
  }, [instance, accounts]);

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

  // Get effective permissions based on simulation state and user role
  const getEffectivePermissions = useCallback(() => {
    // If simulating, use simulated role's permissions
    if (simulatedRole && ROLE_TEMPLATES[simulatedRole]) {
      return ROLE_TEMPLATES[simulatedRole].permissions;
    }
    // Otherwise, use user's actual role permissions
    return getPermissionsForRole(userRole);
  }, [simulatedRole, userRole]);

  // Context value
  const value = {
    // Simulation state
    simulatedRole,
    isSimulating: simulatedRole !== null,
    simulatedRoleName: simulatedRole ? ROLE_TEMPLATES[simulatedRole].name : null,

    // Actual user status
    isActualAdmin,
    userRole,
    setUserRole,

    // Actions
    startSimulation,
    endSimulation,

    // Permissions
    effectivePermissions: getEffectivePermissions(),

    // Role templates for UI
    roleTemplates: ROLE_TEMPLATES
  };

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
      userRole: 'viewer',
      setUserRole: () => {},
      startSimulation: () => false,
      endSimulation: () => {},
      effectivePermissions: ROLE_TEMPLATES.viewer.permissions,
      roleTemplates: ROLE_TEMPLATES
    };
  }

  return context;
}
