/**
 * Event Delete/Restore Tests (A-13, A-19, A-20, A-21, A-22, A-23)
 *
 * Tests the delete and restore functionality for events.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createRejectedEvent,
  createDeletedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Event Delete/Restore Tests (A-13, A-19 to A-23)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
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
    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, adminUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  describe('A-13: Delete published event', () => {
    it('should soft delete a published event', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event to Delete',
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify in database
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPublished._id });
      expect(event.isDeleted).toBe(true);
      expect(event.status).toBe(STATUS.DELETED);
      expect(event.previousStatus).toBe(STATUS.PUBLISHED);
      expect(event.deletedAt).toBeDefined();
      expect(event.deletedBy).toBe(approverUser.odataId);
    });

    it('should create audit log entry', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedPublished.eventId,
        action: 'deleted',
        performedBy: approverUser.odataId,
      });
    });
  });

  describe('A-19: Delete rejected event', () => {
    it('should soft delete a rejected event', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Rejected Event to Delete',
      });
      const [savedRejected] = await insertEvents(db, [rejected]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedRejected._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedRejected._id });
      expect(event.isDeleted).toBe(true);
      expect(event.previousStatus).toBe(STATUS.REJECTED);
    });
  });

  describe('A-20: View deleted events', () => {
    it('should return deleted events when queried', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Already Deleted Event',
      });
      await insertEvents(db, [deleted]);

      const res = await request(app)
        .get('/api/admin/events?isDeleted=true')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].eventTitle).toBe('Already Deleted Event');
      expect(res.body.events[0].isDeleted).toBe(true);
    });

    it('should exclude deleted events by default', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'Active Event',
      });
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'Deleted Event',
      });
      await insertEvents(db, [published, deleted]);

      const res = await request(app)
        .get('/api/admin/events?isDeleted=false')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].eventTitle).toBe('Active Event');
    });
  });

  describe('A-21: Restore deleted event (Admin only)', () => {
    it('should restore deleted event to previous status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Restore Me',
        previousStatus: STATUS.PUBLISHED,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(STATUS.PUBLISHED);
    });

    it('should return 404 when event is not deleted', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPublished._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedPublished._version })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('should create audit log entry', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        previousStatus: STATUS.PENDING,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedDeleted.eventId,
        action: 'restored',
        performedBy: adminUser.odataId,
      });
    });
  });

  describe('A-23: Restored event preserves previous status', () => {
    it('should restore to published status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        previousStatus: STATUS.PUBLISHED,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.PUBLISHED);
    });

    it('should restore to pending status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        previousStatus: STATUS.PENDING,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.PENDING);
    });

    it('should restore to rejected status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        previousStatus: STATUS.REJECTED,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.REJECTED);
    });

    it('should default to draft if no previous status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
      });
      // Remove previousStatus and statusHistory to simulate legacy data
      delete deleted.previousStatus;
      deleted.statusHistory = [];
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.DRAFT);
    });
  });

  describe('Delete idempotency', () => {
    it('should return success when deleting already deleted event', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedDeleted._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/already deleted/i);
    });
  });
});
