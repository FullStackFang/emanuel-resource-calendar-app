/**
 * Global Jest teardown
 *
 * Runs once after all test suites complete.
 * Used for cleanup of global resources.
 */

module.exports = async () => {
  // Stop the global MongoDB instance
  if (global.__MONGO_SERVER__) {
    await global.__MONGO_SERVER__.stop();
    console.log('\n[Global Teardown] MongoDB Memory Server stopped');
  }
};
