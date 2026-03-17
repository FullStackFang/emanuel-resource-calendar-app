/**
 * Recurring Event Delete Tests (RD-1 to RD-13)
 *
 * Tests that deleting a single occurrence of a recurring event excludes
 * the date from recurrence.exclusions instead of soft-deleting the master.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createApprover,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createPendingEvent,
  createPublishedEvent,
  insertEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Recurring Event Delete Tests (RD-1 to RD-13)', () => {
  let mongoServer, mongoClient, db, app;
  let adminUser, approverUser;
  let adminToken, approverToken;

  // A 3-day daily recurrence: 2026-03-11, 2026-03-12, 2026-03-13
  const dailyRecurrence = {
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-13' },
    additions: [],
    exclusions: [],
  };

  beforeAll(async () => {
    await initTestKeys();
    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    await db.createCollection(COLLECTIONS.USERS);
    await db.createCollection(COLLECTIONS.EVENTS);
    await db.createCollection(COLLECTIONS.LOCATIONS);
    await db.createCollection(COLLECTIONS.AUDIT_HISTORY);

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    if (mongoClient) await mongoClient.close();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    graphApiMock.clearCallHistory();

    adminUser = createAdmin();
    approverUser = createApprover();
    await insertUsers(db, [adminUser, approverUser]);

    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
  });

  // RD-1: thisEvent on draft: adds to exclusions, does NOT soft-delete master
  test('RD-1: thisEvent on draft adds date to exclusions without soft-deleting master', async () => {
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: { ...dailyRecurrence },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Daily Draft',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.occurrenceExcluded).toBe(true);
    expect(res.body.excludedDate).toBe('2026-03-12');
    expect(res.body.autoDeleted).toBe(false);

    // Verify master is NOT soft-deleted
    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('draft');
    expect(updated.isDeleted).toBeFalsy();
    expect(updated.recurrence.exclusions).toContain('2026-03-12');
  });

  // RD-2: thisEvent on published: adds to exclusions, master status unchanged
  test('RD-2: thisEvent on published event adds exclusion, master stays published', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      recurrence: { ...dailyRecurrence },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Daily Published',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-13T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.occurrenceExcluded).toBe(true);
    expect(res.body.excludedDate).toBe('2026-03-13');

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('published');
    expect(updated.isDeleted).toBeFalsy();
    expect(updated.recurrence.exclusions).toContain('2026-03-13');
  });

  // RD-3: thisEvent removes matching occurrenceOverrides entry
  test('RD-3: thisEvent removes matching occurrenceOverrides entry', async () => {
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: { ...dailyRecurrence },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Daily with Override',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
      occurrenceOverrides: [
        { occurrenceDate: '2026-03-12', eventTitle: 'Custom Title for 3/12' },
        { occurrenceDate: '2026-03-13', eventTitle: 'Custom Title for 3/13' },
      ],
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.occurrenceExcluded).toBe(true);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.recurrence.exclusions).toContain('2026-03-12');
    // Override for 3/12 should be removed, 3/13 should remain
    expect(updated.occurrenceOverrides).toHaveLength(1);
    expect(updated.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-13');
  });

  // RD-4: thisEvent adds statusHistory entry with exclusion reason
  test('RD-4: thisEvent pushes statusHistory entry with exclusion reason', async () => {
    const master = createRecurringSeriesMaster({
      status: 'pending',
      recurrence: { ...dailyRecurrence },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Daily Pending',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
      statusHistory: [{ status: 'pending', changedAt: new Date(), changedBy: 'test' }],
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-11T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    const lastHistory = updated.statusHistory[updated.statusHistory.length - 1];
    expect(lastHistory.status).toBe('pending'); // Preserves current status
    expect(lastHistory.reason).toContain('2026-03-11');
    expect(lastHistory.reason).toContain('excluded');
  });

  // RD-5: allEvents soft-deletes entire master (regression)
  test('RD-5: allEvents scope soft-deletes entire series master', async () => {
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: { ...dailyRecurrence },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Daily to Delete All',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'allEvents',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.occurrenceExcluded).toBeUndefined();

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('deleted');
    expect(updated.isDeleted).toBe(true);
  });

  // RD-6: thisEvent with last remaining occurrence auto-deletes master
  test('RD-6: thisEvent auto-deletes master when last occurrence is excluded', async () => {
    // Only one occurrence: 2026-03-11
    const singleDayRecurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-11' },
      additions: [],
      exclusions: [],
    };
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: singleDayRecurrence,
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Single Occurrence Series',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-11T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.occurrenceExcluded).toBe(true);
    expect(res.body.autoDeleted).toBe(true);
    expect(res.body.remainingOccurrences).toBe(0);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('deleted');
    expect(updated.isDeleted).toBe(true);
    // Should have two statusHistory entries: exclusion + auto-delete
    const histories = updated.statusHistory;
    const autoDeleteEntry = histories.find(h => h.reason === 'Auto-deleted: all occurrences excluded');
    expect(autoDeleteEntry).toBeDefined();
  });

  // RD-7: thisEvent is idempotent (same date twice succeeds)
  test('RD-7: thisEvent is idempotent - excluding same date twice succeeds', async () => {
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: { ...dailyRecurrence },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Daily for Idempotency',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
    });
    const inserted = await insertEvent(db, master);

    // First delete
    const res1 = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12T10:00:00',
        _version: inserted._version,
      });

    expect(res1.status).toBe(200);
    expect(res1.body.occurrenceExcluded).toBe(true);

    // Second delete of same date (use updated version)
    const res2 = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12T10:00:00',
        _version: res1.body._version,
      });

    expect(res2.status).toBe(200);
    expect(res2.body.occurrenceExcluded).toBe(true);

    // Verify exclusion appears only once ($addToSet is idempotent)
    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    const count = updated.recurrence.exclusions.filter(e => e === '2026-03-12').length;
    expect(count).toBe(1);
  });

  // RD-8: thisEvent OCC version conflict returns 409
  test('RD-8: thisEvent with wrong version returns 409', async () => {
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: { ...dailyRecurrence },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Daily for OCC',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
      _version: 5,
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12T10:00:00',
        _version: 3, // Wrong version
      });

    expect(res.status).toBe(409);
  });

  // RD-9: Non-recurring event soft-deletes normally (regression)
  test('RD-9: non-recurring event without editScope soft-deletes normally', async () => {
    const event = createPendingEvent({
      calendarData: {
        eventTitle: 'Single Event',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
    });
    const inserted = await insertEvent(db, event);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ _version: inserted._version });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.occurrenceExcluded).toBeUndefined();

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('deleted');
    expect(updated.isDeleted).toBe(true);
  });

  // RD-10a: thisEvent works when recurrence is only in calendarData (production shape)
  test('RD-10a: thisEvent works with calendarData-only recurrence (no top-level recurrence)', async () => {
    // Simulate production: recurrence only in calendarData, not at top level
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: null, // Explicitly no top-level recurrence
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Production Shape Event',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
        recurrence: { ...dailyRecurrence },
      },
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.occurrenceExcluded).toBe(true);
    expect(res.body.excludedDate).toBe('2026-03-12');
    expect(res.body.autoDeleted).toBe(false);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('draft');
    expect(updated.isDeleted).toBeFalsy();
    // Exclusion should be written to calendarData.recurrence.exclusions
    expect(updated.calendarData.recurrence.exclusions).toContain('2026-03-12');
  });

  // RD-10b: thisEvent auto-deletes when calendarData-only recurrence has single occurrence
  test('RD-10b: thisEvent auto-deletes with calendarData-only recurrence (single occurrence)', async () => {
    const singleDayRecurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-11' },
      additions: [],
      exclusions: [],
    };
    const master = createRecurringSeriesMaster({
      status: 'draft',
      recurrence: null,
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Single Occurrence Production Shape',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
        recurrence: singleDayRecurrence,
      },
    });
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-11T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.occurrenceExcluded).toBe(true);
    expect(res.body.autoDeleted).toBe(true);
    expect(res.body.remainingOccurrences).toBe(0);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('deleted');
    expect(updated.isDeleted).toBe(true);
  });

  // RD-10: thisEvent on non-seriesMaster returns 400
  test('RD-10: thisEvent scope on non-seriesMaster event returns 400', async () => {
    const event = createPendingEvent({
      eventType: 'singleInstance',
      calendarData: {
        eventTitle: 'Single Instance',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
    });
    const inserted = await insertEvent(db, event);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-11T10:00:00',
        _version: inserted._version,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('InvalidEventType');
  });

  // RD-11: allEvents deletes addition events from Graph alongside series master
  test('RD-11: allEvents scope deletes addition events from Graph', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      recurrence: {
        ...dailyRecurrence,
        additions: ['2026-03-15'],
      },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Series With Additions',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
      graphData: { id: 'series-master-graph-id' },
      exceptionEventIds: [
        { date: '2026-03-15', graphId: 'addition-graph-id-1' },
        { date: '2026-03-16', graphId: 'addition-graph-id-2' },
      ],
    });
    // Set seriesMasterId to graphData.id (as production does)
    master.seriesMasterId = 'series-master-graph-id';
    const inserted = await insertEvent(db, master);

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'allEvents',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify soft-deleted in DB
    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('deleted');
    expect(updated.isDeleted).toBe(true);

    // Verify Graph delete calls for addition events
    const deleteCalls = graphApiMock.getCallHistory('deleteCalendarEvent');
    const deletedIds = deleteCalls.map(c => c.eventId);
    expect(deletedIds).toContain('addition-graph-id-1');
    expect(deletedIds).toContain('addition-graph-id-2');
    expect(deleteCalls).toHaveLength(2);
  });

  // RD-12: allEvents tolerates 404 on addition deletion (partial failure)
  test('RD-12: allEvents tolerates 404 on addition and still deletes remaining', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      recurrence: {
        ...dailyRecurrence,
        additions: ['2026-03-15'],
      },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Series With Gone Addition',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
      graphData: { id: 'series-master-graph-id-2' },
      exceptionEventIds: [
        { date: '2026-03-15', graphId: 'gone-addition-id' },
        { date: '2026-03-16', graphId: 'valid-addition-id' },
      ],
    });
    master.seriesMasterId = 'series-master-graph-id-2';
    const inserted = await insertEvent(db, master);

    // Make deleteCalendarEvent throw 404 for the first addition
    let callCount = 0;
    const originalDelete = graphApiMock.deleteCalendarEvent;
    graphApiMock.deleteCalendarEvent = async (owner, calId, eventId) => {
      callCount++;
      if (eventId === 'gone-addition-id') {
        const err = new Error('404 Not Found');
        err.status = 404;
        throw err;
      }
      return originalDelete(owner, calId, eventId);
    };

    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        editScope: 'allEvents',
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify event is still soft-deleted despite the 404
    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('deleted');
    expect(updated.isDeleted).toBe(true);

    // All 3 calls attempted (2 additions + 1 series master)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // RD-13: Delete without editScope still cleans up addition events
  test('RD-13: delete without editScope still deletes addition events from Graph', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      recurrence: {
        ...dailyRecurrence,
        additions: ['2026-03-15'],
      },
      startDateTime: new Date('2026-03-11T10:00:00'),
      endDateTime: new Date('2026-03-11T11:00:00'),
      calendarData: {
        eventTitle: 'Series Deleted Without Scope',
        startDateTime: '2026-03-11T10:00:00',
        endDateTime: '2026-03-11T11:00:00',
      },
      graphData: { id: 'no-scope-master-graph-id' },
      exceptionEventIds: [
        { date: '2026-03-15', graphId: 'no-scope-addition-1' },
      ],
    });
    master.seriesMasterId = 'no-scope-master-graph-id';
    const inserted = await insertEvent(db, master);

    // Delete WITHOUT editScope (like Calendar.jsx handleEventReviewModalDelete)
    const res = await request(app)
      .delete(ENDPOINTS.DELETE_EVENT(inserted._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        _version: inserted._version,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify soft-deleted
    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: inserted._id });
    expect(updated.status).toBe('deleted');

    // Verify addition was deleted from Graph even without editScope
    const deleteCalls = graphApiMock.getCallHistory('deleteCalendarEvent');
    const deletedIds = deleteCalls.map(c => c.eventId);
    expect(deletedIds).toContain('no-scope-addition-1');
  });
});
