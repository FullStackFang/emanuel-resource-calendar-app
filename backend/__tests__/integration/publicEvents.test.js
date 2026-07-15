/**
 * Public Events Endpoint Tests (PE)
 *
 * Locks the guest-calendar contract for GET /api/public/events:
 *   - published-only, no deleted, no PII
 *   - the server-side projection is the PII boundary (never frontend omission)
 *   - recurring series masters expand into occurrences; dates owned by an
 *     exception/addition child document are NOT double-rendered
 *   - the removed /api/public/internal-events leak stays removed
 */

const request = require('supertest');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const { initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../__helpers__/testConstants');
const {
  createPublishedEvent,
  createPendingEvent,
  createDraftEvent,
  createRejectedEvent,
  createDeletedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  insertEvents,
  resetEventIdCounter,
} = require('../__helpers__/eventFactory');

// Fixed window so date math never depends on "today".
const WINDOW_START = '2026-03-01T00:00:00';
const WINDOW_END = '2026-03-31T23:59:59';

/**
 * The factory writes calendarData date strings from the Date objects it is given,
 * using LOCAL-time getters (matching production storage). Build local Dates so the
 * stored strings land on the dates we assert against, on any host timezone.
 */
function localDate(dateStr, timeStr = '10:00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function publishedOn(dateStr, overrides = {}) {
  return createPublishedEvent({
    startDateTime: localDate(dateStr, '10:00:00'),
    endDateTime: localDate(dateStr, '11:00:00'),
    calendarOwner: TEST_CALENDAR_OWNER,
    ...overrides,
  });
}

describe('Public Events (PE)', () => {
  let mongoClient;
  let db;
  let app;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('publicEvents'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    resetEventIdCounter();
  });

  const get = (query = {}) =>
    request(app)
      .get('/api/public/events')
      .query({ start: WINDOW_START, end: WINDOW_END, calendarOwner: TEST_CALENDAR_OWNER, ...query });

  describe('PE-1: published events for a date range', () => {
    it('returns published events overlapping the window, without a token', async () => {
      await insertEvents(db, [
        publishedOn('2026-03-10', { eventTitle: 'In Window' }),
        publishedOn('2026-05-10', { eventTitle: 'Out Of Window' }),
      ]);

      const res = await get().expect(200);

      const titles = res.body.events.map(e => e.calendarData.eventTitle);
      expect(titles).toEqual(['In Window']);
    });

    it('returns display fields the mobile agenda renders', async () => {
      await insertEvents(db, [
        publishedOn('2026-03-10', {
          eventTitle: 'Shabbat Service',
          categories: ['Worship'],
          locationDisplayNames: 'Main Sanctuary',
        }),
      ]);

      const res = await get().expect(200);
      const [event] = res.body.events;

      expect(event.id).toBeTruthy();
      expect(event.status).toBe('published');
      expect(event.calendarData).toMatchObject({
        eventTitle: 'Shabbat Service',
        categories: ['Worship'],
        locationDisplayNames: 'Main Sanctuary',
      });
      expect(event.calendarData.startDateTime).toContain('2026-03-10');
      expect(event.calendarData.endDateTime).toContain('2026-03-10');
    });
  });

  describe('PE-2: non-public data excluded', () => {
    it('excludes draft, pending, rejected and deleted events', async () => {
      await insertEvents(db, [
        publishedOn('2026-03-10', { eventTitle: 'Published' }),
        createPendingEvent({ ...publishedOn('2026-03-11'), status: 'pending', eventTitle: 'Pending' }),
        createDraftEvent({ ...publishedOn('2026-03-12'), status: 'draft', eventTitle: 'Draft' }),
        createRejectedEvent({ ...publishedOn('2026-03-13'), status: 'rejected', eventTitle: 'Rejected' }),
        createDeletedEvent({ ...publishedOn('2026-03-14'), status: 'deleted', isDeleted: true, eventTitle: 'Deleted' }),
      ]);

      const res = await get().expect(200);

      const titles = res.body.events.map(e => e.calendarData.eventTitle);
      expect(titles).toEqual(['Published']);
    });

    it('never includes requester PII, graphData or internal notes', async () => {
      const event = publishedOn('2026-03-10', {
        requesterName: 'Jane Congregant',
        requesterEmail: 'jane@example.com',
        phone: '555-0100',
        graphData: { id: 'graph-123', organizer: { emailAddress: { address: 'x@y.z' } } },
      });
      // Internal notes live INSIDE calendarData, alongside the display fields the
      // projection does return — so seed them there, not at top level, or the
      // sub-field allow-list goes untested.
      event.calendarData.setupNotes = 'Gate code 4821';
      event.calendarData.doorNotes = 'Leave side door unlocked';
      event.calendarData.eventNotes = 'Family is going through a divorce';
      await insertEvents(db, [event]);

      const res = await get().expect(200);
      const [returned] = res.body.events;
      const serialized = JSON.stringify(res.body);

      expect(returned.roomReservationData).toBeUndefined();
      expect(returned.graphData).toBeUndefined();
      expect(returned.calendarData.setupNotes).toBeUndefined();
      expect(returned.calendarData.doorNotes).toBeUndefined();
      expect(returned.calendarData.eventNotes).toBeUndefined();
      expect(returned.calendarData.eventDescription).toBeUndefined();

      // Belt and braces: the PII values must not appear anywhere in the payload.
      expect(serialized).not.toContain('jane@example.com');
      expect(serialized).not.toContain('Jane Congregant');
      expect(serialized).not.toContain('555-0100');
      expect(serialized).not.toContain('Gate code 4821');
      expect(serialized).not.toContain('divorce');
      expect(serialized).not.toContain('graph-123');
    });
  });

  describe('PE-3: recurring series', () => {
    it('expands a published series master into its in-window occurrences', async () => {
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Weekly Minyan',
        startDateTime: localDate('2026-03-02', '08:00:00'),
        endDateTime: localDate('2026-03-02', '09:00:00'),
        calendarOwner: TEST_CALENDAR_OWNER,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
          range: { type: 'endDate', startDate: '2026-03-02', endDate: '2026-03-30' },
          additions: [],
          exclusions: [],
        },
      });
      await insertEvents(db, [master]);

      const res = await get().expect(200);

      const dates = res.body.events.map(e => e.calendarData.startDate);
      // Mondays in March 2026: 2, 9, 16, 23, 30
      expect(dates).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
      expect(res.body.events.every(e => e.calendarData.eventTitle === 'Weekly Minyan')).toBe(true);
    });

    it('honors recurrence exclusions', async () => {
      const master = createRecurringSeriesMaster({
        status: 'published',
        startDateTime: localDate('2026-03-02', '08:00:00'),
        endDateTime: localDate('2026-03-02', '09:00:00'),
        calendarOwner: TEST_CALENDAR_OWNER,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
          range: { type: 'endDate', startDate: '2026-03-02', endDate: '2026-03-30' },
          additions: [],
          exclusions: ['2026-03-16'],
        },
      });
      await insertEvents(db, [master]);

      const res = await get().expect(200);

      const dates = res.body.events.map(e => e.calendarData.startDate);
      expect(dates).not.toContain('2026-03-16');
      expect(dates).toHaveLength(4);
    });

    it('renders an overridden occurrence from its child document, not the master', async () => {
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Weekly Minyan',
        startDateTime: localDate('2026-03-02', '08:00:00'),
        endDateTime: localDate('2026-03-02', '09:00:00'),
        calendarOwner: TEST_CALENDAR_OWNER,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
          range: { type: 'endDate', startDate: '2026-03-02', endDate: '2026-03-30' },
          additions: [],
          exclusions: [],
        },
      });
      const exception = createExceptionDocument(
        master,
        '2026-03-16',
        { eventTitle: 'Minyan (Moved)', startTime: '19:00', endTime: '20:00' },
        { status: 'published', calendarOwner: TEST_CALENDAR_OWNER }
      );
      await insertEvents(db, [master, exception]);

      const res = await get().expect(200);

      const byDate = Object.fromEntries(
        res.body.events.map(e => [e.calendarData.startDate, e.calendarData.eventTitle])
      );
      // The overridden date appears exactly once, with the child's title.
      const onThatDate = res.body.events.filter(e => e.calendarData.startDate === '2026-03-16');
      expect(onThatDate).toHaveLength(1);
      expect(byDate['2026-03-16']).toBe('Minyan (Moved)');
      expect(byDate['2026-03-09']).toBe('Weekly Minyan');
    });

    it('suppresses an occurrence whose child document was deleted (cancelled)', async () => {
      const master = createRecurringSeriesMaster({
        status: 'published',
        startDateTime: localDate('2026-03-02', '08:00:00'),
        endDateTime: localDate('2026-03-02', '09:00:00'),
        calendarOwner: TEST_CALENDAR_OWNER,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
          range: { type: 'endDate', startDate: '2026-03-02', endDate: '2026-03-30' },
          additions: [],
          exclusions: [],
        },
      });
      const cancelled = createExceptionDocument(
        master,
        '2026-03-23',
        {},
        { status: 'deleted', isDeleted: true, calendarOwner: TEST_CALENDAR_OWNER }
      );
      await insertEvents(db, [master, cancelled]);

      const res = await get().expect(200);

      const dates = res.body.events.map(e => e.calendarData.startDate);
      expect(dates).not.toContain('2026-03-23');
      expect(dates).toHaveLength(4);
    });
  });

  describe('PE-4: request validation', () => {
    it('400s without start/end', async () => {
      await request(app).get('/api/public/events').expect(400);
    });

    it('400s on an unparseable date', async () => {
      await get({ start: 'not-a-date' }).expect(400);
    });

    it('400s when end is not after start', async () => {
      await get({ start: WINDOW_END, end: WINDOW_START }).expect(400);
    });

    it('400s on an oversized window', async () => {
      await get({ start: '2026-01-01T00:00:00', end: '2027-01-01T00:00:00' }).expect(400);
    });
  });

  describe('PE-5: the internal-events leak stays removed', () => {
    it('404s on GET /api/public/internal-events', async () => {
      await request(app).get('/api/public/internal-events').expect(404);
    });
  });
});
