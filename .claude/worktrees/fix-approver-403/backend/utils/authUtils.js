/**
 * Centralized authentication and authorization utilities
 *
 * This module provides backward-compatible wrappers around the new role-based
 * permission system in permissionUtils.js.
 *
 * SECURITY NOTE: Admin access is granted via:
 * 1. Database field: user.role === 'admin'
 * 2. Database flag (legacy): user.isAdmin === true
 *
 * Domain-based admin fallback (@emanuelnyc.org → admin) was REMOVED as a
 * security fix — it allowed any domain user whose DB lookup failed to get
 * admin access. All users must now have an explicit role in the database.
 * ADMIN_DOMAIN is still exported for use by the migration script.
 */

const { hasRole, getPermissions, getEffectiveRole, getDepartmentEditableFields, canEditField, DEPARTMENT_EDITABLE_FIELDS, DEFAULT_ADMIN_DOMAIN } = require('./permissionUtils');

// Export ADMIN_DOMAIN for backward compatibility
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN || DEFAULT_ADMIN_DOMAIN;

/**
 * Check if a user has admin privileges
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user is an admin
 */
function isAdmin(user, userEmail) {
  return hasRole(user, userEmail, 'admin');
}

/**
 * Check if a user can view all reservations (approver level or higher)
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user can view all reservations
 */
function canViewAllReservations(user, userEmail) {
  return hasRole(user, userEmail, 'approver');
}

/**
 * Check if a user can generate reservation tokens (approver level or higher)
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user can generate tokens
 */
function canGenerateReservationTokens(user, userEmail) {
  return hasRole(user, userEmail, 'approver');
}

/**
 * Check if a user can approve/reject reservations (approver level or higher)
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user can approve reservations
 */
function canApproveReservations(user, userEmail) {
  return hasRole(user, userEmail, 'approver');
}

/**
 * Check if a user can submit reservation requests (requester level or higher)
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user can submit reservations
 */
function canSubmitReservation(user, userEmail) {
  return hasRole(user, userEmail, 'requester');
}

module.exports = {
  isAdmin,
  canViewAllReservations,
  canGenerateReservationTokens,
  canApproveReservations,
  canSubmitReservation,
  hasRole,
  getPermissions,
  getEffectiveRole,
  getDepartmentEditableFields,
  canEditField,
  DEPARTMENT_EDITABLE_FIELDS,
  ADMIN_DOMAIN
};
