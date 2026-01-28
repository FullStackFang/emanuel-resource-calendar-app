// src/services/graphService.js
// Updated to use backend proxy endpoints instead of direct Graph API calls
// This allows the app to use application permissions, so users don't need individual calendar access

import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

// Store the API token for authentication
let apiToken = null;

/**
 * Set the API token for backend requests
 * @param {string} token - The API token from MSAL authentication
 */
export const setApiToken = (token) => {
  apiToken = token;
};

/**
 * Get authorization headers for backend requests
 * @returns {Object} Headers object with Authorization
 */
const getAuthHeaders = () => {
  if (!apiToken) {
    throw new Error('API token not set. Call setApiToken first.');
  }
  return {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json'
  };
};

/**
 * Make authenticated request to backend
 * @param {string} endpoint - API endpoint (relative to API_BASE_URL)
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} API response
 */
const backendRequest = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers
    }
  });

  // Handle no-content responses (like DELETE)
  if (response.status === 204) {
    return { success: true };
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `API error: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
};

// Note: getGraphClient is removed - no longer making direct Graph API calls

/**
 * Get user information
 * @param {string} userId - User ID or email
 * @returns {Promise<Object>} User details
 */
export const getUserDetails = async (userId) => {
  try {
    return await backendRequest(`/graph/users/${encodeURIComponent(userId)}`);
  } catch (error) {
    console.error("Error getting user details:", error);
    throw error;
  }
};

/**
 * Get calendar events for a date range
 * @param {string} userId - User ID or email (calendar owner)
 * @param {string} startDateTime - ISO date string
 * @param {string} endDateTime - ISO date string
 * @param {string} calendarId - Optional specific calendar ID
 * @returns {Promise<Object>} Events response
 */
export const getCalendarEvents = async (userId, startDateTime, endDateTime, calendarId = null) => {
  try {
    const params = new URLSearchParams({
      userId,
      startDateTime,
      endDateTime
    });
    if (calendarId) {
      params.append('calendarId', calendarId);
    }

    return await backendRequest(`/graph/events?${params}`);
  } catch (error) {
    console.error("Error getting calendar events:", error);
    throw error;
  }
};

/**
 * Get all calendars (owned and shared) for a user
 * @param {string} userId - User ID or email
 * @returns {Promise<Object>} Calendars response
 */
export const getCalendars = async (userId) => {
  try {
    const params = new URLSearchParams({ userId });
    return await backendRequest(`/graph/calendars?${params}`);
  } catch (error) {
    console.error("Error getting calendars:", error);
    throw error;
  }
};

/**
 * Get shared calendars specifically
 * Note: With app permissions, this returns all calendars for the specified user
 * @param {string} userId - User ID or email
 * @returns {Promise<Object>} Calendars response
 */
export const getSharedCalendars = async (userId) => {
  // With application permissions, we access calendars for a specific user/mailbox
  // The concept of "shared" is different - we specify which user's calendars to access
  return getCalendars(userId);
};

/**
 * Search for calendars by user email
 * @param {string} searchEmail - Email to search for
 * @returns {Promise<Object>} Calendars response
 */
export const searchUserCalendars = async (searchEmail) => {
  try {
    const params = new URLSearchParams({ email: searchEmail });
    return await backendRequest(`/graph/calendars/search?${params}`);
  } catch (error) {
    console.error("Error searching user calendars:", error);
    throw error;
  }
};

/**
 * Create a new calendar event
 * @param {string} userId - User ID or email (calendar owner)
 * @param {Object} event - Event data
 * @param {string} calendarId - Optional specific calendar ID
 * @returns {Promise<Object>} Created event
 */
export const createCalendarEvent = async (userId, event, calendarId = null) => {
  try {
    return await backendRequest('/graph/events', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        calendarId,
        eventData: event
      })
    });
  } catch (error) {
    console.error("Error creating calendar event:", error);
    throw error;
  }
};

/**
 * Update a calendar event
 * @param {string} userId - User ID or email (calendar owner)
 * @param {string} eventId - Event ID to update
 * @param {Object} eventData - Updated event data
 * @param {string} calendarId - Optional specific calendar ID
 * @returns {Promise<Object>} Updated event
 */
export const updateCalendarEvent = async (userId, eventId, eventData, calendarId = null) => {
  try {
    return await backendRequest(`/graph/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        userId,
        calendarId,
        eventData
      })
    });
  } catch (error) {
    console.error("Error updating calendar event:", error);
    throw error;
  }
};

/**
 * Delete a calendar event
 * @param {string} userId - User ID or email (calendar owner)
 * @param {string} eventId - Event ID to delete
 * @param {string} calendarId - Optional specific calendar ID
 * @returns {Promise<Object>} Success indicator
 */
export const deleteCalendarEvent = async (userId, eventId, calendarId = null) => {
  try {
    const params = new URLSearchParams({ userId });
    if (calendarId) {
      params.append('calendarId', calendarId);
    }
    return await backendRequest(`/graph/events/${eventId}?${params}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error("Error deleting calendar event:", error);
    throw error;
  }
};

/**
 * Create linked events (main event + registration event) atomically
 * @param {string} userId - User ID or email (calendar owner)
 * @param {Object} mainEventData - Main event data
 * @param {Object} registrationEventData - Registration event data
 * @param {string} mainCalendarId - Calendar ID for main event
 * @param {string} registrationCalendarId - Calendar ID for registration event
 * @returns {Promise<Object>} Both created events with linking information
 */
export const createLinkedEvents = async (userId, mainEventData, registrationEventData, mainCalendarId, registrationCalendarId) => {
  try {
    return await backendRequest('/graph/events/linked', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        mainEventData,
        registrationEventData,
        mainCalendarId,
        registrationCalendarId
      })
    });
  } catch (error) {
    console.error("Error creating linked events:", error);
    throw error;
  }
};

/**
 * Find linked event using extended properties
 * @param {string} userId - User ID or email (calendar owner)
 * @param {string} eventId - ID of the event to find linked event for
 * @param {string} calendarId - Calendar ID (optional)
 * @returns {Promise<Object|null>} Linked event or null if not found
 */
export const findLinkedEvent = async (userId, eventId, calendarId = null) => {
  try {
    const params = new URLSearchParams({ userId });
    if (calendarId) {
      params.append('calendarId', calendarId);
    }
    return await backendRequest(`/graph/events/${eventId}/linked?${params}`);
  } catch (error) {
    // 404 means no linked event found - return null instead of throwing
    if (error.status === 404) {
      return null;
    }
    console.error("Error finding linked event:", error);
    return null;
  }
};

/**
 * Update linked event when source event changes
 * @param {string} userId - User ID or email (calendar owner)
 * @param {string} sourceEventId - ID of the event that was changed
 * @param {Object} sourceEventData - Updated event data
 * @param {string} sourceCalendarId - Calendar ID of source event
 * @param {number} setupMinutes - Setup time in minutes
 * @param {number} teardownMinutes - Teardown time in minutes
 * @returns {Promise<Object|null>} Updated linked event or null if no linked event
 */
export const updateLinkedEvent = async (userId, sourceEventId, sourceEventData, sourceCalendarId, setupMinutes = 0, teardownMinutes = 0) => {
  try {
    return await backendRequest(`/graph/events/${sourceEventId}/linked`, {
      method: 'PATCH',
      body: JSON.stringify({
        userId,
        calendarId: sourceCalendarId,
        eventData: sourceEventData,
        setupMinutes,
        teardownMinutes
      })
    });
  } catch (error) {
    // 404 means no linked event found
    if (error.status === 404) {
      logger.log('No linked event found for', sourceEventId);
      return null;
    }
    console.error("Error updating linked event:", error);
    throw error;
  }
};

/**
 * Delete linked event when source event is deleted
 * @param {string} userId - User ID or email (calendar owner)
 * @param {string} eventId - ID of the deleted event
 * @param {string} calendarId - Calendar ID of deleted event
 * @returns {Promise<boolean>} Success indicator
 */
export const deleteLinkedEvent = async (userId, eventId, calendarId = null) => {
  try {
    const params = new URLSearchParams({ userId });
    if (calendarId) {
      params.append('calendarId', calendarId);
    }
    const result = await backendRequest(`/graph/events/${eventId}/linked?${params}`, {
      method: 'DELETE'
    });
    return result.success;
  } catch (error) {
    // 404 means event already deleted - treat as success
    if (error.status === 404) {
      logger.log('Linked event already deleted:', eventId);
      return true;
    }
    console.error("Error deleting linked event:", error);
    return false;
  }
};

/**
 * Get Outlook categories for a user
 * @param {string} userId - User ID or email
 * @returns {Promise<Object>} Categories response
 */
export const getOutlookCategories = async (userId) => {
  try {
    const params = new URLSearchParams({ userId });
    return await backendRequest(`/graph/categories?${params}`);
  } catch (error) {
    console.error("Error getting Outlook categories:", error);
    throw error;
  }
};

/**
 * Create an Outlook category
 * @param {string} userId - User ID or email
 * @param {string} displayName - Category name
 * @param {string} color - Category color
 * @returns {Promise<Object>} Created category
 */
export const createOutlookCategory = async (userId, displayName, color) => {
  try {
    return await backendRequest('/graph/categories', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        displayName,
        color
      })
    });
  } catch (error) {
    console.error("Error creating Outlook category:", error);
    throw error;
  }
};

/**
 * Get schema extensions owned by the app
 * @param {string} ownerId - Optional owner ID (defaults to app ID)
 * @returns {Promise<Object>} Schema extensions response
 */
export const getSchemaExtensions = async (ownerId = null) => {
  try {
    const params = ownerId ? new URLSearchParams({ ownerId }) : new URLSearchParams();
    return await backendRequest(`/graph/schema-extensions?${params}`);
  } catch (error) {
    console.error("Error getting schema extensions:", error);
    throw error;
  }
};

/**
 * Create a schema extension
 * @param {Object} schemaData - Schema extension data
 * @returns {Promise<Object>} Created schema extension
 */
export const createSchemaExtension = async (schemaData) => {
  try {
    return await backendRequest('/graph/schema-extensions', {
      method: 'POST',
      body: JSON.stringify({ schemaData })
    });
  } catch (error) {
    console.error("Error creating schema extension:", error);
    throw error;
  }
};

/**
 * Update a schema extension
 * @param {string} schemaId - Schema extension ID
 * @param {Object} schemaData - Updated schema data
 * @returns {Promise<Object>} Updated schema extension
 */
export const updateSchemaExtension = async (schemaId, schemaData) => {
  try {
    return await backendRequest(`/graph/schema-extensions/${schemaId}`, {
      method: 'PATCH',
      body: JSON.stringify({ schemaData })
    });
  } catch (error) {
    console.error("Error updating schema extension:", error);
    throw error;
  }
};

/**
 * Delete a schema extension
 * @param {string} schemaId - Schema extension ID
 * @returns {Promise<Object>} Success indicator
 */
export const deleteSchemaExtension = async (schemaId) => {
  try {
    return await backendRequest(`/graph/schema-extensions/${schemaId}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error("Error deleting schema extension:", error);
    throw error;
  }
};

/**
 * Get recurring event instances
 * @param {string} userId - User ID or email
 * @param {string} seriesMasterId - Series master event ID
 * @param {string} startDateTime - ISO date string
 * @param {string} endDateTime - ISO date string
 * @param {string} calendarId - Optional calendar ID
 * @returns {Promise<Object>} Event instances response
 */
export const getRecurringEventInstances = async (userId, seriesMasterId, startDateTime, endDateTime, calendarId = null) => {
  try {
    const params = new URLSearchParams({
      userId,
      startDateTime,
      endDateTime
    });
    if (calendarId) {
      params.append('calendarId', calendarId);
    }
    return await backendRequest(`/graph/events/${seriesMasterId}/instances?${params}`);
  } catch (error) {
    console.error("Error getting recurring event instances:", error);
    throw error;
  }
};

/**
 * Batch calendar operations
 * @param {Array} requests - Array of batch request objects
 * @returns {Promise<Object>} Batch response
 */
export const batchCalendarOperations = async (requests) => {
  try {
    return await backendRequest('/graph/events/batch', {
      method: 'POST',
      body: JSON.stringify({ requests })
    });
  } catch (error) {
    console.error("Error in batch operation:", error);
    throw error;
  }
};

// Webhook functions - these are typically managed server-side with app permissions
// Keeping stubs for API compatibility but actual webhook management should be done via backend

/**
 * Create a webhook subscription for calendar changes
 * Note: With app permissions, webhooks are managed server-side
 * @deprecated Use backend webhook management instead
 */
export const createCalendarWebhook = async (/* userId, notificationUrl, calendarId */) => {
  console.warn('createCalendarWebhook: Webhooks should be managed server-side with app permissions');
  throw new Error('Webhook management should be done via backend admin endpoints');
};

/**
 * Renew a webhook subscription
 * @deprecated Use backend webhook management instead
 */
export const renewCalendarWebhook = async (/* subscriptionId */) => {
  console.warn('renewCalendarWebhook: Webhooks should be managed server-side with app permissions');
  throw new Error('Webhook management should be done via backend admin endpoints');
};

/**
 * Delete a webhook subscription
 * @deprecated Use backend webhook management instead
 */
export const deleteCalendarWebhook = async (/* subscriptionId */) => {
  console.warn('deleteCalendarWebhook: Webhooks should be managed server-side with app permissions');
  throw new Error('Webhook management should be done via backend admin endpoints');
};

/**
 * Process webhook notification
 * @deprecated Webhook processing happens server-side
 */
export const processWebhookNotification = async (/* notification */) => {
  console.warn('processWebhookNotification: Webhooks are processed server-side');
  throw new Error('Webhook processing happens on the backend');
};
