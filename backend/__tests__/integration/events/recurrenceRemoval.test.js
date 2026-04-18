/**
 * Recurrence Removal Tests (RR-1 to RR-4)
 *
 * Tests that eventType is correctly downgraded from 'seriesMaster' to
 * 'singleInstance' when recurrence is explicitly removed (recurrence: null),
 * and that unrelated edits do not accidentally change eventType.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Recurrence Removal Tests (RR-1 to RR-4)', () => {
  let mongoClient, db, app;
  let adminUser, adminToken;

  const weeklyRecurrence = {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
    range: { type: 'endDate', startDate: '2026-04-01', endDate: '2026-06-30' },
    additions: [],
    exclusions: [],
  };

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurrenceRemoval'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});
    graphApiMock.resetMocks();

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);
  });

  describe('RR-1: Removing recurrence (null) from seriesMaster downgrades eventType', () => {
    it('should set eventType to singleInstance when recurrence: null is sent', async () => {
      const event = createRecurringSeriesMaster({
        status: 'published',
        calendarOwner: TEST_CALENDAR_OWNER,
        recurrence: weeklyRecurrence,
      });
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: event.calendarData.eventTitle,
          recurrence: null,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.eventType).toBe('singleInstance');
      expect(updated.recurrence).toBeNull();
    });
  });

  describe('RR-2: Unrelated edit of seriesMaster preserves eventType', () => {
    it('should keep eventType as seriesMaster when recurrence field is absent from payload', async () => {
      const event = createRecurringSeriesMaster({
        status: 'published',
        calendarOwner: TEST_CALENDAR_OWNER,
        recurrence: weeklyRecurrence,
      });
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Title Only',
          // recurrence intentionally absent — unrelated edit
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.eventType).toBe('seriesMaster');
      // Recurrence should be unchanged in DB
      expect(updated.recurrence).toBeTruthy();
      expect(updated.recurrence.pattern.type).toBe('weekly');
    });
  });

  describe('RR-3: Adding recurrence to singleInstance upgrades eventType', () => {
    it('should set eventType to seriesMaster when recurrence with pattern+range is added', async () => {
      const event = createPublishedEvent({
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [event]);

      expect(saved.eventType).toBe('singleInstance');

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: weeklyRecurrence,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.eventType).toBe('seriesMaster');
      expect(updated.recurrence).toBeTruthy();
      expect(updated.recurrence.pattern.type).toBe('weekly');
    });
  });

  describe('RR-4: Updating recurrence on seriesMaster keeps eventType as seriesMaster', () => {
    it('should keep eventType as seriesMaster when new valid recurrence is sent', async () => {
      const event = createRecurringSeriesMaster({
        status: 'published',
        calendarOwner: TEST_CALENDAR_OWNER,
        recurrence: weeklyRecurrence,
      });
      const [saved] = await insertEvents(db, [event]);

      const newRecurrence = {
        pattern: { type: 'daily', interval: 2 },
        range: { type: 'endDate', startDate: '2026-04-01', endDate: '2026-05-31' },
        additions: [],
        exclusions: [],
      };

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: newRecurrence,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.eventType).toBe('seriesMaster');
      expect(updated.recurrence.pattern.type).toBe('daily');
    });
  });
});
