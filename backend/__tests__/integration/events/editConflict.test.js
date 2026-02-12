/**
 * Edit Conflict Tests (EC-1 to EC-4)
 *
 * Tests scheduling conflict detection on the owner edit endpoint
 * PUT /api/room-reservations/:id/edit
 */

const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createRequester, createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Edit Conflict Tests (EC-1 to EC-4)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;

  const roomId = new ObjectId();
  const roomId2 = new ObjectId();
  const baseStart = new Date('2026-06-10T10:00:00');
  const baseEnd = new Date('2026-06-10T12:00:00');

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

    requesterUser = createRequester();
    await insertUsers(db, [requesterUser]);
    requesterToken = await createMockToken(requesterUser);
  });

  // EC-1: Owner edit, no conflicts → 200 OK
  describe('EC-1: Owner edit with no conflicts', () => {
    it('should save successfully when no scheduling conflicts exist', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'My Pending Event',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: { userId: requesterUser.odataId },
          requesterEmail: requesterUser.email,
          department: 'General',
        },
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Updated Title',
          startDate: '2026-06-10',
          startTime: '14:00',
          endDate: '2026-06-10',
          endTime: '16:00',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('updated successfully');
    });
  });

  // EC-2: Owner edit time creating conflict → 409 SchedulingConflict
  describe('EC-2: Owner edit time creating conflict', () => {
    it('should return 409 when new time overlaps an existing event', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Existing Afternoon Event',
        startDateTime: new Date('2026-06-10T14:00:00'),
        endDateTime: new Date('2026-06-10T16:00:00'),
        locations: [roomId],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'My Pending Event',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: { userId: requesterUser.odataId },
          requesterEmail: requesterUser.email,
          department: 'General',
        },
      });
      await insertEvents(db, [existingEvent, pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'My Pending Event',
          startDate: '2026-06-10',
          startTime: '14:30',
          endDate: '2026-06-10',
          endTime: '16:30',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflicts).toHaveLength(1);
      expect(res.body.conflicts[0].eventTitle).toBe('Existing Afternoon Event');
    });
  });

  // EC-3: Owner edit room creating conflict → 409 SchedulingConflict
  describe('EC-3: Owner edit room creating conflict', () => {
    it('should return 409 when moving to a room with an existing event', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Room 2 Event',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId2],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'My Event In Room 1',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: { userId: requesterUser.odataId },
          requesterEmail: requesterUser.email,
          department: 'General',
        },
      });
      await insertEvents(db, [existingEvent, pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'My Event In Room 1',
          startDate: '2026-06-10',
          startTime: '10:00',
          endDate: '2026-06-10',
          endTime: '12:00',
          requestedRooms: [roomId2],
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflicts).toHaveLength(1);
    });
  });

  // EC-4: Owner has no force override → 409 returned
  describe('EC-4: Owner has no force override', () => {
    it('should not provide forceUpdate override for owners', async () => {
      const existingEvent = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: new Date('2026-06-10T14:00:00'),
        endDateTime: new Date('2026-06-10T16:00:00'),
        locations: [roomId],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'Trying Force',
        startDateTime: baseStart,
        endDateTime: baseEnd,
        locations: [roomId],
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: { userId: requesterUser.odataId },
          requesterEmail: requesterUser.email,
          department: 'General',
        },
      });
      await insertEvents(db, [existingEvent, pendingEvent]);

      // Even sending forceUpdate should not bypass conflict check for owners
      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Trying Force',
          startDate: '2026-06-10',
          startTime: '14:30',
          endDate: '2026-06-10',
          endTime: '16:30',
          forceUpdate: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });
});
