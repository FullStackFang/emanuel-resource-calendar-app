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

const { hasRole, getPermissions, getEffectiveRole, resolveEffectiveRole, getDepartmentEditableFields, canEditField, DEPARTMENT_EDITABLE_FIELDS, ROLE_HIERARCHY, VALID_ROLES, DEFAULT_ADMIN_DOMAIN } = require('./permissionUtils');

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

/**
 * Determine whether a user may access (view or manage) an event's attachments.
 *
 * Access is granted to:
 *  - Staff (approver or admin): they review reservation requests in the Approval
 *    Queue / EventReviewExperience and may manage floor plans during review.
 *  - The requester: matched on roomReservationData.requestedBy.email, the
 *    canonical requester source for evt-request-* events.
 *  - The owner: matched on the event's top-level userId (OID). Covers events that
 *    carry a userId but no requestedBy yet (e.g. drafts).
 *
 * Replaces the prior `{ userId, eventId }` ownership query that 404'd whenever a
 * non-owner (any admin/approver reviewing someone else's request) opened it.
 *
 * @param {Object} event - Event document from templeEvents__Events
 * @param {Object|null} user - User document from DB (may be null)
 * @param {string} userEmail - Authenticated user's email
 * @param {string} currentUserId - Authenticated user's OID (req.user.userId)
 * @returns {boolean} True if the user may access the event's attachments
 */
function canAccessEventAttachments(event, user, userEmail, currentUserId) {
  if (!event) return false;

  // Staff: approver-or-higher (includes admin)
  if (canViewAllReservations(user, userEmail)) return true;

  // Requester (canonical source: roomReservationData.requestedBy.email)
  const requesterEmail = event.roomReservationData?.requestedBy?.email;
  if (requesterEmail && userEmail &&
      requesterEmail.toLowerCase() === userEmail.toLowerCase()) {
    return true;
  }

  // Owner by OID (covers events with a userId but no requestedBy)
  if (event.userId && currentUserId &&
      String(event.userId) === String(currentUserId)) {
    return true;
  }

  return false;
}

module.exports = {
  isAdmin,
  canViewAllReservations,
  canGenerateReservationTokens,
  canApproveReservations,
  canSubmitReservation,
  canAccessEventAttachments,
  hasRole,
  getPermissions,
  getEffectiveRole,
  resolveEffectiveRole,
  getDepartmentEditableFields,
  canEditField,
  DEPARTMENT_EDITABLE_FIELDS,
  ROLE_HIERARCHY,
  VALID_ROLES,
  ADMIN_DOMAIN
};
