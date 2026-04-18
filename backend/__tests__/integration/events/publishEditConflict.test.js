/**
 * Publish-Edit Conflict Tests (PEC-1 to PEC-8)
 *
 * Tests scheduling conflict detection on the publish-edit endpoint
 * PUT /api/admin/events/:id/publish-edit
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Publish-Edit Conflict Tests (PEC-1 to PEC-8)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  const roomA = new ObjectId();
  const roomB = new ObjectId();
  const roomC = new ObjectId();

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('publishEditConflict'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
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

  // PEC-1: Publish-edit with no conflicts succeeds
  describe('PEC-1: Publish-edit with no conflicts', () => {
    it('should succeed when proposed changes do not conflict', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
          locationDisplayNames: 'Room B',
        },
      });
      await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // PEC-2: Publish-edit blocked when proposed room/time conflicts
  describe('PEC-2: Publish-edit blocked by conflict', () => {
    it('should return 409 when proposed changes conflict with existing event', async () => {
      // Existing published event in Room B
      const existing = createPublishedEvent({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
      });

      // Event requesting to move from Room A to Room B (same time)
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
          locationDisplayNames: 'Room B',
        },
      });
      await insertEvents(db, [existing, eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflicts.length).toBeGreaterThan(0);
      expect(res.body.canForce).toBe(true);
      expect(res.body.forceField).toBe('forcePublishEdit');
    });
  });

  // PEC-3: Publish-edit succeeds with forcePublishEdit: true
  describe('PEC-3: Force publish-edit overrides conflict', () => {
    it('should succeed with forcePublishEdit despite conflicts', async () => {
      const existing = createPublishedEvent({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
      });

      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
          locationDisplayNames: 'Room B',
        },
      });
      await insertEvents(db, [existing, eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Force approved',
          _version: eventWithEdit._version,
          forcePublishEdit: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // PEC-4: Self-exclusion - event doesn't conflict with itself
  describe('PEC-4: Self-exclusion', () => {
    it('should not conflict with itself when room stays the same', async () => {
      // Edit request that only changes the title, same room/time
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          eventTitle: 'Updated Title',
          locations: [roomA], // Same room
        },
      });
      await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // PEC-5: Time-only change conflicts detected
  describe('PEC-5: Time-only change conflict', () => {
    it('should detect conflict when time change overlaps existing event', async () => {
      // Existing event in Room A from 14:00-16:00
      const existing = createPublishedEvent({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T14:00:00'),
        endDateTime: new Date('2026-04-15T16:00:00'),
      });

      // Event in Room A from 10:00-12:00, requesting to move to 13:00-15:00 (overlaps)
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          startDateTime: '2026-04-15T13:00:00',
          endDateTime: '2026-04-15T15:00:00',
        },
      });
      await insertEvents(db, [existing, eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  // PEC-6: Room-only change conflicts detected
  describe('PEC-6: Room-only change conflict', () => {
    it('should detect conflict when room change overlaps existing event', async () => {
      // Existing event in Room B from 10:00-12:00
      const existing = createPublishedEvent({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
      });

      // Event in Room A from 10:00-12:00, requesting to move to Room B
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
        },
      });
      await insertEvents(db, [existing, eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  // PEC-7: Room + time change conflicts detected
  describe('PEC-7: Room + time change conflict', () => {
    it('should detect conflict when both room and time changes overlap', async () => {
      // Existing event in Room C from 14:00-16:00
      const existing = createPublishedEvent({
        locations: [roomC],
        startDateTime: new Date('2026-04-15T14:00:00'),
        endDateTime: new Date('2026-04-15T16:00:00'),
      });

      // Event in Room A from 10:00-12:00, requesting Room C at 13:00-15:00 (overlaps)
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomC],
          startDateTime: '2026-04-15T13:00:00',
          endDateTime: '2026-04-15T15:00:00',
        },
      });
      await insertEvents(db, [existing, eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  // PEC-8: No time/room change skips conflict check
  describe('PEC-8: Non-time/room changes skip conflict check', () => {
    it('should not run conflict check when only title changes', async () => {
      // Existing event in Room A at same time
      const existing = createPublishedEvent({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
      });

      // Event with edit request that only changes the title (no room/time change)
      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          eventTitle: 'Updated Title Only',
          eventDescription: 'Updated description',
        },
      });
      await insertEvents(db, [existing, eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${eventWithEdit._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved', _version: eventWithEdit._version });

      // Title-only change should skip conflict check entirely
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
