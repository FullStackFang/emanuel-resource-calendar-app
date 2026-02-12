/**
 * My Events View Tests (ME-1 to ME-8)
 *
 * Tests that the my-events view (GET /api/events/list?view=my-events) only
 * returns events belonging to the logged-in user, regardless of role.
 *
 * ME-1: Admin's my-events returns only admin's own drafts
 * ME-2: Approver's my-events returns only approver's own drafts
 * ME-3: Requester sees only their own drafts
 * ME-4: Admin's my-events returns only their own pending events
 * ME-5: Admin draft count only counts their own
 * ME-6: Admin deleted count only counts their own
 * ME-7: Requester draft count only counts their own
 * ME-8: Calendar view still shows only own drafts (regression for DL-2)
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createApprover,
  createRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createDeletedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS, TEST_EMAILS } = require('../../__helpers__/testConstants');

describe('My Events View Tests', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;

  // Users
  let adminUser, approverUser, requesterUser;
  let adminToken, approverToken, requesterToken;

  beforeAll(async () => {
    await initTestKeys();

    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    await db.createCollection(COLLECTIONS.USERS);
    await db.createCollection(COLLECTIONS.EVENTS);
    await db.createCollection(COLLECTIONS.LOCATIONS);
    await db.createCollection(COLLECTIONS.AUDIT_HISTORY);

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    if (mongoClient) await mongoClient.close();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    // Create users
    adminUser = createAdmin();
    approverUser = createApprover();
    requesterUser = createRequester();

    await insertUsers(db, [adminUser, approverUser, requesterUser]);

    // Create tokens
    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  /**
   * Helper to create a draft event owned by a specific user with calendarData.requesterEmail set
   */
  function createOwnedDraft(user, overrides = {}) {
    return createDraftEvent({
      userId: user.odataId,
      requesterEmail: user.email,
      createdBy: user.odataId,
      createdByEmail: user.email,
      eventTitle: overrides.eventTitle || `Draft by ${user.displayName}`,
      calendarData: {
        eventTitle: overrides.eventTitle || `Draft by ${user.displayName}`,
        requesterEmail: user.email,
        startDateTime: '2026-03-01T10:00:00',
        endDateTime: '2026-03-01T11:00:00',
        locations: [],
      },
      roomReservationData: {
        requesterName: user.displayName,
        requesterEmail: user.email,
        department: 'General',
        phone: '555-0000',
        attendees: 10,
      },
      ...overrides,
    });
  }

  /**
   * Helper to create a pending event owned by a specific user
   */
  function createOwnedPending(user, overrides = {}) {
    return createPendingEvent({
      userId: user.odataId,
      requesterEmail: user.email,
      createdBy: user.odataId,
      createdByEmail: user.email,
      eventTitle: overrides.eventTitle || `Pending by ${user.displayName}`,
      calendarData: {
        eventTitle: overrides.eventTitle || `Pending by ${user.displayName}`,
        requesterEmail: user.email,
        startDateTime: '2026-03-01T12:00:00',
        endDateTime: '2026-03-01T13:00:00',
        locations: [],
      },
      roomReservationData: {
        requesterName: user.displayName,
        requesterEmail: user.email,
        department: 'General',
        phone: '555-0000',
        attendees: 10,
      },
      ...overrides,
    });
  }

  /**
   * Helper to create a deleted event owned by a specific user
   */
  function createOwnedDeleted(user, overrides = {}) {
    return createDeletedEvent({
      userId: user.odataId,
      requesterEmail: user.email,
      createdBy: user.odataId,
      createdByEmail: user.email,
      eventTitle: overrides.eventTitle || `Deleted by ${user.displayName}`,
      calendarData: {
        eventTitle: overrides.eventTitle || `Deleted by ${user.displayName}`,
        requesterEmail: user.email,
        startDateTime: '2026-03-01T14:00:00',
        endDateTime: '2026-03-01T15:00:00',
        locations: [],
      },
      roomReservationData: {
        requesterName: user.displayName,
        requesterEmail: user.email,
        department: 'General',
        phone: '555-0000',
        attendees: 10,
      },
      ...overrides,
    });
  }

  // ── ME-1: Admin's my-events returns only admin's own drafts ──

  test('ME-1: Admin my-events returns only admin own drafts, not other users drafts', async () => {
    const adminDraft = createOwnedDraft(adminUser, { eventTitle: 'Admin Draft' });
    const requesterDraft = createOwnedDraft(requesterUser, { eventTitle: 'Requester Draft' });
    const approverDraft = createOwnedDraft(approverUser, { eventTitle: 'Approver Draft' });

    await insertEvents(db, [adminDraft, requesterDraft, approverDraft]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'my-events', status: 'draft' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventTitle).toBe('Admin Draft');
  });

  // ── ME-2: Approver's my-events returns only approver's own drafts ──

  test('ME-2: Approver my-events returns only approver own drafts', async () => {
    const adminDraft = createOwnedDraft(adminUser, { eventTitle: 'Admin Draft' });
    const requesterDraft = createOwnedDraft(requesterUser, { eventTitle: 'Requester Draft' });
    const approverDraft = createOwnedDraft(approverUser, { eventTitle: 'Approver Draft' });

    await insertEvents(db, [adminDraft, requesterDraft, approverDraft]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'my-events', status: 'draft' })
      .set('Authorization', `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventTitle).toBe('Approver Draft');
  });

  // ── ME-3: Requester sees only their own drafts ──

  test('ME-3: Requester my-events returns only requester own drafts', async () => {
    const adminDraft = createOwnedDraft(adminUser, { eventTitle: 'Admin Draft' });
    const requesterDraft = createOwnedDraft(requesterUser, { eventTitle: 'Requester Draft' });
    const approverDraft = createOwnedDraft(approverUser, { eventTitle: 'Approver Draft' });

    await insertEvents(db, [adminDraft, requesterDraft, approverDraft]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'my-events', status: 'draft' })
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventTitle).toBe('Requester Draft');
  });

  // ── ME-4: Admin's my-events returns only their own pending events ──

  test('ME-4: Admin my-events returns only admin own pending events', async () => {
    const adminPending = createOwnedPending(adminUser, { eventTitle: 'Admin Pending' });
    const requesterPending = createOwnedPending(requesterUser, { eventTitle: 'Requester Pending' });

    await insertEvents(db, [adminPending, requesterPending]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'my-events', status: 'pending' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventTitle).toBe('Admin Pending');
  });

  // ── ME-5: Admin draft count only counts their own ──

  test('ME-5: Admin draft count only counts admin own drafts', async () => {
    const adminDraft = createOwnedDraft(adminUser, { eventTitle: 'Admin Draft' });
    const requesterDraft = createOwnedDraft(requesterUser, { eventTitle: 'Requester Draft' });
    const approverDraft = createOwnedDraft(approverUser, { eventTitle: 'Approver Draft' });

    await insertEvents(db, [adminDraft, requesterDraft, approverDraft]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS_COUNTS)
      .query({ view: 'my-events' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.draft).toBe(1);
  });

  // ── ME-6: Admin deleted count only counts their own ──

  test('ME-6: Admin deleted count only counts admin own deleted events', async () => {
    const adminDeleted = createOwnedDeleted(adminUser, { eventTitle: 'Admin Deleted' });
    const requesterDeleted = createOwnedDeleted(requesterUser, { eventTitle: 'Requester Deleted' });

    await insertEvents(db, [adminDeleted, requesterDeleted]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS_COUNTS)
      .query({ view: 'my-events' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
  });

  // ── ME-7: Requester draft count only counts their own ──

  test('ME-7: Requester draft count only counts requester own drafts', async () => {
    const adminDraft = createOwnedDraft(adminUser, { eventTitle: 'Admin Draft' });
    const requesterDraft = createOwnedDraft(requesterUser, { eventTitle: 'Requester Draft' });
    const approverDraft = createOwnedDraft(approverUser, { eventTitle: 'Approver Draft' });

    await insertEvents(db, [adminDraft, requesterDraft, approverDraft]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS_COUNTS)
      .query({ view: 'my-events' })
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.draft).toBe(1);
  });

  // ── ME-8: Calendar view still shows only own drafts (regression for DL-2) ──

  test('ME-8: Calendar view shows only own drafts for admin (regression DL-2)', async () => {
    const adminDraft = createOwnedDraft(adminUser, { eventTitle: 'Admin Calendar Draft' });
    const requesterDraft = createOwnedDraft(requesterUser, { eventTitle: 'Requester Calendar Draft' });

    await insertEvents(db, [adminDraft, requesterDraft]);

    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        startDate: '2026-02-01T00:00:00',
        endDate: '2026-04-01T00:00:00',
      });

    expect(res.status).toBe(200);
    // Admin should see only their own draft on the calendar
    const draftEvents = res.body.events.filter(e => e.status === 'draft');
    expect(draftEvents).toHaveLength(1);
    expect(draftEvents[0].calendarData.requesterEmail).toBe(TEST_EMAILS.ADMIN);
  });
});
