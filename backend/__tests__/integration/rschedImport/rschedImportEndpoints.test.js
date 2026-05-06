/**
 * Resource Scheduler Import Endpoint Tests (RI-14, RI-15, plus end-to-end happy path).
 *
 * RI-14: discard session removes all staging rows for that session.
 * RI-15: non-admin users get 403 on every endpoint.
 * RI-E2E: full upload → validate → commit happy path through HTTP.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const {
  connectToGlobalServer,
  disconnectFromGlobalServer,
  clearCollections,
} = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const {
  COLLECTIONS,
  TEST_CALENDAR_OWNER,
  TEST_CALENDAR_ID,
} = require('../../__helpers__/testConstants');

const FIXTURE_PATH = path.join(__dirname, '..', '..', '__fixtures__', 'rsched-sample.csv');

describe('rsched import endpoints (RI-14, RI-15, RI-E2E)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken, requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('rschedImportEndpoints'));
    app = await setupTestApp(db);
    adminUser = createAdmin();
    requesterUser = createRequester();
    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await clearCollections(db);
    await insertUsers(db, [adminUser, requesterUser]);

    // Seed a few real locations matching the fixture rsKeys.
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([
      { rsKey: '602', name: '6th Floor Lounge - 602', active: true },
      { rsKey: 'TPL', name: 'Main Sanctuary', active: true },
      { rsKey: '402', name: 'Leventritt Room - 402', active: true },
      { rsKey: '402A', name: 'Little Leventritt', active: true },
      { rsKey: 'IMW', name: 'Isaac Mayer Wise Hall', active: true },
      { rsKey: 'LOW', name: 'Leon Lowenstein', active: true },
    ]);
  });

  // ===========================================================================
  // RI-15: admin permission gate on every endpoint
  // ===========================================================================
  test('RI-15: requester gets 403 on every rsched-import endpoint', async () => {
    const stagingId = '6720000000000000000000aa'; // any valid ObjectId string
    const sessionId = 'fake-session';
    const headers = { Authorization: `Bearer ${requesterToken}` };

    const calls = [
      () =>
        request(app)
          .post('/api/admin/rsched-import/upload')
          .set(headers)
          .field('calendarOwner', TEST_CALENDAR_OWNER)
          .field('dateRangeStart', '2026-03-01')
          .field('dateRangeEnd', '2026-03-31')
          .attach('csvFile', FIXTURE_PATH),
      () => request(app).get('/api/admin/rsched-import/sessions').set(headers),
      () => request(app).get(`/api/admin/rsched-import/sessions/${sessionId}`).set(headers),
      () => request(app).get(`/api/admin/rsched-import/sessions/${sessionId}/rows`).set(headers),
      () =>
        request(app)
          .put(`/api/admin/rsched-import/sessions/${sessionId}/rows/${stagingId}`)
          .set(headers)
          .send({ eventTitle: 'X' }),
      () =>
        request(app)
          .put(`/api/admin/rsched-import/sessions/${sessionId}/rows/${stagingId}/skip`)
          .set(headers)
          .send({ skip: true }),
      () => request(app).post(`/api/admin/rsched-import/sessions/${sessionId}/validate`).set(headers),
      () =>
        request(app)
          .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
          .set(headers)
          .send({}),
      () => request(app).post(`/api/admin/rsched-import/sessions/${sessionId}/publish`).set(headers),
      () => request(app).delete(`/api/admin/rsched-import/sessions/${sessionId}`).set(headers),
    ];

    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(403);
    }
  });

  // ===========================================================================
  // RI-14: discard removes all staging rows
  // ===========================================================================
  test('RI-14: DELETE /sessions/:sessionId removes all staging rows for that session', async () => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const upload = await request(app)
      .post('/api/admin/rsched-import/upload')
      .set(headers)
      .field('calendarOwner', TEST_CALENDAR_OWNER)
      .field('calendarId', TEST_CALENDAR_ID)
      .field('dateRangeStart', '2026-03-01')
      .field('dateRangeEnd', '2026-03-31')
      .attach('csvFile', FIXTURE_PATH);
    expect(upload.status).toBe(200);
    const { sessionId, rowCount } = upload.body;
    expect(rowCount).toBeGreaterThan(0);

    const stagingCol = db.collection('templeEvents__RschedImportStaging');
    expect(await stagingCol.countDocuments({ sessionId })).toBe(rowCount);

    const del = await request(app)
      .delete(`/api/admin/rsched-import/sessions/${sessionId}`)
      .set(headers);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(rowCount);
    expect(await stagingCol.countDocuments({ sessionId })).toBe(0);
  });

  // ===========================================================================
  // RI-E2E: full happy path through HTTP
  // ===========================================================================
  test('RI-E2E: upload → validate → commit creates events in templeEvents__Events', async () => {
    const headers = { Authorization: `Bearer ${adminToken}` };

    // Upload
    const upload = await request(app)
      .post('/api/admin/rsched-import/upload')
      .set(headers)
      .field('calendarOwner', TEST_CALENDAR_OWNER)
      .field('calendarId', TEST_CALENDAR_ID)
      .field('dateRangeStart', '2026-03-01')
      .field('dateRangeEnd', '2026-03-31')
      .attach('csvFile', FIXTURE_PATH);
    expect(upload.status).toBe(200);
    const { sessionId, rowCount, statusBreakdown } = upload.body;
    expect(rowCount).toBe(11); // 12 - 1 deleted
    expect(statusBreakdown.staged).toBeGreaterThan(0);
    expect(statusBreakdown.unmatched_location).toBe(2); // -2000000008, -2000000009

    // Validate (will resolve some conflicts/non-conflicts)
    const validate = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/validate`)
      .set(headers);
    expect(validate.status).toBe(200);

    // Commit
    const commit = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers)
      .send({ forceConflicts: false });
    expect(commit.status).toBe(200);
    expect(commit.body.applied + commit.body.noOp).toBeGreaterThan(0);

    // Verify events landed.
    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    const importedCount = await eventsCol.countDocuments({ source: 'rsSched' });
    expect(importedCount).toBeGreaterThan(0);
    // Confirm one specific event has top-level fields AND calendarData populated.
    const sample = await eventsCol.findOne({ eventId: 'rssched--2000000001' });
    expect(sample).toBeTruthy();
    expect(sample.eventTitle).toBe('Torah Study');
    expect(sample.calendarData?.eventTitle).toBe('Torah Study');
    expect(sample.calendarData?.startDateTime).toBe('2026-03-02T09:00:00');
    expect(sample.eventType).toBe('singleInstance');
    expect(sample.status).toBe('published');
    expect(sample._version).toBe(1);
    expect(Array.isArray(sample.statusHistory)).toBe(true);

    // Re-running commit should be idempotent (no_op for unchanged rows).
    const second = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers)
      .send({ forceConflicts: false });
    expect(second.status).toBe(200);
  });

  test('RI-E2E-search: searching rows narrows the result set', async () => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const upload = await request(app)
      .post('/api/admin/rsched-import/upload')
      .set(headers)
      .field('calendarOwner', TEST_CALENDAR_OWNER)
      .field('calendarId', TEST_CALENDAR_ID)
      .field('dateRangeStart', '2026-03-01')
      .field('dateRangeEnd', '2026-03-31')
      .attach('csvFile', FIXTURE_PATH);
    const { sessionId } = upload.body;

    const all = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/rows`)
      .set(headers);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(11);

    const search = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/rows?search=Torah`)
      .set(headers);
    expect(search.status).toBe(200);
    expect(search.body.rows.length).toBe(1);
    expect(search.body.rows[0].eventTitle).toBe('Torah Study');
  });
});
