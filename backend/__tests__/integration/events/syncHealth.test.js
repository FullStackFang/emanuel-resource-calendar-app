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
  createPublishedEventWithGraph,
  createRecurringSeriesMaster,
  createAdditionDocument,
  insertEvent,
} = require('../../__helpers__/eventFactory');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

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
