/**
 * Recurrence Override Reconcile Tests (ROR-1 to ROR-5)
 *
 * Covers PUT /api/admin/events/:id behavior on a series master when the
 * incoming `occurrenceOverrides` array differs from the current set of
 * exception/addition child documents.
 *
 * Bug being fixed: previously the handler iterated only the entries STILL
 * in the incoming array; orphaned exception child documents (entries
 * removed by the user via "Remove customization" on the Recurrence tab)
 * were never soft-deleted. On reload, enrichSeriesMastersWithOverrides
 * re-synthesized the array from the still-living exception docs, causing
 * the override to silently reappear.
 *
 * Expected behavior (post-fix):
 *  - "Remove customization": removed from array → exception child soft-deleted,
 *    NO change to recurrence.exclusions. Date renders as virtual pattern occurrence.
 *  - "Restore exclusion": payload sends recurrence.exclusions without the date →
 *    DB exclusions field updated, virtual occurrence reappears.
 *  - Updates to entries STILL in the array continue to work (no regression).
 *
 * ROR-1: PUT with empty occurrenceOverrides soft-deletes orphan exception
 * ROR-2: PUT with empty occurrenceOverrides does NOT add to recurrence.exclusions
 * ROR-3: PUT with partial occurrenceOverrides only soft-deletes the missing one
 * ROR-4: PUT with recurrence.exclusions emptied removes date from exclusions
 * ROR-5: PUT with unchanged occurrenceOverrides does not soft-delete anything
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createExceptionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Recurrence Override Reconcile (ROR-1 to ROR-5)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken;
  let locationA;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurrenceOverrideReconcile'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);

    locationA = { _id: new ObjectId(), name: 'Room A', displayName: 'Room A', isReservable: true };
    await db.collection(COLLECTIONS.LOCATIONS).insertOne(locationA);
  });

  /**
   * Daily series 2026-04-20..2026-04-25 (six occurrences).
   */
  function buildMaster(overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-25' },
      additions: [],
      exclusions: [],
    };
    return createRecurringSeriesMaster({
      eventId: 'master-ror-1',
      status: STATUS.PUBLISHED,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      recurrence,
      startDateTime: new Date('2026-04-20T14:00:00'),
      endDateTime: new Date('2026-04-20T15:00:00'),
      locations: [locationA._id],
      locationDisplayNames: ['Room A'],
      calendarData: {
        eventTitle: 'Daily Sync',
        eventDescription: 'Recurring sync',
        startDateTime: '2026-04-20T14:00:00',
        endDateTime: '2026-04-20T15:00:00',
        startDate: '2026-04-20',
        startTime: '14:00',
        endDate: '2026-04-20',
        endTime: '15:00',
        locations: [locationA._id],
        locationDisplayNames: 'Room A',
        categories: ['Meeting'],
        recurrence,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      ...overrides,
    });
  }

  describe('ROR-1: PUT with empty occurrenceOverrides soft-deletes orphan exception', () => {
    it('soft-deletes the exception child for 2026-04-23 when its entry is removed', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Customized Title', startTime: '16:00', endTime: '17:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          occurrenceOverrides: [],
        });

      expect(res.status).toBe(200);

      const exceptionAfter = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-04-23',
        eventType: 'exception',
      });
      expect(exceptionAfter).toBeDefined();
      expect(exceptionAfter.isDeleted).toBe(true);
      expect(exceptionAfter.status).toBe('deleted');
    });
  });

  describe('ROR-2: PUT with empty occurrenceOverrides does NOT add to recurrence.exclusions', () => {
    it('removing a customization preserves the virtual occurrence (no exclusion added)', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Customized Title' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          occurrenceOverrides: [],
        });

      expect(res.status).toBe(200);

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = masterAfter.recurrence?.exclusions || [];
      expect(exclusions).not.toContain('2026-04-23');
    });
  });

  describe('ROR-3: PUT with partial occurrenceOverrides only soft-deletes the missing entry', () => {
    it('keeps the kept exception alive and soft-deletes only the removed one', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const ex22 = createExceptionDocument(master, '2026-04-22', { eventTitle: 'Keep Me' });
      const ex23 = createExceptionDocument(master, '2026-04-23', { eventTitle: 'Remove Me' });
      await db.collection(COLLECTIONS.EVENTS).insertMany([ex22, ex23]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          occurrenceOverrides: [
            { occurrenceDate: '2026-04-22', eventTitle: 'Keep Me' },
          ],
        });

      expect(res.status).toBe(200);

      const ex22After = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: ex22._id });
      const ex23After = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: ex23._id });

      expect(ex22After.isDeleted).not.toBe(true);
      expect(ex23After.isDeleted).toBe(true);
      expect(ex23After.status).toBe('deleted');

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = masterAfter.recurrence?.exclusions || [];
      expect(exclusions).not.toContain('2026-04-23');
      expect(exclusions).not.toContain('2026-04-22');
    });
  });

  describe('ROR-4: PUT with recurrence.exclusions emptied removes the exclusion', () => {
    it('handleRestoreExclusion-style payload clears the exclusion', async () => {
      const master = buildMaster({
        recurrence: {
          pattern: { type: 'daily', interval: 1 },
          range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-25' },
          additions: [],
          exclusions: ['2026-04-23'],
        },
      });
      // Mirror exclusion into nested calendarData.recurrence as well, matching production shape.
      master.calendarData.recurrence.exclusions = ['2026-04-23'];
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: {
            pattern: { type: 'daily', interval: 1 },
            range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-25' },
            additions: [],
            exclusions: [],
          },
        });

      expect(res.status).toBe(200);

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = masterAfter.recurrence?.exclusions || [];
      expect(exclusions).not.toContain('2026-04-23');
      expect(exclusions).toHaveLength(0);
    });
  });

  describe('ROR-6: DELETE editScope=thisEvent on customized date (inline override) restores pattern', () => {
    it('removes the inline override and does NOT add to recurrence.exclusions', async () => {
      const master = buildMaster();
      // Inline override (draft-style storage on calendarData.occurrenceOverrides)
      master.calendarData.occurrenceOverrides = [
        { occurrenceDate: '2026-04-22', eventTitle: 'Keep' },
        { occurrenceDate: '2026-04-23', eventTitle: 'Customized 4/23', startTime: '09:15', endTime: '10:00' },
      ];
      await insertEvents(db, [master]);

      const res = await request(app)
        .delete(`/api/admin/events/${master._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-23T09:15:00',
          _version: master._version,
        });

      expect(res.status).toBe(200);

      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = after.recurrence?.exclusions || [];
      // Date should NOT be excluded — it should reappear as a virtual pattern occurrence.
      expect(exclusions).not.toContain('2026-04-23');
      // The inline override for 4/23 should be removed; the kept entry stays.
      const inline = after.calendarData?.occurrenceOverrides || [];
      const dates = inline.map(o => o.occurrenceDate);
      expect(dates).not.toContain('2026-04-23');
      expect(dates).toContain('2026-04-22');
    });
  });

  describe('ROR-7: DELETE editScope=thisEvent on customized date (exception child doc) restores pattern', () => {
    it('soft-deletes the exception child and does NOT add to recurrence.exclusions', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Customized', startTime: '09:15', endTime: '10:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(`/api/admin/events/${master._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-23T09:15:00',
          _version: master._version,
        });

      expect(res.status).toBe(200);

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = masterAfter.recurrence?.exclusions || [];
      expect(exclusions).not.toContain('2026-04-23');

      const exAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: exception._id });
      expect(exAfter.isDeleted).toBe(true);
    });
  });

  describe('ROR-8: DELETE editScope=thisEvent on clean pattern date still adds to exclusions', () => {
    it('preserves existing behavior when no customization exists for the date', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .delete(`/api/admin/events/${master._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-23T09:00:00',
          _version: master._version,
        });

      expect(res.status).toBe(200);

      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = after.recurrence?.exclusions || [];
      expect(exclusions).toContain('2026-04-23');
    });
  });

  describe('ROR-10: re-customize a date after delete restores the soft-deleted exception', () => {
    it('does not throw E11000 when creating an exception for a date previously soft-deleted', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      // First customization → creates exception child doc
      const ex1 = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'First Custom', startTime: '09:15', endTime: '10:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(ex1);

      // Delete the customization (per new behavior: soft-delete only, no exclusion)
      const delRes = await request(app)
        .delete(`/api/admin/events/${master._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-23T09:15:00',
          _version: master._version,
        });
      expect(delRes.status).toBe(200);

      // Verify ex1 is now soft-deleted with the same eventId still occupying the slot.
      const ex1After = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: ex1._id });
      expect(ex1After.isDeleted).toBe(true);
      const persistedEventId = ex1After.eventId;

      // Re-customize the same date — must succeed, not throw E11000.
      // Use the draft thisEvent endpoint which calls createExceptionDocument.
      // To exercise this we directly target the exception-creation path via a PUT
      // to /api/admin/events/:id with editScope=thisEvent.
      const reEditRes = await request(app)
        .put(`/api/admin/events/${master._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-23',
          eventTitle: 'Second Custom',
          startTime: '11:00',
          endTime: '12:00',
        });
      expect(reEditRes.status).toBe(200);

      // After re-customization there should be exactly ONE live exception for the date,
      // and its eventId must still be the deterministic slot (no duplicates in DB).
      const liveExceptions = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-04-23',
        eventType: 'exception',
        isDeleted: { $ne: true },
      }).toArray();
      expect(liveExceptions).toHaveLength(1);
      expect(liveExceptions[0].eventId).toBe(persistedEventId);

      // Total docs (including deleted) for this slot should still be 1 — the
      // resurrection must update the existing doc, not insert a new one.
      const allForSlot = await db.collection(COLLECTIONS.EVENTS).find({
        eventId: persistedEventId,
      }).toArray();
      expect(allForSlot).toHaveLength(1);
    });
  });

  describe('ROR-9: DELETE on exception document directly does NOT add to exclusions', () => {
    it('soft-deletes the exception and leaves recurrence.exclusions untouched', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Customized', startTime: '09:15', endTime: '10:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .delete(`/api/admin/events/${exception._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          _version: exception._version,
        });

      expect(res.status).toBe(200);

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = masterAfter.recurrence?.exclusions || [];
      expect(exclusions).not.toContain('2026-04-23');

      const exAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: exception._id });
      expect(exAfter.isDeleted).toBe(true);
    });
  });

  describe('ROR-5: PUT with unchanged occurrenceOverrides does not soft-delete anything', () => {
    it('round-trip save with same array preserves all exception children', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const ex22 = createExceptionDocument(master, '2026-04-22', { eventTitle: 'Keep A' });
      const ex23 = createExceptionDocument(master, '2026-04-23', { eventTitle: 'Keep B' });
      await db.collection(COLLECTIONS.EVENTS).insertMany([ex22, ex23]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          occurrenceOverrides: [
            { occurrenceDate: '2026-04-22', eventTitle: 'Keep A' },
            { occurrenceDate: '2026-04-23', eventTitle: 'Keep B' },
          ],
        });

      expect(res.status).toBe(200);

      const ex22After = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: ex22._id });
      const ex23After = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: ex23._id });

      expect(ex22After.isDeleted).not.toBe(true);
      expect(ex23After.isDeleted).not.toBe(true);
    });
  });
});
