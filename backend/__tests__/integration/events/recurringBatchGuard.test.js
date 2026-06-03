/**
 * Recurring + multi-day batch guard (defense-in-depth).
 *
 * Regression guard for the "38 events a day" duplication bug. The client used to
 * fan a recurring event out across a multi-day range into one create call per
 * day, each carrying the full recurrence — producing ~42 duplicate series
 * masters from a single submit. The client is fixed (eventCreationDecision.js),
 * but the create endpoint must also refuse the illegal combination so the bug
 * can never be re-triggered by a stale client, retry, or direct API call.
 *
 * Illegal signature: a create payload carrying BOTH a complete recurrence AND a
 * batch marker (eventSeriesId). Each alone is legitimate:
 *   - recurrence, no eventSeriesId  → a single series master (fine)
 *   - eventSeriesId, no recurrence  → one day of a non-recurring batch (fine)
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, TEST_CALENDAR_OWNER, TEST_CALENDAR_ID } = require('../../__helpers__/testConstants');

const WEEKLY_MON_FRI = {
  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
  range: { type: 'endDate', startDate: '2026-06-01', endDate: '2026-09-01' },
};

function baseGraphFields(overrides = {}) {
  return {
    subject: 'NS Drop Off',
    start: { dateTime: '2026-06-01T08:30:00', timeZone: 'Eastern Standard Time' },
    end: { dateTime: '2026-06-01T09:15:00', timeZone: 'Eastern Standard Time' },
    ...overrides,
  };
}

describe('Recurring + batch create guard', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurringBatchGuard'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);
  });

  it('RBG-1: rejects a create carrying BOTH recurrence and a batch marker', async () => {
    const res = await request(app)
      .post('/api/events/new/audit-update')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        graphFields: baseGraphFields(),
        internalFields: {
          eventTitle: 'NS Drop Off',
          recurrence: WEEKLY_MON_FRI,
          eventSeriesId: '1778521234525-abc',
          seriesLength: 92,
          seriesIndex: 0,
        },
        calendarId: TEST_CALENDAR_ID,
        calendarOwner: TEST_CALENDAR_OWNER,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECURRING_BATCH_CONFLICT');
  });

  it('RBG-2: does NOT apply the guard to a single recurring create (no batch marker)', async () => {
    const res = await request(app)
      .post('/api/events/new/audit-update')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        graphFields: baseGraphFields(),
        internalFields: {
          eventTitle: 'NS Drop Off',
          recurrence: WEEKLY_MON_FRI,
        },
        calendarId: TEST_CALENDAR_ID,
        calendarOwner: TEST_CALENDAR_OWNER,
      });

    expect(res.body.code).not.toBe('RECURRING_BATCH_CONFLICT');
  });

  it('RBG-3: does NOT apply the guard to a non-recurring batch day (no recurrence)', async () => {
    const res = await request(app)
      .post('/api/events/new/audit-update')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        graphFields: baseGraphFields(),
        internalFields: {
          eventTitle: 'NS Drop Off',
          eventSeriesId: '1778521234525-abc',
          seriesLength: 5,
          seriesIndex: 0,
        },
        calendarId: TEST_CALENDAR_ID,
        calendarOwner: TEST_CALENDAR_OWNER,
      });

    expect(res.body.code).not.toBe('RECURRING_BATCH_CONFLICT');
  });
});
