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
                'setupTimeMinutes', 'teardownTimeMinutes',
                'reservationStartTime', 'reservationEndTime',
                'reservationStartMinutes', 'reservationEndMinutes']
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
    canManageUsers: false,
    canManageCalendarMarkers: false,
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
    canManageUsers: false,
    canManageCalendarMarkers: false,
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
    // Approvers may manage users, but capped to viewer/requester (see ROLE_MAX_ASSIGNABLE)
    canManageUsers: true,
    canManageCalendarMarkers: false,
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
    canManageUsers: true,
    canManageCalendarMarkers: true,
    isAdmin: true
  }
};

// Maximum role a caller may assign to, or act upon, in user management.
// Callers whose role is absent from this map cannot manage users at all.
// Approvers are capped at 'requester'; admins are uncapped ('admin').
const ROLE_MAX_ASSIGNABLE = {
  approver: 'requester',
  admin: 'admin'
};

// The ONLY user fields any caller (including admins) may write via the user
// management endpoints. Anything outside this set is dropped before persistence
// to prevent privilege escalation via legacy fields (e.g. isAdmin,
// permissions.canViewAllReservations) that getEffectiveRole() still honors.
const USER_WRITABLE_FIELDS = [
  'displayName',
  'email',
  'role',
  'department',
  'roleType',
  'title',
  'preferences',
  'notificationPreferences'
];

// Known preference keys. preferences is sanitized down to these so an escalation
// field (e.g. preferences.isAdmin) cannot ride along inside the nested object.
const USER_WRITABLE_PREFERENCE_KEYS = [
  'startOfWeek',
  'defaultView',
  'defaultGroupBy',
  'preferredZoomLevel'
];

// Valid roles for X-Simulated-Role header validation
const VALID_ROLES = Object.keys(ROLE_HIERARCHY);

// Default admin domain (can be overridden via ADMIN_DOMAIN env var)
const DEFAULT_ADMIN_DOMAIN = '@emanuelnyc.org';

/**
 * Get the effective role for a user, handling backward compatibility with legacy fields
 *
 * Priority order:
 * 1. New role field (if set and valid)
 * 2. Legacy isAdmin flag
 * 3. Legacy granular permissions (canViewAllReservations -> approver)
 * 4. Default to 'viewer'
 *
 * NOTE: Domain-based admin fallback was removed as a security fix.
 * All users must have an explicit role in the database. Run
 * migrate-permissions-to-role.js to backfill existing users.
 *
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address (unused, kept for API compatibility)
 * @returns {string} The effective role: 'viewer' | 'requester' | 'approver' | 'admin'
 */
function getEffectiveRole(user, userEmail) {
  // 1. Use new role field if set and valid
  if (user?.role && ROLE_HIERARCHY[user.role] !== undefined) {
    return user.role;
  }

  // 2. Legacy isAdmin flag
  if (user?.isAdmin === true) {
    return 'admin';
  }

  // 3. Legacy granular permissions
  if (user?.permissions?.canViewAllReservations === true ||
      user?.permissions?.canGenerateReservationTokens === true) {
    return 'approver';
  }

  // 4. Default to viewer
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

// The Events department is granted full management of calendar markers
// (Holidays & Closures) — the app's FIRST department-grants-a-feature gate.
// See docs/superpowers/specs/2026-06-11-events-dept-calendar-markers-access-design.md.
const CALENDAR_MARKER_DEPARTMENT = 'events';

/**
 * Whether a user may create/update/delete calendar markers (Holidays &
 * Closures). Granted to admins OR anyone whose department is Events —
 * deliberately role-independent. Uses local hasRole (NOT authUtils.isAdmin)
 * to avoid a circular import.
 *
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean}
 */
function canManageCalendarMarkers(user, userEmail) {
  if (hasRole(user, userEmail, 'admin')) return true;
  return (user?.department || '').toLowerCase().trim() === CALENDAR_MARKER_DEPARTMENT;
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
    ...ROLE_PERMISSIONS[role],
    canManageCalendarMarkers: canManageCalendarMarkers(user, userEmail)
  };
}

/**
 * Resolve the effective role for a request, respecting role simulation.
 *
 * Only actual admins can simulate other roles. If the requesting user is an
 * admin AND sends a valid X-Simulated-Role header, the simulated role is
 * returned. Otherwise the user's real role is returned.
 *
 * @param {Object} req - Express request object (reads X-Simulated-Role header)
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {string} The effective role: 'viewer' | 'requester' | 'approver' | 'admin'
 */
function resolveEffectiveRole(req, user, userEmail) {
  const actualRole = getEffectiveRole(user, userEmail);
  const simulatedRole = req?.headers?.['x-simulated-role'];
  if (simulatedRole && actualRole === 'admin' && VALID_ROLES.includes(simulatedRole)) {
    return simulatedRole;
  }
  return actualRole;
}

/**
 * Validate if a role string is valid
 * @param {string} role - Role to validate
 * @returns {boolean} True if role is valid
 */
function isValidRole(role) {
  return ROLE_HIERARCHY[role] !== undefined;
}

/**
 * Strip a user-write payload down to the allowlisted fields.
 *
 * Applied to ALL callers (admins included) on create/update so that legacy
 * privilege fields (isAdmin, permissions.*) and any unknown keys can never be
 * persisted. `preferences` is further reduced to known preference keys so an
 * escalation flag cannot be nested inside it.
 *
 * @param {Object} body - Raw request body
 * @returns {Object} A new object containing only allowlisted fields
 */
function sanitizeUserWrite(body) {
  const clean = {};
  if (!body || typeof body !== 'object') return clean;

  for (const field of USER_WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;

    if (field === 'preferences') {
      const prefs = body.preferences;
      if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) {
        const cleanPrefs = {};
        for (const key of USER_WRITABLE_PREFERENCE_KEYS) {
          if (Object.prototype.hasOwnProperty.call(prefs, key)) {
            cleanPrefs[key] = prefs[key];
          }
        }
        clean.preferences = cleanPrefs;
      }
      continue;
    }

    clean[field] = body[field];
  }

  return clean;
}

/**
 * Enforce the user-management role cap.
 *
 * The caller must have an entry in ROLE_MAX_ASSIGNABLE (i.e. canManageUsers).
 * Both the target's CURRENT role (when acting on an existing user) and the
 * REQUESTED role (when assigning a role) must be at or below the caller's cap.
 *
 * IMPORTANT: callerRole MUST be the caller's REAL effective role
 * (getEffectiveRole), never the simulated role — an admin simulating an
 * approver must not have their real writes restricted.
 *
 * @param {Object} params
 * @param {string} params.callerRole - Caller's real effective role
 * @param {string} [params.targetCurrentRole] - Target user's current effective role (omit for create)
 * @param {string} [params.requestedRole] - Role being assigned (omit for delete / non-role edits)
 * @returns {{ allowed: boolean, code?: string, reason?: string }}
 */
function assertUserManagementAllowed({ callerRole, targetCurrentRole, requestedRole }) {
  const capRole = ROLE_MAX_ASSIGNABLE[callerRole];
  if (capRole === undefined) {
    return {
      allowed: false,
      code: 'USER_MANAGEMENT_FORBIDDEN',
      reason: 'Your role cannot manage users'
    };
  }

  const capLevel = ROLE_HIERARCHY[capRole];

  if (targetCurrentRole !== undefined && targetCurrentRole !== null) {
    const targetLevel = ROLE_HIERARCHY[targetCurrentRole] ?? 0;
    if (targetLevel > capLevel) {
      return {
        allowed: false,
        code: 'USER_MANAGEMENT_FORBIDDEN',
        reason: `You cannot manage a user whose role is '${targetCurrentRole}'`
      };
    }
  }

  if (requestedRole !== undefined && requestedRole !== null) {
    const requestedLevel = ROLE_HIERARCHY[requestedRole];
    if (requestedLevel === undefined) {
      return {
        allowed: false,
        code: 'USER_MANAGEMENT_FORBIDDEN',
        reason: `Invalid role '${requestedRole}'`
      };
    }
    if (requestedLevel > capLevel) {
      return {
        allowed: false,
        code: 'USER_MANAGEMENT_FORBIDDEN',
        reason: `You cannot assign the role '${requestedRole}'`
      };
    }
  }

  return { allowed: true };
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  ROLE_MAX_ASSIGNABLE,
  USER_WRITABLE_FIELDS,
  USER_WRITABLE_PREFERENCE_KEYS,
  VALID_ROLES,
  DEPARTMENT_EDITABLE_FIELDS,
  getEffectiveRole,
  resolveEffectiveRole,
  hasRole,
  getPermissions,
  canManageCalendarMarkers,
  isValidRole,
  sanitizeUserWrite,
  assertUserManagementAllowed,
  getDepartmentEditableFields,
  canEditField,
  DEFAULT_ADMIN_DOMAIN
};
