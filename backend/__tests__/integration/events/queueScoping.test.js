/**
 * Queue Scoping Tests (QS-1 to QS-14)
 *
 * Verifies that per-occurrence override documents (eventType: 'exception' |
 * 'addition') are excluded from the Approval Queue and My Reservations list
 * + counts endpoints, and that publish/reject endpoints reject child-targeted
 * requests with HTTP 400 INVALID_TARGET_EVENT_TYPE.
 *
 * Spec: openspec/changes/scope-pending-queues-to-masters/specs/pending-queue-scoping/spec.md
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { invalidateCountsCacheTargeted } = require('../../../api-server');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  createRecurringSeriesMaster,
  createExceptionDocument,
  createAdditionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { STATUS, COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Queue Scoping Tests (QS-1 to QS-14)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('queueScoping'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    invalidateCountsCacheTargeted();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // Build a pending recurring series master with the given number of pending exception children.
  function buildPendingSeriesWithChildren({ requesterEmail, exceptionDates = [], additionDates = [] }) {
    const master = createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'Weekly Team Sync',
      requesterEmail,
    });

    const exceptions = exceptionDates.map(date =>
      createExceptionDocument(master, date, { startTime: '15:00', endTime: '16:00' })
    );
    const additions = additionDates.map(date =>
      createAdditionDocument(master, date, { startTime: '15:00', endTime: '16:00' })
    );

    return { master, children: [...exceptions, ...additions] };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Approval-queue list scoping
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-1: approval-queue list excludes pending exception children (master with 2 exceptions → 1 row)', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      exceptionDates: ['2026-03-17', '2026-03-24'],
    });
    await insertEvents(db, [master, ...children]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventId).toBe(master.eventId);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
  });

  it('QS-2: approval-queue list excludes pending addition children', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      additionDates: ['2026-04-07'],
    });
    await insertEvents(db, [master, ...children]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
  });

  it('QS-3: approval-queue list still returns pending singleInstance (filter is not over-broad)', async () => {
    const single = createPendingEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'One-off lecture',
    });
    await insertEvents(db, [single]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventId).toBe(single.eventId);
  });

  it('QS-4: approval-queue list includes legacy pending events with no eventType field', async () => {
    const legacy = createPendingEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Legacy event',
    });
    delete legacy.eventType;
    await insertEvents(db, [legacy]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventId).toBe(legacy.eventId);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Approval-queue counts scoping
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-5: approval-queue counts match list length (pending master + 2 children → pending=1)', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      exceptionDates: ['2026-03-17', '2026-03-24'],
    });
    await insertEvents(db, [master, ...children]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(1);
    expect(res.body.all).toBe(1);
  });

  it('QS-6: needsAttention count does not double-count when children inherit pendingEditRequest', async () => {
    const master = createPublishedEventWithEditRequest({
      requesterEmail: requesterUser.email,
      eventTitle: 'Weekly series w/ edit req',
    });
    master.eventType = 'seriesMaster';
    master.recurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
      additions: [],
      exclusions: [],
    };

    const child = createExceptionDocument(master, '2026-03-17', { startTime: '14:00' });
    child.pendingEditRequest = { ...master.pendingEditRequest };

    await insertEvents(db, [master, child]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.needsAttention).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // My-events list + counts scoping
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-7: my-events list excludes requester’s pending exception children (master with 3 → 1 row)', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      exceptionDates: ['2026-03-17', '2026-03-24', '2026-03-31'],
    });
    await insertEvents(db, [master, ...children]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=pending`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventId).toBe(master.eventId);
  });

  it('QS-8: my-events list and counts exclude published exception children', async () => {
    const master = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Published weekly series',
    });
    master.eventType = 'seriesMaster';
    master.recurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
      additions: [],
      exclusions: [],
    };
    const children = [
      createExceptionDocument(master, '2026-03-17', { startTime: '14:00' }),
      createExceptionDocument(master, '2026-03-24', { startTime: '14:00' }),
    ];
    // Children inherit published status from master
    children.forEach(c => { c.status = STATUS.PUBLISHED; });

    await insertEvents(db, [master, ...children]);

    const listRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=published`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);
    expect(listRes.body.events).toHaveLength(1);
    expect(listRes.body.events[0].eventId).toBe(master.eventId);

    const countsRes = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=my-events`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);
    expect(countsRes.body.published).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Publish/reject write-side guards
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-9: publish targeting an exception doc returns 400 INVALID_TARGET_EVENT_TYPE (no state change)', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      exceptionDates: ['2026-03-17'],
    });
    await insertEvents(db, [master, ...children]);
    const child = children[0];

    const res = await request(app)
      .put(`/api/admin/events/${child._id}/publish`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ notes: 'should fail' })
      .expect(400);

    expect(res.body.code).toBe('INVALID_TARGET_EVENT_TYPE');
    expect(res.body.eventType).toBe('exception');
    expect(res.body.seriesMasterEventId).toBe(master.eventId);

    const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
    const childAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: child._id });
    expect(masterAfter.status).toBe(STATUS.PENDING);
    expect(childAfter.status).toBe(STATUS.PENDING);
  });

  it('QS-10: publish targeting an addition doc returns 400 INVALID_TARGET_EVENT_TYPE', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      additionDates: ['2026-04-07'],
    });
    await insertEvents(db, [master, ...children]);
    const child = children[0];

    const res = await request(app)
      .put(`/api/admin/events/${child._id}/publish`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ notes: 'should fail' })
      .expect(400);

    expect(res.body.code).toBe('INVALID_TARGET_EVENT_TYPE');
    expect(res.body.eventType).toBe('addition');
  });

  it('QS-11: reject targeting an exception doc returns 400 INVALID_TARGET_EVENT_TYPE (no state change)', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      exceptionDates: ['2026-03-17'],
    });
    await insertEvents(db, [master, ...children]);
    const child = children[0];

    const res = await request(app)
      .put(`/api/admin/events/${child._id}/reject`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ reason: 'no' })
      .expect(400);

    expect(res.body.code).toBe('INVALID_TARGET_EVENT_TYPE');
    expect(res.body.eventType).toBe('exception');

    const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
    const childAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: child._id });
    expect(masterAfter.status).toBe(STATUS.PENDING);
    expect(childAfter.status).toBe(STATUS.PENDING);
  });

  it('QS-12: reject targeting an addition doc returns 400 INVALID_TARGET_EVENT_TYPE', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      additionDates: ['2026-04-07'],
    });
    await insertEvents(db, [master, ...children]);
    const child = children[0];

    const res = await request(app)
      .put(`/api/admin/events/${child._id}/reject`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ reason: 'no' })
      .expect(400);

    expect(res.body.code).toBe('INVALID_TARGET_EVENT_TYPE');
    expect(res.body.eventType).toBe('addition');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Regression guards — master publish/reject still works and cascades
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-13: publishing the master still returns 200 and cascades published status to children', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      exceptionDates: ['2026-03-17', '2026-03-24'],
    });
    await insertEvents(db, [master, ...children]);

    await request(app)
      .put(`/api/admin/events/${master._id}/publish`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ notes: 'approved', createCalendarEvent: true })
      .expect(200);

    const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
    expect(masterAfter.status).toBe(STATUS.PUBLISHED);

    const childrenAfter = await db.collection(COLLECTIONS.EVENTS)
      .find({ seriesMasterEventId: master.eventId, eventType: { $in: ['exception', 'addition'] } })
      .toArray();
    expect(childrenAfter).toHaveLength(2);
    childrenAfter.forEach(c => expect(c.status).toBe(STATUS.PUBLISHED));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Projection parity — list endpoint returns the full recurrence shape
  // so the shared review modal renders recurrence regardless of entry point
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-15: approval-queue list returns top-level recurrence on pending series master', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'Daily Morning Minyan',
      requesterEmail: requesterUser.email,
      recurrence: {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-21', endDate: '2026-04-23' },
        additions: [],
        exclusions: [],
      },
    });
    await insertEvents(db, [master]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    const row = res.body.events[0];
    expect(row.recurrence).toBeTruthy();
    expect(row.recurrence.pattern?.type).toBe('daily');
    expect(row.recurrence.range?.startDate).toBe('2026-04-21');
    expect(row.recurrence.range?.endDate).toBe('2026-04-23');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Exception enrichment — server spreads exception child docs onto master's
  // occurrenceOverrides array so the shared review modal shows the exception list
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-17: approval-queue list spreads exception doc overrides onto master occurrenceOverrides', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'Recurring with exception',
      requesterEmail: requesterUser.email,
      recurrence: {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-21', endDate: '2026-04-23' },
        additions: [],
        exclusions: [],
      },
    });
    const child = createExceptionDocument(master, '2026-04-22', {
      startTime: '10:15',
      endTime: '11:00',
      locationDisplayNames: '5th Avenue Building',
    });
    await insertEvents(db, [master, child]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    const row = res.body.events[0];
    expect(Array.isArray(row.occurrenceOverrides)).toBe(true);
    expect(row.occurrenceOverrides).toHaveLength(1);
    expect(row.occurrenceOverrides[0].occurrenceDate).toBe('2026-04-22');
    expect(row.occurrenceOverrides[0].startTime).toBe('10:15');
    expect(row.occurrenceOverrides[0].endTime).toBe('11:00');
  });

  it('QS-18: my-events list spreads exception doc overrides onto master occurrenceOverrides', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'My recurring with exception',
      requesterEmail: requesterUser.email,
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      },
    });
    const child = createExceptionDocument(master, '2026-03-17', { startTime: '14:00' });
    await insertEvents(db, [master, child]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=pending`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].occurrenceOverrides).toHaveLength(1);
    expect(res.body.events[0].occurrenceOverrides[0].occurrenceDate).toBe('2026-03-17');
    expect(res.body.events[0].occurrenceOverrides[0].startTime).toBe('14:00');
  });

  it('QS-19: approval-queue list spreads multiple exception + addition children', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'Series with many children',
      requesterEmail: requesterUser.email,
    });
    const children = [
      createExceptionDocument(master, '2026-03-17', { startTime: '14:00' }),
      createExceptionDocument(master, '2026-03-24', { startTime: '15:00' }),
      createAdditionDocument(master, '2026-04-07', { startTime: '16:00' }),
    ];
    await insertEvents(db, [master, ...children]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    const row = res.body.events[0];
    expect(row.occurrenceOverrides).toHaveLength(3);
    const dates = row.occurrenceOverrides.map(o => o.occurrenceDate).sort();
    expect(dates).toEqual(['2026-03-17', '2026-03-24', '2026-04-07']);
  });

  it('QS-20: fallback — exception doc with empty overrides still produces a non-empty entry from top-level fields', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'Legacy-shaped exception',
      requesterEmail: requesterUser.email,
    });
    await insertEvents(db, [master]);

    // Insert a legacy-shaped exception doc: overrides empty, top-level fields present.
    // Mirrors EDS-32 (unit test) but verified through the HTTP layer.
    await db.collection(COLLECTIONS.EVENTS).insertOne({
      eventId: `${master.eventId}-legacy-2026-03-17`,
      eventType: 'exception',
      seriesMasterEventId: master.eventId,
      occurrenceDate: '2026-03-17',
      overrides: {},
      startTime: '14:00',
      endTime: '15:00',
      locationDisplayNames: 'Chapel',
      calendarOwner: master.calendarOwner,
      status: STATUS.PENDING,
      isDeleted: false,
    });

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=pending`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    const row = res.body.events[0];
    expect(row.occurrenceOverrides).toHaveLength(1);
    expect(row.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-17');
    expect(row.occurrenceOverrides[0].startTime).toBe('14:00');
    expect(row.occurrenceOverrides[0].endTime).toBe('15:00');
    expect(row.occurrenceOverrides[0].locationDisplayNames).toBe('Chapel');
  });

  it('QS-16: my-events list returns top-level recurrence on pending series master', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'My Weekly Study',
      requesterEmail: requesterUser.email,
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      },
    });
    await insertEvents(db, [master]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=pending`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    const row = res.body.events[0];
    expect(row.recurrence).toBeTruthy();
    expect(row.recurrence.pattern?.type).toBe('weekly');
    expect(row.recurrence.pattern?.daysOfWeek).toEqual(['tuesday']);
    expect(row.recurrence.range?.endDate).toBe('2026-06-30');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Draft master + draft exception child scoping (regression test).
  // Reproduces the scenario reported on 2026-04-24: an admin saves a recurring
  // series as draft, then edits one occurrence — system creates an exception
  // document with status=draft. MyReservations.jsx calls
  // `GET /events/list?view=my-events&limit=1000&includeDeleted=true` with NO
  // status param, so the previous QS-7/QS-8 coverage (which scoped to
  // status=pending / status=published) didn't catch a draft-leak regression.
  // ──────────────────────────────────────────────────────────────────────────

  it('QS-21: my-events list (no status param, includeDeleted=true) excludes draft exception children', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.DRAFT,
      eventTitle: 'Draft daily series',
      requesterEmail: requesterUser.email,
      recurrence: {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-26', endDate: '2026-04-28' },
        additions: [],
        exclusions: [],
      },
    });
    const exceptionChild = createExceptionDocument(master, '2026-04-27', {
      startTime: '10:00',
      endTime: '12:00',
    });
    // Sanity: the test fixtures must reproduce the user's wire-shape exactly.
    expect(master.eventType).toBe('seriesMaster');
    expect(master.status).toBe(STATUS.DRAFT);
    expect(exceptionChild.eventType).toBe('exception');
    expect(exceptionChild.status).toBe(STATUS.DRAFT);
    expect(exceptionChild.seriesMasterEventId).toBe(master.eventId);

    await insertEvents(db, [master, exceptionChild]);

    // This URL is byte-identical to MyReservations.jsx:61.
    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&limit=1000&includeDeleted=true`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventId).toBe(master.eventId);
    expect(res.body.events[0].eventType).toBe('seriesMaster');
    // The master should carry the exception's overrides (so the modal shows it).
    expect(res.body.events[0].occurrenceOverrides).toHaveLength(1);
    expect(res.body.events[0].occurrenceOverrides[0].occurrenceDate).toBe('2026-04-27');
  });

  it('QS-22: my-events counts include draft master, exclude draft exception children', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.DRAFT,
      eventTitle: 'Draft daily series',
      requesterEmail: requesterUser.email,
      recurrence: {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-26', endDate: '2026-04-28' },
        additions: [],
        exclusions: [],
      },
    });
    const exceptionChild = createExceptionDocument(master, '2026-04-27', {
      startTime: '10:00',
      endTime: '12:00',
    });
    await insertEvents(db, [master, exceptionChild]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=my-events`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.draft).toBe(1);
    expect(res.body.all).toBe(1);
  });

  it('QS-23: my-events list with status=draft excludes draft exception children', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.DRAFT,
      eventTitle: 'Draft daily series',
      requesterEmail: requesterUser.email,
      recurrence: {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-26', endDate: '2026-04-28' },
        additions: [],
        exclusions: [],
      },
    });
    const exceptionChild = createExceptionDocument(master, '2026-04-27', {
      startTime: '10:00',
      endTime: '12:00',
    });
    await insertEvents(db, [master, exceptionChild]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=draft`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventId).toBe(master.eventId);
  });

  it('QS-24: approval-queue (no status) excludes draft exception children even when master is draft (drafts not in queue)', async () => {
    const master = createRecurringSeriesMaster({
      status: STATUS.DRAFT,
      eventTitle: 'Draft daily series',
      requesterEmail: requesterUser.email,
    });
    const exceptionChild = createExceptionDocument(master, '2026-04-27', {
      startTime: '10:00',
      endTime: '12:00',
    });
    await insertEvents(db, [master, exceptionChild]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    // Drafts are not pending/published/rejected, so neither the master nor
    // the child should appear in the approval queue.
    expect(res.body.events).toHaveLength(0);
  });

  it('QS-14: rejecting the master still returns 200 and cascades rejection to children', async () => {
    const { master, children } = buildPendingSeriesWithChildren({
      requesterEmail: requesterUser.email,
      exceptionDates: ['2026-03-17', '2026-03-24'],
    });
    await insertEvents(db, [master, ...children]);

    await request(app)
      .put(`/api/admin/events/${master._id}/reject`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ reason: 'scheduling conflict' })
      .expect(200);

    const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
    expect(masterAfter.status).toBe(STATUS.REJECTED);

    const childrenAfter = await db.collection(COLLECTIONS.EVENTS)
      .find({ seriesMasterEventId: master.eventId, eventType: { $in: ['exception', 'addition'] } })
      .toArray();
    expect(childrenAfter).toHaveLength(2);
    childrenAfter.forEach(c => expect(c.status).toBe(STATUS.REJECTED));
  });
});
