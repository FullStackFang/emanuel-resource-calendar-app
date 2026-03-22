/**
 * Admin Occurrence Edit Tests (AOE-1 to AOE-13)
 *
 * Tests per-occurrence editing via PUT /api/admin/events/:id with editScope='thisEvent':
 * AOE-1 to AOE-7: Core occurrence override CRUD
 * AOE-8 to AOE-13: Addition occurrence Graph sync (exceptionEventIds fast-path)
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
  createRecurringSeriesMaster,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { COLLECTIONS, STATUS, ENDPOINTS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');

describe('Admin Occurrence Edit Tests (AOE-1 to AOE-7)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken, requesterToken;
  let locationA, locationB;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('adminOccurrenceEdit'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);

    // Create two test locations
    locationA = { _id: new ObjectId(), name: 'Room A', displayName: 'Room A', isReservable: true };
    locationB = { _id: new ObjectId(), name: 'Room B', displayName: 'Room B', isReservable: true };
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([locationA, locationB]);
  });

  /**
   * Helper to create a recurring series master (pending, daily 3/11-3/13)
   */
  function createTestSeriesMaster(overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-13' },
      additions: [],
      exclusions: [],
    };
    const startDateTime = new Date('2026-03-11T14:00:00');
    const endDateTime = new Date('2026-03-11T15:00:00');

    return createRecurringSeriesMaster({
      status: STATUS.PENDING,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      recurrence,
      startDateTime,
      endDateTime,
      locations: [locationA._id],
      locationDisplayNames: ['Room A'],
      calendarData: {
        eventTitle: 'Daily Standup',
        eventDescription: 'Test recurring event',
        startDateTime: '2026-03-11T14:00:00',
        endDateTime: '2026-03-11T15:00:00',
        startDate: '2026-03-11',
        startTime: '14:00',
        endDate: '2026-03-11',
        endTime: '15:00',
        locations: [locationA._id],
        locationDisplayNames: 'Room A',
        categories: ['Meeting'],
        recurrence,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      ...overrides,
    });
  }

  describe('AOE-1: thisEvent save creates occurrenceOverrides on series master', () => {
    it('should write override and return updated event', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Modified Standup',
          startTime: '16:00',
          endTime: '17:00',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify the override was written
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-12');
      expect(updated.occurrenceOverrides[0].startTime).toBe('16:00');
      expect(updated.occurrenceOverrides[0].endTime).toBe('17:00');
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Modified Standup');
      expect(updated.occurrenceOverrides[0].startDateTime).toBe('2026-03-12T16:00');
      expect(updated.occurrenceOverrides[0].endDateTime).toBe('2026-03-12T17:00');

      // Master-level calendarData fields should NOT change
      expect(updated.calendarData.eventTitle).toBe('Daily Standup');
      expect(updated.calendarData.startTime).toBe('14:00');
      expect(updated.calendarData.endTime).toBe('15:00');
    });
  });

  describe('AOE-2: thisEvent with location change stores in override only', () => {
    it('should store location override without changing master locations', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          locations: [locationB._id.toString()],
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);

      const override = updated.occurrenceOverrides[0];
      expect(override.occurrenceDate).toBe('2026-03-12');
      // Override should have locationB
      expect(override.locations).toHaveLength(1);
      expect(String(override.locations[0])).toBe(String(locationB._id));
      expect(override.locationDisplayNames).toBe('Room B');

      // Master calendarData.locations should still be locationA
      expect(updated.calendarData.locations).toHaveLength(1);
      expect(String(updated.calendarData.locations[0])).toBe(String(locationA._id));
    });
  });

  describe('AOE-3: thisEvent save same date twice is idempotent', () => {
    it('should replace existing override for same date', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      // First edit on 3/12
      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'First edit',
          startTime: '16:00',
          endTime: '17:00',
        });

      // Second edit on same date 3/12
      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Second edit',
          startTime: '18:00',
          endTime: '19:00',
        });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Second edit');
      expect(updated.occurrenceOverrides[0].startTime).toBe('18:00');
    });
  });

  describe('AOE-4: thisEvent saves to different dates accumulate', () => {
    it('should accumulate overrides for different dates', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      // Edit 3/12
      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Modified 3/12',
          startTime: '16:00',
          endTime: '17:00',
        });

      // Edit 3/13
      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-13',
          eventTitle: 'Modified 3/13',
          startTime: '10:00',
          endTime: '11:00',
        });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updated.occurrenceOverrides).toHaveLength(2);

      const override12 = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      const override13 = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-13');
      expect(override12.eventTitle).toBe('Modified 3/12');
      expect(override12.startTime).toBe('16:00');
      expect(override13.eventTitle).toBe('Modified 3/13');
      expect(override13.startTime).toBe('10:00');
    });
  });

  describe('AOE-5: allEvents scope updates master fields normally', () => {
    it('should update master calendarData and not use occurrenceOverrides', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'Updated All Standups',
          startDate: '2026-03-11',
          startTime: '14:00',
          endDate: '2026-03-11',
          endTime: '15:00',
          startDateTime: '2026-03-11T14:00:00',
          endDateTime: '2026-03-11T15:00:00',
          categories: ['Meeting'],
          _version: master._version,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      // testApp writes fields to top-level (production writes to calendarData.*)
      expect(updated.eventTitle).toBe('Updated All Standups');
      // Should not have occurrenceOverrides
      expect(updated.occurrenceOverrides).toBeUndefined();
    });
  });

  describe('AOE-6: Out-of-range occurrence date returns 400', () => {
    it('should reject occurrence date outside series range', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-15',
          eventTitle: 'Out of range',
          startTime: '10:00',
          endTime: '11:00',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/outside series range/i);
    });
  });

  /**
   * Helper to create a published series master with an addition date and exceptionEventIds.
   * Daily 3/18-3/20 with addition on 3/21. Published with graphData.id set.
   */
  function createPublishedSeriesMasterWithAddition(overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      additions: ['2026-03-21'],
      exclusions: [],
    };
    return createRecurringSeriesMaster({
      status: STATUS.PUBLISHED,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      recurrence,
      startDateTime: new Date('2026-03-18T14:00:00'),
      endDateTime: new Date('2026-03-18T15:00:00'),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: 'test-calendar-id',
      graphData: {
        id: 'AAMkSeriesMaster123',
        subject: 'Daily Standup',
        start: { dateTime: '2026-03-18T14:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-03-18T15:00:00', timeZone: 'America/New_York' },
      },
      exceptionEventIds: [
        { date: '2026-03-21', graphId: 'AAMkAddition321' },
      ],
      locations: [locationA._id],
      locationDisplayNames: ['Room A'],
      calendarData: {
        eventTitle: 'Daily Standup',
        eventDescription: 'Original description',
        startDateTime: '2026-03-18T14:00:00',
        endDateTime: '2026-03-18T15:00:00',
        startDate: '2026-03-18',
        startTime: '14:00',
        endDate: '2026-03-18',
        endTime: '15:00',
        locations: [locationA._id],
        locationDisplayNames: 'Room A',
        categories: ['Meeting'],
        recurrence,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      ...overrides,
    });
  }

  describe('AOE-7: Calendar-load reflects override on correct occurrence only', () => {
    it('should show overridden data for the edited occurrence date', async () => {
      const master = createTestSeriesMaster({
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-12',
            eventTitle: 'Override Title',
            startTime: '16:00',
            endTime: '17:00',
            startDateTime: '2026-03-12T16:00',
            endDateTime: '2026-03-12T17:00',
          },
        ],
      });
      await insertEvents(db, [master]);

      const res = await request(app)
        .post('/api/events/calendar-load')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          calendarOwner: TEST_CALENDAR_OWNER,
          startDate: '2026-03-01T00:00:00',
          endDate: '2026-03-31T23:59:59',
        });

      expect(res.status).toBe(200);
      const events = res.body.events;
      const found = events.find(e => String(e._id) === String(master._id));
      expect(found).toBeDefined();

      // The series master should still exist with its occurrenceOverrides
      expect(found.occurrenceOverrides).toHaveLength(1);
      expect(found.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-12');
      expect(found.occurrenceOverrides[0].eventTitle).toBe('Override Title');
    });
  });

  // --- AOE-8 to AOE-13: Addition occurrence Graph sync ---

  describe('AOE-8: thisEvent on addition date calls updateCalendarEvent with addition graphId', () => {
    it('should use exceptionEventIds graphId, NOT getRecurringEventInstances', async () => {
      const master = createPublishedSeriesMasterWithAddition();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-21',
          eventTitle: 'Renamed Addition',
          categories: ['Workshop'],
        });

      expect(res.status).toBe(200);

      // Should call updateCalendarEvent with the addition's graphId
      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].eventId).toBe('AAMkAddition321');
      expect(updateCalls[0].eventData.subject).toBe('Renamed Addition');
      expect(updateCalls[0].eventData.categories).toEqual(['Workshop']);

      // Should NOT call getRecurringEventInstances (addition is standalone)
      expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(0);
    });
  });

  describe('AOE-9: thisEvent on addition date syncs time changes', () => {
    it('should send start/end with :00 suffix and timeZone', async () => {
      const master = createPublishedSeriesMasterWithAddition();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-21',
          startTime: '10:00',
          endTime: '11:30',
        });

      expect(res.status).toBe(200);

      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].eventId).toBe('AAMkAddition321');
      expect(updateCalls[0].eventData.start).toEqual({
        dateTime: '2026-03-21T10:00:00',
        timeZone: 'America/New_York',
      });
      expect(updateCalls[0].eventData.end).toEqual({
        dateTime: '2026-03-21T11:30:00',
        timeZone: 'America/New_York',
      });
    });
  });

  describe('AOE-10: thisEvent on addition date syncs eventDescription', () => {
    it('should send body with contentType html', async () => {
      const master = createPublishedSeriesMasterWithAddition();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-21',
          eventDescription: 'Updated description for addition',
        });

      expect(res.status).toBe(200);

      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].eventId).toBe('AAMkAddition321');
      expect(updateCalls[0].eventData.body).toEqual({
        contentType: 'html',
        content: 'Updated description for addition',
      });
    });
  });

  describe('AOE-11: thisEvent on addition with no changed fields skips Graph call', () => {
    it('should not call updateCalendarEvent when no Graph-syncable fields changed', async () => {
      const master = createPublishedSeriesMasterWithAddition();
      await insertEvents(db, [master]);

      // Send only occurrenceDate with no actual field changes
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-21',
        });

      expect(res.status).toBe(200);

      // No Graph calls should be made
      expect(graphApiMock.getCallHistory('updateCalendarEvent')).toHaveLength(0);
      expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(0);
    });
  });

  describe('AOE-12: Graph failure on addition edit is non-fatal', () => {
    it('should save to MongoDB even when Graph API fails', async () => {
      const master = createPublishedSeriesMasterWithAddition();
      await insertEvents(db, [master]);

      // Make Graph API fail
      graphApiMock.setMockError('updateCalendarEvent', new Error('Graph API 503'));

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-21',
          eventTitle: 'Should still save to MongoDB',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify override was written to MongoDB despite Graph failure
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Should still save to MongoDB');
    });
  });

  describe('AOE-13: Regular (non-addition) occurrence still uses getRecurringEventInstances', () => {
    it('should call getRecurringEventInstances for dates within the recurrence pattern', async () => {
      const master = createPublishedSeriesMasterWithAddition();
      await insertEvents(db, [master]);

      // Mock instances response for the regular occurrence date
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        {
          id: 'AAMkInstance0319',
          start: { dateTime: '2026-03-19T14:00:00' },
          end: { dateTime: '2026-03-19T15:00:00' },
        },
      ]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-19',
          eventTitle: 'Modified Regular Occurrence',
        });

      expect(res.status).toBe(200);

      // Should call getRecurringEventInstances (regular occurrence, not an addition)
      expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(1);

      // Should call updateCalendarEvent with the instance ID from getRecurringEventInstances
      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].eventId).toBe('AAMkInstance0319');
      expect(updateCalls[0].eventData.subject).toBe('Modified Regular Occurrence');
    });
  });
});
