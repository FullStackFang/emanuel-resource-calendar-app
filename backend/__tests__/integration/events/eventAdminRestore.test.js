/**
 * Admin Restore Tests (AR-1 to AR-24)
 *
 * Tests the admin-only restore endpoint PUT /api/admin/events/:id/restore.
 * AR-11 to AR-15 test Graph API republishing on restore of events with graphData.
 * AR-16 to AR-22 test scheduling conflict detection on restore.
 */

const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, createViewer, insertUsers } = require('../../__helpers__/userFactory');
const {
  createDeletedEvent,
  createPublishedEvent,
  createPendingEvent,
  createBaseEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Admin Restore Tests (AR-1 to AR-24)', () => {
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
    it('should restore a deleted event to its previous published status', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Previously Published Event',
        previousStatus: STATUS.PUBLISHED,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: 'requester@test.com' },
          { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-02'), changedByEmail: 'approver@test.com' },
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
      expect(res.body.status).toBe(STATUS.PUBLISHED);
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
          { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
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
      expect(lastEntry.status).toBe(STATUS.PUBLISHED);
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
      const published = createPublishedEvent({
        eventTitle: 'Active event',
      });
      const [saved] = await insertEvents(db, [published]);

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

  describe('AR-11: Restore published event republishes to Graph', () => {
    it('should call createCalendarEvent and store new graphData', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Published then deleted',
        previousStatus: STATUS.PUBLISHED,
        statusHistory: [
          { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
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
      expect(graphCalls[0].eventData.subject).toBe('Published then deleted');

      // Verify MongoDB has new graphData
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.graphData.id).not.toBe('OLD_GRAPH_ID');
      expect(restored.graphData.webLink).toContain('outlook.office365.com');
    });
  });

  describe('AR-12: Restore non-published event does NOT call Graph', () => {
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
        previousStatus: STATUS.PUBLISHED,
        statusHistory: [
          { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
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
      expect(res.body.status).toBe(STATUS.PUBLISHED);

      // Verify MongoDB status is still restored
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.status).toBe(STATUS.PUBLISHED);
      expect(restored.isDeleted).toBe(false);
    });
  });

  describe('AR-15: Restore published event (with graphData.id) recreates Graph event', () => {
    it('should call createCalendarEvent for events with graphData.id regardless of previous status', async () => {
      // Simulate a unified-form event that was published with graphData
      // but whose statusHistory never recorded "published" (e.g., created directly as published)
      const deleted = createDeletedEvent({
        eventTitle: 'Published via unified form',
        previousStatus: STATUS.PUBLISHED,
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
        previousStatus: STATUS.PUBLISHED,
        statusHistory: [
          { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
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

  // ============================================
  // AR-16 to AR-22: Scheduling Conflict Detection
  // ============================================

  describe('Scheduling conflict detection', () => {
    const roomId = new ObjectId();
    const roomId2 = new ObjectId();
    const conflictStart = new Date('2026-03-15T10:00:00Z');
    const conflictEnd = new Date('2026-03-15T12:00:00Z');

    describe('AR-16: Conflict when restoring to published (overlapping published event in same room)', () => {
      it('should return 409 SchedulingConflict', async () => {
        // Create an existing published event occupying the room
        const existing = createPublishedEvent({
          eventTitle: 'Existing Published Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        // Create the deleted event that would conflict
        const deleted = createDeletedEvent({
          eventTitle: 'Deleted Event To Restore',
          previousStatus: STATUS.PUBLISHED,
          startDateTime: new Date('2026-03-15T11:00:00Z'),
          endDateTime: new Date('2026-03-15T13:00:00Z'),
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
        expect(res.body.conflicts).toHaveLength(1);
        expect(res.body.previousStatus).toBe(STATUS.PUBLISHED);
      });
    });

    describe('AR-17: Conflict when restoring to pending', () => {
      it('should return 409 SchedulingConflict', async () => {
        const existing = createPublishedEvent({
          eventTitle: 'Existing Published Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Deleted Pending Event',
          previousStatus: STATUS.PENDING,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: 'requester@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
      });
    });

    describe('AR-18: No conflict check when restoring to draft', () => {
      it('should restore successfully without conflict check', async () => {
        const existing = createPublishedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Deleted Draft Event',
          previousStatus: STATUS.DRAFT,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.DRAFT, changedAt: new Date('2026-01-01'), changedByEmail: 'requester@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(STATUS.DRAFT);
      });
    });

    describe('AR-19: No conflict check when restoring to rejected', () => {
      it('should restore successfully without conflict check', async () => {
        const existing = createPublishedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Deleted Rejected Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: 'requester@test.com' },
            { status: STATUS.REJECTED, changedAt: new Date('2026-01-02'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(STATUS.REJECTED);
      });
    });

    describe('AR-20: forceRestore overrides conflicts', () => {
      it('should restore successfully with forceRestore: true despite conflicts', async () => {
        const existing = createPublishedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Force Restored Event',
          previousStatus: STATUS.PUBLISHED,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version, forceRestore: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status).toBe(STATUS.PUBLISHED);
      });
    });

    describe('AR-21: No conflict when event has no rooms', () => {
      it('should restore successfully when event has empty locations', async () => {
        const existing = createPublishedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Virtual Event (no rooms)',
          previousStatus: STATUS.PUBLISHED,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [], // No rooms
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });

    describe('AR-22: Conflict response includes correct details', () => {
      it('should include conflicts array with event details', async () => {
        const existing = createPublishedEvent({
          eventTitle: 'Blocking Event Alpha',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Conflicting Restore',
          previousStatus: STATUS.PUBLISHED,
          startDateTime: new Date('2026-03-15T11:00:00Z'),
          endDateTime: new Date('2026-03-15T13:00:00Z'),
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        const [existingSaved] = await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
        expect(res.body.conflicts).toHaveLength(1);

        const conflict = res.body.conflicts[0];
        expect(conflict.id).toBe(existingSaved._id.toString());
        expect(conflict.eventTitle).toBe('Blocking Event Alpha');
        expect(conflict.status).toBe(STATUS.PUBLISHED);
        expect(res.body._version).toBe(saved._version);
      });
    });

    describe('AR-23: Conflict with published event blocking the room', () => {
      it('should detect conflict with a published event occupying the same room/time', async () => {
        const publishedEvent = createBaseEvent({
          status: STATUS.PUBLISHED,
          eventTitle: 'Published Admin Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Restore Blocked By Published',
          previousStatus: STATUS.PUBLISHED,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [publishedEvent]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
        expect(res.body.conflicts).toHaveLength(1);
        expect(res.body.conflicts[0].status).toBe(STATUS.PUBLISHED);
      });
    });

    describe('AR-24: Conflict check runs when previousStatus is published', () => {
      it('should run conflict check when restoring an event whose previous status was published', async () => {
        const existing = createPublishedEvent({
          eventTitle: 'Existing Published Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Previously Published Event',
          previousStatus: STATUS.PUBLISHED,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'admin@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${saved._id}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
      });
    });

    describe('AR-25: Conflict detection with production data structure (calendarData strings)', () => {
      it('should detect conflict when events only have calendarData.startDateTime as strings (no top-level)', async () => {
        // Production events store startDateTime as strings in calendarData, not as BSON Dates at top level
        const existingId = new ObjectId();
        const existing = {
          _id: existingId,
          eventId: 'production-published-event',
          status: STATUS.PUBLISHED,
          isDeleted: false,
          eventTitle: 'Published Via Unified Form',
          calendarData: {
            eventTitle: 'Published Via Unified Form',
            startDateTime: '2026-03-15T10:00:00',
            endDateTime: '2026-03-15T12:00:00',
            locations: [roomId],
            setupTimeMinutes: 0,
            teardownTimeMinutes: 0,
          },
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'admin@test.com' },
          ],
          _version: 1,
        };

        const deletedId = new ObjectId();
        const deleted = {
          _id: deletedId,
          eventId: 'production-deleted-event',
          status: STATUS.DELETED,
          isDeleted: true,
          eventTitle: 'Deleted Reservation',
          calendarData: {
            eventTitle: 'Deleted Reservation',
            startDateTime: '2026-03-15T10:30:00',
            endDateTime: '2026-03-15T11:30:00',
            locations: [roomId],
            setupTimeMinutes: 0,
            teardownTimeMinutes: 0,
          },
          locations: [roomId],
          deletedAt: new Date(),
          deletedBy: 'admin@emanuelnyc.org',
          statusHistory: [
            { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
          _version: 1,
          userId: 'test-user',
          calendarOwner: 'templeeventssandbox@emanuelnyc.org',
        };

        await db.collection(COLLECTIONS.EVENTS).insertMany([existing, deleted]);

        const res = await request(app)
          .put(`/api/admin/events/${deletedId}/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ _version: 1 });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
        expect(res.body.conflicts).toHaveLength(1);
        expect(res.body.conflicts[0].eventTitle).toBe('Published Via Unified Form');
      });
    });
  });
});
