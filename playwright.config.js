import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: {
      'x-test-user-email': 'admin@emanuelnyc.org',
    },
  },

  // Start backend before tests, stop after
  webServer: {
    command: 'cd backend && TEST_AUTH_BYPASS=true node api-server.js',
    port: 3001,
    reuseExistingServer: true,
    timeout: 60000,
    env: {
      TEST_AUTH_BYPASS: 'true',
    },
  },
});
