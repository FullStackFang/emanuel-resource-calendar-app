/**
 * Event Rejection Tests (A-8, A-9)
 *
 * Tests the rejection workflow for pending events by approvers.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createDraftEvent,
  createApprovedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Event Rejection Tests (A-8, A-9)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();

    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    // Create collections
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
    // Clear collections
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    // Create test users
    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    // Create token
    approverToken = await createMockToken(approverUser);
  });

  describe('A-8: Reject pending event', () => {
    it('should transition pending event to rejected', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event to Reject',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Room not available on requested date' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.REJECTED);
      expect(res.body.event.rejectedAt).toBeDefined();
      expect(res.body.event.rejectedBy).toBe(approverUser.email);
      expect(res.body.event.rejectionReason).toBe('Room not available on requested date');
    });

    it('should create audit log entry with rejection reason', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Conflict with existing event' })
        .expect(200);

      const audit = await assertAuditEntry(db, {
        eventId: savedPending.eventId,
        action: 'rejected',
        performedBy: approverUser.odataId,
      });

      expect(audit.changes.reason).toBe('Conflict with existing event');
    });

    it('should return 404 for non-existent event', async () => {
      const res = await request(app)
        .put('/api/admin/events/507f1f77bcf86cd799439011/reject')
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Test rejection' })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('should return 400 when trying to reject draft', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDraft._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Test rejection' })
        .expect(400);

      expect(res.body.error).toMatch(/cannot reject/i);
    });

    it('should return 400 when trying to reject already approved event', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedApproved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .put(`/api/admin/events/${savedApproved._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Test rejection' })
        .expect(400);

      expect(res.body.error).toMatch(/cannot reject/i);
    });
  });

  describe('A-9: Rejection requires reason', () => {
    it('should return 400 when no reason is provided', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({}) // No reason
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('should return 400 when reason is empty string', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: '' })
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('should accept reason with whitespace and trim', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: '  Valid reason with spaces  ' })
        .expect(200);

      expect(res.body.event.status).toBe(STATUS.REJECTED);
    });
  });
});
