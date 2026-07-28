/**
 * Integration tests for GET /api/admin/reports/sync-health.
 *
 * Drives the REAL api-server.js route via createAppForTest (which injects the
 * test DB and graphApiMock), so these exercise shipped logic — not the legacy
 * testApp.js mirror.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const {
  createPublishedEvent,
  createPublishedEventWithGraph,
  createRecurringSeriesMaster,
  createAdditionDocument,
  createDeletedEvent,
  insertEvent,
} = require('../../__helpers__/eventFactory');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');
const syncHealthService = require('../../../services/syncHealthService');
const { REPORT_PROJECTION } = syncHealthService;

const ENDPOINT = '/api/admin/reports/sync-health';
const WINDOW = { startDate: '2026-08-01', endDate: '2026-09-30' };

// createBaseEvent requires Date objects, not strings — it calls .getTime().
const at = (iso) => new Date(iso);

const outlookEvent = (id, date, extra = {}) => ({
  id,
  subject: extra.subject || `Outlook ${id}`,
  start: { dateTime: `${date}T17:00:00.0000000`, timeZone: 'UTC' },
  end: { dateTime: `${date}T18:00:00.0000000`, timeZone: 'UTC' },
  ...extra,
});

describe('GET /api/admin/reports/sync-health', () => {
  let mongoClient;
  let db;
  let app;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('syncHealth'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    graphApiMock.resetMocks();
  });

  const authAs = async (user) => {
    await insertUsers(db, [user]);
    return createMockToken(user);
  };

  // --- permission gate ---------------------------------------------------

  it('rejects a requester with 403', async () => {
    const token = await authAs(createRequester());

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('allows an approver', async () => {
    const token = await authAs(createApprover());

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.window).toEqual({ start: WINDOW.startDate, end: WINDOW.endDate });
    expect(Array.isArray(res.body.calendars)).toBe(true);
  });

  it('allows an admin', async () => {
    const token = await authAs(createAdmin());

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  // --- validation --------------------------------------------------------

  it('400s when endDate is before startDate', async () => {
    const token = await authAs(createAdmin());

    const res = await request(app).get(ENDPOINT)
      .query({ startDate: '2026-09-30', endDate: '2026-08-01' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('400s when the window exceeds 400 days', async () => {
    const token = await authAs(createAdmin());

    const res = await request(app).get(ENDPOINT)
      .query({ startDate: '2026-01-01', endDate: '2027-06-01' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  // --- happy path + seeded discrepancy -----------------------------------

  it('reports a clean calendar with no findings', async () => {
    const token = await authAs(createAdmin());

    const event = createPublishedEventWithGraph({
      eventTitle: 'Board Meeting',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
    });
    await insertEvent(db, event);

    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent(event.graphData.id, '2026-08-14', { subject: 'Board Meeting' }),
    ]);

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.calendars).toHaveLength(1);

    const calendar = res.body.calendars[0];
    expect(calendar.error).toBeNull();
    expect(calendar.missingFromOutlook).toEqual([]);
    expect(calendar.untracked).toEqual([]);
    expect(calendar.counts.matched).toBe(1);
  });

  // REGRESSION for the shipped recurrence.additions bug: an added date the app
  // renders but Outlook never received.
  it('flags an added date that never reached Outlook', async () => {
    const token = await authAs(createAdmin());

    const master = createRecurringSeriesMaster({
      eventTitle: 'Weekly Standup',
      startDateTime: at('2026-08-03T13:00:00'),
      endDateTime: at('2026-08-03T14:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'endDate', startDate: '2026-08-03', endDate: '2026-08-31' },
        additions: ['2026-08-20'],
        exclusions: [],
      },
      status: 'published',
      graphData: { id: 'master-graph-1' },
    });
    await insertEvent(db, master);

    // The addition child exists in Mongo but carries NO graphEventId — exactly
    // the shipped-bug shape.
    const addition = createAdditionDocument(master, '2026-08-20', {});
    addition.status = 'published';
    addition.graphEventId = null;
    await insertEvent(db, addition);

    // Outlook has every Monday occurrence but nothing on the 20th.
    graphApiMock.setMockResponse('getCalendarEvents',
      ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].map((d, i) =>
        outlookEvent(`occ${i}`, d, {
          seriesMasterId: 'master-graph-1', type: 'occurrence', subject: 'Weekly Standup',
        })
      )
    );

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const calendar = res.body.calendars[0];
    const flagged = [...calendar.untethered, ...calendar.missingFromOutlook];
    expect(flagged.some(f => f.eventType === 'addition')).toBe(true);
  });

  // --- failed-deletion detection across BOTH linkage shapes ---------------
  //
  // Child documents (exception/addition) are created by exceptionDocumentService
  // with `graphData: null` and the Graph id on a top-level `graphEventId`. The
  // shipped deleted-docs query matched only `graphData.id`, so every deleted
  // child was invisible to the failed-deletion check.

  it('flags a deleted addition child whose Outlook event survived', async () => {
    const token = await authAs(createAdmin());

    const master = createRecurringSeriesMaster({
      eventTitle: 'Weekly Standup',
      startDateTime: at('2026-08-03T13:00:00'),
      endDateTime: at('2026-08-03T14:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'endDate', startDate: '2026-08-03', endDate: '2026-08-31' },
        additions: ['2026-08-20'],
        exclusions: [],
      },
      status: 'published',
      graphData: { id: 'master-graph-1' },
    });
    await insertEvent(db, master);

    // Deleted in the app, but linked through graphEventId (graphData stays null).
    const addition = createAdditionDocument(master, '2026-08-20', {}, {
      status: 'deleted',
      isDeleted: true,
      graphEventId: 'addition-graph-1',
    });
    await insertEvent(db, addition);

    // Outlook still shows the added date alongside every pattern occurrence.
    graphApiMock.setMockResponse('getCalendarEvents', [
      ...['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].map((d, i) =>
        outlookEvent(`occ${i}`, d, {
          seriesMasterId: 'master-graph-1', type: 'occurrence', subject: 'Weekly Standup',
        })
      ),
      outlookEvent('addition-graph-1', '2026-08-20', { subject: 'Weekly Standup' }),
    ]);

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const calendar = res.body.calendars[0];
    const flagged = calendar.shouldNotBeInOutlook.find(f => f.graphId === 'addition-graph-1');
    expect(flagged).toBeDefined();
    expect(flagged.reason).toBe('deleted in app but still in Outlook');
    // ...and it must NOT be summarized as an event the app does not manage.
    expect(calendar.untracked.some(u => u.graphId === 'addition-graph-1')).toBe(false);
  });

  it('still flags a deleted single instance linked via graphData.id', async () => {
    const token = await authAs(createAdmin());

    const doc = createDeletedEvent({
      eventTitle: 'Cancelled Concert',
      previousStatus: 'published',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
      graphData: { id: 'single-graph-1' },
    });
    await insertEvent(db, doc);

    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('single-graph-1', '2026-08-14', { subject: 'Cancelled Concert' }),
    ]);

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const calendar = res.body.calendars[0];
    expect(calendar.shouldNotBeInOutlook).toHaveLength(1);
    expect(calendar.shouldNotBeInOutlook[0].graphId).toBe('single-graph-1');
  });

  // --- mailbox-scoped calendarId (regression) ----------------------------
  //
  // Graph calendarId is a PER-MAILBOX opaque handle. Real data has the same
  // calendarOwner carrying several different stored calendarId values — some
  // captured from another mailbox's view of the shared calendar (the
  // calendar-config.json value), which 404s as ErrorItemNotFound when used as
  // /users/{owner}/calendars/{id}. Grouping by calendarId also split one real
  // mailbox into several phantom calendars, each diffed against a partial
  // Outlook view, manufacturing bogus findings.

  it('groups a mailbox once regardless of differing stored calendarId values', async () => {
    const token = await authAs(createAdmin());

    // Three docs, one owner, three different stored calendarId shapes —
    // mirrors the real database exactly.
    const foreignCalendarId = 'AAMkAFOREIGN_MAILBOX_SCOPED_ID=';
    const ownCalendarId = 'AAMkAOWN_MAILBOX_SCOPED_ID=';

    for (const [i, calendarId] of [foreignCalendarId, ownCalendarId, null].entries()) {
      const doc = createPublishedEventWithGraph({
        eventTitle: `Event ${i}`,
        startDateTime: at(`2026-08-1${i + 1}T13:00:00`),
        endDateTime: at(`2026-08-1${i + 1}T14:00:00`),
        calendarOwner: TEST_CALENDAR_OWNER,
        calendarId,
      });
      await insertEvent(db, doc);
    }

    graphApiMock.setMockResponse('getCalendarEvents', []);

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // One mailbox => one calendar entry, not three.
    expect(res.body.calendars).toHaveLength(1);
    expect(res.body.calendars[0].calendarOwner).toBe(TEST_CALENDAR_OWNER);
    // All three docs are expected on that single calendar.
    expect(res.body.calendars[0].counts.appExpected).toBe(3);
  });

  it('queries the mailbox default calendar rather than a stored calendarId', async () => {
    const token = await authAs(createAdmin());

    const doc = createPublishedEventWithGraph({
      eventTitle: 'Foreign Calendar Id Event',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
      calendarOwner: TEST_CALENDAR_OWNER,
      // A calendarId belonging to a DIFFERENT mailbox. Passing this through
      // to Graph is what produced the 404 ErrorItemNotFound in production.
      calendarId: 'AAMkAFOREIGN_MAILBOX_SCOPED_ID=',
    });
    await insertEvent(db, doc);

    graphApiMock.setMockResponse('getCalendarEvents', []);

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const calls = graphApiMock.getCallHistory('getCalendarEvents');
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe(TEST_CALENDAR_OWNER);
    // null => /users/{owner}/calendar/calendarView (the mailbox default)
    expect(calls[0].calendarId).toBeNull();
  });

  // --- calendarOwner scoping ---------------------------------------------

  it('reports only the requested calendarOwner when one is given', async () => {
    const token = await authAs(createAdmin());

    const wanted = createPublishedEventWithGraph({
      eventTitle: 'Wanted Mailbox Event',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
      calendarOwner: TEST_CALENDAR_OWNER,
    });
    await insertEvent(db, wanted);

    const other = createPublishedEventWithGraph({
      eventTitle: 'Other Mailbox Event',
      startDateTime: at('2026-08-15T13:00:00'),
      endDateTime: at('2026-08-15T14:00:00'),
      calendarOwner: 'other@emanuelnyc.org',
    });
    await insertEvent(db, other);

    graphApiMock.setMockResponse('getCalendarEvents', []);

    const res = await request(app).get(ENDPOINT)
      .query({ ...WINDOW, calendarOwner: TEST_CALENDAR_OWNER })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.calendars).toHaveLength(1);
    expect(res.body.calendars[0].calendarOwner).toBe(TEST_CALENDAR_OWNER);

    // The other mailbox must not be fetched from Graph at all.
    const calls = graphApiMock.getCallHistory('getCalendarEvents');
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe(TEST_CALENDAR_OWNER);
  });

  // calendar-config.json stores 'TempleEvents@...' while documents store
  // 'templeevents@...'. The filter must not care.
  it('matches calendarOwner case-insensitively', async () => {
    const token = await authAs(createAdmin());

    const doc = createPublishedEventWithGraph({
      eventTitle: 'Case Test',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
      calendarOwner: TEST_CALENDAR_OWNER, // lower-case in the document
    });
    await insertEvent(db, doc);

    graphApiMock.setMockResponse('getCalendarEvents', []);

    const res = await request(app).get(ENDPOINT)
      .query({ ...WINDOW, calendarOwner: TEST_CALENDAR_OWNER.toUpperCase() })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.calendars).toHaveLength(1);
    expect(res.body.calendars[0].counts.appExpected).toBe(1);
  });

  // --- database-side scoping and projection -------------------------------

  it('scopes the events query itself, not the results in JS', async () => {
    await insertEvent(db, createPublishedEventWithGraph({
      eventTitle: 'Wanted', startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'), calendarOwner: TEST_CALENDAR_OWNER,
    }));
    await insertEvent(db, createPublishedEventWithGraph({
      eventTitle: 'Other Mailbox', startDateTime: at('2026-08-15T13:00:00'),
      endDateTime: at('2026-08-15T14:00:00'), calendarOwner: 'other@emanuelnyc.org',
    }));

    graphApiMock.setMockResponse('getCalendarEvents', []);

    // Watch what actually leaves the database. Driven through the service
    // rather than the route because db.collection() hands out a fresh wrapper
    // per call, so patching one instance would not intercept the route's.
    const events = db.collection(COLLECTIONS.EVENTS);
    const finds = [];
    const spying = {
      distinct: events.distinct.bind(events),
      find: (filter, options) => { finds.push({ filter, options }); return events.find(filter, options); },
    };

    // Requested in the OTHER casing, which is how calendar-config spells it.
    const report = await syncHealthService.runSyncHealthCheck({
      eventsCollection: spying,
      graphApi: graphApiMock,
      startDate: WINDOW.startDate,
      endDate: WINDOW.endDate,
      calendarOwner: TEST_CALENDAR_OWNER.toUpperCase(),
    });

    expect(report.calendars).toHaveLength(1);
    expect(finds).toHaveLength(2); // published + deleted
    for (const { filter, options } of finds) {
      // Owner scope is IN the query, resolved to the casing actually stored.
      expect(filter.calendarOwner.$in).toContain(TEST_CALENDAR_OWNER);
      expect(filter.calendarOwner.$in).not.toContain('other@emanuelnyc.org');
      // ...and only the fields the report reads come back.
      expect(options.projection).toBe(REPORT_PROJECTION);
    }
  });

  // The projection is the riskiest hardening change: a missed field degrades
  // findings silently rather than throwing. This proves equivalence by running
  // the same seeded data both ways.
  it('produces identical findings with and without the projection', async () => {
    // One fixture per finding type.
    const matched = createPublishedEventWithGraph({
      eventTitle: 'Matched', startDateTime: at('2026-08-05T13:00:00'),
      endDateTime: at('2026-08-05T14:00:00'), graphId: 'match-1',
    });
    const missing = createPublishedEventWithGraph({
      eventTitle: 'Missing', startDateTime: at('2026-08-06T13:00:00'),
      endDateTime: at('2026-08-06T14:00:00'), graphId: 'gone-1',
    });
    const untethered = createPublishedEvent({
      eventTitle: 'Never Linked', startDateTime: at('2026-08-07T13:00:00'),
      endDateTime: at('2026-08-07T14:00:00'), graphData: {},
    });
    const zombie = createDeletedEvent({
      eventTitle: 'Deleted But Present', previousStatus: 'published',
      startDateTime: at('2026-08-08T13:00:00'), endDateTime: at('2026-08-08T14:00:00'),
      graphData: { id: 'zombie-1' },
    });
    const master = createRecurringSeriesMaster({
      eventTitle: 'Weekly With Exclusion',
      startDateTime: at('2026-08-03T13:00:00'), endDateTime: at('2026-08-03T14:00:00'),
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'endDate', startDate: '2026-08-03', endDate: '2026-08-17' },
        additions: [], exclusions: ['2026-08-10'],
      },
      status: 'published',
      graphData: { id: 'series-1' },
    });
    for (const doc of [matched, missing, untethered, zombie, master]) await insertEvent(db, doc);

    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('match-1', '2026-08-05', { subject: 'Matched' }),
      outlookEvent('zombie-1', '2026-08-08', { subject: 'Deleted But Present' }),
      outlookEvent('stray-1', '2026-08-09', { subject: 'Booked In Outlook' }),
      ...['2026-08-03', '2026-08-10', '2026-08-17'].map((d, i) =>
        outlookEvent(`occ-${i}`, d, {
          seriesMasterId: 'series-1', type: 'occurrence', subject: 'Weekly With Exclusion',
        })),
    ]);

    const events = db.collection(COLLECTIONS.EVENTS);
    const args = {
      graphApi: graphApiMock,
      startDate: WINDOW.startDate,
      endDate: WINDOW.endDate,
      calendarOwner: TEST_CALENDAR_OWNER,
    };

    const projected = await syncHealthService.runSyncHealthCheck({ eventsCollection: events, ...args });

    // Same collection with the projection stripped off every find().
    const unprojected = await syncHealthService.runSyncHealthCheck({
      eventsCollection: {
        distinct: events.distinct.bind(events),
        find: (filter) => events.find(filter),
      },
      ...args,
    });

    // Every finding type must be represented, or the parity claim is vacuous.
    const [cal] = projected.calendars;
    expect(cal.missingFromOutlook.length).toBeGreaterThan(0);
    expect(cal.untethered.length).toBeGreaterThan(0);
    expect(cal.shouldNotBeInOutlook.length).toBeGreaterThan(0);
    expect(cal.untracked.length).toBeGreaterThan(0);

    expect(projected).toEqual(unprojected);
  });

  // --- partial failure ----------------------------------------------------

  it('returns partial results when one calendar Graph call fails', async () => {
    const token = await authAs(createAdmin());

    const healthy = createPublishedEventWithGraph({
      eventTitle: 'Healthy Calendar Event',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
      calendarOwner: TEST_CALENDAR_OWNER,
    });
    await insertEvent(db, healthy);

    const broken = createPublishedEventWithGraph({
      eventTitle: 'Broken Calendar Event',
      startDateTime: at('2026-08-15T13:00:00'),
      endDateTime: at('2026-08-15T14:00:00'),
      calendarOwner: 'broken@emanuelnyc.org',
    });
    await insertEvent(db, broken);

    // statusCode 500 is NOT in the retryable set, so this fails fast instead of
    // making the test sit through exponential backoff.
    const boom = new Error('Graph is down');
    boom.statusCode = 500;
    graphApiMock.setMockResponse('getCalendarEvents', {
      [TEST_CALENDAR_OWNER]: [outlookEvent(healthy.graphData.id, '2026-08-14')],
      'broken@emanuelnyc.org': boom,
    });

    const res = await request(app).get(ENDPOINT).query(WINDOW)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.calendars).toHaveLength(2);

    const brokenEntry = res.body.calendars.find(c => c.calendarOwner === 'broken@emanuelnyc.org');
    expect(brokenEntry.error).toBe('Graph is down');

    const healthyEntry = res.body.calendars.find(c => c.calendarOwner === TEST_CALENDAR_OWNER);
    expect(healthyEntry.error).toBeNull();
    expect(healthyEntry.counts.matched).toBe(1);
  });
});
