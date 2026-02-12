/**
 * Requester Role Workflow Tests (R-1 to R-29)
 *
 * Tests requester role capabilities including:
 * - Own event management (draft, pending, approved states)
 * - Ownership enforcement (cannot access other's events)
 * - Edit request workflow
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase, getTestCollections } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createOtherRequester,
  createApprover,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createApprovedEvent,
  createRejectedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Requester Role Workflow Tests (R-1 to R-29)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let otherRequesterUser;
  let otherRequesterToken;
  let approverUser;

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
    await db.createCollection(COLLECTIONS.LOCATIONS);
    await db.createCollection(COLLECTIONS.RESERVATION_TOKENS);
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
    await db.collection(COLLECTIONS.RESERVATION_TOKENS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    // Create test users
    requesterUser = createRequester();
    otherRequesterUser = createOtherRequester();
    approverUser = createApprover();
    await insertUsers(db, [requesterUser, otherRequesterUser, approverUser]);

    // Create tokens
    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
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
      expect(res.body.draft).toBeDefined();
      expect(res.body.draft.status).toBe(STATUS.DRAFT);
      expect(res.body.draft.eventTitle).toBe('My New Event');
      expect(res.body.draft.userId).toBe(requesterUser.odataId);

      // Verify in database
      const savedDraft = await db.collection(COLLECTIONS.EVENTS).findOne({
        eventId: res.body.draft.eventId,
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
        eventId: res.body.draft.eventId,
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

      expect(res.body.success).toBe(true);
      expect(res.body.draft.calendarData.eventTitle).toBe('Updated Title');
      expect(res.body.draft.calendarData.eventDescription).toBe('New description');
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

  describe('R-7: Requester CANNOT approve own pending', () => {
    it('should return 403 for self-approval', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/approve`)
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

  describe('R-9: Requester CAN cancel own pending (future: not implemented in test app)', () => {
    // Note: This would require a specific cancel endpoint
    // For now, we test that requesters cannot delete pending via admin endpoint
    it('should return 403 when trying to delete pending via admin endpoint', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPending._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  // ============================================
  // PUBLISHED STATE (OWN) - R-10 to R-13
  // ============================================

  describe('R-10: Requester CAN view own published (approved)', () => {
    it('should return own approved events', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'My Approved Event',
      });
      await insertEvents(db, [approved]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.reservations).toHaveLength(1);
      expect(res.body.reservations[0].status).toBe(STATUS.APPROVED);
    });
  });

  describe('R-11: Requester CANNOT directly edit own published', () => {
    it('should return 403 for direct edit attempt', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedApproved] = await insertEvents(db, [approved]);

      // Try to edit via draft endpoint (should not work for approved events)
      const res = await request(app)
        .put(`/api/room-reservations/draft/${savedApproved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventTitle: 'Updated Approved' })
        .expect(404); // Draft not found (it's approved, not draft)

      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('R-12: Requester CAN request edit on own published', () => {
    it('should create pendingEditRequest', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
      });
      const [savedApproved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .post(`/api/events/${savedApproved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedChanges: { eventTitle: 'New Title' },
          reason: 'Need to update title',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest).toBeDefined();
      expect(res.body.event.pendingEditRequest.requestedChanges.eventTitle).toBe('New Title');
    });
  });

  describe('R-13: Requester CANNOT delete own published', () => {
    it('should return 403 for delete attempt', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedApproved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedApproved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  // ============================================
  // EDIT REQUEST (OWN) - R-14 to R-17
  // ============================================

  describe('R-14: Requester CAN view own edit request status', () => {
    it('should see pendingEditRequest in event data', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      approved.pendingEditRequest = {
        requestedAt: new Date(),
        requestedBy: requesterUser.email,
        requestedChanges: { eventTitle: 'New Title' },
        reason: 'Update needed',
      };
      const [savedApproved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.reservations[0].pendingEditRequest).toBeDefined();
      expect(res.body.reservations[0].pendingEditRequest.reason).toBe('Update needed');
    });
  });

  describe('R-16: Requester CANNOT approve own edit request', () => {
    it('should return 403 for self-approval of edit request', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      approved.pendingEditRequest = {
        requestedAt: new Date(),
        requestedBy: requesterUser.email,
        requestedChanges: { eventTitle: 'New Title' },
        reason: 'Update needed',
      };
      const [savedApproved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .put(`/api/admin/events/${savedApproved._id}/approve-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('R-17: Requester CANNOT create duplicate edit request', () => {
    it('should return 400 when edit request already exists', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      approved.pendingEditRequest = {
        requestedAt: new Date(),
        requestedBy: requesterUser.email,
        requestedChanges: { eventTitle: 'First Request' },
        reason: 'First reason',
      };
      const [savedApproved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .post(`/api/events/${savedApproved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedChanges: { eventTitle: 'Second Request' },
          reason: 'Second reason',
        })
        .expect(400);

      expect(res.body.error).toMatch(/already exists/i);
    });
  });

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

  describe('R-25: Requester CANNOT request edit on other\'s published', () => {
    it('should return 403 when trying to request edit on other user\'s event', async () => {
      const otherApproved = createApprovedEvent({
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
      });
      const [savedApproved] = await insertEvents(db, [otherApproved]);

      const res = await request(app)
        .post(`/api/events/${savedApproved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedChanges: { eventTitle: 'Hacked Title' },
          reason: 'Unauthorized request',
        })
        .expect(403);

      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

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
