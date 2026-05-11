/**
 * Tests for calendarEventUtils.js — focus on all-day event date math.
 *
 * Microsoft Graph / RFC 5545 all-day events store end as midnight of the day
 * AFTER the last day (exclusive end). These tests pin down the helper that
 * normalizes this for display, plus the rendering primitives that consume it.
 */

import { describe, it, expect } from 'vitest';
import { getEventEndDateExclusive, getEventPosition } from '../../../utils/calendarEventUtils';

describe('getEventEndDateExclusive', () => {
  it('subtracts one day for single-day all-day with exclusive-end midnight', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-09T00:00:00' },
      calendarData: { isAllDayEvent: true }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('subtracts one day for multi-day all-day with exclusive-end midnight', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-11T00:00:00' },
      calendarData: { isAllDayEvent: true }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-10');
  });

  it('leaves legacy 23:59:59 all-day events unchanged', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-08T23:59:59' },
      calendarData: { isAllDayEvent: true }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('leaves timed single-day events unchanged', () => {
    const event = {
      start: { dateTime: '2026-05-08T09:00:00' },
      end: { dateTime: '2026-05-08T17:00:00' },
      calendarData: { isAllDayEvent: false }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('leaves overnight timed events unchanged (no isAllDayEvent flag)', () => {
    const event = {
      start: { dateTime: '2026-05-08T22:00:00' },
      end: { dateTime: '2026-05-09T02:00:00' }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-09');
  });

  it('leaves Hold-style events with non-midnight reservation end unchanged', () => {
    const event = {
      start: { dateTime: '2026-05-08T09:00:00' },
      end: { dateTime: '2026-05-08T18:00:00' },
      calendarData: { isAllDayEvent: false }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('falls back to start date when end.dateTime is missing', () => {
    const event = {
      start: { dateTime: '2026-05-08T09:00:00' },
      calendarData: { isAllDayEvent: false }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('recognizes isAllDayEvent on calendarData (canonical storage shape)', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-09T00:00:00' },
      calendarData: { isAllDayEvent: true }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('recognizes isAllDayEvent at top level (post-transform shape)', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-09T00:00:00' },
      isAllDayEvent: true
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('does not decrement when isAllDayEvent is true but end is not midnight', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-08T18:00:00' },
      calendarData: { isAllDayEvent: true }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('recognizes calendarData.isAllDay (rSched import schema variant, wrong key)', () => {
    // rSched import at rschedImportService.js:440 writes the all-day flag under
    // the wrong key "isAllDay" instead of canonical "isAllDayEvent" inside calendarData.
    // Some rSched-imported events also lack the top-level isAllDayEvent fallback.
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-09T00:00:00' },
      calendarData: { isAllDay: true /* note: isAllDayEvent absent */ }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('does NOT decrement when calendarData.isAllDay is true but end is 23:59:59 (mixed convention)', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-08T23:59:59' },
      calendarData: { isAllDay: true }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });

  it('does not decrement when isAllDayEvent is false even with midnight end', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-09T00:00:00' }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-09');
  });

  it('does not underflow when start === end (defensive guard)', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-08T00:00:00' },
      calendarData: { isAllDayEvent: true }
    };
    expect(getEventEndDateExclusive(event)).toBe('2026-05-08');
  });
});

describe('getEventPosition', () => {
  describe('single-day all-day with exclusive-end (regression for two-days-on-calendar bug)', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-09T00:00:00' },
      calendarData: { isAllDayEvent: true }
    };

    it('renders on May 8 (the actual day)', () => {
      const pos = getEventPosition(event, new Date('2026-05-08T12:00:00Z'));
      expect(pos).toMatchObject({ position: 'only', isMultiDay: false, totalDays: 1 });
    });

    it('does NOT render on May 9 (the day-after-last)', () => {
      const pos = getEventPosition(event, new Date('2026-05-09T12:00:00Z'));
      expect(pos).toBeNull();
    });

    it('does NOT render on May 7 (the day-before-first)', () => {
      const pos = getEventPosition(event, new Date('2026-05-07T12:00:00Z'));
      expect(pos).toBeNull();
    });
  });

  describe('multi-day all-day with exclusive-end', () => {
    const event = {
      start: { dateTime: '2026-05-08T00:00:00' },
      end: { dateTime: '2026-05-11T00:00:00' },
      calendarData: { isAllDayEvent: true }
    };

    it('renders as start on May 8', () => {
      const pos = getEventPosition(event, new Date('2026-05-08T12:00:00Z'));
      expect(pos).toMatchObject({ position: 'start', isMultiDay: true, totalDays: 3, dayNumber: 1 });
    });

    it('renders as middle on May 9', () => {
      const pos = getEventPosition(event, new Date('2026-05-09T12:00:00Z'));
      expect(pos).toMatchObject({ position: 'middle', totalDays: 3, dayNumber: 2 });
    });

    it('renders as end on May 10 (the actual last day)', () => {
      const pos = getEventPosition(event, new Date('2026-05-10T12:00:00Z'));
      expect(pos).toMatchObject({ position: 'end', totalDays: 3, dayNumber: 3 });
    });

    it('does NOT render on May 11 (the day-after-last)', () => {
      const pos = getEventPosition(event, new Date('2026-05-11T12:00:00Z'));
      expect(pos).toBeNull();
    });
  });

  describe('timed events are unaffected by the all-day correction', () => {
    it('overnight timed event (no isAllDayEvent) renders on both days', () => {
      const event = {
        start: { dateTime: '2026-05-08T22:00:00' },
        end: { dateTime: '2026-05-09T02:00:00' }
      };
      expect(getEventPosition(event, new Date('2026-05-08T12:00:00Z'))).toMatchObject({ position: 'start' });
      expect(getEventPosition(event, new Date('2026-05-09T12:00:00Z'))).toMatchObject({ position: 'end' });
    });

    it('legacy 23:59:59 all-day event still renders on its single day only', () => {
      const event = {
        start: { dateTime: '2026-05-08T00:00:00' },
        end: { dateTime: '2026-05-08T23:59:59' },
        calendarData: { isAllDayEvent: true }
      };
      expect(getEventPosition(event, new Date('2026-05-08T12:00:00Z'))).toMatchObject({ position: 'only' });
      expect(getEventPosition(event, new Date('2026-05-09T12:00:00Z'))).toBeNull();
    });
  });
});

/**
 * getMonthDayEventPosition lives as a useCallback inside Calendar.jsx, so it is
 * not directly importable. The implementation under test is the pure
 * string-comparison body of that callback. Tests below exercise the exact same
 * algorithm so they catch regressions in either direction (over-shift forward
 * or backward) without rendering the Calendar component.
 *
 * Keep this in sync with Calendar.jsx getMonthDayEventPosition.
 */
const monthDayPositionLogic = (event, day) => {
  if (!event.start?.dateTime) return false;
  const startDateStr = event.start.dateTime.split('T')[0];
  const endDateStr = getEventEndDateExclusive(event);
  const year = day.getFullYear();
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const dayNum = String(day.getDate()).padStart(2, '0');
  const compareDateStr = `${year}-${month}-${dayNum}`;
  return compareDateStr >= startDateStr && compareDateStr <= endDateStr;
};

describe('getMonthDayEventPosition logic (Calendar.jsx month-filter highlight)', () => {
  const allDayBugEvent = {
    start: { dateTime: '2026-05-08T00:00:00' },
    end: { dateTime: '2026-05-09T00:00:00' },
    calendarData: { isAllDayEvent: true }
  };

  it('highlights May 8 for the bug-case event', () => {
    expect(monthDayPositionLogic(allDayBugEvent, new Date(2026, 4, 8))).toBe(true);
  });

  it('does NOT highlight May 9 (catches single-shift regression)', () => {
    expect(monthDayPositionLogic(allDayBugEvent, new Date(2026, 4, 9))).toBe(false);
  });

  it('does NOT highlight May 7 (catches the prior toUserTZDay backward-shift bug + any double-shift regression)', () => {
    expect(monthDayPositionLogic(allDayBugEvent, new Date(2026, 4, 7))).toBe(false);
  });

  it('highlights both May 8 and May 9 for an overnight timed event', () => {
    const event = {
      start: { dateTime: '2026-05-08T22:00:00' },
      end: { dateTime: '2026-05-09T02:00:00' }
    };
    expect(monthDayPositionLogic(event, new Date(2026, 4, 8))).toBe(true);
    expect(monthDayPositionLogic(event, new Date(2026, 4, 9))).toBe(true);
  });

  it('does not crash and returns false when event has no start.dateTime', () => {
    expect(monthDayPositionLogic({}, new Date(2026, 4, 8))).toBe(false);
  });
});
