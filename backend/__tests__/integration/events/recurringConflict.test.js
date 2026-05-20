/**
 * Recurring Event Conflict Detection Tests (RCC-1 to RCC-9)
 *
 * Tests that checkRoomConflicts() detects conflicts against recurring
 * series master occurrences, not just stored start/end times.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Recurring Event Conflict Detection Tests (RCC-1 to RCC-9)', () => {
  let mongoClient, db, app;
  let requesterUser, adminUser;
  let requesterToken, adminToken;

  // Room ID shared between events
  const sharedRoomId = new ObjectId();
  const sharedRoom = { _id: sharedRoomId, displayName: 'Conference Room B' };

  // A recurring series master that occurs every Tuesday 10:00-11:00
  // from March 10 to June 30, 2026
  function createWeeklySeriesMaster(overrides = {}) {
    const startDT = new Date('2026-03-10T10:00:00');
    const endDT = new Date('2026-03-10T11:00:00');
    return createRecurringSeriesMaster({
      status: STATUS.PUBLISHED,
      eventTitle: 'Weekly Team Sync',
      locations: [sharedRoomId],
      locationDisplayNames: ['Conference Room B'],
      startDateTime: startDT,
      endDateTime: endDT,
      calendarData: {
        eventTitle: 'Weekly Team Sync',
        startDateTime: '2026-03-10T10:00:00',
        endDateTime: '2026-03-10T11:00:00',
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
        categories: ['Meeting'],
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      },
      ...overrides,
    });
  }

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurringConflict'));

    // Insert shared room as a location
    await db.collection(COLLECTIONS.LOCATIONS).insertOne({
      ...sharedRoom,
      isReservable: true,
      status: 'approved',
    });

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

    requesterUser = createRequester();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    adminToken = await createMockToken(adminUser);
  });

  describe('RCC-1: Detects conflict with recurring occurrence on a future Tuesday', () => {
    it('should return 409 when publishing event overlapping a recurring occurrence', async () => {
      // Insert a recurring series master
      const master = createWeeklySeriesMaster();
      await insertEvents(db, [master]);

      // Create a new event on April 7 (Tuesday) 10:30-11:30 in same room
      const conflicting = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Conflicting Meeting',
        startDateTime: new Date('2026-04-07T10:30:00'),
        endDateTime: new Date('2026-04-07T11:30:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [conflicting]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(409);

      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  describe('RCC-2: No conflict on excluded date', () => {
    it('should not conflict when recurring occurrence is excluded', async () => {
      // Insert series master with April 14 excluded
      const master = createWeeklySeriesMaster({
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
          additions: [],
          exclusions: ['2026-04-14'],
        },
      });
      await insertEvents(db, [master]);

      // Create event on excluded date April 14 10:00-11:00
      const noConflict = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'No Conflict Meeting',
        startDateTime: new Date('2026-04-14T10:00:00'),
        endDateTime: new Date('2026-04-14T11:00:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [noConflict]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('RCC-3: No conflict on non-pattern day', () => {
    it('should not conflict on Wednesday when pattern is Tuesday', async () => {
      const master = createWeeklySeriesMaster();
      await insertEvents(db, [master]);

      // Create event on April 8 (Wednesday) 10:00-11:00
      const noConflict = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Wednesday Meeting',
        startDateTime: new Date('2026-04-08T10:00:00'),
        endDateTime: new Date('2026-04-08T11:00:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [noConflict]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('RCC-4: No conflict in different room', () => {
    it('should not conflict when rooms do not overlap', async () => {
      const master = createWeeklySeriesMaster();
      await insertEvents(db, [master]);

      const differentRoomId = new ObjectId();
      const noConflict = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Other Room Meeting',
        startDateTime: new Date('2026-04-07T10:00:00'),
        endDateTime: new Date('2026-04-07T11:00:00'),
        locations: [differentRoomId],
        locationDisplayNames: ['Other Room'],
      });
      const [saved] = await insertEvents(db, [noConflict]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('RCC-5: Conflict with daily recurring event', () => {
    it('should detect overlap with a daily recurring series', async () => {
      const dailyMaster = createRecurringSeriesMaster({
        status: STATUS.PUBLISHED,
        eventTitle: 'Daily Standup',
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
        startDateTime: new Date('2026-03-10T09:00:00'),
        endDateTime: new Date('2026-03-10T09:30:00'),
        calendarData: {
          eventTitle: 'Daily Standup',
          startDateTime: '2026-03-10T09:00:00',
          endDateTime: '2026-03-10T09:30:00',
          locations: [sharedRoomId],
          locationDisplayNames: ['Conference Room B'],
          categories: ['Meeting'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
        },
        recurrence: {
          pattern: { type: 'daily', interval: 1 },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-12-31' },
          additions: [],
          exclusions: [],
        },
      });
      await insertEvents(db, [dailyMaster]);

      // Overlapping event on April 15 (Wednesday) 09:00-10:00
      const conflicting = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Conflicting with Daily',
        startDateTime: new Date('2026-04-15T09:00:00'),
        endDateTime: new Date('2026-04-15T10:00:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [conflicting]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(409);

      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  describe('RCC-6: No conflict outside range end date', () => {
    it('should not conflict after the recurring series end date', async () => {
      const master = createWeeklySeriesMaster();
      await insertEvents(db, [master]);

      // Create event on July 7 (Tuesday) - after the June 30 end date
      const noConflict = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'After Series End',
        startDateTime: new Date('2026-07-07T10:00:00'),
        endDateTime: new Date('2026-07-07T11:00:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [noConflict]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('RCC-7: Admin can force-publish despite recurring conflict', () => {
    it('should allow publish with forcePublish despite recurring conflict', async () => {
      const master = createWeeklySeriesMaster();
      await insertEvents(db, [master]);

      const conflicting = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Force Published',
        startDateTime: new Date('2026-04-07T10:30:00'),
        endDateTime: new Date('2026-04-07T11:30:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [conflicting]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version, forcePublish: true })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('RCC-8: No conflict when times do not overlap', () => {
    it('should not conflict when event is before recurring occurrence time', async () => {
      const master = createWeeklySeriesMaster();
      await insertEvents(db, [master]);

      // Create event on same Tuesday but 08:00-09:00 (before 10:00-11:00)
      const noConflict = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Early Morning Meeting',
        startDateTime: new Date('2026-04-07T08:00:00'),
        endDateTime: new Date('2026-04-07T09:00:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [noConflict]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── RCC-9: Exception document suppresses master occurrence in conflict check ───
  describe('RCC-9: Exception document suppresses master occurrence', () => {
    it('should not conflict when master occurrence is replaced by a non-overlapping exception', async () => {
      // Daily series: 10:00-11:00, April 13-17
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Daily Stand-up',
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
        startDateTime: new Date('2026-04-13T10:00:00'),
        endDateTime: new Date('2026-04-13T11:00:00'),
        calendarData: {
          eventTitle: 'Daily Stand-up',
          startDateTime: '2026-04-13T10:00:00',
          endDateTime: '2026-04-13T11:00:00',
          locations: [sharedRoomId],
          locationDisplayNames: ['Conference Room B'],
          categories: ['Meeting'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
        },
        recurrence: {
          pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-04-13', endDate: '2026-04-17' },
          additions: [],
          exclusions: [],
        },
      });

      // Exception on April 14: moved to 14:00-15:00 (afternoon, no overlap with 10:00-11:00)
      // Must override startTime/endTime so mergeDefaultsWithOverrides builds the correct startDateTime
      const exception = createExceptionDocument(master, '2026-04-14', {
        startTime: '14:00',
        endTime: '15:00',
        reservationStartTime: '14:00',
        reservationEndTime: '15:00',
      });

      await insertEvents(db, [master, exception]);

      // New event on April 14 at 10:30-11:30 — overlaps the MASTER's 10:00-11:00 slot
      // but the master's occurrence is replaced by the exception at 14:00-15:00
      const noConflict = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Should Not Conflict',
        startDateTime: new Date('2026-04-14T10:30:00'),
        endDateTime: new Date('2026-04-14T11:30:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [noConflict]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── RCC-10 / RCC-11: Phantom conflict from a series master whose stored ───
  // calendarData.endDateTime is the SERIES END (production storage reality,
  // see api-server.js comment ~line 24602: "Mongo stores calendarData.endDateTime
  // as the series END (e.g. 2027-07-19)"). The main conflict query's Case-3
  // "encompassing" branch matches such a master against ANY same-room publish
  // within the series span, regardless of time-of-day, manufacturing a phantom
  // hard conflict. Mirrors the front-end SchedulingAssistant phantom badge.
  //
  // NOTE: unlike every other fixture in this file, the master below stores its
  // endDateTime on the series-END date (2027-06-30) with the daily end TIME
  // (14:30) — the faithful production shape that triggers the bug.
  function createSpanningNurserySchoolMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      status: STATUS.PUBLISHED,
      eventTitle: 'Nursery School Drop off and Dismissal at 65th Street',
      locations: [sharedRoomId],
      locationDisplayNames: ['Conference Room B'],
      startDateTime: new Date('2026-09-15T08:45:00'),
      endDateTime: new Date('2027-06-30T14:30:00'), // series-END date, daily end time
      calendarData: {
        eventTitle: 'Nursery School Drop off and Dismissal at 65th Street',
        startDateTime: '2026-09-15T08:45:00',
        endDateTime: '2027-06-30T14:30:00', // SPANNING: series end date + daily end time
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
        categories: ['Meeting'],
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      recurrence: {
        pattern: { type: 'daily', interval: 1 },
        range: { type: 'endDate', startDate: '2026-09-15', endDate: '2027-06-30' },
        additions: [],
        exclusions: [],
      },
      ...overrides,
    });
  }

  describe('RCC-10: No phantom conflict at a non-overlapping time inside the series span', () => {
    it('should publish (200) a 6-8 PM event in the same room as a daily 8:45 AM-2:30 PM series', async () => {
      const master = createSpanningNurserySchoolMaster();
      await insertEvents(db, [master]);

      // Sept 16 (in range) 18:00-20:00 — the daily occurrence is 08:45-14:30, no overlap
      const noConflict = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Teen High Holiday Rehearsal',
        startDateTime: new Date('2026-09-16T18:00:00'),
        endDateTime: new Date('2026-09-16T20:00:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [noConflict]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('RCC-11: Real conflict still detected against a spanning series master', () => {
    it('should return 409 for a 10 AM-noon event overlapping the daily 8:45 AM-2:30 PM occurrence', async () => {
      const master = createSpanningNurserySchoolMaster();
      await insertEvents(db, [master]);

      // Sept 16 (in range) 10:00-12:00 — genuinely overlaps the 08:45-14:30 occurrence
      const conflicting = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Daytime Meeting',
        startDateTime: new Date('2026-09-16T10:00:00'),
        endDateTime: new Date('2026-09-16T12:00:00'),
        locations: [sharedRoomId],
        locationDisplayNames: ['Conference Room B'],
      });
      const [saved] = await insertEvents(db, [conflicting]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });
});
