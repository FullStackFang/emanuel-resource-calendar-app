/**
 * Database helper utilities for tests
 *
 * Provides common database operations and assertion helpers.
 */

const { ObjectId } = require('mongodb');
const { COLLECTIONS } = require('./testConstants');

/**
 * Assert that an audit log entry exists for an action
 * @param {Db} db - MongoDB database instance
 * @param {Object} criteria - Audit entry criteria
 * @param {string} criteria.eventId - Event ID
 * @param {string} criteria.action - Action type (e.g., 'created', 'approved', 'rejected')
 * @param {string} criteria.performedBy - User who performed the action
 * @returns {Object} The audit entry
 */
async function assertAuditEntry(db, { eventId, action, performedBy }) {
  const audit = await db
    .collection(COLLECTIONS.AUDIT_HISTORY)
    .findOne(
      { eventId, action },
      { sort: { timestamp: -1 } }
    );

  if (!audit) {
    throw new Error(
      `Expected audit entry for eventId=${eventId}, action=${action}, but none found`
    );
  }

  if (performedBy && audit.performedBy !== performedBy) {
    throw new Error(
      `Expected audit entry performedBy=${performedBy}, but got ${audit.performedBy}`
    );
  }

  expect(audit).toBeTruthy();
  expect(audit.timestamp).toBeDefined();

  return audit;
}

/**
 * Assert that no audit entry exists for an action
 * @param {Db} db - MongoDB database instance
 * @param {Object} criteria - Audit entry criteria
 */
async function assertNoAuditEntry(db, { eventId, action }) {
  const audit = await db
    .collection(COLLECTIONS.AUDIT_HISTORY)
    .findOne({ eventId, action });

  if (audit) {
    throw new Error(
      `Expected no audit entry for eventId=${eventId}, action=${action}, but found one`
    );
  }
}

/**
 * Create an audit log entry
 * @param {Db} db - MongoDB database instance
 * @param {Object} entry - Audit entry data
 * @returns {Object} Inserted audit entry
 */
async function createAuditEntry(db, entry) {
  const auditEntry = {
    _id: new ObjectId(),
    eventId: entry.eventId,
    action: entry.action,
    performedBy: entry.performedBy,
    performedByEmail: entry.performedByEmail || entry.performedBy,
    timestamp: entry.timestamp || new Date(),
    previousState: entry.previousState || null,
    newState: entry.newState || null,
    changes: entry.changes || {},
    metadata: entry.metadata || {},
  };

  await db.collection(COLLECTIONS.AUDIT_HISTORY).insertOne(auditEntry);
  return auditEntry;
}

/**
 * Get all audit entries for an event
 * @param {Db} db - MongoDB database instance
 * @param {string} eventId - Event ID
 * @returns {Array} Audit entries sorted by timestamp desc
 */
async function getAuditHistory(db, eventId) {
  return db
    .collection(COLLECTIONS.AUDIT_HISTORY)
    .find({ eventId })
    .sort({ timestamp: -1 })
    .toArray();
}

/**
 * Create a test location
 * @param {Db} db - MongoDB database instance
 * @param {Object} locationData - Location data
 * @returns {Object} Inserted location
 */
async function createLocation(db, locationData = {}) {
  const location = {
    _id: new ObjectId(),
    name: locationData.name || 'Test Room',
    displayName: locationData.displayName || locationData.name || 'Test Room',
    code: locationData.code || 'TEST-ROOM',
    isReservable: locationData.isReservable !== false,
    capacity: locationData.capacity || 50,
    features: locationData.features || [],
    floor: locationData.floor || '1',
    building: locationData.building || 'Main',
    isActive: locationData.isActive !== false,
    createdAt: new Date(),
    ...locationData,
  };

  await db.collection(COLLECTIONS.LOCATIONS).insertOne(location);
  return location;
}

/**
 * Create multiple test locations
 * @param {Db} db - MongoDB database instance
 * @param {Array} locations - Array of location data
 * @returns {Array} Inserted locations
 */
async function createLocations(db, locations) {
  const results = [];
  for (const locationData of locations) {
    results.push(await createLocation(db, locationData));
  }
  return results;
}

/**
 * Create a reservation token
 * @param {Db} db - MongoDB database instance
 * @param {Object} tokenData - Token data
 * @returns {Object} Inserted token
 */
async function createReservationToken(db, tokenData = {}) {
  const token = {
    _id: new ObjectId(),
    token: tokenData.token || `test-token-${Date.now()}`,
    createdBy: tokenData.createdBy || 'admin@emanuelnyc.org',
    createdAt: tokenData.createdAt || new Date(),
    expiresAt: tokenData.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    usageCount: tokenData.usageCount || 0,
    maxUsage: tokenData.maxUsage || null,
    isActive: tokenData.isActive !== false,
    metadata: tokenData.metadata || {},
    ...tokenData,
  };

  await db.collection(COLLECTIONS.RESERVATION_TOKENS).insertOne(token);
  return token;
}

/**
 * Count documents in a collection
 * @param {Db} db - MongoDB database instance
 * @param {string} collectionName - Collection name
 * @param {Object} query - Optional query filter
 * @returns {number} Document count
 */
async function countDocuments(db, collectionName, query = {}) {
  return db.collection(collectionName).countDocuments(query);
}

/**
 * Find documents in a collection
 * @param {Db} db - MongoDB database instance
 * @param {string} collectionName - Collection name
 * @param {Object} query - Query filter
 * @param {Object} options - Find options (sort, limit, etc.)
 * @returns {Array} Documents
 */
async function findDocuments(db, collectionName, query = {}, options = {}) {
  let cursor = db.collection(collectionName).find(query);

  if (options.sort) cursor = cursor.sort(options.sort);
  if (options.limit) cursor = cursor.limit(options.limit);
  if (options.skip) cursor = cursor.skip(options.skip);

  return cursor.toArray();
}

/**
 * Delete all documents in a collection
 * @param {Db} db - MongoDB database instance
 * @param {string} collectionName - Collection name
 * @returns {number} Deleted count
 */
async function clearCollection(db, collectionName) {
  const result = await db.collection(collectionName).deleteMany({});
  return result.deletedCount;
}

/**
 * Seed the database with test data
 * @param {Db} db - MongoDB database instance
 * @param {Object} seedData - Data to seed
 * @returns {Object} Seeded data references
 */
async function seedDatabase(db, seedData = {}) {
  const results = {};

  // Seed users
  if (seedData.users) {
    const insertResult = await db
      .collection(COLLECTIONS.USERS)
      .insertMany(seedData.users);
    results.users = seedData.users.map((user, i) => ({
      ...user,
      _id: insertResult.insertedIds[i],
    }));
  }

  // Seed events
  if (seedData.events) {
    const insertResult = await db
      .collection(COLLECTIONS.EVENTS)
      .insertMany(seedData.events);
    results.events = seedData.events.map((event, i) => ({
      ...event,
      _id: insertResult.insertedIds[i],
    }));
  }

  // Seed locations
  if (seedData.locations) {
    const insertResult = await db
      .collection(COLLECTIONS.LOCATIONS)
      .insertMany(seedData.locations);
    results.locations = seedData.locations.map((loc, i) => ({
      ...loc,
      _id: insertResult.insertedIds[i],
    }));
  }

  return results;
}

/**
 * Wait for a condition to be true (useful for async operations)
 * @param {Function} condition - Function that returns boolean or promise of boolean
 * @param {number} timeout - Max wait time in ms
 * @param {number} interval - Check interval in ms
 * @returns {Promise<boolean>} True if condition met, throws if timeout
 */
async function waitFor(condition, timeout = 5000, interval = 100) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

module.exports = {
  // Audit helpers
  assertAuditEntry,
  assertNoAuditEntry,
  createAuditEntry,
  getAuditHistory,

  // Entity creation
  createLocation,
  createLocations,
  createReservationToken,

  // Query helpers
  countDocuments,
  findDocuments,
  clearCollection,

  // Seeding
  seedDatabase,

  // Utilities
  waitFor,
};
