/**
 * Centralized authentication and authorization utilities
 *
 * SECURITY NOTE: Admin access is granted via:
 * 1. Database flag: user.isAdmin === true
 * 2. Domain-based: emails ending with @emanuelnyc.org
 *
 * The dangerous pattern `userEmail.includes('admin')` has been removed
 * as it allowed any email containing 'admin' to gain admin access.
 */

const ADMIN_DOMAIN = '@emanuelnyc.org';

/**
 * Check if a user has admin privileges
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user is an admin
 */
function isAdmin(user, userEmail) {
  // Check database admin flag
  if (user?.isAdmin === true) {
    return true;
  }

  // Check domain-based admin access
  if (userEmail && typeof userEmail === 'string') {
    return userEmail.toLowerCase().endsWith(ADMIN_DOMAIN);
  }

  return false;
}

/**
 * Check if a user can view all reservations
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user can view all reservations
 */
function canViewAllReservations(user, userEmail) {
  // Check specific permission
  if (user?.permissions?.canViewAllReservations === true) {
    return true;
  }

  // Fall back to admin check
  return isAdmin(user, userEmail);
}

/**
 * Check if a user can generate reservation tokens
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean} True if user can generate tokens
 */
function canGenerateReservationTokens(user, userEmail) {
  // Check specific permission
  if (user?.permissions?.canGenerateReservationTokens === true) {
    return true;
  }

  // Fall back to admin check
  return isAdmin(user, userEmail);
}

module.exports = {
  isAdmin,
  canViewAllReservations,
  canGenerateReservationTokens,
  ADMIN_DOMAIN
};
