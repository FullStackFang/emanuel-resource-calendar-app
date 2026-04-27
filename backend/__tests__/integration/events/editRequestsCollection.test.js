/**
 * Edit Requests Collection — Phase 1a Smoke Tests
 *
 * Verifies that the new templeEvents__EditRequests collection registration,
 * indexes, and factory helpers work end-to-end against MongoDB Memory Server.
 * No endpoint code is exercised — these tests prove the foundation only.
 *
 * Coverage:
 * - Insert + read round-trip for each status (pending/approved/rejected/withdrawn/superseded)
 * - editRequestId uniqueness (driven by the unique index)
 * - by-event listing index path returns documents ordered correctly
 * - by-user listing index path filters correctly
 * - statusHistory captures terminal-state transitions
 */

const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const {
  EDIT_REQUEST_STATUS,
  resetEditRequestIdCounter,
  createPendingEditRequest,
  createApprovedEditRequest,
  createRejectedEditRequest,
  createWithdrawnEditRequest,
  createSupersededEditRequest,
  insertEditRequest,
  insertEditRequests,
} = require('../../__helpers__/editRequestFactory');

describe('Edit Requests Collection — foundation smoke tests', () => {
  let mongoClient;
  let db;
  let collection;

  beforeAll(async () => {
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestsCollection'));
    collection = db.collection(COLLECTIONS.EDIT_REQUESTS);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await collection.deleteMany({});
    resetEditRequestIdCounter();
  });

  describe('round-trip per status', () => {
    test('pending request inserts and reads back', async () => {
      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: 'evt-1',
        userId: 'user-1',
        proposedChanges: { eventTitle: 'New Title' },
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found).not.toBeNull();
      expect(found.status).toBe(EDIT_REQUEST_STATUS.PENDING);
      expect(found.eventId).toBe('evt-1');
      expect(found.requestedBy.userId).toBe('user-1');
      expect(found.proposedChanges.eventTitle).toBe('New Title');
      expect(found.statusHistory).toHaveLength(1);
      expect(found.statusHistory[0].status).toBe(EDIT_REQUEST_STATUS.PENDING);
      expect(found._version).toBe(1);
    });

    test('approved request carries reviewer + statusHistory transition', async () => {
      const inserted = await insertEditRequest(db, createApprovedEditRequest({
        eventId: 'evt-2',
        reviewedBy: { userId: 'admin-1', email: 'admin@x.com', name: 'Admin' },
        reviewNotes: 'looks good',
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found.status).toBe(EDIT_REQUEST_STATUS.APPROVED);
      expect(found.reviewedBy.userId).toBe('admin-1');
      expect(found.reviewNotes).toBe('looks good');
      expect(found.statusHistory).toHaveLength(2);
      expect(found.statusHistory[1].status).toBe(EDIT_REQUEST_STATUS.APPROVED);
    });

    test('rejected request carries reason in reviewNotes', async () => {
      const inserted = await insertEditRequest(db, createRejectedEditRequest({
        eventId: 'evt-3',
        reviewNotes: 'conflicts with another booking',
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found.status).toBe(EDIT_REQUEST_STATUS.REJECTED);
      expect(found.reviewNotes).toBe('conflicts with another booking');
    });

    test('withdrawn request preserves requester as the actor', async () => {
      const inserted = await insertEditRequest(db, createWithdrawnEditRequest({
        eventId: 'evt-4',
        userId: 'user-4',
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found.status).toBe(EDIT_REQUEST_STATUS.WITHDRAWN);
      expect(found.statusHistory[1].changedBy).toBe('user-4');
      expect(found.lastModifiedBy).toBe('user-4');
    });

    test('superseded request carries system as the actor', async () => {
      const inserted = await insertEditRequest(db, createSupersededEditRequest({
        eventId: 'evt-5',
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found.status).toBe(EDIT_REQUEST_STATUS.SUPERSEDED);
      expect(found.statusHistory[1].changedBy).toBe('system');
      expect(found.lastModifiedBy).toBe('system');
    });
  });

  describe('uniqueness and indexing', () => {
    test('editRequestId unique index rejects duplicates', async () => {
      await insertEditRequest(db, createPendingEditRequest({
        editRequestId: 'fixed-id',
        eventId: 'evt-a',
      }));

      await expect(
        insertEditRequest(db, createPendingEditRequest({
          editRequestId: 'fixed-id',
          eventId: 'evt-b',
        }))
      ).rejects.toThrow(/duplicate key/i);
    });

    test('by-event listing returns requests sorted newest-first', async () => {
      const t0 = new Date('2026-04-01T10:00:00Z');
      const t1 = new Date('2026-04-02T10:00:00Z');
      const t2 = new Date('2026-04-03T10:00:00Z');

      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'evt-shared', userId: 'u1', requestedAt: t0 }),
        createPendingEditRequest({ eventId: 'evt-shared', userId: 'u2', requestedAt: t1 }),
        createApprovedEditRequest({ eventId: 'evt-shared', userId: 'u3', requestedAt: t2 }),
        createPendingEditRequest({ eventId: 'evt-other', userId: 'u4', requestedAt: t2 }),
      ]);

      const sharedRequests = await collection
        .find({ eventId: 'evt-shared' })
        .sort({ requestedAt: -1 })
        .toArray();

      expect(sharedRequests).toHaveLength(3);
      expect(sharedRequests[0].requestedBy.userId).toBe('u3');
      expect(sharedRequests[2].requestedBy.userId).toBe('u1');
    });

    test('by-user listing filters cross-event', async () => {
      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'evt-x', userId: 'shared-user' }),
        createPendingEditRequest({ eventId: 'evt-y', userId: 'shared-user' }),
        createPendingEditRequest({ eventId: 'evt-z', userId: 'other-user' }),
      ]);

      const myRequests = await collection
        .find({ 'requestedBy.userId': 'shared-user' })
        .toArray();

      expect(myRequests).toHaveLength(2);
      expect(myRequests.every((r) => r.requestedBy.userId === 'shared-user')).toBe(true);
    });

    test('global pending-status query returns only pending', async () => {
      await insertEditRequests(db, [
        createPendingEditRequest({ eventId: 'evt-1' }),
        createApprovedEditRequest({ eventId: 'evt-2' }),
        createRejectedEditRequest({ eventId: 'evt-3' }),
        createPendingEditRequest({ eventId: 'evt-4' }),
        createWithdrawnEditRequest({ eventId: 'evt-5' }),
      ]);

      const pending = await collection
        .find({ status: EDIT_REQUEST_STATUS.PENDING })
        .toArray();

      expect(pending).toHaveLength(2);
      expect(pending.every((r) => r.status === EDIT_REQUEST_STATUS.PENDING)).toBe(true);
    });
  });

  describe('schema invariants the factory enforces', () => {
    test('every request carries baselineSnapshot for stale-baseline detection', async () => {
      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: 'evt-baseline',
        baselineEventVersion: 7,
        baselineTitle: 'Original',
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found.baselineSnapshot).toBeDefined();
      expect(found.baselineSnapshot._version).toBe(7);
      expect(found.baselineSnapshot.eventTitle).toBe('Original');
    });

    test('per-occurrence requests carry editScope and occurrenceDate', async () => {
      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: 'evt-recurring',
        editScope: 'thisEvent',
        occurrenceDate: '2026-05-12',
        seriesMasterId: 'master-graph-id-1',
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found.editScope).toBe('thisEvent');
      expect(found.occurrenceDate).toBe('2026-05-12');
      expect(found.seriesMasterId).toBe('master-graph-id-1');
    });

    test('series-level requests have null occurrenceDate by default', async () => {
      const inserted = await insertEditRequest(db, createPendingEditRequest({
        eventId: 'evt-master',
        editScope: 'allEvents',
      }));

      const found = await collection.findOne({ _id: inserted._id });
      expect(found.editScope).toBe('allEvents');
      expect(found.occurrenceDate).toBeNull();
    });
  });
});
