/**
 * GET /api/admin/reports/sync-health/latest (SHL-1..3) and the no-timer
 * guarantee for the test harness (SHS-9).
 */

const request = require('supertest');

const syncHealthScheduler = require('../../services/syncHealthScheduler');
const startSpy = jest.spyOn(syncHealthScheduler, 'start');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS } = require('../__helpers__/testConstants');

const SETTINGS = 'templeEvents__SystemSettings';

describe('sync health latest summary (SHL-1..3, SHS-9)', () => {
  let mongoClient, db, app, adminToken, requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('syncHealthLatest'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(SETTINGS).deleteMany({ _id: syncHealthScheduler.LATEST_DOC_ID });
    const admin = createAdmin();
    const requester = createRequester();
    await insertUsers(db, [admin, requester]);
    adminToken = await createMockToken(admin);
    requesterToken = await createMockToken(requester);
  });

  const get = token => request(app)
    .get('/api/admin/reports/sync-health/latest')
    .set('Authorization', `Bearer ${token}`);

  it('SHL-1: a requester is refused', async () => {
    await get(requesterToken).expect(403);
  });

  it('SHL-2: before any run the summary is null', async () => {
    const res = await get(adminToken).expect(200);
    expect(res.body).toEqual({ latest: null });
  });

  it('SHL-3: returns the persisted summary without lease internals', async () => {
    await db.collection(SETTINGS).insertOne({
      _id: syncHealthScheduler.LATEST_DOC_ID,
      ranAt: new Date('2026-10-08T12:01:00Z'),
      counts: { missingFromOutlook: 1, shouldNotBeInOutlook: 2, untracked: 40, untethered: 3, failedDeletion: 0 },
      degraded: false, durationMs: 1200, error: false,
      nextRunAt: new Date('2026-10-08T18:01:00Z'), leasedBy: 'host:1',
    });

    const res = await get(adminToken).expect(200);

    expect(res.body.latest.counts.shouldNotBeInOutlook).toBe(2);
    expect(res.body.latest.error).toBe(false);
    expect(res.body.latest.leasedBy).toBeUndefined();
  });

  it('SHS-9: building the app for tests starts no scheduler timer', () => {
    expect(startSpy).not.toHaveBeenCalled();
  });
});
