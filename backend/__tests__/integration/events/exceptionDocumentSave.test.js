/**
 * Exception Document Save Tests (ES-1 to ES-7) — Bug B regression coverage
 *
 * Tests per-occurrence edit via PUT /api/admin/events/:id with editScope='thisEvent'
 * targeting both SERIES MASTERS and already-materialized EXCEPTION DOCUMENTS.
 *
 * Bug B (pre-fix): when the loaded document is itself an exception (not a master),
 * the endpoint uses exception.eventId as if it were a master ID, producing a new
 * exception document with date-suffixed seriesMasterEventId and double-suffixed
 * eventId. This creates duplicates on every re-edit and breaks calendar dedup.
 *
 * Post-fix: resolveSeriesMaster() normalizes the input — exception inputs are
 * resolved to their master, and createExceptionDocument/updateExceptionDocument
 * always receive the real master. Same edit applied twice = one doc.
 *
 * ES-1: PUT thisEvent on master → exception with clean seriesMasterEventId
 * ES-2: PUT thisEvent on existing exception → updates same doc, no duplicate
 * ES-3: PUT thisEvent on exception with missing master → 404 MasterNotFound
 * ES-4: Edit same date twice via different doc ids → exactly 1 exception in collection
 * ES-5: PUT thisEvent on addition document → updates correctly, skips validateOccurrenceDateInRange
 * ES-6: PUT thisEvent on master with Additional Info fields → stored in overrides + top-level
 * ES-7: PUT thisEvent on existing exception → Additional Info fields merge into overrides
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createRequester,
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

describe('Exception Document Save Tests (ES-1 to ES-7)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken, requesterToken;
  let locationA, locationB;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('exceptionDocumentSave'));
    setTestDatabase(db);
    app = createTestApp();
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
    requesterToken = await createMockToken(requesterUser);

    locationA = { _id: new ObjectId(), name: 'Room A', displayName: 'Room A', isReservable: true };
    locationB = { _id: new ObjectId(), name: 'Room B', displayName: 'Room B', isReservable: true };
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([locationA, locationB]);
  });

  /**
   * Create a daily-recurring series master for 2026-03-11..2026-03-13.
   * Master eventId is a clean UUID-style string (no date suffix).
   */
  function buildMaster(overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-13' },
      additions: [],
      exclusions: [],
    };
    return createRecurringSeriesMaster({
      eventId: overrides.eventId || 'master-uuid-123',
      status: STATUS.PENDING,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      recurrence,
      startDateTime: new Date('2026-03-11T14:00:00'),
      endDateTime: new Date('2026-03-11T15:00:00'),
      locations: [locationA._id],
      locationDisplayNames: ['Room A'],
      calendarData: {
        eventTitle: 'Daily Standup',
        eventDescription: 'Recurring standup',
        startDateTime: '2026-03-11T14:00:00',
        endDateTime: '2026-03-11T15:00:00',
        startDate: '2026-03-11',
        startTime: '14:00',
        endDate: '2026-03-11',
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

  describe('ES-1: PUT thisEvent on master → exception with clean seriesMasterEventId', () => {
    it('should create an exception doc with master.eventId (clean, no date suffix) as seriesMasterEventId', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Modified Standup',
          startTime: '16:00',
          endTime: '17:00',
        });

      expect(res.status).toBe(200);

      // A new exception document should exist for date 2026-03-12
      const exceptions = await db.collection(COLLECTIONS.EVENTS).find({
        eventType: 'exception',
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-03-12',
      }).toArray();

      expect(exceptions).toHaveLength(1);
      // Critical: seriesMasterEventId is the master's clean eventId, no date suffix
      expect(exceptions[0].seriesMasterEventId).toBe(master.eventId);
      expect(exceptions[0].seriesMasterEventId).not.toMatch(/-\d{4}-\d{2}-\d{2}$/);
      // eventId format: masterEventId + '-' + occurrenceDate (single suffix)
      expect(exceptions[0].eventId).toBe(`${master.eventId}-2026-03-12`);
      expect(exceptions[0].overrides.startTime).toBe('16:00');
      expect(exceptions[0].overrides.eventTitle).toBe('Modified Standup');
    });
  });

  describe('ES-2: PUT thisEvent on existing exception → updates same doc, no duplicate', () => {
    it('should update the existing exception document instead of creating a duplicate (Bug B regression)', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      // Pre-existing exception for 2026-03-12 (e.g., from a prior edit)
      const existingException = createExceptionDocument(
        master,
        '2026-03-12',
        { startTime: '16:00', endTime: '17:00', eventTitle: 'First Edit' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(existingException);

      // Now click the exception card and edit it again (targeting its _id, NOT the master's)
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(existingException._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          startTime: '18:00',
          endTime: '19:00',
          eventTitle: 'Second Edit',
        });

      expect(res.status).toBe(200);

      // Critical: exactly 1 exception for (master, 2026-03-12) — NO DUPLICATE
      const exceptions = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-03-12',
        eventType: 'exception',
      }).toArray();
      expect(exceptions).toHaveLength(1);

      // And it still references the master's clean eventId (not the exception's own eventId)
      expect(exceptions[0].seriesMasterEventId).toBe(master.eventId);
      expect(exceptions[0].seriesMasterEventId).not.toMatch(/-\d{4}-\d{2}-\d{2}$/);

      // The existing exception's overrides were updated (not a new doc created)
      expect(String(exceptions[0]._id)).toBe(String(existingException._id));
      expect(exceptions[0].overrides.startTime).toBe('18:00');
      expect(exceptions[0].overrides.eventTitle).toBe('Second Edit');

      // There should be NO exception with a corrupted seriesMasterEventId
      const corrupted = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: { $regex: /-\d{4}-\d{2}-\d{2}$/ },
      }).toArray();
      expect(corrupted).toHaveLength(0);
    });
  });

  describe('ES-3: PUT thisEvent on exception with missing master → 404 MasterNotFound', () => {
    it('should return 404 when the exception doc references a master that does not exist', async () => {
      const master = buildMaster();
      // Exception points to a master that was never inserted
      const orphanedException = createExceptionDocument(
        master,
        '2026-03-12',
        { startTime: '16:00' }
      );
      // Override seriesMasterEventId to reference a non-existent master
      orphanedException.seriesMasterEventId = 'nonexistent-master-uuid';
      await db.collection(COLLECTIONS.EVENTS).insertOne(orphanedException);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(orphanedException._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          startTime: '18:00',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('MasterNotFound');
    });
  });

  describe('ES-4: Edit same date twice via different doc ids → exactly 1 exception', () => {
    it('should not duplicate exceptions when the same date is edited via master then via exception', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      // First edit: via master's _id → creates exception
      const res1 = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          startTime: '10:00',
          endTime: '11:00',
        });
      expect(res1.status).toBe(200);

      // Find the exception that was created
      const exception1 = await db.collection(COLLECTIONS.EVENTS).findOne({
        eventType: 'exception',
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-03-12',
      });
      expect(exception1).toBeDefined();

      // Second edit: via exception's _id (simulating re-edit from calendar)
      const res2 = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(exception1._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          startTime: '11:00',
          endTime: '12:00',
        });
      expect(res2.status).toBe(200);

      // Critical: still exactly 1 exception for (master, 2026-03-12)
      const exceptions = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-03-12',
        eventType: 'exception',
      }).toArray();
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].overrides.startTime).toBe('11:00');

      // No corrupted docs were created anywhere
      const corrupted = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: { $regex: /-\d{4}-\d{2}-\d{2}$/ },
      }).toArray();
      expect(corrupted).toHaveLength(0);
    });
  });

  describe('ES-5: PUT thisEvent on addition document → updates correctly', () => {
    it('should update the addition document and NOT reject due to validateOccurrenceDateInRange', async () => {
      const master = buildMaster();
      // Add an ad-hoc date OUTSIDE the recurrence range to the master
      master.calendarData.recurrence.additions = ['2026-04-15'];
      master.recurrence.additions = ['2026-04-15'];
      await insertEvents(db, [master]);

      // Existing addition for 2026-04-15
      const addition = createAdditionDocument(
        master,
        '2026-04-15',
        { startTime: '10:00', endTime: '11:00', eventTitle: 'Ad-hoc Session' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(addition);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(addition._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-15',
          startTime: '14:00',
          endTime: '15:00',
          eventTitle: 'Updated Ad-hoc',
        });

      // MUST succeed — should NOT return 400 about date being outside series range
      expect(res.status).toBe(200);

      // Still exactly 1 addition for this date
      const additions = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-04-15',
        eventType: 'addition',
      }).toArray();
      expect(additions).toHaveLength(1);
      expect(additions[0].overrides.startTime).toBe('14:00');
      expect(additions[0].overrides.eventTitle).toBe('Updated Ad-hoc');
      // Clean seriesMasterEventId
      expect(additions[0].seriesMasterEventId).toBe(master.eventId);
    });
  });

  describe('ES-6: PUT thisEvent on master with Additional Info fields → stored in overrides + top-level', () => {
    it('should persist eventNotes, setupNotes, doorNotes, specialRequirements in exception overrides and top-level fields', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventNotes: 'VIP guest arriving at 2pm',
          setupNotes: 'Extra chairs needed in back row',
          doorNotes: 'Use side entrance only',
          specialRequirements: 'Projector and microphone required',
        });

      expect(res.status).toBe(200);

      const exception = await db.collection(COLLECTIONS.EVENTS).findOne({
        eventType: 'exception',
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-03-12',
      });

      expect(exception).toBeTruthy();

      // Stored in overrides
      expect(exception.overrides.eventNotes).toBe('VIP guest arriving at 2pm');
      expect(exception.overrides.setupNotes).toBe('Extra chairs needed in back row');
      expect(exception.overrides.doorNotes).toBe('Use side entrance only');
      expect(exception.overrides.specialRequirements).toBe('Projector and microphone required');

      // Also denormalized to top-level effective fields
      expect(exception.eventNotes).toBe('VIP guest arriving at 2pm');
      expect(exception.setupNotes).toBe('Extra chairs needed in back row');
      expect(exception.doorNotes).toBe('Use side entrance only');
      expect(exception.specialRequirements).toBe('Projector and microphone required');

      // Also in calendarData (so getEventField reads them correctly on reload)
      expect(exception.calendarData.eventNotes).toBe('VIP guest arriving at 2pm');
      expect(exception.calendarData.setupNotes).toBe('Extra chairs needed in back row');
      expect(exception.calendarData.doorNotes).toBe('Use side entrance only');
      expect(exception.calendarData.specialRequirements).toBe('Projector and microphone required');
    });
  });

  describe('ES-7: PUT thisEvent on existing exception → Additional Info fields merge into overrides', () => {
    it('should merge new Additional Info values into existing exception overrides', async () => {
      const master = buildMaster();
      await insertEvents(db, [master]);

      // Pre-existing exception with only setupNotes
      const existingException = createExceptionDocument(
        master,
        '2026-03-12',
        { startTime: '16:00', setupNotes: 'Original setup note' }
      );
      await db.collection(COLLECTIONS.EVENTS).insertOne(existingException);

      // Update with new Additional Info fields — setupNotes updated, others added fresh
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(existingException._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          setupNotes: 'Updated setup note',
          doorNotes: 'New door note',
          eventNotes: 'New event note',
          specialRequirements: 'New requirements',
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({
        _id: existingException._id,
      });

      // Original override (startTime) preserved, new notes merged in
      expect(updated.overrides.startTime).toBe('16:00');
      expect(updated.overrides.setupNotes).toBe('Updated setup note');
      expect(updated.overrides.doorNotes).toBe('New door note');
      expect(updated.overrides.eventNotes).toBe('New event note');
      expect(updated.overrides.specialRequirements).toBe('New requirements');

      // Top-level effective fields updated too
      expect(updated.setupNotes).toBe('Updated setup note');
      expect(updated.doorNotes).toBe('New door note');
      expect(updated.eventNotes).toBe('New event note');
      expect(updated.specialRequirements).toBe('New requirements');
    });
  });
});
