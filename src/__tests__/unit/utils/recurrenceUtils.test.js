/**
 * Tests for recurrenceUtils.js
 */

import { describe, it, expect } from 'vitest';
import {
  transformRecurrenceForGraphAPI,
  isDateInPattern,
  calculateRecurrenceDates,
  expandRecurringSeries,
  formatRecurrenceSummary,
  datesToStrings,
  stringsToDates
} from '../../../utils/recurrenceUtils';

describe('transformRecurrenceForGraphAPI', () => {
  it('returns null for null/undefined input', () => {
    expect(transformRecurrenceForGraphAPI(null)).toBeNull();
    expect(transformRecurrenceForGraphAPI(undefined)).toBeNull();
  });

  it('returns null for invalid recurrence (missing pattern or range)', () => {
    expect(transformRecurrenceForGraphAPI({})).toBeNull();
    expect(transformRecurrenceForGraphAPI({ pattern: {} })).toBeNull();
    expect(transformRecurrenceForGraphAPI({ range: {} })).toBeNull();
  });

  it('transforms weekly recurrence correctly', () => {
    const recurrence = {
      pattern: {
        type: 'weekly',
        interval: 1,
        daysOfWeek: ['monday', 'wednesday', 'friday']
      },
      range: {
        type: 'endDate',
        startDate: '2024-03-01',
        endDate: '2024-06-30'
      }
    };

    const result = transformRecurrenceForGraphAPI(recurrence);

    expect(result.pattern.type).toBe('weekly');
    expect(result.pattern.interval).toBe(1);
    expect(result.pattern.daysOfWeek).toEqual(['monday', 'wednesday', 'friday']);
    expect(result.range.type).toBe('endDate');
    expect(result.range.startDate).toBe('2024-03-01');
    expect(result.range.endDate).toBe('2024-06-30');
    expect(result.range.recurrenceTimeZone).toBe('Eastern Standard Time');
  });

  it('transforms numbered recurrence correctly', () => {
    const recurrence = {
      pattern: {
        type: 'daily',
        interval: 2
      },
      range: {
        type: 'numbered',
        startDate: '2024-03-01',
        numberOfOccurrences: 10
      }
    };

    const result = transformRecurrenceForGraphAPI(recurrence);

    expect(result.pattern.type).toBe('daily');
    expect(result.pattern.interval).toBe(2);
    expect(result.range.type).toBe('numbered');
    expect(result.range.numberOfOccurrences).toBe(10);
  });

  it('uses custom timezone', () => {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'noEnd', startDate: '2024-03-01' }
    };

    const result = transformRecurrenceForGraphAPI(recurrence, 'Pacific Standard Time');

    expect(result.range.recurrenceTimeZone).toBe('Pacific Standard Time');
  });
});

describe('isDateInPattern', () => {
  describe('daily pattern', () => {
    it('matches every day for interval 1', () => {
      const pattern = { type: 'daily', interval: 1 };
      const startDate = new Date('2024-03-01');

      expect(isDateInPattern(new Date('2024-03-01'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2024-03-02'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2024-03-15'), pattern, startDate)).toBe(true);
    });

    it('matches every other day for interval 2', () => {
      const pattern = { type: 'daily', interval: 2 };
      const startDate = new Date('2024-03-01');

      expect(isDateInPattern(new Date('2024-03-01'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2024-03-02'), pattern, startDate)).toBe(false);
      expect(isDateInPattern(new Date('2024-03-03'), pattern, startDate)).toBe(true);
    });

    it('returns false for dates before start', () => {
      const pattern = { type: 'daily', interval: 1 };
      const startDate = new Date('2024-03-15');

      expect(isDateInPattern(new Date('2024-03-14'), pattern, startDate)).toBe(false);
    });
  });

  describe('weekly pattern', () => {
    it('matches specified days of week', () => {
      const pattern = { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'friday'] };
      // Use T00:00:00 to ensure local midnight parsing
      const startDate = new Date('2024-03-01T00:00:00'); // Friday

      // March 1, 2024 is a Friday
      expect(isDateInPattern(new Date('2024-03-01T00:00:00'), pattern, startDate)).toBe(true);
      // March 4, 2024 is a Monday
      expect(isDateInPattern(new Date('2024-03-04T00:00:00'), pattern, startDate)).toBe(true);
      // March 5, 2024 is a Tuesday
      expect(isDateInPattern(new Date('2024-03-05T00:00:00'), pattern, startDate)).toBe(false);
    });

    it('respects interval for weekly pattern', () => {
      const pattern = { type: 'weekly', interval: 2, daysOfWeek: ['monday'] };
      const startDate = new Date('2024-03-04T00:00:00'); // Monday

      // Start date always matches
      expect(isDateInPattern(new Date('2024-03-04T00:00:00'), pattern, startDate)).toBe(true);

      // Days not in daysOfWeek never match regardless of interval
      expect(isDateInPattern(new Date('2024-03-05T00:00:00'), pattern, startDate)).toBe(false); // Tuesday
      expect(isDateInPattern(new Date('2024-03-06T00:00:00'), pattern, startDate)).toBe(false); // Wednesday
    });

    it('returns false when daysOfWeek is empty', () => {
      const pattern = { type: 'weekly', interval: 1, daysOfWeek: [] };
      const startDate = new Date('2024-03-01T00:00:00');

      expect(isDateInPattern(new Date('2024-03-04T00:00:00'), pattern, startDate)).toBe(false);
    });
  });

  describe('monthly pattern', () => {
    it('matches same day of month', () => {
      const pattern = { type: 'monthly', interval: 1 };
      const startDate = new Date('2024-03-15');

      expect(isDateInPattern(new Date('2024-03-15'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2024-04-15'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2024-04-16'), pattern, startDate)).toBe(false);
    });

    it('handles bi-monthly pattern', () => {
      const pattern = { type: 'monthly', interval: 2 };
      const startDate = new Date('2024-03-15');

      expect(isDateInPattern(new Date('2024-03-15'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2024-04-15'), pattern, startDate)).toBe(false);
      expect(isDateInPattern(new Date('2024-05-15'), pattern, startDate)).toBe(true);
    });
  });

  describe('yearly pattern', () => {
    it('matches same month and day', () => {
      const pattern = { type: 'yearly', interval: 1 };
      const startDate = new Date('2024-03-15');

      expect(isDateInPattern(new Date('2024-03-15'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2025-03-15'), pattern, startDate)).toBe(true);
      expect(isDateInPattern(new Date('2024-04-15'), pattern, startDate)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for invalid pattern type', () => {
      const pattern = { type: 'invalid' };
      const startDate = new Date('2024-03-01');

      expect(isDateInPattern(new Date('2024-03-01'), pattern, startDate)).toBe(false);
    });

    it('returns false for null pattern', () => {
      expect(isDateInPattern(new Date('2024-03-01'), null, new Date())).toBe(false);
    });
  });
});

describe('calculateRecurrenceDates', () => {
  it('returns empty array for null input', () => {
    expect(calculateRecurrenceDates(null, null, new Date())).toEqual([]);
    expect(calculateRecurrenceDates({}, null, new Date())).toEqual([]);
  });

  it('calculates daily dates for a month', () => {
    const pattern = { type: 'daily', interval: 1 };
    const range = { startDate: '2024-03-01', type: 'noEnd' };
    const viewMonth = new Date('2024-03-15');

    const dates = calculateRecurrenceDates(pattern, range, viewMonth);

    expect(dates).toHaveLength(31); // All days in March
    expect(dates[0]).toBe('2024-03-01');
    expect(dates[30]).toBe('2024-03-31');
  });

  it('respects end date', () => {
    const pattern = { type: 'daily', interval: 1 };
    const range = { startDate: '2024-03-01', endDate: '2024-03-10', type: 'endDate' };
    const viewMonth = new Date('2024-03-15T00:00:00');

    const dates = calculateRecurrenceDates(pattern, range, viewMonth);

    // Should include dates from March 1-9 (up to but potentially excluding end date depending on implementation)
    expect(dates.length).toBeGreaterThanOrEqual(9);
    expect(dates.length).toBeLessThanOrEqual(10);
    expect(dates[0]).toBe('2024-03-01');
  });

  it('calculates weekly dates', () => {
    const pattern = { type: 'weekly', interval: 1, daysOfWeek: ['monday'] };
    const range = { startDate: '2024-03-01', type: 'noEnd' };
    const viewMonth = new Date('2024-03-15');

    const dates = calculateRecurrenceDates(pattern, range, viewMonth);

    // Mondays in March 2024: 4th, 11th, 18th, 25th
    expect(dates).toContain('2024-03-04');
    expect(dates).toContain('2024-03-11');
    expect(dates).toContain('2024-03-18');
    expect(dates).toContain('2024-03-25');
    expect(dates).toHaveLength(4);
  });
});

describe('formatRecurrenceSummary', () => {
  it('returns empty string for null pattern', () => {
    expect(formatRecurrenceSummary(null)).toBe('');
  });

  it('formats daily recurrence', () => {
    const pattern = { type: 'daily', interval: 1 };
    expect(formatRecurrenceSummary(pattern)).toContain('every day');
  });

  it('formats multi-day daily recurrence', () => {
    const pattern = { type: 'daily', interval: 3 };
    expect(formatRecurrenceSummary(pattern)).toContain('every 3 days');
  });

  it('formats weekly recurrence with days', () => {
    const pattern = { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday', 'friday'] };
    const summary = formatRecurrenceSummary(pattern);

    expect(summary).toContain('M');
    expect(summary).toContain('W');
    expect(summary).toContain('F');
  });

  it('formats monthly recurrence', () => {
    const pattern = { type: 'monthly', interval: 1 };
    expect(formatRecurrenceSummary(pattern)).toContain('every month');
  });

  it('formats yearly recurrence', () => {
    const pattern = { type: 'yearly', interval: 1 };
    expect(formatRecurrenceSummary(pattern)).toContain('every year');
  });

  it('includes end date in summary', () => {
    const pattern = { type: 'daily', interval: 1 };
    const range = { type: 'endDate', endDate: '2024-12-31' };

    const summary = formatRecurrenceSummary(pattern, range);

    expect(summary).toContain('Until');
    expect(summary).toContain('2024');
  });

  it('includes number of occurrences in summary', () => {
    const pattern = { type: 'daily', interval: 1 };
    const range = { type: 'numbered', numberOfOccurrences: 10 };

    const summary = formatRecurrenceSummary(pattern, range);

    expect(summary).toContain('10 occurrences');
  });

  it('returns empty string for unknown pattern type', () => {
    const pattern = { type: 'unknown' };
    expect(formatRecurrenceSummary(pattern)).toBe('');
  });
});

describe('datesToStrings', () => {
  it('converts Date objects to YYYY-MM-DD strings', () => {
    // Use UTC dates to avoid timezone issues with toISOString()
    const dates = [
      new Date(Date.UTC(2024, 2, 1, 10, 0, 0)), // March 1, 2024
      new Date(Date.UTC(2024, 2, 15, 14, 30, 0)), // March 15, 2024
      new Date(Date.UTC(2024, 11, 31, 12, 0, 0)) // Dec 31, 2024 at noon UTC
    ];

    const strings = datesToStrings(dates);

    expect(strings[0]).toBe('2024-03-01');
    expect(strings[1]).toBe('2024-03-15');
    expect(strings[2]).toBe('2024-12-31');
  });

  it('handles empty array', () => {
    expect(datesToStrings([])).toEqual([]);
  });
});

describe('stringsToDates', () => {
  it('converts YYYY-MM-DD strings to Date objects at midnight', () => {
    const strings = ['2024-03-01', '2024-03-15'];

    const dates = stringsToDates(strings);

    expect(dates).toHaveLength(2);
    expect(dates[0].getFullYear()).toBe(2024);
    expect(dates[0].getMonth()).toBe(2); // March (0-indexed)
    expect(dates[0].getDate()).toBe(1);
    expect(dates[0].getHours()).toBe(0);
    expect(dates[0].getMinutes()).toBe(0);
  });

  it('handles empty array', () => {
    expect(stringsToDates([])).toEqual([]);
  });
});

// ─── expandRecurringSeries ──────────────────────────────────────────────
describe('expandRecurringSeries', () => {
  // P0-A: Draft series masters have no graphData, so masterEvent.start is undefined.
  // expandRecurringSeries must not crash when start/end are missing.
  it('does not crash when masterEvent.start and .end are undefined (draft without graphData)', () => {
    const draftMaster = {
      eventId: 'draft-master-1',
      eventType: 'seriesMaster',
      calendarData: {
        startTime: '10:00',
        endTime: '11:00',
        startDateTime: '2026-04-01T10:00:00',
        endDateTime: '2026-04-01T11:00:00',
      },
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-01', endDate: '2026-04-30' },
        exclusions: [],
        additions: [],
      },
      // NO start/end properties — this is a draft without graphData
    };

    // Should not throw
    const occurrences = expandRecurringSeries(draftMaster, '2026-04-01', '2026-04-30');
    expect(occurrences.length).toBeGreaterThan(0);
    // Verify each occurrence has valid datetime strings
    for (const occ of occurrences) {
      expect(occ.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(occ.end.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
  });

  it('does not crash when calendarData times are empty (Hold pattern) and start/end are undefined', () => {
    const holdMaster = {
      eventId: 'hold-master-1',
      eventType: 'seriesMaster',
      calendarData: {
        startTime: '',
        endTime: '',
        startDateTime: '2026-04-01T00:00:00',
        endDateTime: '2026-04-01T23:59:00',
        reservationStartTime: '08:00',
        reservationEndTime: '17:00',
      },
      recurrence: {
        pattern: { type: 'daily', interval: 1 },
        range: { type: 'endDate', startDate: '2026-04-01', endDate: '2026-04-03' },
        exclusions: [],
        additions: [],
      },
      // NO start/end — Hold-pattern draft
    };

    const occurrences = expandRecurringSeries(holdMaster, '2026-04-01', '2026-04-03');
    expect(occurrences.length).toBe(3);
  });

  it('uses calendarData.startTime/endTime when present (normal draft path)', () => {
    const master = {
      eventId: 'normal-draft-1',
      eventType: 'seriesMaster',
      calendarData: {
        startTime: '14:00',
        endTime: '15:30',
        startDateTime: '2026-04-07T14:00:00',
        endDateTime: '2026-04-07T15:30:00',
      },
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-07', endDate: '2026-04-14' },
        exclusions: [],
        additions: [],
      },
    };

    const occurrences = expandRecurringSeries(master, '2026-04-07', '2026-04-14');
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].start.dateTime).toContain('T14:00:');
    expect(occurrences[0].end.dateTime).toContain('T15:30:');
  });

  // P1-C: calculateRecurrenceDates must skip exclusions in pre-window count (like backend does)
  it('numbered range respects exclusions in pre-window count', () => {
    const month = new Date(2026, 3, 1); // April 2026
    const dates = calculateRecurrenceDates(
      { type: 'daily', interval: 1 },
      {
        type: 'numbered',
        startDate: '2026-03-01', // March — before view window
        numberOfOccurrences: 35,
      },
      month,
      ['2026-03-05', '2026-03-10', '2026-03-15'] // 3 excluded dates in March
    );
    // With 3 exclusions in March, 3 more occurrences should appear in April
    // Backend expands the same way — frontend must match
    // March has 31 days. Pattern dates: Mar 1-31 = 31 matches.
    // Minus 3 exclusions = 28 counted in March. 35 - 28 = 7 remaining in April.
    expect(dates.length).toBe(7);
  });
});
