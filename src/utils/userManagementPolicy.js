// src/utils/userManagementPolicy.js
//
// Single frontend source of truth for the user-management role cap. MUST mirror
// the backend ROLE_MAX_ASSIGNABLE in backend/utils/permissionUtils.js.
//
// The backend is authoritative — these helpers only shape the UI (which roles a
// caller may assign, and which rows they may manage) so the user never sees an
// action that the server would reject with USER_MANAGEMENT_FORBIDDEN.

// Role hierarchy (mirror of backend ROLE_HIERARCHY).
export const ROLE_LEVELS = {
  viewer: 0,
  requester: 1,
  approver: 2,
  admin: 3,
};

// Roles in ascending order — the canonical assignable order for selectors.
const ROLE_ORDER = ['viewer', 'requester', 'approver', 'admin'];

// Maximum role a caller may assign or act upon. Callers absent from this map
// cannot manage users at all. Mirror of backend ROLE_MAX_ASSIGNABLE.
export const ROLE_MAX_ASSIGNABLE = {
  approver: 'requester',
  admin: 'admin',
};

/**
 * The roles a caller is allowed to assign, in ascending order.
 * @param {string} callerRole - caller's effective role
 * @returns {string[]} assignable role keys (empty if the caller cannot manage users)
 */
export function getAssignableRoles(callerRole) {
  const capRole = ROLE_MAX_ASSIGNABLE[callerRole];
  if (capRole === undefined) return [];
  const capLevel = ROLE_LEVELS[capRole];
  return ROLE_ORDER.filter((role) => ROLE_LEVELS[role] <= capLevel);
}

/**
 * Whether a caller may manage (edit role / delete) a target with the given role.
 * @param {string} callerRole - caller's effective role
 * @param {string} targetRole - target user's effective role
 * @returns {boolean}
 */
export function canManageTarget(callerRole, targetRole) {
  const capRole = ROLE_MAX_ASSIGNABLE[callerRole];
  if (capRole === undefined) return false;
  const capLevel = ROLE_LEVELS[capRole];
  const targetLevel = ROLE_LEVELS[targetRole] ?? 0;
  return targetLevel <= capLevel;
}
