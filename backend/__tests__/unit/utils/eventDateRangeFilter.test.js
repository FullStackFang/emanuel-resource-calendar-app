/**
 * Unit tests for buildEventDateRangeOverlapFilter.
 *
 * Bug being fixed (EDR-2): the /api/events/list date filter constrained BOTH
 * bounds on calendarData.startDateTime, so an event that STARTED before the
 * requested window but is still ongoing inside it was silently excluded.
 * Correct calendar/search semantics are an OVERLAP test:
 *   event overlaps [windowStart, windowEnd]  iff
 *     startDateTime <= windowEnd  AND  endDateTime >= windowStart
 *
 * Dates are local-time ISO strings (no Z), compared lexicographically — which
 * is chronological for the fixed 'YYYY-MM-DDTHH:MM:SS' shape used in storage.
 */
const { buildEventDateRangeOverlapFilter } = require('../../../utils/eventDateRangeFilter');

describe('buildEventDateRangeOverlapFilter', () => {
  it('EDR-1: returns overlap predicates on the OPPOSITE fields when both dates given', () => {
    const filter = buildEventDateRangeOverlapFilter('2026-03-01', '2026-03-31');
    expect(filter).toEqual({
      'calendarData.startDateTime': { $lte: '2026-03-31T23:59:59' },
      'calendarData.endDateTime': { $gte: '2026-03-01T00:00:00' },
    });
  });

  it('EDR-2: an event that started before the window but is ongoing satisfies the predicate', () => {
    // window: 2026-03-10 .. 2026-03-12
    const filter = buildEventDateRangeOverlapFilter('2026-03-10', '2026-03-12');
    // spanning event: starts 2 days BEFORE the window, ends inside it
    const eventStart = '2026-03-08T09:00:00';
    const eventEnd = '2026-03-11T17:00:00';

    // start <= windowEnd  (event started on/before the window closes)
    expect(eventStart <= filter['calendarData.startDateTime'].$lte).toBe(true);
    // end >= windowStart  (event still running on/after the window opens) — this is
    // the clause the old start-only filter lacked, which dropped the event.
    expect(eventEnd >= filter['calendarData.endDateTime'].$gte).toBe(true);
  });

  it('EDR-3: only startDate constrains endDateTime (event ends on/after window start)', () => {
    expect(buildEventDateRangeOverlapFilter('2026-03-01', '')).toEqual({
      'calendarData.endDateTime': { $gte: '2026-03-01T00:00:00' },
    });
  });

  it('EDR-4: only endDate constrains startDateTime (event starts on/before window end)', () => {
    expect(buildEventDateRangeOverlapFilter('', '2026-03-31')).toEqual({
      'calendarData.startDateTime': { $lte: '2026-03-31T23:59:59' },
    });
  });

  it('EDR-5: returns an empty filter when neither date is given', () => {
    expect(buildEventDateRangeOverlapFilter('', '')).toEqual({});
    expect(buildEventDateRangeOverlapFilter(undefined, undefined)).toEqual({});
  });
});
