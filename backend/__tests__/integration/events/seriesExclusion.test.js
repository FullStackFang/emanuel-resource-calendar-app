/**
 * Series Exclusion Tests (AS-1 to AS-5)
 *
 * GET /api/rooms/availability?excludeEventId=<id> must exclude the entire
 * recurring series the excluded document belongs to (master + all
 * exception/addition children), not just the single _id passed in.
 *
 * Bug: the SchedulingAssistant on a recurring exception's date showed the
 * exception in conflict with itself because the published-events bucket
 * skipped the excludeId filter, and even after that fix, the master and
 * sibling children of the same series were not excluded.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRecurringSeriesMaster,
  createExceptionDocument,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Series Exclusion Tests (AS-1 to AS-5)', () => {
  let mongoClient, db, app;

  const roomId = new ObjectId();
  const roomDoc = {
    _id: roomId,
    name: 'Chapel',
    displayName: 'Chapel',
    isReservable: true,
    active: true,
    status: 'approved',
  };

  function createWeeklyMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      status: 'published',
      eventTitle: 'Weekly Service',
      locations: [roomId],
      locationDisplayNames: ['Chapel'],
      startDateTime: new Date('2026-03-10T10:00:00'),
      endDateTime: new Date('2026-03-10T11:00:00'),
      calendarData: {
        eventTitle: 'Weekly Service',
        startDateTime: '2026-03-10T10:00:00',
        endDateTime: '2026-03-10T11:00:00',
        startDate: '2026-03-10',
        startTime: '10:00',
        endDate: '2026-03-10',
        endTime: '11:00',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        categories: ['Service'],
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        reservationStartTime: '10:00',
        reservationEndTime: '11:00',
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

  function queryAvailability(date, excludeEventId = null, rooms = [roomId]) {
    const params = new URLSearchParams({
      startDateTime: `${date}T00:00:00`,
      endDateTime: `${date}T23:59:59`,
      roomIds: rooms.map(r => r.toString()).join(','),
    });
    if (excludeEventId) params.append('excludeEventId', excludeEventId.toString());
    return request(app).get(`/api/rooms/availability?${params}`);
  }

  function reservationsForRoom(body) {
    const roomData = body.find(r => r.room._id.toString() === roomId.toString());
    return roomData ? roomData.conflicts.reservations : [];
  }

  beforeAll(async () => {
    ({ db, client: mongoClient } = await connectToGlobalServer('seriesExclusion'));
    await db.collection(COLLECTIONS.LOCATIONS).insertOne(roomDoc);
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
  });

  // ─── AS-1: Editing an exception excludes itself ───
  describe('AS-1: Editing an exception excludes itself from conflicts', () => {
    it('should not echo the exception back when its own _id is excluded', async () => {
      const master = createWeeklyMaster();
      // 2026-03-17 is a Tuesday — natural occurrence overridden by an exception
      const exception = createExceptionDocument(master, '2026-03-17', {
        startDateTime: '2026-03-17T10:30:00',
        endDateTime: '2026-03-17T11:30:00',
        startTime: '10:30',
        endTime: '11:30',
      }, { status: 'published' });

      await insertEvents(db, [master, exception]);

      const res = await queryAvailability('2026-03-17', exception._id);

      expect(res.status).toBe(200);
      const reservations = reservationsForRoom(res.body);
      const echoed = reservations.filter(r => r.id?.toString() === exception._id.toString());
      expect(echoed).toHaveLength(0);
    });
  });

  // ─── AS-2: Editing an exception excludes the master's expansion on same day ───
  describe('AS-2: Editing an exception excludes the parent master on the same day', () => {
    it('should suppress the master\'s synthetic occurrence on the exception\'s date and still report unrelated reservations', async () => {
      const master = createWeeklyMaster();
      const exception = createExceptionDocument(master, '2026-03-17', {
        startDateTime: '2026-03-17T10:30:00',
        endDateTime: '2026-03-17T11:30:00',
        startTime: '10:30',
        endTime: '11:30',
      }, { status: 'published' });

      // An unrelated published event in the same room on the same day
      const unrelated = createPublishedEvent({
        eventTitle: 'Unrelated Booking',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        startDateTime: new Date('2026-03-17T13:00:00'),
        endDateTime: new Date('2026-03-17T14:00:00'),
        calendarData: {
          eventTitle: 'Unrelated Booking',
          startDateTime: '2026-03-17T13:00:00',
          endDateTime: '2026-03-17T14:00:00',
          startDate: '2026-03-17',
          startTime: '13:00',
          endDate: '2026-03-17',
          endTime: '14:00',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
          categories: ['Meeting'],
          reservationStartTime: '13:00',
          reservationEndTime: '14:00',
        },
      });

      await insertEvents(db, [master, exception, unrelated]);

      const res = await queryAvailability('2026-03-17', exception._id);

      expect(res.status).toBe(200);
      const reservations = reservationsForRoom(res.body);

      // Neither the exception nor the master's expansion may appear
      const fromExc = reservations.filter(r => r.id?.toString() === exception._id.toString());
      const fromMaster = reservations.filter(r => r.id?.toString() === master._id.toString());
      expect(fromExc).toHaveLength(0);
      expect(fromMaster).toHaveLength(0);

      // The unrelated booking still surfaces as a conflict
      const fromUnrelated = reservations.filter(r => r.id?.toString() === unrelated._id.toString());
      expect(fromUnrelated).toHaveLength(1);
    });
  });

  // ─── AS-3: Editing the master excludes all child exception documents ───
  describe('AS-3: Editing the master excludes all child exception documents', () => {
    it('should suppress every exception/addition document of the series when the master is excluded', async () => {
      const master = createWeeklyMaster();
      const ex1 = createExceptionDocument(master, '2026-03-17', {
        startDateTime: '2026-03-17T10:30:00',
        endDateTime: '2026-03-17T11:30:00',
        startTime: '10:30',
        endTime: '11:30',
      }, { status: 'published' });
      const ex2 = createExceptionDocument(master, '2026-03-24', {
        startDateTime: '2026-03-24T10:30:00',
        endDateTime: '2026-03-24T11:30:00',
        startTime: '10:30',
        endTime: '11:30',
      }, { status: 'published' });

      await insertEvents(db, [master, ex1, ex2]);

      // Query 3/17 with master excluded — child exception on that day must vanish
      const res1 = await queryAvailability('2026-03-17', master._id);
      expect(res1.status).toBe(200);
      const r1 = reservationsForRoom(res1.body);
      expect(r1.filter(r => r.id?.toString() === ex1._id.toString())).toHaveLength(0);
      expect(r1.filter(r => r.id?.toString() === master._id.toString())).toHaveLength(0);

      // Query 3/24 with master excluded — second child must also vanish
      const res2 = await queryAvailability('2026-03-24', master._id);
      expect(res2.status).toBe(200);
      const r2 = reservationsForRoom(res2.body);
      expect(r2.filter(r => r.id?.toString() === ex2._id.toString())).toHaveLength(0);
      expect(r2.filter(r => r.id?.toString() === master._id.toString())).toHaveLength(0);
    });
  });

  // ─── AS-4: Non-recurring exclusion is unchanged (regression guard) ───
  describe('AS-4: Non-recurring excludeEventId still works', () => {
    it('should exclude only the targeted singleInstance and leave other reservations intact', async () => {
      const target = createPublishedEvent({
        eventTitle: 'My Event',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        startDateTime: new Date('2026-04-01T09:00:00'),
        endDateTime: new Date('2026-04-01T10:00:00'),
        calendarData: {
          eventTitle: 'My Event',
          startDateTime: '2026-04-01T09:00:00',
          endDateTime: '2026-04-01T10:00:00',
          startDate: '2026-04-01',
          startTime: '09:00',
          endDate: '2026-04-01',
          endTime: '10:00',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
          categories: ['Meeting'],
          reservationStartTime: '09:00',
          reservationEndTime: '10:00',
        },
      });

      const other = createPublishedEvent({
        eventTitle: 'Other Event',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        startDateTime: new Date('2026-04-01T13:00:00'),
        endDateTime: new Date('2026-04-01T14:00:00'),
        calendarData: {
          eventTitle: 'Other Event',
          startDateTime: '2026-04-01T13:00:00',
          endDateTime: '2026-04-01T14:00:00',
          startDate: '2026-04-01',
          startTime: '13:00',
          endDate: '2026-04-01',
          endTime: '14:00',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
          categories: ['Meeting'],
          reservationStartTime: '13:00',
          reservationEndTime: '14:00',
        },
      });

      await insertEvents(db, [target, other]);

      const res = await queryAvailability('2026-04-01', target._id);
      expect(res.status).toBe(200);
      const reservations = reservationsForRoom(res.body);

      expect(reservations.filter(r => r.id?.toString() === target._id.toString())).toHaveLength(0);
      expect(reservations.filter(r => r.id?.toString() === other._id.toString())).toHaveLength(1);
    });
  });

  // ─── AS-5: Invalid excludeEventId does not 500 ───
  describe('AS-5: Invalid excludeEventId is tolerated', () => {
    it('should return 200 and ignore exclusion silently', async () => {
      const master = createWeeklyMaster();
      await insertEvents(db, [master]);

      const res = await queryAvailability('2026-03-17', 'not-an-objectid');
      expect(res.status).toBe(200);
      const reservations = reservationsForRoom(res.body);
      // Master expansion should still be present (exclusion ignored, not series-resolved)
      const fromMaster = reservations.filter(r => r.id?.toString() === master._id.toString());
      expect(fromMaster.length).toBeGreaterThanOrEqual(1);
    });
  });
});
