/**
 * Pending Edit Conflict Tests (PEN-1 to PEN-6)
 *
 * Tests that pending edit requests on published events are detected
 * as hard blocks in scheduling conflict detection.
 */

const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Pending Edit Conflict Tests (PEN-1 to PEN-6)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  const roomA = new ObjectId();
  const roomB = new ObjectId();

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

  // PEN-1: New event blocked when pending edit proposes same room/time
  describe('PEN-1: Pending edit blocks new event publish', () => {
    it('should return 409 when publishing a new event that conflicts with a pending edit proposal', async () => {
      // Published event in Room A with pending edit to move to Room B at 10:00-12:00
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
          locationDisplayNames: 'Room B',
        },
      });

      // New pending event trying to use Room B at 10:00-12:00
      const newEvent = createPendingEvent({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
      });

      await insertEvents(db, [editEvent, newEvent]);

      const res = await request(app)
        .put(`/api/admin/events/${newEvent._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: newEvent._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflicts.length).toBeGreaterThan(0);
    });
  });

  // PEN-2: Pending edit conflict includes isPendingEdit flag in 409 response
  describe('PEN-2: Conflict response includes isPendingEdit flag', () => {
    it('should include isPendingEdit: true in the conflict details', async () => {
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
        },
      });

      const newEvent = createPendingEvent({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
      });

      await insertEvents(db, [editEvent, newEvent]);

      const res = await request(app)
        .put(`/api/admin/events/${newEvent._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: newEvent._version });

      expect(res.status).toBe(409);
      const pendingEditConflict = res.body.conflicts.find(c => c.isPendingEdit);
      expect(pendingEditConflict).toBeDefined();
      expect(pendingEditConflict.isPendingEdit).toBe(true);
    });
  });

  // PEN-3: Approved/rejected edit requests NOT included
  describe('PEN-3: Approved/rejected edits not detected as conflicts', () => {
    it('should not detect conflicts from already-approved edit requests', async () => {
      // Published event with APPROVED (not pending) edit request
      const approvedEditEvent = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
        },
      });
      // Override the edit request status to 'approved'
      approvedEditEvent.pendingEditRequest.status = 'approved';

      const newEvent = createPendingEvent({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
      });

      await insertEvents(db, [approvedEditEvent, newEvent]);

      const res = await request(app)
        .put(`/api/admin/events/${newEvent._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: newEvent._version });

      // Should succeed since the edit request is already approved (not pending)
      expect(res.status).toBe(200);
    });
  });

  // PEN-4: Self-exclusion works for pending edit conflicts
  describe('PEN-4: Self-exclusion for pending edits', () => {
    it('should not conflict an event with its own pending edit', async () => {
      // A published event with a pending edit (proposing to change rooms)
      // When we try to publish-edit this same event, it should not conflict with itself
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
        },
      });
      await insertEvents(db, [eventWithEdit]);

      // Publish the edit request on the same event - should not self-conflict
      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // PEN-5: Time-only edit changes detected as conflicts
  describe('PEN-5: Time-only pending edit blocks new event', () => {
    it('should detect conflict when pending edit proposes overlapping times in same room', async () => {
      // Published event in Room A from 10:00-12:00 with pending edit to 14:00-16:00
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          startDateTime: '2026-04-15T14:00:00',
          endDateTime: '2026-04-15T16:00:00',
        },
      });

      // New event trying to use Room A from 13:00-15:00 (overlaps proposed 14:00-16:00)
      const newEvent = createPendingEvent({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T13:00:00'),
        endDateTime: new Date('2026-04-15T15:00:00'),
      });

      await insertEvents(db, [editEvent, newEvent]);

      const res = await request(app)
        .put(`/api/admin/events/${newEvent._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: newEvent._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      const pendingEditConflict = res.body.conflicts.find(c => c.isPendingEdit);
      expect(pendingEditConflict).toBeDefined();
    });
  });

  // PEN-6: Room availability returns pendingEdits array
  describe('PEN-6: Room availability includes pendingEdits', () => {
    it('should return pendingEdits in the availability response', async () => {
      // Create a room in the locations collection
      await db.createCollection(COLLECTIONS.LOCATIONS).catch(() => {});
      await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
      await db.collection(COLLECTIONS.LOCATIONS).insertOne({
        _id: roomB,
        name: 'Room B',
        displayName: 'Room B',
        isReservable: true,
        active: true,
      });

      // Published event in Room A with pending edit to Room B
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
          locationDisplayNames: 'Room B',
        },
      });
      await insertEvents(db, [editEvent]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          startDateTime: '2026-04-15T08:00:00',
          endDateTime: '2026-04-15T18:00:00',
          roomIds: roomB.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);

      const roomBAvailability = res.body[0];
      expect(roomBAvailability.conflicts.pendingEdits).toBeDefined();
      expect(roomBAvailability.conflicts.pendingEdits.length).toBe(1);

      const pendingEdit = roomBAvailability.conflicts.pendingEdits[0];
      expect(pendingEdit.isPendingEdit).toBe(true);
      expect(pendingEdit.status).toBe('pending-edit');
    });
  });
});
