/**
 * Save Conflict Tests (SC-1 to SC-6)
 *
 * Tests scheduling conflict detection on the admin save endpoint
 * PUT /api/admin/events/:id
 */

const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPendingEvent,
  createDraftEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Save Conflict Tests (SC-1 to SC-6)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  const roomId = new ObjectId();
  const roomId2 = new ObjectId();
  const baseStart = new Date('2026-05-20T10:00:00');
  const baseEnd = new Date('2026-05-20T12:00:00');

  beforeAll(async () => {
    await initTestKeys();

    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    await db.createCollection(COLLECTIONS.USERS);
    await db.createCollection(COLLECTIONS.EVENTS);
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

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);

    graphApiMock.resetMocks();
  });

  // SC-1: Save time change, no conflict → 200 OK
  describe('SC-1: Save time change with no conflict', () => {
    it('should save successfully when new time does not conflict', async () => {
      const publishedEvent = createPublishedEvent({
        eventTitle: 'Event To Move',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      await insertEvents(db, [publishedEvent]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(publishedEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: '2026-05-20T14:00:00',
          endDateTime: '2026-05-20T16:00:00',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // SC-2: Save time change creating conflict → 409 SchedulingConflict
  describe('SC-2: Save time change creating conflict', () => {
    it('should return 409 when new time overlaps an existing event in same room', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Existing Blocking Event',
        startDateTime: new Date('2026-05-20T14:00:00'),
        endDateTime: new Date('2026-05-20T16:00:00'),
        locations: [roomId],
      });
      const eventToEdit = createPublishedEvent({
        eventTitle: 'Event Being Edited',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      await insertEvents(db, [existingEvent, eventToEdit]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(eventToEdit._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: '2026-05-20T14:30:00',
          endDateTime: '2026-05-20T16:30:00',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflicts).toHaveLength(1);
      expect(res.body.conflicts[0].eventTitle).toBe('Existing Blocking Event');
    });
  });

  // SC-3: Save with forceUpdate: true → 200 OK (override)
  describe('SC-3: Save with forceUpdate override', () => {
    it('should save successfully when forceUpdate is true despite conflicts', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: new Date('2026-05-20T14:00:00'),
        endDateTime: new Date('2026-05-20T16:00:00'),
        locations: [roomId],
      });
      const eventToEdit = createPublishedEvent({
        eventTitle: 'Force Saved Event',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      await insertEvents(db, [existingEvent, eventToEdit]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(eventToEdit._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: '2026-05-20T14:30:00',
          endDateTime: '2026-05-20T16:30:00',
          forceUpdate: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // SC-4: Save room change creating conflict → 409 SchedulingConflict
  describe('SC-4: Save room change creating conflict', () => {
    it('should return 409 when moving to a room with an existing overlapping event', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Occupying Room 2',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId2],
      });
      const eventToEdit = createPublishedEvent({
        eventTitle: 'Moving To Room 2',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      await insertEvents(db, [existingEvent, eventToEdit]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(eventToEdit._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          locations: [roomId2],
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflicts).toHaveLength(1);
    });
  });

  // SC-5: Save non-time/room fields → 200 OK (no conflict check)
  describe('SC-5: Save non-time/room fields skips conflict check', () => {
    it('should save title change without conflict check even with overlapping events', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Same Room Same Time',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      const eventToEdit = createPublishedEvent({
        eventTitle: 'Just Renaming',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      await insertEvents(db, [existingEvent, eventToEdit]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(eventToEdit._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Renamed Event',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // SC-6: Save on draft status → 200 OK (no conflict check)
  describe('SC-6: Save on draft status skips conflict check', () => {
    it('should save time change on draft without conflict check', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      const draftEvent = createDraftEvent({
        eventTitle: 'Draft Event',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
      });
      await insertEvents(db, [existingEvent, draftEvent]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(draftEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: '2026-05-20T10:00:00',
          endDateTime: '2026-05-20T12:00:00',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
