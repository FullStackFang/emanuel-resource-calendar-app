// backend/services/auditService.js
//
// Centralized audit-trail writer for event and reservation history.
//
// Today, audit entries are written via two helpers in api-server.js
// (logEventAudit, logReservationAudit) that close over module-level
// collection references. As routes extract into backend/routes/*.js
// modules in §11/§14, those routes need a clean way to record audit
// entries without re-establishing the collection-closure pattern.
//
// This module is the destination. Use the same setDbConnection(db)
// pattern as emailService.js so the bootstrap can wire it up once and
// every consumer gets the same active connection. Existing api-server.js
// call sites keep using logEventAudit/logReservationAudit during the
// migration; new code MUST use this service.
//
// Design notes:
// - record() catches and logs errors but never throws — audit logging
//   must NEVER break the main operation. This mirrors the legacy
//   logEventAudit/logReservationAudit safety guarantee.
// - The pure entry-shape construction stays in utils/auditBuilder.js
//   (buildEventAuditEntry, buildReservationAuditEntry). This module
//   only owns the persistence step.

const logger = require('../utils/logger');
const { buildEventAuditEntry, buildReservationAuditEntry, buildUserManagementAuditEntry } = require('../utils/auditBuilder');

let dbConnection = null;

/**
 * Wire the database connection. Call once during connectToDatabase()
 * after the db handle is established.
 * @param {import('mongodb').Db} db - MongoDB Db handle
 */
function setDbConnection(db) {
  dbConnection = db;
}

/**
 * Lazy collection accessor — re-reads dbConnection on every call so
 * test injection (which reassigns the connection) is observed.
 * @private
 */
function getEventAuditCollection() {
  if (!dbConnection) {
    throw new Error('auditService: setDbConnection() not called yet');
  }
  return dbConnection.collection('templeEvents__EventAuditHistory');
}

function getReservationAuditCollection() {
  if (!dbConnection) {
    throw new Error('auditService: setDbConnection() not called yet');
  }
  return dbConnection.collection('templeEvents__ReservationAuditHistory');
}

function getUserAuditCollection() {
  if (!dbConnection) {
    throw new Error('auditService: setDbConnection() not called yet');
  }
  return dbConnection.collection('templeEvents__UserAuditHistory');
}

/**
 * Record an event audit entry.
 *
 * Use for any state transition on a templeEvents__Events document
 * (create, update, delete, import). Errors are caught and logged but
 * NEVER propagated — audit logging must not block the main operation.
 *
 * @param {Object} params
 * @param {string} params.eventId
 * @param {string} params.userId
 * @param {'create'|'update'|'delete'|'import'} params.changeType
 * @param {string} [params.source='Unknown']
 * @param {Object[]|null} [params.changes]
 * @param {Object[]|null} [params.changeSet]
 * @param {Object} [params.metadata={}]
 * @returns {Promise<void>}
 */
async function recordEvent(params) {
  try {
    const auditEntry = buildEventAuditEntry(params);
    await getEventAuditCollection().insertOne(auditEntry);

    logger.debug('Audit entry created:', {
      eventId: params.eventId,
      changeType: params.changeType,
      source: params.source || 'Unknown',
      hasChanges: !!params.changes,
      hasChangeSet: !!params.changeSet,
    });
  } catch (error) {
    logger.error('Failed to log event audit entry:', error);
    // Intentionally swallow — audit must not break the main operation.
  }
}

/**
 * Record a reservation audit entry.
 *
 * Use for any state transition on a reservation (create, update, publish,
 * reject, cancel, resubmit). Errors are caught and logged but NEVER
 * propagated.
 *
 * @param {Object} params
 * @param {import('mongodb').ObjectId} params.reservationId
 * @param {string} params.userId
 * @param {string} params.userEmail
 * @param {'create'|'update'|'publish'|'reject'|'cancel'|'resubmit'} params.changeType
 * @param {string} [params.source='Unknown']
 * @param {Object[]|null} [params.changes]
 * @param {Object[]|null} [params.changeSet]
 * @param {Object} [params.metadata={}]
 * @returns {Promise<void>}
 */
async function recordReservation(params) {
  try {
    const auditEntry = buildReservationAuditEntry(params);
    await getReservationAuditCollection().insertOne(auditEntry);

    logger.debug('Reservation audit entry created:', {
      reservationId: params.reservationId,
      changeType: params.changeType,
      source: params.source || 'Unknown',
      hasChanges: !!params.changes,
      hasChangeSet: !!params.changeSet,
    });
  } catch (error) {
    logger.error('Failed to log reservation audit entry:', error);
    // Intentionally swallow — audit must not break the main operation.
  }
}

/**
 * Record a user-management audit entry (create / update / delete of a user).
 *
 * Use for any mutation of a templeEvents__Users document via the user
 * management endpoints. Errors are caught and logged but NEVER propagated —
 * audit logging must not block the main operation.
 *
 * @param {Object} params
 * @param {string} params.targetUserId - _id (or userId) of the affected user
 * @param {string} params.targetEmail
 * @param {string} params.callerEmail - Acting caller's email
 * @param {string} params.callerRole - Acting caller's real effective role
 * @param {'create'|'update'|'delete'} params.changeType
 * @param {string|null} [params.oldRole]
 * @param {string|null} [params.newRole]
 * @param {string} [params.source='API']
 * @param {Object[]|null} [params.changes]
 * @param {Object} [params.metadata={}]
 * @returns {Promise<void>}
 */
async function recordUserManagement(params) {
  try {
    const auditEntry = buildUserManagementAuditEntry(params);
    await getUserAuditCollection().insertOne(auditEntry);

    logger.debug('User-management audit entry created:', {
      targetUserId: params.targetUserId,
      changeType: params.changeType,
      callerEmail: params.callerEmail,
      oldRole: params.oldRole,
      newRole: params.newRole,
    });
  } catch (error) {
    logger.error('Failed to log user-management audit entry:', error);
    // Intentionally swallow — audit must not break the main operation.
  }
}

module.exports = {
  setDbConnection,
  recordEvent,
  recordReservation,
  recordUserManagement,
};
