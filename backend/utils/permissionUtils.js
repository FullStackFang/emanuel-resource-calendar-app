/**
 * Centralized role-based permission system
 *
 * This module defines the single source of truth for the permission system.
 *
 * ROLE HIERARCHY (lowest to highest):
 * - viewer: View calendar only
 * - requester: viewer + submit/manage own reservation requests
 * - approver: requester + approve/reject all reservations, edit/delete published events
 * - admin: approver + access Admin modules (User Management, Categories, Locations, etc.)
 *
 * MIGRATION NOTES:
 * This replaces the previous overlapping permission model:
 * - user.isAdmin (boolean)
 * - user.roles (array) - partially implemented
 * - user.permissions.canViewAllReservations (boolean)
 * - user.permissions.canGenerateReservationTokens (boolean)
 * - user.preferences.createEvents/editEvents/deleteEvents/isAdmin (DEAD CODE)
 *
 * The new model uses a single 'role' field that derives all permissions.
 */

// Role hierarchy - higher number = more permissions
const ROLE_HIERARCHY = {
  viewer: 0,
  requester: 1,
  approver: 2,
  admin: 3
};

// Department-specific editable fields
// Security: door times and door notes
// Maintenance: setup/teardown times and related notes
const DEPARTMENT_EDITABLE_FIELDS = {
  security: ['doorOpenTime', 'doorCloseTime', 'doorNotes'],
  maintenance: ['setupTime', 'teardownTime', 'setupNotes', 'eventNotes',
                'setupTimeMinutes', 'teardownTimeMinutes']
};

// Complete permission set for each role
const ROLE_PERMISSIONS = {
  viewer: {
    canViewCalendar: true,
    canSubmitReservation: false,
    canCreateEvents: false,
    canEditEvents: false,
    canDeleteEvents: false,
    canApproveReservations: false,
    canViewAllReservations: false,
    canGenerateReservationTokens: false,
    isAdmin: false
  },
  requester: {
    canViewCalendar: true,
    canSubmitReservation: true,
    canCreateEvents: false,
    canEditEvents: false,
    canDeleteEvents: false,
    canApproveReservations: false,
    canViewAllReservations: false,
    canGenerateReservationTokens: false,
    isAdmin: false
  },
  approver: {
    canViewCalendar: true,
    canSubmitReservation: true,
    canCreateEvents: true,
    canEditEvents: true,
    canDeleteEvents: true,
    canApproveReservations: true,
    canViewAllReservations: true,
    canGenerateReservationTokens: true,
    isAdmin: false
  },
  admin: {
    canViewCalendar: true,
    canSubmitReservation: true,
    canCreateEvents: true,
    canEditEvents: true,
    canDeleteEvents: true,
    canApproveReservations: true,
    canViewAllReservations: true,
    canGenerateReservationTokens: true,
    isAdmin: true
  }
};

// Default admin domain (can be overridden via ADMIN_DOMAIN env var)
const DEFAULT_ADMIN_DOMAIN = '@emanuelnyc.org';

/**
 * Get the effective role for a user, handling backward compatibility with legacy fields
 *
 * Priority order:
 * 1. New role field (if set and valid)
 * 2. Domain-based admin (configurable via ADMIN_DOMAIN env var)
 * 3. Legacy isAdmin flag
 * 4. Legacy granular permissions (canViewAllReservations -> approver)
 * 5. Default to 'viewer'
 *
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {string} The effective role: 'viewer' | 'requester' | 'approver' | 'admin'
 */
function getEffectiveRole(user, userEmail) {
  // 1. Use new role field if set and valid
  if (user?.role && ROLE_HIERARCHY[user.role] !== undefined) {
    return user.role;
  }

  // 2. Domain-based admin (configurable via ADMIN_DOMAIN env var)
  const adminDomain = process.env.ADMIN_DOMAIN || DEFAULT_ADMIN_DOMAIN;
  if (userEmail && typeof userEmail === 'string') {
    if (userEmail.toLowerCase().endsWith(adminDomain.toLowerCase())) {
      return 'admin';
    }
  }

  // 3. Legacy isAdmin flag
  if (user?.isAdmin === true) {
    return 'admin';
  }

  // 4. Legacy granular permissions
  if (user?.permissions?.canViewAllReservations === true ||
      user?.permissions?.canGenerateReservationTokens === true) {
    return 'approver';
  }

  // 5. Default to viewer
  return 'viewer';
}

/**
 * Check if a user has at least the required role level
 *
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @param {string} requiredRole - The minimum required role
 * @returns {boolean} True if user has at least the required role level
 */
function hasRole(user, userEmail, requiredRole) {
  const effectiveRole = getEffectiveRole(user, userEmail);
  const effectiveLevel = ROLE_HIERARCHY[effectiveRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return effectiveLevel >= requiredLevel;
}

/**
 * Get fields a user can edit based on their department
 * @param {Object} user - User object from database
 * @returns {string[]} Array of field names the user can edit
 */
function getDepartmentEditableFields(user) {
  if (!user?.department) return [];
  return DEPARTMENT_EDITABLE_FIELDS[user.department] || [];
}

/**
 * Check if user can edit a specific field
 * @param {Object} user - User object
 * @param {string} userEmail - User's email
 * @param {string} fieldName - Field to check
 * @returns {boolean}
 */
function canEditField(user, userEmail, fieldName) {
  // Admins and approvers can edit everything
  if (hasRole(user, userEmail, 'approver')) return true;

  // Department users can only edit their allowed fields
  const allowedFields = getDepartmentEditableFields(user);
  return allowedFields.includes(fieldName);
}

/**
 * Get all permissions for a user based on their effective role
 *
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {Object} Object containing role and all permission flags
 */
function getPermissions(user, userEmail) {
  const role = getEffectiveRole(user, userEmail);
  const department = user?.department || null;
  const departmentEditableFields = getDepartmentEditableFields(user);

  return {
    role,
    department,
    departmentEditableFields,
    canEditDepartmentFields: departmentEditableFields.length > 0,
    ...ROLE_PERMISSIONS[role]
  };
}

/**
 * Get all valid role names
 * @returns {string[]} Array of valid role names
 */
function getValidRoles() {
  return Object.keys(ROLE_HIERARCHY);
}

/**
 * Validate if a role string is valid
 * @param {string} role - Role to validate
 * @returns {boolean} True if role is valid
 */
function isValidRole(role) {
  return ROLE_HIERARCHY[role] !== undefined;
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  DEPARTMENT_EDITABLE_FIELDS,
  getEffectiveRole,
  hasRole,
  getPermissions,
  getValidRoles,
  isValidRole,
  getDepartmentEditableFields,
  canEditField,
  DEFAULT_ADMIN_DOMAIN
};
