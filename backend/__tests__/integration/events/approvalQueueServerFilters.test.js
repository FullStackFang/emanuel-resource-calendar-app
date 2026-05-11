/**
 * Approval Queue Server-Side Filters Tests (AQSF-1 to AQSF-4)
 *
 * Verifies that GET /api/events/list?view=approval-queue supports server-side
 * filtering by ?search=, ?startDate=, ?endDate=, and pagination via ?page=/?limit=.
 *
 * Motivated by the All Requests UI rework: with 2000+ records, the frontend can
 * no longer fetch the full list and filter client-side. The list endpoint must
 * narrow results in the database.
 *
 * AQSF-1: ?search= filters approval-queue results by title (case-insensitive)
 * AQSF-2: ?startDate=/?endDate= filters approval-queue by calendarData.startDateTime window
 * AQSF-3: ?page= + ?limit= returns disjoint pages with correct totalCount
 * AQSF-4: Combined search + date + pagination returns the intersection
 * AQSF-5: Search results are still scoped to the default calendar
 *         (production search must not surface sandbox-only matches)
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

describe('Approval Queue Server Filters (AQSF-1 to AQSF-4)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('approvalQueueServerFilters'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection('templeEvents__SystemSettings').deleteMany({});
    // No system-settings doc → getDefaultCalendarOwner() falls back to env mode
    // ('sandbox') which matches TEST_CALENDAR_OWNER on every seeded event.
    invalidateCalendarSettingsCache();
    invalidateCountsCacheTargeted();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);
    approverToken = await createMockToken(approverUser);
  });

  // Helper: build a pending event seeded into a specific month/day.
  // The eventFactory accepts a Date for startDateTime and stores it as a
  // local-time ISO string — matching the production storage shape so the
  // server's local-time string comparisons (`>= '2026-04-01T00:00:00'`) work.
  function pendingOn(year, month, day, eventTitle) {
    const start = new Date(year, month - 1, day, 10, 0, 0);
    const end = new Date(year, month - 1, day, 11, 0, 0);
    return createPendingEvent({
      requesterEmail: requesterUser.email,
      eventTitle,
      startDateTime: start,
      endDateTime: end,
    });
  }

  // ── AQSF-1: ?search= filters by title (case-insensitive) ──

  test('AQSF-1: search filter narrows approval-queue results by title', async () => {
    await insertEvents(db, [
      pendingOn(2026, 4, 10, 'Wedding Reception'),
      pendingOn(2026, 4, 11, 'Bar Mitzvah Ceremony'),
      pendingOn(2026, 4, 12, 'Wedding Rehearsal Dinner'),
      pendingOn(2026, 4, 13, 'Community Meeting'),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'approval-queue', search: 'wedding', limit: 1000 })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(2);
    const titles = res.body.events.map(e => e.calendarData.eventTitle).sort();
    expect(titles).toEqual(['Wedding Reception', 'Wedding Rehearsal Dinner']);
  });

  // ── AQSF-2: ?startDate=/?endDate= filters by calendarData.startDateTime window ──

  test('AQSF-2: date-range filter narrows approval-queue to the requested window', async () => {
    await insertEvents(db, [
      pendingOn(2026, 3, 30, 'Before window'),
      pendingOn(2026, 4, 1, 'Window start'),
      pendingOn(2026, 4, 15, 'Window middle'),
      pendingOn(2026, 4, 30, 'Window end'),
      pendingOn(2026, 5, 1, 'After window'),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({
        view: 'approval-queue',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        limit: 1000,
      })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(3);
    const titles = res.body.events.map(e => e.calendarData.eventTitle).sort();
    expect(titles).toEqual(['Window end', 'Window middle', 'Window start']);
  });

  // ── AQSF-3: pagination returns disjoint pages with correct totalCount ──

  test('AQSF-3: pagination splits results into disjoint pages with correct totalCount', async () => {
    // Seed 30 events all on the same month so pagination is the only thing
    // that distinguishes them. The exact dates don't matter as long as the
    // sort order is deterministic.
    const seeds = [];
    for (let i = 0; i < 30; i++) {
      seeds.push(pendingOn(2026, 4, 1 + (i % 28), `Event ${String(i).padStart(2, '0')}`));
    }
    await insertEvents(db, seeds);

    const page1 = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'approval-queue', page: 1, limit: 20 })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    const page2 = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'approval-queue', page: 2, limit: 20 })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(page1.body.events).toHaveLength(20);
    expect(page2.body.events).toHaveLength(10);
    expect(page1.body.pagination.totalCount).toBe(30);
    expect(page2.body.pagination.totalCount).toBe(30);

    // Disjoint: no event id should appear on both pages.
    const idsP1 = new Set(page1.body.events.map(e => e.eventId));
    const overlap = page2.body.events.filter(e => idsP1.has(e.eventId));
    expect(overlap).toHaveLength(0);
  });

  // ── AQSF-5: search is scoped to the default calendar ──

  test('AQSF-5: search results are filtered by the default calendar (production excludes sandbox)', async () => {
    const PRODUCTION_CALENDAR = 'templeevents@emanuelnyc.org';
    const SANDBOX_CALENDAR = 'templeeventssandbox@emanuelnyc.org';

    // Pin the default calendar to production. Without this, the test would
    // rely on env mode (defaults to sandbox) and prove the wrong thing.
    await db.collection('templeEvents__SystemSettings').insertOne({
      _id: 'calendar-settings',
      defaultCalendar: PRODUCTION_CALENDAR,
    });
    invalidateCalendarSettingsCache();

    await insertEvents(db, [
      // Same title on both calendars — pure calendar discrimination.
      createPendingEvent({
        requesterEmail: requesterUser.email,
        eventTitle: 'Wedding Reception',
        calendarOwner: PRODUCTION_CALENDAR,
      }),
      createPendingEvent({
        requesterEmail: requesterUser.email,
        eventTitle: 'Wedding Reception',
        calendarOwner: SANDBOX_CALENDAR,
      }),
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({ view: 'approval-queue', search: 'wedding', limit: 20 })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    // Both events match the search, but only the production one matches the
    // default calendar — sandbox event must be filtered out.
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].calendarOwner).toBe(PRODUCTION_CALENDAR);
  });

  // ── AQSF-4: combined search + date + pagination returns the intersection ──

  test('AQSF-4: search + date + pagination returns the intersection', async () => {
    await insertEvents(db, [
      pendingOn(2026, 4, 5, 'Wedding A'),     // matches search + date
      pendingOn(2026, 4, 10, 'Wedding B'),    // matches search + date
      pendingOn(2026, 4, 15, 'Wedding C'),    // matches search + date
      pendingOn(2026, 5, 1, 'Wedding D'),     // matches search but outside date
      pendingOn(2026, 4, 8, 'Bar Mitzvah'),   // matches date but not search
      pendingOn(2026, 6, 1, 'Conference'),    // matches neither
    ]);

    const res = await request(app)
      .get(ENDPOINTS.LIST_EVENTS)
      .query({
        view: 'approval-queue',
        search: 'wedding',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        page: 1,
        limit: 20,
      })
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(3);
    const titles = res.body.events.map(e => e.calendarData.eventTitle).sort();
    expect(titles).toEqual(['Wedding A', 'Wedding B', 'Wedding C']);
    expect(res.body.pagination.totalCount).toBe(3);
  });
});
