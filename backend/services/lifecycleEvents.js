// backend/services/lifecycleEvents.js
//
// Single entry point for "this event just transitioned state" side effects.
//
// Today, write handlers in api-server.js call broadcastEventChange directly
// (21+ sites). Each call site has the same shape — `{ eventId, action,
// actorEmail, requesterEmail, event, oldStatus, newStatus }` — but is
// slightly different and easy to drift when copy-pasted.
//
// As routes extract into backend/routes/*.js modules in §11/§14, those
// routes call lifecycleEvents.afterStateChange(event, transition) instead.
// The transition object carries semantic state (from/to/action) and the
// service translates it into the legacy broadcaster shape under the hood.
// This is the intermediate step on the path to fully owning the SSE
// payload composition (the §9 SSE→RQ bridge will push payload enrichment
// further into this module).
//
// During the migration, the legacy `broadcastEventChange` continues to
// work for unmigrated handlers. The two paths emit identical SSE payloads
// because this module delegates to the same broadcaster.

const logger = require('../utils/logger');

let dbConnection = null;
// Broadcaster injected from api-server.js so this module doesn't have to
// import the broadcaster directly (which would re-create the closure-over-
// collections problem the audit flagged).
let broadcaster = null;

/**
 * Wire the database connection. Call once during connectToDatabase().
 * @param {import('mongodb').Db} db - MongoDB Db handle
 */
function setDbConnection(db) {
  dbConnection = db;
}

/**
 * Wire the broadcaster function from api-server.js. Call once during
 * bootstrap, after `broadcastEventChange` is defined. This indirection
 * lets the legacy broadcaster keep its closure over invalidateCountsCacheTargeted,
 * BROADCAST_DELAY_MS, and projectEventForSSE without this module having
 * to depend on those internals.
 *
 * @param {(payload: Object) => void} fn - The legacy broadcastEventChange function
 */
function setBroadcaster(fn) {
  broadcaster = fn;
}

/**
 * Record a state transition for an event. Triggers SSE broadcast to the
 * affected views; safe to call after `res.json(...)` so it does not block
 * the writer's HTTP response.
 *
 * Errors during broadcast are caught and logged but NEVER propagated —
 * a failed SSE broadcast must not poison the upstream operation.
 *
 * @param {Object} event - The post-state event document
 * @param {Object} transition
 * @param {string} transition.action - The action that produced the transition
 *        (e.g., 'created', 'published', 'rejected', 'deleted', 'edit-published').
 * @param {string|null} [transition.from] - Previous status (for status-changing actions)
 * @param {string|null} [transition.to] - New status (for status-changing actions)
 * @param {string} [transition.actorEmail] - Email of the user who performed the action
 * @param {string} [transition.requesterEmail] - Email of the original requester
 *        (for notification fan-out — typically `event.roomReservationData.requestedBy.email`)
 * @returns {void}
 */
function afterStateChange(event, transition = {}) {
  try {
    if (!broadcaster) {
      // Bootstrap order issue — the broadcaster wasn't wired before the first
      // state change. Log and no-op rather than throwing; main operation
      // already succeeded.
      logger.warn('[lifecycleEvents] broadcaster not wired; skipping SSE broadcast');
      return;
    }
    const { action, from, to, actorEmail, requesterEmail } = transition;
    if (!action) {
      logger.warn('[lifecycleEvents] afterStateChange called without action; skipping');
      return;
    }
    broadcaster({
      eventId: event?.eventId || event?._id || null,
      action,
      actorEmail,
      requesterEmail: requesterEmail || event?.roomReservationData?.requestedBy?.email || null,
      event,
      oldStatus: from || null,
      newStatus: to || null,
    });
  } catch (err) {
    // Defensive: never let a broadcast issue surface to the caller.
    logger.warn('[lifecycleEvents] afterStateChange failed:', err.message);
  }
}

module.exports = {
  setDbConnection,
  setBroadcaster,
  afterStateChange,
};
