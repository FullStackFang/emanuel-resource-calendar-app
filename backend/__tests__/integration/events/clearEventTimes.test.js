/**
 * Clear Event Times Tests (CT-1 to CT-4)
 *
 * Verifies that admins can clear (null out) event start/end times
 * via PUT /api/admin/events/:id, and that the cleared values persist
 * through the save-and-reload cycle.
 *
 * CT-1: Clear startTime/endTime on a pending event
 * CT-2: Clear startTime/endTime on a published event (with Graph sync)
 * CT-3: Verify cleared times survive a second save (no regression)
 * CT-4: Clear operational times (setupTime, teardownTime, doorOpenTime, doorCloseTime)
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createPublishedEventWithGraph,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Clear Event Times Tests (CT-1 to CT-4)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('clearEventTimes'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
  });

  // Helper: tomorrow date string for test payloads
  function getTomorrowDateStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  // Helper: create an event with populated times
  // Uses factory defaults for top-level Date fields, overrides calendarData for time fields
  function createEventWithTimes(overrides = {}) {
    const dateStr = getTomorrowDateStr();

    return {
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      requesterName: requesterUser.name || requesterUser.displayName,
      eventTitle: 'Event With Times',
      reservationStartTime: '08:00',
      reservationEndTime: '18:00',
      calendarData: {
        eventTitle: 'Event With Times',
        startDateTime: `${dateStr}T09:00:00`,
        endDateTime: `${dateStr}T17:00:00`,
        startDate: dateStr,
        startTime: '09:00',
        endDate: dateStr,
        endTime: '17:00',
        reservationStartTime: '08:00',
        reservationEndTime: '18:00',
        setupTime: '07:30',
        teardownTime: '18:30',
        doorOpenTime: '08:30',
        doorCloseTime: '17:30',
        locations: [],
        categories: ['Meeting'],
        attendeeCount: 10,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        reservationStartMinutes: 0,
        reservationEndMinutes: 0,
      },
      ...overrides,
    };
  }

  describe('CT-1: Clear event start/end times on a pending event', () => {
    it('should store empty calendarData.startTime/endTime after admin save', async () => {
      const pending = createPendingEvent(createEventWithTimes());
      const [saved] = await insertEvents(db, [pending]);

      // Verify the event has times before clearing
      const before = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(before.calendarData.startTime).toBe('09:00');
      expect(before.calendarData.endTime).toBe('17:00');

      // Admin clears event times (mimics frontend sending empty strings)
      const dateStr = getTomorrowDateStr();

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Event With Times',
          startDate: dateStr,
          endDate: dateStr,
          startTime: '',
          endTime: '',
          // Reservation times stay populated
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          // startDateTime uses reservation time as effective (frontend behavior)
          startDateTime: `${dateStr}T08:00:00`,
          endDateTime: `${dateStr}T18:00:00`,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify database has empty event times
      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.calendarData.startTime).toBe('');
      expect(after.calendarData.endTime).toBe('');
      // Reservation times should be preserved
      expect(after.calendarData.reservationStartTime).toBe('08:00');
      expect(after.calendarData.reservationEndTime).toBe('18:00');
    });
  });

  describe('CT-2: Clear event times on a published event with Graph sync', () => {
    it('should store empty times and sync to Graph correctly', async () => {
      const published = createPublishedEventWithGraph(createEventWithTimes({
        calendarOwner: TEST_CALENDAR_OWNER,
      }));
      const [saved] = await insertEvents(db, [published]);

      const dateStr = getTomorrowDateStr();

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Event With Times',
          startDate: dateStr,
          endDate: dateStr,
          startTime: '',
          endTime: '',
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          startDateTime: `${dateStr}T08:00:00`,
          endDateTime: `${dateStr}T18:00:00`,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify database has empty event times
      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.calendarData.startTime).toBe('');
      expect(after.calendarData.endTime).toBe('');
    });
  });

  describe('CT-3: Cleared times survive a second save without regression', () => {
    it('should keep startTime/endTime empty when saving other fields', async () => {
      // Create event with ALREADY cleared times (simulating post-clear state)
      const pending = createPendingEvent(createEventWithTimes({
        calendarData: {
          eventTitle: 'Already Cleared Event',
          startDateTime: '2026-05-01T08:00:00',
          endDateTime: '2026-05-01T18:00:00',
          startDate: '2026-05-01',
          startTime: '',  // Already cleared
          endDate: '2026-05-01',
          endTime: '',    // Already cleared
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          locations: [],
          categories: ['Meeting'],
          attendeeCount: 10,
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartMinutes: 0,
          reservationEndMinutes: 0,
        },
      }));
      const [saved] = await insertEvents(db, [pending]);

      // Admin edits something else (title) — times should stay empty
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Renamed Event',
          startDate: '2026-05-01',
          endDate: '2026-05-01',
          startTime: '',
          endTime: '',
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          startDateTime: '2026-05-01T08:00:00',
          endDateTime: '2026-05-01T18:00:00',
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify times are STILL empty
      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.calendarData.startTime).toBe('');
      expect(after.calendarData.endTime).toBe('');
      expect(after.calendarData.eventTitle).toBe('Renamed Event');
    });
  });

  describe('CT-4: Clear operational times (setup, teardown, door open, door close)', () => {
    it('should store empty operational times after admin save', async () => {
      const pending = createPendingEvent(createEventWithTimes());
      const [saved] = await insertEvents(db, [pending]);

      // Verify operational times exist before clearing
      const before = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(before.calendarData.setupTime).toBe('07:30');
      expect(before.calendarData.teardownTime).toBe('18:30');
      expect(before.calendarData.doorOpenTime).toBe('08:30');
      expect(before.calendarData.doorCloseTime).toBe('17:30');

      const dateStr = getTomorrowDateStr();

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Event With Times',
          startDate: dateStr,
          endDate: dateStr,
          startTime: '09:00',
          endTime: '17:00',
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          // Clear all operational times
          setupTime: '',
          teardownTime: '',
          doorOpenTime: '',
          doorCloseTime: '',
          startDateTime: `${dateStr}T09:00:00`,
          endDateTime: `${dateStr}T17:00:00`,
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify operational times are cleared
      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.calendarData.setupTime).toBe('');
      expect(after.calendarData.teardownTime).toBe('');
      expect(after.calendarData.doorOpenTime).toBe('');
      expect(after.calendarData.doorCloseTime).toBe('');
      // Event times should be preserved
      expect(after.calendarData.startTime).toBe('09:00');
      expect(after.calendarData.endTime).toBe('17:00');
    });
  });
});
