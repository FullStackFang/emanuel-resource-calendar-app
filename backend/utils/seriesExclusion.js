const { ObjectId } = require('mongodb');

/**
 * Resolve the set of `_id` strings that all belong to the same recurring
 * series as the document identified by `excludeEventId`.
 *
 * - If the excluded document is a `seriesMaster`, the result includes the
 *   master's _id and the _ids of every `exception`/`addition` child whose
 *   `seriesMasterEventId` matches the master's `eventId`.
 * - If the excluded document is an `exception` or `addition`, the result
 *   includes the master and all sibling children of the same series.
 * - If the excluded document is non-recurring (no series linkage), the
 *   result is the singleton { excludeEventId }.
 * - If `excludeEventId` is falsy or invalid, returns an empty Set.
 *
 * Caller may supply `hints.candidates` — an array of already-fetched docs
 * (e.g. the merged availability query results plus seriesMasters) — so the
 * initial findOne can be skipped when the excluded doc is already in
 * memory.
 *
 * IMPORTANT: do NOT remove the findOne fallback. Some callers fetch series
 * masters with a date-window filter; if the excluded master's startDate is
 * outside that window, it will be absent from `candidates` and the
 * fallback is the only way to resolve its eventId.
 *
 * @param {Object} unifiedEventsCollection - Mongo collection
 * @param {string|ObjectId|null} excludeEventId
 * @param {{ candidates?: Array }} [hints]
 * @returns {Promise<Set<string>>} set of _id strings to exclude
 */
async function resolveSeriesExclusionIds(unifiedEventsCollection, excludeEventId, hints = {}) {
  const out = new Set();
  if (!excludeEventId) return out;

  const idStr = excludeEventId.toString();
  out.add(idStr);

  let excluded = null;
  if (Array.isArray(hints.candidates) && hints.candidates.length > 0) {
    excluded = hints.candidates.find(e => e && e._id && e._id.toString() === idStr) || null;
  }

  if (!excluded) {
    let oid;
    try { oid = new ObjectId(excludeEventId); }
    catch (_) { return out; }

    excluded = await unifiedEventsCollection.findOne(
      { _id: oid },
      { projection: { eventId: 1, eventType: 1, seriesMasterEventId: 1 } }
    );
  }

  if (!excluded) return out;

  const seriesMasterEventId = excluded.eventType === 'seriesMaster'
    ? excluded.eventId
    : excluded.seriesMasterEventId;

  if (!seriesMasterEventId) return out;

  const siblings = await unifiedEventsCollection.find(
    {
      $or: [
        { eventId: seriesMasterEventId, eventType: 'seriesMaster' },
        { seriesMasterEventId },
      ],
      isDeleted: { $ne: true },
    },
    { projection: { _id: 1 } }
  ).toArray();

  for (const s of siblings) {
    if (s && s._id) out.add(s._id.toString());
  }

  return out;
}

module.exports = { resolveSeriesExclusionIds };
