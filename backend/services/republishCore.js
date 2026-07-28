// backend/services/republishCore.js
//
// The create-then-link half of "put this record on the Outlook calendar",
// extracted VERBATIM from POST /api/admin/events/:id/republish so the
// sync-health reconcile publish action shares it rather than forking it.
//
// Only the mechanics live here. The route keeps its own gates (admin check,
// status check, EXISTING_GRAPH_LINK acknowledgement), its SSE broadcast, and
// its HTTP mapping — those differ between callers. What must NOT differ is the
// write ORDER and the compensation story, which is exactly what this file owns:
//
//   1. Graph create
//   2. OCC-guarded Mongo link persist (filter on _version)
//   3. On OCC loss: the Graph event EXISTS and is unlinked — report the orphan
//      id so the caller can compensate, and never silently swallow it.
//
// Ordering rationale (unchanged from the endpoint): Cosmos has no multi-document
// transaction here, so one of the two failure modes has to be chosen. An orphan
// Outlook event is visible, recoverable, and its id is recorded in
// roomReservationData.createdGraphEventIds for
// recover-untethered-publishes.js --clean-orphans. A record pointing at a Graph
// event that was never created is neither.

const { buildGraphEventDataFromRecord } = require('../utils/graphEventBuilder');
const { buildStatusHistoryEntry } = require('../utils/eventFieldBuilder');
const logger = require('../utils/logger');

/**
 * Create a fresh Graph event for a record and persist the link under OCC.
 *
 * @param {object} params
 * @param {import('mongodb').Collection} params.eventsCollection
 * @param {object} params.graphApi - needs createCalendarEvent(owner, calId, data)
 * @param {object} params.event - the full Mongo document (must have _id, calendarOwner)
 * @param {number} params.expectedVersion - _version the write is guarded on
 * @param {string} params.userId
 * @param {string} params.userEmail
 * @param {string} [params.statusReason] - statusHistory reason; defaults to the
 *   endpoint's original wording (including the orphaned-previous note)
 * @param {Function} [params.withRetry] - wraps the Mongo write (Cosmos retry)
 * @returns {Promise<{ok: boolean, code?: string, createdEvent: object,
 *                    newGraphData?: object, previousGraphId: string|null}>}
 *   `ok: false, code: 'VERSION_CONFLICT'` means the Graph event was created and
 *   NOT linked — `createdEvent.id` is an orphan the caller must handle.
 */
async function republishEventCore({
  eventsCollection,
  graphApi,
  event,
  expectedVersion,
  userId,
  userEmail,
  statusReason,
  withRetry = (fn) => fn(),
}) {
  const graphEventData = buildGraphEventDataFromRecord(event);
  const previousGraphId = event.graphData?.id || null;

  logger.info('Republish core: creating fresh Graph event', {
    eventId: String(event._id),
    calendarOwner: event.calendarOwner,
    previousGraphId,
    subject: graphEventData.subject,
  });

  const createdEvent = await graphApi.createCalendarEvent(
    event.calendarOwner,
    event.calendarId || null,
    graphEventData
  );

  // Preserve any non-id auxiliary fields delta sync may have written (e.g.
  // location.displayName) — only overwrite id/iCalUId. Written as a FULL
  // object $set rather than dotted paths, which is what defends against the
  // Cosmos null-parent dotted-path defect.
  const newGraphData = {
    ...(event.graphData && typeof event.graphData === 'object' ? event.graphData : {}),
    id: createdEvent.id,
    iCalUId: createdEvent.iCalUId,
  };

  const reason = statusReason || (previousGraphId
    ? `Republished to Outlook (orphaned previous: ${previousGraphId})`
    : 'Republished to Outlook');

  const updateResult = await withRetry(() => eventsCollection.updateOne(
    { _id: event._id, _version: expectedVersion },
    {
      $set: { graphData: newGraphData },
      $inc: { _version: 1 },
      $push: {
        // Always recorded, so --clean-orphans stays an effective backstop even
        // when this call is the thing that crashed.
        'roomReservationData.createdGraphEventIds': createdEvent.id,
        statusHistory: buildStatusHistoryEntry('published', userId, userEmail, reason),
      },
    }
  ));

  if (updateResult.matchedCount === 0) {
    logger.error('Republish core: OCC conflict — Graph event created but not linked', {
      eventId: String(event._id),
      orphanedGraphId: createdEvent.id,
      expectedVersion,
    });
    return { ok: false, code: 'VERSION_CONFLICT', createdEvent, previousGraphId };
  }

  return { ok: true, createdEvent, newGraphData, previousGraphId };
}

module.exports = { republishEventCore };
