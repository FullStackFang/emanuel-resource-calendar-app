/**
 * Tests for eventTransformers.js
 *
 * This is the SINGLE SOURCE OF TRUTH for event data transformation.
 * These tests ensure data flows correctly from various input formats
 * to the flat structure expected by forms and UI components.
 */

import { describe, it, expect } from 'vitest';
import {
  transformEventToFlatStructure,
  transformEventsToFlatStructure,
  sortEventsByStartTime,
  getSeriesMasterDisplayDates,
  getOccurrenceDateKey
} from '../../../utils/eventTransformers';

describe('transformEventToFlatStructure', () => {
  describe('null/undefined handling', () => {
    it('returns null for null input', () => {
      expect(transformEventToFlatStructure(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(transformEventToFlatStructure(undefined)).toBeNull();
    });

    it('handles empty object gracefully', () => {
      const result = transformEventToFlatStructure({});
      expect(result).toBeTruthy();
      expect(result.eventTitle).toBe('');
      expect(result.eventDescription).toBe('');
    });
  });

  describe('Graph API format (calendar events)', () => {
    it('transforms standard Graph API event correctly', () => {
      const graphEvent = {
        id: 'graph-123',
        subject: 'Board Meeting',
        bodyPreview: 'Monthly board meeting discussion',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' },
        location: { displayName: 'Conference Room A' },
        categories: ['Meeting', 'Board']
      };

      const result = transformEventToFlatStructure(graphEvent);

      expect(result.eventTitle).toBe('Board Meeting');
      expect(result.eventDescription).toBe('Monthly board meeting discussion');
      // Date/time are converted to local timezone, so just verify they're populated
      expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(result.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(result.location).toBe('Conference Room A');
      expect(result.categories).toEqual(['Meeting', 'Board']);
      expect(result.graphEventId).toBe('graph-123');
      expect(result.hasGraphId).toBe(true);
    });

    it('extracts text from HTML body content', () => {
      const graphEvent = {
        subject: 'HTML Event',
        body: { content: '<p>First paragraph</p><p>Second paragraph</p>' },
        start: { dateTime: '2024-03-15T10:00:00.000Z' },
        end: { dateTime: '2024-03-15T11:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(graphEvent);

      // Should strip HTML tags and preserve structure
      expect(result.eventDescription).not.toContain('<p>');
      expect(result.eventDescription).toContain('First paragraph');
    });

    it('handles all-day events from graphData', () => {
      const allDayEvent = {
        graphData: {
          subject: 'Holiday',
          isAllDay: true,
          start: { dateTime: '2024-12-25T00:00:00.000Z' },
          end: { dateTime: '2024-12-26T00:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(allDayEvent);

      expect(result.isAllDayEvent).toBe(true);
    });

    it('handles isAllDayEvent property directly', () => {
      const allDayEvent = {
        subject: 'Holiday',
        isAllDayEvent: true,
        start: { dateTime: '2024-12-25T00:00:00.000Z' },
        end: { dateTime: '2024-12-26T00:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(allDayEvent);

      expect(result.isAllDayEvent).toBe(true);
    });
  });

  describe('Reservation format (nested graphData)', () => {
    it('transforms reservation event with graphData correctly', () => {
      const reservationEvent = {
        _id: 'mongo-id-456',
        eventId: 'evt-request-789',
        status: 'room-reservation-request',
        graphData: {
          subject: 'Wedding Reception',
          start: { dateTime: '2024-06-15T17:00:00.000Z' },
          end: { dateTime: '2024-06-15T22:00:00.000Z' },
          categories: ['Special Event']
        },
        roomReservationData: {
          requestedBy: {
            name: 'John Smith',
            email: 'john@example.com',
            department: 'Events'
          },
          attendeeCount: 150,
          priority: 'high',
          submittedAt: '2024-05-01T10:00:00.000Z'
        },
        locations: [{ _id: 'room-1', name: 'Main Hall' }]
      };

      const result = transformEventToFlatStructure(reservationEvent);

      expect(result.eventTitle).toBe('Wedding Reception');
      expect(result.requesterName).toBe('John Smith');
      expect(result.requesterEmail).toBe('john@example.com');
      expect(result.department).toBe('Events');
      expect(result.attendeeCount).toBe(150);
      expect(result.priority).toBe('high');
      expect(result.status).toBe('pending');
      expect(result.requestedRooms).toEqual([{ _id: 'room-1', name: 'Main Hall' }]);
      expect(result._id).toBe('mongo-id-456');
    });

    it('uses eventId for pending reservations', () => {
      const pendingReservation = {
        eventId: 'evt-request-123',
        graphData: {
          subject: 'Pending Event',
          start: { dateTime: '2024-07-01T09:00:00.000Z' },
          end: { dateTime: '2024-07-01T10:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(pendingReservation);

      expect(result.eventId).toBe('evt-request-123');
      expect(result.hasGraphId).toBe(false);
    });
  });

  describe('Already-flat format (UI-created)', () => {
    it('preserves already-flat event structure', () => {
      const flatEvent = {
        eventTitle: 'Quick Meeting',
        startDate: '2024-04-01',
        startTime: '09:00',
        endDate: '2024-04-01',
        endTime: '10:00',
        eventDescription: 'A quick sync'
      };

      const result = transformEventToFlatStructure(flatEvent);

      expect(result.eventTitle).toBe('Quick Meeting');
      expect(result.startDate).toBe('2024-04-01');
      expect(result.startTime).toBe('09:00');
      expect(result.endDate).toBe('2024-04-01');
      expect(result.endTime).toBe('10:00');
      expect(result.eventDescription).toBe('A quick sync');
    });

    it('allows empty eventTitle for new events (no id)', () => {
      const newEvent = {
        startDate: '2024-04-01',
        startTime: '14:00',
        endDate: '2024-04-01',
        endTime: '15:00'
      };

      const result = transformEventToFlatStructure(newEvent);

      expect(result.eventTitle).toBe('');
    });
  });

  describe('Timing calculations', () => {
    it('leaves teardownTime empty when not explicitly provided', () => {
      const event = {
        subject: 'Event with no teardown',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      // teardownTime should be empty since it wasn't provided
      expect(result.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(result.teardownTime).toBe('');
    });

    it('preserves explicit teardownTime if provided', () => {
      const event = {
        subject: 'Event with explicit teardown',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' },
        teardownTime: '18:30'
      };

      const result = transformEventToFlatStructure(event);

      expect(result.teardownTime).toBe('18:30');
    });

    it('leaves doorCloseTime empty when not explicitly provided', () => {
      const event = {
        subject: 'Event',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      // doorCloseTime should be empty since it wasn't provided
      expect(result.doorCloseTime).toBe('');
    });

    it('handles setupTime and doorOpenTime defaults', () => {
      const event = {
        subject: 'Event',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      // setupTime and doorOpenTime should be empty when not explicitly set
      // (no auto-fill from startTime — empty indicates user hasn't set them yet)
      expect(result.setupTime).toBe('');
      expect(result.doorOpenTime).toBe('');
    });
  });

  describe('Offsite event detection', () => {
    it('detects offsite event when Graph location exists but no internal rooms', () => {
      const offsiteEvent = {
        subject: 'Offsite Meeting',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' },
        location: {
          displayName: 'Central Park',
          address: {
            street: '59th St',
            city: 'New York',
            state: 'NY',
            postalCode: '10022'
          }
        }
      };

      const result = transformEventToFlatStructure(offsiteEvent);

      expect(result.isOffsite).toBe(true);
      expect(result.offsiteName).toBe('Central Park');
      expect(result.offsiteAddress).toContain('59th St');
      expect(result.offsiteAddress).toContain('New York');
    });

    it('does not mark as offsite when internal rooms exist', () => {
      const internalEvent = {
        subject: 'Internal Meeting',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' },
        location: { displayName: 'Room 101' },
        locations: [{ _id: 'room-1', name: 'Room 101' }]
      };

      const result = transformEventToFlatStructure(internalEvent);

      expect(result.isOffsite).toBe(false);
    });

    it('treats "Unspecified" location as not having a valid offsite', () => {
      const eventWithUnspecified = {
        subject: 'Event',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' },
        location: { displayName: 'Unspecified' }
      };

      const result = transformEventToFlatStructure(eventWithUnspecified);

      expect(result.isOffsite).toBe(false);
    });
  });

  describe('Categories handling', () => {
    it('extracts categories from direct categories array', () => {
      const event = {
        subject: 'Categorized Event',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' },
        categories: ['Music', 'Concert']
      };

      const result = transformEventToFlatStructure(event);

      expect(result.categories).toEqual(['Music', 'Concert']);
      expect(result.mecCategories).toEqual(['Music', 'Concert']); // Backwards compat
    });

    it('falls back to graphData.categories', () => {
      const event = {
        graphData: {
          subject: 'Event',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' },
          categories: ['Worship']
        }
      };

      const result = transformEventToFlatStructure(event);

      expect(result.categories).toEqual(['Worship']);
    });

    it('defaults to empty array when no categories', () => {
      const event = {
        subject: 'No Categories',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      expect(result.categories).toEqual([]);
    });
  });

  describe('Series/recurrence data', () => {
    it('preserves eventSeriesId for recurring events', () => {
      const recurringEvent = {
        subject: 'Weekly Standup',
        start: { dateTime: '2024-03-15T09:00:00.000Z' },
        end: { dateTime: '2024-03-15T09:30:00.000Z' },
        eventSeriesId: 'series-abc-123',
        seriesIndex: 3,
        seriesLength: 52,
        recurrence: {
          pattern: { type: 'weekly', daysOfWeek: ['monday'] }
        }
      };

      const result = transformEventToFlatStructure(recurringEvent);

      expect(result.eventSeriesId).toBe('series-abc-123');
      expect(result.seriesIndex).toBe(3);
      expect(result.seriesLength).toBe(52);
      expect(result.recurrence).toBeTruthy();
      expect(result.recurrence.pattern.type).toBe('weekly');
    });

    it('extracts eventType from top-level (authoritative source)', () => {
      const seriesMasterEvent = {
        eventType: 'seriesMaster',
        seriesMasterId: null,
        recurrence: { pattern: { type: 'weekly' }, range: { type: 'endDate' } },
        graphData: {
          subject: 'Weekly Meeting',
          type: 'should-be-ignored',
          start: { dateTime: '2024-03-15T09:00:00.000Z' },
          end: { dateTime: '2024-03-15T10:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(seriesMasterEvent);

      expect(result.eventType).toBe('seriesMaster');
    });

    it('falls back to graphData.type when eventType is not present', () => {
      const graphEvent = {
        graphData: {
          subject: 'Occurrence Event',
          type: 'occurrence',
          seriesMasterId: 'master-123',
          start: { dateTime: '2024-03-15T09:00:00.000Z' },
          end: { dateTime: '2024-03-15T10:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(graphEvent);

      expect(result.eventType).toBe('occurrence');
      expect(result.seriesMasterId).toBe('master-123');
    });

    it('defaults eventType to singleInstance when neither source has it', () => {
      const standaloneEvent = {
        graphData: {
          subject: 'One-time Event',
          start: { dateTime: '2024-03-15T09:00:00.000Z' },
          end: { dateTime: '2024-03-15T10:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(standaloneEvent);

      expect(result.eventType).toBe('singleInstance');
      expect(result.seriesMasterId).toBeNull();
      expect(result.recurrence).toBeNull();
    });

    it('extracts seriesMasterId from top-level (authoritative source)', () => {
      const occurrenceEvent = {
        eventType: 'occurrence',
        seriesMasterId: 'master-xyz',
        graphData: {
          subject: 'Occurrence',
          seriesMasterId: 'should-be-ignored',
          start: { dateTime: '2024-03-15T09:00:00.000Z' },
          end: { dateTime: '2024-03-15T10:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(occurrenceEvent);

      expect(result.seriesMasterId).toBe('master-xyz');
    });

    it('extracts recurrence from top-level (authoritative source)', () => {
      const recurringEvent = {
        eventType: 'seriesMaster',
        recurrence: {
          pattern: { type: 'daily', interval: 1 },
          range: { type: 'numbered', numberOfOccurrences: 10 }
        },
        graphData: {
          subject: 'Daily Standup',
          recurrence: {
            pattern: { type: 'weekly' } // Should be ignored
          },
          start: { dateTime: '2024-03-15T09:00:00.000Z' },
          end: { dateTime: '2024-03-15T09:30:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(recurringEvent);

      expect(result.recurrence.pattern.type).toBe('daily');
      expect(result.recurrence.range.numberOfOccurrences).toBe(10);
    });

    it('reads eventType and seriesMasterId from calendarData', () => {
      const eventWithCalendarData = {
        calendarData: {
          eventType: 'occurrence',
          seriesMasterId: 'calendardata-master-id',
          recurrence: null
        },
        graphData: {
          subject: 'Occurrence from calendarData',
          type: 'should-be-ignored',
          seriesMasterId: 'should-be-ignored',
          start: { dateTime: '2024-03-15T09:00:00.000Z' },
          end: { dateTime: '2024-03-15T10:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(eventWithCalendarData);

      expect(result.eventType).toBe('occurrence');
      expect(result.seriesMasterId).toBe('calendardata-master-id');
    });
  });

  describe('Internal notes extraction', () => {
    it('extracts notes from roomReservationData.internalNotes', () => {
      const event = {
        graphData: {
          subject: 'Event with notes',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        },
        roomReservationData: {
          internalNotes: {
            setupNotes: 'Set up chairs',
            doorNotes: 'Prop open doors',
            eventNotes: 'VIP guest arriving'
          }
        }
      };

      const result = transformEventToFlatStructure(event);

      expect(result.setupNotes).toBe('Set up chairs');
      expect(result.doorNotes).toBe('Prop open doors');
      expect(result.eventNotes).toBe('VIP guest arriving');
    });

    it('falls back to top-level notes properties', () => {
      const event = {
        subject: 'Event with top-level notes',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' },
        setupNotes: 'Top-level setup note'
      };

      const result = transformEventToFlatStructure(event);

      expect(result.setupNotes).toBe('Top-level setup note');
    });
  });

  describe('ID property standardization', () => {
    it('provides id, eventId, graphEventId, and _id consistently', () => {
      const event = {
        _id: 'mongo-abc',
        eventId: 'evt-123',
        id: 'graph-xyz',
        subject: 'Test Event',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      expect(result.id).toBe('graph-xyz'); // Uses id first
      expect(result.eventId).toBe('evt-123');
      expect(result._id).toBe('mongo-abc');
    });
  });
});

describe('transformEventsToFlatStructure', () => {
  it('transforms array of events', () => {
    const events = [
      {
        subject: 'Event 1',
        start: { dateTime: '2024-03-15T10:00:00.000Z' },
        end: { dateTime: '2024-03-15T11:00:00.000Z' }
      },
      {
        subject: 'Event 2',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T15:00:00.000Z' }
      }
    ];

    const result = transformEventsToFlatStructure(events);

    expect(result).toHaveLength(2);
    expect(result[0].eventTitle).toBe('Event 1');
    expect(result[1].eventTitle).toBe('Event 2');
  });

  it('filters out null results', () => {
    const events = [
      {
        subject: 'Valid Event',
        start: { dateTime: '2024-03-15T10:00:00.000Z' },
        end: { dateTime: '2024-03-15T11:00:00.000Z' }
      },
      null,
      undefined
    ];

    const result = transformEventsToFlatStructure(events);

    expect(result).toHaveLength(1);
    expect(result[0].eventTitle).toBe('Valid Event');
  });

  it('returns empty array for non-array input', () => {
    expect(transformEventsToFlatStructure(null)).toEqual([]);
    expect(transformEventsToFlatStructure(undefined)).toEqual([]);
    expect(transformEventsToFlatStructure('not an array')).toEqual([]);
  });
});

describe('calendarData structure support', () => {
  describe('reading from calendarData with fallback', () => {
    it('reads fields from calendarData when present', () => {
      const eventWithCalendarData = {
        _id: 'mongo-123',
        calendarData: {
          eventTitle: 'Title from calendarData',
          eventDescription: 'Description from calendarData',
          startDateTime: '2024-03-15T14:00:00.000Z',
          endDateTime: '2024-03-15T16:00:00.000Z',
          startDate: '2024-03-15',
          startTime: '14:00',
          endDate: '2024-03-15',
          endTime: '16:00',
          setupTime: '13:30',
          teardownTime: '16:30',
          doorOpenTime: '13:45',
          doorCloseTime: '16:15',
          categories: ['CalendarData Category'],
          locations: [{ _id: 'room-1', name: 'Room A' }],
          requesterName: 'CalendarData User',
          requesterEmail: 'calendardata@example.com',
          department: 'CalendarData Dept',
          attendeeCount: 50,
          priority: 'high',
          assignedTo: 'CalendarData Staff'
        },
        graphData: {
          subject: 'Title from graphData',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(eventWithCalendarData);

      // Should prefer calendarData values over graphData
      expect(result.eventTitle).toBe('Title from calendarData');
      expect(result.eventDescription).toBe('Description from calendarData');
      expect(result.setupTime).toBe('13:30');
      expect(result.teardownTime).toBe('16:30');
      expect(result.doorOpenTime).toBe('13:45');
      expect(result.doorCloseTime).toBe('16:15');
      expect(result.categories).toEqual(['CalendarData Category']);
      expect(result.requestedRooms).toEqual([{ _id: 'room-1', name: 'Room A' }]);
      expect(result.requesterName).toBe('CalendarData User');
      expect(result.requesterEmail).toBe('calendardata@example.com');
      expect(result.department).toBe('CalendarData Dept');
      expect(result.attendeeCount).toBe(50);
      expect(result.priority).toBe('high');
      expect(result.assignedTo).toBe('CalendarData Staff');
    });

    it('falls back to top-level when calendarData missing', () => {
      const eventWithoutCalendarData = {
        _id: 'mongo-456',
        eventTitle: 'Top-level Title',
        eventDescription: 'Top-level Description',
        setupTime: '12:00',
        teardownTime: '18:00',
        categories: ['Top-level Category'],
        locations: [{ _id: 'room-2', name: 'Room B' }],
        requesterName: 'Top-level User',
        attendeeCount: 25,
        graphData: {
          subject: 'Graph Title',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(eventWithoutCalendarData);

      // Should use top-level values since no calendarData
      expect(result.setupTime).toBe('12:00');
      expect(result.teardownTime).toBe('18:00');
      expect(result.categories).toEqual(['Top-level Category']);
      expect(result.requestedRooms).toEqual([{ _id: 'room-2', name: 'Room B' }]);
      expect(result.requesterName).toBe('Top-level User');
      expect(result.attendeeCount).toBe(25);
    });

    it('prefers calendarData over top-level when both exist', () => {
      const eventWithBoth = {
        _id: 'mongo-789',
        // Top-level fields (should be ignored)
        setupTime: 'top-level-ignored',
        categories: ['Top-level Ignored'],
        requesterName: 'Top-level Ignored User',
        attendeeCount: 10,
        // calendarData fields (should be used)
        calendarData: {
          setupTime: '09:00',
          categories: ['CalendarData Preferred'],
          requesterName: 'CalendarData Preferred User',
          attendeeCount: 100
        },
        graphData: {
          subject: 'Test Event',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(eventWithBoth);

      // Should prefer calendarData values over top-level
      expect(result.setupTime).toBe('09:00');
      expect(result.categories).toEqual(['CalendarData Preferred']);
      expect(result.requesterName).toBe('CalendarData Preferred User');
      expect(result.attendeeCount).toBe(100);
    });

    it('handles empty calendarData object gracefully', () => {
      const eventWithEmptyCalendarData = {
        _id: 'mongo-empty',
        calendarData: {}, // Empty object
        eventTitle: 'Top-level Title Used',
        setupTime: '11:00',
        graphData: {
          subject: 'Graph Title',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(eventWithEmptyCalendarData);

      // Should fall back to top-level since calendarData is empty
      expect(result.setupTime).toBe('11:00');
    });
  });

  describe('calendarData with offsite location fields', () => {
    it('reads offsite fields from calendarData', () => {
      const offsiteEvent = {
        _id: 'mongo-offsite',
        calendarData: {
          isOffsite: true,
          offsiteName: 'Central Park',
          offsiteAddress: '123 Park Ave, NYC',
          offsiteLat: 40.7829,
          offsiteLon: -73.9654
        },
        graphData: {
          subject: 'Offsite Event',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(offsiteEvent);

      expect(result.isOffsite).toBe(true);
      expect(result.offsiteName).toBe('Central Park');
      expect(result.offsiteAddress).toBe('123 Park Ave, NYC');
      expect(result.offsiteLat).toBe(40.7829);
      expect(result.offsiteLon).toBe(-73.9654);
    });
  });

  describe('calendarData with virtual meeting fields', () => {
    it('reads virtual meeting fields from calendarData', () => {
      const virtualEvent = {
        _id: 'mongo-virtual',
        calendarData: {
          virtualMeetingUrl: 'https://zoom.us/j/123456',
          virtualPlatform: 'Zoom'
        },
        graphData: {
          subject: 'Virtual Event',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(virtualEvent);

      expect(result.virtualMeetingUrl).toBe('https://zoom.us/j/123456');
      expect(result.virtualPlatform).toBe('Zoom');
    });
  });

  describe('calendarData with notes fields', () => {
    it('reads notes fields from calendarData', () => {
      const eventWithNotes = {
        _id: 'mongo-notes',
        calendarData: {
          setupNotes: 'Setup chairs in rows',
          doorNotes: 'Side door access only',
          eventNotes: 'VIP attending'
        },
        graphData: {
          subject: 'Event with Notes',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(eventWithNotes);

      expect(result.setupNotes).toBe('Setup chairs in rows');
      expect(result.doorNotes).toBe('Side door access only');
      expect(result.eventNotes).toBe('VIP attending');
    });
  });

  describe('calendarData with contact person fields', () => {
    it('reads contact person fields from calendarData', () => {
      const eventWithContact = {
        _id: 'mongo-contact',
        calendarData: {
          contactName: 'Jane Doe',
          contactEmail: 'jane@example.com',
          isOnBehalfOf: true,
          reviewNotes: 'Approved by admin'
        },
        graphData: {
          subject: 'Event with Contact',
          start: { dateTime: '2024-03-15T14:00:00.000Z' },
          end: { dateTime: '2024-03-15T16:00:00.000Z' }
        }
      };

      const result = transformEventToFlatStructure(eventWithContact);

      expect(result.contactName).toBe('Jane Doe');
      expect(result.contactEmail).toBe('jane@example.com');
      expect(result.isOnBehalfOf).toBe(true);
      expect(result.reviewNotes).toBe('Approved by admin');
    });
  });
});

describe('sortEventsByStartTime', () => {
  it('sorts events by start time (earliest first)', () => {
    const events = [
      { start: { dateTime: '2024-03-15T16:00:00.000Z' } },
      { start: { dateTime: '2024-03-15T09:00:00.000Z' } },
      { start: { dateTime: '2024-03-15T12:00:00.000Z' } }
    ];

    const result = sortEventsByStartTime(events);

    // Use getTime() for comparison to avoid timezone issues
    expect(new Date(result[0].start.dateTime).getTime())
      .toBeLessThan(new Date(result[1].start.dateTime).getTime());
    expect(new Date(result[1].start.dateTime).getTime())
      .toBeLessThan(new Date(result[2].start.dateTime).getTime());

    // Verify the actual ISO strings are in order
    expect(result[0].start.dateTime).toBe('2024-03-15T09:00:00.000Z');
    expect(result[1].start.dateTime).toBe('2024-03-15T12:00:00.000Z');
    expect(result[2].start.dateTime).toBe('2024-03-15T16:00:00.000Z');
  });

  it('does not mutate the original array', () => {
    const events = [
      { start: { dateTime: '2024-03-15T16:00:00.000Z' } },
      { start: { dateTime: '2024-03-15T09:00:00.000Z' } }
    ];
    const originalFirst = events[0];

    const result = sortEventsByStartTime(events);

    expect(events[0]).toBe(originalFirst); // Original unchanged
    expect(result).not.toBe(events); // New array returned
  });

  it('handles events with invalid dates by pushing them to end', () => {
    const events = [
      { start: { dateTime: 'invalid-date' } },
      { start: { dateTime: '2024-03-15T09:00:00.000Z' } }
    ];

    const result = sortEventsByStartTime(events);

    // Valid date should come first
    expect(result[0].start.dateTime).toBe('2024-03-15T09:00:00.000Z');
    expect(result[1].start.dateTime).toBe('invalid-date');
  });

  it('returns same array for empty/null input', () => {
    expect(sortEventsByStartTime([])).toEqual([]);
    expect(sortEventsByStartTime(null)).toBeNull();
    expect(sortEventsByStartTime(undefined)).toBeUndefined();
  });
});

// =============================================================
// Event Organizer Contact Fields
// =============================================================
describe('transformEventToFlatStructure - organizer fields', () => {
  it('extracts organizer from calendarData', () => {
    const event = {
      _id: 'evt-1',
      calendarData: {
        organizerName: 'Rabbi Sarah',
        organizerPhone: '212-555-0101',
        organizerEmail: 'rabbi.sarah@emanuelnyc.org',
      },
    };
    const result = transformEventToFlatStructure(event);
    expect(result.organizerName).toBe('Rabbi Sarah');
    expect(result.organizerPhone).toBe('212-555-0101');
    expect(result.organizerEmail).toBe('rabbi.sarah@emanuelnyc.org');
  });

  it('falls back to roomReservationData.organizer for legacy events', () => {
    const event = {
      _id: 'evt-1-legacy',
      roomReservationData: {
        organizer: {
          name: 'Rabbi Sarah',
          phone: '212-555-0101',
          email: 'rabbi.sarah@emanuelnyc.org',
        },
      },
    };
    const result = transformEventToFlatStructure(event);
    expect(result.organizerName).toBe('Rabbi Sarah');
    expect(result.organizerPhone).toBe('212-555-0101');
    expect(result.organizerEmail).toBe('rabbi.sarah@emanuelnyc.org');
  });

  it('defaults organizer fields to empty strings when missing', () => {
    const event = {
      _id: 'evt-2',
      roomReservationData: {
        requestedBy: { name: 'Test', email: 'test@test.com' },
      },
    };
    const result = transformEventToFlatStructure(event);
    expect(result.organizerName).toBe('');
    expect(result.organizerPhone).toBe('');
    expect(result.organizerEmail).toBe('');
  });

  it('defaults organizer fields for event with no roomReservationData', () => {
    const event = { _id: 'evt-3' };
    const result = transformEventToFlatStructure(event);
    expect(result.organizerName).toBe('');
    expect(result.organizerPhone).toBe('');
    expect(result.organizerEmail).toBe('');
  });
});

describe('requirement B — virtual occurrence date resolution', () => {
  // Shape of a virtual occurrence produced by Calendar.jsx recurring expansion
  // (lines ~1860-1880). Both top-level flat fields AND Graph-shape fields are set
  // to the CLICKED day's values. But `calendarData` is inherited from the master
  // via `...event` spread and still carries the master's first-occurrence date.
  function buildVirtualOccurrence({
    clickedDate = '2026-04-22',
    masterFirstOccurrenceDate = '2026-04-15',
  } = {}) {
    return {
      // Top-level flat fields — CORRECT for the clicked occurrence
      startDate: clickedDate,
      endDate: clickedDate,
      startTime: '09:00',
      endTime: '10:00',
      startDateTime: `${clickedDate}T09:00:00`,
      endDateTime: `${clickedDate}T10:00:00`,
      // Graph-shape fields — CORRECT for the clicked occurrence
      start: { dateTime: `${clickedDate}T09:00:00` },
      end: { dateTime: `${clickedDate}T10:00:00` },
      // Recurring metadata
      isRecurringOccurrence: true,
      hasOccurrenceOverride: false, // NOT an override — just a regular occurrence
      eventType: 'occurrence',
      masterEventId: 'master-uuid',
      // calendarData inherited from master — STILL carries MASTER'S first-occurrence date
      calendarData: {
        startDate: masterFirstOccurrenceDate,
        endDate: masterFirstOccurrenceDate,
        startTime: '09:00',
        endTime: '10:00',
        startDateTime: `${masterFirstOccurrenceDate}T09:00:00`,
        endDateTime: `${masterFirstOccurrenceDate}T10:00:00`,
        eventTitle: 'Weekly class',
      },
      eventTitle: 'Weekly class',
    };
  }

  it('transforms a virtual occurrence so the flat startDate reflects the clicked day (AC-B1)', () => {
    const occurrence = buildVirtualOccurrence({
      clickedDate: '2026-04-22',
      masterFirstOccurrenceDate: '2026-04-15',
    });
    const result = transformEventToFlatStructure(occurrence);
    expect(result.startDate).toBe('2026-04-22'); // clicked day, NOT master's 2026-04-15
    expect(result.endDate).toBe('2026-04-22');
  });

  it('transforms a virtual occurrence so startTime/endTime reflect the occurrence, not the master via calendarData', () => {
    const occurrence = buildVirtualOccurrence({
      clickedDate: '2026-04-22',
      masterFirstOccurrenceDate: '2026-04-15',
    });
    // Give the occurrence a different time than the master carries in calendarData
    occurrence.startTime = '14:00';
    occurrence.endTime = '15:00';
    occurrence.startDateTime = '2026-04-22T14:00:00';
    occurrence.endDateTime = '2026-04-22T15:00:00';
    occurrence.start.dateTime = '2026-04-22T14:00:00';
    occurrence.end.dateTime = '2026-04-22T15:00:00';
    // calendarData still has 09:00 from the master
    const result = transformEventToFlatStructure(occurrence);
    expect(result.startDate).toBe('2026-04-22');
    expect(result.startTime).toBe('14:00');
    expect(result.endTime).toBe('15:00');
  });

  it('respects occurrence override fields (existing behavior regression guard)', () => {
    // When hasOccurrenceOverride === true, top-level has always won.
    // Ensure that behavior is preserved.
    const occurrence = buildVirtualOccurrence();
    occurrence.hasOccurrenceOverride = true;
    occurrence.eventTitle = 'Special title for this week';
    occurrence.calendarData.eventTitle = 'Weekly class';
    const result = transformEventToFlatStructure(occurrence);
    expect(result.eventTitle).toBe('Special title for this week');
  });
});

describe('getSeriesMasterDisplayDates', () => {
  it('returns recurrence range dates when eventType is seriesMaster (AC-A1, AC-A2)', () => {
    const reservation = { eventType: 'seriesMaster' };
    const recurrencePattern = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
      range: { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' }
    };
    const formData = { startDate: '2026-04-15', endDate: '2026-04-15' }; // first-occurrence

    const result = getSeriesMasterDisplayDates(reservation, recurrencePattern, formData);

    expect(result.displayStartDate).toBe('2026-04-15');
    expect(result.displayEndDate).toBe('2026-04-30'); // shows series range, not first-occurrence
  });

  it('returns range.startDate even when it differs from the first-occurrence date', () => {
    // Pattern: series starts 4/15, but first actual occurrence might be 4/16 after
    // day-of-week snapping. The master read-only display should still show range.startDate.
    const reservation = { eventType: 'seriesMaster' };
    const recurrencePattern = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
      range: { type: 'endDate', startDate: '2026-04-15', endDate: '2026-05-06' }
    };
    const formData = { startDate: '2026-04-16', endDate: '2026-04-16' }; // different first-occurrence

    const result = getSeriesMasterDisplayDates(reservation, recurrencePattern, formData);

    expect(result.displayStartDate).toBe('2026-04-15');
    expect(result.displayEndDate).toBe('2026-05-06');
  });

  it('falls back to formData dates for singleInstance events (AC-A3 regression guard)', () => {
    const reservation = { eventType: 'singleInstance' };
    const recurrencePattern = null;
    const formData = { startDate: '2026-04-20', endDate: '2026-04-20' };

    const result = getSeriesMasterDisplayDates(reservation, recurrencePattern, formData);

    expect(result.displayStartDate).toBe('2026-04-20');
    expect(result.displayEndDate).toBe('2026-04-20');
  });

  it('falls back to formData dates for occurrence/exception events', () => {
    const reservation = { eventType: 'occurrence' };
    const recurrencePattern = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
      range: { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' }
    };
    const formData = { startDate: '2026-04-22', endDate: '2026-04-22' }; // single occurrence

    const result = getSeriesMasterDisplayDates(reservation, recurrencePattern, formData);

    // Occurrences show their own date, not the series range
    expect(result.displayStartDate).toBe('2026-04-22');
    expect(result.displayEndDate).toBe('2026-04-22');
  });

  it('falls back to formData when eventType is seriesMaster but recurrence.range is missing', () => {
    const reservation = { eventType: 'seriesMaster' };
    const recurrencePattern = null; // legacy/corrupt data
    const formData = { startDate: '2026-04-15', endDate: '2026-04-15' };

    const result = getSeriesMasterDisplayDates(reservation, recurrencePattern, formData);

    expect(result.displayStartDate).toBe('2026-04-15');
    expect(result.displayEndDate).toBe('2026-04-15');
  });

  it('falls back to formData when recurrence exists but range.startDate is null', () => {
    const reservation = { eventType: 'seriesMaster' };
    const recurrencePattern = {
      pattern: { type: 'weekly', interval: 1 },
      range: { type: 'endDate', startDate: null, endDate: '2026-04-30' }
    };
    const formData = { startDate: '2026-04-15', endDate: '2026-04-15' };

    const result = getSeriesMasterDisplayDates(reservation, recurrencePattern, formData);

    // range.startDate nullish → fall back to formData on that side only
    expect(result.displayStartDate).toBe('2026-04-15');
    expect(result.displayEndDate).toBe('2026-04-30'); // range.endDate still wins
  });

  it('handles null reservation gracefully', () => {
    const formData = { startDate: '2026-04-15', endDate: '2026-04-15' };
    const result = getSeriesMasterDisplayDates(null, null, formData);
    expect(result.displayStartDate).toBe('2026-04-15');
    expect(result.displayEndDate).toBe('2026-04-15');
  });

  it('handles null formData gracefully', () => {
    const result = getSeriesMasterDisplayDates(null, null, null);
    expect(result.displayStartDate).toBeUndefined();
    expect(result.displayEndDate).toBeUndefined();
  });
});

describe('getOccurrenceDateKey', () => {
  it('returns occurrenceDate verbatim when already YYYY-MM-DD (exception document shape)', () => {
    expect(getOccurrenceDateKey({ occurrenceDate: '2026-04-22' })).toBe('2026-04-22');
  });

  it('strips T suffix from occurrenceDate when Graph-style datetime is supplied', () => {
    expect(getOccurrenceDateKey({ occurrenceDate: '2026-04-22T09:00:00' })).toBe('2026-04-22');
  });

  it('falls back to startDate when occurrenceDate is missing (virtual occurrence)', () => {
    expect(getOccurrenceDateKey({ startDate: '2026-04-22' })).toBe('2026-04-22');
  });

  it('strips T suffix from startDate when full datetime is supplied', () => {
    expect(getOccurrenceDateKey({ startDate: '2026-04-22T00:00:00' })).toBe('2026-04-22');
  });

  it('falls back to start.dateTime when neither occurrenceDate nor startDate is present', () => {
    expect(getOccurrenceDateKey({ start: { dateTime: '2026-04-22T09:00:00' } })).toBe('2026-04-22');
  });

  it('prefers occurrenceDate over startDate when both are present', () => {
    const result = getOccurrenceDateKey({
      occurrenceDate: '2026-04-22',
      startDate: '2026-04-15', // stale master value
    });
    expect(result).toBe('2026-04-22');
  });

  it('prefers startDate over start.dateTime when occurrenceDate is missing', () => {
    const result = getOccurrenceDateKey({
      startDate: '2026-04-22',
      start: { dateTime: '2026-04-15T09:00:00' },
    });
    expect(result).toBe('2026-04-22');
  });

  it('returns null when all candidate fields are missing', () => {
    expect(getOccurrenceDateKey({})).toBeNull();
    expect(getOccurrenceDateKey({ start: {} })).toBeNull();
  });

  it('returns null for null / undefined input', () => {
    expect(getOccurrenceDateKey(null)).toBeNull();
    expect(getOccurrenceDateKey(undefined)).toBeNull();
  });
});
