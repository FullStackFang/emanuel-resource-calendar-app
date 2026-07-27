'use strict';

/**
 * Locate the Graph occurrence instance of a recurring series for a given date.
 *
 * Extracted so the api-server sync paths and the repair scripts share one
 * implementation. Four call sites previously grew their own version and each
 * got it wrong in a different way:
 *
 *   - `new Date('2026-03-17')` parses as UTC midnight while
 *     `new Date('2026-03-17T14:00:00')` parses as LOCAL time. Comparing them
 *     with `.toDateString()` NEVER matched anywhere west of Greenwich, so the
 *     occurrence-edit path failed to resolve an instance 100% of the time —
 *     which is why no exception document ever recorded a `graphEventId`.
 *   - The same mis-parse built the query window, so Graph was asked about the
 *     wrong day too.
 *   - Graph returns instance times in UTC unless asked otherwise, so an evening
 *     event reads as the NEXT calendar date and a naive date-prefix match
 *     missed it.
 *
 * This asks Graph for times in the event's own timezone, widens the window by a
 * day either side so no boundary case is excluded, and matches on date prefix.
 *
 * The Graph service is injected rather than required, because api-server swaps
 * in a mock via `setGraphApiService()` during tests.
 */

const DEFAULT_TIME_ZONE = 'Eastern Standard Time';

/**
 * Shift a YYYY-MM-DD date string by whole days using UTC arithmetic.
 * UTC math, not local `new Date(y, m, d)`, so a DST transition cannot push the
 * result across the date line.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} delta - days to add (may be negative)
 * @returns {string} YYYY-MM-DD
 */
function shiftIsoDate(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {Object} graphApiService - service exposing getRecurringEventInstances
 * @param {string} calendarOwner
 * @param {string|null} calendarId
 * @param {string} seriesGraphId - Graph ID of the series master
 * @param {string} occurrenceDate - YYYY-MM-DD
 * @param {string} [timeZone] - Windows or IANA name; defaults to Eastern
 * @returns {Promise<Object|null>} The matching instance, or null
 */
async function findGraphOccurrenceForDate(
  graphApiService, calendarOwner, calendarId, seriesGraphId, occurrenceDate, timeZone
) {
  if (!occurrenceDate || !seriesGraphId) return null;
  const dateKey = String(occurrenceDate).split('T')[0];

  const instances = await graphApiService.getRecurringEventInstances(
    calendarOwner, calendarId, seriesGraphId,
    `${shiftIsoDate(dateKey, -1)}T00:00:00`,
    `${shiftIsoDate(dateKey, 1)}T23:59:59`,
    timeZone || DEFAULT_TIME_ZONE
  );

  const list = Array.isArray(instances) ? instances : (instances?.value || []);
  return list.find(inst => inst?.start?.dateTime?.startsWith(dateKey)) || null;
}

module.exports = {
  findGraphOccurrenceForDate,
  shiftIsoDate,
  DEFAULT_TIME_ZONE,
};
