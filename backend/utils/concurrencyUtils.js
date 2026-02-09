/**
 * Optimistic Concurrency Control Utilities
 *
 * Provides atomic version-guarded updates using findOneAndUpdate.
 * Every event document has a `_version` integer field that increments
 * on each write. Clients send the expected version; if it doesn't match,
 * the update is rejected with a 409 Conflict.
 *
 * Usage:
 *   const { conditionalUpdate } = require('./concurrencyUtils');
 *   const result = await conditionalUpdate(collection, { _id }, update, {
 *     expectedVersion: 2,
 *     expectedStatus: 'pending'
 *   });
 */

const ApiError = require('./ApiError');

/**
 * Perform an atomic version-guarded update on a document.
 *
 * @param {Collection} collection - MongoDB collection
 * @param {Object} filter - Base filter (e.g. { _id: ObjectId(...) })
 * @param {Object} update - MongoDB update operations ({ $set, $unset, $push, etc. })
 * @param {Object} [options] - Options
 * @param {number|null} [options.expectedVersion] - Expected _version value. Null/undefined skips version check (backward compat).
 * @param {string|null} [options.expectedStatus] - Expected status value for atomic state transitions.
 * @param {string|null} [options.modifiedBy] - Who is making this change (for lastModifiedBy).
 * @returns {Object} The updated document (returnDocument: 'after')
 * @throws {ApiError} 404 if document not found, 409 if version/status mismatch
 */
async function conditionalUpdate(collection, filter, update, options = {}) {
  const { expectedVersion, expectedStatus, modifiedBy } = options;

  // Build versioned filter
  const versionedFilter = { ...filter };

  if (expectedVersion != null) {
    versionedFilter._version = expectedVersion;
  }

  if (expectedStatus != null) {
    versionedFilter.status = expectedStatus;
  }

  // Ensure update has $set and $inc operators
  const finalUpdate = { ...update };

  // Always increment _version
  if (!finalUpdate.$inc) {
    finalUpdate.$inc = {};
  }
  // Merge with existing $inc if present
  finalUpdate.$inc._version = 1;

  // Always set lastModifiedDateTime
  if (!finalUpdate.$set) {
    finalUpdate.$set = {};
  }
  finalUpdate.$set.lastModifiedDateTime = new Date();
  if (modifiedBy) {
    finalUpdate.$set.lastModifiedBy = modifiedBy;
  }

  // Perform atomic update
  const result = await collection.findOneAndUpdate(
    versionedFilter,
    finalUpdate,
    { returnDocument: 'after' }
  );

  // findOneAndUpdate returns the document directly in newer drivers,
  // or { value: doc } in older drivers
  const updatedDoc = result?.value !== undefined ? result.value : result;

  if (updatedDoc) {
    return updatedDoc;
  }

  // Update failed — determine why (404 vs 409)
  const currentDoc = await collection.findOne(filter);

  if (!currentDoc) {
    throw ApiError.notFound('Event not found');
  }

  // Document exists but version/status didn't match → 409 Conflict
  const details = {
    code: 'VERSION_CONFLICT',
    currentVersion: currentDoc._version,
    currentStatus: currentDoc.status,
    lastModifiedBy: currentDoc.lastModifiedBy || currentDoc.lastModifiedByEmail || null,
    lastModifiedDateTime: currentDoc.lastModifiedDateTime || currentDoc.lastModified || null,
  };

  throw ApiError.conflict(
    'This event was modified by another user. Please refresh and try again.',
    details
  );
}

module.exports = { conditionalUpdate };
