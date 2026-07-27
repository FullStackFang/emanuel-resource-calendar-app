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

/**
 * Look up an app instance in the Outlook index and consume the match.
 *
 * Series occurrences are matched by (master graph id, local date) because a
 * pattern date has no independent Graph ID of its own. Exception children may
 * be EITHER a real series exception (matched by master+date) or a standalone
 * event (matched by its own graphEventId), so they try both in that order.
 *
 * @param {{byId: Map, bySeriesDate: Map, entries: Array}} index
 * @param {object} instance - an AppInstance
 * @returns {object|null} the consumed index entry, or null when absent
 */
function consumeMatch(index, instance) {
  const trySeries = () => {
    if (!instance.seriesGraphId || !instance.date) return null;
    const hit = index.bySeriesDate.get(seriesDateKey(instance.seriesGraphId, instance.date));
    return hit && !hit.consumed ? hit : null;
  };
  const tryId = () => {
    if (!instance.graphId) return null;
    const hit = index.byId.get(instance.graphId);
    return hit && !hit.consumed ? hit : null;
  };

  // seriesMaster pattern dates have no own ID; exceptions are series-first
  // because a real series exception lives under the master. Everything else
  // prefers its own ID.
  const order = instance.eventType === 'seriesMaster' || instance.eventType === 'exception'
    ? [trySeries, tryId]
    : [tryId, trySeries];

  for (const attempt of order) {
    const hit = attempt();
    if (hit) {
      hit.consumed = true;
      return hit;
    }
  }
  return null;
}

const MISSING_REASON = {
  addition: 'no Outlook event for added date',
  seriesMaster: 'no Outlook occurrence on this date',
  exception: 'no Outlook event for this occurrence override',
  singleInstance: 'no Outlook event with this Graph ID',
};

/**
 * Diff one calendar's app-side expectations against its Outlook instances.
 *
 * Matching is by Graph ID (plus date for series occurrences) and NEVER by
 * title or time, so renames and time edits in Outlook cannot produce findings.
 *
 * @param {object} params
 * @param {Array<object>} params.appInstances - dated instances the app expects
 * @param {Array<object>} params.trackedSeries - published masters, for exclusions
 * @param {Array<object>} params.outlookInstances - raw Graph calendarView events
 * @returns {object} findings + counts for this calendar
 */
function diffCalendar({ appInstances = [], trackedSeries = [], outlookInstances = [] } = {}) {
  const index = buildOutlookIndex(outlookInstances);

  const missingFromOutlook = [];
  const untethered = [];
  const shouldNotBeInOutlook = [];

  // One untethered finding per DOCUMENT, not per expanded date — an untethered
  // master would otherwise emit one row per pattern date and drown the report.
  const untetheredMongoIds = new Set();

  const live = appInstances.filter(i => !i.isDeleted);
  const deleted = appInstances.filter(i => i.isDeleted);

  let matched = 0;

  for (const instance of live) {
    // A seriesMaster pattern date can only be found through its master's ID.
    // Everything else can use either its own ID or its master's.
    const linkage = instance.eventType === 'seriesMaster'
      ? instance.seriesGraphId
      : (instance.graphId || instance.seriesGraphId);

    if (!linkage) {
      if (!untetheredMongoIds.has(instance.mongoId)) {
        untetheredMongoIds.add(instance.mongoId);
        untethered.push({
          mongoId: instance.mongoId,
          eventTitle: instance.eventTitle,
          eventType: instance.eventType,
        });
      }
      continue;
    }

    if (consumeMatch(index, instance)) {
      matched++;
    } else {
      missingFromOutlook.push({
        mongoId: instance.mongoId,
        eventTitle: instance.eventTitle,
        date: instance.date,
        eventType: instance.eventType,
        reason: MISSING_REASON[instance.eventType] || 'no matching Outlook event',
      });
    }
  }

  // Failed-deletion detector: the app deleted it, Outlook still shows it.
  for (const instance of deleted) {
    if (!instance.graphId && !instance.seriesGraphId) continue;
    const hit = consumeMatch(index, instance);
    if (hit) {
      shouldNotBeInOutlook.push({
        graphId: hit.graphId,
        subject: hit.subject,
        date: hit.date,
        reason: 'deleted in app but still in Outlook',
      });
    }
  }

  // Excluded dates that Outlook never dropped.
  for (const series of trackedSeries) {
    if (!series.seriesGraphId) continue;
    for (const excludedDate of series.exclusions || []) {
      const hit = index.bySeriesDate.get(seriesDateKey(series.seriesGraphId, excludedDate));
      if (hit && !hit.consumed) {
        hit.consumed = true;
        shouldNotBeInOutlook.push({
          graphId: hit.graphId,
          subject: hit.subject,
          date: hit.date,
          reason: 'excluded date still present',
        });
      }
    }
  }

  const untracked = index.entries
    .filter(entry => !entry.consumed)
    .map(entry => ({ graphId: entry.graphId, subject: entry.subject, date: entry.date }));

  return {
    counts: {
      appExpected: live.length,
      outlookFound: index.entries.length,
      matched,
    },
    missingFromOutlook,
    untethered,
    shouldNotBeInOutlook,
    untracked,
  };
}

module.exports = {
  CALENDAR_TIMEZONE,
  toEasternDateKey,
  seriesDateKey,
  buildOutlookIndex,
  diffCalendar,
};
