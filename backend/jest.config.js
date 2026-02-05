module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  // Test path patterns for selective running
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__helpers__/',
    '/__fixtures__/',
  ],
  collectCoverageFrom: [
    'services/**/*.js',
    'utils/**/*.js',
    'middleware/**/*.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  verbose: true,
  testTimeout: 30000,
  // Module name mapper for cleaner imports
  moduleNameMapper: {
    '^@helpers/(.*)$': '<rootDir>/__tests__/__helpers__/$1',
    '^@fixtures/(.*)$': '<rootDir>/__tests__/__fixtures__/$1',
  },
  // Global setup/teardown for integration tests
  globalSetup: '<rootDir>/__tests__/__helpers__/globalSetup.js',
  globalTeardown: '<rootDir>/__tests__/__helpers__/globalTeardown.js',
  // Detect open handles (useful for debugging connection leaks)
  detectOpenHandles: true,
  // Force exit after tests complete (safety net)
  forceExit: true,
};
