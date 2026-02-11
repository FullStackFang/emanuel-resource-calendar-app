/**
 * User factory for creating test users with different roles
 *
 * Creates user objects and database entries for testing role-based access.
 */

const { ObjectId } = require('mongodb');
const { ROLES, TEST_EMAILS, COLLECTIONS } = require('./testConstants');

// Counter for generating unique IDs
let userIdCounter = 1;

/**
 * Generate a unique user ID
 * @returns {string} Unique user ID
 */
function generateUserId() {
  return `test-user-${userIdCounter++}-${Date.now()}`;
}

/**
 * Reset the user ID counter (call in beforeEach)
 */
function resetUserIdCounter() {
  userIdCounter = 1;
}

/**
 * Create a base user object
 * @param {Object} overrides - Properties to override
 * @returns {Object} User object
 */
function createBaseUser(overrides = {}) {
  const userId = overrides.userId || generateUserId();
  return {
    _id: new ObjectId(),
    odataId: userId,
    email: overrides.email || `${userId}@test.com`,
    displayName: overrides.displayName || `Test User ${userId}`,
    role: overrides.role || ROLES.VIEWER,
    department: overrides.department || null,
    createdAt: new Date(),
    lastLoginAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a viewer user (lowest permissions)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Viewer user object
 */
function createViewer(overrides = {}) {
  return createBaseUser({
    email: TEST_EMAILS.VIEWER,
    displayName: 'Test Viewer',
    role: ROLES.VIEWER,
    ...overrides,
  });
}

/**
 * Create a requester user (can submit reservations)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Requester user object
 */
function createRequester(overrides = {}) {
  return createBaseUser({
    email: TEST_EMAILS.REQUESTER,
    displayName: 'Test Requester',
    role: ROLES.REQUESTER,
    ...overrides,
  });
}

/**
 * Create another requester user (for cross-ownership tests)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Other requester user object
 */
function createOtherRequester(overrides = {}) {
  return createBaseUser({
    email: TEST_EMAILS.OTHER_REQUESTER,
    displayName: 'Other Requester',
    role: ROLES.REQUESTER,
    ...overrides,
  });
}

/**
 * Create an approver user (can approve/reject reservations)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Approver user object
 */
function createApprover(overrides = {}) {
  return createBaseUser({
    email: TEST_EMAILS.APPROVER,
    displayName: 'Test Approver',
    role: ROLES.APPROVER,
    ...overrides,
  });
}

/**
 * Create an admin user (full access)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Admin user object
 */
function createAdmin(overrides = {}) {
  return createBaseUser({
    email: TEST_EMAILS.ADMIN,
    displayName: 'Test Admin',
    role: ROLES.ADMIN,
    ...overrides,
  });
}

/**
 * Create a domain user (emanuelnyc.org domain, no special privileges)
 * Verifies that domain alone does NOT grant admin access
 * @param {Object} overrides - Properties to override
 * @returns {Object} Domain user object
 */
function createDomainUser(overrides = {}) {
  return createBaseUser({
    email: TEST_EMAILS.DOMAIN_ADMIN, // email key kept for backward compat in testConstants
    displayName: 'Domain Staff',
    role: 'viewer',
    ...overrides,
  });
}

/**
 * Create a security department user
 * @param {Object} overrides - Properties to override
 * @returns {Object} Security user object
 */
function createSecurityUser(overrides = {}) {
  return createBaseUser({
    email: 'security@emanuelnyc.org',
    displayName: 'Security Staff',
    role: ROLES.REQUESTER,
    department: 'security',
    ...overrides,
  });
}

/**
 * Create a maintenance department user
 * @param {Object} overrides - Properties to override
 * @returns {Object} Maintenance user object
 */
function createMaintenanceUser(overrides = {}) {
  return createBaseUser({
    email: 'maintenance@emanuelnyc.org',
    displayName: 'Maintenance Staff',
    role: ROLES.REQUESTER,
    department: 'maintenance',
    ...overrides,
  });
}

/**
 * Insert a user into the database
 * @param {Db} db - MongoDB database instance
 * @param {Object} user - User object to insert
 * @returns {Object} Inserted user with _id
 */
async function insertUser(db, user) {
  const result = await db.collection(COLLECTIONS.USERS).insertOne(user);
  return { ...user, _id: result.insertedId };
}

/**
 * Insert multiple users into the database
 * @param {Db} db - MongoDB database instance
 * @param {Array} users - Array of user objects
 * @returns {Array} Inserted users with _ids
 */
async function insertUsers(db, users) {
  const result = await db.collection(COLLECTIONS.USERS).insertMany(users);
  return users.map((user, index) => ({
    ...user,
    _id: result.insertedIds[index],
  }));
}

/**
 * Create and insert all standard test users
 * @param {Db} db - MongoDB database instance
 * @returns {Object} Object with all test users
 */
async function createAllTestUsers(db) {
  const viewer = createViewer();
  const requester = createRequester();
  const otherRequester = createOtherRequester();
  const approver = createApprover();
  const admin = createAdmin();
  const domainUser = createDomainUser();

  const users = await insertUsers(db, [
    viewer,
    requester,
    otherRequester,
    approver,
    admin,
    domainUser,
  ]);

  return {
    viewer: users[0],
    requester: users[1],
    otherRequester: users[2],
    approver: users[3],
    admin: users[4],
    domainUser: users[5],
  };
}

module.exports = {
  createBaseUser,
  createViewer,
  createRequester,
  createOtherRequester,
  createApprover,
  createAdmin,
  createDomainUser,
  createSecurityUser,
  createMaintenanceUser,
  insertUser,
  insertUsers,
  createAllTestUsers,
  generateUserId,
  resetUserIdCounter,
};
