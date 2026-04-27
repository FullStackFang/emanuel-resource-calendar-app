/**
 * PUT /api/edit-requests/:id/withdraw and /reject — Phase 1b terminal-state endpoints
 *
 * Both endpoints are single-document writes on the EditRequest collection. They
 * do NOT touch the parent event document. Withdraw is the requester's action;
 * reject is the approver's action.
 *
 * Coverage:
 *  - Withdraw: own + pending + OCC; rejects others, non-pending, stale version
 *  - Reject: requires reason + approver role; rejects pending only; OCC; sends email
 *  - Both: status flips to withdrawn/rejected, statusHistory grows, audit log entry
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
} = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Edit Request terminal endpoints — withdraw + reject', () => {
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
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestsTerminal'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.EDIT_REQUESTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    secondRequesterUser = createOtherRequester({ odataId: 'second-req-odata' });
    await insertUsers(db, [approverUser, requesterUser, secondRequesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    secondRequesterToken = await createMockToken(secondRequesterUser);
  });

  // ---------------- WITHDRAW ----------------

  describe('PUT /api/edit-requests/:id/withdraw', () => {
    async function seedPendingForRequester() {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedEvent] = await insertEvents(db, [published]);
      const editRequest = await insertEditRequest(db, createPendingEditRequest({
        eventId: savedEvent.eventId,
        eventObjectId: savedEvent._id,
        userId: requesterUser.odataId,
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: requesterUser.email,
        },
      }));
      return { savedEvent, editRequest };
    }

    it('allows the requester to withdraw their own pending request', async () => {
      const { editRequest } = await seedPendingForRequester();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/withdraw`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ editRequestVersion: editRequest._version })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body._version).toBe(editRequest._version + 1);

      const after = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: editRequest._id });
      expect(after.status).toBe('withdrawn');
      expect(after.statusHistory).toHaveLength(2);
      expect(after.statusHistory[1].status).toBe('withdrawn');
      expect(after.statusHistory[1].changedBy).toBe(requesterUser.odataId);
    });

    it('writes an audit log entry on withdraw', async () => {
      const { editRequest } = await seedPendingForRequester();

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/withdraw`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ editRequestVersion: editRequest._version })
        .expect(200);

      const audit = await db
        .collection(COLLECTIONS.AUDIT_HISTORY)
        .findOne({ action: 'edit-request-withdrawn' });
      expect(audit).toBeDefined();
      expect(audit.metadata.editRequestId).toBe(editRequest.editRequestId);
    });

    it('rejects another user trying to withdraw the requester\'s request', async () => {
      const { editRequest } = await seedPendingForRequester();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/withdraw`)
        .set('Authorization', `Bearer ${secondRequesterToken}`)
        .send({ editRequestVersion: editRequest._version })
        .expect(403);

      expect(res.body.error).toMatch(/only the requester/i);
    });

    it('rejects withdrawal of a non-pending request', async () => {
      const editRequest = await insertEditRequest(db, createApprovedEditRequest({
        eventId: 'evt-1',
        userId: requesterUser.odataId,
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: requesterUser.email,
        },
      }));

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/withdraw`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ editRequestVersion: editRequest._version })
        .expect(400);

      expect(res.body.error).toMatch(/only pending/i);
      expect(res.body.currentStatus).toBe('approved');
    });

    it('returns 409 when the editRequestVersion is stale', async () => {
      const { editRequest } = await seedPendingForRequester();

      // Bump version externally to simulate concurrent modification
      await db.collection(COLLECTIONS.EDIT_REQUESTS).updateOne(
        { _id: editRequest._id },
        { $inc: { _version: 1 } }
      );

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/withdraw`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ editRequestVersion: editRequest._version }) // stale
        .expect(409);

      // conditionalUpdate's snapshot includes VERSION_CONFLICT signature
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.details?.code).toBe('VERSION_CONFLICT');
    });

    it('returns 404 for a missing request', async () => {
      const fakeId = '000000000000000000000000';
      const res = await request(app)
        .put(`/api/edit-requests/${fakeId}/withdraw`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ editRequestVersion: 1 })
        .expect(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // ---------------- REJECT ----------------

  describe('PUT /api/edit-requests/:id/reject', () => {
    async function seedPendingForApproverScenario() {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedEvent] = await insertEvents(db, [published]);
      const editRequest = await insertEditRequest(db, createPendingEditRequest({
        eventId: savedEvent.eventId,
        eventObjectId: savedEvent._id,
        userId: requesterUser.odataId,
        requestedBy: {
          userId: requesterUser.odataId,
          email: requesterUser.email,
          name: requesterUser.email,
        },
      }));
      return { savedEvent, editRequest };
    }

    it('allows an approver to reject a pending request with a reason', async () => {
      const { editRequest } = await seedPendingForApproverScenario();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Conflicts with another booking', editRequestVersion: editRequest._version })
        .expect(200);

      expect(res.body.success).toBe(true);

      const after = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: editRequest._id });
      expect(after.status).toBe('rejected');
      expect(after.reviewNotes).toBe('Conflicts with another booking');
      expect(after.reviewedBy.email).toBe(approverUser.email);
      expect(after.reviewedAt).toBeDefined();
      expect(after.statusHistory).toHaveLength(2);
      expect(after.statusHistory[1].status).toBe('rejected');
    });

    it('writes an audit log entry on reject', async () => {
      const { editRequest } = await seedPendingForApproverScenario();

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Auditable reason', editRequestVersion: editRequest._version })
        .expect(200);

      const audit = await db
        .collection(COLLECTIONS.AUDIT_HISTORY)
        .findOne({ action: 'edit-request-rejected' });
      expect(audit).toBeDefined();
      expect(audit.metadata.rejectionReason).toBe('Auditable reason');
    });

    it('rejects requesters from calling the endpoint (403)', async () => {
      const { editRequest } = await seedPendingForApproverScenario();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ reason: 'I want to reject myself', editRequestVersion: editRequest._version })
        .expect(403);

      expect(res.body.error).toMatch(/approvers/i);
    });

    it('requires a non-empty reason', async () => {
      const { editRequest } = await seedPendingForApproverScenario();

      const resEmpty = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ editRequestVersion: editRequest._version })
        .expect(400);
      expect(resEmpty.body.error).toMatch(/reason is required/i);

      const resWhitespace = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: '   ', editRequestVersion: editRequest._version })
        .expect(400);
      expect(resWhitespace.body.error).toMatch(/reason is required/i);
    });

    it('rejects rejection of a non-pending request', async () => {
      const editRequest = await insertEditRequest(db, createApprovedEditRequest({
        eventId: 'evt-already-approved',
        userId: requesterUser.odataId,
      }));

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Too late', editRequestVersion: editRequest._version })
        .expect(400);

      expect(res.body.error).toMatch(/only pending/i);
    });

    it('returns 409 when editRequestVersion is stale', async () => {
      const { editRequest } = await seedPendingForApproverScenario();

      await db.collection(COLLECTIONS.EDIT_REQUESTS).updateOne(
        { _id: editRequest._id },
        { $inc: { _version: 1 } }
      );

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Stale check', editRequestVersion: editRequest._version })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.details?.code).toBe('VERSION_CONFLICT');
    });

    it('returns 404 for a missing request', async () => {
      const fakeId = '000000000000000000000000';
      const res = await request(app)
        .put(`/api/edit-requests/${fakeId}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Nope', editRequestVersion: 1 })
        .expect(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('does not modify the parent event document on reject', async () => {
      const { savedEvent, editRequest } = await seedPendingForApproverScenario();
      const beforeEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Event untouched', editRequestVersion: editRequest._version })
        .expect(200);

      const afterEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      // Event _version should not have changed (no Write 2 on reject)
      expect(afterEvent._version).toBe(beforeEvent._version);
    });
  });
});
