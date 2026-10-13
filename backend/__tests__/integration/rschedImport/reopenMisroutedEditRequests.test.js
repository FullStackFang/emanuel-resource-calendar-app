/**
 * reopen-misrouted-edit-requests.js (RMR-1..9)
 *
 * Approved edit requests anchored to a sandbox duplicate are handed back to
 * the approval queue against the production copy, with a full BEFORE state on
 * the request and an audit entry per request, and can be reverted.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { createApprovedEditRequest, insertEditRequest } = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

const { runRepair, runRevert, runVerify, mergeProposedChanges, OUTCOME, SCRIPT } = require('../../../reopen-misrouted-edit-requests');

const SANDBOX = 'templeeventssandbox@emanuelnyc.org';
const PRODUCTION = 'templeevents@emanuelnyc.org';
const OPTIONS = { sandboxOwner: SANDBOX, productionOwner: PRODUCTION, operator: 'tester@cli', dryRun: false };

describe('reopen-misrouted-edit-requests (RMR)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('reopenMisroutedEditRequests'));
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
    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);
    approverToken = await createMockToken(approverUser);
  });

  // A sandbox + production pair sharing one eventId, like the import left them.
  async function seedPair({ startDate = '2099-03-01', title = 'Imported Title', productionDeleted = false } = {}) {
    const shared = `rssched--${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const sandbox = createPublishedEvent({ userId: requesterUser.odataId, requesterEmail: requesterUser.email, eventTitle: title, _version: 1 });
    Object.assign(sandbox, { eventId: shared, calendarOwner: SANDBOX, startDate, endDate: startDate, graphData: null });
    const production = createPublishedEvent({ userId: requesterUser.odataId, requesterEmail: requesterUser.email, eventTitle: title, _version: 4 });
    Object.assign(production, { eventId: shared, calendarOwner: PRODUCTION, startDate, endDate: startDate });
    if (productionDeleted) Object.assign(production, { isDeleted: true, status: 'deleted' });
    const [savedSandbox, savedProduction] = await insertEvents(db, [sandbox, production]);
    return { shared, savedSandbox, savedProduction };
  }

  async function seedApproved(savedSandbox, proposedChanges, requestedAt) {
    return insertEditRequest(db, createApprovedEditRequest({
      eventId: savedSandbox.eventId,
      eventObjectId: savedSandbox._id,
      userId: requesterUser.odataId,
      requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
      proposedChanges,
      now: requestedAt,
      reviewedAt: new Date(requestedAt.getTime() + 60_000),
    }));
  }

  const findReq = (id) => db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ _id: id });

  it('RMR-1: dry run plans every group and writes nothing', async () => {
    const { savedSandbox } = await seedPair();
    const er = await seedApproved(savedSandbox, { eventTitle: 'New Title' }, new Date('2026-07-01T10:00:00Z'));

    const result = await runRepair(db, { ...OPTIONS, dryRun: true });

    expect(result.affectedCount).toBe(1);
    expect(result.summary).toEqual({ [OUTCOME.REOPENED]: 1 });
    expect(result.rows[0].merged).toEqual({ eventTitle: 'New Title' });
    const after = await findReq(er._id);
    expect(after.status).toBe('approved');
    expect(after.repair).toBeUndefined();
    expect(await db.collection(COLLECTIONS.AUDIT_HISTORY).countDocuments({})).toBe(0);
  });

  it('RMR-2: re-opens the newest request against production with the chronological union, marks the older one merged', async () => {
    const { savedSandbox, savedProduction } = await seedPair();
    const older = await seedApproved(savedSandbox, { eventDescription: 'Doors at 6:30', isOnBehalfOf: false }, new Date('2026-07-01T10:00:00Z'));
    const newer = await seedApproved(savedSandbox, { eventTitle: 'Retitled', isOnBehalfOf: true, contactName: 'Erika' }, new Date('2026-08-01T10:00:00Z'));

    const result = await runRepair(db, OPTIONS);
    expect(result.summary).toEqual({ [OUTCOME.REOPENED]: 1, [OUTCOME.MERGED_INTO]: 1 });

    const reopened = await findReq(newer._id);
    expect(reopened.status).toBe('pending');
    expect(String(reopened.eventObjectId)).toBe(String(savedProduction._id));
    expect(reopened.proposedChanges).toEqual({ eventDescription: 'Doors at 6:30', eventTitle: 'Retitled', isOnBehalfOf: true, contactName: 'Erika' });
    expect(reopened.baselineSnapshot._version).toBe(savedProduction._version);
    expect(reopened.reviewedBy).toBeNull();
    expect(reopened.reviewedAt).toBeNull();
    expect(reopened.statusHistory[reopened.statusHistory.length - 1]).toMatchObject({ status: 'pending', changedBy: SCRIPT });
    expect(reopened._version).toBe(newer._version + 1);
    expect(reopened.repair).toMatchObject({
      script: SCRIPT, outcome: OUTCOME.REOPENED, operator: 'tester@cli',
      fromEventObjectId: savedSandbox._id, toEventObjectId: savedProduction._id,
      mergedFrom: [older.editRequestId],
    });
    expect(reopened.repair.before).toMatchObject({ status: 'approved', eventObjectId: savedSandbox._id, proposedChanges: newer.proposedChanges });
    expect(reopened.repair.before.reviewedBy.email).toBe('approver@emanuelnyc.org');

    const merged = await findReq(older._id);
    expect(merged.status).toBe('approved');
    expect(String(merged.eventObjectId)).toBe(String(savedProduction._id));
    expect(merged.repair).toMatchObject({ outcome: OUTCOME.MERGED_INTO, mergedInto: newer.editRequestId });

    const audits = await db.collection(COLLECTIONS.AUDIT_HISTORY).find({ action: 'edit-request-repaired' }).toArray();
    expect(audits).toHaveLength(2);
    for (const a of audits) {
      expect(a.eventId).toBe(savedSandbox.eventId);
      expect(String(a.reservationId)).toBe(String(savedProduction._id));
      expect(a.performedBy).toBe(SCRIPT);
      expect(a.metadata.before.status).toBe('approved');
    }
    const reopenAudit = audits.find((a) => a.metadata.editRequestId === newer.editRequestId);
    expect(reopenAudit.metadata.proposedChangesMerged).toEqual(reopened.proposedChanges);
  });

  it('RMR-3: values already in production are only marked and re-pointed', async () => {
    const { savedSandbox, savedProduction } = await seedPair({ title: 'Already Right' });
    const er = await seedApproved(savedSandbox, { eventTitle: 'Already Right', isOnBehalfOf: false }, new Date('2026-07-01T10:00:00Z'));

    const result = await runRepair(db, OPTIONS);
    expect(result.summary).toEqual({ [OUTCOME.ALREADY_IN_PRODUCTION]: 1 });
    const after = await findReq(er._id);
    expect(after.status).toBe('approved');
    expect(String(after.eventObjectId)).toBe(String(savedProduction._id));
    expect(after.repair.outcome).toBe(OUTCOME.ALREADY_IN_PRODUCTION);
  });

  it('RMR-4: past events are skipped and re-pointed', async () => {
    const { savedSandbox, savedProduction } = await seedPair({ startDate: '2020-01-05' });
    const er = await seedApproved(savedSandbox, { eventTitle: 'Long Ago' }, new Date('2020-01-01T10:00:00Z'));

    const result = await runRepair(db, OPTIONS);
    expect(result.summary).toEqual({ [OUTCOME.PAST_SKIPPED]: 1 });
    const after = await findReq(er._id);
    expect(after.status).toBe('approved');
    expect(String(after.eventObjectId)).toBe(String(savedProduction._id));
  });

  it('RMR-5: a deleted production copy is marked and left anchored', async () => {
    const { savedSandbox } = await seedPair({ productionDeleted: true });
    const er = await seedApproved(savedSandbox, { eventTitle: 'Gone' }, new Date('2026-07-01T10:00:00Z'));

    const result = await runRepair(db, OPTIONS);
    expect(result.summary).toEqual({ [OUTCOME.PRODUCTION_DELETED]: 1 });
    const after = await findReq(er._id);
    expect(after.status).toBe('approved');
    expect(String(after.eventObjectId)).toBe(String(savedSandbox._id));
    expect(after.repair.outcome).toBe(OUTCOME.PRODUCTION_DELETED);
  });

  it('RMR-6: a second run finds nothing to do', async () => {
    const { savedSandbox } = await seedPair();
    await seedApproved(savedSandbox, { eventTitle: 'Once' }, new Date('2026-07-01T10:00:00Z'));
    await runRepair(db, OPTIONS);
    const auditsAfterFirst = await db.collection(COLLECTIONS.AUDIT_HISTORY).countDocuments({});

    const second = await runRepair(db, OPTIONS);
    expect(second.affectedCount).toBe(0);
    expect(await db.collection(COLLECTIONS.AUDIT_HISTORY).countDocuments({})).toBe(auditsAfterFirst);
    const verify = await runVerify(db, OPTIONS);
    expect(verify.stillAnchoredUnrepaired).toBe(0);
    expect(verify.reopenedAwaitingApproval).toBe(1);
  });

  it('RMR-7: revert restores the BEFORE state and records it', async () => {
    const { savedSandbox } = await seedPair();
    const er = await seedApproved(savedSandbox, { eventTitle: 'Undo Me' }, new Date('2026-07-01T10:00:00Z'));
    await runRepair(db, OPTIONS);

    const result = await runRevert(db, OPTIONS);
    expect(result.summary).toEqual({ reverted: 1, skipped: 0 });
    const after = await findReq(er._id);
    expect(after.status).toBe('approved');
    expect(String(after.eventObjectId)).toBe(String(savedSandbox._id));
    expect(after.proposedChanges).toEqual(er.proposedChanges);
    expect(after.reviewedBy.email).toBe('approver@emanuelnyc.org');
    expect(after.statusHistory.some((h) => h.changedBy === SCRIPT)).toBe(false);
    expect(after.repair.revertedAt).toBeDefined();
    expect(await db.collection(COLLECTIONS.AUDIT_HISTORY).countDocuments({ action: 'edit-request-repair-reverted' })).toBe(1);
  });

  it('RMR-8: revert skips a re-opened request that was approved since', async () => {
    const { savedSandbox } = await seedPair();
    const er = await seedApproved(savedSandbox, { eventTitle: 'Acted On' }, new Date('2026-07-01T10:00:00Z'));
    await runRepair(db, OPTIONS);
    await db.collection(COLLECTIONS.EDIT_REQUESTS).updateOne({ _id: er._id }, { $set: { status: 'approved' } });

    const result = await runRevert(db, OPTIONS);
    expect(result.summary).toEqual({ reverted: 0, skipped: 1 });
    expect(result.skipped[0].editRequestId).toBe(er.editRequestId);
  });

  it('RMR-9: a re-opened request approved through the real endpoint lands on production', async () => {
    const { savedSandbox, savedProduction } = await seedPair();
    const er = await seedApproved(savedSandbox, { eventTitle: 'Finally Applied' }, new Date('2026-07-01T10:00:00Z'));
    await runRepair(db, OPTIONS);
    const reopened = await findReq(er._id);

    await request(app)
      .put(`/api/edit-requests/${reopened._id}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ editRequestVersion: reopened._version, eventVersion: savedProduction._version })
      .expect(200);

    const production = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedProduction._id });
    expect(production.calendarData.eventTitle).toBe('Finally Applied');
    expect(production._version).toBe(savedProduction._version + 1);
    const sandbox = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedSandbox._id });
    expect(sandbox.calendarData.eventTitle).toBe('Imported Title');
    const approvedAudit = await db.collection(COLLECTIONS.AUDIT_HISTORY).findOne({ action: 'edit-request-approved' });
    expect(String(approvedAudit.reservationId)).toBe(String(savedProduction._id));
  });

  it('RMR-10: mergeProposedChanges — later wins per field, no-ops stripped, disagreements reported', () => {
    const production = { calendarData: { eventTitle: 'Prod', eventDescription: 'Same' } };
    const requests = [
      { editRequestId: 'a', requestedAt: '2026-01-01', proposedChanges: { eventTitle: 'First', eventDescription: 'Same' } },
      { editRequestId: 'b', requestedAt: '2026-02-01', proposedChanges: { eventTitle: 'Second', attendeeCount: 50 } },
    ];
    const { merged, effectiveCount, disagreements } = mergeProposedChanges(requests, production);
    expect(merged).toEqual({ eventTitle: 'Second', attendeeCount: 50 });
    expect(effectiveCount).toBe(2);
    expect(disagreements).toEqual([{ field: 'eventTitle', earlier: 'First', later: 'Second', laterRequest: 'b' }]);
  });
});
