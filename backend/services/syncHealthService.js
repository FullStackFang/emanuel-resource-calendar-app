// backend/services/syncHealthService.js
//
// Gathering + orchestration layer for the Sync Health report.
//
// Every dependency is INJECTED (eventsCollection, graphApi) rather than
// imported. api-server.js swaps its Graph client at runtime via
// setGraphApiService() — which tests use to install graphApiMock — so a
// module-level `require` captured here would pin the real client and bypass
// the mock. The route passes the live binding at request time instead.
//
// All matching rules live in utils/syncHealthDiff.js — this file only decides
// WHAT to compare, never HOW to compare it.

const { diffCalendar } = require('../utils/syncHealthDiff');
const { expandAllOccurrences } = require('../utils/recurrenceExpansion');
const { buildSeriesAwareDateRangeClause } = require('../utils/eventDateRangeFilter');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const logger = require('../utils/logger');

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_LOOKAHEAD_DAYS = 180;
const MAX_WINDOW_DAYS = 400;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Only these fields are needed; calendarView pages are large and the report is
// interactive, so we keep the payload tight.
const GRAPH_SELECT = 'id,subject,start,end,type,seriesMasterId,isCancelled';

// Same retryable-error policy as backfill-addition-graph-events.js.
const withGraphRetry = (op) => retryWithBackoff(op, {
  maxAttempts: 3,
  retryableError: (err) =>
    err?.statusCode === 429 || err?.statusCode === 503 ||
    err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET',
});

const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Apply the default window when either bound is omitted.
 * @param {{startDate?: string, endDate?: string}} params
 * @param {Date} [now] - injectable clock for tests
 * @returns {{startDate: string, endDate: string}}
 */
function resolveWindow({ startDate, endDate } = {}, now = new Date()) {
  const back = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * MS_PER_DAY);
  const ahead = new Date(now.getTime() + DEFAULT_LOOKAHEAD_DAYS * MS_PER_DAY);
  return {
    startDate: startDate || toDateStr(back),
    endDate: endDate || toDateStr(ahead),
  };
}

/**
 * Validate a resolved window.
 * @param {{startDate: string, endDate: string}} window
 * @returns {string|null} a 400-worthy error message, or null when valid
 */
function validateWindow({ startDate, endDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return 'startDate and endDate must be YYYY-MM-DD';
  }
  if (endDate < startDate) return 'endDate must be on or after startDate';

  const spanDays = Math.round(
    (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / MS_PER_DAY
  );
  if (spanDays > MAX_WINDOW_DAYS) {
    return `Window must not exceed ${MAX_WINDOW_DAYS} days (requested ${spanDays})`;
  }
  return null;
}

const titleOf = (doc) => doc.eventTitle || doc.calendarData?.eventTitle || '(no title)';

/**
 * Group key for a document's calendar.
 *
 * Deliberately keyed on calendarOwner ALONE, never on calendarId. Graph's
 * `calendarId` is a PER-MAILBOX opaque handle, and this database stores several
 * different values for the same owner — some captured from a different
 * mailbox's view of the shared calendar (the calendar-config.json value, which
 * maps every owner to an id scoped to one admin's mailbox). Including
 * calendarId in the key split a single real mailbox into multiple phantom
 * calendars, each diffed against a partial Outlook view, which manufactured
 * bogus missingFromOutlook and untracked findings.
 *
 * Owner is lower-cased because the same mailbox appears in both cases across
 * documents and config.
 */
const calendarKeyOf = (doc) => String(doc.calendarOwner || '').toLowerCase();

/**
 * The LOCAL date of an app-side document.
 *
 * Deliberately does NOT use toEasternDateKey — that function exists to convert
 * Graph's UTC instants. App-side values are already local: calendarData.
 * startDateTime is a local-time ISO string with no Z, and top-level
 * startDateTime may be a Date. Running the UTC normalizer over either would
 * shift the date. Keeping the two conversions separate is the whole point.
 *
 * @param {object} doc - an event document
 * @returns {string|null} 'YYYY-MM-DD'
 */
function localDateOf(doc) {
  const raw = doc.calendarData?.startDateTime || doc.startDateTime;
  if (raw instanceof Date) return toDateStr(raw);
  if (typeof raw === 'string' && raw.includes('T')) return raw.split('T')[0];
  return doc.startDate || null;
}

/**
 * Build the flat list of dated instances the app expects to exist in Outlook,
 * for ONE calendar.
 *
 * Series masters are expanded with expandAllOccurrences (which honors additions
 * and exclusions), then any date that has its own exception/addition child
 * document is REMOVED from the master's list and re-added from the child. That
 * overlay is what stops a date being counted twice — the child carries the
 * authoritative graphEventId, the master's pattern date does not.
 *
 * @param {Array<object>} docs - event documents for one calendar
 * @param {string} startDate - 'YYYY-MM-DD' window start
 * @param {string} endDate - 'YYYY-MM-DD' window end
 * @returns {{appInstances: Array<object>, trackedSeries: Array<object>}}
 */
function buildAppSide(docs, startDate, endDate) {
  const appInstances = [];
  const trackedSeries = [];

  const masters = docs.filter(d => d.eventType === 'seriesMaster');
  const children = docs.filter(d => d.eventType === 'exception' || d.eventType === 'addition');
  const singles = docs.filter(
    d => !['seriesMaster', 'exception', 'addition', 'occurrence'].includes(d.eventType)
  );

  // Child docs, keyed by their master's eventId so masters can skip those dates.
  const childDatesByMaster = new Map();
  for (const child of children) {
    const key = child.seriesMasterEventId;
    if (!childDatesByMaster.has(key)) childDatesByMaster.set(key, new Set());
    childDatesByMaster.get(key).add(child.occurrenceDate);
  }

  const masterGraphIdByEventId = new Map();
  for (const master of masters) {
    if (master.eventId) masterGraphIdByEventId.set(master.eventId, master.graphData?.id || null);
  }

  for (const doc of singles) {
    appInstances.push({
      mongoId: String(doc._id),
      eventTitle: titleOf(doc),
      date: localDateOf(doc),
      eventType: 'singleInstance',
      graphId: doc.graphData?.id || null,
      seriesGraphId: null,
      isDeleted: doc.isDeleted === true || doc.status === 'deleted',
    });
  }

  for (const master of masters) {
    const seriesGraphId = master.graphData?.id || null;
    trackedSeries.push({
      mongoId: String(master._id),
      eventTitle: titleOf(master),
      seriesGraphId,
      exclusions: (master.recurrence?.exclusions || []).filter(d => d >= startDate && d <= endDate),
    });

    const overlaid = childDatesByMaster.get(master.eventId) || new Set();
    // calendarData first: it holds local-time STRINGS, which is what
    // expandAllOccurrences parses for time-of-day. A top-level Date would
    // silently fall back to midnight (harmless here since we only read
    // occurrenceDate, but the string path is the intended one).
    const occurrences = expandAllOccurrences(
      master.recurrence,
      master.calendarData?.startDateTime || master.startDateTime,
      master.calendarData?.endDateTime || master.endDateTime,
    );

    for (const occ of occurrences) {
      if (occ.occurrenceDate < startDate || occ.occurrenceDate > endDate) continue;
      if (overlaid.has(occ.occurrenceDate)) continue; // the child doc speaks for this date
      appInstances.push({
        mongoId: String(master._id),
        eventTitle: titleOf(master),
        date: occ.occurrenceDate,
        eventType: 'seriesMaster',
        graphId: null,
        seriesGraphId,
        isDeleted: master.isDeleted === true || master.status === 'deleted',
      });
    }
  }

  for (const child of children) {
    if (child.occurrenceDate < startDate || child.occurrenceDate > endDate) continue;
    appInstances.push({
      mongoId: String(child._id),
      eventTitle: titleOf(child),
      date: child.occurrenceDate,
      eventType: child.eventType,
      graphId: child.graphEventId || child.graphData?.id || null,
      seriesGraphId: masterGraphIdByEventId.get(child.seriesMasterEventId) || null,
      isDeleted: child.isDeleted === true || child.status === 'deleted',
    });
  }

  return { appInstances, trackedSeries };
}

/**
 * Run the full sync-health check across every calendar the app manages.
 *
 * @param {object} params
 * @param {import('mongodb').Collection} params.eventsCollection
 * @param {object} params.graphApi - needs getCalendarEvents(owner, calId, startIso, endIso, opts)
 * @param {string} params.startDate - 'YYYY-MM-DD'
 * @param {string} params.endDate - 'YYYY-MM-DD'
 * @returns {Promise<{window: object, calendars: Array<object>}>}
 */
async function runSyncHealthCheck({ eventsCollection, graphApi, startDate, endDate }) {
  // Published events overlapping the window. buildSeriesAwareDateRangeClause is
  // reused verbatim from the search view so masters match on their recurrence
  // RANGE (a master's own startDateTime holds only its first occurrence).
  const publishedDocs = await eventsCollection.find({
    status: 'published',
    isDeleted: { $ne: true },
    $and: [buildSeriesAwareDateRangeClause(startDate, endDate)],
  }).toArray();

  // Deleted-but-tracked events feed ONLY the failed-deletion check. A deleted
  // doc keeps its graphData.id, which is exactly the handle we need to ask
  // "is it still in Outlook?".
  const deletedDocs = await eventsCollection.find({
    isDeleted: true,
    'graphData.id': { $exists: true, $ne: null },
    $and: [buildSeriesAwareDateRangeClause(startDate, endDate)],
  }).toArray();

  const allDocs = [...publishedDocs, ...deletedDocs];

  // The set of distinct calendarOwner mailboxes IS the set of calendars the app
  // manages — there is no separate registry. See calendarKeyOf for why
  // calendarId is deliberately excluded from the key.
  const docsByCalendar = new Map();
  for (const doc of allDocs) {
    if (!doc.calendarOwner) continue;
    const key = calendarKeyOf(doc);
    if (!docsByCalendar.has(key)) {
      docsByCalendar.set(key, { calendarOwner: doc.calendarOwner, docs: [] });
    }
    docsByCalendar.get(key).docs.push(doc);
  }

  const windowStartIso = `${startDate}T00:00:00Z`;
  const windowEndIso = `${endDate}T23:59:59Z`;

  const calendars = [];
  for (const { calendarOwner, docs } of docsByCalendar.values()) {
    const { appInstances, trackedSeries } = buildAppSide(docs, startDate, endDate);

    // Always the mailbox's DEFAULT calendar. The stored calendarId cannot be
    // used here: it is scoped to whichever mailbox it was captured from, so
    // /users/{owner}/calendars/{storedId} 404s (ErrorItemNotFound) whenever it
    // came from a different mailbox. Passing null targets
    // /users/{owner}/calendar/calendarView, which is where every calendar this
    // app manages actually lives — every VALID stored calendarId in the
    // database resolves to that mailbox's isDefaultCalendar entry.
    const graphCalendarId = null;

    let outlookInstances;
    try {
      outlookInstances = await withGraphRetry(() => graphApi.getCalendarEvents(
        calendarOwner, graphCalendarId, windowStartIso, windowEndIso, { select: GRAPH_SELECT }
      ));
    } catch (err) {
      // Per-calendar isolation: one mailbox failing must not blank the report.
      logger.warn('[syncHealth] Graph fetch failed for %s: %s', calendarOwner, err.message);
      calendars.push({
        calendarOwner,
        calendarId: graphCalendarId,
        error: err.message || 'Graph request failed',
        counts: {
          appExpected: appInstances.filter(i => !i.isDeleted).length,
          outlookFound: 0,
          matched: 0,
        },
        missingFromOutlook: [],
        untethered: [],
        shouldNotBeInOutlook: [],
        untracked: [],
      });
      continue;
    }

    calendars.push({
      calendarOwner,
      calendarId: graphCalendarId,
      error: null,
      ...diffCalendar({ appInstances, trackedSeries, outlookInstances }),
    });
  }

  calendars.sort((a, b) => a.calendarOwner.localeCompare(b.calendarOwner));

  return { window: { start: startDate, end: endDate }, calendars };
}

module.exports = {
  MAX_WINDOW_DAYS,
  resolveWindow,
  validateWindow,
  buildAppSide,
  runSyncHealthCheck,
};
