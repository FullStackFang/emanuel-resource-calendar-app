// backend/utils/locationMatch.js
//
// Expand a list of room/location ids into BOTH their ObjectId and string forms
// so a `{ $in: [...] }` match on `calendarData.locations` catches a document
// regardless of whether its location was stored as an ObjectId or a hex string.
//
// WHY THIS EXISTS: `calendarData.locations` is stored inconsistently in
// production. Events written through the app's normal save paths store
// ObjectIds, but some events — notably `[Hold]` events pulled in by Outlook
// delta sync — store the same room reference as a plain 24-char hex string.
// MongoDB's `$in` does NOT cross the string<->ObjectId type boundary, so a
// conflict query built with one type SILENTLY misses documents stored with the
// other. The failure mode is invisible: such an event never registers as a
// scheduling conflict, never blocks a save, never blocks a publish.
//
// This is the same hazard the codebase already guards against at non-conflict
// query sites (the dual-`$in` `$or` near api-server.js:15654 and the
// `[id, new ObjectId(id)]` at :19623). This module centralizes that logic so
// the conflict checkers (checkRoomConflicts, checkRecurringRoomConflicts) match
// both representations too.
//
// The canonical stored type is ObjectId; matching both forms tolerates the
// mixed data already in production without masking it (both forms are the SAME
// reference). Cleaning up the write side / migrating string-stored locations is
// a separate concern — read-side robustness must hold regardless.

const { ObjectId } = require('mongodb');

// A room id is a 24-char hex ObjectId. Restrict string->ObjectId conversion to
// this exact shape: ObjectId.isValid() also accepts 12-char raw-byte strings,
// which would build an ObjectId whose hex does NOT equal the input — harmless
// here (we push both forms) but needlessly surprising.
const HEX24 = /^[0-9a-fA-F]{24}$/;

/**
 * @param {Array<ObjectId|string>} ids - room/location ids in either form
 * @returns {Array<ObjectId|string>} deduped list containing every valid id in
 *   BOTH ObjectId and string form. Null/undefined entries are dropped; a
 *   non-hex string is kept as a string-only match (no bogus ObjectId built).
 */
function locationMatchIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (id === null || id === undefined) continue;

    let oid = null;
    let str = null;
    if (id instanceof ObjectId) {
      oid = id;
      str = id.toString();
    } else if (typeof id === 'string') {
      str = id;
      if (HEX24.test(id)) oid = new ObjectId(id);
    } else {
      // Unknown type (defensive) — coerce to string as a last resort.
      str = String(id);
    }

    if (oid) {
      const key = 'o:' + oid.toString();
      if (!seen.has(key)) { out.push(oid); seen.add(key); }
    }
    if (str) {
      const key = 's:' + str;
      if (!seen.has(key)) { out.push(str); seen.add(key); }
    }
  }
  return out;
}

module.exports = { locationMatchIds };
