/**
 * Owner Restore Tests (OR-1 to OR-17)
 *
 * Tests the owner restore endpoint PUT /api/room-reservations/:id/restore.
 * Owners can restore their own deleted or cancelled reservations.
 * OR-3 to OR-4, OR-10 test Graph API republishing on restore.
 * OR-11 to OR-15 test scheduling conflict detection on restore.
 */

const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createOtherRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createBaseEvent,
  createDeletedEvent,
  createApprovedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Owner Restore Tests (OR-1 to OR-17)', () => {
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
    otherRequesterUser = createOtherRequester();
    await insertUsers(db, [requesterUser, otherRequesterUser]);

    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
  });

  describe('OR-1: Restore deleted reservation to previous status (approved)', () => {
    it('should restore a deleted reservation to its previous approved status', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Previously Approved Reservation',
        previousStatus: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-02'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(STATUS.APPROVED);
      expect(res.body._version).toBe((saved._version || 0) + 1);
    });
  });

  describe('OR-2: Restore cancelled reservation to previous status (pending)', () => {
    it('should restore a cancelled reservation to its previous pending status', async () => {
      const cancelled = createBaseEvent({
        eventTitle: 'Previously Pending Reservation',
        status: 'cancelled',
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
          { status: 'cancelled', changedAt: new Date('2026-01-02'), changedByEmail: requesterUser.email },
        ],
      });
      const [saved] = await insertEvents(db, [cancelled]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(STATUS.PENDING);
      expect(res.body._version).toBe((saved._version || 0) + 1);
    });
  });

  describe('OR-3: Recreate Graph event when restoring deleted event with graphData.id', () => {
    it('should republish to Outlook when restored event had graphData', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Published Reservation',
        previousStatus: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        graphData: {
          id: 'AAMkAGraphOriginal123',
          webLink: 'https://outlook.office365.com/calendar/item/original',
          changeKey: 'old-change-key',
        },
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-02'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.graphPublished).toBe(true);

      // Verify Graph API was called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.subject).toBe('Published Reservation');

      // Verify new Graph IDs stored in MongoDB
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.graphData.id).not.toBe('AAMkAGraphOriginal123');
      expect(restored.graphData.webLink).toBeDefined();
    });
  });

  describe('OR-4: Skip Graph recreation when restoring event without graphData.id', () => {
    it('should not call Graph API when restored event had no graphData', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Non-Published Reservation',
        previousStatus: STATUS.PENDING,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        graphData: null,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.graphPublished).toBe(false);

      // Verify Graph API was NOT called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(0);
    });
  });

  describe('OR-5: Return 403 when non-owner tries to restore', () => {
    it('should reject restore from a different user', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Someone Else Reservation',
        previousStatus: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${otherRequesterToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/only restore your own/i);
    });
  });

  describe('OR-6: Return 404 when event not found or not deleted/cancelled', () => {
    it('should return 404 for non-existent event', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(fakeId))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(404);
    });

    it('should return 404 for an approved event (not deleted/cancelled)', async () => {
      const approved = createBaseEvent({
        eventTitle: 'Approved Reservation',
        status: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
      });
      const [saved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(404);
    });
  });

  describe('OR-7: Version conflict returns 409', () => {
    it('should return 409 when _version does not match', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Stale Version Reservation',
        previousStatus: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        _version: 3,
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: 1 }); // Stale version

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('VERSION_CONFLICT');
    });
  });

  describe('OR-8: StatusHistory entry pushed on restore', () => {
    it('should add a statusHistory entry with restore reason', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'StatusHistory Test Reservation',
        previousStatus: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-02'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.statusHistory).toHaveLength(4);

      const lastEntry = restored.statusHistory[3];
      expect(lastEntry.status).toBe(STATUS.APPROVED);
      expect(lastEntry.changedByEmail).toBe(requesterUser.email);
      expect(lastEntry.reason).toMatch(/Restored from deleted by owner/);
    });
  });

  describe('OR-9: Deletion fields cleaned up when restoring from deleted (not cancelled)', () => {
    it('should clear isDeleted, deletedAt, deletedBy, deletedByEmail for deleted events', async () => {
      const deleted = createDeletedEvent({
        eventTitle: 'Cleanup Test Reservation',
        previousStatus: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        deletedBy: 'admin@emanuelnyc.org',
        deletedByEmail: 'admin@emanuelnyc.org',
      });
      const [saved] = await insertEvents(db, [deleted]);

      await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.isDeleted).toBe(false);
      expect(restored.deletedAt).toBeUndefined();
      expect(restored.deletedBy).toBeUndefined();
      expect(restored.deletedByEmail).toBeUndefined();
      expect(restored.status).toBe(STATUS.APPROVED);
    });

    it('should NOT unset deletion fields when restoring from cancelled', async () => {
      const cancelled = createBaseEvent({
        eventTitle: 'Cancelled Reservation',
        status: 'cancelled',
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
          { status: 'cancelled', changedAt: new Date('2026-01-02'), changedByEmail: requesterUser.email },
        ],
      });
      const [saved] = await insertEvents(db, [cancelled]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(STATUS.PENDING);

      // isDeleted should remain whatever it was (false for cancelled)
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.status).toBe(STATUS.PENDING);
    });
  });

  describe('OR-10: Graph recreation failure does not fail the restore', () => {
    it('should still restore successfully when Graph API throws an error', async () => {
      // Set Graph API to throw
      graphApiMock.setMockError('createCalendarEvent', new Error('Graph API unavailable'));

      const deleted = createDeletedEvent({
        eventTitle: 'Graph Fail Reservation',
        previousStatus: STATUS.APPROVED,
        requesterEmail: requesterUser.email,
        userId: requesterUser.odataId,
        graphData: {
          id: 'AAMkAGraphOriginal456',
          webLink: 'https://outlook.office365.com/calendar/item/original',
          changeKey: 'old-change-key',
        },
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
          { status: STATUS.APPROVED, changedAt: new Date('2026-01-02'), changedByEmail: 'approver@test.com' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedByEmail: 'admin@test.com' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: saved._version });

      // Restore should succeed even though Graph failed
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(STATUS.APPROVED);
      expect(res.body.graphPublished).toBe(false);

      // Verify the event was still restored in MongoDB
      const restored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(restored.status).toBe(STATUS.APPROVED);
      expect(restored.isDeleted).toBe(false);
    });
  });

  // ============================================
  // OR-11 to OR-15: Scheduling Conflict Detection
  // ============================================

  describe('Scheduling conflict detection', () => {
    const roomId = new ObjectId();
    const conflictStart = new Date('2026-03-15T10:00:00Z');
    const conflictEnd = new Date('2026-03-15T12:00:00Z');

    describe('OR-11: Conflict when restoring deleted to approved', () => {
      it('should return 409 SchedulingConflict', async () => {
        // Create an existing approved event occupying the room
        const existing = createApprovedEvent({
          eventTitle: 'Existing Approved Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        // Create the deleted event that would conflict
        const deleted = createDeletedEvent({
          eventTitle: 'Conflicting Deleted Reservation',
          previousStatus: STATUS.APPROVED,
          requesterEmail: requesterUser.email,
          userId: requesterUser.odataId,
          startDateTime: new Date('2026-03-15T11:00:00Z'),
          endDateTime: new Date('2026-03-15T13:00:00Z'),
          locations: [roomId],
          statusHistory: [
            { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
        expect(res.body.conflicts).toHaveLength(1);
        expect(res.body.previousStatus).toBe(STATUS.APPROVED);
      });
    });

    describe('OR-12: Conflict when restoring cancelled to pending', () => {
      it('should return 409 SchedulingConflict', async () => {
        const existing = createApprovedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const cancelled = createBaseEvent({
          eventTitle: 'Cancelled Reservation',
          status: 'cancelled',
          requesterEmail: requesterUser.email,
          userId: requesterUser.odataId,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
            { status: 'cancelled', changedAt: new Date('2026-01-02'), changedByEmail: requesterUser.email },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [cancelled]);

        const res = await request(app)
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
      });
    });

    describe('OR-13: No conflict check when restoring to draft', () => {
      it('should restore successfully without conflict check', async () => {
        const existing = createApprovedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Deleted Draft Reservation',
          previousStatus: STATUS.DRAFT,
          requesterEmail: requesterUser.email,
          userId: requesterUser.odataId,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.DRAFT, changedAt: new Date('2026-01-01'), changedByEmail: requesterUser.email },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(STATUS.DRAFT);
      });
    });

    describe('OR-14: forceRestore ignored for owners (still 409)', () => {
      it('should still return 409 even with forceRestore: true', async () => {
        const existing = createApprovedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Owner Cannot Force',
          previousStatus: STATUS.APPROVED,
          requesterEmail: requesterUser.email,
          userId: requesterUser.odataId,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: saved._version, forceRestore: true });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
      });
    });

    describe('OR-15: No conflict when event has no rooms', () => {
      it('should restore successfully when event has empty locations', async () => {
        const existing = createApprovedEvent({
          eventTitle: 'Existing Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Virtual Event',
          previousStatus: STATUS.APPROVED,
          requesterEmail: requesterUser.email,
          userId: requesterUser.odataId,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [],
          statusHistory: [
            { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [existing]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });

    describe('OR-16: Conflict with published event blocking the room', () => {
      it('should detect conflict with a published event occupying the same room/time', async () => {
        const publishedEvent = createBaseEvent({
          status: STATUS.PUBLISHED,
          eventTitle: 'Published Admin Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Owner Restore Blocked By Published',
          previousStatus: STATUS.APPROVED,
          requesterEmail: requesterUser.email,
          userId: requesterUser.odataId,
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
          statusHistory: [
            { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
        });

        await insertEvents(db, [publishedEvent]);
        const [saved] = await insertEvents(db, [deleted]);

        const res = await request(app)
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
        expect(res.body.conflicts).toHaveLength(1);
        expect(res.body.conflicts[0].status).toBe(STATUS.PUBLISHED);
      });
    });

    describe('OR-17: Conflict check runs when previousStatus is published', () => {
      it('should run conflict check when restoring an event whose previous status was published', async () => {
        const existing = createApprovedEvent({
          eventTitle: 'Existing Approved Event',
          startDateTime: conflictStart,
          endDateTime: conflictEnd,
          locations: [roomId],
        });

        const deleted = createDeletedEvent({
          eventTitle: 'Previously Published Event',
          previousStatus: STATUS.PUBLISHED,
          requesterEmail: requesterUser.email,
          userId: requesterUser.odataId,
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
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(saved._id))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: saved._version });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
      });
    });

    describe('OR-18: Conflict detection with production data structure (calendarData strings)', () => {
      it('should detect conflict when events only have calendarData.startDateTime as strings (no top-level)', async () => {
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
            { status: STATUS.APPROVED, changedAt: new Date('2026-01-01'), changedByEmail: 'approver@test.com' },
            { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedByEmail: 'admin@test.com' },
          ],
          _version: 1,
          userId: requesterUser.odataId,
          requesterEmail: requesterUser.email,
          calendarOwner: 'templeeventssandbox@emanuelnyc.org',
          roomReservationData: {
            requestedBy: { email: requesterUser.email },
          },
        };

        await db.collection(COLLECTIONS.EVENTS).insertMany([existing, deleted]);

        const res = await request(app)
          .put(ENDPOINTS.OWNER_RESTORE_RESERVATION(deletedId))
          .set('Authorization', `Bearer ${requesterToken}`)
          .send({ _version: 1 });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SchedulingConflict');
        expect(res.body.conflicts).toHaveLength(1);
        expect(res.body.conflicts[0].eventTitle).toBe('Published Via Unified Form');
      });
    });
  });
});
