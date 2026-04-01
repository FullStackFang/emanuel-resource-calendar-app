/**
 * Notification Preference Keys
 *
 * Shared constants for role-based notification preferences.
 * Used by emailService.js, api-server.js, and testApp.js.
 */

// Requester-level preferences (visible to requester, approver, admin)
const REQUESTER_PREF_KEYS = [
  'emailOnConfirmations',   // submit, resubmit, edit-request-submitted confirmations
  'emailOnStatusUpdates',   // published, rejected, review-started, edit-request-approved/rejected
  'emailOnAdminChanges',    // event-updated-by-admin notification
];

// Reviewer-level preferences (visible to approver, admin only)
const REVIEWER_PREF_KEYS = [
  'emailOnNewRequests',     // new request alert (submit, resubmit)
  'emailOnEditRequests',    // edit request alert
];

// All valid preference keys
const ALL_PREF_KEYS = [...REQUESTER_PREF_KEYS, ...REVIEWER_PREF_KEYS];

/**
 * Get allowed preference keys for a given role.
 * @param {string} role - 'viewer' | 'requester' | 'approver' | 'admin'
 * @returns {string[]} Array of allowed preference keys
 */
function getAllowedKeys(role) {
  switch (role) {
    case 'admin':
    case 'approver':
      return ALL_PREF_KEYS;
    case 'requester':
      return REQUESTER_PREF_KEYS;
    default:
      return [];
  }
}

module.exports = {
  REQUESTER_PREF_KEYS,
  REVIEWER_PREF_KEYS,
  ALL_PREF_KEYS,
  getAllowedKeys,
};
