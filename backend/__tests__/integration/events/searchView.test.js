/**
 * Search View Tests (SV-1 to SV-11)
 *
 * Tests for the ungated 'search' view on GET /api/events/list.
 * All authenticated users (viewer, requester, approver, admin)
 * should be able to search published events.
 *
 * SV-9 to SV-11 verify that both startDate and endDate are required.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createViewer,
  createRequester,
  createApprover,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

// Fixed date range used by role-access and filter tests.
// Events in those tests are explicitly assigned dates within this range.
const FIXED_START = '2026-06-01';
const FIXED_END   = '2026-06-30';
const FIXED_DT    = '2026-06-15T10:00:00';

describe('Search View Tests (SV-1 to SV-11)', () => {
  let mongoClient;
  let db;
  let app;
  let viewerUser, requesterUser, approverUser, adminUser;
  let viewerToken, requesterToken, approverToken, adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('searchView'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    viewerUser = createViewer();
    requesterUser = createRequester();
    approverUser = createApprover();
    adminUser = createAdmin();
    await insertUsers(db, [viewerUser, requesterUser, approverUser, adminUser]);

    viewerToken = await createMockToken(viewerUser);
    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  // SV-1: Viewer can access search view
  it('SV-1: viewer can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-2: Requester can access search view
  it('SV-2: requester can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-3: Approver can access search view
  it('SV-3: approver can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-4: Admin can access search view
  it('SV-4: admin can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-5: Search view only returns published non-deleted events
  it('SV-5: search view only returns published non-deleted events', async () => {
    const published1 = createPublishedEvent({ eventTitle: 'Published Meeting' });
    const published2 = createPublishedEvent({ eventTitle: 'Published Gathering' });
    const pending = createPendingEvent({ eventTitle: 'Pending Meeting' });
    const draft = createPendingEvent({ eventTitle: 'Draft Event' });
    draft.status = 'draft';
    const rejected = createPendingEvent({ eventTitle: 'Rejected Event' });
    rejected.status = 'rejected';
    const deleted = createPublishedEvent({ eventTitle: 'Deleted Event' });
    deleted.status = 'deleted';
    deleted.isDeleted = true;

    // Pin all events to FIXED_DT so they fall within the required date range
    for (const ev of [published1, published2, pending, draft, rejected, deleted]) {
      ev.calendarData.startDateTime = FIXED_DT;
      ev.calendarData.endDateTime   = '2026-06-15T11:00:00';
    }

    await insertEvents(db, [published1, published2, pending, draft, rejected, deleted]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('Published Meeting');
    expect(titles).toContain('Published Gathering');
    expect(titles).not.toContain('Pending Meeting');
    expect(titles).not.toContain('Draft Event');
    expect(titles).not.toContain('Rejected Event');
    expect(titles).not.toContain('Deleted Event');
  });

  // SV-6: Search view supports text search filter
  it('SV-6: search view supports text search filter', async () => {
    const event1 = createPublishedEvent({ eventTitle: 'Board Meeting' });
    const event2 = createPublishedEvent({ eventTitle: 'Youth Shabbat' });

    // Pin events to FIXED_DT so they fall within the required date range
    event1.calendarData.startDateTime = FIXED_DT;
    event1.calendarData.endDateTime   = '2026-06-15T11:00:00';
    event2.calendarData.startDateTime = FIXED_DT;
    event2.calendarData.endDateTime   = '2026-06-15T11:00:00';

    await insertEvents(db, [event1, event2]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&search=Board&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('Board Meeting');
    expect(titles).not.toContain('Youth Shabbat');
  });

  // SV-7: Search view supports date range filter (unchanged — already uses explicit dates)
  it('SV-7: search view supports date range filter', async () => {
    const inRange = createPublishedEvent({ eventTitle: 'March Event' });
    inRange.calendarData.startDateTime = '2026-03-15T10:00:00';
    inRange.calendarData.endDateTime = '2026-03-15T11:00:00';

    const outOfRange = createPublishedEvent({ eventTitle: 'January Event' });
    outOfRange.calendarData.startDateTime = '2026-01-05T10:00:00';
    outOfRange.calendarData.endDateTime = '2026-01-05T11:00:00';

    await insertEvents(db, [inRange, outOfRange]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-03-01&endDate=2026-03-31`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('March Event');
    expect(titles).not.toContain('January Event');
  });

  // SV-8: admin-browse remains admin-gated (regression check)
  it('SV-8: admin-browse still requires admin role', async () => {
    const viewerRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewerRes.status).toBe(403);

    const requesterRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${requesterToken}`);
    expect(requesterRes.status).toBe(403);

    const approverRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(approverRes.status).toBe(403);

    // Admin should still work
    const adminRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
  });

  // SV-9: search view requires startDate — missing startDate returns 400
  it('SV-9: search view returns 400 when startDate is missing', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/startDate and endDate are required/i);
  });

  // SV-10: search view requires endDate — missing endDate returns 400
  it('SV-10: search view returns 400 when endDate is missing', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/startDate and endDate are required/i);
  });

  // SV-11: search view requires both dates — missing both returns 400
  it('SV-11: search view returns 400 when both dates are missing', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/startDate and endDate are required/i);
  });
});
