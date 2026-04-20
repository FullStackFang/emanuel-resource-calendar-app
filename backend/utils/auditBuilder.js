'use strict';

/**
 * Shared audit entry builders.
 *
 * These functions return plain objects ready for insertOne().
 * The actual DB write stays in api-server.js (logEventAudit / logReservationAudit)
 * because those functions close over collection variables assigned at connect time.
 */

/**
 * Build an event audit entry for eventAuditHistoryCollection.
 *
 * @param {Object} params
 * @param {string} params.eventId
 * @param {string} params.userId
 * @param {'create'|'update'|'delete'|'import'} params.changeType
 * @param {string} [params.source='Unknown']
 * @param {Object[]|null} [params.changes]
 * @param {Object[]|null} [params.changeSet]
 * @param {Object} [params.metadata={}]
 * @returns {Object} Audit entry ready for insertOne
 */
function buildEventAuditEntry({
  eventId,
  userId,
  changeType,
  source = 'Unknown',
  changes = null,
  changeSet = null,
  metadata = {},
}) {
  const entry = {
    eventId,
    userId,
    changeType,
    source,
    timestamp: new Date(),
    metadata: {
      userAgent: 'API',
      ipAddress: 'Unknown',
      reason: null,
      importSessionId: null,
      ...metadata,
    },
  };

  if (changes) {
    entry.changes = changes;
  }

  if (changeSet && Array.isArray(changeSet)) {
    entry.changeSet = changeSet;
  }

  return entry;
}

/**
 * Build a reservation audit entry for reservationAuditHistoryCollection.
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
 * @returns {Object} Audit entry ready for insertOne
 */
function buildReservationAuditEntry({
  reservationId,
  userId,
  userEmail,
  changeType,
  source = 'Unknown',
  changes = null,
  changeSet = null,
  metadata = {},
}) {
  const entry = {
    reservationId,
    userId,
    userEmail,
    changeType,
    source,
    timestamp: new Date(),
    metadata: {
      userAgent: 'API',
      ipAddress: 'Unknown',
      reason: null,
      previousRevision: null,
      ...metadata,
    },
  };

  if (changes) {
    entry.changes = changes;
  }

  if (changeSet && Array.isArray(changeSet)) {
    entry.changeSet = changeSet;
  }

  return entry;
}

module.exports = {
  buildEventAuditEntry,
  buildReservationAuditEntry,
};
