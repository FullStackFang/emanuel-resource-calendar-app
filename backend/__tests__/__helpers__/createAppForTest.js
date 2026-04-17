'use strict';

/**
 * Test harness that uses the REAL api-server.js Express app.
 *
 * Replaces testApp.js (5,979 lines) with ~30 lines by injecting:
 *   - Test MongoDB database via setDatabase()
 *   - Test auth middleware via setTestAuthMiddleware()
 *   - Graph API mock via jest.mock()
 *
 * Usage in test files:
 *   const { setupTestApp } = require('../../__helpers__/createAppForTest');
 *   let app;
 *   beforeAll(async () => { app = await setupTestApp(db); });
 */

const { app, setDatabase, setTestAuthMiddleware, setGraphApiService } = require('../../api-server');
const { createTestAuthMiddleware } = require('./testAuthMiddleware');
const graphApiMock = require('./graphApiMock');

/**
 * Configure the real Express app for testing.
 * Call once per test suite in beforeAll().
 *
 * @param {import('mongodb').Db} db - MongoDB Memory Server database
 * @returns {Express.Application} The configured app (same instance, re-injected)
 */
async function setupTestApp(db) {
  setDatabase(db);
  setTestAuthMiddleware(createTestAuthMiddleware());
  setGraphApiService(graphApiMock);
  graphApiMock.resetMocks();
  return app;
}

module.exports = { setupTestApp, app };
