// backend/utils/conflictDelta.js
//
// The pure definition of "which of the PROPOSED hard conflicts did this save
// INTRODUCE?" — the delta rule for save-conflict-delta-gate.
//
// A save on a pending/published event commits nothing new to the calendar if
// it merely CARRIES a double-booking the stored event already had (often it
// even reduces one). The gate exists to stop a save from INTRODUCING a fresh
// double-booking, not to freeze every event that already collides. So the
// server runs the same hard-conflict checker on the proposed state AND on the
// stored state, and blocks only on `proposed − stored`.
//
// This module answers that set-difference. It is deliberately deps-free and
// pure (no db, no logger, no ObjectId construction) like concurrencyRules.js,
// and unit-tested in isolation (conflictDelta.test.js, CD-1..). The endpoints
// build the baseline/proposed entry lists; this module only keys and subtracts.
//
// KEY DESIGN (design.md D1): a conflict's identity must be stable across the
// two checker runs the delta compares. The key is per (neighbour, room) pair,
// String()-normalized (neighbour rooms arrive as ObjectIds from the projection;
// request rooms arrive as strings from the client — without normalization every
// key mismatches and the delta always reports "introduced"):
//
//   - singleInstance/exception/addition neighbour: `${id}::${room}`
//   - published series MASTER neighbour: `${id}::${room}::${occurrenceStartDateTime}`
//       The master `_id` is stable WITHIN one call but not ACROSS the two calls:
//       moving a single event to a different week that collides with a DIFFERENT
//       occurrence of the same weekly master would key identically and save a
//       genuinely new double-booking silently. The occurrence qualifier fixes it.
//   - recurring-source per-date entry: `${occurrenceDate}::${id}::${room}`
//
// Overlap extent/time is deliberately NOT part of the key for non-master
// neighbours: if a stored event already double-books room A with X and the edit
// makes the overlap worse, the room is already booked with X — "worse overlap
// with an existing collision" is an approver judgment, not a new booking.

/**
 * Normalize a list of room ids (ObjectId or string) to a Set of strings.
 * @param {Array<any>} roomIds
 * @returns {Set<string>}
 */
function toRoomStringSet(roomIds) {
  const set = new Set();
  for (const id of roomIds || []) {
    if (id === null || id === undefined) continue;
    set.add(String(id));
  }
  return set;
}

/**
 * Build the delta keys for a single hard-conflict entry, one key per room the
 * entry shares with the request. Entry shape (from checkRoomConflicts /
 * flattenRecurringConflicts): `{ id, rooms, occurrenceStartDateTime?,
 * occurrenceDate? }`. `rooms` is the neighbour's location ids; the branch is
 * chosen by which occurrence discriminator (if any) the entry carries.
 *
 * @param {{id: any, rooms?: Array<any>, occurrenceStartDateTime?: string, occurrenceDate?: string}} entry
 * @param {Array<any>|Set<string>} requestRoomIds - the PROPOSED request's rooms
 * @returns {string[]} zero or more keys (empty when no room is shared)
 */
function conflictKey(entry, requestRoomIds) {
  if (!entry || !Array.isArray(entry.rooms) || entry.rooms.length === 0) return [];
  const requestSet = requestRoomIds instanceof Set ? requestRoomIds : toRoomStringSet(requestRoomIds);
  const id = String(entry.id);
  const keys = [];
  for (const room of entry.rooms) {
    if (room === null || room === undefined) continue;
    const roomStr = String(room);
    if (!requestSet.has(roomStr)) continue; // per-room intersection with the request
    if (entry.occurrenceDate) {
      // recurring-source branch
      keys.push(`${entry.occurrenceDate}::${id}::${roomStr}`);
    } else if (entry.occurrenceStartDateTime) {
      // single-window neighbour that is a published series master
      keys.push(`${id}::${roomStr}::${entry.occurrenceStartDateTime}`);
    } else {
      // single-window neighbour that is a singleInstance/exception/addition doc
      keys.push(`${id}::${roomStr}`);
    }
  }
  return keys;
}

/**
 * Split the proposed hard conflicts into the ones this save INTRODUCED and the
 * ones it merely CARRIES (pre-existing). A proposed entry is preexisting iff
 * every one of its keys is already present in the baseline key set; otherwise
 * it is introduced (at least one room/occurrence is newly double-booked).
 *
 * Both lists are intersected with the SAME `requestRoomIds` (the proposed
 * rooms), so a room removed by the edit drops out of both the baseline and the
 * proposed key sets and neither blocks nor protects — which is exactly the
 * "removing a colliding room saves" behaviour.
 *
 * @param {Array<object>} baselineHard - hard conflicts of the STORED state
 * @param {Array<object>} proposedHard - hard conflicts of the PROPOSED state
 * @param {Array<any>|Set<string>} requestRoomIds - the PROPOSED request's rooms
 * @returns {{introduced: Array<object>, preexisting: Array<object>}}
 */
function introducedConflicts(baselineHard, proposedHard, requestRoomIds) {
  const requestSet = requestRoomIds instanceof Set ? requestRoomIds : toRoomStringSet(requestRoomIds);

  const baselineKeys = new Set();
  for (const entry of baselineHard || []) {
    for (const key of conflictKey(entry, requestSet)) {
      baselineKeys.add(key);
    }
  }

  const introduced = [];
  const preexisting = [];
  for (const entry of proposedHard || []) {
    const keys = conflictKey(entry, requestSet);
    // An entry with no shared-room keys cannot be classed as pre-existing by a
    // vacuous `every` — a proposed hard conflict always shares a room with the
    // request (that is why it conflicts), so an empty key set is anomalous and
    // treated as introduced (fail safe: block).
    const isPreexisting = keys.length > 0 && keys.every(k => baselineKeys.has(k));
    if (isPreexisting) {
      preexisting.push(entry);
    } else {
      introduced.push(entry);
    }
  }

  return { introduced, preexisting };
}

module.exports = { conflictKey, introducedConflicts };
