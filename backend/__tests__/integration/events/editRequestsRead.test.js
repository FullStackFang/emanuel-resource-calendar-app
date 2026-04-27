/**
 * GET /api/edit-requests + GET /api/edit-requests/:id
 *
 * Verifies the new collection-model read endpoints:
 *   - List with filters (eventId, userId, status)
 *   - Permission scoping: approvers see all; requesters see only their own
 *   - Single-fetch with baselineShifted advisory + parent event hydration
 *   - 404 for missing requests, 403 for cross-user access by non-approvers
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, createOtherRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const {
  createPendingEditRequest,
  createApprovedEditRequest,
  insertEditRequest,
  insertEditRequests,
} = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('GET /api/edit-requests — list and detail', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;
  let secondRequesterUser;
  let secondRequesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestsRead'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.EDIT_REQUESTS).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    secondRequesterUser = createOtherRequester({
      odataId: 'second-req-odata',
    });
    await insertUsers(db, [approverUser, requesterUser, secondRequesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    secondRequesterToken = await createMockToken(secondRequesterUser);
  });

  describe('GET /api/edit-requests — list', () => {
    it('returns all pending requests for an approver', async () => {
      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'evt-1', userId: requesterUser.odataId }),
        createPendingEditRequest({ eventId: 'evt-2', userId: requesterUser.odataId }),
        createApprovedEditRequest({ eventId: 'evt-3', userId: requesterUser.odataId }),
      ]);

      const res = await request(app)
        .get('/api/edit-requests?status=pending')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.totalCount).toBe(2);
      expect(res.body.editRequests).toHaveLength(2);
      expect(res.body.editRequests.every((r) => r.status === 'pending')).toBe(true);
    });

    it('scopes a non-approver requester to only their own requests', async () => {
      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'evt-1', userId: requesterUser.odataId }),
        createPendingEditRequest({
          eventId: 'evt-2',
          userId: secondRequesterUser.odataId,
          requestedBy: { userId: secondRequesterUser.odataId, email: secondRequesterUser.email },
        }),
      ]);

      const res = await request(app)
        .get('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.editRequests).toHaveLength(1);
      expect(res.body.editRequests[0].requestedBy.userId).toBe(requesterUser.odataId);
    });

    it('ignores explicit userId filter from a requester (still scoped to self)', async () => {
      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'evt-1', userId: requesterUser.odataId }),
        createPendingEditRequest({
          eventId: 'evt-2',
          userId: secondRequesterUser.odataId,
          requestedBy: { userId: secondRequesterUser.odataId, email: secondRequesterUser.email },
        }),
      ]);

      // Requester tries to read second user's requests
      const res = await request(app)
        .get(`/api/edit-requests?userId=${secondRequesterUser.odataId}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.editRequests.every((r) => r.requestedBy.userId === requesterUser.odataId)).toBe(true);
    });

    it('filters by eventId for an approver', async () => {
      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'evt-target', userId: requesterUser.odataId }),
        createPendingEditRequest({
          eventId: 'evt-target',
          userId: secondRequesterUser.odataId,
          requestedBy: { userId: secondRequesterUser.odataId, email: secondRequesterUser.email },
        }),
        createPendingEditRequest({ eventId: 'evt-other', userId: requesterUser.odataId }),
      ]);

      const res = await request(app)
        .get('/api/edit-requests?eventId=evt-target')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.editRequests).toHaveLength(2);
      expect(res.body.editRequests.every((r) => r.eventId === 'evt-target')).toBe(true);
    });

    it('sorts newest-first by default', async () => {
      const t0 = new Date('2026-01-01T10:00:00Z');
      const t1 = new Date('2026-02-01T10:00:00Z');
      const t2 = new Date('2026-03-01T10:00:00Z');
      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'a', userId: requesterUser.odataId, requestedAt: t0 }),
        createPendingEditRequest({ eventId: 'b', userId: requesterUser.odataId, requestedAt: t2 }),
        createPendingEditRequest({ eventId: 'c', userId: requesterUser.odataId, requestedAt: t1 }),
      ]);

      const res = await request(app)
        .get('/api/edit-requests')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const eventIds = res.body.editRequests.map((r) => r.eventId);
      expect(eventIds).toEqual(['b', 'c', 'a']);
    });

    it('caps limit at 200', async () => {
      const res = await request(app)
        .get('/api/edit-requests?limit=999')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.limit).toBe(200);
    });
  });

  describe('GET /api/edit-requests/:id — detail', () => {
    it('returns 404 for a missing request', async () => {
      const fakeId = '000000000000000000000000';
      const res = await request(app)
        .get(`/api/edit-requests/${fakeId}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 404 for an invalid ObjectId format', async () => {
      const res = await request(app)
        .get('/api/edit-requests/not-an-objectid')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 403 when a requester tries to read another user\'s request', async () => {
      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: 'evt-1',
        userId: secondRequesterUser.odataId,
        requestedBy: {
          userId: secondRequesterUser.odataId,
          email: secondRequesterUser.email,
          name: secondRequesterUser.email,
        },
      }));

      const res = await request(app)
        .get(`/api/edit-requests/${inserted._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);
      expect(res.body.error).toMatch(/access denied/i);
    });

    it('returns the request and parent event for an approver', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Parent Event',
        _version: 3,
      });
      const [savedEvent] = await insertEvents(db, [published]);

      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: savedEvent.eventId,
        eventObjectId: savedEvent._id,
        userId: requesterUser.odataId,
        baselineEventVersion: 3,
      }));

      const res = await request(app)
        .get(`/api/edit-requests/${inserted._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.editRequest.editRequestId).toBe(inserted.editRequestId);
      expect(res.body.event).not.toBeNull();
      expect(res.body.event.eventId).toBe(savedEvent.eventId);
      expect(res.body.event._version).toBe(3);
      expect(res.body.baselineShifted).toBe(false);
    });

    it('flags baselineShifted when the parent event _version has moved since submission', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        _version: 5,
      });
      const [savedEvent] = await insertEvents(db, [published]);

      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: savedEvent.eventId,
        eventObjectId: savedEvent._id,
        userId: requesterUser.odataId,
        baselineEventVersion: 3, // older than current 5
      }));

      const res = await request(app)
        .get(`/api/edit-requests/${inserted._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.baselineShifted).toBe(true);
      expect(res.body.event._version).toBe(5);
    });

    it('allows a requester to read their own request', async () => {
      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: 'evt-1',
        userId: requesterUser.odataId,
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: requesterUser.email,
        },
      }));

      const res = await request(app)
        .get(`/api/edit-requests/${inserted._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.editRequest.editRequestId).toBe(inserted.editRequestId);
    });
  });
});
