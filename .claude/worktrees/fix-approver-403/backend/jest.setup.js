// Jest setup file for backend tests

const { MongoClient } = require('mongodb');

// Increase default timeout for async operations (especially MongoDB)
jest.setTimeout(30000);

// Suppress console output during tests unless explicitly needed
// Comment these out when debugging
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Global test database connection
let testDbClient = null;
let testDb = null;

/**
 * Get the shared test database connection
 * Creates a new connection if one doesn't exist
 */
global.getTestDb = async () => {
  if (!testDb) {
    const uri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27018/testdb';
    testDbClient = new MongoClient(uri);
    await testDbClient.connect();
    testDb = testDbClient.db('testdb');
  }
  return testDb;
};

/**
 * Get the test database client
 */
global.getTestDbClient = () => testDbClient;

// Note: graphApiService is NOT mocked globally to avoid interfering with unit tests
// Integration tests that need the mock should import graphApiMock directly
// and use the testApp which already uses the mock internally

// Clean up after all tests
afterAll(async () => {
  // Close the test database connection
  if (testDbClient) {
    await testDbClient.close();
    testDbClient = null;
    testDb = null;
  }

  // Allow time for any async cleanup
  await new Promise(resolve => setTimeout(resolve, 100));
});
