/**
 * Event By ID Tests (EB-1 to EB-6)
 *
 * Tests for GET /api/events/:id — single event fetch for email deep-linking.
 * Verifies role-based visibility: admin/approver see all, requester sees own + published.
 */

const request = require('supertest');

const {
  createTestApp,
  setTestDatabase,
} = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createApprover,
  createAdmin,
  createRequester,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Event By ID Tests (EB-1 to EB-6)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, adminToken;
  let approverUser, approverToken;
  let requesterUser, requesterToken;
  let otherRequesterUser, otherRequesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('eventById'));
    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    adminUser = createAdmin();
    approverUser = createApprover();
    requesterUser = createRequester();
    otherRequesterUser = createRequester({
      userId: 'other-requester-001',
      email: 'other@emanuelnyc.org',
      displayName: 'Other User',
    });

    await db.collection(COLLECTIONS.USERS).insertMany([
      adminUser, approverUser, requesterUser, otherRequesterUser,
    ]);

    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
  });

  it('EB-1: admin can fetch any event by ID', async () => {
    const event = createPendingEvent({
      roomReservationData: {
        requestedBy: { email: requesterUser.email, userId: requesterUser.userId, name: requesterUser.displayName },
      },
    });
    await insertEvents(db, [event]);

    const res = await request(app)
      .get(`/api/events/${event._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.event).toBeDefined();
    expect(String(res.body.event._id)).toBe(String(event._id));
  });

  it('EB-2: approver can fetch any event by ID', async () => {
    const event = createPendingEvent({
      roomReservationData: {
        requestedBy: { email: requesterUser.email, userId: requesterUser.userId, name: requesterUser.displayName },
      },
    });
    await insertEvents(db, [event]);

    const res = await request(app)
      .get(`/api/events/${event._id}`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.event).toBeDefined();
  });

  it('EB-3: requester can fetch own event', async () => {
    const event = createPendingEvent({
      roomReservationData: {
        requestedBy: { email: requesterUser.email, userId: requesterUser.userId, name: requesterUser.displayName },
      },
    });
    await insertEvents(db, [event]);

    const res = await request(app)
      .get(`/api/events/${event._id}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.event).toBeDefined();
  });

  it('EB-4: requester can fetch published event (not their own)', async () => {
    const event = createPublishedEvent({
      roomReservationData: {
        requestedBy: { email: 'someone-else@emanuelnyc.org', userId: 'someone-else-001', name: 'Someone Else' },
      },
    });
    await insertEvents(db, [event]);

    const res = await request(app)
      .get(`/api/events/${event._id}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.event).toBeDefined();
  });

  it('EB-5: requester cannot fetch other user\'s non-published event', async () => {
    const event = createPendingEvent({
      roomReservationData: {
        requestedBy: { email: 'someone-else@emanuelnyc.org', userId: 'someone-else-001', name: 'Someone Else' },
      },
    });
    await insertEvents(db, [event]);

    const res = await request(app)
      .get(`/api/events/${event._id}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access denied');
  });

  it('EB-6: returns 404 for non-existent event ID', async () => {
    const res = await request(app)
      .get('/api/events/507f1f77bcf86cd799439099')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Event not found');
  });
});
