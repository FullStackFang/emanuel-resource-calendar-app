/**
 * Reservation Times Persistence Tests
 *
 * Verifies that reservationStartTime, reservationEndTime, reservationStartMinutes,
 * and reservationEndMinutes are correctly stored in calendarData across all
 * write endpoints.
 *
 * Bug: The audit-update endpoint and PUT /api/admin/events/:id were not storing
 * these fields, so reservation times entered by admin/approver were lost.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, TEST_CALENDAR_OWNER, TEST_CALENDAR_ID } = require('../../__helpers__/testConstants');

describe('Reservation Times Persistence', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('reservationTimes'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);
  });

  describe('PUT /api/admin/events/:id - Admin Save', () => {
    it('RT-1: should store reservation times in calendarData when saving a published event', async () => {
      const event = createPublishedEvent({
        userId: adminUser.odataId,
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reservationStartTime: '08:00',
          reservationEndTime: '12:00',
          reservationStartMinutes: 30,
          reservationEndMinutes: 15,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify fields are in calendarData (not just top-level)
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.calendarData.reservationStartTime).toBe('08:00');
      expect(updated.calendarData.reservationEndTime).toBe('12:00');
      expect(updated.calendarData.reservationStartMinutes).toBe(30);
      expect(updated.calendarData.reservationEndMinutes).toBe(15);
    });

    it('RT-2: should store reservation times in calendarData when saving a pending event', async () => {
      const event = createPendingEvent({
        userId: adminUser.odataId,
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reservationStartTime: '07:30',
          reservationEndTime: '13:00',
          reservationStartMinutes: 60,
          reservationEndMinutes: 30,
          forceUpdate: true, // Skip conflict check
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.calendarData.reservationStartTime).toBe('07:30');
      expect(updated.calendarData.reservationEndTime).toBe('13:00');
      expect(updated.calendarData.reservationStartMinutes).toBe(60);
      expect(updated.calendarData.reservationEndMinutes).toBe(30);
    });

    it('RT-3: should preserve existing reservation times when not included in update', async () => {
      const event = createPublishedEvent({
        userId: adminUser.odataId,
        calendarOwner: TEST_CALENDAR_OWNER,
        calendarData: {
          eventTitle: 'Test Event',
          eventDescription: '',
          startDateTime: '2026-04-01T09:00:00',
          endDateTime: '2026-04-01T11:00:00',
          startDate: '2026-04-01',
          startTime: '09:00',
          endDate: '2026-04-01',
          endTime: '11:00',
          locations: [],
          categories: [],
          reservationStartTime: '08:00',
          reservationEndTime: '12:00',
          reservationStartMinutes: 30,
          reservationEndMinutes: 15,
        },
      });
      const [saved] = await insertEvents(db, [event]);

      // Update only the title, not reservation times
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Title Only',
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Reservation times should be preserved
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.calendarData.reservationStartTime).toBe('08:00');
      expect(updated.calendarData.reservationEndTime).toBe('12:00');
      expect(updated.calendarData.reservationStartMinutes).toBe(30);
      expect(updated.calendarData.reservationEndMinutes).toBe(15);
    });

    it('RT-4: should store setupTimeMinutes and teardownTimeMinutes in calendarData', async () => {
      const event = createPublishedEvent({
        userId: adminUser.odataId,
        calendarOwner: TEST_CALENDAR_OWNER,
      });
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          setupTimeMinutes: 45,
          teardownTimeMinutes: 20,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.calendarData.setupTimeMinutes).toBe(45);
      expect(updated.calendarData.teardownTimeMinutes).toBe(20);
    });
  });
});
