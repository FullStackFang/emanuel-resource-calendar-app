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

module.exports = { buildEventDateRangeOverlapFilter };
