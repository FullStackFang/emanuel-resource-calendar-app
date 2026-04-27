/**
 * Requester Role Workflow Tests (R-1 to R-29)
 *
 * Tests requester role capabilities including:
 * - Own event management (draft, pending, published states)
 * - Ownership enforcement (cannot access other's events)
 * - Edit request workflow
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createOtherRequester,
  createApprover,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createPublishedEvent,
  createRejectedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Requester Role Workflow Tests (R-1 to R-29)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let otherRequesterUser;
  let approverUser;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('requesterWorkflow'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    // Clear collections
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.RESERVATION_TOKENS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    // Create test users
    requesterUser = createRequester();
    otherRequesterUser = createOtherRequester();
    approverUser = createApprover();
    await insertUsers(db, [requesterUser, otherRequesterUser, approverUser]);

    // Create tokens
    requesterToken = await createMockToken(requesterUser);
  });

  // ============================================
  // DRAFT STATE (OWN) - R-1 to R-5
  // ============================================

  describe('R-1: Requester CAN create own draft', () => {
    it('should create a draft with status=draft', async () => {
      const res = await request(app)
        .post('/api/room-reservations/draft')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'My New Event',
          eventDescription: 'Test description',
          startDateTime: new Date(Date.now() + 86400000).toISOString(),
          endDateTime: new Date(Date.now() + 90000000).toISOString(),
          requesterName: requesterUser.displayName,
          requesterEmail: requesterUser.email,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(STATUS.DRAFT);
      expect(res.body.calendarData?.eventTitle || res.body.eventTitle).toBe('My New Event');
      expect(res.body.userId).toBe(requesterUser.odataId);

      // Verify in database
      const savedDraft = await db.collection(COLLECTIONS.EVENTS).findOne({
        eventId: res.body.eventId,
      });
      expect(savedDraft).toBeDefined();
      expect(savedDraft.status).toBe(STATUS.DRAFT);
    });

    it('should create audit log entry on draft creation', async () => {
      const res = await request(app)
        .post('/api/room-reservations/draft')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Audit Test Event',
          startDateTime: new Date(Date.now() + 86400000).toISOString(),
          endDateTime: new Date(Date.now() + 90000000).toISOString(),
        })
        .expect(201);

      await assertAuditEntry(db, {
        eventId: res.body.eventId,
        action: 'created',
        performedBy: requesterUser.odataId,
      });
    });

    it('should require eventTitle, startDateTime, endDateTime', async () => {
      const res = await request(app)
        .post('/api/room-reservations/draft')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Missing dates',
        })
        .expect(400);

      expect(res.body.error).toMatch(/missing required fields/i);
    });
  });

  describe('R-2: Requester CAN view own drafts', () => {
    it('should return own drafts in my reservations', async () => {
      // Create a draft for the requester
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'My Draft',
      });
      await insertEvents(db, [draft]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.reservations).toHaveLength(1);
      expect(res.body.reservations[0].eventTitle).toBe('My Draft');
      expect(res.body.reservations[0].status).toBe(STATUS.DRAFT);
    });
  });

  describe('R-3: Requester CAN edit own draft', () => {
    it('should update draft fields', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${savedDraft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Updated Title',
          eventDescription: 'New description',
        })
        .expect(200);

      expect(res.body.calendarData.eventTitle).toBe('Updated Title');
      expect(res.body.calendarData.eventDescription).toBe('New description');
    });
  });

  describe('R-4: Requester CAN submit own draft', () => {
    it('should transition draft to pending', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Submit Me',
        locations: [{ displayName: 'Room A' }],
        categories: ['Meeting'],
        setupTime: '15 minutes',
        doorOpenTime: '09:00',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PENDING);

      // Verify audit log
      await assertAuditEntry(db, {
        eventId: savedDraft.eventId,
        action: 'submitted',
        performedBy: requesterUser.odataId,
      });
    });
  });

  describe('R-5: Requester CAN delete own draft', () => {
    it('should soft delete the draft', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Delete Me',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .delete(`/api/room-reservations/draft/${savedDraft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify soft delete in database
      const deletedDraft = await db.collection(COLLECTIONS.EVENTS).findOne({
        _id: savedDraft._id,
      });
      expect(deletedDraft.isDeleted).toBe(true);
      expect(deletedDraft.status).toBe(STATUS.DELETED);
    });
  });

  // ============================================
  // PENDING STATE (OWN) - R-6 to R-9
  // ============================================

  describe('R-6: Requester CAN view own pending', () => {
    it('should return own pending events', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'My Pending Event',
      });
      await insertEvents(db, [pending]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.reservations).toHaveLength(1);
      expect(res.body.reservations[0].status).toBe(STATUS.PENDING);
    });
  });

  describe('R-7: Requester CANNOT publish own pending', () => {
    it('should return 403 for self-publish', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/publish`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('R-8: Requester CANNOT reject own pending', () => {
    it('should return 403 for self-rejection', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Self rejection' })
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('R-9: Requester CAN withdraw own pending', () => {
    it('should soft delete own pending event when reason is provided', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Withdraw Me',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPending._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Changed my mind' })
        .expect(200);

      expect(res.body.success).toBe(true);

      const deletedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({
        _id: savedPending._id,
      });
      expect(deletedEvent.isDeleted).toBe(true);
      expect(deletedEvent.status).toBe(STATUS.DELETED);
    });

    it('should return 400 when reason is missing', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPending._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({})
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('should return 400 when reason is whitespace-only', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPending._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: '   ' })
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('should return 403 when trying to delete other requester\'s pending', async () => {
      const otherPending = createPendingEvent({
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [otherPending]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPending._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Trying to withdraw someone else\'s' })
        .expect(403);

      expect(res.body.error).toMatch(/your own pending/i);
    });

    it('should return 403 when trying to delete own published event', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Want to delete published' })
        .expect(403);

      expect(res.body.error).toMatch(/your own pending/i);
    });
  });

  // ============================================
  // PUBLISHED STATE (OWN) - R-10 to R-13
  // ============================================

  describe('R-10: Requester CAN view own published', () => {
    it('should return own published events', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'My Published Event',
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.reservations).toHaveLength(1);
      expect(res.body.reservations[0].status).toBe(STATUS.PUBLISHED);
    });
  });

  describe('R-11: Requester CANNOT directly edit own published', () => {
    it('should return 403 for direct edit attempt', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      // Try to edit via draft endpoint (should not work for published events)
      const res = await request(app)
        .put(`/api/room-reservations/draft/${savedPublished._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventTitle: 'Updated Published' })
        .expect(404); // Draft not found (it's published, not draft)

      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // R-12 (requester CAN request edit on own published) — coverage now lives in
  // editRequestsCreate.test.js 'happy path > creates a pending edit request in the
  // new collection'. Legacy /api/events/:id/request-edit endpoint deleted in 1d.

  describe('R-13: Requester CANNOT delete own published', () => {
    it('should return 403 for delete attempt', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/your own pending/i);
    });
  });

  // ============================================
  // EDIT REQUEST (OWN) - R-14 to R-17
  // ============================================

  // R-14, R-16, R-17 — coverage moved to editRequestsCreate.test.js
  // (DUPLICATE_PENDING_REQUEST guard) and editRequestsApprove.test.js
  // (requester 403 on approve). The pendingEditRequest field is no longer
  // embedded on event documents post-Phase-1d; visibility flows through
  // GET /api/edit-requests?userId=... instead.

  // ============================================
  // REJECTED STATE (OWN) - R-18 to R-20
  // ============================================

  describe('R-18: Requester CAN view own rejected', () => {
    it('should return own rejected events', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'My Rejected Event',
      });
      await insertEvents(db, [rejected]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.reservations).toHaveLength(1);
      expect(res.body.reservations[0].status).toBe(STATUS.REJECTED);
    });
  });

  describe('R-19: Requester CAN view rejection reason', () => {
    it('should include rejectionReason in event data', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        rejectionReason: 'Room not available',
      });
      await insertEvents(db, [rejected]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.reservations[0].rejectionReason).toBe('Room not available');
    });
  });

  // ============================================
  // OWNERSHIP ENFORCEMENT (OTHERS) - R-21 to R-27
  // ============================================

  describe('R-21: Requester CANNOT view other\'s drafts', () => {
    it('should not return other user\'s drafts in my reservations', async () => {
      // Create a draft for the other requester
      const otherDraft = createDraftEvent({
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
        eventTitle: 'Other User Draft',
      });
      await insertEvents(db, [otherDraft]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      // Should be empty - other user's drafts not visible
      expect(res.body.reservations).toHaveLength(0);
    });
  });

  describe('R-22: Requester CANNOT edit other\'s draft', () => {
    it('should return 403 when trying to edit other user\'s draft', async () => {
      const otherDraft = createDraftEvent({
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [otherDraft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${savedDraft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventTitle: 'Hacked Title' })
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('R-23: Requester CANNOT delete other\'s draft', () => {
    it('should return 403 when trying to delete other user\'s draft', async () => {
      const otherDraft = createDraftEvent({
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [otherDraft]);

      const res = await request(app)
        .delete(`/api/room-reservations/draft/${savedDraft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('R-24: Requester CANNOT submit other\'s draft', () => {
    it('should return 403 when trying to submit other user\'s draft', async () => {
      const otherDraft = createDraftEvent({
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [otherDraft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  // R-25 — coverage moved to editRequestsCreate.test.js 'permission gate >
  // rejects submission from a non-owner not in the same department'.

  // ============================================
  // ADMIN ACTIONS - R-28 to R-29
  // ============================================

  describe('R-28: Requester CANNOT access admin endpoints', () => {
    it('should return 403 for admin events endpoint', async () => {
      const res = await request(app)
        .get('/api/admin/events')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('R-29: Requester CANNOT generate reservation tokens', () => {
    it('should return 403 for token generation', async () => {
      const res = await request(app)
        .post('/api/room-reservations/generate-token')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });
});
