// Jest setup file for backend tests

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

// Clean up after all tests
afterAll(async () => {
  // Allow time for any async cleanup
  await new Promise(resolve => setTimeout(resolve, 100));
});
