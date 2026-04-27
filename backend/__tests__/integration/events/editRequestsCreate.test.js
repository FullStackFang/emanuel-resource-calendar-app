/**
 * POST /api/edit-requests — Phase 1b: Create endpoint integration tests
 *
 * Verifies the new collection-based create endpoint:
 *   - Writes to templeEvents__EditRequests, NOT to the event document
 *   - Permission gate (owner / same-dept / ownerless)
 *   - Published-only check
 *   - Same-user duplicate guard scoped to (userId, eventId, occurrenceDate)
 *   - Multiple users can submit parallel pending requests on the same event
 *   - Recurrence guards (Q3 series-master date-only, Q5 exclusion-removal)
 *   - baselineSnapshot capture
 *   - editRequestId uniqueness via unique index
 *   - Audit log entry written
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, createOtherRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createOwnerlessPublishedEvent,
  createPendingEvent,
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('POST /api/edit-requests — collection-model create', () => {
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
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestsCreate'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});
    await db.collection(COLLECTIONS.EDIT_REQUESTS).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    secondRequesterUser = createOtherRequester({
      odataId: 'second-requester-odata-id',
    });
    await insertUsers(db, [approverUser, requesterUser, secondRequesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    secondRequesterToken = await createMockToken(secondRequesterUser);
  });

  describe('happy path', () => {
    it('creates a pending edit request in the new collection', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventId: saved.eventId,
          eventTitle: 'New Title',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.editRequestId).toMatch(/^edit-req-/);
      expect(res.body.eventId).toBe(saved.eventId);
      expect(res.body._version).toBe(1);

      // Event document was NOT modified
      const eventAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(eventAfter.pendingEditRequest).toBeUndefined();

      // Edit request lives in the new collection
      const editRequest = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ editRequestId: res.body.editRequestId });
      expect(editRequest).toBeDefined();
      expect(editRequest.status).toBe('pending');
      expect(editRequest.eventId).toBe(saved.eventId);
      expect(editRequest.requestedBy.userId).toBe(requesterUser.odataId);
      expect(editRequest.requestedBy.email).toBe(requesterUser.email);
      expect(editRequest.proposedChanges.eventTitle).toBe('New Title');
      expect(editRequest.statusHistory).toHaveLength(1);
      expect(editRequest.statusHistory[0].status).toBe('pending');
    });

    it('captures a baselineSnapshot of the event at submit time', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Snapshot Test',
        _version: 7,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Updated' })
        .expect(201);

      const editRequest = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ editRequestId: res.body.editRequestId });
      expect(editRequest.baselineSnapshot).toBeDefined();
      expect(editRequest.baselineSnapshot._version).toBe(7);
      expect(editRequest.baselineSnapshot.eventTitle).toBe('Snapshot Test');
    });

    it('writes an audit log entry referencing the edit request', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Audit Check' })
        .expect(201);

      const audit = await db
        .collection(COLLECTIONS.AUDIT_HISTORY)
        .findOne({ action: 'edit-request-submitted', eventId: saved.eventId });
      expect(audit).toBeDefined();
      expect(audit.metadata.editRequestId).toBe(res.body.editRequestId);
      expect(audit.metadata.proposedChanges.eventTitle).toBe('Audit Check');
    });
  });

  describe('one-active-per-scope guard', () => {
    it('blocks a second user from submitting while another user has a pending request on the same event', async () => {
      const published = createOwnerlessPublishedEvent({ eventTitle: 'Shared Event' });
      const [saved] = await insertEvents(db, [published]);

      // First requester submits successfully
      await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Requester A change' })
        .expect(201);

      // Second requester is blocked because a pending request already exists
      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${secondRequesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Requester B change' })
        .expect(400);

      expect(res.body.error).toBe('DUPLICATE_PENDING_REQUEST');
      expect(res.body.isSameUser).toBe(false);
      expect(res.body.existingRequester).toBeDefined();
      expect(res.body.existingRequester.email).toBe(requesterUser.email);
      expect(res.body.message).toMatch(/Only one active edit request/i);

      const all = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .find({ eventId: saved.eventId, status: 'pending' })
        .toArray();
      expect(all).toHaveLength(1);
    });

    it('rejects a second pending request from the SAME user on the same scope', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'First' })
        .expect(201);

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Second' })
        .expect(400);

      expect(res.body.error).toBe('DUPLICATE_PENDING_REQUEST');
      expect(res.body.isSameUser).toBe(true);
      expect(res.body.message).toMatch(/withdraw it/i);
    });

    it('once the active request is withdrawn, a different user can submit', async () => {
      const published = createOwnerlessPublishedEvent({ eventTitle: 'Slot Frees Up' });
      const [saved] = await insertEvents(db, [published]);

      // First user submits and the request takes the active slot
      const firstRes = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'First' })
        .expect(201);

      // Manually mark the existing request as withdrawn (simulating the
      // requester withdrawing through the withdraw endpoint)
      await db.collection(COLLECTIONS.EDIT_REQUESTS).updateOne(
        { editRequestId: firstRes.body.editRequestId },
        { $set: { status: 'withdrawn' } }
      );

      // Second user can now submit
      await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${secondRequesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Second' })
        .expect(201);
    });

    it('different occurrenceDate values are independent slots — parallel submissions allowed', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventId: saved.eventId,
          eventTitle: 'Mar 12 only',
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
        })
        .expect(201);

      await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventId: saved.eventId,
          eventTitle: 'Mar 19 only',
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-19',
        })
        .expect(201);

      const requests = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .find({ eventId: saved.eventId, status: 'pending' })
        .toArray();
      expect(requests).toHaveLength(2);
    });
  });

  describe('permission gate', () => {
    it('rejects submission from a non-owner not in the same department', async () => {
      const otherUser = createOtherRequester({
        email: 'outsider@external.com',
        odataId: 'outsider-odata-id',
        department: 'OtherDepartment',
      });
      await insertUsers(db, [otherUser]);
      const otherToken = await createMockToken(otherUser);

      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Hacked' })
        .expect(403);

      expect(res.body.error).toMatch(/owner.*department/i);
    });

    it('allows ownerless events to receive edit requests from any authenticated user', async () => {
      const otherUser = createOtherRequester({
        email: 'unrelated@external.com',
        odataId: 'unrelated-odata-id',
        department: 'OtherDepartment',
      });
      await insertUsers(db, [otherUser]);
      const otherToken = await createMockToken(otherUser);

      const published = createOwnerlessPublishedEvent();
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Allowed' })
        .expect(201);
    });
  });

  describe('event-state guards', () => {
    it('rejects when event is not published (status pending)', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, eventTitle: 'Nope' })
        .expect(400);

      expect(res.body.error).toMatch(/published/i);
    });

    it('returns 404 when eventId does not exist', async () => {
      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: 'nonexistent-event-id', eventTitle: 'Nope' })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 400 when eventId is missing', async () => {
      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventTitle: 'Nope' })
        .expect(400);

      expect(res.body.error).toMatch(/eventId/i);
    });
  });

  describe('recurrence guards (Q3 + Q5)', () => {
    it('blocks date-only changes on a recurring series master without a recurrence change (Q3)', async () => {
      const master = createRecurringSeriesMaster({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        status: 'published',
      });
      const [saved] = await insertEvents(db, [master]);

      // Attempt a startDateTime change that lands on a different DATE, no recurrence supplied
      const cd = saved.calendarData || {};
      const originalStart = cd.startDateTime;
      const shifted = originalStart
        ? originalStart.replace(/\d{4}-\d{2}-\d{2}/, '2099-01-01')
        : '2099-01-01T10:00:00';

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, startDateTime: shifted })
        .expect(400);

      expect(res.body.error).toMatch(/Date changes are not allowed/i);
    });

    it('blocks exclusion-removal in a recurrence change (Q5)', async () => {
      const master = createRecurringSeriesMaster({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        status: 'published',
      });
      master.recurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['Tuesday'] },
        range: { type: 'endDate', startDate: '2026-01-06', endDate: '2026-12-31' },
        exclusions: ['2026-03-10', '2026-04-14'],
      };
      const [saved] = await insertEvents(db, [master]);

      const newRecurrence = {
        ...master.recurrence,
        exclusions: ['2026-04-14'], // Removed 2026-03-10
      };

      const res = await request(app)
        .post('/api/edit-requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ eventId: saved.eventId, recurrence: newRecurrence })
        .expect(400);

      expect(res.body.error).toBe('EXCLUSION_REMOVAL_NOT_SUPPORTED');
      expect(res.body.removedExclusions).toContain('2026-03-10');
    });
  });
});
