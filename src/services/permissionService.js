/**
 * Frontend Permission Service
 *
 * Fetches and caches user permissions from the backend.
 * This ensures the frontend uses the same permission logic as the backend.
 */

import APP_CONFIG from '../config/config';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Cache object
let permissionCache = {
  data: null,
  timestamp: null,
  token: null // Track which token was used to fetch
};

/**
 * Fetch current user's permissions from the backend
 *
 * @param {string} apiToken - JWT token for API authentication
 * @param {boolean} forceRefresh - If true, bypasses cache
 * @returns {Promise<Object>} Permission object containing role and all permission flags
 */
export async function fetchPermissions(apiToken, forceRefresh = false) {
  // Check cache validity
  if (!forceRefresh &&
      permissionCache.data &&
      permissionCache.token === apiToken &&
      permissionCache.timestamp &&
      (Date.now() - permissionCache.timestamp) < CACHE_DURATION_MS) {
    return permissionCache.data;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/users/me/permissions`, {
      headers: {
        Authorization: `Bearer ${apiToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch permissions: ${response.statusText}`);
    }

    const data = await response.json();

    // Update cache
    permissionCache = {
      data,
      timestamp: Date.now(),
      token: apiToken
    };

    return data;
  } catch (error) {
    console.error('Error fetching permissions:', error);

    // Return cached data if available, even if expired
    if (permissionCache.data) {
      console.warn('Using expired permission cache due to fetch error');
      return permissionCache.data;
    }

    // Return default viewer permissions if no cache and fetch failed
    return {
      userId: null,
      email: null,
      role: 'viewer',
      canViewCalendar: true,
      canSubmitReservation: false,
      canCreateEvents: false,
      canEditEvents: false,
      canDeleteEvents: false,
      canApproveReservations: false,
      canViewAllReservations: false,
      canGenerateReservationTokens: false,
      isAdmin: false
    };
  }
}

/**
 * Clear the permission cache
 * Call this when the user logs out or when permissions may have changed
 */
export function clearPermissionCache() {
  permissionCache = {
    data: null,
    timestamp: null,
    token: null
  };
}

/**
 * Check if a specific permission is granted
 *
 * @param {Object} permissions - Permission object from fetchPermissions
 * @param {string} permission - Permission key to check
 * @returns {boolean} True if permission is granted
 */
export function hasPermission(permissions, permission) {
  return permissions?.[permission] === true;
}

/**
 * Role hierarchy for comparison
 */
export const ROLE_HIERARCHY = {
  viewer: 0,
  requester: 1,
  approver: 2,
  admin: 3
};

/**
 * Check if user has at least the required role level
 *
 * @param {Object} permissions - Permission object from fetchPermissions
 * @param {string} requiredRole - Minimum required role
 * @returns {boolean} True if user has at least the required role
 */
export function hasRole(permissions, requiredRole) {
  const userLevel = ROLE_HIERARCHY[permissions?.role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}
