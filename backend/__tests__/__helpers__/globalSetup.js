/**
 * Global Jest setup
 *
 * Runs once before all test suites.
 * Used for one-time initialization like starting mongodb-memory-server.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async () => {
  // Configure for Windows ARM64 compatibility - use x64 binary
  const isWindowsArm = process.platform === 'win32' && process.arch === 'arm64';

  const serverOptions = {
    instance: {
      port: 27018, // Use a fixed port to avoid conflicts
    },
  };

  // For Windows ARM64, force x64 architecture (runs via emulation)
  if (isWindowsArm) {
    serverOptions.binary = {
      version: '6.0.14',
      arch: 'x64',
      skipMD5: true,
    };
    console.log('\n[Global Setup] Detected Windows ARM64, using x64 MongoDB binary');
  }

  // Start a global MongoDB instance for all tests
  // This is more efficient than starting/stopping per test file
  const mongoServer = await MongoMemoryServer.create(serverOptions);

  // Store the URI in an environment variable for tests to access
  process.env.MONGODB_TEST_URI = mongoServer.getUri();

  // Store the server instance for cleanup
  global.__MONGO_SERVER__ = mongoServer;

  console.log('\n[Global Setup] MongoDB Memory Server started at:', mongoServer.getUri());
};
