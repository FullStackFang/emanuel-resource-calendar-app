/**
 * Rejected Edit Tests (RE-1 to RE-12)
 *
 * Tests requester ability to edit their own rejected events and resubmit
 * via PUT /api/room-reservations/:id/edit
 */

const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase, getTestCollections } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createOtherRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createRejectedEvent,
  createDeletedEvent,
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Rejected Edit Tests (RE-1 to RE-12)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let otherRequesterUser;
  let otherRequesterToken;

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
    await db.createCollection(COLLECTIONS.RESERVATION_TOKENS);
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
    otherRequesterUser = createOtherRequester();
    await insertUsers(db, [requesterUser, otherRequesterUser]);

    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
  });

  const editPayload = {
    eventTitle: 'Fixed Event Title',
    eventDescription: 'Updated description after rejection',
    startDate: '2026-03-20',
    startTime: '14:00',
    endDate: '2026-03-20',
    endTime: '16:00',
    attendeeCount: 30,
    requestedRooms: [],
    specialRequirements: 'Updated requirements',
    categories: ['meeting'],
    services: {},
  };

  // ============================================
  // RE-1: Owner can edit own rejected event
  // ============================================
  describe('RE-1: Owner can edit own rejected event', () => {
    it('should return 200 and update fields', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Reservation updated successfully');
      expect(res.body.reservation).toBeDefined();
      expect(res.body._version).toBeDefined();
    });
  });

  // ============================================
  // RE-2: Status transitions from rejected → pending
  // ============================================
  describe('RE-2: Status transitions from rejected to pending', () => {
    it('should change status to pending', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      expect(res.status).toBe(200);

      const updated = await findEvent(db, rejectedEvent._id);
      expect(updated.status).toBe(STATUS.PENDING);
    });
  });

  // ============================================
  // RE-3: Clears reviewedAt and reviewedBy
  // ============================================
  describe('RE-3: Clears reviewedAt and reviewedBy', () => {
    it('should clear reviewer fields', async () => {
      const rejectedEvent = createRejectedEvent({
        requesterUser,
        reviewedAt: new Date('2026-02-15'),
        reviewedBy: 'approver@emanuelnyc.org',
      });
      await insertEvents(db, [rejectedEvent]);

      await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      const updated = await findEvent(db, rejectedEvent._id);
      expect(updated.reviewedAt).toBeNull();
      expect(updated.reviewedBy).toBeNull();
    });
  });

  // ============================================
  // RE-4: Pushes statusHistory entry
  // ============================================
  describe('RE-4: Pushes statusHistory with resubmit reason', () => {
    it('should push a statusHistory entry with resubmit reason', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      const updated = await findEvent(db, rejectedEvent._id);
      const lastHistory = updated.statusHistory[updated.statusHistory.length - 1];
      expect(lastHistory.status).toBe('pending');
      expect(lastHistory.reason).toBe('Resubmitted with edits after rejection');
    });
  });

  // ============================================
  // RE-5: Increments _version
  // ============================================
  describe('RE-5: Increments _version', () => {
    it('should increment version number', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser, _version: 3 });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: 3 });

      expect(res.status).toBe(200);
      expect(res.body._version).toBe(4);
    });
  });

  // ============================================
  // RE-6: Non-owner gets 403
  // ============================================
  describe('RE-6: Non-owner cannot edit rejected event', () => {
    it('should return 403', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${otherRequesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('only edit your own');
    });
  });

  // ============================================
  // RE-7: resubmissionAllowed=false gets 400
  // ============================================
  describe('RE-7: Resubmission disabled returns 400', () => {
    it('should return 400 when resubmissionAllowed is false', async () => {
      const rejectedEvent = createRejectedEvent({
        requesterUser,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          resubmissionAllowed: false,
        },
      });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Resubmission has been disabled');
    });
  });

  // ============================================
  // RE-8: Title/time updates persist in calendarData
  // ============================================
  describe('RE-8: Title and time updates persist', () => {
    it('should persist updated fields in calendarData', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      const updated = await findEvent(db, rejectedEvent._id);
      expect(updated.calendarData.eventTitle).toBe('Fixed Event Title');
      expect(updated.calendarData.startDate).toBe('2026-03-20');
      expect(updated.calendarData.startTime).toBe('14:00');
      expect(updated.calendarData.endDate).toBe('2026-03-20');
      expect(updated.calendarData.endTime).toBe('16:00');
    });
  });

  // ============================================
  // RE-9: Version conflict returns 409
  // ============================================
  describe('RE-9: Version conflict returns 409', () => {
    it('should return 409 when version does not match', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: 999 });

      expect(res.status).toBe(409);
    });
  });

  // ============================================
  // RE-10: Scheduling conflict returns 409
  // ============================================
  describe('RE-10: Scheduling conflict returns 409', () => {
    it('should return 409 when room conflicts exist', async () => {
      const roomId = new ObjectId();

      // Create an existing published event overlapping with our target times
      const existingEvent = createPublishedEvent({
        eventTitle: 'Existing Published Event',
        startDateTime: new Date('2026-03-20T14:00:00'),
        endDateTime: new Date('2026-03-20T16:00:00'),
        locations: [roomId],
      });

      const rejectedEvent = createRejectedEvent({
        requesterUser,
        locations: [roomId],
      });
      await insertEvents(db, [existingEvent, rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          ...editPayload,
          _version: rejectedEvent._version,
          requestedRooms: [roomId.toString()],
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  // ============================================
  // RE-11: Audit log has changeType "resubmit_with_edits"
  // ============================================
  describe('RE-11: Audit log records resubmit_with_edits', () => {
    it('should create audit entry with resubmit_with_edits action', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      const auditLogs = await db.collection(COLLECTIONS.AUDIT_HISTORY).find({}).toArray();
      expect(auditLogs.length).toBeGreaterThanOrEqual(1);

      const resubmitLog = auditLogs.find(l => l.action === 'resubmit_with_edits');
      expect(resubmitLog).toBeDefined();
    });
  });

  // ============================================
  // RE-12: Cannot edit deleted events (still 400)
  // ============================================
  describe('RE-12: Cannot edit deleted events', () => {
    it('should return 400 for deleted events', async () => {
      const deletedEvent = createDeletedEvent({ requesterUser });
      await insertEvents(db, [deletedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${deletedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: deletedEvent._version });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only pending or rejected');
    });
  });
});
