/**
 * Runtime Config Tests (RC)
 *
 * Locks in the contract that GET /api/config returns the admin-editable
 * systemSettings.defaultCalendar (when present) rather than the static
 * env-driven CALENDAR_CONFIG.DEFAULT_MODE. This is what makes the admin's
 * 'Default Calendar' setting drive the frontend's APP_CONFIG.DEFAULT_DISPLAY_CALENDAR
 * end-to-end.
 *
 * The 5-minute cache (_calendarSettingsCache) is invalidated by PUT /admin/calendar-settings,
 * so we flip values via that endpoint to exercise the cache-flush contract.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

const SETTINGS_COLLECTION = 'templeEvents__SystemSettings';
// Cased keys match calendar-config.json (the admin endpoint validates against it).
const PRODUCTION_CASED = 'TempleEvents@emanuelnyc.org';
const SANDBOX_CASED = 'TempleEventsSandbox@emanuelnyc.org';
// Lowercase forms are what /api/config returns.
const PRODUCTION = PRODUCTION_CASED.toLowerCase();
const SANDBOX = SANDBOX_CASED.toLowerCase();

describe('Runtime Config (RC)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('runtimeConfig'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(SETTINGS_COLLECTION).deleteMany({});

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);
  });

  it('RC-1: returns systemSettings.defaultCalendar when set via admin endpoint', async () => {
    await request(app)
      .put('/api/admin/calendar-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultCalendar: PRODUCTION_CASED })
      .expect(200);

    const res = await request(app).get('/api/config').expect(200);
    expect(res.body.defaultDisplayCalendar).toBe(PRODUCTION);
    expect(res.body.roomReservationCalendar).toBe(PRODUCTION);
  });

  it('RC-2: admin saves SANDBOX, /api/config returns sandbox', async () => {
    await request(app)
      .put('/api/admin/calendar-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultCalendar: SANDBOX_CASED })
      .expect(200);

    const res = await request(app).get('/api/config').expect(200);
    expect(res.body.defaultDisplayCalendar).toBe(SANDBOX);
  });

  it('RC-3: flipping the default via PUT immediately changes the GET response', async () => {
    await request(app)
      .put('/api/admin/calendar-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultCalendar: PRODUCTION_CASED })
      .expect(200);

    const before = await request(app).get('/api/config').expect(200);
    expect(before.body.defaultDisplayCalendar).toBe(PRODUCTION);

    await request(app)
      .put('/api/admin/calendar-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultCalendar: SANDBOX_CASED })
      .expect(200);

    const after = await request(app).get('/api/config').expect(200);
    expect(after.body.defaultDisplayCalendar).toBe(SANDBOX);
  });

  it('RC-4: response is always lowercase regardless of admin input casing', async () => {
    await request(app)
      .put('/api/admin/calendar-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultCalendar: PRODUCTION_CASED })
      .expect(200);

    const res = await request(app).get('/api/config').expect(200);
    expect(res.body.defaultDisplayCalendar).toBe(res.body.defaultDisplayCalendar.toLowerCase());
    expect(res.body.roomReservationCalendar).toBe(res.body.roomReservationCalendar.toLowerCase());
  });
});
