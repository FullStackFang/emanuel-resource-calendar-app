/**
 * Event Update Tests - Graph Sync Gate
 *
 * Tests the PUT /api/admin/events/:id endpoint, focusing on
 * Graph API sync behavior with and without graphToken.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createApprovedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Event Update Tests - Graph Sync Gate', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let requesterUser;

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
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
  });

  describe('Graph sync with calendarOwner (app-only auth)', () => {
    it('should sync to Graph when calendarOwner exists, even without graphToken', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Title',
          // No graphToken in body
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.graphSynced).toBe(true);

      // Verify Graph API was called
      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].calendarOwner).toBe(TEST_CALENDAR_OWNER);
      expect(graphCalls[0].eventData.subject).toBe('Updated Title');

      // Verify MongoDB was updated
      expect(res.body.event.eventTitle).toBe('Updated Title');
    });

    it('should sync to Graph when calendarOwner exists and graphToken also provided', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated With Both',
          graphToken: 'some-user-token',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.graphSynced).toBe(true);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
    });

    it('should NOT sync to Graph when neither calendarOwner nor graphToken exists', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        calendarOwner: null, // No calendarOwner
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Without Auth',
          // No graphToken
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.graphSynced).toBe(false);

      // Verify Graph API was NOT called
      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(0);

      // But MongoDB should still be updated
      expect(res.body.event.eventTitle).toBe('Updated Without Auth');
    });

    it('should sync to Graph for personal calendar events with graphToken', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Personal Event',
        calendarOwner: null, // Personal calendar - no calendarOwner
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Personal Event',
          graphToken: 'user-delegated-token',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.graphSynced).toBe(true);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
    });
  });

  describe('Graph sync skipped for non-Graph events', () => {
    it('should NOT sync when event has no iCalUId', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'No Graph Data Event',
        calendarOwner: TEST_CALENDAR_OWNER,
        graphData: null, // No graphData means no iCalUId
      });
      const [saved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated No Graph',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.graphSynced).toBe(false);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(0);
    });

    it('should NOT sync when no Graph-syncable fields changed', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          setupTime: '30', // Not a Graph-syncable field
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.graphSynced).toBe(false);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(0);
    });
  });

  describe('Graph sync failure handling', () => {
    it('should still update MongoDB when Graph sync fails', async () => {
      graphApiMock.setMockError('updateCalendarEvent', new Error('Graph API unavailable'));

      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Despite Failure',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.graphSynced).toBe(false);
      expect(res.body.event.eventTitle).toBe('Updated Despite Failure');
    });
  });

  describe('Permission checks', () => {
    it('should reject non-admin users', async () => {
      const requesterToken = await createMockToken(requesterUser);
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventTitle: 'Unauthorized Update' })
        .expect(403);
    });

    it('should return 404 for non-existent event', async () => {
      const { ObjectId } = require('mongodb');
      await request(app)
        .put(`/api/admin/events/${new ObjectId()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Ghost Event' })
        .expect(404);
    });
  });
});
