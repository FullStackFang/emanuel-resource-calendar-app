/**
 * Events Load Empty / Warning Tests (E1-E4)
 *
 * Validates the structured warnings the production /api/events/load endpoint
 * surfaces when a calendarId cannot be resolved to a calendarOwner via
 * `backend/calendar-config.json`.
 *
 * Without these warnings, four distinct failure modes (unknown calendarId,
 * config error, no events in range, owner mismatch) all produced the same
 * `count: 0, source: 'hybrid'` response — indistinguishable in logs and
 * leaving the user with a silently blank calendar grid. The CALENDAR_NOT_CONFIGURED
 * warning lets the frontend distinguish "config error, pick another calendar"
 * from "this calendar has no events in the date range".
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');

// The production route — NOT the testApp.js shim at /api/events/calendar-load.
// We deliberately exercise the real production handler here because the
// CALENDAR_NOT_CONFIGURED warning is emitted there, not in the test shim.
const REAL_LOAD_EVENTS = '/api/events/load';

// A calendar ID the calendar-config.json should never know about.
const UNKNOWN_CALENDAR_ID = 'AAMkAD-NEVER-IN-CONFIG-' + Math.random().toString(36).slice(2, 10);

const startTime = new Date('2026-04-25T00:00:00Z').toISOString();
const endTime = new Date('2026-05-03T00:00:00Z').toISOString();

describe('Events Load Empty / Warnings (E1-E4)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('eventsLoadEmpty'));
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

  it('E1: unknown calendarId surfaces CALENDAR_NOT_CONFIGURED warning', async () => {
    const res = await request(app)
      .post(REAL_LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarIds: [UNKNOWN_CALENDAR_ID],
        startTime,
        endTime,
        forceRefresh: false,
      })
      .expect(200);

    // Top-level warnings array is always present (empty array if no warnings)
    expect(Array.isArray(res.body.warnings)).toBe(true);

    const unconfiguredWarning = res.body.warnings.find(
      w => w.code === 'CALENDAR_NOT_CONFIGURED'
    );
    expect(unconfiguredWarning).toBeDefined();
    expect(unconfiguredWarning.calendarId).toBe(UNKNOWN_CALENDAR_ID);
    expect(typeof unconfiguredWarning.message).toBe('string');
    expect(unconfiguredWarning.message).toContain('calendar-config.json');

    // Same warning is also reachable via the loadResults envelope, for any
    // future caller that walks the per-calendar result shape.
    expect(res.body.loadResults.warnings).toEqual(res.body.warnings);

    // No events for an unknown calendar
    expect(res.body.count).toBe(0);
    expect(res.body.events).toEqual([]);
  });

  it('E2: known calendarOwner with 0 events in date range emits no warnings', async () => {
    const res = await request(app)
      .post(REAL_LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwners: [TEST_CALENDAR_OWNER],
        startTime,
        endTime,
        forceRefresh: false,
      })
      .expect(200);

    expect(res.body.count).toBe(0);
    // Either no warnings field, or an empty array. Both indicate "configured
    // calendar, just no events" — distinct from the E1 misconfiguration case.
    const warnings = res.body.warnings || [];
    const unconfigured = warnings.find(w => w.code === 'CALENDAR_NOT_CONFIGURED');
    expect(unconfigured).toBeUndefined();
  });

  it('E3: explicit calendarOwners bypasses config lookup (no warnings even with no events)', async () => {
    // calendarOwners short-circuits getCalendarOwnerFromConfig entirely.
    // No lookup means no opportunity for CALENDAR_NOT_CONFIGURED.
    const res = await request(app)
      .post(REAL_LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwners: [TEST_CALENDAR_OWNER],
        startTime,
        endTime,
        forceRefresh: false,
      })
      .expect(200);

    const warnings = res.body.warnings || [];
    expect(warnings.find(w => w.code === 'CALENDAR_NOT_CONFIGURED')).toBeUndefined();
  });

  it('E4: warnings field is always present on success responses (empty array when none)', async () => {
    // Frontend code can rely on `loadResult.warnings` being iterable without
    // a null check. This regression-locks that contract.
    const res = await request(app)
      .post(REAL_LOAD_EVENTS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        calendarOwners: [TEST_CALENDAR_OWNER],
        startTime,
        endTime,
        forceRefresh: false,
      })
      .expect(200);

    expect(res.body).toHaveProperty('warnings');
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });
});
