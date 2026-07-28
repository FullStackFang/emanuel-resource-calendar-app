/**
 * Integration tests for the Sync Health reconcile endpoints.
 *
 * Drives the REAL api-server.js routes via createAppForTest, with the shared
 * graphApiMock installed by injection. Simulated Graph failures are built with
 * the same buildGraphError the production service throws with, so a predicate
 * that only understands the mock's shape cannot pass here.
 *
 * The recurring assertion in this file is NEGATIVE: when a guard fires, count
 * the Graph WRITE calls and expect zero. A reconcile bug that writes first and
 * checks second would still return the right status code.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const {
  createPublishedEvent,
  createPublishedEventWithGraph,
  createRecurringSeriesMaster,
  createDeletedEvent,
  insertEvent,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

const PLAN = '/api/admin/sync-health/reconcile/plan';
const APPLY = '/api/admin/sync-health/reconcile/apply';
const AUDIT = 'templeEvents__EventAuditHistory';

const at = (iso) => new Date(iso);

const outlookEvent = (id, date, extra = {}) => ({
  id,
  subject: extra.subject || `Outlook ${id}`,
  start: { dateTime: `${date}T17:00:00.0000000`, timeZone: 'UTC' },
  end: { dateTime: `${date}T18:00:00.0000000`, timeZone: 'UTC' },
  type: 'singleInstance',
  ...extra,
});

// Every call that CHANGES Outlook. Guards must leave this at zero.
const graphWriteCount = () =>
  graphApiMock.getCallHistory('createCalendarEvent').length +
  graphApiMock.getCallHistory('updateCalendarEvent').length +
  graphApiMock.getCallHistory('deleteCalendarEvent').length;

describe('Sync Health reconcile', () => {
  let mongoClient;
  let db;
  let app;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('syncReconcile'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(AUDIT).deleteMany({});
    graphApiMock.resetMocks();

    const admin = createAdmin();
    await insertUsers(db, [admin]);
    adminToken = await createMockToken(admin);
  });

  const post = (url, body, token = adminToken) =>
    request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);

  // ── fixtures ────────────────────────────────────────────────────────────

  /** A deleted app record whose Outlook event survived. */
  const seedZombie = async ({ graphId = 'zombie-1', date = '2026-08-14', attendees = [] } = {}) => {
    const doc = await insertEvent(db, createDeletedEvent({
      eventTitle: 'Cancelled Concert', previousStatus: 'published',
      startDateTime: at(`${date}T13:00:00`), endDateTime: at(`${date}T14:00:00`),
      graphData: { id: graphId },
    }));
    graphApiMock.setMockResponse('getEvent', {
      [graphId]: outlookEvent(graphId, date, { subject: 'Cancelled Concert', attendees }),
    });
    return doc;
  };

  /** A published record that was never linked to Outlook. */
  // eslint-disable-next-line no-unused-vars
  const seedUntethered = async ({ date = '2026-08-14', title = 'WISE HALL CLOSED' } = {}) =>
    insertEvent(db, createPublishedEvent({
      eventTitle: title,
      startDateTime: at(`${date}T13:00:00`), endDateTime: at(`${date}T14:00:00`),
      graphData: {},
      // No times → buildGraphSubject prefixes with [Hold], which is the whole
      // legacy population this feature exists for.
      startTime: '', endTime: '',
    }));

  const deleteTarget = (doc, graphId = 'zombie-1', date = '2026-08-14') => ({
    calendarOwner: TEST_CALENDAR_OWNER,
    findingType: 'shouldNotBeInOutlook',
    action: 'deleteOutlook',
    target: { graphId, date },
  });

  const untetheredTarget = (doc, action) => ({
    calendarOwner: TEST_CALENDAR_OWNER,
    findingType: 'untethered',
    action,
    target: { mongoId: String(doc._id) },
  });

  // ── permissions ─────────────────────────────────────────────────────────

  it('rejects an approver on both routes', async () => {
    const approver = createApprover();
    await insertUsers(db, [approver]);
    const token = await createMockToken(approver);
    const doc = await seedUntethered();

    for (const url of [PLAN, APPLY]) {
      const res = await post(url, untetheredTarget(doc, 'archive'), token);
      expect(res.status).toBe(403);
    }
    expect(graphApiMock.getCallHistory('getEvent')).toHaveLength(0);
    expect(graphWriteCount()).toBe(0);
  });

  it('400s on a request with no usable target', async () => {
    const res = await post(PLAN, {
      calendarOwner: TEST_CALENDAR_OWNER, findingType: 'untethered', action: 'archive', target: {},
    });
    expect(res.status).toBe(400);
  });

  // ── context mode (no action chosen yet) ─────────────────────────────────
  //
  // The panel used to offer archive / link / publish knowing only a title,
  // which is not enough to tell a years-old '[Hold]' placeholder from a real
  // booking. These lock in the evidence an admin needs to choose.

  it('describes the event and the day when no action is given', async () => {
    const doc = await seedUntethered();
    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('other-1', '2026-08-14', { subject: 'Someone Else Meeting' }),
    ]);

    const res = await post(PLAN, {
      calendarOwner: TEST_CALENDAR_OWNER,
      findingType: 'untethered',
      target: { mongoId: String(doc._id) },
      // no action
    });

    expect(res.status).toBe(200);
    expect(res.body.context).toBe(true);
    expect(res.body.availableActions).toEqual(['linkExisting', 'archive', 'publish']);

    // What the event IS.
    expect(res.body.observed.doc).toMatchObject({
      eventTitle: 'WISE HALL CLOSED',
      date: '2026-08-14',
      status: 'published',
      eventType: 'singleInstance',
    });
    expect(res.body.observed.doc.requestedByEmail).toBeTruthy();
    expect(res.body.observed.doc.createdAt).toBeTruthy();

    // ...and the admin's own evidence that it is genuinely absent from Outlook.
    expect(res.body.observed.dayEvents).toEqual([
      expect.objectContaining({ graphId: 'other-1', subject: 'Someone Else Meeting' }),
    ]);
    expect(res.body.observed.dayEventsTotal).toBe(1);

    // Context is read-only.
    expect(graphWriteCount()).toBe(0);
    expect(res.body.expectedState).toBeUndefined();
  });

  // THE BUG THIS LOCKS: the day window was asked for as a UTC day
  // (00:00Z..23:59Z), which in Eastern runs 19:00 the previous evening to 18:59.
  // An evening booking on the target date lands at 01:00Z the NEXT day and fell
  // outside it — so its Outlook twin was invisible, no link candidate was
  // offered, and the admin would have been steered to "publish", duplicating an
  // event Outlook already had.
  it('finds an evening event that a UTC-day window would have missed', async () => {
    const doc = await seedUntethered({ date: '2027-01-23', title: 'B/M Charlotte Duber' });
    graphApiMock.setMockResponse('getCalendarEvents', [
      // 20:00 EST on the 23rd == 01:00Z on the 24th.
      outlookEvent('evening-1', '2027-01-24', {
        subject: 'B/M Charlotte Duber',
        start: { dateTime: '2027-01-24T01:00:00.0000000', timeZone: 'UTC' },
      }),
      // 21:00 EST on the 22nd == 02:00Z on the 23rd — a DIFFERENT local day,
      // which the old UTC window wrongly included.
      outlookEvent('previous-evening', '2027-01-23', {
        subject: 'Someone Else',
        start: { dateTime: '2027-01-23T02:00:00.0000000', timeZone: 'UTC' },
      }),
    ]);

    const res = await post(PLAN, {
      calendarOwner: TEST_CALENDAR_OWNER,
      findingType: 'untethered',
      target: { mongoId: String(doc._id) },
    });

    expect(res.status).toBe(200);
    const shown = res.body.observed.dayEvents;
    expect(shown.map(e => e.graphId)).toEqual(['evening-1']);
    // ...rendered in local wall clock, not the 01:00 Graph reported.
    expect(shown[0].startTime).toBe('20:00');
    // ...and it is offered as a link candidate rather than being missed.
    expect(res.body.observed.candidates.map(c => c.graphId)).toEqual(['evening-1']);

    // The filter above only works if the FETCH was wide enough to contain the
    // event in the first place. The mock ignores the requested window, so
    // assert it directly — this is the half of the bug that bit in production.
    const [call] = graphApiMock.getCallHistory('getCalendarEvents');
    expect(call.startDateTime).toBe('2027-01-22T00:00:00Z');
    expect(call.endDateTime).toBe('2027-01-25T00:00:00Z');
  });

  it('reports an empty Outlook day rather than omitting it', async () => {
    const doc = await seedUntethered();
    graphApiMock.setMockResponse('getCalendarEvents', []);

    const res = await post(PLAN, {
      calendarOwner: TEST_CALENDAR_OWNER,
      findingType: 'untethered',
      target: { mongoId: String(doc._id) },
    });

    expect(res.status).toBe(200);
    expect(res.body.observed.dayEvents).toEqual([]);
    expect(res.body.observed.dayEventsTotal).toBe(0);
  });

  // Context mode is a /plan affordance only. An apply with no action must not
  // fall through to some default.
  it('still requires an action on apply', async () => {
    const doc = await seedUntethered();
    const res = await post(APPLY, {
      calendarOwner: TEST_CALENDAR_OWNER,
      findingType: 'untethered',
      target: { mongoId: String(doc._id) },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action is required/i);
  });

  // ── plan ────────────────────────────────────────────────────────────────

  it('plans an irreversible delete with a fingerprint and an expiry', async () => {
    await seedZombie();

    const res = await post(PLAN, deleteTarget());

    expect(res.status).toBe(200);
    expect(res.body.irreversible).toBe(true);
    expect(res.body.ops).toHaveLength(1);
    expect(res.body.ops[0]).toMatchObject({ op: 'graphDelete', graphId: 'zombie-1' });
    expect(res.body.expectedState.outlook).toMatchObject({ found: true, graphId: 'zombie-1' });
    // The app-side reason is re-derived, not taken from the report.
    expect(res.body.expectedState.justification).toMatchObject({ kind: 'deletedDoc', isDeleted: true });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(graphWriteCount()).toBe(0);
  });

  it('warns at plan time that deleting will notify attendees', async () => {
    await seedZombie({ attendees: [{ emailAddress: { address: 'a@b.org' } }] });

    const res = await post(PLAN, deleteTarget());

    expect(res.status).toBe(200);
    expect(res.body.warnings.join(' ')).toMatch(/attendee/i);
  });

  it('refuses to plan a delete once the record has been restored', async () => {
    const doc = await seedZombie();
    await db.collection(COLLECTIONS.EVENTS).updateOne(
      { _id: doc._id }, { $set: { isDeleted: false, status: 'published' } }
    );

    const res = await post(PLAN, deleteTarget());

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_JUSTIFICATION');
  });

  it('refuses to publish an untethered series master', async () => {
    const master = await insertEvent(db, createRecurringSeriesMaster({
      eventTitle: 'Weekly Thing', status: 'published', graphData: {},
      startDateTime: at('2026-08-03T13:00:00'), endDateTime: at('2026-08-03T14:00:00'),
    }));
    graphApiMock.setMockResponse('getCalendarEvents', []);

    const res = await post(PLAN, untetheredTarget(master, 'publish'));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SERIES_NOT_SUPPORTED');
    expect(graphWriteCount()).toBe(0);
  });

  // ── apply: guards ───────────────────────────────────────────────────────

  it('refuses a delete without confirmIrreversible, before touching Graph', async () => {
    await seedZombie();
    const planRes = await post(PLAN, deleteTarget());
    graphApiMock.clearCallHistory();

    const res = await post(APPLY, { ...deleteTarget(), expectedState: planRes.body.expectedState });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CONFIRMATION_REQUIRED');
    // Not even a read — the guard is decidable from the action alone.
    expect(graphApiMock.getCallHistory('getEvent')).toHaveLength(0);
    expect(graphWriteCount()).toBe(0);
  });

  describe('stale-abort', () => {
    it('aborts a delete when the app record was restored after planning', async () => {
      const doc = await seedZombie();
      const planRes = await post(PLAN, deleteTarget());

      await db.collection(COLLECTIONS.EVENTS).updateOne(
        { _id: doc._id }, { $set: { isDeleted: false, status: 'published' } }
      );
      graphApiMock.clearCallHistory();

      const res = await post(APPLY, {
        ...deleteTarget(), expectedState: planRes.body.expectedState, confirmIrreversible: true,
      });

      // Re-planning catches this before the fingerprint comparison even runs.
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NO_JUSTIFICATION');
      expect(graphWriteCount()).toBe(0);
    });

    it('aborts a delete when the Outlook entry became a series master', async () => {
      await seedZombie();
      const planRes = await post(PLAN, deleteTarget());

      graphApiMock.setMockResponse('getEvent', {
        'zombie-1': outlookEvent('zombie-1', '2026-08-14', {
          subject: 'Cancelled Concert', type: 'seriesMaster',
        }),
      });
      graphApiMock.clearCallHistory();

      const res = await post(APPLY, {
        ...deleteTarget(), expectedState: planRes.body.expectedState, confirmIrreversible: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SERIES_MASTER_TARGET');
      expect(graphWriteCount()).toBe(0);
    });

    it('aborts an archive when the record was edited after planning', async () => {
      const doc = await seedUntethered();
      const planRes = await post(PLAN, untetheredTarget(doc, 'archive'));

      await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: doc._id }, { $inc: { _version: 1 } });

      const res = await post(APPLY, {
        ...untetheredTarget(doc, 'archive'), expectedState: planRes.body.expectedState,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('STALE_FINDING');
      expect(res.body.drifts.map(d => d.field)).toContain('doc.version');
      // Nothing was archived.
      expect((await findEvent(db, doc._id)).isDeleted).toBe(false);
    });

    it('aborts a publish when someone else linked the record meanwhile', async () => {
      const doc = await seedUntethered();
      graphApiMock.setMockResponse('getCalendarEvents', []);
      const planRes = await post(PLAN, untetheredTarget(doc, 'publish'));

      await db.collection(COLLECTIONS.EVENTS).updateOne(
        { _id: doc._id }, { $set: { graphData: { id: 'SOMEONE-ELSE-LINKED-IT' } } }
      );
      graphApiMock.clearCallHistory();

      const res = await post(APPLY, {
        ...untetheredTarget(doc, 'publish'), expectedState: planRes.body.expectedState,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('ALREADY_RESOLVED');
      expect(graphWriteCount()).toBe(0);
    });

    it('aborts when the plan has expired', async () => {
      const doc = await seedUntethered();
      const planRes = await post(PLAN, untetheredTarget(doc, 'archive'));

      const expired = {
        ...planRes.body.expectedState,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      const res = await post(APPLY, { ...untetheredTarget(doc, 'archive'), expectedState: expired });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('STALE_FINDING');
      expect(res.body.drifts.map(d => d.field)).toContain('expiresAt');
    });
  });

  // ── apply: the delete path ──────────────────────────────────────────────

  it('deletes the surviving Outlook entry and audits the pre-delete snapshot', async () => {
    await seedZombie();
    const planRes = await post(PLAN, deleteTarget());

    const res = await post(APPLY, {
      ...deleteTarget(), expectedState: planRes.body.expectedState, confirmIrreversible: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([expect.objectContaining({ op: 'graphDelete', status: 'done' })]);
    graphApiMock.assertCalled('deleteCalendarEvent', { eventId: 'zombie-1' });

    const audit = await db.collection(AUDIT).findOne({ source: 'SyncHealthReconcile' });
    expect(audit).toBeTruthy();
    expect(audit.metadata.action).toBe('deleteOutlook');
    expect(audit.metadata.graphIdsDeleted).toEqual(['zombie-1']);
    expect(audit.metadata.actorEmail).toBeTruthy();
    // The only record that the Outlook event ever existed.
    expect(audit.metadata.preDeleteSnapshot).toMatchObject({ id: 'zombie-1' });
  });

  it('reports an already-deleted Outlook entry as alreadyGone rather than failing', async () => {
    await seedZombie();
    const planRes = await post(PLAN, deleteTarget());

    // Graph 404 on the delete — production-shaped, carrying `status`.
    graphApiMock.setMockError('deleteCalendarEvent', graphApiMock.graphError(404, 'Not Found'));

    const res = await post(APPLY, {
      ...deleteTarget(), expectedState: planRes.body.expectedState, confirmIrreversible: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe('alreadyGone');
  });

  // ── apply: untethered actions ───────────────────────────────────────────

  it('archives in the app, pushing statusHistory and writing nothing to Outlook', async () => {
    const doc = await seedUntethered();
    const planRes = await post(PLAN, untetheredTarget(doc, 'archive'));
    expect(planRes.body.irreversible).toBe(false);

    const res = await post(APPLY, {
      ...untetheredTarget(doc, 'archive'), expectedState: planRes.body.expectedState,
    });

    expect(res.status).toBe(200);
    const after = await findEvent(db, doc._id);
    expect(after.isDeleted).toBe(true);
    expect(after.status).toBe('deleted');
    const last = after.statusHistory[after.statusHistory.length - 1];
    expect(last.reason).toBe('Archived via sync-health reconcile');
    expect(graphWriteCount()).toBe(0);
  });

  it('links to a probed candidate, writing Mongo only', async () => {
    const doc = await seedUntethered();
    // Outlook has a same-name entry on the same day that nothing in the app claims.
    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('legacy-1', '2026-08-14', { subject: '[Hold] WISE HALL CLOSED' }),
    ]);

    const planRes = await post(PLAN, {
      ...untetheredTarget(doc, 'linkExisting'), linkTargetGraphId: 'legacy-1',
    });
    expect(planRes.status).toBe(200);
    expect(planRes.body.ops).toEqual([expect.objectContaining({ op: 'mongoLink', graphId: 'legacy-1' })]);

    const res = await post(APPLY, {
      ...untetheredTarget(doc, 'linkExisting'),
      linkTargetGraphId: 'legacy-1',
      expectedState: planRes.body.expectedState,
    });

    expect(res.status).toBe(200);
    expect((await findEvent(db, doc._id)).graphData.id).toBe('legacy-1');
    expect(graphWriteCount()).toBe(0);
  });

  it('refuses to publish over a duplicate candidate without an explicit override', async () => {
    const doc = await seedUntethered();
    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('legacy-1', '2026-08-14', { subject: '[Hold] WISE HALL CLOSED' }),
    ]);

    const planRes = await post(PLAN, untetheredTarget(doc, 'publish'));
    expect(planRes.status).toBe(200);
    // The recommendation flips to the safer action, with the candidate listed.
    expect(planRes.body.recommendation).toBe('linkExisting');
    expect(planRes.body.candidates).toEqual([expect.objectContaining({ graphId: 'legacy-1' })]);

    const res = await post(APPLY, {
      ...untetheredTarget(doc, 'publish'), expectedState: planRes.body.expectedState,
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('DUPLICATE_CANDIDATE');
    expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(0);
  });

  it('publishes when Outlook has nothing that looks like it', async () => {
    const doc = await seedUntethered();
    graphApiMock.setMockResponse('getCalendarEvents', []);

    const planRes = await post(PLAN, untetheredTarget(doc, 'publish'));
    const res = await post(APPLY, {
      ...untetheredTarget(doc, 'publish'), expectedState: planRes.body.expectedState,
    });

    expect(res.status).toBe(200);
    expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(1);

    const after = await findEvent(db, doc._id);
    expect(after.graphData.id).toBeTruthy();
    // Recorded so recover-untethered-publishes.js --clean-orphans stays effective.
    expect(after.roomReservationData.createdGraphEventIds).toContain(after.graphData.id);
  });

  // The publish endpoint's own failure mode, reproduced here: the Graph event
  // is created, then the OCC-guarded link fails. Reconcile can compensate,
  // because it created the event moments ago and nothing else points at it.
  it('compensating-deletes the created Outlook event when the link write loses OCC', async () => {
    const doc = await seedUntethered();
    graphApiMock.setMockResponse('getCalendarEvents', []);
    const planRes = await post(PLAN, untetheredTarget(doc, 'publish'));

    // Bump _version the instant the Graph create happens, so the link write
    // that follows cannot match.
    const events = db.collection(COLLECTIONS.EVENTS);
    graphApiMock.setMockResponse('createCalendarEvent', null);
    const realCreate = graphApiMock.createCalendarEvent;
    let bumped = false;
    const spy = jest.spyOn(graphApiMock, 'createCalendarEvent')
      .mockImplementation(async (...args) => {
        const created = await realCreate(...args);
        if (!bumped) {
          bumped = true;
          await events.updateOne({ _id: doc._id }, { $inc: { _version: 1 } });
        }
        return created;
      });

    let res;
    try {
      res = await post(APPLY, {
        ...untetheredTarget(doc, 'publish'), expectedState: planRes.body.expectedState,
      });
    } finally {
      spy.mockRestore();
    }

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VERSION_CONFLICT');
    expect(res.body.orphanCompensated).toBe(true);
    // The orphan was cleaned up, and the record stayed unlinked.
    graphApiMock.assertCalled('deleteCalendarEvent', { eventId: res.body.orphanedGraphId });
    expect((await findEvent(db, doc._id)).graphData?.id).toBeFalsy();
  });

  // ── batch link ──────────────────────────────────────────────────────────
  //
  // Bulk is offered for LINK only: Mongo-only, creates nothing, reversible by
  // unsetting the id. Bulk publish would mint duplicates and bulk delete cannot
  // be undone.

  const BATCH_PLAN = '/api/admin/sync-health/reconcile/batch/plan';
  const BATCH_APPLY = '/api/admin/sync-health/reconcile/batch/apply';

  it('classifies a batch and pre-selects only the confident rows', async () => {
    const exact = await seedUntethered({ date: '2026-08-14', title: 'Exact Match' });
    const wrongTime = await seedUntethered({ date: '2026-08-14', title: 'Different Time' });
    const noMatch = await seedUntethered({ date: '2026-08-14', title: 'Nothing Like It' });
    // seedUntethered writes a 13:00 start, so 13:00 agrees and 19:00 does not.
    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('m-exact', '2026-08-14', {
        subject: 'Exact Match',
        start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' }, // 13:00 EDT
      }),
      outlookEvent('m-late', '2026-08-14', {
        subject: 'Different Time',
        start: { dateTime: '2026-08-14T23:00:00.0000000', timeZone: 'UTC' }, // 19:00 EDT
      }),
    ]);

    const res = await post(BATCH_PLAN, {
      calendarOwner: TEST_CALENDAR_OWNER,
      mongoIds: [exact, wrongTime, noMatch].map(d => String(d._id)),
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 3, confident: 1, ambiguous: 1, none: 1 });

    const byId = Object.fromEntries(res.body.rows.map(r => [r.mongoId, r]));
    expect(byId[String(exact._id)]).toMatchObject({ tier: 'confident', selectedByDefault: true });
    expect(byId[String(exact._id)].candidate.graphId).toBe('m-exact');
    // Time disagreement is surfaced, not silently accepted.
    expect(byId[String(wrongTime._id)]).toMatchObject({ tier: 'ambiguous', selectedByDefault: false });
    expect(byId[String(wrongTime._id)].reason).toMatch(/times differ/i);
    expect(byId[String(noMatch._id)]).toMatchObject({ tier: 'none', selectedByDefault: false });

    // One Graph probe for the shared date, not one per document.
    expect(graphApiMock.getCallHistory('getCalendarEvents')).toHaveLength(1);
    expect(graphWriteCount()).toBe(0);
  });

  it('links every selected row and writes nothing to Outlook', async () => {
    const a = await seedUntethered({ date: '2026-08-14', title: 'Alpha' });
    const b = await seedUntethered({ date: '2026-08-14', title: 'Beta' });
    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('g-a', '2026-08-14', {
        subject: 'Alpha', start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' },
      }),
      outlookEvent('g-b', '2026-08-14', {
        subject: 'Beta', start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' },
      }),
    ]);

    const planRes = await post(BATCH_PLAN, {
      calendarOwner: TEST_CALENDAR_OWNER,
      mongoIds: [a, b].map(d => String(d._id)),
    });
    expect(planRes.body.summary.confident).toBe(2);

    const res = await post(BATCH_APPLY, {
      calendarOwner: TEST_CALENDAR_OWNER,
      selections: planRes.body.rows.map(r => ({
        mongoId: r.mongoId, graphId: r.candidate.graphId, expectedState: r.expectedState,
      })),
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 2, done: 2, skipped: 0, failed: 0 });
    expect((await findEvent(db, a._id)).graphData.id).toBe('g-a');
    expect((await findEvent(db, b._id)).graphData.id).toBe('g-b');
    expect(graphWriteCount()).toBe(0);

    // Batch is a loop over the safe path, so every row is audited individually.
    const audits = await db.collection(AUDIT).find({ source: 'SyncHealthReconcile' }).toArray();
    expect(audits).toHaveLength(2);
  });

  // One stale record must not stop the other rows.
  it('skips a row that moved since planning and completes the rest', async () => {
    const stale = await seedUntethered({ date: '2026-08-14', title: 'Stale One' });
    const fine = await seedUntethered({ date: '2026-08-14', title: 'Fine One' });
    graphApiMock.setMockResponse('getCalendarEvents', [
      outlookEvent('g-stale', '2026-08-14', {
        subject: 'Stale One', start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' },
      }),
      outlookEvent('g-fine', '2026-08-14', {
        subject: 'Fine One', start: { dateTime: '2026-08-14T17:00:00.0000000', timeZone: 'UTC' },
      }),
    ]);

    const planRes = await post(BATCH_PLAN, {
      calendarOwner: TEST_CALENDAR_OWNER,
      mongoIds: [stale, fine].map(d => String(d._id)),
    });

    // Someone edits one of them after the table was rendered.
    await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: stale._id }, { $inc: { _version: 1 } });

    const res = await post(BATCH_APPLY, {
      calendarOwner: TEST_CALENDAR_OWNER,
      selections: planRes.body.rows.map(r => ({
        mongoId: r.mongoId, graphId: r.candidate.graphId, expectedState: r.expectedState,
      })),
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 2, done: 1, skipped: 1 });
    const skipped = res.body.results.find(r => r.status === 'skipped');
    expect(skipped.code).toBe('STALE_FINDING');
    expect((await findEvent(db, stale._id)).graphData?.id).toBeFalsy();
    expect((await findEvent(db, fine._id)).graphData.id).toBe('g-fine');
  });

  it('rejects a batch apply that omits a fingerprint', async () => {
    const doc = await seedUntethered();
    const res = await post(BATCH_APPLY, {
      calendarOwner: TEST_CALENDAR_OWNER,
      selections: [{ mongoId: String(doc._id), graphId: 'whatever' }],
    });
    expect(res.status).toBe(400);
    expect(graphWriteCount()).toBe(0);
  });

  it('rejects an approver on both batch routes', async () => {
    const approver = createApprover();
    await insertUsers(db, [approver]);
    const token = await createMockToken(approver);
    const doc = await seedUntethered();

    for (const [url, body] of [
      [BATCH_PLAN, { calendarOwner: TEST_CALENDAR_OWNER, mongoIds: [String(doc._id)] }],
      [BATCH_APPLY, { calendarOwner: TEST_CALENDAR_OWNER, selections: [{ mongoId: 'x', graphId: 'y', expectedState: {} }] }],
    ]) {
      const res = await post(url, body, token);
      expect(res.status).toBe(403);
    }
  });

  // ── audit ───────────────────────────────────────────────────────────────

  it('writes exactly one audit entry per apply', async () => {
    const doc = await seedUntethered();
    const planRes = await post(PLAN, untetheredTarget(doc, 'archive'));
    await post(APPLY, {
      ...untetheredTarget(doc, 'archive'), expectedState: planRes.body.expectedState,
    });

    const entries = await db.collection(AUDIT).find({ source: 'SyncHealthReconcile' }).toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      eventId: String(doc._id),
      changeType: 'update',
      source: 'SyncHealthReconcile',
    });
    expect(entries[0].metadata).toMatchObject({
      findingType: 'untethered', action: 'archive', calendarOwner: TEST_CALENDAR_OWNER,
    });
  });
});
