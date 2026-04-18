/**
 * Recurring Event Calendar Load Tests (RCL-1 to RCL-9)
 *
 * Verifies that seriesMaster events are returned by the calendar-load endpoint
 * when the viewed date window overlaps the recurrence range, even if it does
 * not overlap the first occurrence's calendarData dates.
 *
 * Root cause fixed: getUnifiedEvents() previously filtered on
 * calendarData.startDateTime/endDateTime which only covers the first occurrence.
 * SeriesMasters now use recurrence.range.endDate for the overlap check.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createPendingEvent,
  insertEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');

describe('Recurring Event Calendar Load (RCL-1 to RCL-9)', () => {
  let mongoClient, db, app;
  let adminUser, adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurringCalendarLoad'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.USERS).deleteMany({});

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);
  });

  // RCL-1: SeriesMaster spanning 3 weeks is returned when querying week 2
  test('RCL-1: seriesMaster returned when querying a future week within recurrence range', async () => {
    // Weekly Tue/Thu from 2026-03-17 to 2026-03-31
    // First occurrence: 2026-03-17 (week 1)
    // Query: week 2 (2026-03-23 to 2026-03-29) — should still return the master
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'thursday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-03-31' },
        additions: [],
        exclusions: [],
      },
      calendarData: {
        eventTitle: 'Weekly Tue/Thu Meeting',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
      },
    });
    await insertEvent(db, master);

    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-03-23T00:00:00',
        endDate: '2026-03-29T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
    expect(res.body.events[0].calendarData.eventTitle).toBe('Weekly Tue/Thu Meeting');
  });

  // RCL-2: SeriesMaster returned when querying the last week of recurrence range
  test('RCL-2: seriesMaster returned when querying the last week of recurrence range', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'thursday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-03-31' },
        additions: [],
        exclusions: [],
      },
      calendarData: {
        eventTitle: 'Weekly Meeting',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
      },
    });
    await insertEvent(db, master);

    // Query week containing 2026-03-31 (the endDate)
    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-03-30T00:00:00',
        endDate: '2026-04-05T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
  });

  // RCL-3: SeriesMaster NOT returned when querying a week AFTER recurrence ends
  test('RCL-3: seriesMaster excluded when querying after recurrence range ends', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-03-31' },
        additions: [],
        exclusions: [],
      },
      calendarData: {
        eventTitle: 'Ended Series',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
      },
    });
    await insertEvent(db, master);

    // Query April 6-12 — past the endDate of 2026-03-31
    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-04-06T00:00:00',
        endDate: '2026-04-12T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
  });

  // RCL-4: Non-recurring events still respect normal date-range filtering (regression)
  test('RCL-4: non-recurring events still use standard date overlap filter', async () => {
    const event = createPendingEvent({
      status: 'published',
      startDateTime: new Date('2026-03-20T14:00:00'),
      endDateTime: new Date('2026-03-20T15:00:00'),
      calendarData: {
        eventTitle: 'Single Event',
        startDateTime: '2026-03-20T14:00:00',
        endDateTime: '2026-03-20T15:00:00',
      },
    });
    await insertEvent(db, event);

    // Query a different week — should NOT return it
    const res1 = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-03-23T00:00:00',
        endDate: '2026-03-29T23:59:59',
      });

    expect(res1.status).toBe(200);
    expect(res1.body.events).toHaveLength(0);

    // Query the correct week — should return it
    const res2 = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-03-16T00:00:00',
        endDate: '2026-03-22T23:59:59',
      });

    expect(res2.status).toBe(200);
    expect(res2.body.events).toHaveLength(1);
    expect(res2.body.events[0].calendarData.eventTitle).toBe('Single Event');
  });

  // RCL-5: SeriesMaster with 'noEnd' range type is always returned for any future week
  test('RCL-5: noEnd seriesMaster returned for any future date window', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'noEnd', startDate: '2026-03-17' },
        additions: [],
        exclusions: [],
      },
      calendarData: {
        eventTitle: 'Infinite Series',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
      },
    });
    await insertEvent(db, master);

    // Query far future — should still return the master
    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-12-01T00:00:00',
        endDate: '2026-12-07T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
  });

  // RCL-6: SeriesMaster with 'numbered' range type is returned for future weeks
  test('RCL-6: numbered seriesMaster returned for future weeks', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'numbered', startDate: '2026-03-17', numberOfOccurrences: 10 },
        additions: [],
        exclusions: [],
      },
      calendarData: {
        eventTitle: 'Numbered Series',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
      },
    });
    await insertEvent(db, master);

    // Query week 5 — well within 10 weekly occurrences
    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-04-13T00:00:00',
        endDate: '2026-04-19T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
  });

  // RCL-7: Draft-created seriesMaster with recurrence ONLY in calendarData (top-level recurrence is null)
  // This reproduces the actual production data shape for events created via the draft workflow
  test('RCL-7: draft-created seriesMaster with calendarData-only recurrence returned for future weeks', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      // Explicitly set top-level recurrence to null (draft workflow shape)
      recurrence: null,
      calendarData: {
        eventTitle: 'Draft-Created Weekly',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'thursday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-04-14' },
          additions: [],
          exclusions: [],
        },
      },
    });
    await insertEvent(db, master);

    // Query week 3 (2026-03-30 to 2026-04-05) — past first occurrence but within recurrence range
    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-03-30T00:00:00',
        endDate: '2026-04-05T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
    expect(res.body.events[0].calendarData.eventTitle).toBe('Draft-Created Weekly');
  });

  // RCL-8: Draft-created noEnd seriesMaster with calendarData-only recurrence
  test('RCL-8: draft-created noEnd seriesMaster with calendarData-only recurrence returned', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      recurrence: null,
      calendarData: {
        eventTitle: 'Draft Infinite Series',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'sunday' },
          range: { type: 'noEnd', startDate: '2026-03-17' },
          additions: [],
          exclusions: [],
        },
      },
    });
    await insertEvent(db, master);

    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-12-01T00:00:00',
        endDate: '2026-12-07T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
  });

  // RCL-9: Draft-created seriesMaster excluded when querying after calendarData recurrence range ends
  test('RCL-9: draft-created seriesMaster excluded after calendarData recurrence range ends', async () => {
    const master = createRecurringSeriesMaster({
      status: 'published',
      startDateTime: new Date('2026-03-17T10:00:00'),
      endDateTime: new Date('2026-03-17T11:00:00'),
      recurrence: null,
      calendarData: {
        eventTitle: 'Draft Ended Series',
        startDateTime: '2026-03-17T10:00:00',
        endDateTime: '2026-03-17T11:00:00',
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-03-31' },
          additions: [],
          exclusions: [],
        },
      },
    });
    await insertEvent(db, master);

    // Query April 6-12 — past the endDate of 2026-03-31
    const res = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwner: TEST_CALENDAR_OWNER,
        startDate: '2026-04-06T00:00:00',
        endDate: '2026-04-12T23:59:59',
      });

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
  });
});
