/**
 * Exception Document Delete Tests (ED-1 to ED-11) — Bug A coverage
 *
 * Tests DELETE /api/admin/events/:id when the target document is itself an
 * exception or addition (not a series master).
 *
 * Bug A (pre-fix): the endpoint's editScope='thisEvent' branch validates
 * event.eventType === 'seriesMaster' and returns 400 InvalidEventType for
 * exception documents — making it impossible to delete an exception via
 * the in-app "Just this occurrence" button.
 *
 * Post-fix: a dedicated exception/addition branch handles three cases:
 *   - thisEvent (or null scope) → soft-delete the exception + add master exclusion
 *     (exception only; additions skip exclusion because they were never in the pattern)
 *   - allEvents → cascade delete master + all children + Graph events
 *
 * ED-1 : thisEvent on exception → soft-delete + master exclusion added
 * ED-2 : thisEvent on addition → soft-delete only, NO exclusion
 * ED-3 : allEvents on exception → cascade master + children + Graph cascade for child graphEventIds
 * ED-4 : no editScope on exception → soft-delete only
 * ED-5 : thisEvent with stale _version → 409 VERSION_CONFLICT
 * ED-6 : orphaned exception (no seriesMasterEventId) → 400 OrphanedException
 * ED-7 : allEvents with missing master → 404 MasterNotFound
 * ED-8 : addition delete uses its own graphEventId (not master's graphData.id)
 * ED-9 : requester attempts delete of another user's exception → 403
 * ED-10: delete already-deleted exception → 409 AlreadyDeleted
 * ED-11: allEvents from exception with already soft-deleted master → live children still cascaded
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createRequester,
  createOtherRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createExceptionDocument,
  createAdditionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { COLLECTIONS, STATUS, ENDPOINTS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');

describe('Exception Document Delete Tests (ED-1 to ED-11)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser, otherRequesterUser;
  let adminToken, requesterToken, otherRequesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('exceptionDocumentDelete'));
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

    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    otherRequesterUser = createOtherRequester();
    await insertUsers(db, [adminUser, requesterUser, otherRequesterUser]);

    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
  });

  /**
   * Create a published daily-recurring master for 2026-03-18..2026-03-20
   * with graphData.id set (simulating a published series synced to Outlook).
   */
  function buildPublishedMaster(overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      additions: [],
      exclusions: [],
    };
    return createRecurringSeriesMaster({
      eventId: overrides.eventId || 'master-uuid-456',
      status: STATUS.PUBLISHED,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      recurrence,
      startDateTime: new Date('2026-03-18T14:00:00'),
      endDateTime: new Date('2026-03-18T15:00:00'),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: 'test-calendar-id',
      graphData: {
        id: 'AAMkMasterGraph',
        subject: 'Daily Standup',
        start: { dateTime: '2026-03-18T14:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-03-18T15:00:00', timeZone: 'America/New_York' },
      },
      calendarData: {
        eventTitle: 'Daily Standup',
        eventDescription: 'Recurring standup',
        startDateTime: '2026-03-18T14:00:00',
        endDateTime: '2026-03-18T15:00:00',
        startDate: '2026-03-18',
        startTime: '14:00',
        endDate: '2026-03-18',
        endTime: '15:00',
        locations: [],
        locationDisplayNames: '',
        categories: ['Meeting'],
        recurrence,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      ...overrides,
    });
  }

  describe('ED-1: thisEvent on exception → soft-delete + master exclusion added', () => {
    it('should soft-delete the exception and add occurrenceDate to master.recurrence.exclusions', async () => {
      const master = buildPublishedMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00', endTime: '17:00' },
        { graphEventId: 'AAMkExceptionGraph' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exception._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          _version: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.occurrenceDeleted).toBe(true);
      expect(res.body.masterExclusionAdded).toBe(true);

      // Exception should be soft-deleted
      const deletedException = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: exception._id });
      expect(deletedException.isDeleted).toBe(true);
      expect(deletedException.status).toBe('deleted');

      // Master's recurrence.exclusions should include the occurrence date
      const updatedMaster = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = updatedMaster.recurrence?.exclusions || updatedMaster.calendarData?.recurrence?.exclusions || [];
      expect(exclusions).toContain('2026-03-19');
    });
  });

  describe('ED-2: thisEvent on addition → soft-delete only, NO exclusion', () => {
    it('should soft-delete the addition without touching master exclusions', async () => {
      const master = buildPublishedMaster();
      master.calendarData.recurrence.additions = ['2026-04-05'];
      master.recurrence.additions = ['2026-04-05'];
      await insertEvents(db, [master]);

      const addition = createAdditionDocument(
        master,
        '2026-04-05',
        { startTime: '10:00', endTime: '11:00', eventTitle: 'Ad-hoc' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(addition);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(addition._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          _version: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.occurrenceDeleted).toBe(true);
      // Additions don't add exclusions — they were never in the pattern
      expect(res.body.masterExclusionAdded).toBe(false);

      const deletedAddition = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: addition._id });
      expect(deletedAddition.isDeleted).toBe(true);

      // Master's exclusions should NOT include this date
      const updatedMaster = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = updatedMaster.recurrence?.exclusions || updatedMaster.calendarData?.recurrence?.exclusions || [];
      expect(exclusions).not.toContain('2026-04-05');
    });
  });

  describe('ED-3: allEvents on exception → cascade master + children + Graph cascade', () => {
    it('should soft-delete master, cascade all children, and delete each child graphEventId from Graph', async () => {
      const master = buildPublishedMaster();
      await insertEvents(db, [master]);

      const exc1 = createExceptionDocument(
        master, '2026-03-19',
        { startTime: '16:00', endTime: '17:00' },
        { graphEventId: 'AAMkExc1Graph' }
      );
      const exc2 = createExceptionDocument(
        master, '2026-03-20',
        { startTime: '10:00', endTime: '11:00' },
        { graphEventId: 'AAMkExc2Graph' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertMany([exc1, exc2]);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exc1._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ editScope: 'allEvents' });

      expect(res.status).toBe(200);
      expect(res.body.cascaded).toBe(true);

      // Master soft-deleted
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(masterAfter.isDeleted).toBe(true);

      // Both children soft-deleted
      const child1 = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: exc1._id });
      const child2 = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: exc2._id });
      expect(child1.isDeleted).toBe(true);
      expect(child2.isDeleted).toBe(true);

      // Graph delete called for master + each child graphEventId
      const deleteCalls = graphApiMock.getCallHistory('deleteCalendarEvent');
      const deletedIds = deleteCalls.map(c => c.eventId);
      expect(deletedIds).toContain('AAMkMasterGraph');
      expect(deletedIds).toContain('AAMkExc1Graph');
      expect(deletedIds).toContain('AAMkExc2Graph');
    });
  });

  describe('ED-4: no editScope on exception → soft-delete only', () => {
    it('should soft-delete the exception without adding any master exclusion', async () => {
      const master = buildPublishedMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exception._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.occurrenceDeleted).toBe(true);

      const deletedException = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: exception._id });
      expect(deletedException.isDeleted).toBe(true);
    });
  });

  describe('ED-5: thisEvent with stale _version → 409 VERSION_CONFLICT', () => {
    it('should return 409 when _version does not match the exception document', async () => {
      const master = buildPublishedMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00' }
      );
      // Bump _version to 2 so client's _version: 1 is stale
      exception._version = 2;
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exception._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          _version: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.details?.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('ED-6: orphaned exception (no seriesMasterEventId) → 400', () => {
    it('should return 400 OrphanedException when seriesMasterEventId is missing', async () => {
      const master = buildPublishedMaster();
      const exception = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00' }
      );
      exception.seriesMasterEventId = null;
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exception._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          _version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('OrphanedException');
    });
  });

  describe('ED-7: allEvents with missing master → 404 MasterNotFound', () => {
    it('should return 404 when the referenced master does not exist', async () => {
      const master = buildPublishedMaster();
      const exception = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00' }
      );
      exception.seriesMasterEventId = 'nonexistent-master';
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exception._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ editScope: 'allEvents' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MasterNotFound');
    });
  });

  describe('ED-8: addition delete uses its own graphEventId (not master\'s graphData.id)', () => {
    it('should call deleteCalendarEvent with the addition\'s graphEventId', async () => {
      const master = buildPublishedMaster();
      master.calendarData.recurrence.additions = ['2026-04-05'];
      master.recurrence.additions = ['2026-04-05'];
      await insertEvents(db, [master]);

      const addition = createAdditionDocument(
        master,
        '2026-04-05',
        { startTime: '10:00' },
        { graphEventId: 'AAMkAddition321' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(addition);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(addition._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          _version: 1,
        });

      expect(res.status).toBe(200);

      const deleteCalls = graphApiMock.getCallHistory('deleteCalendarEvent');
      const deletedIds = deleteCalls.map(c => c.eventId);
      expect(deletedIds).toContain('AAMkAddition321');
      // Must NOT delete the master's graph event
      expect(deletedIds).not.toContain('AAMkMasterGraph');
    });
  });

  describe('ED-9: requester attempts delete of another user\'s exception → 403', () => {
    it('should reject a different requester from deleting the exception', async () => {
      const master = buildPublishedMaster({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      // Other requester (not the owner) tries to delete
      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exception._id))
        .set('Authorization', `Bearer ${otherRequesterToken}`)
        .send({
          editScope: 'thisEvent',
          _version: 1,
        });

      expect(res.status).toBe(403);

      // Exception should NOT be soft-deleted
      const still = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: exception._id });
      expect(still.isDeleted).not.toBe(true);
    });
  });

  describe('ED-10: delete already-deleted exception → 409 AlreadyDeleted', () => {
    it('should return 409 when trying to delete an exception that is already soft-deleted', async () => {
      const master = buildPublishedMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00' },
        { isDeleted: true, status: STATUS.DELETED }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(exception._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          _version: 1,
        });

      // Either an explicit 409 AlreadyDeleted, or a clean success noop message —
      // the post-fix branch returns 409 with details.code === 'already_actioned'.
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('AlreadyDeleted');
    });
  });

  describe('ED-11: allEvents from exception with already soft-deleted master → live children still cascaded', () => {
    it('should still cascade-delete live children when master is already soft-deleted', async () => {
      const master = buildPublishedMaster({
        status: STATUS.DELETED,
        isDeleted: true,
      });
      await insertEvents(db, [master]);

      const liveChild = createExceptionDocument(
        master,
        '2026-03-19',
        { startTime: '16:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(liveChild);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(liveChild._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ editScope: 'allEvents' });

      expect(res.status).toBe(200);

      // Live child should be soft-deleted even though master was already deleted
      const childAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: liveChild._id });
      expect(childAfter.isDeleted).toBe(true);
    });
  });
});
