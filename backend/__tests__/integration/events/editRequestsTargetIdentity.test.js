/**
 * Edit-request target identity (ETI-1..7).
 *
 * The Resource Scheduler import left two documents per eventId (a sandbox copy
 * and the Outlook-linked production copy). Every edit-request endpoint used to
 * resolve its target by eventId alone, so approvals landed on whichever copy
 * Cosmos returned first — never Outlook. These tests seed two documents that
 * share an eventId and assert that each endpoint acts on the document named by
 * the request's `eventObjectId`, and that a stale version is refused BEFORE
 * the request is flipped to approved.
 */

const request = require('supertest');
const { ObjectId, Collection } = require('mongodb');

const emailService = require('../../../services/emailService');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { createPendingEditRequest, insertEditRequest } = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('edit-request target identity (ETI)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestsTargetIdentity'));
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
    graphApiMock.resetMocks();
    jest.restoreAllMocks();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);
    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // Two published documents sharing one eventId. The FIRST inserted is the
  // decoy (what findOne({ eventId }) returns); the SECOND is the one the
  // request is anchored to. Versions differ so a version check can tell them
  // apart.
  async function seedDuplicatePair() {
    const shared = `rssched--${Date.now()}`;
    const decoy = createPublishedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Decoy Copy',
      _version: 1,
    });
    decoy.eventId = shared;
    decoy.calendarOwner = 'templeeventssandbox@emanuelnyc.org';
    const target = createPublishedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Target Copy',
      _version: 3,
    });
    target.eventId = shared;
    target.calendarOwner = 'templeevents@emanuelnyc.org';
    const [savedDecoy, savedTarget] = await insertEvents(db, [decoy, target]);
    return { shared, savedDecoy, savedTarget };
  }

  async function seedRequestAgainst(savedTarget, proposedChanges = { eventTitle: 'Retitled' }) {
    return insertEditRequest(db, createPendingEditRequest({
      eventId: savedTarget.eventId,
      eventObjectId: savedTarget._id,
      userId: requesterUser.odataId,
      requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
      proposedChanges,
    }));
  }

  const approve = (editRequest, body, expected) => request(app)
    .put(`/api/edit-requests/${editRequest._id}/approve`)
    .set('Authorization', `Bearer ${approverToken}`)
    .send({ editRequestVersion: editRequest._version, ...body })
    .expect(expected);

  it('ETI-1: approve lands on the document named by eventObjectId, not the first eventId match', async () => {
    const { savedDecoy, savedTarget } = await seedDuplicatePair();
    const decoyBefore = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDecoy._id });
    const editRequest = await seedRequestAgainst(savedTarget);

    await approve(editRequest, { eventVersion: savedTarget._version }, 200);

    const targetAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedTarget._id });
    expect(targetAfter.calendarData.eventTitle).toBe('Retitled');
    expect(targetAfter._version).toBe(savedTarget._version + 1);

    const decoyAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDecoy._id });
    expect(decoyAfter).toEqual(decoyBefore);

    const audit = await db.collection(COLLECTIONS.AUDIT_HISTORY).findOne({ action: 'edit-request-approved' });
    expect(String(audit.reservationId)).toBe(String(savedTarget._id));
  });

  it('ETI-2: a stale eventVersion is refused before Write 1 — request stays pending, nothing written', async () => {
    const { savedTarget } = await seedDuplicatePair();
    const editRequest = await seedRequestAgainst(savedTarget);

    const res = await approve(editRequest, { eventVersion: savedTarget._version - 1 }, 409);

    expect(res.body.details?.code).toBe('VERSION_CONFLICT');
    expect(res.body.partialFailure).toBeUndefined();

    const requestAfter = await db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ _id: editRequest._id });
    expect(requestAfter.status).toBe('pending');
    expect(requestAfter._version).toBe(editRequest._version);

    const targetAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedTarget._id });
    expect(targetAfter._version).toBe(savedTarget._version);
    expect(targetAfter.calendarData.eventTitle).toBe('Target Copy');

    expect(await db.collection(COLLECTIONS.AUDIT_HISTORY).countDocuments({})).toBe(0);
  });

  it('ETI-3: a null eventVersion skips the pre-check and approves', async () => {
    const { savedTarget } = await seedDuplicatePair();
    const editRequest = await seedRequestAgainst(savedTarget);

    await approve(editRequest, { eventVersion: null }, 200);

    const targetAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedTarget._id });
    expect(targetAfter.calendarData.eventTitle).toBe('Retitled');
  });

  it('ETI-4: a version race after the pre-check is a recorded partial failure with an honest message', async () => {
    const { savedTarget } = await seedDuplicatePair();
    const editRequest = await seedRequestAgainst(savedTarget);

    // Bump the event's version the moment Write 1 (the edit-request flip)
    // commits, so the pre-check passed but Write 2's gate fails.
    const original = Collection.prototype.findOneAndUpdate;
    jest.spyOn(Collection.prototype, 'findOneAndUpdate').mockImplementation(async function (...args) {
      const result = await original.apply(this, args);
      if (this.collectionName === COLLECTIONS.EDIT_REQUESTS) {
        await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: savedTarget._id }, { $inc: { _version: 1 } });
      }
      return result;
    });

    const res = await approve(editRequest, { eventVersion: savedTarget._version }, 409);

    expect(res.body.partialFailure).toBe(true);
    expect(res.body.compensationRequired).toBe(true);
    expect(String(res.body.message || res.body.error)).not.toMatch(/re-?apply/i);

    const requestAfter = await db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ _id: editRequest._id });
    expect(requestAfter.status).toBe('approved');

    const split = await db.collection(COLLECTIONS.AUDIT_HISTORY).findOne({ action: 'edit-request-approval-split' });
    expect(split).not.toBeNull();
    expect(split.eventId).toBe(savedTarget.eventId);
    expect(String(split.reservationId)).toBe(String(savedTarget._id));
    expect(split.metadata.editRequestId).toBe(editRequest.editRequestId);
    expect(split.metadata.expectedVersion).toBe(savedTarget._version);
    expect(split.metadata.currentVersion).toBe(savedTarget._version + 1);
  });

  it('ETI-5: hydration returns the anchored document and computes baselineShifted against it', async () => {
    const { savedTarget } = await seedDuplicatePair();
    const editRequest = await insertEditRequest(db, createPendingEditRequest({
      eventId: savedTarget.eventId,
      eventObjectId: savedTarget._id,
      userId: requesterUser.odataId,
      baselineEventVersion: savedTarget._version,
    }));

    const res = await request(app)
      .get(`/api/edit-requests/${editRequest._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(String(res.body.event._id)).toBe(String(savedTarget._id));
    expect(res.body.event._version).toBe(savedTarget._version);
    expect(res.body.baselineShifted).toBe(false);
  });

  it('ETI-6: the rejection email is built from the anchored document', async () => {
    const { savedTarget } = await seedDuplicatePair();
    const editRequest = await seedRequestAgainst(savedTarget);
    const spy = jest.spyOn(emailService, 'sendEditRequestRejectedNotification').mockResolvedValue({ success: true });

    await request(app)
      .put(`/api/edit-requests/${editRequest._id}/reject`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ reason: 'Not this one', editRequestVersion: editRequest._version })
      .expect(200);

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    expect(String(payload._id)).toBe(String(savedTarget._id));
  });

  it('ETI-7: submit anchors to an explicit eventObjectId over a duplicated eventId', async () => {
    const { savedTarget } = await seedDuplicatePair();

    const res = await request(app)
      .post('/api/edit-requests')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ eventId: savedTarget.eventId, eventObjectId: String(savedTarget._id), eventTitle: 'Anchored' })
      .expect(201);

    const created = await db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ editRequestId: res.body.editRequestId });
    expect(String(created.eventObjectId)).toBe(String(savedTarget._id));
    expect(created.baselineSnapshot._version).toBe(savedTarget._version);
  });

  it('ETI-8: a legacy request with no eventObjectId still resolves by eventId', async () => {
    const published = createPublishedEvent({ userId: requesterUser.odataId, requesterEmail: requesterUser.email });
    const [saved] = await insertEvents(db, [published]);
    const legacy = createPendingEditRequest({
      eventId: saved.eventId,
      userId: requesterUser.odataId,
      requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
      proposedChanges: { eventTitle: 'Legacy' },
    });
    delete legacy.eventObjectId;
    const editRequest = await insertEditRequest(db, legacy);

    await approve(editRequest, { eventVersion: saved._version }, 200);

    const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    expect(after.calendarData.eventTitle).toBe('Legacy');
  });
});
