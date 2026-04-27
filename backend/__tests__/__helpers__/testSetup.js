/**
 * Test database setup helpers
 *
 * Provides lifecycle management for test databases:
 * - connectToGlobalServer(suiteName): Connect to the global MongoMemoryServer, get isolated db
 * - disconnectFromGlobalServer(client, db): Drop db and close connection
 * - clearCollections(): Reset data between tests
 */

const { MongoClient } = require('mongodb');
const { COLLECTIONS } = require('./testConstants');

/**
 * Connect to the global MongoMemoryServer (started by globalSetup.js)
 * and return an isolated database for this test suite.
 * @param {string} suiteName - Unique name for this test suite (used as database name)
 * @returns {Object} { db, client } - Database and client references
 */
async function connectToGlobalServer(suiteName) {
  const uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    throw new Error('MONGODB_TEST_URI not set. Is globalSetup.js configured in jest.config.js?');
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(`test_${suiteName}`);

  // Create all required collections with indexes
  await createCollections(db);

  return { db, client };
}

/**
 * Disconnect from the global server, dropping the test database
 * @param {MongoClient} client - MongoDB client to close
 * @param {Db} db - Database to drop before closing
 */
async function disconnectFromGlobalServer(client, db) {
  if (db) {
    await db.dropDatabase();
  }
  if (client) {
    await client.close();
  }
}

/**
 * Create all required collections and indexes
 * @param {Db} database - MongoDB database instance
 */
async function createCollections(database) {
  // Create collections
  await database.createCollection(COLLECTIONS.USERS);
  await database.createCollection(COLLECTIONS.EVENTS);
  await database.createCollection(COLLECTIONS.LOCATIONS);
  await database.createCollection(COLLECTIONS.CALENDAR_DELTAS);
  await database.createCollection(COLLECTIONS.RESERVATION_TOKENS);
  await database.createCollection(COLLECTIONS.AUDIT_HISTORY);
  await database.createCollection(COLLECTIONS.CATEGORIES);
  await database.createCollection(COLLECTIONS.DEPARTMENTS);
  await database.createCollection(COLLECTIONS.ROLE_TYPES);
  await database.createCollection(COLLECTIONS.EDIT_REQUESTS);

  // Create indexes for events collection
  const eventsCollection = database.collection(COLLECTIONS.EVENTS);
  await eventsCollection.createIndex({ eventId: 1 });
  await eventsCollection.createIndex({ userId: 1 });
  await eventsCollection.createIndex({ status: 1 });
  await eventsCollection.createIndex({ calendarOwner: 1 });
  await eventsCollection.createIndex({ startDateTime: 1, endDateTime: 1 });
  await eventsCollection.createIndex({ isDeleted: 1 });
  await eventsCollection.createIndex({ 'roomReservationData.requesterEmail': 1 });
  await eventsCollection.createIndex({ seriesMasterEventId: 1, eventType: 1, isDeleted: 1, occurrenceDate: 1 });
  await eventsCollection.createIndex({ calendarOwner: 1, eventType: 1, isDeleted: 1, startDateTime: 1, endDateTime: 1 });

  // Create indexes for users collection
  const usersCollection = database.collection(COLLECTIONS.USERS);
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await usersCollection.createIndex({ odataId: 1 });

  // Create indexes for audit history
  const auditCollection = database.collection(COLLECTIONS.AUDIT_HISTORY);
  await auditCollection.createIndex({ eventId: 1 });
  await auditCollection.createIndex({ action: 1 });
  await auditCollection.createIndex({ timestamp: -1 });

  // Create indexes for edit requests collection
  const editRequestsCollection = database.collection(COLLECTIONS.EDIT_REQUESTS);
  await editRequestsCollection.createIndex({ eventId: 1, status: 1, requestedAt: -1 });
  await editRequestsCollection.createIndex({ 'requestedBy.userId': 1, status: 1, requestedAt: -1 });
  await editRequestsCollection.createIndex({ status: 1, requestedAt: -1 });
  await editRequestsCollection.createIndex({ editRequestId: 1 }, { unique: true });
}

/**
 * Clear all data from collections (use between tests)
 * @param {Db} database - MongoDB database instance
 */
async function clearCollections(database) {
  if (!database) return;

  const collections = Object.values(COLLECTIONS);
  for (const collectionName of collections) {
    try {
      await database.collection(collectionName).deleteMany({});
    } catch (err) {
      // Collection might not exist yet, ignore
    }
  }
}

module.exports = {
  connectToGlobalServer,
  disconnectFromGlobalServer,
  createCollections,
  clearCollections,
};
