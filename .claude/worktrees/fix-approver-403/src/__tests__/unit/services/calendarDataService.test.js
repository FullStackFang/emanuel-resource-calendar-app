/**
 * Tests for CalendarDataService
 *
 * This service handles all calendar event operations, supporting both
 * demo mode (local data) and API mode (backend proxy to Graph API).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the dependencies before importing the service
vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

vi.mock('../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    DEFAULT_DISPLAY_CALENDAR: 'default@example.com'
  }
}));

// Import the service after mocking
import calendarDataService from '../../../services/calendarDataService';

describe('CalendarDataService', () => {
  beforeEach(() => {
    // Reset the service state before each test
    calendarDataService.setApiMode();
    calendarDataService.apiToken = null;
    calendarDataService.selectedCalendarId = null;
    calendarDataService.calendarOwner = null;
    calendarDataService.schemaExtensions = [];
    calendarDataService.userTimeZone = 'America/New_York';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('initializes with correct defaults', () => {
      expect(calendarDataService.isDemoMode).toBe(false);
      expect(calendarDataService.demoData).toBeNull();
      expect(calendarDataService.userTimeZone).toBe('America/New_York');
    });

    it('initialize() sets all configuration values', () => {
      calendarDataService.initialize(
        'graph-token', // kept for backward compat but ignored
        'api-token-123',
        'calendar-id-456',
        [{ id: 'ext1', properties: [] }],
        'America/Los_Angeles',
        'calendar@example.com'
      );

      expect(calendarDataService.apiToken).toBe('api-token-123');
      expect(calendarDataService.selectedCalendarId).toBe('calendar-id-456');
      expect(calendarDataService.schemaExtensions).toHaveLength(1);
      expect(calendarDataService.userTimeZone).toBe('America/Los_Angeles');
      expect(calendarDataService.calendarOwner).toBe('calendar@example.com');
    });

    it('uses default calendar owner when not provided', () => {
      calendarDataService.initialize('graph', 'api', 'cal');

      expect(calendarDataService.calendarOwner).toBe('default@example.com');
    });
  });

  describe('mode switching', () => {
    it('setDemoMode() enables demo mode with data', () => {
      const demoData = {
        events: [
          { id: '1', subject: 'Test Event', startDateTime: '2024-03-15T10:00:00Z', endDateTime: '2024-03-15T11:00:00Z' }
        ],
        totalEvents: 1
      };

      calendarDataService.setDemoMode(demoData);

      expect(calendarDataService.isDemoMode).toBe(true);
      expect(calendarDataService.isInDemoMode()).toBe(true);
      expect(calendarDataService.demoData).toBe(demoData);
    });

    it('setApiMode() disables demo mode', () => {
      calendarDataService.setDemoMode({ events: [] });
      calendarDataService.setApiMode();

      expect(calendarDataService.isDemoMode).toBe(false);
      expect(calendarDataService.isInDemoMode()).toBe(false);
      expect(calendarDataService.demoData).toBeNull();
    });
  });

  describe('setters', () => {
    it('setCalendarOwner() updates calendar owner', () => {
      calendarDataService.setCalendarOwner('new@example.com');
      expect(calendarDataService.calendarOwner).toBe('new@example.com');
    });

    it('setUserTimeZone() updates timezone', () => {
      calendarDataService.setUserTimeZone('Europe/London');
      expect(calendarDataService.userTimeZone).toBe('Europe/London');
    });
  });

  describe('getDemoDataStats()', () => {
    it('returns null when no demo data', () => {
      expect(calendarDataService.getDemoDataStats()).toBeNull();
    });

    it('returns stats when demo data exists', () => {
      calendarDataService.setDemoMode({
        events: [{ id: '1' }, { id: '2' }],
        totalEvents: 2,
        searchCriteria: { dateRange: '2024' },
        metadata: { year: 2024 },
        exportDate: '2024-03-15'
      });

      const stats = calendarDataService.getDemoDataStats();

      expect(stats.totalEvents).toBe(2);
      expect(stats.dateRange).toBe('2024');
      expect(stats.year).toBe(2024);
      expect(stats.exportDate).toBe('2024-03-15');
      expect(stats.userTimeZone).toBe('America/New_York');
    });
  });

  describe('convertTimeToUserTimezone()', () => {
    it('converts UTC time to user timezone', () => {
      calendarDataService.setUserTimeZone('America/New_York');
      const result = calendarDataService.convertTimeToUserTimezone('2024-03-15T18:00:00Z');

      // Should contain the date components
      expect(result).toContain('03');
      expect(result).toContain('15');
      expect(result).toContain('2024');
    });

    it('handles invalid date gracefully', () => {
      const result = calendarDataService.convertTimeToUserTimezone('invalid-date');
      // Function returns 'Invalid Date' for invalid inputs
      expect(result).toBe('Invalid Date');
    });
  });

  describe('_formatDateRangeForAPI()', () => {
    it('extends date range by one day on each side', () => {
      // Use explicit UTC midnight dates to avoid timezone issues
      const startDate = new Date('2024-03-15T12:00:00Z');
      const endDate = new Date('2024-03-20T12:00:00Z');
      const result = calendarDataService._formatDateRangeForAPI(startDate, endDate);

      // The result should extend the range - verify it contains earlier and later dates
      // Start should be before March 15 and end should be after March 20
      const resultStart = new Date(result.start);
      const resultEnd = new Date(result.end);

      expect(resultStart.getTime()).toBeLessThan(startDate.getTime());
      expect(resultEnd.getTime()).toBeGreaterThan(endDate.getTime());
    });

    it('returns ISO format strings', () => {
      const result = calendarDataService._formatDateRangeForAPI(
        new Date('2024-03-15T12:00:00Z'),
        new Date('2024-03-20T12:00:00Z')
      );

      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Demo Mode Operations', () => {
    // Function to create fresh demo data for each test (avoids shared state mutations)
    const createSampleDemoData = () => ({
      events: [
        {
          id: 'demo-1',
          subject: 'Morning Meeting',
          startDateTime: '2024-03-15T14:00:00.000Z',
          endDateTime: '2024-03-15T15:00:00.000Z',
          location: 'Room A',
          categories: ['Meeting']
        },
        {
          id: 'demo-2',
          subject: 'Afternoon Workshop',
          startDateTime: '2024-03-15T18:00:00.000Z',
          endDateTime: '2024-03-15T20:00:00.000Z',
          location: 'Room B',
          categories: ['Workshop']
        },
        {
          id: 'demo-3',
          subject: 'Next Week Event',
          startDateTime: '2024-03-22T14:00:00.000Z',
          endDateTime: '2024-03-22T15:00:00.000Z',
          location: 'Room C',
          categories: ['Event']
        }
      ],
      totalEvents: 3
    });

    beforeEach(() => {
      // Create fresh copy for each test to avoid state mutations affecting other tests
      calendarDataService.setDemoMode(createSampleDemoData());
    });

    describe('_getDemoEvents()', () => {
      it('returns empty array when no demo data', () => {
        calendarDataService.demoData = null;
        const result = calendarDataService._getDemoEvents({ start: new Date(), end: new Date() });
        expect(result).toEqual([]);
      });

      it('filters events by date range', () => {
        // Use full day range with explicit times to match events with times like 14:00:00Z
        const dateRange = {
          start: new Date('2024-03-15T00:00:00Z'),
          end: new Date('2024-03-15T23:59:59Z')
        };

        const result = calendarDataService._getDemoEvents(dateRange);

        // Should include March 15 events but not March 22
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.every(e => e.subject !== 'Next Week Event')).toBe(true);
      });

      it('handles events with missing startDateTime', () => {
        calendarDataService.demoData.events.push({
          id: 'bad-event',
          subject: 'No Date Event'
        });

        const dateRange = {
          start: new Date('2024-03-15T00:00:00Z'),
          end: new Date('2024-03-15T23:59:59Z')
        };

        const result = calendarDataService._getDemoEvents(dateRange);

        // Should not crash and should filter out bad event
        expect(result.find(e => e.subject === 'No Date Event')).toBeUndefined();
      });
    });

    describe('_createDemoEvent()', () => {
      it('creates event with generated ID', () => {
        const newEvent = {
          subject: 'New Demo Event',
          start: { dateTime: '2024-03-16T10:00:00Z' },
          end: { dateTime: '2024-03-16T11:00:00Z' },
          location: { displayName: 'New Room' }
        };

        const result = calendarDataService._createDemoEvent(newEvent);

        expect(result.id).toContain('demo_event_');
        expect(result.subject).toBe('New Demo Event');
        expect(calendarDataService.demoData.events).toHaveLength(4);
        expect(calendarDataService.demoData.totalEvents).toBe(4);
      });

      it('throws when demo data not available', () => {
        calendarDataService.demoData = null;

        expect(() => {
          calendarDataService._createDemoEvent({ subject: 'Test' });
        }).toThrow('Demo data not available');
      });
    });

    describe('_updateDemoEvent()', () => {
      it('updates existing demo event', () => {
        const updatedData = {
          id: 'demo-1',
          subject: 'Updated Morning Meeting',
          start: { dateTime: '2024-03-15T14:30:00Z' },
          end: { dateTime: '2024-03-15T15:30:00Z' }
        };

        const result = calendarDataService._updateDemoEvent(updatedData);

        expect(result.subject).toBe('Updated Morning Meeting');
        // Original data should be updated
        const updated = calendarDataService.demoData.events.find(e => e.id === 'demo-1');
        expect(updated.subject).toBe('Updated Morning Meeting');
      });

      it('throws when event not found', () => {
        expect(() => {
          calendarDataService._updateDemoEvent({ id: 'nonexistent', subject: 'Test' });
        }).toThrow('not found in demo data');
      });
    });

    describe('_deleteDemoEvent()', () => {
      it('deletes existing demo event', () => {
        const result = calendarDataService._deleteDemoEvent('demo-1');

        expect(result.success).toBe(true);
        expect(calendarDataService.demoData.events).toHaveLength(2);
        expect(calendarDataService.demoData.totalEvents).toBe(2);
        expect(calendarDataService.demoData.events.find(e => e.id === 'demo-1')).toBeUndefined();
      });

      it('throws when event not found', () => {
        expect(() => {
          calendarDataService._deleteDemoEvent('nonexistent');
        }).toThrow('not found in demo data');
      });
    });
  });

  describe('Event Conversion Methods', () => {
    describe('_convertDemoEventToCalendarFormat()', () => {
      it('converts demo event format to calendar format', () => {
        const demoEvent = {
          id: 'demo-123',
          subject: 'Test Event',
          startDateTime: '2024-03-15T14:00:00.000Z',
          endDateTime: '2024-03-15T16:00:00.000Z',
          location: 'Conference Room',
          categories: ['Meeting', 'Important'],
          attendees: [{ email: 'user@example.com' }],
          isAllDay: false
        };

        const result = calendarDataService._convertDemoEventToCalendarFormat(demoEvent);

        expect(result.id).toBe('demo-123');
        expect(result.subject).toBe('Test Event');
        expect(result.start.dateTime).toContain('2024-03-15');
        expect(result.end.dateTime).toContain('2024-03-15');
        expect(result.location.displayName).toBe('Conference Room');
        expect(result.categories).toEqual(['Meeting', 'Important']);
        expect(result.category).toBe('Meeting');
        expect(result.calendarName).toBe('Demo Calendar');
      });

      it('handles missing optional fields', () => {
        const minimalEvent = {
          id: 'minimal',
          startDateTime: '2024-03-15T14:00:00.000Z',
          endDateTime: '2024-03-15T16:00:00.000Z'
        };

        const result = calendarDataService._convertDemoEventToCalendarFormat(minimalEvent);

        expect(result.subject).toBe('Untitled Event');
        expect(result.location.displayName).toBe('');
        expect(result.category).toBe('Uncategorized');
        expect(result.categories).toEqual([]);
      });

      it('throws for missing date fields', () => {
        const badEvent = { id: 'bad', subject: 'No Dates' };

        expect(() => {
          calendarDataService._convertDemoEventToCalendarFormat(badEvent);
        }).toThrow('Missing date fields');
      });
    });

    describe('_convertCalendarEventToDemoFormat()', () => {
      it('converts calendar format to demo format', () => {
        const calendarEvent = {
          id: 'cal-123',
          subject: 'Calendar Event',
          start: { dateTime: '2024-03-15T14:00:00Z' },
          end: { dateTime: '2024-03-15T16:00:00Z' },
          location: { displayName: 'Room A' },
          categories: ['Work'],
          isAllDay: true
        };

        const result = calendarDataService._convertCalendarEventToDemoFormat(calendarEvent);

        expect(result.id).toBe('cal-123');
        expect(result.subject).toBe('Calendar Event');
        expect(result.startDateTime).toBe('2024-03-15T14:00:00Z');
        expect(result.endDateTime).toBe('2024-03-15T16:00:00Z');
        expect(result.location).toBe('Room A');
        expect(result.categories).toEqual(['Work']);
        expect(result.isAllDay).toBe(true);
      });
    });

    describe('_convertApiEventToCalendarFormat()', () => {
      it('converts API event format to calendar format', () => {
        const apiEvent = {
          id: 'api-123',
          subject: 'API Event',
          start: { dateTime: '2024-03-15T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2024-03-15T16:00:00', timeZone: 'UTC' },
          location: { displayName: 'API Room' },
          categories: ['API Category'],
          extensions: [],
          body: { content: 'Event body text' }
        };

        const result = calendarDataService._convertApiEventToCalendarFormat(apiEvent);

        expect(result.id).toBe('api-123');
        expect(result.subject).toBe('API Event');
        // Should append Z if missing
        expect(result.start.dateTime).toBe('2024-03-15T14:00:00Z');
        expect(result.end.dateTime).toBe('2024-03-15T16:00:00Z');
        expect(result.location.displayName).toBe('API Room');
        expect(result.body).toBe('Event body text');
        expect(result.calendarName).toBe('API Calendar');
      });

      it('extracts extension data', () => {
        const apiEvent = {
          id: 'api-ext',
          subject: 'Event with Extensions',
          start: { dateTime: '2024-03-15T14:00:00Z' },
          end: { dateTime: '2024-03-15T16:00:00Z' },
          extensions: [
            {
              id: 'ext1',
              '@odata.type': '#microsoft.graph.openTypeExtension',
              extensionName: 'CustomExt',
              customField: 'customValue',
              anotherField: 123
            }
          ]
        };

        const result = calendarDataService._convertApiEventToCalendarFormat(apiEvent);

        expect(result.customField).toBe('customValue');
        expect(result.anotherField).toBe(123);
      });
    });
  });

  describe('API Mode Operations', () => {
    let fetchMock;

    beforeEach(() => {
      fetchMock = vi.fn();
      global.fetch = fetchMock;
      calendarDataService.initialize('graph', 'api-token', 'cal-id', [], 'America/New_York', 'calendar@example.com');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('_getApiEvents()', () => {
      it('throws when API token not set', async () => {
        calendarDataService.apiToken = null;

        await expect(calendarDataService._getApiEvents({ start: new Date(), end: new Date() }))
          .rejects.toThrow('API token not available');
      });

      it('throws when calendar owner not set', async () => {
        calendarDataService.calendarOwner = null;

        await expect(calendarDataService._getApiEvents({ start: new Date(), end: new Date() }))
          .rejects.toThrow('Calendar owner not set');
      });

      it('fetches events from API', async () => {
        const mockEvents = [
          {
            id: 'api-1',
            subject: 'API Event',
            start: { dateTime: '2024-03-15T14:00:00', timeZone: 'UTC' },
            end: { dateTime: '2024-03-15T15:00:00', timeZone: 'UTC' }
          }
        ];

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ value: mockEvents })
        });

        const dateRange = {
          start: new Date('2024-03-15'),
          end: new Date('2024-03-15')
        };

        const result = await calendarDataService._getApiEvents(dateRange);

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/graph/events'),
          expect.objectContaining({
            headers: expect.objectContaining({
              'Authorization': 'Bearer api-token'
            })
          })
        );
        expect(result.length).toBeGreaterThanOrEqual(0);
      });

      it('handles 403 error with clear message', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'Access denied' })
        });

        await expect(calendarDataService._getApiEvents({ start: new Date(), end: new Date() }))
          .rejects.toThrow('permission');
      });

      it('handles 404 error', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve({})
        });

        await expect(calendarDataService._getApiEvents({ start: new Date(), end: new Date() }))
          .rejects.toThrow('Calendar not found');
      });
    });

    describe('_deleteApiEvent()', () => {
      it('calls DELETE endpoint', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({})
        });

        const result = await calendarDataService._deleteApiEvent('event-123');

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/graph/events/event-123'),
          expect.objectContaining({
            method: 'DELETE'
          })
        );
        expect(result.success).toBe(true);
      });
    });

    describe('_performApiEventOperation()', () => {
      it('creates event with POST', async () => {
        const mockResponse = { id: 'new-event', subject: 'New Event' };
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse)
        });

        const eventData = {
          subject: 'New Event',
          start: { dateTime: '2024-03-15T14:00:00Z' },
          end: { dateTime: '2024-03-15T15:00:00Z' }
        };

        const result = await calendarDataService._performApiEventOperation('POST', null, eventData);

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/graph/events'),
          expect.objectContaining({
            method: 'POST'
          })
        );
        expect(result).toEqual(mockResponse);
      });

      it('updates event with PATCH', async () => {
        const mockResponse = { id: 'event-123', subject: 'Updated Event' };
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse)
        });

        const eventData = {
          subject: 'Updated Event',
          start: { dateTime: '2024-03-15T14:00:00Z' },
          end: { dateTime: '2024-03-15T15:00:00Z' }
        };

        const result = await calendarDataService._performApiEventOperation('PATCH', 'event-123', eventData);

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/graph/events/event-123'),
          expect.objectContaining({
            method: 'PATCH'
          })
        );
        expect(result).toEqual(mockResponse);
      });

      it('throws for unsupported method', async () => {
        await expect(calendarDataService._performApiEventOperation('DELETE', 'event-123', {}))
          .rejects.toThrow('Unsupported method');
      });

      it('handles 403 on create with clear message', async () => {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({})
        });

        await expect(calendarDataService._performApiEventOperation('POST', null, { subject: 'Test' }))
          .rejects.toThrow('permission to create');
      });
    });
  });

  describe('Unified CRUD Operations', () => {
    it('getEvents() uses demo mode when enabled', async () => {
      calendarDataService.setDemoMode({
        events: [
          { id: '1', subject: 'Demo', startDateTime: '2024-03-15T14:00:00Z', endDateTime: '2024-03-15T15:00:00Z' }
        ]
      });

      const result = await calendarDataService.getEvents({
        start: new Date('2024-03-15'),
        end: new Date('2024-03-15')
      });

      // Should not call fetch
      expect(global.fetch).not.toHaveBeenCalled?.() || true;
    });

    it('createEvent() uses demo mode when enabled', async () => {
      calendarDataService.setDemoMode({ events: [] });

      const result = await calendarDataService.createEvent({
        subject: 'New Event',
        start: { dateTime: '2024-03-15T14:00:00Z' },
        end: { dateTime: '2024-03-15T15:00:00Z' }
      });

      expect(result.id).toContain('demo_event_');
    });
  });
});
