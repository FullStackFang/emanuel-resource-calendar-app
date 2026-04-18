/**
 * Pending Edit Tests (PE-1 to PE-12)
 *
 * Tests requester ability to edit their own pending events via
 * PUT /api/room-reservations/:id/edit
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createOtherRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createDraftEvent,
  createPublishedEvent,
  createRejectedEvent,
  createDeletedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Pending Edit Tests (PE-1 to PE-12)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let otherRequesterUser;
  let otherRequesterToken;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('pendingEdit'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
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
    eventTitle: 'Updated Event Title',
    eventDescription: 'Updated description',
    startDate: '2026-03-15',
    startTime: '10:00',
    endDate: '2026-03-15',
    endTime: '12:00',
    attendeeCount: 25,
    requestedRooms: [],
    specialRequirements: 'Updated requirements',
    categories: ['meeting'],
    services: {},
  };

  // ============================================
  // PE-1: Owner can edit own pending event
  // ============================================
  describe('PE-1: Owner can edit own pending event', () => {
    it('should return 200 and update fields', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Reservation updated successfully');
      expect(res.body.reservation).toBeDefined();
      expect(res.body._version).toBeDefined();
    });
  });

  // ============================================
  // PE-2: Non-owner cannot edit another's pending event
  // ============================================
  describe('PE-2: Non-owner cannot edit another\'s pending event', () => {
    it('should return 403', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${otherRequesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/only edit/i);
    });
  });

  // ============================================
  // PE-3 to PE-6: Cannot edit non-pending events
  // ============================================
  describe('PE-3: Cannot edit a draft event', () => {
    it('should return 400', async () => {
      const draftEvent = createDraftEvent({ requesterUser });
      await insertEvents(db, [draftEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${draftEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: draftEvent._version });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only pending or rejected');
    });
  });

  describe('PE-4: Cannot edit a published event', () => {
    it('should return 400', async () => {
      const publishedEvent = createPublishedEvent({ requesterUser });
      await insertEvents(db, [publishedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${publishedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: publishedEvent._version });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only pending or rejected');
    });
  });

  describe('PE-5: Rejected events are now editable (see rejectedEdit.test.js)', () => {
    it('should return 200 for rejected events (edit + resubmit)', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Reservation updated successfully');
    });
  });

  describe('PE-6: Cannot edit a deleted event', () => {
    it('should return 400', async () => {
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

  // ============================================
  // PE-7: Version conflict returns 409
  // ============================================
  describe('PE-7: Version conflict returns 409', () => {
    it('should return 409 when version does not match', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: 999 });

      expect(res.status).toBe(409);
    });
  });

  // ============================================
  // PE-8: Title update persists in DB
  // ============================================
  describe('PE-8: Title update persists in DB', () => {
    it('should persist updated title in calendarData', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      const updated = await findEvent(db, pendingEvent._id);
      expect(updated.calendarData.eventTitle).toBe('Updated Event Title');
    });
  });

  // ============================================
  // PE-9: DateTime update persists
  // ============================================
  describe('PE-9: DateTime update persists', () => {
    it('should persist updated datetime in calendarData', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      const updated = await findEvent(db, pendingEvent._id);
      expect(updated.calendarData.startDate).toBe('2026-03-15');
      expect(updated.calendarData.startTime).toBe('10:00');
      expect(updated.calendarData.endDate).toBe('2026-03-15');
      expect(updated.calendarData.endTime).toBe('12:00');
      expect(updated.calendarData.startDateTime).toContain('2026-03-15T10:00');
      expect(updated.calendarData.endDateTime).toContain('2026-03-15T12:00');
    });
  });

  // ============================================
  // PE-10: Room changes persist
  // ============================================
  describe('PE-10: Room changes persist', () => {
    it('should persist updated rooms in calendarData.locations as ObjectIds', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      const roomObjId1 = new ObjectId();
      const roomObjId2 = new ObjectId();
      const roomIds = [roomObjId1.toString(), roomObjId2.toString()];
      await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, requestedRooms: roomIds, _version: pendingEvent._version });

      const updated = await findEvent(db, pendingEvent._id);
      expect(updated.calendarData.locations).toHaveLength(2);
      expect(updated.calendarData.locations[0]).toEqual(roomObjId1);
      expect(updated.calendarData.locations[1]).toEqual(roomObjId2);
    });
  });

  // ============================================
  // PE-11: StatusHistory records the edit
  // ============================================
  describe('PE-11: StatusHistory unchanged on pending edit (no status change)', () => {
    it('should NOT push a statusHistory entry for edits that do not change status', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      const originalHistoryLength = pendingEvent.statusHistory.length;

      await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      const updated = await findEvent(db, pendingEvent._id);
      // No status change (pending → pending), so no new history entry
      expect(updated.statusHistory.length).toBe(originalHistoryLength);
    });
  });

  // ============================================
  // PE-12: Status remains pending after edit
  // ============================================
  describe('PE-12: Status remains pending after edit', () => {
    it('should keep status as pending', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(200);
      const updated = await findEvent(db, pendingEvent._id);
      expect(updated.status).toBe('pending');
    });
  });
});
