'use strict';

/**
 * Public (unauthenticated) published-events query.
 *
 * Backs GET /api/public/events — the guest calendar shown to signed-out phone
 * and native-app users.
 *
 * SECURITY: the MongoDB projection below is the PII boundary. Requester identity
 * lives in roomReservationData.requestedBy and internal notes live in
 * calendarData.setupNotes/doorNotes/eventNotes; NONE of those fields are read out
 * of the database here, so they cannot leak downstream. Do not "simplify" this by
 * fetching whole documents and deleting fields in JS — the frontend transformer
 * (transformEventToFlatStructure) surfaces whatever the backend sends, and
 * MobileEventDetail renders requesterName/requesterEmail whenever they are present.
 *
 * RENDERING UNIT: this endpoint returns OCCURRENCES, not documents. Published
 * series masters are expanded into virtual occurrences inside the requested
 * window, and any date that has its own exception/addition child document is
 * suppressed from that expansion (the child is the authoritative record for that
 * date — this mirrors Calendar.jsx's client-side expansion).
 */

const { expandRecurringOccurrencesInWindow } = require('./recurrenceExpansion');

/** Display fields returned to guests. Everything else stays in the database. */
const PUBLIC_CALENDAR_FIELDS = [
  'eventTitle',
  'startDateTime',
  'endDateTime',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'isAllDayEvent',
  'locationDisplayNames',
  'categories',
];

/**
 * Fields read out of MongoDB. A superset of what is returned: eventType,
 * recurrence, seriesMasterEventId and occurrenceDate are needed to expand and
 * de-duplicate recurring series, then dropped by toPublicEvent().
 */
const PUBLIC_QUERY_PROJECTION = {
  _id: 1,
  eventId: 1,
  status: 1,
  eventType: 1,
  seriesMasterEventId: 1,
  occurrenceDate: 1,
  recurrence: 1,
  ...Object.fromEntries(PUBLIC_CALENDAR_FIELDS.map(f => [`calendarData.${f}`, 1])),
};

const pad = (n) => String(n).padStart(2, '0');

/** Local-time ISO string ('YYYY-MM-DDTHH:MM:SS') — the format calendarData dates are stored in. */
function toLocalISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toLocalDateOnly(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Strip a raw document down to the guest-visible shape. */
function toPublicEvent(doc) {
  const cd = doc.calendarData || {};
  const calendarData = {};
  for (const field of PUBLIC_CALENDAR_FIELDS) {
    if (cd[field] !== undefined) calendarData[field] = cd[field];
  }
  return {
    _id: String(doc._id),
    id: doc.eventId || String(doc._id),
    eventId: doc.eventId,
    status: 'published',
    eventType: doc.eventType || 'singleInstance',
    calendarData,
  };
}

/**
 * Build one virtual occurrence of a series master.
 * Dates come from the occurrence; every other display field is inherited.
 */
function toVirtualOccurrence(master, occurrence) {
  const base = toPublicEvent(master);
  const { occurrenceDate, startDateTime, endDateTime } = occurrence;
  return {
    ...base,
    _id: `${base._id}::${occurrenceDate}`,
    id: `${base.eventId || base._id}::${occurrenceDate}`,
    eventType: 'occurrence',
    calendarData: {
      ...base.calendarData,
      startDateTime,
      endDateTime,
      startDate: occurrenceDate,
      endDate: endDateTime.split('T')[0],
    },
  };
}

/**
 * Fetch published events overlapping [start, end] for the guest calendar.
 *
 * @param {import('mongodb').Collection} eventsCollection
 * @param {Object} options
 * @param {Date} options.start - window start
 * @param {Date} options.end - window end
 * @param {string} [options.calendarOwner] - restrict to one mailbox (lowercased)
 * @returns {Promise<Array>} guest-shaped occurrences, sorted by start
 */
async function getPublicEvents(eventsCollection, { start, end, calendarOwner = null }) {
  const startISO = toLocalISO(start);
  const endISO = toLocalISO(end);
  const startDateOnly = toLocalDateOnly(start);
  const endDateOnly = toLocalDateOnly(end);

  const base = {
    status: 'published',
    isDeleted: { $ne: true },
    ...(calendarOwner ? { calendarOwner: String(calendarOwner).toLowerCase() } : {}),
  };

  // Branch 1 — everything that carries its own dates: single instances plus
  // exception/addition children (each child is the authoritative record for its date).
  const flatQuery = {
    ...base,
    eventType: { $ne: 'seriesMaster' },
    'calendarData.startDateTime': { $lt: endISO },
    'calendarData.endDateTime': { $gt: startISO },
  };

  // Branch 2 — series masters whose recurrence range overlaps the window.
  // A master's own calendarData dates describe only its FIRST occurrence, so the
  // range (not the dates) decides whether it can produce occurrences in-window.
  const masterQuery = {
    ...base,
    eventType: 'seriesMaster',
    'calendarData.startDateTime': { $lt: endISO },
    $or: [
      { 'recurrence.range.endDate': { $gte: startDateOnly } },
      { 'recurrence.range.type': 'noEnd' },
      { 'recurrence.range.type': 'numbered' },
      { 'recurrence.additions': { $elemMatch: { $gte: startDateOnly, $lte: endDateOnly } } },
    ],
  };

  const [flatDocs, masterDocs] = await Promise.all([
    eventsCollection.find(flatQuery).project(PUBLIC_QUERY_PROJECTION).toArray(),
    eventsCollection.find(masterQuery).project(PUBLIC_QUERY_PROJECTION).toArray(),
  ]);

  const results = flatDocs.map(toPublicEvent);

  if (masterDocs.length > 0) {
    // Any child document — published, deleted, or otherwise — means the master must
    // not also render that date. A deleted exception is a CANCELLED occurrence: it is
    // absent from branch 1 (not published) and must stay absent here too.
    const masterEventIds = masterDocs.map(m => m.eventId).filter(Boolean);
    const childDocs = masterEventIds.length > 0
      ? await eventsCollection
        .find({
          seriesMasterEventId: { $in: masterEventIds },
          eventType: { $in: ['exception', 'addition'] },
        })
        .project({ _id: 0, seriesMasterEventId: 1, occurrenceDate: 1 })
        .toArray()
      : [];

    const materializedDates = new Set(
      childDocs.map(c => `${c.seriesMasterEventId}|${c.occurrenceDate}`)
    );

    for (const master of masterDocs) {
      const occurrences = expandRecurringOccurrencesInWindow(master, start, end);
      for (const occ of occurrences) {
        if (materializedDates.has(`${master.eventId}|${occ.occurrenceDate}`)) continue;
        if (occ.startDateTime >= endISO || occ.endDateTime <= startISO) continue;
        results.push(toVirtualOccurrence(master, occ));
      }
    }
  }

  results.sort((a, b) =>
    String(a.calendarData.startDateTime || '').localeCompare(String(b.calendarData.startDateTime || ''))
  );

  return results;
}

module.exports = {
  getPublicEvents,
  toPublicEvent,
  PUBLIC_CALENDAR_FIELDS,
  PUBLIC_QUERY_PROJECTION,
};
