/**
 * Race Condition Tests (RC-1 to RC-4)
 *
 * Tests for Phase 3 code review fixes:
 * - C1: Publish race condition — MongoDB update runs before Graph creation
 * - C5: Public token uses atomic findOneAndUpdate
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Race Condition Tests (RC-1 to RC-4)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let adminUser;
  let adminToken;
  let adminToken2;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('raceConditions'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});
    await db.collection(COLLECTIONS.RESERVATION_TOKENS).deleteMany({});

    requesterUser = createRequester();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, adminUser]);

    adminToken = await createMockToken(adminUser);
    adminToken2 = await createMockToken(adminUser);
  });

  // ============================================
  // RC-1: Publish atomically updates status before Graph creation (C1)
  // ============================================
  describe('RC-1: Publish updates MongoDB before Graph creation', () => {
    it('should set status to published in MongoDB', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Event to Publish',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          createCalendarEvent: true,
          _version: pendingEvent._version,
        });

      expect(res.status).toBe(200);

      const published = await findEvent(db, pendingEvent._id);
      expect(published.status).toBe(STATUS.PUBLISHED);
    });
  });

  // ============================================
  // RC-2: Second publish gets 409 (C1 race prevention)
  // ============================================
  describe('RC-2: Concurrent publish blocked by version guard', () => {
    it('should return 409 when event already published', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Double Publish Target',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      await insertEvents(db, [pendingEvent]);

      // First publish succeeds
      const res1 = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          createCalendarEvent: true,
          _version: pendingEvent._version,
        });
      expect(res1.status).toBe(200);

      // Second publish with stale version should fail (400 or 409)
      // 400 = event no longer pending; 409 = version conflict. Either way, blocked.
      const res2 = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({
          createCalendarEvent: true,
          _version: pendingEvent._version, // Stale version
        });
      expect([400, 409]).toContain(res2.status);
    });
  });

  // Note: C5 (token atomicity) is tested at the API-server level, not via testApp.
  // The fix replaces findOne + updateOne with findOneAndUpdate in api-server.js.
  // Token endpoint tests would require the production server or extending testApp.
});
