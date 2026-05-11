/**
 * Calendar-Scoped Queues Tests (CSQ-1 to CSQ-6)
 *
 * Verifies that the my-events and approval-queue views are strictly scoped
 * to the system-settings default calendar. The scoping is 1:1 with the
 * environment — production deployments only see production events; sandbox
 * deployments only see sandbox events. No override is exposed on these views.
 *
 * CSQ-1: my-events list returns only events on the default calendar
 * CSQ-2: approval-queue list returns only events on the default calendar
 * CSQ-3: my-events counts include only events on the default calendar
 * CSQ-4: approval-queue counts include only events on the default calendar
 * CSQ-5: ?calendarOwner= query param is silently ignored (no override)
 * CSQ-6: ?calendarOwner=all is silently ignored (cannot blend calendars)
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const {
  invalidateCountsCacheTargeted,
  invalidateCalendarSettingsCache,
} = require('../../../api-server');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

const PRODUCTION_CALENDAR = 'templeevents@emanuelnyc.org';
const SANDBOX_CALENDAR = 'templeeventssandbox@emanuelnyc.org';
const SYSTEM_SETTINGS = 'templeEvents__SystemSettings';

describe('Calendar-Scoped Queues Tests (CSQ-1 to CSQ-6)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('calendarScopedQueues'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(SYSTEM_SETTINGS).deleteMany({});

    // Pin the default calendar to production so the test setup is unambiguous.
    // Without this, getDefaultCalendarOwner() falls back to the env CALENDAR_MODE,
    // which would make the tests order-dependent on process state.
    await db.collection(SYSTEM_SETTINGS).insertOne({
      _id: 'calendar-settings',
      defaultCalendar: PRODUCTION_CALENDAR,
    });

    // Reset both caches so the new system-settings doc and a fresh counts cache
    // are picked up for every test.
    invalidateCalendarSettingsCache();
    invalidateCountsCacheTargeted();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // ── CSQ-1: my-events list returns only events on the default calendar ──

  test('CSQ-1: my-events list excludes events from the non-default calendar', async () => {
    await insertEvents(db, [
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Production event',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Sandbox event',
        calendarOwner: SANDBOX_CALENDAR,
      }),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'my-events', limit: 1000 })
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].calendarData.eventTitle).toBe('Production event');
  });

  // ── CSQ-2: approval-queue list returns only events on the default calendar ──

  test('CSQ-2: approval-queue list excludes events from the non-default calendar', async () => {
    await insertEvents(db, [
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Production pending',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Sandbox pending',
        calendarOwner: SANDBOX_CALENDAR,
      }),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'approval-queue', limit: 1000 })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].calendarData.eventTitle).toBe('Production pending');
  });

  // ── CSQ-3: my-events counts include only events on the default calendar ──

  test('CSQ-3: my-events counts include only events on the default calendar', async () => {
    await insertEvents(db, [
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Prod pending 1',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Prod pending 2',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Sandbox pending',
        calendarOwner: SANDBOX_CALENDAR,
      }),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS_COUNTS)
      .query({ view: 'my-events' })
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.pending).toBe(2);
  });

  // ── CSQ-4: approval-queue counts include only events on the default calendar ──

  test('CSQ-4: approval-queue counts include only events on the default calendar', async () => {
    await insertEvents(db, [
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Prod pending 1',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Prod pending 2',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Sandbox pending',
        calendarOwner: SANDBOX_CALENDAR,
      }),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS_COUNTS)
      .query({ view: 'approval-queue' })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(2);
  });

  // ── CSQ-5: ?calendarOwner= query param is silently ignored ──

  test('CSQ-5: passing ?calendarOwner=<sandbox> on approval-queue is ignored (still production-only)', async () => {
    await insertEvents(db, [
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Prod pending',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Sandbox pending',
        calendarOwner: SANDBOX_CALENDAR,
      }),
    ]);

    // Even though the client tries to override to sandbox, the response is
    // still scoped to the system-settings default (production). This guards
    // against accidental cross-calendar bleed via crafted query params.
    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'approval-queue', calendarOwner: SANDBOX_CALENDAR, limit: 1000 })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].calendarData.eventTitle).toBe('Prod pending');
  });

  // ── CSQ-6: ?calendarOwner=all is silently ignored ──

  test('CSQ-6: ?calendarOwner=all is ignored — approval-queue cannot blend calendars', async () => {
    await insertEvents(db, [
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Prod pending',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Sandbox pending',
        calendarOwner: SANDBOX_CALENDAR,
      }),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'approval-queue', calendarOwner: 'all', limit: 1000 })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    // Strictly one event — the production one. The 'all' sentinel no longer
    // unlocks cross-calendar viewing on this endpoint.
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].calendarOwner).toBe(PRODUCTION_CALENDAR);
  });
});
