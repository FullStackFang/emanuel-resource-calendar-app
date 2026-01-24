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
  sortEventsByStartTime
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
    it('auto-calculates teardownTime as endTime + 1 hour', () => {
      const event = {
        subject: 'Event with auto teardown',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      // The teardownTime should be 1 hour after endTime
      expect(result.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(result.teardownTime).toMatch(/^\d{2}:\d{2}$/);

      // Verify teardown is 1 hour after end by parsing times
      const [endHours, endMinutes] = result.endTime.split(':').map(Number);
      const [teardownHours, teardownMinutes] = result.teardownTime.split(':').map(Number);
      const endTotalMinutes = endHours * 60 + endMinutes;
      const teardownTotalMinutes = teardownHours * 60 + teardownMinutes;
      expect(teardownTotalMinutes - endTotalMinutes).toBe(60);
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

    it('uses endTime as default for doorCloseTime', () => {
      const event = {
        subject: 'Event',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      // doorCloseTime should match endTime
      expect(result.doorCloseTime).toBe(result.endTime);
    });

    it('handles setupTime and doorOpenTime defaults', () => {
      const event = {
        subject: 'Event',
        start: { dateTime: '2024-03-15T14:00:00.000Z' },
        end: { dateTime: '2024-03-15T16:00:00.000Z' }
      };

      const result = transformEventToFlatStructure(event);

      // setupTime and doorOpenTime should match startTime
      expect(result.setupTime).toBe(result.startTime);
      expect(result.doorOpenTime).toBe(result.startTime);
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
