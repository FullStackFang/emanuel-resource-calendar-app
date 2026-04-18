/**
 * Series Master By EventId Tests (SM-1 to SM-4)
 *
 * Tests for GET /api/events/master/:masterEventId
 * Used by the frontend scope dialog when the series master is outside the
 * current view window and must be fetched by its Graph eventId.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createApprover,
  createAdmin,
  createRequester,
} = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Series Master By EventId Tests (SM-1 to SM-4)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, adminToken;
  let approverUser, approverToken;
  let requesterUser, requesterToken;
  let otherRequesterUser, otherRequesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('seriesMasterById'));
    app = await setupTestApp(db);
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
      userId: 'other-requester-sm-001',
      email: 'other-sm@emanuelnyc.org',
      displayName: 'Other User SM',
    });

    await db.collection(COLLECTIONS.USERS).insertMany([
      adminUser, approverUser, requesterUser, otherRequesterUser,
    ]);

    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
  });

  it('SM-1: admin can fetch series master by masterEventId', async () => {
    const master = createRecurringSeriesMaster({
      roomReservationData: {
        requestedBy: { email: requesterUser.email, userId: requesterUser.userId, name: requesterUser.displayName },
      },
    });
    await insertEvents(db, [master]);

    const res = await request(app)
      .get(`/api/events/master/${master.eventId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.eventId).toBe(master.eventId);
    expect(res.body.eventType).toBe('seriesMaster');
    expect(res.body.recurrence).toBeDefined();
  });

  it('SM-2: approver can fetch series master by masterEventId', async () => {
    const master = createRecurringSeriesMaster({
      roomReservationData: {
        requestedBy: { email: requesterUser.email, userId: requesterUser.userId, name: requesterUser.displayName },
      },
    });
    await insertEvents(db, [master]);

    const res = await request(app)
      .get(`/api/events/master/${master.eventId}`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.eventType).toBe('seriesMaster');
  });

  it('SM-3: requester can fetch their own series master', async () => {
    const master = createRecurringSeriesMaster({
      roomReservationData: {
        requestedBy: { email: requesterUser.email, userId: requesterUser.userId, name: requesterUser.displayName },
      },
    });
    await insertEvents(db, [master]);

    const res = await request(app)
      .get(`/api/events/master/${master.eventId}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.eventType).toBe('seriesMaster');
  });

  it('SM-4: returns 404 when no seriesMaster exists for the given eventId', async () => {
    // Insert a non-master event with a known eventId to confirm the eventType
    // filter is working — this must NOT be returned.
    const nonMaster = createPendingEvent({ eventId: 'non-master-event-id' });
    await insertEvents(db, [nonMaster]);

    const res = await request(app)
      .get('/api/events/master/non-master-event-id')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Series master not found');
  });
});
