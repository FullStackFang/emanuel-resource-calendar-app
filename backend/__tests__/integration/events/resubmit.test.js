/**
 * Resubmit Integration Tests (RS-1 to RS-14)
 *
 * Tests the simplified resubmit workflow: rejected → pending with no
 * userMessage, communicationHistory, or revision tracking required.
 *
 * RS-1:  Requester can resubmit rejected reservation → pending
 * RS-2:  Pushes statusHistory entry
 * RS-3:  Does NOT require userMessage
 * RS-4:  Does NOT create communicationHistory
 * RS-5:  Does NOT increment currentRevision
 * RS-6:  Clears reviewedAt/reviewedBy
 * RS-7:  Increments _version
 * RS-8:  Cannot resubmit pending reservation (400)
 * RS-9:  Cannot resubmit published reservation (400)
 * RS-10: Cannot resubmit another user's reservation (403)
 * RS-11: Cannot resubmit when resubmissionAllowed=false (400)
 * RS-12: 409 on _version mismatch
 * RS-13: Null _version skips check
 * RS-14: Full lifecycle: submit → reject → resubmit → publish
 */

const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createRequester, createApprover, createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createRejectedEvent,
  createPendingEvent,
  createPublishedEvent,
  insertEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Resubmit Integration Tests (RS-1 to RS-14)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let otherRequesterUser;
  let otherRequesterToken;
  let approverUser;
  let approverToken;
  let adminUser;
  let adminToken;

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
    graphApiMock.resetMocks();

    requesterUser = createRequester();
    otherRequesterUser = createRequester({
      email: 'other.requester@external.com',
      displayName: 'Other Requester',
    });
    approverUser = createApprover();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, otherRequesterUser, approverUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  // Helper: create a rejected event owned by requesterUser
  const createOwnedRejectedEvent = (overrides = {}) => {
    return createRejectedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      roomReservationData: {
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: requesterUser.displayName,
        },
        resubmissionAllowed: true,
        reviewedAt: new Date(),
        reviewedBy: 'approver@external.com',
        currentRevision: 1,
        communicationHistory: [],
      },
      _version: 1,
      statusHistory: [
        {
          status: 'pending',
          changedAt: new Date(Date.now() - 120000),
          changedBy: requesterUser.odataId,
          changedByEmail: requesterUser.email,
          reason: 'Room reservation submitted',
        },
        {
          status: 'rejected',
          changedAt: new Date(Date.now() - 60000),
          changedBy: approverUser.odataId,
          changedByEmail: approverUser.email,
          reason: 'Test rejection',
        },
      ],
      ...overrides,
    });
  };

  describe('RS-1: Requester can resubmit rejected reservation', () => {
    it('changes status from rejected to pending', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Reservation resubmitted successfully');

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(updated.status).toBe('pending');
    });
  });

  describe('RS-2: Pushes statusHistory entry', () => {
    it('adds a pending entry with resubmit reason', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      const history = updated.statusHistory;
      expect(history.length).toBe(3); // pending + rejected + pending (resubmit)
      const lastEntry = history[history.length - 1];
      expect(lastEntry.status).toBe('pending');
      expect(lastEntry.reason).toBe('Resubmitted after rejection');
      expect(lastEntry.changedBy).toBe(requesterUser.odataId);
    });
  });

  describe('RS-3: Does NOT require userMessage', () => {
    it('succeeds with only _version in body', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(200);
    });

    it('succeeds with empty body', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({});

      expect(res.status).toBe(200);
    });
  });

  describe('RS-4: Does NOT create communicationHistory', () => {
    it('communicationHistory remains empty after resubmit', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(updated.roomReservationData.communicationHistory).toEqual([]);
    });
  });

  describe('RS-5: Does NOT increment currentRevision', () => {
    it('currentRevision stays at 1', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(updated.roomReservationData.currentRevision).toBe(1);
    });
  });

  describe('RS-6: Clears reviewedAt/reviewedBy', () => {
    it('sets reviewedAt and reviewedBy to null', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(updated.roomReservationData.reviewedAt).toBeNull();
      expect(updated.roomReservationData.reviewedBy).toBeNull();
    });
  });

  describe('RS-7: Increments _version', () => {
    it('version goes from 1 to 2', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.body._version).toBe(2);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(updated._version).toBe(2);
    });
  });

  describe('RS-8: Cannot resubmit pending reservation', () => {
    it('returns 400', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: { userId: requesterUser.odataId, email: requesterUser.email },
          resubmissionAllowed: true,
        },
        _version: 1,
      });
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/only rejected/i);
    });
  });

  describe('RS-9: Cannot resubmit published reservation', () => {
    it('returns 400', async () => {
      const event = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: { userId: requesterUser.odataId, email: requesterUser.email },
          resubmissionAllowed: true,
        },
        _version: 1,
      });
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/only rejected/i);
    });
  });

  describe('RS-10: Cannot resubmit another user\'s reservation', () => {
    it('returns 403', async () => {
      const event = createOwnedRejectedEvent();
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${otherRequesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/your own/i);
    });
  });

  describe('RS-11: Cannot resubmit when resubmissionAllowed=false', () => {
    it('returns 400', async () => {
      const event = createOwnedRejectedEvent({
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
            name: requesterUser.displayName,
          },
          resubmissionAllowed: false,
          reviewedAt: new Date(),
          reviewedBy: 'approver@external.com',
        },
      });
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/disabled/i);
    });
  });

  describe('RS-12: 409 on _version mismatch', () => {
    it('returns 409 when version does not match', async () => {
      const event = createOwnedRejectedEvent({ _version: 3 });
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('VERSION_CONFLICT');
    });
  });

  describe('RS-13: Null _version skips check', () => {
    it('succeeds when _version is null (backward compat)', async () => {
      const event = createOwnedRejectedEvent({ _version: 5 });
      await insertEvent(db, event);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(event._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: null });

      expect(res.status).toBe(200);
    });
  });

  describe('RS-14: Full lifecycle: submit → reject → resubmit → publish', () => {
    it('completes the full workflow', async () => {
      // Step 1: Create a draft and submit it
      const draftRes = await request(app)
        .post('/api/room-reservations/draft')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Lifecycle Test Event',
          startDateTime: '2026-03-01T10:00:00Z',
          endDateTime: '2026-03-01T11:00:00Z',
          locations: ['room-1'],
          categories: ['Meeting'],
          setupTime: '15 minutes',
          doorOpenTime: '09:00',
          requesterName: requesterUser.displayName,
          requesterEmail: requesterUser.email,
        });
      expect(draftRes.status).toBe(201);
      const draftId = draftRes.body.draft._id;

      // Submit the draft
      const submitRes = await request(app)
        .post(`/api/room-reservations/draft/${draftId}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({});
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.event.status).toBe('pending');
      const eventId = submitRes.body.event._id;

      // Step 2: Reject it
      const rejectRes = await request(app)
        .put(ENDPOINTS.REJECT_EVENT(eventId))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Needs changes', _version: submitRes.body.event._version });
      expect(rejectRes.status).toBe(200);

      // Re-read via ObjectId
      const rejectedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: new ObjectId(eventId) });
      expect(rejectedEvent.status).toBe('rejected');

      // Step 3: Resubmit
      const resubmitRes = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(eventId))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: rejectedEvent._version });
      expect(resubmitRes.status).toBe(200);

      const resubmittedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: new ObjectId(eventId) });
      expect(resubmittedEvent.status).toBe('pending');

      // Step 4: Publish
      const publishRes = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(eventId))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: resubmittedEvent._version });
      expect(publishRes.status).toBe(200);

      const finalEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: new ObjectId(eventId) });
      expect(finalEvent.status).toBe('published');

      // Verify full statusHistory
      expect(finalEvent.statusHistory.length).toBeGreaterThanOrEqual(4);
      const statuses = finalEvent.statusHistory.map(h => h.status);
      // Should include: draft (creation), pending (submit), rejected, pending (resubmit), published
      expect(statuses).toContain('pending');
      expect(statuses).toContain('rejected');
      expect(statuses).toContain('published');
    });
  });
});
