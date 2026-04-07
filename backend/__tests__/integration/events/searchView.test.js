/**
 * Search View Tests (SV-1 to SV-8)
 *
 * Tests for the ungated 'search' view on GET /api/events/list.
 * All authenticated users (viewer, requester, approver, admin)
 * should be able to search published events.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
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

describe('Search View Tests (SV-1 to SV-8)', () => {
  let mongoClient;
  let db;
  let app;
  let viewerUser, requesterUser, approverUser, adminUser;
  let viewerToken, requesterToken, approverToken, adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('searchView'));
    setTestDatabase(db);
    app = createTestApp();
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
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-2: Requester can access search view
  it('SV-2: requester can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-3: Approver can access search view
  it('SV-3: approver can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-4: Admin can access search view
  it('SV-4: admin can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search`)
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

    await insertEvents(db, [published1, published2, pending, draft, rejected, deleted]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search`)
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
    await insertEvents(db, [event1, event2]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&search=Board`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('Board Meeting');
    expect(titles).not.toContain('Youth Shabbat');
  });

  // SV-7: Search view supports date range filter
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
});
