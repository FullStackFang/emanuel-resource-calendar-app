/**
 * Search View Tests (SV-1 to SV-11)
 *
 * Tests for the ungated 'search' view on GET /api/events/list.
 * All authenticated users (viewer, requester, approver, admin)
 * should be able to search published events.
 *
 * SV-9 to SV-11 verify that both startDate and endDate are required.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createViewer,
  createRequester,
  createApprover,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  createAdditionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

// Fixed date range used by role-access and filter tests.
// Events in those tests are explicitly assigned dates within this range.
const FIXED_START = '2026-06-01';
const FIXED_END   = '2026-06-30';
const FIXED_DT    = '2026-06-15T10:00:00';

describe('Search View Tests (SV-1 to SV-11)', () => {
  let mongoClient;
  let db;
  let app;
  let viewerUser, requesterUser, approverUser, adminUser;
  let viewerToken, requesterToken, approverToken, adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('searchView'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    viewerUser = createViewer();
    requesterUser = createRequester();
    approverUser = createApprover();
    adminUser = createAdmin();
    await insertUsers(db, [viewerUser, requesterUser, approverUser, adminUser]);

    viewerToken = await createMockToken(viewerUser);
    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  // SV-1: Viewer can access search view
  it('SV-1: viewer can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-2: Requester can access search view
  it('SV-2: requester can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-3: Approver can access search view
  it('SV-3: approver can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-4: Admin can access search view
  it('SV-4: admin can access search view', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
  });

  // SV-5: Search view only returns published non-deleted events
  it('SV-5: search view only returns published non-deleted events', async () => {
    const published1 = createPublishedEvent({ eventTitle: 'Published Meeting' });
    const published2 = createPublishedEvent({ eventTitle: 'Published Gathering' });
    const pending = createPendingEvent({ eventTitle: 'Pending Meeting' });
    const draft = createPendingEvent({ eventTitle: 'Draft Event' });
    draft.status = 'draft';
    const rejected = createPendingEvent({ eventTitle: 'Rejected Event' });
    rejected.status = 'rejected';
    const deleted = createPublishedEvent({ eventTitle: 'Deleted Event' });
    deleted.status = 'deleted';
    deleted.isDeleted = true;

    // Pin all events to FIXED_DT so they fall within the required date range
    for (const ev of [published1, published2, pending, draft, rejected, deleted]) {
      ev.calendarData.startDateTime = FIXED_DT;
      ev.calendarData.endDateTime   = '2026-06-15T11:00:00';
    }

    await insertEvents(db, [published1, published2, pending, draft, rejected, deleted]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('Published Meeting');
    expect(titles).toContain('Published Gathering');
    expect(titles).not.toContain('Pending Meeting');
    expect(titles).not.toContain('Draft Event');
    expect(titles).not.toContain('Rejected Event');
    expect(titles).not.toContain('Deleted Event');
  });

  // SV-6: Search view supports text search filter
  it('SV-6: search view supports text search filter', async () => {
    const event1 = createPublishedEvent({ eventTitle: 'Board Meeting' });
    const event2 = createPublishedEvent({ eventTitle: 'Youth Shabbat' });

    // Pin events to FIXED_DT so they fall within the required date range
    event1.calendarData.startDateTime = FIXED_DT;
    event1.calendarData.endDateTime   = '2026-06-15T11:00:00';
    event2.calendarData.startDateTime = FIXED_DT;
    event2.calendarData.endDateTime   = '2026-06-15T11:00:00';

    await insertEvents(db, [event1, event2]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&search=Board&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${requesterToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('Board Meeting');
    expect(titles).not.toContain('Youth Shabbat');
  });

  // SV-7: Search view supports date range filter (unchanged — already uses explicit dates)
  it('SV-7: search view supports date range filter', async () => {
    const inRange = createPublishedEvent({ eventTitle: 'March Event' });
    inRange.calendarData.startDateTime = '2026-03-15T10:00:00';
    inRange.calendarData.endDateTime = '2026-03-15T11:00:00';

    const outOfRange = createPublishedEvent({ eventTitle: 'January Event' });
    outOfRange.calendarData.startDateTime = '2026-01-05T10:00:00';
    outOfRange.calendarData.endDateTime = '2026-01-05T11:00:00';

    await insertEvents(db, [inRange, outOfRange]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-03-01&endDate=2026-03-31`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('March Event');
    expect(titles).not.toContain('January Event');
  });

  // SV-12: overlap semantics — an event that STARTED before the window but is
  // still ongoing inside it must be returned. The old start-only date filter
  // dropped these multi-day/ongoing events (the missed-overlap bug).
  it('SV-12: search returns a multi-day event that started before the window but is ongoing within it', async () => {
    // Spanning event: starts 4 days BEFORE the window, ends 2 days INTO it.
    const spanning = createPublishedEvent({ eventTitle: 'Multi-Day Festival' });
    spanning.calendarData.startDateTime = '2026-05-28T18:00:00';
    spanning.calendarData.endDateTime   = '2026-06-02T12:00:00';

    // Control: entirely before the window — must NOT appear.
    const before = createPublishedEvent({ eventTitle: 'Old Event' });
    before.calendarData.startDateTime = '2026-05-20T10:00:00';
    before.calendarData.endDateTime   = '2026-05-20T11:00:00';

    await insertEvents(db, [spanning, before]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    const titles = res.body.events.map(e =>
      e.calendarData?.eventTitle || e.eventTitle
    );
    expect(titles).toContain('Multi-Day Festival'); // overlaps the window → included
    expect(titles).not.toContain('Old Event');       // entirely before the window → excluded
  });

  // SV-8: admin-browse remains admin-gated (regression check)
  it('SV-8: admin-browse still requires admin role', async () => {
    const viewerRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewerRes.status).toBe(403);

    const requesterRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${requesterToken}`);
    expect(requesterRes.status).toBe(403);

    const approverRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(approverRes.status).toBe(403);

    // Admin should still work
    const adminRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
  });

  // SV-9: search view requires startDate — missing startDate returns 400
  it('SV-9: search view returns 400 when startDate is missing', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&endDate=${FIXED_END}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/startDate and endDate are required/i);
  });

  // SV-10: search view requires endDate — missing endDate returns 400
  it('SV-10: search view returns 400 when endDate is missing', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=${FIXED_START}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/startDate and endDate are required/i);
  });

  // SV-11: search view requires both dates — missing both returns 400
  it('SV-11: search view returns 400 when both dates are missing', async () => {
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/startDate and endDate are required/i);
  });

  // ── Recurring events in search (SV-13+) ──
  // A series master stores only its FIRST occurrence's datetimes, so these
  // tests pin the master start explicitly and search a window months later.
  function makePublishedMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      eventTitle: 'Weekly Torah Study',
      status: 'published',
      startDateTime: new Date('2026-03-10T10:00:00'),
      endDateTime: new Date('2026-03-10T11:00:00'),
      ...overrides,
    });
  }

  it('SV-13: search returns a virtual occurrence of a series that started before the window', async () => {
    await insertEvents(db, [makePublishedMaster()]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    const occ = res.body.events[0];
    expect(occ.calendarData.eventTitle).toBe('Weekly Torah Study');
    expect(occ.eventType).toBe('occurrence');
    expect(occ.calendarData.startDateTime).toBe('2026-06-16T10:00:00');
    expect(res.body.pagination.totalCount).toBe(1);
  });

  it('SV-14: a customized occurrence returns the exception child exactly once (no master duplicate)', async () => {
    const master = makePublishedMaster();
    const exception = createExceptionDocument(
      master, '2026-06-16', { locationDisplayNames: ['Library'] }, { status: 'published' }
    );
    await insertEvents(db, [master, exception]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('exception');
    expect(res.body.pagination.totalCount).toBe(1);
  });

  it('SV-15: an excluded occurrence date returns nothing for that series', async () => {
    const master = makePublishedMaster();
    master.recurrence.exclusions = ['2026-06-16'];
    await insertEvents(db, [master]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
    expect(res.body.pagination.totalCount).toBe(0);
  });

  it('SV-16: an ad-hoc addition child on an off-pattern date is returned', async () => {
    const master = makePublishedMaster();
    // 2026-06-17 is a Wednesday — off the Tuesday pattern
    const addition = createAdditionDocument(master, '2026-06-17', {}, { status: 'published' });
    await insertEvents(db, [master, addition]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-17&endDate=2026-06-17`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('addition');
  });

  it('SV-17: totalCount counts occurrences from the SAME array as the page (no count/find divergence)', async () => {
    const singles = ['A', 'B', 'C'].map(suffix => {
      const ev = createPublishedEvent({ eventTitle: `Single ${suffix}` });
      ev.calendarData.startDateTime = '2026-06-16T14:00:00';
      ev.calendarData.endDateTime = '2026-06-16T15:00:00';
      return ev;
    });
    await insertEvents(db, [makePublishedMaster(), ...singles]);

    const page1 = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16&limit=2&page=1`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(page1.status).toBe(200);
    expect(page1.body.events).toHaveLength(2);
    expect(page1.body.pagination.totalCount).toBe(4); // 3 singles + 1 occurrence
    expect(page1.body.pagination.hasMore).toBe(true);

    const page2 = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-16&endDate=2026-06-16&limit=2&page=2`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(page2.body.events).toHaveLength(2);
    expect(page2.body.pagination.hasMore).toBe(false);
  });

  it('SV-18: a series whose recurrence range ended before the window is not returned', async () => {
    await insertEvents(db, [makePublishedMaster()]); // range ends 2026-06-30

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-07-21&endDate=2026-07-21`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
  });

  it('SV-19: export mode (limit=0) includes expanded occurrences', async () => {
    await insertEvents(db, [makePublishedMaster()]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&startDate=2026-06-01&endDate=2026-06-30&limit=0`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    // Tuesdays in June 2026 within the range: 06-02, 06-09, 06-16, 06-23, 06-30
    expect(res.body.events).toHaveLength(5);
    expect(res.body.events.every(e => e.eventType === 'occurrence')).toBe(true);
  });

  // SV-20: a search text filter can exclude SOME of a master's children while
  // still admitting the master and OTHER children — enrichSeriesMastersWithOverrides
  // must resolve the complete occurrenceOverrides set (forceQuery) so a retitled,
  // non-matching child's date is not resurrected as a phantom synthetic occurrence.
  it('SV-20: forceQuery prevents a phantom occurrence on a date whose child was filtered out by the text search', async () => {
    const master = makePublishedMaster();
    // Matches the 'Torah' search (inherits master title — no title override).
    const matchingException = createExceptionDocument(
      master, '2026-06-16', {}, { status: 'published' }
    );
    // Retitled so it does NOT match 'Torah' — this is the child the in-array
    // shortcut would miss, since the search query filters it out of rawDocs.
    const nonMatchingException = createExceptionDocument(
      master, '2026-06-23', { eventTitle: 'Special Shabbat Dinner' }, { status: 'published' }
    );
    await insertEvents(db, [master, matchingException, nonMatchingException]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=search&search=Torah&startDate=2026-06-16&endDate=2026-06-23`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    const byDate = (d) => res.body.events.filter(e => (e.calendarData?.startDate || e.startDate) === d);

    // Exactly one event on 2026-06-16: the matching exception child.
    expect(byDate('2026-06-16')).toHaveLength(1);
    expect(byDate('2026-06-16')[0].eventType).toBe('exception');

    // Zero events on 2026-06-23: the retitled child doesn't match 'Torah', and no
    // synthetic 'Weekly Torah Study' occurrence may appear on that date either.
    expect(byDate('2026-06-23')).toHaveLength(0);
  });
});
