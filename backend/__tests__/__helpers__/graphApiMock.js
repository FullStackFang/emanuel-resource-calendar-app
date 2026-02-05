/**
 * Mock for graphApiService
 *
 * Provides mock implementations of Graph API operations for testing.
 * Use with: jest.mock('../../services/graphApiService', () => require('../__helpers__/graphApiMock'));
 */

// Track call history for assertions
const callHistory = {
  createCalendarEvent: [],
  updateCalendarEvent: [],
  deleteCalendarEvent: [],
  getAccessToken: [],
};

// Configurable responses (can be modified per-test)
const mockResponses = {
  createCalendarEvent: null,
  updateCalendarEvent: null,
  deleteCalendarEvent: null,
  getAccessToken: null,
};

// Error responses to simulate failures
const mockErrors = {
  createCalendarEvent: null,
  updateCalendarEvent: null,
  deleteCalendarEvent: null,
  getAccessToken: null,
};

/**
 * Generate a mock Graph event ID
 * @returns {string} Mock Graph ID
 */
function generateMockGraphId() {
  return `AAMkAMock${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
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
 * Clear all call history (call in beforeEach)
 */
function clearCallHistory() {
  callHistory.createCalendarEvent = [];
  callHistory.updateCalendarEvent = [];
  callHistory.deleteCalendarEvent = [];
  callHistory.getAccessToken = [];
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
  mockErrors.createCalendarEvent = null;
  mockErrors.updateCalendarEvent = null;
  mockErrors.deleteCalendarEvent = null;
  mockErrors.getAccessToken = null;
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

  // Test utilities
  clearCallHistory,
  resetMocks,
  setMockResponse,
  setMockError,
  getCallHistory,
  assertCalled,
  assertNotCalled,
  generateMockGraphId,
};
