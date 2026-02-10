/**
 * Admin Restore Tests (AR-1 to AR-15)
 *
 * Tests the admin-only restore endpoint PUT /api/admin/events/:id/restore.
 * AR-11 to AR-15 test Graph API republishing on restore of events with graphData.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, createViewer, insertUsers } = require('../../__helpers__/userFactory');
const {
  createDeletedEvent,
  createApprovedEvent,
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Admin Restore Tests (AR-1 to AR-15)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let viewerUser;
  let viewerToken;

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

    adminUser = createAdmin();
    viewerUser = createViewer();
    await insertUsers(db, [adminUser, viewerUser]);

    adminToken = await createMockToken(adminUser);
    viewerToken = await createMockToken(viewerUser);
  });

  describe('AR-1: Admin can restore deleted event to previous status', () => {
    it('should restore a deleted event to its previous approved status', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Previously Approved Event',
        previousStatus: STATUS.APPROVED,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: 'requester@test.com' },
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-02'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(STATUS.APPROVED);
      expect(res.body._version).toBe((saved._version || 0) + 1);
    });
  });

  describe('AR-2: Sets isDeleted false, unsets deletion fields', () => {
    it('should clear deletion metadata from the event', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Event with deletion metadata',
        previousStatus: STATUS.PENDING,
        deletedByEmail: 'someone@test.com',
      });
      const [saved] = await insertEvents(db, [deleted]);

      await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.isDeleted).toBe(false);
      expect(restored.deletedAt).toBeUndefined();
      expect(restored.deletedBy).toBeUndefined();
      expect(restored.deletedByEmail).toBeUndefined();
      expect(restored.status).toBe(STATUS.PENDING);
    });
  });

  describe('AR-3: Reads previous status from statusHistory', () => {
    it('should find the last non-deleted status in statusHistory', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Event with rich history',
        statusHistory: [
          { status: STATUS.DRAFT, changedAt: new Date('2026-01-01'), changedByEmail: 'user@test.com' },
          { status: STATUS.PENDING, changedAt: new Date('2026-01-02'), changedByEmail: 'user@test.com' },
          { status: STATUS.REJECTED, changedAt: new Date('2026-01-03'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-04'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(STATUS.REJECTED);
    });
  });

  describe('AR-4: Defaults to draft when statusHistory is empty', () => {
    it('should fall back to draft when no statusHistory exists', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Event without history',
        statusHistory: [],
        previousStatus: undefined,
      });
      // Remove previousStatus since createDeletedEvent sets it
      delete deleted.previousStatus;
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(STATUS.DRAFT);
    });
  });

  describe('AR-5: Pushes "Restored by admin" to statusHistory', () => {
    it('should add a restore entry to statusHistory', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Event to check history',
        statusHistory: [
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      const lastEntry = restored.statusHistory[restored.statusHistory.length - 1];
      expect(lastEntry.status).toBe(STATUS.APPROVED);
      expect(lastEntry.reason).toBe('Restored by admin');
      expect(lastEntry.changedByEmail).toBe(adminUser.email);
    });
  });

  describe('AR-6: Increments _version', () => {
    it('should increment the event version', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Version check event',
        _version: 3,
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: 3 });

      expect(res.body._version).toBe(4);

      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored._version).toBe(4);
    });
  });

  describe('AR-7: Non-admin gets 403', () => {
    it('should reject restore from viewer (non-admin) user', async () => {
      const deleted = createDeletedEvent({ eventTitle: 'Viewer cannot restore' });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Admin');
    });
  });

  describe('AR-8: Non-existent event returns 404', () => {
    it('should return 404 for a non-existent event ID', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      const res = await request(app)
        .put(`/api/admin/events/${fakeId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe('AR-9: Non-deleted event returns 404', () => {
    it('should return 404 when trying to restore a non-deleted event', async () => {
      const approved = createApprovedEvent({
        eventTitle: 'Active event',
      });
      const [saved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(404);
    });
  });

  describe('AR-10: Version conflict returns 409', () => {
    it('should return 409 when _version does not match', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Conflict event',
        _version: 5,
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: 3 }); // Stale version

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('VERSION_CONFLICT');
    });
  });

  // ============================================
  // AR-11 to AR-14: Graph API Republishing Tests
  // ============================================

  describe('AR-11: Restore approved event republishes to Graph', () => {
    it('should call createCalendarEvent and store new graphData', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Approved then deleted',
        previousStatus: STATUS.APPROVED,
        statusHistory: [
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
        ],
        graphData: {
          id: 'OLD_GRAPH_ID',
          webLink: 'https://outlook.office365.com/old',
        },
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.graphPublished).toBe(true);

      // Verify Graph API was called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.subject).toBe('Approved then deleted');

      // Verify MongoDB has new graphData
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.graphData.id).not.toBe('OLD_GRAPH_ID');
      expect(restored.graphData.webLink).toContain('outlook.office365.com');
    });
  });

  describe('AR-12: Restore non-approved event does NOT call Graph', () => {
    it('should skip Graph republishing for pending events', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Pending then deleted',
        previousStatus: STATUS.PENDING,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: 'requester@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.graphPublished).toBe(false);
      expect(res.body.status).toBe(STATUS.PENDING);

      // Verify Graph API was NOT called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(0);
    });
  });

  describe('AR-13: Graph API failure does not fail the restore', () => {
    it('should return 200 even if Graph republishing fails', async () => {
      graphApiMock.setMockError('createCalendarEvent', new Error('Graph unavailable'));

      const deleted = createDeletedEvent({
        eventTitle: 'Graph will fail',
        previousStatus: STATUS.APPROVED,
        statusHistory: [
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.graphPublished).toBe(false);
      expect(res.body.status).toBe(STATUS.APPROVED);

      // Verify MongoDB status is still restored
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.status).toBe(STATUS.APPROVED);
      expect(restored.isDeleted).toBe(false);
    });
  });

  describe('AR-15: Restore published event (with graphData.id) recreates Graph event', () => {
    it('should call createCalendarEvent for events with graphData.id regardless of previous status', async () => {
      // Simulate a unified-form event that was published (status=approved) with graphData
      // but whose statusHistory never recorded "approved" (e.g., created directly as published)
      const deleted = createDeletedEvent({
        eventTitle: 'Published via unified form',
        previousStatus: STATUS.APPROVED,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: 'requester@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedByEmail: 'admin@test.com' },
        ],
        graphData: {
          id: 'PUBLISHED_GRAPH_ID',
          webLink: 'https://outlook.office365.com/published',
        },
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.graphPublished).toBe(true);

      // Verify Graph API was called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.subject).toBe('Published via unified form');

      // Verify MongoDB has new graphData (not the old ID)
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.graphData.id).not.toBe('PUBLISHED_GRAPH_ID');
      expect(restored.graphData.id).toBeTruthy();
    });
  });

  describe('AR-14: Restored event gets new graphData stored', () => {
    it('should replace old graphData with new Graph event IDs', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Replace graphData',
        previousStatus: STATUS.APPROVED,
        statusHistory: [
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
        ],
        graphData: {
          id: 'OLD_ID_TO_REPLACE',
          webLink: 'https://outlook.office365.com/old-link',
          changeKey: 'old-change-key',
        },
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.graphPublished).toBe(true);

      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.graphData.id).not.toBe('OLD_ID_TO_REPLACE');
      expect(restored.graphData.id).toBeTruthy();
      expect(restored.graphData.webLink).not.toBe('https://outlook.office365.com/old-link');
      expect(restored.graphData.webLink).toBeTruthy();
    });
  });
});
