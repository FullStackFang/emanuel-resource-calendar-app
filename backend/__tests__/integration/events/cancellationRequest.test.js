/**
 * Cancellation Request Tests (CR-1 to CR-14)
 *
 * Tests the cancellation request workflow for published events.
 * Covers: submit, approve, reject, withdraw, permissions, mutual exclusion.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  createOwnerlessPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Cancellation Request Tests (CR-1 to CR-14)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('cancellationRequest'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  describe('Submit cancellation request', () => {
    it('CR-1: Submit on published event with valid reason -- succeeds', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Interfaith Lunch Group',
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Event cancelled for April' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.cancellationRequestId).toBeDefined();

      // Verify event has pendingCancellationRequest
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.pendingCancellationRequest).toBeDefined();
      expect(updated.pendingCancellationRequest.status).toBe('pending');
      expect(updated.pendingCancellationRequest.reason).toBe('Event cancelled for April');
      expect(updated.pendingCancellationRequest.requestedBy.email).toBe(requesterUser.email);
    });

    it('CR-2: Submit without reason -- 400', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({})
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('CR-3: Submit on non-published event -- 400', async () => {
      const pending = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      pending.status = STATUS.PENDING;
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Need to cancel' })
        .expect(400);

      expect(res.body.error).toMatch(/only.*published/i);
    });

    it('CR-4: Submit when pending edit request exists -- 400 (mutual exclusion)', async () => {
      const withEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [withEdit]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Need to cancel' })
        .expect(400);

      expect(res.body.error).toMatch(/edit request.*pending/i);
    });

    it('CR-5: Submit when pending cancellation already exists -- 400', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-existing',
        status: 'pending',
        reason: 'Already requested',
        requestedBy: { userId: requesterUser.odataId, email: requesterUser.email },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Duplicate request' })
        .expect(400);

      expect(res.body.error).toMatch(/already.*pending.*cancellation/i);
    });

    it('CR-6: Submit on owned event by non-owner/non-dept -- 403', async () => {
      const ownedByOther = createPublishedEvent({
        userId: 'other-user-id',
        requesterEmail: 'other@emanuelnyc.org',
        department: 'Other Department',
      });
      const [saved] = await insertEvents(db, [ownedByOther]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Want to cancel' })
        .expect(403);

      expect(res.body.error).toMatch(/permission|owner|department/i);
    });

    it('CR-7: Submit on ownerless event by any requester -- succeeds', async () => {
      const ownerless = createOwnerlessPublishedEvent({
        eventTitle: 'Defense Against the Dark Arts',
      });
      const [saved] = await insertEvents(db, [ownerless]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Event no longer happening' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.cancellationRequestId).toBeDefined();
    });
  });

  describe('Approve cancellation request', () => {
    it('CR-8: Approve -- event soft-deleted', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event to Cancel',
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-test',
        status: 'pending',
        reason: 'Cancelled for April',
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: 'Test Requester',
          department: '',
          phone: '',
          requestedAt: new Date(),
        },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/approve-cancellation`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: 'Confirmed with organizer' })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify event is soft-deleted
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.status).toBe('deleted');
      expect(updated.isDeleted).toBe(true);
      expect(updated.pendingCancellationRequest.status).toBe('approved');
      expect(updated.pendingCancellationRequest.reviewedBy.email).toBe(approverUser.email);

      // Verify statusHistory
      const lastHistory = updated.statusHistory[updated.statusHistory.length - 1];
      expect(lastHistory.status).toBe('deleted');
      expect(lastHistory.reason).toMatch(/cancellation request approved/i);
    });

    it('CR-8b: Requester cannot approve cancellation request -- 403', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-test',
        status: 'pending',
        reason: 'Cancel please',
        requestedBy: { userId: requesterUser.odataId, email: requesterUser.email },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .put(`/api/admin/events/${saved._id}/approve-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('Reject cancellation request', () => {
    it('CR-9: Reject with reason -- event stays published', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Keep This Event',
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-test',
        status: 'pending',
        reason: 'Want to cancel',
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: 'Test Requester',
          department: '',
          phone: '',
          requestedAt: new Date(),
        },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/reject-cancellation`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Event is still needed' })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify event stays published
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.status).toBe('published');
      expect(updated.pendingCancellationRequest.status).toBe('rejected');
      expect(updated.pendingCancellationRequest.reviewNotes).toBe('Event is still needed');
    });

    it('CR-10: Reject without reason -- 400', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-test',
        status: 'pending',
        reason: 'Cancel please',
        requestedBy: { userId: requesterUser.odataId, email: requesterUser.email },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/reject-cancellation`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({})
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });
  });

  describe('Withdraw cancellation request', () => {
    it('CR-11: Withdraw by request owner -- succeeds', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-test',
        status: 'pending',
        reason: 'Cancel please',
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: 'Test Requester',
          department: '',
          phone: '',
          requestedAt: new Date(),
        },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/events/cancellation-requests/${saved._id}/cancel`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify request is cancelled
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.pendingCancellationRequest.status).toBe('cancelled');
    });

    it('CR-12: Withdraw by non-owner -- 403', async () => {
      const published = createPublishedEvent({
        userId: 'other-user-id',
        requesterEmail: 'other@emanuelnyc.org',
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-test',
        status: 'pending',
        reason: 'Cancel please',
        requestedBy: {
          userId: 'other-user-id',
          email: 'other@emanuelnyc.org',
          name: 'Other User',
          department: '',
          phone: '',
          requestedAt: new Date(),
        },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .put(`/api/events/cancellation-requests/${saved._id}/cancel`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);
    });
  });

  describe('Audit trail', () => {
    it('CR-13: Submit creates audit entry', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .post(`/api/events/${saved._id}/request-cancellation`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'Event cancelled' })
        .expect(201);

      await assertAuditEntry(db, {
        eventId: saved.eventId,
        action: 'cancellation-request-submitted',
        performedBy: requesterUser.odataId,
      });
    });

    it('CR-14: Approve creates audit entry', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      published.pendingCancellationRequest = {
        id: 'cancel-req-test',
        status: 'pending',
        reason: 'Cancel please',
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: 'Test Requester',
          department: '',
          phone: '',
          requestedAt: new Date(),
        },
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .put(`/api/admin/events/${saved._id}/approve-cancellation`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: 'Confirmed' })
        .expect(200);

      await assertAuditEntry(db, {
        eventId: saved.eventId,
        action: 'cancellation-request-approved',
        performedBy: approverUser.odataId,
      });
    });
  });
});
