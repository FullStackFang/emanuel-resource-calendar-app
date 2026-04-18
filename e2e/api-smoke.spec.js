import { test, expect } from '@playwright/test';

/**
 * API smoke tests — verify core endpoints work against the real server.
 * Uses TEST_AUTH_BYPASS with X-Test-User-Email + X-Test-User-Role headers.
 */

const adminHeaders = {
  'x-test-user-email': 'e2e-admin@test.com',
  'x-test-user-role': 'admin',
};

const requesterHeaders = {
  'x-test-user-email': 'e2e-requester@test.com',
  'x-test-user-role': 'requester',
};

test.describe('API Smoke Tests', () => {

  test('admin gets admin permissions', async ({ request }) => {
    const res = await request.get('/api/users/me/permissions', {
      headers: adminHeaders,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.role).toBe('admin');
    expect(body.isAdmin).toBe(true);
  });

  test('requester gets requester permissions', async ({ request }) => {
    const res = await request.get('/api/users/me/permissions', {
      headers: requesterHeaders,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.role).toBe('requester');
    expect(body.isAdmin).toBe(false);
  });

  test('admin can list events', async ({ request }) => {
    const res = await request.get('/api/events/list?view=admin-browse', {
      headers: adminHeaders,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBeTruthy();
  });

  test('requester cannot access admin-browse', async ({ request }) => {
    const res = await request.get('/api/events/list?view=admin-browse', {
      headers: requesterHeaders,
    });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated request returns 401', async ({ request }) => {
    const res = await request.get('/api/users/me/permissions', {
      headers: { 'x-test-user-email': '' },
    });
    expect(res.status()).toBe(401);
  });

});
