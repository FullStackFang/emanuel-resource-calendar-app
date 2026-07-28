/**
 * Integration tests for POST /api/admin/events/:id/republish.
 *
 * Written when the endpoint's create-then-link body was extracted into
 * services/republishCore.js so the sync-health reconcile publish action could
 * share it. The endpoint had no coverage before that, which made a
 * "behavior-preserving" extraction unverifiable — these pin the behavior that
 * must not change: the admin gate, the EXISTING_GRAPH_LINK acknowledgement, the
 * write order, and the orphan report on OCC loss.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const {
  createPublishedEvent,
  createPublishedEventWithGraph,
  createDraftEvent,
  insertEvent,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

const url = (id) => `/api/admin/events/${id}/republish`;
const at = (iso) => new Date(iso);

describe('POST /api/admin/events/:id/republish', () => {
  let mongoClient;
  let db;
  let app;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('eventRepublish'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    graphApiMock.resetMocks();

    const admin = createAdmin();
    await insertUsers(db, [admin]);
    adminToken = await createMockToken(admin);
  });

  const seedUnlinked = () => insertEvent(db, createPublishedEvent({
    eventTitle: 'Board Meeting',
    startDateTime: at('2026-08-14T13:00:00'),
    endDateTime: at('2026-08-14T14:00:00'),
    graphData: {},
  }));

  const republish = (id, body = {}, token = adminToken) =>
    request(app).post(url(id)).set('Authorization', `Bearer ${token}`).send(body);

  it('rejects a non-admin', async () => {
    const approver = createApprover();
    await insertUsers(db, [approver]);
    const doc = await seedUnlinked();

    const res = await republish(doc._id, {}, await createMockToken(approver));

    expect(res.status).toBe(403);
    expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(0);
  });

  it('refuses an event that is not published', async () => {
    const doc = await insertEvent(db, createDraftEvent({ eventTitle: 'Not Yet' }));

    const res = await republish(doc._id);

    expect(res.status).toBe(400);
    expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(0);
  });

  it('creates the Graph event and persists the link', async () => {
    const doc = await seedUnlinked();

    const res = await republish(doc._id, { _version: doc._version });

    expect(res.status).toBe(200);
    expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(1);

    const after = await findEvent(db, doc._id);
    expect(after.graphData.id).toBe(res.body.graphData.id);
    expect(after._version).toBe(doc._version + 1);
    // Recorded so recover-untethered-publishes.js --clean-orphans can find it.
    expect(after.roomReservationData.createdGraphEventIds).toContain(after.graphData.id);
    expect(after.statusHistory[after.statusHistory.length - 1].reason).toMatch(/Republished to Outlook/);
  });

  // Republishing orphans whatever the record currently points at, so the
  // operator has to say so explicitly.
  it('requires force when the record is already linked', async () => {
    const doc = await insertEvent(db, createPublishedEventWithGraph({
      eventTitle: 'Already Linked',
      startDateTime: at('2026-08-14T13:00:00'),
      endDateTime: at('2026-08-14T14:00:00'),
      graphId: 'AAMkEXISTING',
    }));

    const blocked = await republish(doc._id, { _version: doc._version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('EXISTING_GRAPH_LINK');
    expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(0);

    const forced = await republish(doc._id, { _version: doc._version, force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.previousGraphId).toBe('AAMkEXISTING');
    expect((await findEvent(db, doc._id)).graphData.id).not.toBe('AAMkEXISTING');
  });

  // The endpoint's defining failure mode: the Graph event WAS created, the link
  // was not written, and the operator must be told the orphan's id. Unlike
  // reconcile, this endpoint does not compensate.
  it('reports the orphaned Graph id when _version moved under it', async () => {
    const doc = await seedUnlinked();

    const res = await republish(doc._id, { _version: doc._version + 99 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VERSION_CONFLICT');
    expect(res.body.orphanedGraphId).toBeTruthy();
    expect(graphApiMock.getCallHistory('createCalendarEvent')).toHaveLength(1);
    // Nothing was linked.
    expect((await findEvent(db, doc._id)).graphData?.id).toBeFalsy();
  });
});
