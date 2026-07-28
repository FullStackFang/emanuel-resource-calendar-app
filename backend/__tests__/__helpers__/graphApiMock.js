/**
 * Mock for graphApiService
 *
 * Provides mock implementations of Graph API operations for testing.
 * Use with: jest.mock('../../services/graphApiService', () => require('../__helpers__/graphApiMock'));
 * (createAppForTest instead injects it via setGraphApiService.)
 *
 * ERROR SHAPE CONTRACT: simulated Graph failures MUST be built with
 * buildGraphError — the same constructor services/graphApiService throws with.
 * A hand-rolled `{ statusCode: 429 }` is how the dead outer retry predicate
 * survived review: production threw `status`, every predicate read `statusCode`,
 * and the mock happened to agree with the predicate instead of with production.
 * Use graphError(status, message) below; setMockError still accepts a raw Error
 * for non-HTTP failures (network errors), but HTTP failures should go through
 * the builder.
 */

// Imported from utils/graphError, NOT from services/graphApiService — the
// service pulls in MSAL and Azure config at require time, which a test helper
// has no business loading.
const { buildGraphError } = require('../../utils/graphError');

// Track call history for assertions
const callHistory = {
  createCalendarEvent: [],
  updateCalendarEvent: [],
  deleteCalendarEvent: [],
  getAccessToken: [],
  getRecurringEventInstances: [],
  getCalendarEvents: [],
  getEvent: [],
};

// Configurable responses (can be modified per-test)
const mockResponses = {
  createCalendarEvent: null,
  updateCalendarEvent: null,
  deleteCalendarEvent: null,
  getAccessToken: null,
  getRecurringEventInstances: null,
  getCalendarEvents: null,
  getEvent: null,
};

// Error responses to simulate failures
const mockErrors = {
  createCalendarEvent: null,
  updateCalendarEvent: null,
  deleteCalendarEvent: null,
  getAccessToken: null,
  getRecurringEventInstances: null,
  getCalendarEvents: null,
  getEvent: null,
};

/**
 * Generate a mock Graph event ID
 * @returns {string} Mock Graph ID
 */
function generateMockGraphId() {
  return `AAMkAMock${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Build a Graph HTTP failure with exactly the shape production throws.
 * @param {number} status - e.g. 429, 404
 * @param {string} [message]
 * @returns {Error} carrying `status` (NOT `statusCode`) and `graphError`
 */
function graphError(status, message) {
  const text = message || `Graph API error: ${status}`;
  return buildGraphError(status, text, { code: `MockGraphError${status}`, message: text });
}

/**
 * Build a NETWORK failure with the shape Node's fetch (undici) actually
 * produces: a TypeError whose `cause` carries the OS code. The code never
 * appears on the thrown error itself — see utils/graphRetry.js for the probe
 * results this mirrors.
 *
 * @param {string} [code='ECONNRESET']
 * @returns {TypeError}
 */
function graphNetworkError(code = 'ECONNRESET') {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(`connect ${code} 20.190.1.1:443`), { code });
  return err;
}

/**
 * Validate a Graph recurrence object the way Microsoft Graph does, so tests
 * catch malformed patterns (e.g. absoluteMonthly missing dayOfMonth) instead
 * of getting a false success. Throws with Graph's real error messages.
 * @param {Object|undefined} recurrence - Graph recurrence { pattern, range }
 */
function assertValidGraphRecurrence(recurrence) {
  const pattern = recurrence?.pattern;
  if (!pattern) return;
  // Real Graph rejects these with 400 and these exact messages.
  if (pattern.type === 'absoluteMonthly' || pattern.type === 'absoluteYearly') {
    const day = pattern.dayOfMonth;
    if (typeof day !== 'number' || day < 1 || day > 31) {
      throw graphError(400, "Your request can't be completed. DayOfMonth should be between 1 and 31.");
    }
  }
  if (pattern.type === 'absoluteYearly') {
    const month = pattern.month;
    if (typeof month !== 'number' || month < 1 || month > 12) {
      throw graphError(400, "Your request can't be completed. Month should be between 1 and 12.");
    }
  }
}

/**
 * Mock createCalendarEvent
 * @param {string} calendarOwner - Calendar owner email
 * @param {string|null} calendarId - Calendar ID (optional)
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Mock Graph event response
 */
async function createCalendarEvent(calendarOwner, calendarId, eventData) {
  callHistory.createCalendarEvent.push({ calendarOwner, calendarId, eventData });

  if (mockErrors.createCalendarEvent) {
    throw mockErrors.createCalendarEvent;
  }

  if (mockResponses.createCalendarEvent) {
    return mockResponses.createCalendarEvent;
  }

  // Mirror Microsoft Graph's recurrence validation so malformed patterns are
  // caught in tests instead of silently "succeeding". absoluteMonthly/
  // absoluteYearly REQUIRE dayOfMonth (1-31); absoluteYearly also requires
  // month (1-12). Real Graph rejects otherwise with these exact messages.
  assertValidGraphRecurrence(eventData?.recurrence);

  const graphId = generateMockGraphId();
  return {
    id: graphId,
    iCalUId: `ical-${graphId}`,
    webLink: `https://outlook.office365.com/calendar/item/${graphId}`,
    changeKey: `changeKey-${Date.now()}`,
    subject: eventData.subject || eventData.eventTitle,
    start: eventData.start || { dateTime: eventData.startDateTime, timeZone: 'America/New_York' },
    end: eventData.end || { dateTime: eventData.endDateTime, timeZone: 'America/New_York' },
    body: eventData.body || { contentType: 'text', content: eventData.eventDescription || '' },
    location: eventData.location || { displayName: '' },
    categories: eventData.categories || [],
  };
}

/**
 * Mock updateCalendarEvent
 * @param {string} calendarOwner - Calendar owner email
 * @param {string|null} calendarId - Calendar ID (optional)
 * @param {string} eventId - Graph event ID
 * @param {Object} eventData - Updated event data
 * @returns {Promise<Object>} Mock updated event response
 */
async function updateCalendarEvent(calendarOwner, calendarId, eventId, eventData) {
  callHistory.updateCalendarEvent.push({ calendarOwner, calendarId, eventId, eventData });

  if (mockErrors.updateCalendarEvent) {
    throw mockErrors.updateCalendarEvent;
  }

  if (mockResponses.updateCalendarEvent) {
    return mockResponses.updateCalendarEvent;
  }

  return {
    id: eventId,
    changeKey: `changeKey-${Date.now()}`,
    ...eventData,
  };
}

/**
 * Mock deleteCalendarEvent
 * @param {string} calendarOwner - Calendar owner email
 * @param {string|null} calendarId - Calendar ID (optional)
 * @param {string} eventId - Graph event ID
 * @returns {Promise<void>}
 */
async function deleteCalendarEvent(calendarOwner, calendarId, eventId) {
  callHistory.deleteCalendarEvent.push({ calendarOwner, calendarId, eventId });

  if (mockErrors.deleteCalendarEvent) {
    throw mockErrors.deleteCalendarEvent;
  }

  if (mockResponses.deleteCalendarEvent) {
    return mockResponses.deleteCalendarEvent;
  }

  // Default: successful deletion (no response body)
  return;
}

/**
 * Mock getAccessToken
 * @returns {Promise<string>} Mock access token
 */
async function getAccessToken() {
  callHistory.getAccessToken.push({});

  if (mockErrors.getAccessToken) {
    throw mockErrors.getAccessToken;
  }

  if (mockResponses.getAccessToken) {
    return mockResponses.getAccessToken;
  }

  return 'mock-graph-access-token';
}

/**
 * Mock getRecurringEventInstances
 * @param {string} calendarOwner
 * @param {string|null} calendarId
 * @param {string} seriesMasterId
 * @param {string} startDateTime
 * @param {string} endDateTime
 * @returns {Promise<Array>}
 */
async function getRecurringEventInstances(calendarOwner, calendarId, seriesMasterId, startDateTime, endDateTime) {
  callHistory.getRecurringEventInstances.push({ calendarOwner, calendarId, seriesMasterId, startDateTime, endDateTime });

  if (mockErrors.getRecurringEventInstances) {
    throw mockErrors.getRecurringEventInstances;
  }

  if (mockResponses.getRecurringEventInstances) {
    return mockResponses.getRecurringEventInstances;
  }

  return [];
}

/**
 * Mock getCalendarEvents (Graph calendarView).
 *
 * Supports per-calendar responses: set the mock response to a plain array for a
 * single-calendar test, or to an object keyed by calendarOwner when a test
 * needs different results (or a thrown error) per mailbox.
 *
 * @param {string} userId - calendar owner email
 * @param {string|null} calendarId
 * @param {string} startDateTime
 * @param {string} endDateTime
 * @param {Object} options
 * @returns {Promise<Array>} Array of Graph events
 */
async function getCalendarEvents(userId, calendarId, startDateTime, endDateTime, options = {}) {
  callHistory.getCalendarEvents.push({ userId, calendarId, startDateTime, endDateTime, options });

  if (mockErrors.getCalendarEvents) {
    throw mockErrors.getCalendarEvents;
  }

  const configured = mockResponses.getCalendarEvents;
  if (Array.isArray(configured)) return configured;
  if (configured && typeof configured === 'object') {
    const perCalendar = configured[userId];
    if (perCalendar instanceof Error) throw perCalendar;
    return perCalendar || [];
  }

  return [];
}

/**
 * Mock getEvent (single Graph event by id).
 *
 * Supports per-id responses: set the mock response to a plain object for a
 * single-event test, or to a map keyed by eventId when a test needs different
 * results (or a thrown error, e.g. a 404) per id. An id absent from a map
 * throws a production-shaped 404, which is what Graph does.
 *
 * @param {string} userId
 * @param {string|null} calendarId
 * @param {string} eventId
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function getEvent(userId, calendarId, eventId, options = {}) {
  callHistory.getEvent.push({ userId, calendarId, eventId, options });

  if (mockErrors.getEvent) {
    throw mockErrors.getEvent;
  }

  const configured = mockResponses.getEvent;
  if (configured && typeof configured === 'object') {
    // A map keyed by event id, or a single event object.
    if (configured.id !== undefined) return configured;
    const perId = configured[eventId];
    if (perId instanceof Error) throw perId;
    if (perId) return perId;
    throw graphError(404, `The specified object was not found in the store: ${eventId}`);
  }

  return { id: eventId };
}

/**
 * Clear all call history (call in beforeEach)
 */
function clearCallHistory() {
  callHistory.createCalendarEvent = [];
  callHistory.updateCalendarEvent = [];
  callHistory.deleteCalendarEvent = [];
  callHistory.getAccessToken = [];
  callHistory.getRecurringEventInstances = [];
  callHistory.getCalendarEvents = [];
  callHistory.getEvent = [];
}

/**
 * Reset all mock responses and errors (call in beforeEach)
 */
function resetMocks() {
  clearCallHistory();
  mockResponses.createCalendarEvent = null;
  mockResponses.updateCalendarEvent = null;
  mockResponses.deleteCalendarEvent = null;
  mockResponses.getAccessToken = null;
  mockResponses.getRecurringEventInstances = null;
  mockResponses.getCalendarEvents = null;
  mockResponses.getEvent = null;
  mockErrors.getEvent = null;
  mockErrors.createCalendarEvent = null;
  mockErrors.updateCalendarEvent = null;
  mockErrors.deleteCalendarEvent = null;
  mockErrors.getAccessToken = null;
  mockErrors.getRecurringEventInstances = null;
  mockErrors.getCalendarEvents = null;
}

/**
 * Set a mock response for a specific method
 * @param {string} method - Method name
 * @param {*} response - Response to return
 */
function setMockResponse(method, response) {
  if (mockResponses[method] === undefined) {
    throw new Error(`Unknown method: ${method}`);
  }
  mockResponses[method] = response;
}

/**
 * Set a mock error for a specific method
 * @param {string} method - Method name
 * @param {Error} error - Error to throw
 */
function setMockError(method, error) {
  if (mockErrors[method] === undefined) {
    throw new Error(`Unknown method: ${method}`);
  }
  mockErrors[method] = error;
}

/**
 * Get call history for a specific method
 * @param {string} method - Method name
 * @returns {Array} Call history
 */
function getCallHistory(method) {
  return callHistory[method] || [];
}

/**
 * Assert that a method was called with specific arguments
 * @param {string} method - Method name
 * @param {Object} expectedArgs - Expected arguments (partial match)
 */
function assertCalled(method, expectedArgs = {}) {
  const calls = callHistory[method];
  if (!calls || calls.length === 0) {
    throw new Error(`Expected ${method} to be called, but it was not called`);
  }

  const matchingCall = calls.find((call) => {
    return Object.entries(expectedArgs).every(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(call[key]) === JSON.stringify(value);
      }
      return call[key] === value;
    });
  });

  if (!matchingCall) {
    throw new Error(
      `Expected ${method} to be called with ${JSON.stringify(expectedArgs)}, ` +
      `but was called with: ${JSON.stringify(calls)}`
    );
  }
}

/**
 * Assert that a method was not called
 * @param {string} method - Method name
 */
function assertNotCalled(method) {
  const calls = callHistory[method];
  if (calls && calls.length > 0) {
    throw new Error(
      `Expected ${method} not to be called, but it was called ${calls.length} time(s)`
    );
  }
}

module.exports = {
  // Main API methods
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getAccessToken,
  getRecurringEventInstances,
  getCalendarEvents,
  getEvent,

  // Test utilities
  clearCallHistory,
  resetMocks,
  setMockResponse,
  setMockError,
  getCallHistory,
  assertCalled,
  assertNotCalled,
  generateMockGraphId,

  // Production-shaped failure builders — prefer these over hand-rolled Errors.
  graphError,
  graphNetworkError,
};
