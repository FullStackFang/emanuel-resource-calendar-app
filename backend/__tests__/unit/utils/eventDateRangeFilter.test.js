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
const { buildEventDateRangeOverlapFilter, buildSeriesAwareDateRangeClause } = require('../../../utils/eventDateRangeFilter');

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

describe('buildSeriesAwareDateRangeClause (EDR-10+)', () => {
  it('EDR-10: returns a $or with four branches', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-22');
    expect(Array.isArray(clause.$or)).toBe(true);
    expect(clause.$or).toHaveLength(4);
  });

  it('EDR-11: concrete-event branch excludes seriesMaster and stored occurrence docs and uses overlap bounds', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-21');
    const concrete = clause.$or[0];
    expect(concrete.eventType).toEqual({ $nin: ['seriesMaster', 'occurrence'] });
    expect(concrete['calendarData.startDateTime']).toEqual({ $lte: '2026-07-21T23:59:59' });
    expect(concrete['calendarData.endDateTime']).toEqual({ $gte: '2026-07-21T00:00:00' });
  });

  it('EDR-12: legacy branch matches docs with no eventType via overlap bounds', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-21');
    const legacy = clause.$or[1];
    expect(legacy.eventType).toEqual({ $exists: false });
    expect(legacy['calendarData.startDateTime']).toEqual({ $lte: '2026-07-21T23:59:59' });
    expect(legacy['calendarData.endDateTime']).toEqual({ $gte: '2026-07-21T00:00:00' });
  });

  it('EDR-13: seriesMaster branch matches on recurrence range, not first-occurrence end', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-21');
    const master = clause.$or[2];
    expect(master.eventType).toBe('seriesMaster');
    expect(master['calendarData.startDateTime']).toEqual({ $lte: '2026-07-21T23:59:59' });
    expect(master.$or).toEqual([
      { 'recurrence.range.endDate': { $gte: '2026-07-21' } },
      { 'recurrence.range.type': 'noEnd' },
      { 'recurrence.range.type': 'numbered' },
    ]);
    // The clause must NOT constrain calendarData.endDateTime for masters —
    // that field holds only the FIRST occurrence's end and is what excluded
    // every series from search until now.
    expect(master['calendarData.endDateTime']).toBeUndefined();
  });

  it('EDR-14: additions branch matches masters with an ad-hoc date inside the window via $elemMatch', () => {
    const clause = buildSeriesAwareDateRangeClause('2026-07-21', '2026-07-22');
    const additions = clause.$or[3];
    expect(additions.eventType).toBe('seriesMaster');
    expect(additions['recurrence.additions']).toEqual({
      $elemMatch: { $gte: '2026-07-21', $lte: '2026-07-22' },
    });
  });
});
