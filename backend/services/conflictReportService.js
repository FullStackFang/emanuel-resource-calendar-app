// backend/services/conflictReportService.js
//
// The room conflict report: an all-pairs sweep across a forward window, not N
// one-vs-many conflict checks.
//
// WHY NOT REUSE checkRoomConflicts(): calling it once per event would guarantee
// identical semantics and is still wrong here. Each call issues roughly four
// queries, so a 90-day window holding ~1,500 occurrences is ~6,000 Cosmos
// queries per page load. It also emits every conflict twice (A->B and B->A),
// and it collapses a series master to a single "this series conflicts" verdict
// (it `break`s on the first overlapping occurrence), so it cannot attribute a
// conflict to a specific occurrence date — which is exactly what the report
// must show.
//
// Instead: a bounded set of reads, then all comparison in memory. Occurrences
// are bucketed by (roomId, dayKey) and each bucket is swept with an active
// interval list. Bucketing is not only a performance device — it gives each
// conflict a natural identity (a room, a day, an interval), which is the
// grouping the report is asked to present.
//
// The conflict DECISION is not defined here. It comes from
// utils/concurrencyRules.js, shared with the publish-time check, so the report
// can never tell an approver to fix something publish considers legal.
//
// Dependencies are INJECTED (eventsCollection, categoryMap, locations) rather
// than imported: api-server.js assigns its collection handles at connect time,
// so a module-level require would capture undefined.

const { isRealConflict } = require('../utils/concurrencyRules');
const { expandRecurringOccurrencesInWindow } = require('../utils/recurrenceExpansion');
const logger = require('../utils/logger');

// A stated limit, never a silent drop. Reaching it sets `truncated` on the
// response so the view can say so.
const MAX_OCCURRENCES = 20000;

const MS_PER_MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// Local-time helpers
//
// Stored datetimes are local-time strings with NO `Z` (e.g.
// "2026-02-12T13:15:00"). checkRoomConflicts builds its bounds the same way,
// deliberately using local getters — a UTC-based bound silently shifts the
// whole window by the machine's offset.
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

function toLocalISOString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toLocalDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a stored local-time string into a Date in local time. */
function parseLocal(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).replace(/Z$/, '');
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Effective windows (D8)
// ---------------------------------------------------------------------------

/**
 * Buffer minutes for one edge, reproducing the exact fallback chain in
 * checkRoomConflicts(). The chain is NOT simplifiable: legacy events do not all
 * carry the outer reservation bounds, so the setup/teardown fallbacks are the
 * only value available for them.
 * @private
 */
function bufferMinutes(doc, reservationField, setupField) {
  return (
    doc?.[reservationField] ??
    doc?.calendarData?.[reservationField] ??
    doc?.[setupField] ??
    doc?.calendarData?.[setupField] ??
    0
  );
}

/**
 * A "Hold" is a room block with no scheduled event inside it. The system
 * identifies one by the absence of event times together with the presence of
 * reservation bounds — the same predicate api-server.js uses at ~3601, ~6171
 * and EventManagement.jsx ~345.
 * @private
 */
function isHoldEvent(doc) {
  const cd = doc?.calendarData || {};
  return !cd.startTime && !cd.endTime && !!(cd.reservationStartTime || cd.reservationEndTime);
}

/**
 * The times a Hold actually occupies.
 *
 * A Hold has no event times, so its stored startDateTime/endDateTime are a
 * WHOLE-DAY placeholder (00:00-23:59) and its real occupancy lives in
 * reservationStartTime/reservationEndTime. api-server.js performs this exact
 * substitution when building the Graph event (~6176), with the comment
 * "Without this, exception docs (and events with empty startTime) show
 * 00:00-23:59".
 *
 * Reading the placeholder instead makes every Hold block its room for a full
 * day and collide with everything in it — and the row then renders
 * "12:00 AM - 12:00 AM", so the reader cannot see why it is being flagged.
 *
 * The DATE comes from the passed-in times, not from calendarData, so an
 * occurrence of a recurring Hold resolves against its own occurrence date
 * rather than the master's first date.
 * @private
 */
function holdWindow(doc, startDateTime, endDateTime) {
  const cd = doc?.calendarData || {};
  const startDay = String(startDateTime || '').split('T')[0] || cd.startDate;
  const endDay = String(endDateTime || '').split('T')[0] || cd.endDate || startDay;

  return {
    // Each edge falls back to the stored value independently: a Hold may carry
    // only one of the two reservation bounds.
    start: startDay && cd.reservationStartTime ? `${startDay}T${cd.reservationStartTime}:00` : startDateTime,
    end: endDay && cd.reservationEndTime ? `${endDay}T${cd.reservationEndTime}:00` : endDateTime,
  };
}

/**
 * The window a booking actually occupies: its visible times pushed out by the
 * setup/teardown (or reservation-bound) buffers.
 *
 * This is what overlap is measured on. Two events can collide while their
 * visible times do not overlap at all — a 2:00-3:00 event with 30 minutes of
 * teardown collides with a 2:45 event.
 * @private
 */
function effectiveWindow(doc, startDateTime, endDateTime) {
  const start = parseLocal(startDateTime);
  const end = parseLocal(endDateTime);
  if (!start || !end) return null;

  // A Hold IS its reservation window — the buffers are already baked in, and
  // adding them again would double-count the very fields that defined it.
  if (isHoldEvent(doc)) {
    return { effectiveStart: start, effectiveEnd: end, setupMinutes: 0, teardownMinutes: 0 };
  }

  const setup = bufferMinutes(doc, 'reservationStartMinutes', 'setupTimeMinutes') || 0;
  const teardown = bufferMinutes(doc, 'reservationEndMinutes', 'teardownTimeMinutes') || 0;

  return {
    effectiveStart: new Date(start.getTime() - setup * MS_PER_MINUTE),
    effectiveEnd: new Date(end.getTime() + teardown * MS_PER_MINUTE),
    setupMinutes: setup,
    teardownMinutes: teardown,
  };
}

// ---------------------------------------------------------------------------
// Normalization (task 3.3)
// ---------------------------------------------------------------------------

function roomIdsOf(doc) {
  const raw = doc?.calendarData?.locations || doc?.locations || [];
  return raw
    .map((loc) => (loc && typeof loc === 'object' && !loc.toHexString ? loc._id : loc))
    .filter(Boolean)
    .map((id) => String(id));
}

/**
 * Turn a document (or one occurrence of one) into the flat record the sweep and
 * the response both work with. Every side of every conflict is one of these.
 * @private
 */
function normalizeSide(doc, { startDateTime, endDateTime, occurrenceDate = null, isOccurrence = false }) {
  // Resolve a Hold to its real occupancy BEFORE anything else reads the times:
  // the placeholder it stores would otherwise be measured, bucketed AND
  // displayed, which is three wrong answers from one bad input.
  const isHold = isHoldEvent(doc);
  if (isHold) {
    const resolved = holdWindow(doc, startDateTime, endDateTime);
    startDateTime = resolved.start;
    endDateTime = resolved.end;
  }

  const eff = effectiveWindow(doc, startDateTime, endDateTime);
  if (!eff) return null;

  const rooms = roomIdsOf(doc);
  if (rooms.length === 0) return null;

  return {
    // Identity. `id` alone is not unique across a series — every occurrence of
    // a master shares the master's _id — so occurrenceDate is part of the key.
    id: String(doc._id),
    key: `${String(doc._id)}:${occurrenceDate || '-'}`,
    eventId: doc.eventId || null,
    seriesMasterEventId: doc.seriesMasterEventId || null,
    eventType: doc.eventType || null,
    occurrenceDate,
    isOccurrence,
    // Surfaced so the row can say WHY a booking with no event times occupies
    // the room it does.
    isHold,

    title: doc.eventTitle || doc.calendarData?.eventTitle || '(untitled)',
    calendarOwner: doc.calendarOwner || null,
    status: doc.status || null,

    // Visible times, shown beneath the contested interval.
    startDateTime,
    endDateTime,

    // What overlap is actually measured on.
    effectiveStart: toLocalISOString(eff.effectiveStart),
    effectiveEnd: toLocalISOString(eff.effectiveEnd),
    _effStart: eff.effectiveStart,
    _effEnd: eff.effectiveEnd,
    setupMinutes: eff.setupMinutes,
    teardownMinutes: eff.teardownMinutes,

    rooms,
    roomNames: doc.calendarData?.locationDisplayNames || doc.locationDisplayNames || [],

    // Concurrency inputs, handed straight to isRealConflict.
    categories: doc.calendarData?.categories || doc.categories || [],
    isAllowedConcurrent: doc.isAllowedConcurrent ?? false,
    allowedConcurrentCategories: doc.allowedConcurrentCategories || [],

    // null means "no requester recorded", which the view renders as
    // synced-from-Outlook rather than as a blank.
    requesterName: doc.roomReservationData?.requestedBy?.name || null,
  };
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * The fields the scan reads. Nothing else leaves the database — whole documents
 * carry the full graphData blob per row, and on Cosmos that is billed RU.
 */
const REPORT_PROJECTION = Object.freeze({
  _id: 1,
  eventId: 1,
  eventType: 1,
  seriesMasterEventId: 1,
  occurrenceDate: 1,
  status: 1,
  isDeleted: 1,
  calendarOwner: 1,
  eventTitle: 1,
  recurrence: 1,
  isAllowedConcurrent: 1,
  allowedConcurrentCategories: 1,
  categories: 1,
  locations: 1,
  locationDisplayNames: 1,
  'calendarData.eventTitle': 1,
  'calendarData.startDateTime': 1,
  'calendarData.endDateTime': 1,
  // Hold detection + resolution. WITHOUT these five the isHold predicate is
  // always false and every Hold silently occupies its room for a whole day.
  'calendarData.startTime': 1,
  'calendarData.endTime': 1,
  'calendarData.reservationStartTime': 1,
  'calendarData.reservationEndTime': 1,
  'calendarData.startDate': 1,
  'calendarData.endDate': 1,
  'calendarData.locations': 1,
  'calendarData.locationDisplayNames': 1,
  'calendarData.categories': 1,
  'calendarData.setupTimeMinutes': 1,
  'calendarData.teardownTimeMinutes': 1,
  'calendarData.reservationStartMinutes': 1,
  'calendarData.reservationEndMinutes': 1,
  // Name only — conflict records must not carry contact details.
  'roomReservationData.requestedBy.name': 1,
});

/**
 * Run the conflict scan.
 *
 * @param {Object} params
 * @param {import('mongodb').Collection} params.eventsCollection
 * @param {Map<string, Object>} params.categoryMap - name -> category document
 * @param {string} params.windowStart - 'YYYY-MM-DD', inclusive
 * @param {string} params.windowEnd - 'YYYY-MM-DD', exclusive
 * @param {string|null} [params.calendarOwner] - narrow to one mailbox
 * @param {string[]|null} [params.allowedCalendarOwners] - the mailboxes this
 *   app displays. With no `calendarOwner`, the scan covers THESE, not every
 *   calendarOwner in the collection — sandbox and other non-display mailboxes
 *   share the collection, and reporting conflicts in a calendar the picker does
 *   not even offer is noise the reader cannot act on.
 * @param {Function} [params.retry] - read wrapper (withCosmosRetry in production)
 * @param {Map<string,string>} [params.roomNamesById] - display names for grouping
 * @param {number} [params.maxOccurrences] - override the cap; exists so the cap
 *   behavior can be driven without inserting twenty thousand documents
 * @returns {Promise<Object>} the report
 */
async function runConflictReport({
  eventsCollection,
  categoryMap = new Map(),
  windowStart,
  windowEnd,
  calendarOwner = null,
  allowedCalendarOwners = null,
  retry = (fn) => fn(),
  roomNamesById = new Map(),
  maxOccurrences = MAX_OCCURRENCES,
}) {
  const startBound = new Date(`${windowStart}T00:00:00`);
  const endBound = new Date(`${windowEnd}T00:00:00`);
  const startStr = toLocalISOString(startBound);
  const endStr = toLocalISOString(endBound);

  const normalizedOwner = calendarOwner ? String(calendarOwner).toLowerCase() : null;

  // A scan that could not complete must NEVER render as "no conflicts" — a
  // false all-clear on a defect list is strictly worse than an error, because
  // the approver leaves believing the calendar is clean.
  const degraded = [];

  // Scope. One mailbox when asked for; otherwise the displayable set, NOT
  // everything in the collection.
  //
  // Case-insensitivity is done by expanding the allowlist against the stored
  // values via distinct(), NOT by $regex — Cosmos handles regex unreliably, and
  // this is the same approach syncHealthService takes for the same reason.
  // calendarOwner is lowercased on some write paths and not others, and
  // calendar-config.json stores mixed case ("TempleEvents@..."), so a
  // straight lowercased $in would silently match nothing at all.
  let ownerFilter = {};
  if (normalizedOwner) {
    ownerFilter = await expandOwnerFilter(eventsCollection, [normalizedOwner], retry, degraded);
  } else if (Array.isArray(allowedCalendarOwners)) {
    if (allowedCalendarOwners.length === 0) {
      // Nothing is configured for display, so nothing was scanned. Reporting
      // "no conflicts found" here would be a false all-clear about a calendar
      // nobody looked at (D9).
      degraded.push({
        stage: 'calendars',
        message: 'No calendars are configured for display, so nothing was scanned',
      });
      ownerFilter = { calendarOwner: { $in: [] } };
    } else {
      ownerFilter = await expandOwnerFilter(eventsCollection, allowedCalendarOwners, retry, degraded);
    }
  }

  // --- Read 1: published non-master events overlapping the window ------------
  // Series masters are excluded by eventType and expanded separately. A
  // master's stored calendarData.endDateTime holds the SERIES end, so matching
  // masters by date range makes the "encompassing" case hit any same-room event
  // anywhere in the span.
  let singles = [];
  let singlesFailed = false;
  try {
    singles = await retry(() =>
      eventsCollection
        .find({
          $and: [
            ownerFilter,
            { status: 'published' },
            { isDeleted: { $ne: true } },
            { eventType: { $in: ['singleInstance', 'exception', 'addition', null] } },
            {
              $or: [
                { 'calendarData.startDateTime': { $gte: startStr, $lt: endStr } },
                { 'calendarData.endDateTime': { $gt: startStr, $lte: endStr } },
                {
                  'calendarData.startDateTime': { $lte: startStr },
                  'calendarData.endDateTime': { $gte: endStr },
                },
              ],
            },
          ],
        })
        .project(REPORT_PROJECTION)
        .toArray()
    );
  } catch (err) {
    singlesFailed = true;
    degraded.push({ stage: 'events', message: err.message || 'Failed to read events' });
    logger.warn('[conflictReport] events read failed:', err.message);
  }

  // --- Read 2: published series masters, by type never by date --------------
  let masters = [];
  let mastersFailed = false;
  try {
    masters = await retry(() =>
      eventsCollection
        .find({
          ...ownerFilter,
          status: 'published',
          isDeleted: { $ne: true },
          eventType: 'seriesMaster',
        })
        .project(REPORT_PROJECTION)
        .toArray()
    );
  } catch (err) {
    mastersFailed = true;
    degraded.push({ stage: 'seriesMasters', message: err.message || 'Failed to read series masters' });
    logger.warn('[conflictReport] series master read failed:', err.message);
  }

  // If nothing could be read at all there is no partial result to disclose —
  // that is an error, not a degraded scan.
  if (singlesFailed && mastersFailed) {
    const err = new Error('Conflict scan could not read any events');
    err.code = 'CONFLICT_SCAN_FAILED';
    throw err;
  }

  // --- Read 3: exception/addition children, for occurrence suppression ------
  // Separate from read 1 on purpose: an exception that moved its occurrence
  // OUTSIDE the window still has to suppress the master's in-window occurrence,
  // and read 1 by definition would not return it.
  const exceptionDatesByMaster = new Map();
  const masterEventIds = masters.map((m) => m.eventId).filter(Boolean);
  if (masterEventIds.length > 0) {
    try {
      const children = await retry(() =>
        eventsCollection
          .find({
            seriesMasterEventId: { $in: masterEventIds },
            eventType: { $in: ['exception', 'addition'] },
            isDeleted: { $ne: true },
            status: { $ne: 'deleted' },
          })
          .project({ seriesMasterEventId: 1, occurrenceDate: 1 })
          .toArray()
      );
      for (const child of children) {
        if (!exceptionDatesByMaster.has(child.seriesMasterEventId)) {
          exceptionDatesByMaster.set(child.seriesMasterEventId, new Set());
        }
        exceptionDatesByMaster.get(child.seriesMasterEventId).add(child.occurrenceDate);
      }
    } catch (err) {
      // Degraded rather than fatal, but NOT silent: without these dates the
      // scan would double-count overridden occurrences.
      degraded.push({ stage: 'seriesOverrides', message: err.message || 'Failed to read series overrides' });
      logger.warn('[conflictReport] exception date read failed:', err.message);
    }
  }

  // --- Normalize every side -------------------------------------------------
  const sides = [];
  let truncated = false;

  for (const doc of singles) {
    if (sides.length >= maxOccurrences) {
      truncated = true;
      break;
    }
    const side = normalizeSide(doc, {
      startDateTime: doc.calendarData?.startDateTime,
      endDateTime: doc.calendarData?.endDateTime,
      occurrenceDate: doc.occurrenceDate || null,
      isOccurrence: doc.eventType === 'exception' || doc.eventType === 'addition',
    });
    if (side) sides.push(side);
  }

  for (const master of masters) {
    if (truncated) break;
    const suppressed = exceptionDatesByMaster.get(master.eventId);
    let occurrences = [];
    try {
      occurrences = expandRecurringOccurrencesInWindow(master, startBound, endBound);
    } catch (err) {
      degraded.push({ stage: 'expansion', message: err.message || 'Failed to expand a series' });
      logger.warn('[conflictReport] series expansion failed:', err.message);
      continue;
    }

    for (const occ of occurrences) {
      if (sides.length >= maxOccurrences) {
        truncated = true;
        break;
      }
      // An exception/addition document REPLACES the master's occurrence for
      // that date and is evaluated in its own right (it came through read 1).
      if (suppressed && suppressed.has(occ.occurrenceDate)) continue;

      const side = normalizeSide(master, {
        startDateTime: occ.startDateTime,
        endDateTime: occ.endDateTime,
        occurrenceDate: occ.occurrenceDate,
        isOccurrence: true,
      });
      if (side) sides.push(side);
    }
  }

  // --- Bucket by (calendarOwner, room, day), then sweep ---------------------
  //
  // calendarOwner IS PART OF THE BUCKET KEY, and that is load-bearing (D6).
  // Comparing across mailboxes is out of scope for this capability, and the
  // failure mode when it leaks is not subtle: the same event synced into two
  // calendars becomes two documents with identical title, time, room and
  // requester, and every one of them reports as a conflict with itself. The
  // genuine findings drown, and the report reads as broken on first contact.
  //
  // This leaves a real blind spot — a room is a physical object, so the same
  // room booked at the same time from two mailboxes IS double-booked, and no
  // check in this system can see it. Recorded as a decision, not a bug.
  //
  // Lowercased because calendarOwner is normalized on some write paths and not
  // others; bucketing the raw string would split one mailbox in two and hide a
  // genuine same-calendar conflict.
  //
  // A side is inserted into EVERY day-bucket its effective window touches. An
  // event spanning midnight, or one whose setup buffer pushes its effective
  // start into the previous day, belongs to two buckets; bucketing on the
  // effective start-day alone silently drops those pairs.
  const buckets = new Map();
  for (const side of sides) {
    const ownerKey = side.calendarOwner ? String(side.calendarOwner).toLowerCase() : '(none)';
    for (const roomId of side.rooms) {
      const cursor = new Date(
        side._effStart.getFullYear(),
        side._effStart.getMonth(),
        side._effStart.getDate()
      );
      const lastDay = new Date(
        side._effEnd.getFullYear(),
        side._effEnd.getMonth(),
        side._effEnd.getDate()
      );
      while (cursor <= lastDay) {
        const bucketKey = `${ownerKey}|${roomId}|${toLocalDateKey(cursor)}`;
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, { roomId, ownerKey, sides: [] });
        buckets.get(bucketKey).sides.push(side);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }

  // Deduped across buckets: a pair whose effective windows both span midnight
  // meets in two day-buckets but is one conflict.
  const byKey = new Map();

  for (const bucket of buckets.values()) {
    const ordered = [...bucket.sides].sort((a, b) => a._effStart - b._effStart);
    const active = [];

    for (const arrival of ordered) {
      // Retire actives that closed before this one opened. Strict `<=` keeps
      // touching endpoints (one ends exactly as the next begins) out of
      // conflict, matching the publish-time overlap test.
      for (let i = active.length - 1; i >= 0; i -= 1) {
        if (active[i]._effEnd <= arrival._effStart) active.splice(i, 1);
      }

      for (const open of active) {
        if (open.key === arrival.key) continue;
        if (!isRealConflict(open, arrival, categoryMap)) continue;

        const overlapStart = open._effStart > arrival._effStart ? open._effStart : arrival._effStart;
        const overlapEnd = open._effEnd < arrival._effEnd ? open._effEnd : arrival._effEnd;

        // Order the pair canonically so A/B and B/A collapse to one entry.
        const [first, second] = open.key < arrival.key ? [open, arrival] : [arrival, open];
        const date = toLocalDateKey(overlapStart);
        const conflictKey = `${bucket.roomId}|${date}|${first.key}|${second.key}`;
        if (byKey.has(conflictKey)) continue;

        byKey.set(conflictKey, {
          key: conflictKey,
          date,
          // Both sides share this by construction — the bucket key includes it.
          calendarOwner: first.calendarOwner || null,
          roomId: bucket.roomId,
          roomName: roomNamesById.get(bucket.roomId) || nameForRoom(bucket.roomId, [first, second]),
          overlapStart: toLocalISOString(overlapStart),
          overlapEnd: toLocalISOString(overlapEnd),
          sides: [stripInternal(first), stripInternal(second)],
        });
      }

      active.push(arrival);
    }
  }

  // Ordered by date, then room, then start time — the order the view renders.
  const conflicts = [...byKey.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.roomName.localeCompare(b.roomName) ||
      a.overlapStart.localeCompare(b.overlapStart) ||
      a.key.localeCompare(b.key)
  );

  return {
    window: { startDate: windowStart, endDate: windowEnd },
    calendarOwner: normalizedOwner,
    generatedAt: new Date().toISOString(),
    occurrenceCount: sides.length,
    conflictCount: conflicts.length,
    conflicts,
    groups: groupByDateAndRoom(conflicts),
    degraded,
    truncated,
  };
}

/**
 * Build a calendarOwner filter that matches the wanted mailboxes in whatever
 * casing they are actually stored in.
 *
 * distinct() rather than $regex: Cosmos handles regex unreliably, and this
 * mirrors what syncHealthService does for the same field. If the distinct read
 * fails we fall back to the requested values verbatim plus their lowercase
 * forms and say so — narrower than intended is acceptable, silently scanning
 * every mailbox in the collection is not.
 * @private
 */
async function expandOwnerFilter(eventsCollection, wanted, retry, degraded) {
  const wantedLower = new Set(wanted.map((o) => String(o).toLowerCase()).filter(Boolean));

  try {
    const stored = await retry(() => eventsCollection.distinct('calendarOwner'));
    const matches = stored.filter((o) => o && wantedLower.has(String(o).toLowerCase()));
    return { calendarOwner: { $in: matches } };
  } catch (err) {
    degraded.push({
      stage: 'calendars',
      message: `Could not resolve calendar name casing (${err.message || 'read failed'}); scan may be narrower than requested`,
    });
    logger.warn('[conflictReport] calendarOwner distinct failed:', err.message);
    const fallback = new Set([...wanted, ...wantedLower]);
    return { calendarOwner: { $in: [...fallback] } };
  }
}

/**
 * Best-effort room label when no location lookup was supplied. The display-name
 * arrays are positional against `locations`, so index into them.
 * @private
 */
function nameForRoom(roomId, sides) {
  for (const side of sides) {
    const idx = side.rooms.indexOf(roomId);
    if (idx >= 0 && side.roomNames[idx]) return side.roomNames[idx];
  }
  return roomId;
}

/** Drop the Date fields the sweep needs but the response should not carry. */
function stripInternal(side) {
  const { _effStart, _effEnd, ...rest } = side;
  return rest;
}

/**
 * Nest the flat, already-ordered list under date -> room. The flat list stays
 * on the response too: it is what counts and keys are asserted against.
 * @private
 */
function groupByDateAndRoom(conflicts) {
  const groups = [];
  for (const conflict of conflicts) {
    let dateGroup = groups[groups.length - 1];
    if (!dateGroup || dateGroup.date !== conflict.date) {
      dateGroup = { date: conflict.date, rooms: [] };
      groups.push(dateGroup);
    }
    let roomGroup = dateGroup.rooms[dateGroup.rooms.length - 1];
    if (!roomGroup || roomGroup.roomId !== conflict.roomId) {
      roomGroup = { roomId: conflict.roomId, roomName: conflict.roomName, conflicts: [] };
      dateGroup.rooms.push(roomGroup);
    }
    roomGroup.conflicts.push(conflict);
  }
  return groups;
}

module.exports = {
  runConflictReport,
  MAX_OCCURRENCES,
  REPORT_PROJECTION,
  // Exported for unit reach — the buffer chain and the local-time helpers are
  // the two places a silent off-by-an-offset bug would hide.
  effectiveWindow,
  toLocalISOString,
};
