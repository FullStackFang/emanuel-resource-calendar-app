/**
 * PUT /api/edit-requests/:id/approve — Phase 1b two-write approval endpoint
 *
 * Coverage:
 *   Permission gates (approver/admin only; force requires admin)
 *   Status checks (must be pending)
 *   Two-write success: request → approved, event fields → updated
 *   Partial failure: Write 1 succeeds, Write 2 409 → partialFailure: true
 *   Approver overrides merged with proposedChanges
 *   Supersede sweep: matching-scope co-pending requests → superseded
 *   Series vs occurrence scope (occurrence writes to occurrenceOverrides[])
 *   Audit log + email shape
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, createOtherRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const {
  createPendingEditRequest,
  insertEditRequest,
  insertEditRequests,
} = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('PUT /api/edit-requests/:id/approve', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestsApprove'));
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
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  async function seedPendingRequestOnEvent(overrides = {}) {
    const published = createPublishedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: overrides.eventTitle || 'Original Title',
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
      proposedChanges: overrides.proposedChanges || { eventTitle: 'New Title' },
      editScope: overrides.editScope || null,
      occurrenceDate: overrides.occurrenceDate || null,
    }));
    return { savedEvent, editRequest };
  }

  describe('happy path — series-level', () => {
    it('flips request status to approved and updates the event', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'Approved Title' },
      });

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          notes: 'looks good',
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.editRequestVersion).toBe(editRequest._version + 1);
      expect(res.body.eventVersion).toBe((savedEvent._version || 1) + 1);

      const editRequestAfter = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: editRequest._id });
      expect(editRequestAfter.status).toBe('approved');
      expect(editRequestAfter.reviewNotes).toBe('looks good');
      expect(editRequestAfter.reviewedBy.email).toBe(approverUser.email);

      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      expect(eventAfter.calendarData.eventTitle).toBe('Approved Title');
    });

    it('merges approverChanges over proposedChanges', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'Requester Title', eventDescription: 'Requester desc' },
      });

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          approverChanges: { eventTitle: 'Approver Override' }, // overrides title only
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      expect(eventAfter.calendarData.eventTitle).toBe('Approver Override');
      expect(eventAfter.calendarData.eventDescription).toBe('Requester desc');
    });

    it('writes an audit log entry referencing the approved request', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      const audit = await db
        .collection(COLLECTIONS.AUDIT_HISTORY)
        .findOne({ action: 'edit-request-approved', eventId: savedEvent.eventId });
      expect(audit).toBeDefined();
      expect(audit.metadata.editRequestId).toBe(editRequest.editRequestId);
    });
  });

  describe('happy path — occurrence-scoped', () => {
    it('writes finalChanges into occurrenceOverrides[] on the master', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'March 12 Special' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12',
      });

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      expect(Array.isArray(eventAfter.occurrenceOverrides)).toBe(true);
      const override = eventAfter.occurrenceOverrides.find((o) => o.occurrenceDate === '2026-03-12');
      expect(override).toBeDefined();
      expect(override.eventTitle).toBe('March 12 Special');

      // Series-level fields should NOT have changed
      expect(eventAfter.calendarData.eventTitle).toBe('Original Title');
    });

    it('updates an existing occurrenceOverride entry rather than appending', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      published.occurrenceOverrides = [
        { occurrenceDate: '2026-03-12', eventTitle: 'Existing override' },
      ];
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
        proposedChanges: { eventTitle: 'Updated override' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12',
      }));

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      const matching = eventAfter.occurrenceOverrides.filter((o) => o.occurrenceDate === '2026-03-12');
      expect(matching).toHaveLength(1);
      expect(matching[0].eventTitle).toBe('Updated override');
    });
  });

  describe('partial failure — Write 1 succeeds, Write 2 409', () => {
    it('returns partialFailure: true when event _version is stale', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'Will fail to apply' },
      });

      // Bump the event _version externally to simulate concurrent modification
      await db.collection(COLLECTIONS.EVENTS).updateOne(
        { _id: savedEvent._id },
        { $inc: { _version: 1 } }
      );

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version, // stale
        })
        .expect(409);

      expect(res.body.partialFailure).toBe(true);
      expect(res.body.compensationRequired).toBe(true);
      expect(res.body.editRequestApproved).toBe(true);

      // Edit request is approved (Write 1 succeeded)
      const editRequestAfter = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: editRequest._id });
      expect(editRequestAfter.status).toBe('approved');

      // Event title is unchanged (Write 2 failed before applying)
      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      expect(eventAfter.calendarData.eventTitle).toBe('Original Title');
    });
  });

  describe('permission gates', () => {
    it('rejects requesters from approving (403)', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(403);

      expect(res.body.error).toMatch(/approver/i);
    });

    it('rejects forcePublishEdit from approver (admin-only)', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          forcePublishEdit: true,
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(403);

      expect(res.body.error).toMatch(/admin/i);
    });
  });

  describe('state guards', () => {
    it('rejects approval of a non-pending request', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      // First approval succeeds
      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      // Second approval rejected as non-pending
      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version + 1,
          eventVersion: savedEvent._version + 1,
        })
        .expect(400);

      expect(res.body.error).toMatch(/only pending/i);
    });

    it('returns 404 for a missing request', async () => {
      const fakeId = '000000000000000000000000';
      const res = await request(app)
        .put(`/api/edit-requests/${fakeId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: 1,
          eventVersion: 1,
        })
        .expect(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('supersede sweep', () => {
    it('flips co-pending series-level requests on the same event to superseded', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedEvent] = await insertEvents(db, [published]);

      const otherUser = createOtherRequester({ odataId: 'other-odata' });
      await insertUsers(db, [otherUser]);

      const [primaryReq, otherReq] = await insertEditRequests(db, [
        createPendingEditRequest({
          eventId: savedEvent.eventId,
          eventObjectId: savedEvent._id,
          userId: requesterUser.odataId,
          requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
          proposedChanges: { eventTitle: 'Primary change' },
        }),
        createPendingEditRequest({
          eventId: savedEvent.eventId,
          eventObjectId: savedEvent._id,
          userId: otherUser.odataId,
          requestedBy: { userId: otherUser.odataId, email: otherUser.email, name: otherUser.email },
          proposedChanges: { eventDescription: 'Other description' },
        }),
      ]);

      const res = await request(app)
        .put(`/api/edit-requests/${primaryReq._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: primaryReq._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      expect(res.body.supersededCount).toBe(1);

      const otherAfter = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: otherReq._id });
      expect(otherAfter.status).toBe('superseded');
      expect(otherAfter.statusHistory[otherAfter.statusHistory.length - 1].changedBy).toBe('system');
    });

    it('does not supersede occurrence requests for different dates', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedEvent] = await insertEvents(db, [published]);

      const [reqMar12, reqMar19] = await insertEditRequests(db, [
        createPendingEditRequest({
          eventId: savedEvent.eventId,
          eventObjectId: savedEvent._id,
          userId: requesterUser.odataId,
          requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
          proposedChanges: { eventTitle: 'Mar 12 update' },
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
        }),
        createPendingEditRequest({
          eventId: savedEvent.eventId,
          eventObjectId: savedEvent._id,
          userId: requesterUser.odataId,
          requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
          proposedChanges: { eventTitle: 'Mar 19 update' },
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-19',
        }),
      ]);

      const res = await request(app)
        .put(`/api/edit-requests/${reqMar12._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: reqMar12._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      // Mar 19 request should still be pending — different occurrenceDate
      expect(res.body.supersededCount).toBe(0);
      const mar19After = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: reqMar19._id });
      expect(mar19After.status).toBe('pending');
    });
  });
});
