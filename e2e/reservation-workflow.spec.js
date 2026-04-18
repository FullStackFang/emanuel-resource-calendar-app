import { test, expect } from '@playwright/test';

/**
 * Reservation workflow E2E — tests the full lifecycle:
 * draft -> submit -> publish (admin auto-publish)
 * draft -> submit -> reject
 */

const adminHeaders = {
  'x-test-user-email': 'e2e-admin@test.com',
  'x-test-user-role': 'admin',
};

const requesterHeaders = {
  'x-test-user-email': 'e2e-requester@test.com',
  'x-test-user-role': 'requester',
};

const approverHeaders = {
  'x-test-user-email': 'e2e-approver@test.com',
  'x-test-user-role': 'approver',
};

let testLocationId;
// Use unique dates per run to avoid conflicts with previous test data
const runId = Date.now().toString().slice(-4);
const month = `2027-${String(parseInt(runId.slice(0,2)) % 12 + 1).padStart(2, '0')}`;

test.beforeAll(async ({ request }) => {
  // Create a test location for room reservations
  const res = await request.post('/api/admin/locations', {
    headers: adminHeaders,
    data: {
      name: 'E2E Test Room',
      displayName: 'E2E Test Room',
      isReservable: true,
      capacity: 50,
    },
  });
  if (res.ok()) {
    const body = await res.json();
    testLocationId = body._id;
  }
  if (!testLocationId) {
    const listRes = await request.get('/api/admin/locations', { headers: adminHeaders });
    if (listRes.ok()) {
      const locations = await listRes.json();
      const reservable = (Array.isArray(locations) ? locations : locations.locations || [])
        .find(l => l.isReservable);
      if (reservable) testLocationId = reservable._id;
    }
  }
});

/** Helper: create + return a draft with all required submit fields */
async function createDraft(request, headers, overrides = {}) {
  const res = await request.post('/api/room-reservations/draft', {
    headers,
    data: {
      eventTitle: 'E2E Test Event',
      startDate: `${month}-15`,
      endDate: `${month}-15`,
      startTime: '10:00',
      endTime: '11:00',
      reservationStartTime: '09:30',
      reservationEndTime: '11:30',
      categories: ['General'],
      attendeeCount: 10,
      requestedRooms: testLocationId ? [testLocationId] : [],
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  return await res.json();
}

/** Helper: create draft + submit it, return submitted event */
async function createAndSubmit(request, headers, overrides = {}) {
  const draft = await createDraft(request, headers, overrides);
  const submitRes = await request.post(`/api/room-reservations/draft/${draft._id}/submit`, {
    headers,
  });
  expect(submitRes.ok()).toBeTruthy();
  return { draft, submitted: await submitRes.json() };
}

test.describe('Reservation Workflow', () => {

  test('requester creates a draft', async ({ request }) => {
    const draft = await createDraft(request, requesterHeaders, {
      eventTitle: 'E2E Draft Test',
    });
    expect(draft.status).toBe('draft');
    expect(draft.calendarData.eventTitle).toBe('E2E Draft Test');
  });

  test('requester submits draft -> pending', async ({ request }) => {
    const { submitted } = await createAndSubmit(request, requesterHeaders, {
      eventTitle: 'E2E Submit Test',
      startDate: `${month}-02`,
      endDate: `${month}-02`,
    });
    // Real server returns event directly (not wrapped in { event: ... })
    expect(submitted.status || submitted.event?.status).toBe('pending');
  });

  test('admin submits draft -> auto-published', async ({ request }) => {
    const draft = await createDraft(request, adminHeaders, {
      eventTitle: 'E2E Auto-Publish',
      startDate: `${month}-03`,
      endDate: `${month}-03`,
    });
    const submitRes = await request.post(`/api/room-reservations/draft/${draft._id}/submit`, {
      headers: adminHeaders,
    });
    const result = await submitRes.json();
    console.log('auto-publish status:', submitRes.status(), JSON.stringify(result).slice(0, 500));
    expect(submitRes.ok()).toBeTruthy();
    const status = result.status || result.event?.status;
    expect(status).toBe('published');
  });

  test('approver publishes pending event', async ({ request }) => {
    const { draft } = await createAndSubmit(request, requesterHeaders, {
      eventTitle: 'E2E Approve Test',
      startDate: `${month}-04`,
      endDate: `${month}-04`,
    });

    const publishRes = await request.put(`/api/admin/events/${draft._id}/publish`, {
      headers: approverHeaders,
      data: { _version: null },
    });
    expect(publishRes.ok()).toBeTruthy();
    const result = await publishRes.json();
    expect(result.success).toBe(true);
  });

  test('approver rejects pending event', async ({ request }) => {
    const { draft } = await createAndSubmit(request, requesterHeaders, {
      eventTitle: 'E2E Reject Test',
      startDate: `${month}-05`,
      endDate: `${month}-05`,
    });

    const rejectRes = await request.put(`/api/admin/events/${draft._id}/reject`, {
      headers: approverHeaders,
      data: { reason: 'Room not available', _version: null },
    });
    const rejectBody = await rejectRes.json();
    console.log('reject status:', rejectRes.status(), JSON.stringify(rejectBody).slice(0, 300));
    expect(rejectRes.ok()).toBeTruthy();
  });

});
