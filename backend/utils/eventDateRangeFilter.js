/**
 * Shared date-range filter builder for event list/search queries.
 *
 * Produces a MongoDB filter fragment that selects every event OVERLAPPING the
 * requested window, not just events that START inside it. An event overlaps
 * [windowStart, windowEnd] iff:
 *
 *     startDateTime <= windowEnd   AND   endDateTime >= windowStart
 *
 * The previous inline filter constrained BOTH bounds on calendarData.startDateTime,
 * which silently dropped multi-day / ongoing events that began before the window
 * (see eventDateRangeFilter.test.js, EDR-2).
 *
 * Field/format notes:
 * - calendarData.startDateTime / endDateTime are stored as LOCAL-time ISO strings
 *   ('YYYY-MM-DDTHH:MM:SS', no Z). Lexicographic comparison on this fixed shape is
 *   chronological, so we build local-time string boundaries rather than Date
 *   objects (which would shift on non-UTC hosts).
 * - Each bound is optional. A single bound still narrows correctly; both bounds
 *   together give a full overlap test.
 *
 * Index note: the single-field index on calendarData.startDateTime serves the
 * `startDateTime <= windowEnd` range; a companion single-field index on
 * calendarData.endDateTime is recommended so the planner can seek either bound.
 * (Cosmos rejects COMPOUND indexes on nested calendarData.* paths, so the durable
 * fix is a top-level compound index after the calendarData->top-level migration.)
 *
 * @param {string} startDate - 'YYYY-MM-DD' window start (inclusive), or falsy to omit.
 * @param {string} endDate   - 'YYYY-MM-DD' window end (inclusive), or falsy to omit.
 * @returns {object} a MongoDB filter fragment (possibly empty) to merge into a query.
 */
function buildEventDateRangeOverlapFilter(startDate, endDate) {
  const filter = {};

  if (endDate) {
    // Event must START on/before the window closes.
    filter['calendarData.startDateTime'] = { $lte: `${endDate}T23:59:59` };
  }

  if (startDate) {
    // Event must END on/after the window opens — the clause the old filter lacked.
    filter['calendarData.endDateTime'] = { $gte: `${startDate}T00:00:00` };
  }

  return filter;
}

/**
 * Recurrence-aware date clause for the SEARCH view.
 *
 * A seriesMaster's calendarData.startDateTime/endDateTime hold only its FIRST
 * occurrence (see the explicit note at api-server.js getUnifiedEvents), so the
 * flat overlap filter above can never match a series for any window after its
 * first-occurrence day — the root cause of recurring events missing from
 * Search & Export. Masters must instead match on their recurrence RANGE.
 *
 * Branches (OR-ed):
 *  1. Concrete events (singleInstance, exception, addition): standard overlap.
 *     Stored eventType 'occurrence' docs are excluded — occurrences are
 *     regenerated from their master during expansion, so returning stored
 *     occurrence rows would double-count.
 *  2. Legacy docs with no eventType: standard overlap.
 *  3. seriesMaster: series started on/before the window end AND the recurrence
 *     range reaches the window (endDate >= windowStart, or noEnd/numbered).
 *  4. seriesMaster with an ad-hoc additions date inside the window ($elemMatch
 *     so both bounds apply to a single element).
 *
 * Mirrors the seriesMaster OR clause in POST /api/events/load. Both bounds are
 * required (the search view 400s without them).
 *
 * @param {string} startDate - 'YYYY-MM-DD' window start (inclusive).
 * @param {string} endDate   - 'YYYY-MM-DD' window end (inclusive).
 * @returns {{ $or: Array<object> }} fragment to push into query.$and.
 */
function buildSeriesAwareDateRangeClause(startDate, endDate) {
  const windowEndBound = `${endDate}T23:59:59`;
  const windowStartBound = `${startDate}T00:00:00`;
  return {
    $or: [
      {
        eventType: { $nin: ['seriesMaster', 'occurrence'] },
        'calendarData.startDateTime': { $lte: windowEndBound },
        'calendarData.endDateTime': { $gte: windowStartBound },
      },
      {
        eventType: { $exists: false },
        'calendarData.startDateTime': { $lte: windowEndBound },
        'calendarData.endDateTime': { $gte: windowStartBound },
      },
      {
        eventType: 'seriesMaster',
        'calendarData.startDateTime': { $lte: windowEndBound },
        $or: [
          { 'recurrence.range.endDate': { $gte: startDate } },
          { 'recurrence.range.type': 'noEnd' },
          { 'recurrence.range.type': 'numbered' },
        ],
      },
      {
        eventType: 'seriesMaster',
        'recurrence.additions': { $elemMatch: { $gte: startDate, $lte: endDate } },
      },
    ],
  };
}

module.exports = { buildEventDateRangeOverlapFilter, buildSeriesAwareDateRangeClause };
