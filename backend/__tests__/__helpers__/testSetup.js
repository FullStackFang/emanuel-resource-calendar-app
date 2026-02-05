/**
 * Test database setup using mongodb-memory-server
 *
 * Provides lifecycle management for test databases:
 * - setupTestDatabase(): Start in-memory MongoDB, create collections
 * - teardownTestDatabase(): Cleanup
 * - clearCollections(): Reset data between tests
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { COLLECTIONS } = require('./testConstants');

let mongoServer;
let mongoClient;
let db;

/**
 * Get MongoDB Memory Server options for the current platform
 * @returns {Object} Server options
 */
function getServerOptions() {
  const options = {};

  // For Windows ARM64, force x64 architecture (runs via emulation)
  const isWindowsArm = process.platform === 'win32' && process.arch === 'arm64';
  if (isWindowsArm) {
    options.binary = {
      version: '6.0.14',
      arch: 'x64',
      skipMD5: true,
    };
  }

  return options;
}

/**
 * Start the in-memory MongoDB server and create required collections
 * @returns {Object} { db, client } - Database and client references
 */
async function setupTestDatabase() {
  mongoServer = await MongoMemoryServer.create(getServerOptions());
  const uri = mongoServer.getUri();

  mongoClient = new MongoClient(uri);
  await mongoClient.connect();
  db = mongoClient.db('testdb');

  // Create all required collections with indexes
  await createCollections(db);

  return { db, client: mongoClient };
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

  // Create indexes for events collection
  const eventsCollection = database.collection(COLLECTIONS.EVENTS);
  await eventsCollection.createIndex({ eventId: 1 });
  await eventsCollection.createIndex({ userId: 1 });
  await eventsCollection.createIndex({ status: 1 });
  await eventsCollection.createIndex({ calendarOwner: 1 });
  await eventsCollection.createIndex({ startDateTime: 1, endDateTime: 1 });
  await eventsCollection.createIndex({ isDeleted: 1 });
  await eventsCollection.createIndex({ 'roomReservationData.requesterEmail': 1 });

  // Create indexes for users collection
  const usersCollection = database.collection(COLLECTIONS.USERS);
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await usersCollection.createIndex({ odataId: 1 });

  // Create indexes for audit history
  const auditCollection = database.collection(COLLECTIONS.AUDIT_HISTORY);
  await auditCollection.createIndex({ eventId: 1 });
  await auditCollection.createIndex({ action: 1 });
  await auditCollection.createIndex({ timestamp: -1 });
}

/**
 * Clear all data from collections (use between tests)
 */
async function clearCollections() {
  if (!db) return;

  const collections = Object.values(COLLECTIONS);
  for (const collectionName of collections) {
    try {
      await db.collection(collectionName).deleteMany({});
    } catch (err) {
      // Collection might not exist yet, ignore
    }
  }
}

/**
 * Teardown the test database
 */
async function teardownTestDatabase() {
  if (mongoClient) {
    await mongoClient.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}

/**
 * Get the current database instance
 * @returns {Db} MongoDB database instance
 */
function getDb() {
  return db;
}

/**
 * Get the current client instance
 * @returns {MongoClient} MongoDB client instance
 */
function getClient() {
  return mongoClient;
}

/**
 * Get the MongoDB URI for the test server
 * @returns {string} MongoDB connection URI
 */
function getUri() {
  return mongoServer?.getUri();
}

module.exports = {
  setupTestDatabase,
  teardownTestDatabase,
  clearCollections,
  getDb,
  getClient,
  getUri,
  getServerOptions,
};
