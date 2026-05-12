/**
 * Publish Rollback & graphData Persistence Tests (PR-1 to PR-9)
 *
 * Locks in the production fix for a defect that caused:
 *   1. Orphaned Outlook events on rollback (rollback only reverted MongoDB
 *      status, never deleted the Graph event that had already been created).
 *   2. Untethered records (post-publish $set used dotted-path against
 *      graphData: null, which Cosmos silently dropped while letting the
 *      sibling $push to createdGraphEventIds apply).
 *
 * See plan: /home/fullstackfang/.claude/plans/so-i-noticed-that-sprightly-hippo.md
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPendingEvent, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { Collection } = require('mongodb');

describe('Publish Rollback & graphData Persistence (PR-1 to PR-9)', () => {
  let mongoClient, db, app;
  let approverUser, requesterUser;
  let approverToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('publishRollback'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
  });

  // ---------------------------------------------------------------------------
  // PR-1: Graph creation failure triggers rollback, no orphan, no deleteCalendarEvent
  // ---------------------------------------------------------------------------
  describe('PR-1: createCalendarEvent throws → rollback, no Graph event created', () => {
    it('rolls back status and does NOT call deleteCalendarEvent (nothing was created)', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-1 event',
      });
      const [saved] = await insertEvents(db, [pending]);

      // Inject failure on Graph create
      graphApiMock.setMockError('createCalendarEvent', new Error('Graph API unavailable'));

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: saved._version, createCalendarEvent: true })
        .expect(500);

      expect(res.body.error).toBe('CalendarEventCreationFailed');
      expect(res.body.failurePhase).toBe('graph_create');

      // Verify rollback occurred
      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.status).toBe(STATUS.PENDING);
      expect(after._version).toBe(saved._version + 2);
      const lastHistory = after.statusHistory[after.statusHistory.length - 1];
      expect(lastHistory.status).toBe(STATUS.PENDING);
      expect(lastHistory.reason).toMatch(/graph_create/);

      // No Graph event was created, so no delete attempt
      expect(graphApiMock.getCallHistory('deleteCalendarEvent')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PR-3: Synchronous graphData persist failure → orphan Graph event is deleted
  // ---------------------------------------------------------------------------
  describe('PR-3: graphData persist throws → rollback deletes the orphan Graph event', () => {
    it('deletes the just-created Graph event and reverts status with graph_data_persist phase', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-3 event',
      });
      const [saved] = await insertEvents(db, [pending]);

      // Inject a one-shot failure on the graphData persist write.
      // Strategy: spy on the events collection's updateOne and reject on the
      // call that targets graphData. The publish flow makes 2 updateOne calls
      // outside the rollback path:
      //   1. conditionalUpdate's findOneAndUpdate (not updateOne)
      //   2. The new synchronous graphData persist (updateOne we want to fail)
      // Spy on Collection.prototype.updateOne so we intercept ALL collection
      // instances (db.collection() returns a new wrapper each call, so spying
      // on a single instance misses the publish endpoint's cached reference).
      const origUpdateOne = Collection.prototype.updateOne;
      const updateOneSpy = jest.spyOn(Collection.prototype, 'updateOne').mockImplementation(async function (filter, update, opts) {
        const isGraphDataWrite = update?.$set?.graphData && update?.$push?.['roomReservationData.createdGraphEventIds'];
        if (isGraphDataWrite) {
          const err = new Error('Persist failed (test injection)');
          err.code = 'NO_RETRY_TEST_ERROR';
          throw err;
        }
        return origUpdateOne.call(this, filter, update, opts);
      });

      try {
        const res = await request(app)
          .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
          .set('Authorization', `Bearer ${approverToken}`)
          .send({ _version: saved._version, createCalendarEvent: true })
          .expect(500);

        expect(res.body.failurePhase).toBe('graph_data_persist');

        // Verify Graph create was called once...
        expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(1);
        // ...AND the orphan was deleted as compensating action
        expect(graphApiMock.getCallHistory('deleteCalendarEvent')).toHaveLength(1);

        // Verify rollback persisted: status pending, version bumped
        const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
        expect(after.status).toBe(STATUS.PENDING);
        const lastHistory = after.statusHistory[after.statusHistory.length - 1];
        expect(lastHistory.reason).toMatch(/graph_data_persist/);
      } finally {
        updateOneSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // PR-4: graphData persist throws AND Graph delete also throws → rollback still proceeds
  // ---------------------------------------------------------------------------
  describe('PR-4: graphData persist throws AND deleteCalendarEvent throws → status still rolls back', () => {
    it('logs orphan warning but completes MongoDB rollback', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-4 event',
      });
      const [saved] = await insertEvents(db, [pending]);

      // Fail graphData persist via Collection.prototype spy (same pattern as PR-3)
      const origUpdateOne = Collection.prototype.updateOne;
      const updateOneSpy = jest.spyOn(Collection.prototype, 'updateOne').mockImplementation(async function (filter, update, opts) {
        const isGraphDataWrite = update?.$set?.graphData && update?.$push?.['roomReservationData.createdGraphEventIds'];
        if (isGraphDataWrite) {
          const err = new Error('Persist failed (test injection)');
          err.code = 'NO_RETRY_TEST_ERROR';
          throw err;
        }
        return origUpdateOne.call(this, filter, update, opts);
      });

      // Also fail the Graph delete
      const deleteErr = new Error('Graph delete unauthorized');
      deleteErr.statusCode = 500; // Non-retryable
      graphApiMock.setMockError('deleteCalendarEvent', deleteErr);

      try {
        const res = await request(app)
          .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
          .set('Authorization', `Bearer ${approverToken}`)
          .send({ _version: saved._version, createCalendarEvent: true })
          .expect(500);

        expect(res.body.failurePhase).toBe('graph_data_persist');

        // Graph delete was attempted (1 call)
        expect(graphApiMock.getCallHistory('deleteCalendarEvent')).toHaveLength(1);

        // MongoDB still rolled back despite Graph delete failure
        const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
        expect(after.status).toBe(STATUS.PENDING);
      } finally {
        updateOneSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // PR-5: Successful publish → graphData.id set, createdGraphEventIds has 1 entry
  // ---------------------------------------------------------------------------
  describe('PR-5: Successful publish persists graphData synchronously', () => {
    it('writes graphData.id and pushes to createdGraphEventIds in a single atomic write', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-5 event',
      });
      const [saved] = await insertEvents(db, [pending]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: saved._version, createCalendarEvent: true })
        .expect(200);

      // No setTimeout delay needed — graphData is now persisted synchronously.
      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.status).toBe(STATUS.PUBLISHED);
      expect(after.graphData).toBeDefined();
      expect(after.graphData.id).toBeDefined();
      expect(after.graphData.iCalUId).toMatch(/^ical-/);
      expect(after.roomReservationData.createdGraphEventIds).toHaveLength(1);
      expect(after.roomReservationData.createdGraphEventIds[0]).toBe(after.graphData.id);
    });
  });

  // ---------------------------------------------------------------------------
  // PR-6: graphData: null on input is replaced — regression test for the
  //       dotted-path-through-null bug that produced Susanne's record.
  // ---------------------------------------------------------------------------
  describe('PR-6: Document with graphData: null at publish time', () => {
    it('replaces null with { id, iCalUId } via full-object $set (no Cosmos partial-apply)', async () => {
      // This is the EXACT condition that produced the production bug:
      // initial document creation sets graphData: null (api-server.js line ~20695).
      // Without the fix, the dotted-path $set silently fails and the document
      // remains untethered.
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-6 event with null graphData',
        graphData: null,  // ← the production bug condition
      });
      const [saved] = await insertEvents(db, [pending]);
      // Confirm baseline
      const before = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(before.graphData).toBeNull();

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: saved._version, createCalendarEvent: true })
        .expect(200);

      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.graphData).not.toBeNull();
      expect(after.graphData.id).toBeDefined();
      expect(after.graphData.iCalUId).toMatch(/^ical-/);
      // The push and the set must BOTH apply
      expect(after.roomReservationData.createdGraphEventIds).toHaveLength(1);
      expect(after.roomReservationData.createdGraphEventIds[0]).toBe(after.graphData.id);
    });
  });

  // ---------------------------------------------------------------------------
  // PR-7: After a successful publish, an admin save propagates to Graph.
  //       Verifies the sync gate is no longer broken by the publish path.
  // ---------------------------------------------------------------------------
  describe('PR-7: Publish leaves graphData.id queryable for admin save sync', () => {
    it('admin save after publish calls updateCalendarEvent (graphData.id gate passes)', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-7 event',
        graphData: null,
      });
      const [saved] = await insertEvents(db, [pending]);

      const publishRes = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: saved._version, createCalendarEvent: true })
        .expect(200);

      const newVersion = publishRes.body._version;

      // Now edit the title — should sync to Graph
      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.graphData?.id).toBeDefined();

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          _version: newVersion,
          eventTitle: 'PR-7 event edited',
          calendarData: { ...after.calendarData, eventTitle: 'PR-7 event edited' },
        })
        .expect(200);

      // Graph updateCalendarEvent should have been called targeting the master id
      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      expect(updateCalls[0].eventId).toBe(after.graphData.id);
    });
  });

  // ---------------------------------------------------------------------------
  // PR-8: createCalendarEvent: false path — status moves to published, no Graph calls.
  // ---------------------------------------------------------------------------
  describe('PR-8: Publish with createCalendarEvent: false', () => {
    it('publishes without touching Graph; graphData remains null', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-8 event',
        graphData: null,
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: saved._version, createCalendarEvent: false })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body._version).toBeDefined();

      expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(0);
      expect(graphApiMock.getCallHistory('deleteCalendarEvent')).toHaveLength(0);

      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.status).toBe(STATUS.PUBLISHED);
      expect(after.graphData).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // PR-9: createdGraphEventIds reflects exactly the master Graph event id
  //       — the production bug produced createdGraphEventIds=[B] but
  //       graphData=null. This assertion guarantees those two stay in sync.
  // ---------------------------------------------------------------------------
  describe('PR-9: graphData.id and createdGraphEventIds stay consistent after publish', () => {
    it('createdGraphEventIds[0] equals graphData.id (no divergence as in the production bug)', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'PR-9 event',
        graphData: null,
      });
      const [saved] = await insertEvents(db, [pending]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: saved._version, createCalendarEvent: true })
        .expect(200);

      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      // Both must exist
      expect(after.graphData?.id).toBeDefined();
      expect(after.roomReservationData.createdGraphEventIds).toHaveLength(1);
      // And they must point to the same Graph event
      expect(after.roomReservationData.createdGraphEventIds[0]).toBe(after.graphData.id);
      // Reproduces the production check: hasGraphId-equivalent must be truthy
      expect(Boolean(after.graphData?.id)).toBe(true);
    });
  });
});
