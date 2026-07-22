// backend/utils/searchOccurrenceExpansion.js
//
// Server-side recurrence expansion for the SEARCH view of /api/events/list.
//
// A seriesMaster doc stores only its FIRST occurrence's datetimes; the search
// view returns a flat, paginated list, so masters must be replaced with
// per-occurrence rows for the requested window. Dates that have a
// materialized exception/addition child (listed in the master's enriched
// occurrenceOverrides — every entry carries occurrenceDate, and occurrence
// dates are immutable) are skipped: the child document, matched by its own
// calendarData dates, IS the row for that date.
//
// Callers MUST run enrichSeriesMastersWithOverrides on the raw docs first,
// otherwise customized dates double-render (synthetic occurrence + child).

const { expandRecurringOccurrencesInWindow } = require('./recurrenceExpansion');

function buildOccurrenceRow(master, occ) {
  const row = {
    ...master,
    _id: `${String(master._id)}-occ-${occ.occurrenceDate}`,
    eventId: `${master.eventId}-occurrence-${occ.occurrenceDate}`,
    eventType: 'occurrence',
    seriesMasterId: master.eventId,
    masterEventId: master.eventId,
    isRecurringOccurrence: true,
    recurrence: null,
    startDateTime: occ.startDateTime,
    endDateTime: occ.endDateTime,
    startDate: occ.occurrenceDate,
    endDate: occ.occurrenceDate,
    calendarData: {
      ...(master.calendarData || {}),
      startDateTime: occ.startDateTime,
      endDateTime: occ.endDateTime,
      startDate: occ.occurrenceDate,
      endDate: occ.occurrenceDate,
    },
  };
  delete row.occurrenceOverrides;
  return row;
}

/**
 * @param {Array<object>} rawDocs - enriched raw documents from the search find
 * @param {string} startDate - 'YYYY-MM-DD' window start (inclusive)
 * @param {string} endDate - 'YYYY-MM-DD' window end (inclusive)
 * @returns {Array<object>} non-master docs + synthetic occurrence rows
 */
function expandSearchResults(rawDocs, startDate, endDate) {
  const masters = [];
  const rest = [];
  for (const doc of rawDocs) {
    if (doc.eventType === 'seriesMaster') masters.push(doc);
    else rest.push(doc);
  }
  if (masters.length === 0) return rest;

  const windowStart = new Date(`${startDate}T00:00:00`);
  const windowEnd = new Date(`${endDate}T23:59:59`);

  const occurrenceRows = [];
  for (const master of masters) {
    if (!master.recurrence?.pattern || !master.recurrence?.range) continue;
    const materialized = new Set(
      (master.occurrenceOverrides || []).map(o => o && o.occurrenceDate).filter(Boolean)
    );
    const occurrences = expandRecurringOccurrencesInWindow(master, windowStart, windowEnd);
    for (const occ of occurrences) {
      if (materialized.has(occ.occurrenceDate)) continue;
      occurrenceRows.push(buildOccurrenceRow(master, occ));
    }
  }
  return rest.concat(occurrenceRows);
}

module.exports = { expandSearchResults };
