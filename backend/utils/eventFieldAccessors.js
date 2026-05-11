'use strict';

/**
 * Accessors for event fields that may live at top-level (post-migration)
 * or only in calendarData/graphData (pre-migration). Use these from the
 * reconcile scripts so the same code works against both data shapes.
 *
 * Production data has a mix of:
 *   - top-level startDateTime/endDateTime/eventTitle (current convention)
 *   - calendarData.startDateTime/endDateTime/eventTitle (migrated docs
 *     that didn't get the top-level fields populated)
 *   - graphData.start.dateTime/end.dateTime/subject (Graph-cached form)
 */

function getStartDateTime(doc) {
  return (
    doc?.startDateTime ||
    doc?.calendarData?.startDateTime ||
    doc?.graphData?.start?.dateTime ||
    null
  );
}

function getEndDateTime(doc) {
  return (
    doc?.endDateTime ||
    doc?.calendarData?.endDateTime ||
    doc?.graphData?.end?.dateTime ||
    null
  );
}

function getEventTitle(doc) {
  return (
    doc?.eventTitle ||
    doc?.calendarData?.eventTitle ||
    doc?.graphData?.subject ||
    ''
  );
}

/**
 * Returns an array of location ObjectId strings on the doc. Handles three
 * shapes:
 *   - top-level locations: [ObjectId(...), ...]
 *   - calendarData.locations: [{ _id: ObjectId, displayName }, ...] (older)
 *   - calendarData.locations: [ObjectId, ...] (alt older shape)
 *   - calendarData.locations: [{ $oid: '...' }, ...] (raw BSON)
 */
function getLocationIdStrings(doc) {
  const candidates = [];
  if (Array.isArray(doc?.locations)) candidates.push(...doc.locations);
  if (Array.isArray(doc?.calendarData?.locations))
    candidates.push(...doc.calendarData.locations);
  const out = [];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'string') out.push(c);
    else if (typeof c === 'object') {
      if (c._id) out.push(String(c._id));
      else if (c.$oid) out.push(String(c.$oid));
      else if (typeof c.toString === 'function') out.push(String(c));
    }
  }
  // Dedupe.
  return Array.from(new Set(out));
}

/**
 * Build the Mongo query fragment that matches a date range against either
 * top-level startDateTime or calendarData.startDateTime. Caller is
 * responsible for ORing with other top-level constraints (calendarOwner,
 * isDeleted) using $and:[...] or a nested $or.
 *
 * Returns an array suitable to drop into `$or: [...]`.
 */
function startDateTimeOrFilter(fromStr, toStr) {
  return [
    { startDateTime: { $gte: fromStr, $lte: toStr } },
    { 'calendarData.startDateTime': { $gte: fromStr, $lte: toStr } },
  ];
}

module.exports = {
  getStartDateTime,
  getEndDateTime,
  getEventTitle,
  getLocationIdStrings,
  startDateTimeOrFilter,
};
