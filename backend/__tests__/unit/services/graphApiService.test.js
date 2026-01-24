/**
 * Tests for graphApiService.js
 *
 * This service handles Microsoft Graph API operations using
 * app-only authentication (client credentials flow).
 */

// Mock the logger before requiring the service
jest.mock('../../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Set environment variables before requiring the service
process.env.GRAPH_CLIENT_SECRET = 'test-client-secret';
process.env.APP_ID = 'test-app-id';
process.env.TENANT_ID = 'test-tenant-id';

// Mock msal-node
jest.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: jest.fn().mockImplementation(() => ({
    acquireTokenByClientCredential: jest.fn().mockResolvedValue({
      accessToken: 'mock-access-token-12345',
      expiresOn: new Date(Date.now() + 3600000) // 1 hour from now
    })
  }))
}));

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch globally
global.fetch = jest.fn();

const graphApiService = require('../../../services/graphApiService');

// Helper to create mock fetch response
const mockFetchResponse = (data, status = 200) => {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data)
  });
};

describe('graphApiService', () => {
  beforeEach(() => {
    // Clear token cache before each test
    graphApiService.clearTokenCache();
    global.fetch.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  describe('Token Management', () => {
    describe('getAppAccessToken()', () => {
      it('acquires a new token when cache is empty', async () => {
        const token = await graphApiService.getAppAccessToken();

        expect(token).toBe('mock-access-token-12345');
      });

      it('returns cached token on subsequent calls', async () => {
        // First call
        const token1 = await graphApiService.getAppAccessToken();

        // Second call should return same token
        const token2 = await graphApiService.getAppAccessToken();

        expect(token1).toBe(token2);
      });
    });

    describe('clearTokenCache()', () => {
      it('clears the cached token', async () => {
        // Get a token first
        await graphApiService.getAppAccessToken();

        // Clear the cache
        graphApiService.clearTokenCache();

        // getServiceConfig should show no cached token
        const config = graphApiService.getServiceConfig();
        expect(config.tokenCached).toBe(false);
      });
    });

    describe('getServiceConfig()', () => {
      it('returns correct configuration', () => {
        const config = graphApiService.getServiceConfig();

        expect(config.hasClientSecret).toBe(true);
        expect(config.appId).toBe('test-app-id');
        expect(config.tenantId).toBe('test-tenant-id');
      });
    });
  });

  describe('Calendar Operations', () => {
    beforeEach(async () => {
      // Ensure we have a token
      await graphApiService.getAppAccessToken();
    });

    describe('getCalendars()', () => {
      it('fetches calendars for a user', async () => {
        const mockCalendars = {
          value: [
            { id: 'cal-1', name: 'Calendar 1', isDefaultCalendar: true },
            { id: 'cal-2', name: 'Calendar 2', isDefaultCalendar: false }
          ]
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockCalendars));

        const result = await graphApiService.getCalendars('user@example.com');

        expect(result.value).toHaveLength(2);
        expect(result.value[0].name).toBe('Calendar 1');
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/users/user%40example.com/calendars'),
          expect.any(Object)
        );
      });
    });

    describe('getCalendarEvents()', () => {
      it('fetches events for a date range', async () => {
        const mockEvents = [
          {
            id: 'event-1',
            subject: 'Meeting',
            start: { dateTime: '2024-03-15T14:00:00', timeZone: 'UTC' },
            end: { dateTime: '2024-03-15T15:00:00', timeZone: 'UTC' }
          }
        ];

        global.fetch.mockResolvedValueOnce(mockFetchResponse({ value: mockEvents }));

        const result = await graphApiService.getCalendarEvents(
          'user@example.com',
          null, // default calendar
          '2024-03-01T00:00:00Z',
          '2024-03-31T23:59:59Z'
        );

        expect(result).toHaveLength(1);
        expect(result[0].subject).toBe('Meeting');
      });

      it('uses specific calendar when calendarId provided', async () => {
        global.fetch.mockResolvedValueOnce(mockFetchResponse({ value: [] }));

        const result = await graphApiService.getCalendarEvents(
          'user@example.com',
          'specific-cal',
          '2024-03-01T00:00:00Z',
          '2024-03-31T23:59:59Z'
        );

        expect(result).toEqual([]);
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/calendars/specific-cal/calendarView'),
          expect.any(Object)
        );
      });

      it('handles pagination with nextLink', async () => {
        // First page
        global.fetch.mockResolvedValueOnce(mockFetchResponse({
          value: [{ id: 'event-1', subject: 'Event 1' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users/test/calendar/calendarView?$skiptoken=abc'
        }));

        // Second page
        global.fetch.mockResolvedValueOnce(mockFetchResponse({
          value: [{ id: 'event-2', subject: 'Event 2' }]
        }));

        const result = await graphApiService.getCalendarEvents(
          'test',
          null,
          '2024-03-01T00:00:00Z',
          '2024-03-31T23:59:59Z'
        );

        expect(result).toHaveLength(2);
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('createCalendarEvent()', () => {
      it('creates a new event', async () => {
        const newEvent = {
          subject: 'New Meeting',
          start: { dateTime: '2024-03-15T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2024-03-15T15:00:00', timeZone: 'UTC' }
        };

        const mockResponse = { id: 'new-event-id', ...newEvent };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockResponse, 201));

        const result = await graphApiService.createCalendarEvent(
          'user@example.com',
          null,
          newEvent
        );

        expect(result.id).toBe('new-event-id');
        expect(result.subject).toBe('New Meeting');
      });

      it('creates event in specific calendar', async () => {
        const newEvent = { subject: 'Test' };

        global.fetch.mockResolvedValueOnce(mockFetchResponse({ id: 'event-id', ...newEvent }, 201));

        const result = await graphApiService.createCalendarEvent(
          'user@example.com',
          'cal-123',
          newEvent
        );

        expect(result.id).toBe('event-id');
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/calendars/cal-123/events'),
          expect.any(Object)
        );
      });
    });

    describe('updateCalendarEvent()', () => {
      it('updates an existing event', async () => {
        const updateData = {
          subject: 'Updated Meeting'
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse({ id: 'event-123', ...updateData }));

        const result = await graphApiService.updateCalendarEvent(
          'user@example.com',
          null,
          'event-123',
          updateData
        );

        expect(result.subject).toBe('Updated Meeting');
      });
    });

    describe('deleteCalendarEvent()', () => {
      it('deletes an event', async () => {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: () => Promise.resolve({})
        });

        const result = await graphApiService.deleteCalendarEvent(
          'user@example.com',
          null,
          'event-123'
        );

        expect(result.success).toBe(true);
      });
    });

    describe('getEvent()', () => {
      it('fetches a single event by ID', async () => {
        const mockEvent = {
          id: 'event-123',
          subject: 'Single Event'
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockEvent));

        const result = await graphApiService.getEvent(
          'user@example.com',
          null,
          'event-123'
        );

        expect(result.id).toBe('event-123');
        expect(result.subject).toBe('Single Event');
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await graphApiService.getAppAccessToken();
    });

    it('handles 404 Not Found', async () => {
      global.fetch.mockResolvedValueOnce(mockFetchResponse({
        error: {
          code: 'ErrorItemNotFound',
          message: 'The specified object was not found'
        }
      }, 404));

      await expect(
        graphApiService.getEvent('user@example.com', null, 'nonexistent')
      ).rejects.toThrow();
    });

    it('handles 403 Forbidden', async () => {
      global.fetch.mockResolvedValueOnce(mockFetchResponse({
        error: {
          code: 'ErrorAccessDenied',
          message: 'Access denied'
        }
      }, 403));

      await expect(
        graphApiService.getCalendars('user@example.com')
      ).rejects.toThrow('Access denied');
    });

    it('handles 429 Rate Limit', async () => {
      global.fetch.mockResolvedValueOnce(mockFetchResponse({
        error: {
          code: 'TooManyRequests',
          message: 'Too many requests'
        }
      }, 429));

      await expect(
        graphApiService.getCalendars('user@example.com')
      ).rejects.toThrow();
    });

    it('handles network errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        graphApiService.getCalendars('user@example.com')
      ).rejects.toThrow('Network error');
    });
  });

  describe('User Operations', () => {
    beforeEach(async () => {
      await graphApiService.getAppAccessToken();
    });

    describe('getUserDetails()', () => {
      it('fetches user details', async () => {
        const mockUser = {
          id: 'user-123',
          displayName: 'John Doe',
          mail: 'john@example.com'
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockUser));

        const result = await graphApiService.getUserDetails('user@example.com');

        expect(result.displayName).toBe('John Doe');
        expect(result.mail).toBe('john@example.com');
      });
    });

    describe('searchUsers()', () => {
      it('searches for users', async () => {
        const mockUsers = {
          value: [
            { id: '1', displayName: 'John Doe', mail: 'john@example.com' },
            { id: '2', displayName: 'Jane Doe', mail: 'jane@example.com' }
          ]
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockUsers));

        const result = await graphApiService.searchUsers('john');

        expect(result).toHaveLength(2);
      });
    });
  });

  describe('Outlook Categories', () => {
    beforeEach(async () => {
      await graphApiService.getAppAccessToken();
    });

    describe('getOutlookCategories()', () => {
      it('fetches user categories', async () => {
        const mockCategories = {
          value: [
            { id: '1', displayName: 'Work', color: 'preset0' },
            { id: '2', displayName: 'Personal', color: 'preset1' }
          ]
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockCategories));

        const result = await graphApiService.getOutlookCategories('user@example.com');

        expect(result).toHaveLength(2);
        expect(result[0].displayName).toBe('Work');
      });
    });

    describe('createOutlookCategory()', () => {
      it('creates a new category', async () => {
        const newCategory = {
          displayName: 'Project',
          color: 'preset5'
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse({ id: 'cat-123', ...newCategory }, 201));

        const result = await graphApiService.createOutlookCategory('user@example.com', newCategory);

        expect(result.id).toBe('cat-123');
        expect(result.displayName).toBe('Project');
      });
    });
  });

  describe('Schema Extensions', () => {
    beforeEach(async () => {
      await graphApiService.getAppAccessToken();
    });

    describe('getSchemaExtensions()', () => {
      it('fetches schema extensions', async () => {
        const mockExtensions = {
          value: [
            { id: 'ext1', status: 'Available', properties: [] }
          ]
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockExtensions));

        const result = await graphApiService.getSchemaExtensions();

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('ext1');
      });
    });

    describe('createSchemaExtension()', () => {
      it('creates a new schema extension', async () => {
        const schemaData = {
          id: 'exttest_newschema',
          description: 'Test schema',
          targetTypes: ['Event'],
          properties: [{ name: 'customField', type: 'String' }]
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse({ ...schemaData, status: 'InDevelopment' }, 201));

        const result = await graphApiService.createSchemaExtension(schemaData);

        expect(result.id).toBe('exttest_newschema');
        expect(result.status).toBe('InDevelopment');
      });
    });
  });

  describe('Linked Events', () => {
    beforeEach(async () => {
      await graphApiService.getAppAccessToken();
    });

    describe('createLinkedEvents()', () => {
      it('creates main and registration events with linking', async () => {
        const mainEventData = {
          subject: 'Main Event',
          start: { dateTime: '2024-03-15T14:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2024-03-15T16:00:00Z', timeZone: 'UTC' }
        };

        const registrationEventData = {
          subject: '[SETUP/TEARDOWN] Main Event',
          start: { dateTime: '2024-03-15T13:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2024-03-15T17:00:00Z', timeZone: 'UTC' }
        };

        // Mock main event creation
        global.fetch.mockResolvedValueOnce(mockFetchResponse({ id: 'main-event-id', ...mainEventData }, 201));

        // Mock registration event creation
        global.fetch.mockResolvedValueOnce(mockFetchResponse({ id: 'reg-event-id', ...registrationEventData }, 201));

        // Mock main event update with linking
        global.fetch.mockResolvedValueOnce(mockFetchResponse({ id: 'main-event-id' }));

        const result = await graphApiService.createLinkedEvents(
          'user@example.com',
          mainEventData,
          registrationEventData,
          null,
          null
        );

        expect(result.mainEvent.id).toBe('main-event-id');
        expect(result.registrationEvent.id).toBe('reg-event-id');
        expect(result.mainEvent.linkedEventId).toBe('reg-event-id');
        expect(result.registrationEvent.linkedEventId).toBe('main-event-id');
      });
    });
  });

  describe('Batch Operations', () => {
    beforeEach(async () => {
      await graphApiService.getAppAccessToken();
    });

    describe('batchRequest()', () => {
      it('sends batch request', async () => {
        const requests = [
          { id: '1', method: 'GET', url: '/users/user1' },
          { id: '2', method: 'GET', url: '/users/user2' }
        ];

        const mockResponse = {
          responses: [
            { id: '1', status: 200, body: { displayName: 'User 1' } },
            { id: '2', status: 200, body: { displayName: 'User 2' } }
          ]
        };

        global.fetch.mockResolvedValueOnce(mockFetchResponse(mockResponse));

        const result = await graphApiService.batchRequest(requests);

        expect(result.responses).toHaveLength(2);
      });
    });
  });

  describe('Webhook Subscriptions', () => {
    beforeEach(async () => {
      await graphApiService.getAppAccessToken();
    });

    describe('createCalendarWebhook()', () => {
      it('creates a webhook subscription', async () => {
        global.fetch.mockResolvedValueOnce(mockFetchResponse({
          id: 'sub-123',
          resource: '/users/user@example.com/events',
          changeType: 'created,updated,deleted'
        }, 201));

        const result = await graphApiService.createCalendarWebhook(
          'user@example.com',
          'https://example.com/webhook'
        );

        expect(result.id).toBe('sub-123');
      });
    });

    describe('listWebhookSubscriptions()', () => {
      it('lists active subscriptions', async () => {
        global.fetch.mockResolvedValueOnce(mockFetchResponse({
          value: [
            { id: 'sub-1', resource: '/users/user1/events' },
            { id: 'sub-2', resource: '/users/user2/events' }
          ]
        }));

        const result = await graphApiService.listWebhookSubscriptions();

        expect(result).toHaveLength(2);
      });
    });

    describe('deleteCalendarWebhook()', () => {
      it('deletes a subscription', async () => {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: () => Promise.resolve({})
        });

        const result = await graphApiService.deleteCalendarWebhook('sub-123');

        expect(result).toBe(true);
      });

      it('returns false on error', async () => {
        global.fetch.mockResolvedValueOnce(mockFetchResponse({
          error: { message: 'Not found' }
        }, 404));

        const result = await graphApiService.deleteCalendarWebhook('sub-123');

        expect(result).toBe(false);
      });
    });
  });

  describe('testConnection()', () => {
    it('returns true when connection succeeds', async () => {
      global.fetch.mockResolvedValueOnce(mockFetchResponse({ value: [] }));

      const result = await graphApiService.testConnection();

      expect(result).toBe(true);
    });

    it('returns false when connection fails', async () => {
      // Clear token to force new acquisition
      graphApiService.clearTokenCache();

      // Mock token acquisition failure
      const msal = require('@azure/msal-node');
      msal.ConfidentialClientApplication.mockImplementationOnce(() => ({
        acquireTokenByClientCredential: jest.fn().mockRejectedValue(new Error('Auth failed'))
      }));

      const result = await graphApiService.testConnection();

      expect(result).toBe(false);
    });
  });
});
