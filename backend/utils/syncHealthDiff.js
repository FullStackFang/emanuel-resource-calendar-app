// backend/utils/syncHealthDiff.js
//
// Pure diff layer for the Sync Health report. NO I/O — no Mongo, no Graph, no
// clock reads beyond what callers pass in. Every matching rule lives here so it
// is unit-testable in isolation (same reasoning as calendarLoadDecision.js on
// the frontend).
//
// Ground truth on the Outlook side is Graph's calendarView, which expands
// recurring series into concrete dated instances server-side. Both sides of the
// diff are therefore flat lists of dated instances, and pattern-level drift
// surfaces as date-level differences.

const CALENDAR_TIMEZONE = 'America/New_York';

// 'en-CA' formats as YYYY-MM-DD, which is exactly the key shape we store
// occurrenceDate in. Constructed once — DateTimeFormat construction is the
// expensive part, formatting is cheap.
const EASTERN_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: CALENDAR_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Normalize a Graph instance start time to its LOCAL date in the calendar's
 * timezone.
 *
 * Graph's calendarView returns `start.dateTime` with NO trailing Z plus a
 * sibling `start.timeZone` of 'UTC' (we deliberately do not send the
 * `Prefer: outlook.timezone` header). Passing that string straight to
 * `new Date()` parses it as HOST-LOCAL time, which shifts the date key by the
 * host's UTC offset and manufactures false discrepancies on any non-UTC box.
 *
 * @param {string|null|undefined} dateTime - e.g. '2026-08-15T02:00:00.0000000'
 * @param {string} [timeZone='UTC'] - the sibling Graph timeZone field
 * @returns {string|null} 'YYYY-MM-DD' local date, or null when input is falsy
 */
function toEasternDateKey(dateTime, timeZone = 'UTC') {
  if (!dateTime) return null;

  // Non-UTC means Graph already rendered wall-clock time in that zone, so the
  // date part is authoritative and must not be shifted a second time.
  if (timeZone && timeZone !== 'UTC') {
    return dateTime.split('T')[0] || null;
  }

  const utcString = /[Zz]$|[+-]\d{2}:\d{2}$/.test(dateTime) ? dateTime : `${dateTime}Z`;
  const parsed = new Date(utcString);
  if (Number.isNaN(parsed.getTime())) return null;

  return EASTERN_DATE_FORMATTER.format(parsed);
}

/**
 * Composite key for matching a series occurrence: the master's Graph ID plus
 * the occurrence's local date.
 */
function seriesDateKey(seriesMasterId, date) {
  return `${seriesMasterId}|${date}`;
}

/**
 * Index one calendar's Outlook instances for O(1) lookup two ways: by event id
 * (standalone events, addition events, exception events) and by
 * (seriesMasterId, local date) (occurrences and exceptions of a series).
 *
 * Cancelled instances are dropped here rather than filtered by callers, so
 * every consumer sees the same "cancelled means absent" semantics.
 *
 * @param {Array<object>} outlookInstances - raw Graph calendarView events
 * @returns {{ byId: Map, bySeriesDate: Map, entries: Array }}
 */
function buildOutlookIndex(outlookInstances) {
  const byId = new Map();
  const bySeriesDate = new Map();
  const entries = [];

  for (const raw of outlookInstances || []) {
    if (!raw || raw.isCancelled === true) continue;

    const entry = {
      graphId: raw.id,
      subject: raw.subject || '(no subject)',
      date: toEasternDateKey(raw.start?.dateTime, raw.start?.timeZone),
      seriesMasterId: raw.seriesMasterId || null,
      consumed: false,
    };

    entries.push(entry);
    if (entry.graphId) byId.set(entry.graphId, entry);
    if (entry.seriesMasterId && entry.date) {
      bySeriesDate.set(seriesDateKey(entry.seriesMasterId, entry.date), entry);
    }
  }

  return { byId, bySeriesDate, entries };
}

module.exports = {
  CALENDAR_TIMEZONE,
  toEasternDateKey,
  seriesDateKey,
  buildOutlookIndex,
};
