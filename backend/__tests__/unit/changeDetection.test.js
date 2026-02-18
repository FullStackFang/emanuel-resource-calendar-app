/**
 * Unit tests for change detection utility
 * Tests: detectEventChanges, formatChangesForEmail, valuesAreDifferent, formatChangeValue
 */

const {
  detectEventChanges,
  formatChangesForEmail,
  formatChangeValue,
  getFieldDisplayName,
  valuesAreDifferent,
  NOTIFIABLE_FIELDS,
  FIELD_DISPLAY_NAMES
} = require('../../utils/changeDetection');

describe('changeDetection', () => {
  // =========================================================================
  // valuesAreDifferent
  // =========================================================================
  describe('valuesAreDifferent', () => {
    test('identical strings are not different', () => {
      expect(valuesAreDifferent('hello', 'hello')).toBe(false);
    });

    test('different strings are different', () => {
      expect(valuesAreDifferent('hello', 'world')).toBe(true);
    });

    test('null and undefined are treated as equal', () => {
      expect(valuesAreDifferent(null, undefined)).toBe(false);
    });

    test('null and empty string are treated as equal', () => {
      expect(valuesAreDifferent(null, '')).toBe(false);
      expect(valuesAreDifferent('', null)).toBe(false);
    });

    test('empty arrays and null are treated as equal', () => {
      expect(valuesAreDifferent([], null)).toBe(false);
      expect(valuesAreDifferent(null, [])).toBe(false);
    });

    test('null and non-empty value are different', () => {
      expect(valuesAreDifferent(null, 'value')).toBe(true);
      expect(valuesAreDifferent('value', null)).toBe(true);
    });

    test('arrays with same elements (same order) are not different', () => {
      expect(valuesAreDifferent(['a', 'b'], ['a', 'b'])).toBe(false);
    });

    test('arrays with same elements (different order) are not different', () => {
      expect(valuesAreDifferent(['b', 'a'], ['a', 'b'])).toBe(false);
    });

    test('arrays with different elements are different', () => {
      expect(valuesAreDifferent(['a', 'b'], ['a', 'c'])).toBe(true);
    });

    test('arrays of different length are different', () => {
      expect(valuesAreDifferent(['a'], ['a', 'b'])).toBe(true);
    });

    test('numeric comparison handles string vs number', () => {
      expect(valuesAreDifferent(50, '50')).toBe(false);
      expect(valuesAreDifferent(50, 51)).toBe(true);
    });

    // DateTime normalization tests
    test('datetime with and without seconds are treated as equal', () => {
      expect(valuesAreDifferent('2026-02-18T10:00', '2026-02-18T10:00:00')).toBe(false);
      expect(valuesAreDifferent('2026-02-18T10:00:00', '2026-02-18T10:00')).toBe(false);
    });

    test('different datetimes with mixed seconds formats are still different', () => {
      expect(valuesAreDifferent('2026-02-18T10:00', '2026-02-18T11:00:00')).toBe(true);
      expect(valuesAreDifferent('2026-02-18T10:00:00', '2026-02-18T11:00')).toBe(true);
    });

    test('identical datetimes both without seconds are not different', () => {
      expect(valuesAreDifferent('2026-02-18T10:00', '2026-02-18T10:00')).toBe(false);
    });

    test('identical datetimes both with seconds are not different', () => {
      expect(valuesAreDifferent('2026-02-18T10:00:00', '2026-02-18T10:00:00')).toBe(false);
    });

    test('datetime normalization does not affect non-datetime strings', () => {
      expect(valuesAreDifferent('hello', 'hello:00')).toBe(true);
      expect(valuesAreDifferent('10:00', '10:00:00')).toBe(true);
    });
  });

  // =========================================================================
  // formatChangeValue
  // =========================================================================
  describe('formatChangeValue', () => {
    test('returns "(not set)" for null/undefined/empty', () => {
      expect(formatChangeValue('eventTitle', null)).toBe('(not set)');
      expect(formatChangeValue('eventTitle', undefined)).toBe('(not set)');
      expect(formatChangeValue('eventTitle', '')).toBe('(not set)');
    });

    test('formats boolean isOffsite field', () => {
      expect(formatChangeValue('isOffsite', true)).toBe('Yes');
      expect(formatChangeValue('isOffsite', false)).toBe('No');
    });

    test('formats arrays as comma-separated strings', () => {
      expect(formatChangeValue('categories', ['Music', 'Art'])).toBe('Music, Art');
    });

    test('returns "(none)" for empty arrays', () => {
      expect(formatChangeValue('categories', [])).toBe('(none)');
    });

    test('formats numbers as strings', () => {
      expect(formatChangeValue('attendeeCount', 50)).toBe('50');
    });

    test('passes through time-only fields as-is', () => {
      expect(formatChangeValue('setupTime', '08:00')).toBe('08:00');
    });
  });

  // =========================================================================
  // getFieldDisplayName
  // =========================================================================
  describe('getFieldDisplayName', () => {
    test('maps known fields to display names', () => {
      expect(getFieldDisplayName('eventTitle')).toBe('Event Title');
      expect(getFieldDisplayName('startDateTime')).toBe('Start Date/Time');
      expect(getFieldDisplayName('locationDisplayNames')).toBe('Location(s)');
      expect(getFieldDisplayName('attendeeCount')).toBe('Expected Attendees');
    });

    test('returns field name as-is for unknown fields', () => {
      expect(getFieldDisplayName('unknownField')).toBe('unknownField');
    });
  });

  // =========================================================================
  // detectEventChanges
  // =========================================================================
  describe('detectEventChanges', () => {
    const baseEvent = {
      eventTitle: 'Board Meeting',
      calendarData: {
        eventTitle: 'Board Meeting',
        startDateTime: '2025-01-24T14:00:00',
        endDateTime: '2025-01-24T16:00:00',
        locationDisplayNames: 'Room A',
        attendeeCount: 50,
        categories: ['Meeting'],
        setupTime: '08:00',
        eventDescription: 'Annual board meeting'
      }
    };

    test('returns empty array when no fields changed', () => {
      const changes = detectEventChanges(baseEvent, {});
      expect(changes).toEqual([]);
    });

    test('returns empty array when undefined fields are passed', () => {
      const changes = detectEventChanges(baseEvent, { eventTitle: undefined });
      expect(changes).toEqual([]);
    });

    test('detects title change', () => {
      const changes = detectEventChanges(baseEvent, { eventTitle: 'New Title' });
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        field: 'eventTitle',
        oldValue: 'Board Meeting',
        newValue: 'New Title',
        displayName: 'Event Title'
      });
    });

    test('detects time change', () => {
      const changes = detectEventChanges(baseEvent, {
        startDateTime: '2025-01-24T15:00:00'
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('startDateTime');
      expect(changes[0].oldValue).toBe('2025-01-24T14:00:00');
      expect(changes[0].newValue).toBe('2025-01-24T15:00:00');
    });

    test('detects multiple changes', () => {
      const changes = detectEventChanges(baseEvent, {
        eventTitle: 'New Title',
        startDateTime: '2025-01-24T15:00:00',
        attendeeCount: 100
      });
      expect(changes).toHaveLength(3);
      expect(changes.map(c => c.field)).toEqual(
        expect.arrayContaining(['eventTitle', 'startDateTime', 'attendeeCount'])
      );
    });

    test('ignores non-notifiable fields', () => {
      const changes = detectEventChanges(baseEvent, {
        someInternalField: 'new value',
        _version: 5
      });
      expect(changes).toEqual([]);
    });

    test('detects category array change', () => {
      const changes = detectEventChanges(baseEvent, {
        categories: ['Meeting', 'Board']
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('categories');
    });

    test('does not detect same category array (different order)', () => {
      const eventWithMultipleCategories = {
        ...baseEvent,
        calendarData: {
          ...baseEvent.calendarData,
          categories: ['Art', 'Music']
        }
      };
      const changes = detectEventChanges(eventWithMultipleCategories, {
        categories: ['Music', 'Art']
      });
      expect(changes).toEqual([]);
    });

    test('detects change when field not in calendarData but in top-level', () => {
      const eventWithTopLevel = {
        eventTitle: 'Top Level Title',
        calendarData: {} // no eventTitle in calendarData
      };
      const changes = detectEventChanges(eventWithTopLevel, {
        eventTitle: 'New Title'
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].oldValue).toBe('Top Level Title');
    });

    test('respects includeFields option', () => {
      const changes = detectEventChanges(
        baseEvent,
        { eventTitle: 'New', attendeeCount: 100 },
        { includeFields: ['eventTitle'] }
      );
      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('eventTitle');
    });

    test('detects numeric string vs number as same value', () => {
      const changes = detectEventChanges(baseEvent, { attendeeCount: '50' });
      expect(changes).toEqual([]);
    });

    test('does not flag datetime as changed when only seconds format differs', () => {
      const eventNoSeconds = {
        calendarData: {
          startDateTime: '2026-02-18T10:00',
          endDateTime: '2026-02-18T12:00'
        }
      };
      const changes = detectEventChanges(eventNoSeconds, {
        startDateTime: '2026-02-18T10:00:00',
        endDateTime: '2026-02-18T12:00:00'
      });
      expect(changes).toEqual([]);
    });

    test('detects location display name change', () => {
      const changes = detectEventChanges(baseEvent, {
        locationDisplayNames: 'Room B'
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('locationDisplayNames');
      expect(changes[0].oldValue).toBe('Room A');
      expect(changes[0].newValue).toBe('Room B');
    });
  });

  // =========================================================================
  // formatChangesForEmail
  // =========================================================================
  describe('formatChangesForEmail', () => {
    test('formats changes with display names and values', () => {
      const changes = [
        { field: 'eventTitle', oldValue: 'Old', newValue: 'New', displayName: 'Event Title' },
        { field: 'attendeeCount', oldValue: 50, newValue: 100, displayName: 'Expected Attendees' }
      ];
      const formatted = formatChangesForEmail(changes);
      expect(formatted).toHaveLength(2);
      expect(formatted[0]).toEqual({
        displayName: 'Event Title',
        oldValue: 'Old',
        newValue: 'New'
      });
      expect(formatted[1]).toEqual({
        displayName: 'Expected Attendees',
        oldValue: '50',
        newValue: '100'
      });
    });

    test('handles null old values', () => {
      const changes = [
        { field: 'setupTime', oldValue: null, newValue: '08:00', displayName: 'Setup Time' }
      ];
      const formatted = formatChangesForEmail(changes);
      expect(formatted[0].oldValue).toBe('(not set)');
      expect(formatted[0].newValue).toBe('08:00');
    });

    test('returns empty array for empty input', () => {
      expect(formatChangesForEmail([])).toEqual([]);
    });
  });

  // =========================================================================
  // NOTIFIABLE_FIELDS coverage
  // =========================================================================
  describe('NOTIFIABLE_FIELDS', () => {
    test('includes key event fields', () => {
      expect(NOTIFIABLE_FIELDS).toContain('eventTitle');
      expect(NOTIFIABLE_FIELDS).toContain('startDateTime');
      expect(NOTIFIABLE_FIELDS).toContain('endDateTime');
      expect(NOTIFIABLE_FIELDS).toContain('locationDisplayNames');
      expect(NOTIFIABLE_FIELDS).toContain('categories');
      expect(NOTIFIABLE_FIELDS).toContain('attendeeCount');
    });

    test('does not include redundant date/time component fields', () => {
      expect(NOTIFIABLE_FIELDS).not.toContain('startDate');
      expect(NOTIFIABLE_FIELDS).not.toContain('startTime');
      expect(NOTIFIABLE_FIELDS).not.toContain('endDate');
      expect(NOTIFIABLE_FIELDS).not.toContain('endTime');
    });

    test('every NOTIFIABLE_FIELD has a display name', () => {
      for (const field of NOTIFIABLE_FIELDS) {
        expect(FIELD_DISPLAY_NAMES[field]).toBeDefined();
      }
    });
  });
});
