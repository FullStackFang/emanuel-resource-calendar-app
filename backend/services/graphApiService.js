/**
 * Graph API Service for Temple Emanuel Resource Calendar
 * Uses Microsoft Graph API with Application Permissions (Client Credentials Flow)
 *
 * This service handles all Graph API operations using app-only authentication,
 * eliminating the need for individual users to have calendar permissions.
 */

const msal = require('@azure/msal-node');
const logger = require('../utils/logger');

// Azure AD Configuration
const APP_ID = process.env.APP_ID || 'c2187009-796d-4fea-b58c-f83f7a89589e';
const TENANT_ID = process.env.TENANT_ID || 'fcc71126-2b16-4653-b639-0f1ef8332302';

// Graph API base URL
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

// Extended Properties for Event Linking (same as frontend)
const EXTENDED_PROPERTY_NAMESPACE = 'Emanuel-Calendar-App';
const LINKED_EVENT_ID_PROPERTY = `String {66f5a359-4659-4830-9070-00047ec6ac6e} Name ${EXTENDED_PROPERTY_NAMESPACE}_linkedEventId`;
const EVENT_TYPE_PROPERTY = `String {66f5a359-4659-4830-9070-00047ec6ac6f} Name ${EXTENDED_PROPERTY_NAMESPACE}_eventType`;

// MSAL Client (lazy initialization)
let cca = null;

// Token cache
let cachedToken = null;
let tokenExpiry = null;

/**
 * Initialize MSAL client for client credentials flow
 * @returns {msal.ConfidentialClientApplication}
 */
function getMsalClient() {
  if (!cca) {
    const clientSecret = process.env.GRAPH_CLIENT_SECRET || process.env.EMAIL_CLIENT_SECRET;

    if (!clientSecret) {
      throw new Error('GRAPH_CLIENT_SECRET or EMAIL_CLIENT_SECRET environment variable is required');
    }

    const msalConfig = {
      auth: {
        clientId: APP_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: clientSecret
      }
    };
    cca = new msal.ConfidentialClientApplication(msalConfig);
    logger.debug('MSAL client initialized for Graph API service');
  }
  return cca;
}

/**
 * Acquire access token using client credentials flow
 * Includes caching to minimize token requests
 * @returns {Promise<string>} Access token
 */
async function getAppAccessToken() {
  // Check cache first (with 5 minute buffer before expiry)
  const now = Date.now();
  if (cachedToken && tokenExpiry && (tokenExpiry - now) > 300000) {
    return cachedToken;
  }

  try {
    const client = getMsalClient();
    const result = await client.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default']
    });

    // Cache the token
    cachedToken = result.accessToken;
    // MSAL tokens typically expire in 1 hour, cache expiry time
    tokenExpiry = now + (result.expiresOn ? (result.expiresOn.getTime() - now) : 3600000);

    logger.debug('Acquired new Graph API app token');
    return cachedToken;
  } catch (error) {
    logger.error('Failed to acquire Graph API token:', error);
    throw new Error('Failed to authenticate with Microsoft Graph API');
  }
}

/**
 * Make an authenticated request to Microsoft Graph API
 * @param {string} endpoint - API endpoint (without base URL)
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} API response
 */
async function graphRequest(endpoint, options = {}) {
  const token = await getAppAccessToken();

  const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  // Handle non-JSON responses (like DELETE which returns 204 No Content)
  if (response.status === 204) {
    return { success: true };
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = data.error?.message || `Graph API error: ${response.status}`;
    logger.error('Graph API request failed:', {
      endpoint,
      status: response.status,
      error: data.error
    });

    const error = new Error(errorMessage);
    error.status = response.status;
    error.graphError = data.error;
    throw error;
  }

  return data;
}

// =============================================================================
// CALENDAR OPERATIONS
// =============================================================================

/**
 * Get calendars for a user
 * @param {string} userId - User ID or email (e.g., 'temple@emanuelnyc.org')
 * @returns {Promise<Object>} Calendars response
 */
async function getCalendars(userId) {
  const endpoint = `/users/${encodeURIComponent(userId)}/calendars`;
  const params = new URLSearchParams({
    $select: 'id,name,owner,canEdit,canShare,canViewPrivateItems,isDefaultCalendar',
    $orderby: 'name'
  });

  return graphRequest(`${endpoint}?${params}`);
}

/**
 * Get a specific calendar's details
 * @param {string} userId - User ID or email
 * @param {string} calendarId - Calendar ID
 * @returns {Promise<Object>} Calendar details
 */
async function getCalendar(userId, calendarId) {
  const endpoint = `/users/${encodeURIComponent(userId)}/calendars/${calendarId}`;
  const params = new URLSearchParams({
    $select: 'id,name,owner,canEdit,canShare,canViewPrivateItems,isDefaultCalendar'
  });

  return graphRequest(`${endpoint}?${params}`);
}

/**
 * Get calendar events for a date range
 * @param {string} userId - User ID or email
 * @param {string} calendarId - Calendar ID (optional, uses default calendar if not provided)
 * @param {string} startDateTime - ISO date string
 * @param {string} endDateTime - ISO date string
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} Array of events
 */
async function getCalendarEvents(userId, calendarId, startDateTime, endDateTime, options = {}) {
  const { top = 250, select, expand, filter } = options;

  // Build endpoint path
  const basePath = `/users/${encodeURIComponent(userId)}`;
  const calendarPath = calendarId
    ? `${basePath}/calendars/${calendarId}/calendarView`
    : `${basePath}/calendar/calendarView`;

  // Build query parameters
  const params = new URLSearchParams({
    startDateTime: startDateTime,
    endDateTime: endDateTime,
    $top: top.toString()
  });

  if (select) params.append('$select', select);
  if (expand) params.append('$expand', expand);
  if (filter) params.append('$filter', filter);

  // Fetch all pages
  let allEvents = [];
  let nextLink = `${calendarPath}?${params}`;

  while (nextLink) {
    const data = await graphRequest(nextLink);
    allEvents = allEvents.concat(data.value || []);
    nextLink = data['@odata.nextLink'] || null;
  }

  return allEvents;
}

/**
 * Get a single event by ID
 * @param {string} userId - User ID or email
 * @param {string} calendarId - Calendar ID
 * @param {string} eventId - Event ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Event data
 */
async function getEvent(userId, calendarId, eventId, options = {}) {
  const { select, expand } = options;

  const basePath = `/users/${encodeURIComponent(userId)}`;
  const eventPath = calendarId
    ? `${basePath}/calendars/${calendarId}/events/${eventId}`
    : `${basePath}/calendar/events/${eventId}`;

  const params = new URLSearchParams();
  if (select) params.append('$select', select);
  if (expand) params.append('$expand', expand);

  const queryString = params.toString();
  return graphRequest(queryString ? `${eventPath}?${queryString}` : eventPath);
}

/**
 * Create a calendar event
 * @param {string} userId - User ID or email (calendar owner)
 * @param {string} calendarId - Calendar ID (optional)
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Created event
 */
async function createCalendarEvent(userId, calendarId, eventData) {
  const basePath = `/users/${encodeURIComponent(userId)}`;
  const endpoint = calendarId
    ? `${basePath}/calendars/${calendarId}/events`
    : `${basePath}/calendar/events`;

  return graphRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(eventData)
  });
}

/**
 * Update a calendar event
 * @param {string} userId - User ID or email
 * @param {string} calendarId - Calendar ID
 * @param {string} eventId - Event ID
 * @param {Object} eventData - Updated event data
 * @returns {Promise<Object>} Updated event
 */
async function updateCalendarEvent(userId, calendarId, eventId, eventData) {
  const basePath = `/users/${encodeURIComponent(userId)}`;
  const endpoint = calendarId
    ? `${basePath}/calendars/${calendarId}/events/${eventId}`
    : `${basePath}/calendar/events/${eventId}`;

  return graphRequest(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(eventData)
  });
}

/**
 * Delete a calendar event
 * @param {string} userId - User ID or email
 * @param {string} calendarId - Calendar ID
 * @param {string} eventId - Event ID
 * @returns {Promise<Object>} Success indicator
 */
async function deleteCalendarEvent(userId, calendarId, eventId) {
  const basePath = `/users/${encodeURIComponent(userId)}`;
  const endpoint = calendarId
    ? `${basePath}/calendars/${calendarId}/events/${eventId}`
    : `${basePath}/calendar/events/${eventId}`;

  return graphRequest(endpoint, { method: 'DELETE' });
}

/**
 * Batch calendar operations
 * @param {Array} requests - Array of batch request objects
 * @returns {Promise<Object>} Batch response
 */
async function batchRequest(requests) {
  return graphRequest('/$batch', {
    method: 'POST',
    body: JSON.stringify({ requests })
  });
}

// =============================================================================
// RECURRING EVENT OPERATIONS
// =============================================================================

/**
 * Get instances of a recurring event
 * @param {string} userId - User ID or email
 * @param {string} calendarId - Calendar ID
 * @param {string} seriesMasterId - Series master event ID
 * @param {string} startDateTime - ISO date string
 * @param {string} endDateTime - ISO date string
 * @returns {Promise<Array>} Array of event instances
 */
async function getRecurringEventInstances(userId, calendarId, seriesMasterId, startDateTime, endDateTime) {
  const basePath = `/users/${encodeURIComponent(userId)}`;
  const endpoint = calendarId
    ? `${basePath}/calendars/${calendarId}/events/${seriesMasterId}/instances`
    : `${basePath}/calendar/events/${seriesMasterId}/instances`;

  const params = new URLSearchParams({
    startDateTime,
    endDateTime
  });

  const data = await graphRequest(`${endpoint}?${params}`);
  return data.value || [];
}

// =============================================================================
// USER OPERATIONS
// =============================================================================

/**
 * Get user details
 * @param {string} userId - User ID or email
 * @returns {Promise<Object>} User details
 */
async function getUserDetails(userId) {
  return graphRequest(`/users/${encodeURIComponent(userId)}`);
}

/**
 * Search for users by email or name
 * @param {string} searchQuery - Search query
 * @returns {Promise<Array>} Array of matching users
 */
async function searchUsers(searchQuery) {
  const params = new URLSearchParams({
    $filter: `startswith(mail,'${searchQuery}') or startswith(displayName,'${searchQuery}')`,
    $select: 'id,displayName,mail,userPrincipalName'
  });

  const data = await graphRequest(`/users?${params}`);
  return data.value || [];
}

// =============================================================================
// OUTLOOK CATEGORIES
// =============================================================================

/**
 * Get Outlook master categories for a user
 * @param {string} userId - User ID or email
 * @returns {Promise<Array>} Array of categories
 */
async function getOutlookCategories(userId) {
  const data = await graphRequest(`/users/${encodeURIComponent(userId)}/outlook/masterCategories`);
  return data.value || [];
}

/**
 * Create an Outlook category
 * @param {string} userId - User ID or email
 * @param {Object} categoryData - Category data (displayName, color)
 * @returns {Promise<Object>} Created category
 */
async function createOutlookCategory(userId, categoryData) {
  return graphRequest(`/users/${encodeURIComponent(userId)}/outlook/masterCategories`, {
    method: 'POST',
    body: JSON.stringify(categoryData)
  });
}

// =============================================================================
// SCHEMA EXTENSIONS
// =============================================================================

/**
 * Get schema extensions owned by the app
 * @param {string} ownerId - Owner ID (usually the app ID)
 * @returns {Promise<Array>} Array of schema extensions
 */
async function getSchemaExtensions(ownerId = APP_ID) {
  const params = new URLSearchParams({
    $filter: `owner eq '${ownerId}'`
  });

  const data = await graphRequest(`/schemaExtensions?${params}`);
  return data.value || [];
}

/**
 * Create a schema extension
 * @param {Object} schemaData - Schema extension data
 * @returns {Promise<Object>} Created schema extension
 */
async function createSchemaExtension(schemaData) {
  return graphRequest('/schemaExtensions', {
    method: 'POST',
    body: JSON.stringify(schemaData)
  });
}

/**
 * Update a schema extension
 * @param {string} schemaId - Schema extension ID
 * @param {Object} schemaData - Updated schema data
 * @returns {Promise<Object>} Updated schema extension
 */
async function updateSchemaExtension(schemaId, schemaData) {
  return graphRequest(`/schemaExtensions/${schemaId}`, {
    method: 'PATCH',
    body: JSON.stringify(schemaData)
  });
}

/**
 * Delete a schema extension
 * @param {string} schemaId - Schema extension ID
 * @returns {Promise<Object>} Success indicator
 */
async function deleteSchemaExtension(schemaId) {
  return graphRequest(`/schemaExtensions/${schemaId}`, {
    method: 'DELETE'
  });
}

// =============================================================================
// LINKED EVENTS (Main + Registration Events)
// =============================================================================

/**
 * Create linked events (main event + registration/setup-teardown event)
 * @param {string} userId - User ID or email
 * @param {Object} mainEventData - Main event data
 * @param {Object} registrationEventData - Registration event data
 * @param {string} mainCalendarId - Calendar ID for main event
 * @param {string} registrationCalendarId - Calendar ID for registration event
 * @returns {Promise<Object>} Both created events with linking info
 */
async function createLinkedEvents(userId, mainEventData, registrationEventData, mainCalendarId, registrationCalendarId) {
  const basePath = `/users/${encodeURIComponent(userId)}`;

  // Create main event first
  const mainEventPath = mainCalendarId
    ? `${basePath}/calendars/${mainCalendarId}/events`
    : `${basePath}/calendar/events`;

  const mainEvent = await graphRequest(mainEventPath, {
    method: 'POST',
    body: JSON.stringify(mainEventData)
  });

  // Create registration event with linking to main event
  const registrationEventPath = registrationCalendarId
    ? `${basePath}/calendars/${registrationCalendarId}/events`
    : `${basePath}/calendar/events`;

  const linkedRegistrationEventData = {
    ...registrationEventData,
    singleValueExtendedProperties: [
      { id: LINKED_EVENT_ID_PROPERTY, value: mainEvent.id },
      { id: EVENT_TYPE_PROPERTY, value: 'registration' }
    ]
  };

  const registrationEvent = await graphRequest(registrationEventPath, {
    method: 'POST',
    body: JSON.stringify(linkedRegistrationEventData)
  });

  // Update main event with linking to registration event
  const mainEventUpdateData = {
    singleValueExtendedProperties: [
      { id: LINKED_EVENT_ID_PROPERTY, value: registrationEvent.id },
      { id: EVENT_TYPE_PROPERTY, value: 'main' }
    ]
  };

  await graphRequest(`${mainEventPath}/${mainEvent.id}`, {
    method: 'PATCH',
    body: JSON.stringify(mainEventUpdateData)
  });

  return {
    mainEvent: {
      ...mainEvent,
      linkedEventId: registrationEvent.id,
      eventType: 'main'
    },
    registrationEvent: {
      ...registrationEvent,
      linkedEventId: mainEvent.id,
      eventType: 'registration'
    }
  };
}

/**
 * Find linked event using extended properties
 * @param {string} userId - User ID or email
 * @param {string} eventId - Source event ID
 * @param {string} calendarId - Calendar ID
 * @returns {Promise<Object|null>} Linked event or null
 */
async function findLinkedEvent(userId, eventId, calendarId) {
  try {
    const basePath = `/users/${encodeURIComponent(userId)}`;
    const eventPath = calendarId
      ? `${basePath}/calendars/${calendarId}/events/${eventId}`
      : `${basePath}/calendar/events/${eventId}`;

    // Get source event with extended properties
    const expandFilter = `singleValueExtendedProperties($filter=id eq '${LINKED_EVENT_ID_PROPERTY}' or id eq '${EVENT_TYPE_PROPERTY}')`;
    const sourceEvent = await graphRequest(`${eventPath}?$expand=${encodeURIComponent(expandFilter)}`);

    if (!sourceEvent.singleValueExtendedProperties) {
      return null;
    }

    // Extract linked event ID
    const linkedEventIdProperty = sourceEvent.singleValueExtendedProperties.find(
      prop => prop.id === LINKED_EVENT_ID_PROPERTY
    );

    if (!linkedEventIdProperty) {
      return null;
    }

    const linkedEventId = linkedEventIdProperty.value;

    // Search for linked event across all calendars
    const calendarsResponse = await getCalendars(userId);

    for (const calendar of calendarsResponse.value || []) {
      try {
        const linkedEventPath = `${basePath}/calendars/${calendar.id}/events/${linkedEventId}`;
        const linkedEvent = await graphRequest(`${linkedEventPath}?$expand=${encodeURIComponent(expandFilter)}`);

        return {
          ...linkedEvent,
          calendarId: calendar.id,
          calendarName: calendar.name
        };
      } catch {
        // Event not in this calendar, continue searching
        continue;
      }
    }

    return null;
  } catch (error) {
    if (error.status === 404) {
      logger.debug('Source event not found (already deleted):', eventId);
      return null;
    }
    logger.error('Error finding linked event:', error);
    return null;
  }
}

/**
 * Update linked event when source event changes
 * @param {string} userId - User ID or email
 * @param {string} sourceEventId - Source event ID
 * @param {Object} sourceEventData - Updated source event data
 * @param {string} sourceCalendarId - Source calendar ID
 * @param {number} setupMinutes - Setup time in minutes
 * @param {number} teardownMinutes - Teardown time in minutes
 * @returns {Promise<Object|null>} Updated linked event or null
 */
async function updateLinkedEvent(userId, sourceEventId, sourceEventData, sourceCalendarId, setupMinutes = 0, teardownMinutes = 0) {
  try {
    const linkedEvent = await findLinkedEvent(userId, sourceEventId, sourceCalendarId);

    if (!linkedEvent) {
      logger.debug('No linked event found for', sourceEventId);
      return null;
    }

    // Determine event types
    const sourceEventType = sourceEventData.singleValueExtendedProperties?.find(
      prop => prop.id === EVENT_TYPE_PROPERTY
    )?.value || 'main';

    const linkedEventType = linkedEvent.singleValueExtendedProperties?.find(
      prop => prop.id === EVENT_TYPE_PROPERTY
    )?.value || 'registration';

    let updatedEventData;

    if (sourceEventType === 'main' && linkedEventType === 'registration') {
      // Main event changed, update registration event
      const sourceStart = new Date(sourceEventData.start.dateTime);
      const sourceEnd = new Date(sourceEventData.end.dateTime);

      const registrationStart = new Date(sourceStart.getTime() - (setupMinutes * 60 * 1000));
      const registrationEnd = new Date(sourceEnd.getTime() + (teardownMinutes * 60 * 1000));

      updatedEventData = {
        subject: `[SETUP/TEARDOWN] ${sourceEventData.subject}`,
        start: {
          dateTime: registrationStart.toISOString(),
          timeZone: sourceEventData.start.timeZone || 'UTC'
        },
        end: {
          dateTime: registrationEnd.toISOString(),
          timeZone: sourceEventData.end.timeZone || 'UTC'
        },
        location: sourceEventData.location
      };
    } else if (sourceEventType === 'registration' && linkedEventType === 'main') {
      // Registration event changed, update main event
      const sourceStart = new Date(sourceEventData.start.dateTime);
      const sourceEnd = new Date(sourceEventData.end.dateTime);

      const mainStart = new Date(sourceStart.getTime() + (setupMinutes * 60 * 1000));
      const mainEnd = new Date(sourceEnd.getTime() - (teardownMinutes * 60 * 1000));

      updatedEventData = {
        subject: sourceEventData.subject.replace(/^\[SETUP\/TEARDOWN\]\s*/, ''),
        start: {
          dateTime: mainStart.toISOString(),
          timeZone: sourceEventData.start.timeZone || 'UTC'
        },
        end: {
          dateTime: mainEnd.toISOString(),
          timeZone: sourceEventData.end.timeZone || 'UTC'
        },
        location: sourceEventData.location
      };
    }

    if (updatedEventData) {
      const basePath = `/users/${encodeURIComponent(userId)}`;
      const linkedEventPath = `${basePath}/calendars/${linkedEvent.calendarId}/events/${linkedEvent.id}`;
      const updatedEvent = await graphRequest(linkedEventPath, {
        method: 'PATCH',
        body: JSON.stringify(updatedEventData)
      });

      logger.debug(`Updated linked ${linkedEventType} event:`, updatedEvent.id);
      return updatedEvent;
    }

    return null;
  } catch (error) {
    logger.error('Error updating linked event:', error);
    throw error;
  }
}

/**
 * Delete linked event when source event is deleted
 * @param {string} userId - User ID or email
 * @param {string} eventId - Deleted event ID
 * @param {string} calendarId - Calendar ID
 * @returns {Promise<boolean>} Success indicator
 */
async function deleteLinkedEvent(userId, eventId, calendarId) {
  try {
    const linkedEvent = await findLinkedEvent(userId, eventId, calendarId);

    if (!linkedEvent) {
      logger.debug('No linked event found for deletion:', eventId);
      return false;
    }

    const basePath = `/users/${encodeURIComponent(userId)}`;
    const linkedEventPath = `${basePath}/calendars/${linkedEvent.calendarId}/events/${linkedEvent.id}`;

    await graphRequest(linkedEventPath, { method: 'DELETE' });

    logger.debug('Successfully deleted linked event:', linkedEvent.id);
    return true;
  } catch (error) {
    if (error.status === 404) {
      logger.debug('Linked event already deleted:', eventId);
      return true;
    }
    logger.error('Error deleting linked event:', error);
    return false;
  }
}

// =============================================================================
// WEBHOOK SUBSCRIPTIONS (for app-only flow)
// =============================================================================

/**
 * Create a webhook subscription for calendar changes
 * Note: With application permissions, use /users/{id}/events resource
 * @param {string} userId - User ID or email to monitor
 * @param {string} notificationUrl - Webhook endpoint URL
 * @param {string} calendarId - Specific calendar ID (optional)
 * @returns {Promise<Object>} Subscription details
 */
async function createCalendarWebhook(userId, notificationUrl, calendarId = null) {
  const resource = calendarId
    ? `/users/${userId}/calendars/${calendarId}/events`
    : `/users/${userId}/events`;

  const subscription = {
    changeType: 'created,updated,deleted',
    notificationUrl: notificationUrl,
    resource: resource,
    expirationDateTime: new Date(Date.now() + 4230 * 60 * 1000).toISOString(), // Max ~4230 mins for calendars
    clientState: 'emanuel-calendar-app-webhook'
  };

  return graphRequest('/subscriptions', {
    method: 'POST',
    body: JSON.stringify(subscription)
  });
}

/**
 * Renew a webhook subscription
 * @param {string} subscriptionId - Subscription ID
 * @returns {Promise<Object>} Updated subscription
 */
async function renewCalendarWebhook(subscriptionId) {
  const updateData = {
    expirationDateTime: new Date(Date.now() + 4230 * 60 * 1000).toISOString()
  };

  return graphRequest(`/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify(updateData)
  });
}

/**
 * Delete a webhook subscription
 * @param {string} subscriptionId - Subscription ID
 * @returns {Promise<boolean>} Success indicator
 */
async function deleteCalendarWebhook(subscriptionId) {
  try {
    await graphRequest(`/subscriptions/${subscriptionId}`, {
      method: 'DELETE'
    });
    return true;
  } catch (error) {
    logger.error('Error deleting webhook subscription:', error);
    return false;
  }
}

/**
 * List all active webhook subscriptions
 * @returns {Promise<Array>} Array of subscriptions
 */
async function listWebhookSubscriptions() {
  const data = await graphRequest('/subscriptions');
  return data.value || [];
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if the Graph API service is properly configured
 * @returns {Object} Configuration status
 */
function getServiceConfig() {
  return {
    hasClientSecret: !!(process.env.GRAPH_CLIENT_SECRET || process.env.EMAIL_CLIENT_SECRET),
    appId: APP_ID,
    tenantId: TENANT_ID,
    tokenCached: !!cachedToken,
    tokenExpiry: tokenExpiry ? new Date(tokenExpiry).toISOString() : null
  };
}

/**
 * Clear the token cache (useful for testing or forcing re-auth)
 */
function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = null;
  logger.debug('Graph API token cache cleared');
}

/**
 * Test the Graph API connection
 * @returns {Promise<boolean>} Connection success
 */
async function testConnection() {
  try {
    await getAppAccessToken();
    // Try a simple API call
    await graphRequest('/organization');
    return true;
  } catch (error) {
    logger.error('Graph API connection test failed:', error);
    return false;
  }
}

module.exports = {
  // Token management
  getAppAccessToken,
  clearTokenCache,
  getServiceConfig,
  testConnection,

  // Generic request
  graphRequest,
  batchRequest,

  // Calendar operations
  getCalendars,
  getCalendar,
  getCalendarEvents,
  getEvent,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,

  // Recurring events
  getRecurringEventInstances,

  // User operations
  getUserDetails,
  searchUsers,

  // Outlook categories
  getOutlookCategories,
  createOutlookCategory,

  // Schema extensions
  getSchemaExtensions,
  createSchemaExtension,
  updateSchemaExtension,
  deleteSchemaExtension,

  // Linked events
  createLinkedEvents,
  findLinkedEvent,
  updateLinkedEvent,
  deleteLinkedEvent,

  // Webhooks
  createCalendarWebhook,
  renewCalendarWebhook,
  deleteCalendarWebhook,
  listWebhookSubscriptions,

  // Constants
  LINKED_EVENT_ID_PROPERTY,
  EVENT_TYPE_PROPERTY
};
