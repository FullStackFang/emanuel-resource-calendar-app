/**
 * Recurrence Override Reconcile — Draft + Owner-Edit Paths
 *
 * Mirrors the admin-path tests in recurrenceOverrideReconcile.test.js but
 * exercises the two write paths that previously bypassed orphan reconciliation:
 *
 *   - PUT /api/room-reservations/draft/:id      (draft save)
 *   - PUT /api/room-reservations/:id/edit       (owner edit, pending events)
 *
 * Bug being fixed: clicking "Remove customization" on the Recurrence tab of a
 * draft (or owner-editable pending) event filters the inline overrides array
 * locally, but the save handler only persists the inline array to
 * `calendarData.occurrenceOverrides`. Read enrichment computes the array from
 * exception child documents, so any orphan child re-surfaces on next load and
 * the customization appears not to have been removed.
 *
 * Expected behavior (post-fix):
 *   - Draft and owner-edit save paths run the same orphan reconciliation as
 *     admin save: any live exception child whose date is missing from the
 *     incoming `occurrenceOverrides[]` gets soft-deleted.
 *   - recurrence.exclusions is NOT touched (date should fall back to a virtual
 *     pattern occurrence — exclusion is a separate operation).
 *   - Updates to entries STILL in the array continue to work (no regression).
 *
 * Test IDs:
 *   DR-1: draft PUT with empty occurrenceOverrides soft-deletes orphan
 *   DR-2: draft PUT keeping one of two soft-deletes only the missing one
 *   DR-3: draft PUT with unchanged occurrenceOverrides preserves all children
 *   DR-4: draft PUT with empty occurrenceOverrides does NOT add to exclusions
 *   OE-1: owner-edit PUT with empty occurrenceOverrides soft-deletes orphan
 *   OE-2: owner-edit PUT keeping one of two soft-deletes only the missing one
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
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

describe('Recurrence Override Reconcile — Draft + Owner-Edit (DR/OE)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let locationA;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurrenceOverrideReconcileDraftOwner'));
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

    requesterUser = createRequester();
    await insertUsers(db, [requesterUser]);

    requesterToken = await createMockToken(requesterUser);

    locationA = { _id: new ObjectId(), name: 'Room A', displayName: 'Room A', isReservable: true };
    await db.collection(COLLECTIONS.LOCATIONS).insertOne(locationA);
  });

  /**
   * Daily series 2026-04-20..2026-04-25 (six occurrences) owned by requesterUser.
   */
  function buildMaster(status, overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-25' },
      additions: [],
      exclusions: [],
    };
    return createRecurringSeriesMaster({
      eventId: `master-${status}-recon`,
      status,
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

  // -------- Draft tests --------

  describe('DR-1: draft PUT with empty occurrenceOverrides soft-deletes orphan exception', () => {
    it('soft-deletes the exception child for 2026-04-23 when its entry is removed', async () => {
      const master = buildMaster(STATUS.DRAFT);
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Customized Title', startTime: '16:00', endTime: '17:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Daily Sync',
          startDate: '2026-04-20',
          endDate: '2026-04-25',
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

  describe('DR-2: draft PUT keeping one of two soft-deletes only the missing one', () => {
    it('keeps the kept exception alive and soft-deletes only the removed one', async () => {
      const master = buildMaster(STATUS.DRAFT);
      await insertEvents(db, [master]);

      const ex22 = createExceptionDocument(master, '2026-04-22', { eventTitle: 'Keep Me' });
      const ex23 = createExceptionDocument(master, '2026-04-23', { eventTitle: 'Remove Me' });
      await db.collection(COLLECTIONS.EVENTS).insertMany([ex22, ex23]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Daily Sync',
          startDate: '2026-04-20',
          endDate: '2026-04-25',
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
    });
  });

  describe('DR-3: draft PUT with unchanged occurrenceOverrides preserves all children', () => {
    it('round-trip save with same array preserves all exception children', async () => {
      const master = buildMaster(STATUS.DRAFT);
      await insertEvents(db, [master]);

      const ex22 = createExceptionDocument(master, '2026-04-22', { eventTitle: 'Keep A' });
      const ex23 = createExceptionDocument(master, '2026-04-23', { eventTitle: 'Keep B' });
      await db.collection(COLLECTIONS.EVENTS).insertMany([ex22, ex23]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Daily Sync',
          startDate: '2026-04-20',
          endDate: '2026-04-25',
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

  describe('DR-4: draft PUT with empty occurrenceOverrides does NOT add to recurrence.exclusions', () => {
    it('removing a customization preserves the virtual occurrence (no exclusion added)', async () => {
      const master = buildMaster(STATUS.DRAFT);
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Customized Title' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Daily Sync',
          startDate: '2026-04-20',
          endDate: '2026-04-25',
          occurrenceOverrides: [],
        });

      expect(res.status).toBe(200);

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const exclusions = masterAfter.recurrence?.exclusions || [];
      expect(exclusions).not.toContain('2026-04-23');
    });
  });

  // -------- Owner-Edit tests --------

  describe('OE-1: owner-edit PUT with empty occurrenceOverrides soft-deletes orphan exception', () => {
    it('soft-deletes the exception child for 2026-04-23 when its entry is removed', async () => {
      const master = buildMaster(STATUS.PENDING);
      await insertEvents(db, [master]);

      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Customized Title', startTime: '16:00', endTime: '17:00' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(exception);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Daily Sync',
          startDate: '2026-04-20',
          startTime: '14:00',
          endDate: '2026-04-25',
          endTime: '15:00',
          attendeeCount: 10,
          requestedRooms: [locationA._id],
          reservationStartTime: '14:00',
          reservationEndTime: '15:00',
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

  describe('OE-2: owner-edit PUT keeping one of two soft-deletes only the missing one', () => {
    it('keeps the kept exception alive and soft-deletes only the removed one', async () => {
      const master = buildMaster(STATUS.PENDING);
      await insertEvents(db, [master]);

      const ex22 = createExceptionDocument(master, '2026-04-22', { eventTitle: 'Keep Me' });
      const ex23 = createExceptionDocument(master, '2026-04-23', { eventTitle: 'Remove Me' });
      await db.collection(COLLECTIONS.EVENTS).insertMany([ex22, ex23]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Daily Sync',
          startDate: '2026-04-20',
          startTime: '14:00',
          endDate: '2026-04-25',
          endTime: '15:00',
          attendeeCount: 10,
          requestedRooms: [locationA._id],
          reservationStartTime: '14:00',
          reservationEndTime: '15:00',
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
    });
  });
});
