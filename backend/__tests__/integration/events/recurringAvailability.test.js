/**
 * Recurring Event Availability Tests (RA-1 to RA-9)
 *
 * Tests that GET /api/rooms/availability expands published series masters
 * into per-occurrence entries, so the SchedulingAssistant shows conflicts
 * from other recurring events on the queried day.
 *
 * Root cause: the availability endpoint queried by calendarData.startDateTime
 * overlap, which only matches a series master's first occurrence. Future
 * occurrences were invisible. The fix adds a parallel series-master query
 * with recurrence expansion (same pattern as checkRoomConflicts).
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRecurringSeriesMaster,
  createExceptionDocument,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Recurring Event Availability Tests (RA-1 to RA-9)', () => {
  let mongoClient, db, app;

  // Shared room used by all tests
  const roomId = new ObjectId();
  const roomDoc = {
    _id: roomId,
    name: 'Chapel',
    displayName: 'Chapel',
    isReservable: true,
    active: true,
    status: 'approved',
  };

  // A different room for the no-room test
  const otherRoomId = new ObjectId();
  const otherRoomDoc = {
    _id: otherRoomId,
    name: 'Library',
    displayName: 'Library',
    isReservable: true,
    active: true,
    status: 'approved',
  };

  /**
   * Helper: create a weekly series master on Tuesdays 10:00-11:00
   * in the shared room, March 10 - June 30 2026.
   */
  function createWeeklyMaster(overrides = {}) {
    const startDT = new Date('2026-03-10T10:00:00');
    const endDT = new Date('2026-03-10T11:00:00');
    return createRecurringSeriesMaster({
      status: 'published',
      eventTitle: 'Weekly Chapel Service',
      locations: [roomId],
      locationDisplayNames: ['Chapel'],
      startDateTime: startDT,
      endDateTime: endDT,
      calendarData: {
        eventTitle: 'Weekly Chapel Service',
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
        reservationStartTime: '09:45',
        reservationEndTime: '11:15',
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

  /**
   * Helper: query the availability endpoint for a specific date and room.
   */
  function queryAvailability(date, rooms = [roomId], excludeEventId = null) {
    const params = new URLSearchParams({
      startDateTime: `${date}T00:00:00`,
      endDateTime: `${date}T23:59:59`,
      roomIds: rooms.map(r => r.toString()).join(','),
    });
    if (excludeEventId) params.append('excludeEventId', excludeEventId.toString());
    return request(app).get(`/api/rooms/availability?${params}`);
  }

  beforeAll(async () => {
    ({ db, client: mongoClient } = await connectToGlobalServer('recurringAvailability'));

    // Insert rooms
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([roomDoc, otherRoomDoc]);

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
  });

  // ─── RA-1: Basic recurring visibility on a future occurrence date ───
  describe('RA-1: Series master occurrence appears on future date', () => {
    it('should return the recurring occurrence when querying a date 5 weeks after start', async () => {
      const master = createWeeklyMaster();
      await insertEvents(db, [master]);

      // Query April 14 — 5 weeks after March 10, a Tuesday
      const res = await queryAvailability('2026-04-14');

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      expect(roomData).toBeDefined();

      // Should have at least one reservation entry from the expanded occurrence
      const reservations = roomData.conflicts.reservations;
      expect(reservations.length).toBeGreaterThanOrEqual(1);

      // The occurrence should have April 14 times, not March 10
      const occEntry = reservations.find(r =>
        r.originalStart && r.originalStart.includes('2026-04-14')
      );
      expect(occEntry).toBeDefined();
      expect(occEntry.eventTitle).toBe('Weekly Chapel Service');
      expect(occEntry.originalStart).toContain('2026-04-14T10:00');
      expect(occEntry.originalEnd).toContain('2026-04-14T11:00');
    });
  });

  // ─── RA-2: excludeEventId filters out the series master ───
  describe('RA-2: excludeEventId suppresses series master occurrences', () => {
    it('should return no occurrences when the series master is excluded', async () => {
      const master = createWeeklyMaster();
      await insertEvents(db, [master]);

      // Query April 14 but exclude the series master
      const res = await queryAvailability('2026-04-14', [roomId], master._id);

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // No entries from the excluded series
      const fromMaster = reservations.filter(r => r.id?.toString() === master._id.toString());
      expect(fromMaster).toHaveLength(0);
    });
  });

  // ─── RA-3: First occurrence date does not produce duplicates ───
  describe('RA-3: No duplicate on first occurrence date', () => {
    it('should return exactly one entry for the series master on its start date', async () => {
      const master = createWeeklyMaster();
      await insertEvents(db, [master]);

      // Query March 10 — the first occurrence date (also matched by main query)
      const res = await queryAvailability('2026-03-10');

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // Count entries from this master — should be exactly 1, not 2
      const fromMaster = reservations.filter(r => r.id?.toString() === master._id.toString());
      expect(fromMaster).toHaveLength(1);
    });
  });

  // ─── RA-4: Two series masters both appear on a shared occurrence date ───
  describe('RA-4: Multiple series masters visible on same date', () => {
    it('should show occurrences from both series on a date they share', async () => {
      // Series A: Tuesdays 10:00-11:00
      const masterA = createWeeklyMaster();

      // Series B: Tuesdays 14:00-15:00, same room
      const startDT_B = new Date('2026-03-10T14:00:00');
      const endDT_B = new Date('2026-03-10T15:00:00');
      const masterB = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Afternoon Workshop',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        startDateTime: startDT_B,
        endDateTime: endDT_B,
        calendarData: {
          eventTitle: 'Afternoon Workshop',
          startDateTime: '2026-03-10T14:00:00',
          endDateTime: '2026-03-10T15:00:00',
          startDate: '2026-03-10',
          startTime: '14:00',
          endDate: '2026-03-10',
          endTime: '15:00',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
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
      });

      await insertEvents(db, [masterA, masterB]);

      // Query April 14 — both series have occurrences on this Tuesday
      const res = await queryAvailability('2026-04-14');

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // Should have entries from both series (match by master ID)
      const fromA = reservations.find(r => r.id?.toString() === masterA._id.toString());
      const fromB = reservations.find(r => r.id?.toString() === masterB._id.toString());
      expect(fromA).toBeDefined();
      expect(fromB).toBeDefined();
      expect(fromA.originalStart).toContain('2026-04-14');
      expect(fromB.originalStart).toContain('2026-04-14');
    });
  });

  // ─── RA-5: Expired series does not appear ───
  describe('RA-5: Expired series returns no occurrences', () => {
    it('should not return occurrences for a series that ended before the query date', async () => {
      // Series ends March 31
      const master = createWeeklyMaster({
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-03-31' },
          additions: [],
          exclusions: [],
        },
      });
      await insertEvents(db, [master]);

      // Query April 14 — after the series has ended
      const res = await queryAvailability('2026-04-14');

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // No occurrences from the expired series
      const fromMaster = reservations.filter(r => r.id?.toString() === master._id.toString());
      expect(fromMaster).toHaveLength(0);
    });
  });

  // ─── RA-6: Series master on a different room does not appear ───
  describe('RA-6: Series on different room is not included', () => {
    it('should not return occurrences from a series master in a different room', async () => {
      // Series in otherRoom (Library), not Chapel
      const master = createWeeklyMaster({
        locations: [otherRoomId],
        locationDisplayNames: ['Library'],
        calendarData: {
          eventTitle: 'Weekly Chapel Service',
          startDateTime: '2026-03-10T10:00:00',
          endDateTime: '2026-03-10T11:00:00',
          startDate: '2026-03-10',
          startTime: '10:00',
          endDate: '2026-03-10',
          endTime: '11:00',
          locations: [otherRoomId],
          locationDisplayNames: ['Library'],
          categories: ['Service'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
        },
      });
      await insertEvents(db, [master]);

      // Query Chapel availability for April 14
      const res = await queryAvailability('2026-04-14', [roomId]);

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // No occurrences from the Library series should appear for Chapel
      expect(reservations).toHaveLength(0);
    });
  });

  // ─── RA-7: Exception document suppresses master occurrence ───
  describe('RA-7: Exception document suppresses master occurrence on same date', () => {
    /**
     * Helper: create a daily series master, April 13-17, 10:00-11:00 in Chapel.
     * Matches the user's reported scenario.
     */
    function createDailyMaster(overrides = {}) {
      const startDT = new Date('2026-04-13T10:00:00');
      const endDT = new Date('2026-04-13T11:00:00');
      return createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Daily Stand-up',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        startDateTime: startDT,
        endDateTime: endDT,
        calendarData: {
          eventTitle: 'Daily Stand-up',
          startDateTime: '2026-04-13T10:00:00',
          endDateTime: '2026-04-13T11:00:00',
          startDate: '2026-04-13',
          startTime: '10:00',
          endDate: '2026-04-13',
          endTime: '11:00',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
          categories: ['Meeting'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartTime: '10:00',
          reservationEndTime: '11:00',
        },
        recurrence: {
          pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-04-13', endDate: '2026-04-17' },
          additions: [],
          exclusions: [],
        },
        ...overrides,
      });
    }

    it('should show only the exception, not the master occurrence, on the exception date', async () => {
      const master = createDailyMaster();
      // Exception on April 14: shifted to 10:30-11:30
      const exception = createExceptionDocument(master, '2026-04-14', {
        reservationStartTime: '10:30',
        reservationEndTime: '11:30',
      });
      await insertEvents(db, [master, exception]);

      const res = await queryAvailability('2026-04-14');

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // Should have exactly ONE entry: the exception at 10:30-11:30
      // NOT the master's occurrence at 10:00-11:00
      const masterEntries = reservations.filter(r =>
        r.id?.toString() === master._id.toString()
      );
      const exceptionEntries = reservations.filter(r =>
        r.id?.toString() === exception._id.toString()
      );

      expect(masterEntries).toHaveLength(0);
      expect(exceptionEntries).toHaveLength(1);
      expect(exceptionEntries[0].originalStart).toContain('2026-04-14');
    });

    it('should still show master occurrences on non-exception dates', async () => {
      const master = createDailyMaster();
      const exception = createExceptionDocument(master, '2026-04-14', {
        reservationStartTime: '10:30',
        reservationEndTime: '11:30',
      });
      await insertEvents(db, [master, exception]);

      // Query April 15 — no exception on this date, master should appear
      const res = await queryAvailability('2026-04-15');

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      const masterEntries = reservations.filter(r =>
        r.id?.toString() === master._id.toString()
      );
      expect(masterEntries.length).toBeGreaterThanOrEqual(1);
      expect(masterEntries[0].originalStart).toContain('2026-04-15');
    });
  });

  // ─── RA-8: Editing exception — excluded exception still suppresses master ───
  describe('RA-8: Excluded exception still suppresses master occurrence', () => {
    it('should suppress master occurrence even when exception is the excluded event', async () => {
      const startDT = new Date('2026-04-13T10:00:00');
      const endDT = new Date('2026-04-13T11:00:00');
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Daily Stand-up',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        startDateTime: startDT,
        endDateTime: endDT,
        calendarData: {
          eventTitle: 'Daily Stand-up',
          startDateTime: '2026-04-13T10:00:00',
          endDateTime: '2026-04-13T11:00:00',
          startDate: '2026-04-13',
          startTime: '10:00',
          endDate: '2026-04-13',
          endTime: '11:00',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
          categories: ['Meeting'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartTime: '10:00',
          reservationEndTime: '11:00',
        },
        recurrence: {
          pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-04-13', endDate: '2026-04-17' },
          additions: [],
          exclusions: [],
        },
      });
      const exception = createExceptionDocument(master, '2026-04-14', {
        reservationStartTime: '10:30',
        reservationEndTime: '11:30',
      });
      await insertEvents(db, [master, exception]);

      // Query availability with excludeEventId = exception (simulates editing it)
      const res = await queryAvailability('2026-04-14', [roomId], exception._id);

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // The master's 10:00-11:00 occurrence should NOT appear as a conflict
      const masterEntries = reservations.filter(r =>
        r.id?.toString() === master._id.toString()
      );
      expect(masterEntries).toHaveLength(0);
    });
  });

  // ─── RA-9: Deleted exception does NOT suppress master occurrence ───
  describe('RA-9: Deleted exception does not suppress master occurrence', () => {
    it('should show master occurrence when exception is deleted', async () => {
      const startDT = new Date('2026-04-13T10:00:00');
      const endDT = new Date('2026-04-13T11:00:00');
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Daily Stand-up',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        startDateTime: startDT,
        endDateTime: endDT,
        calendarData: {
          eventTitle: 'Daily Stand-up',
          startDateTime: '2026-04-13T10:00:00',
          endDateTime: '2026-04-13T11:00:00',
          startDate: '2026-04-13',
          startTime: '10:00',
          endDate: '2026-04-13',
          endTime: '11:00',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
          categories: ['Meeting'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartTime: '10:00',
          reservationEndTime: '11:00',
        },
        recurrence: {
          pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-04-13', endDate: '2026-04-17' },
          additions: [],
          exclusions: [],
        },
      });
      // Deleted exception — should NOT suppress master's occurrence
      const exception = createExceptionDocument(master, '2026-04-14', {
        reservationStartTime: '10:30',
        reservationEndTime: '11:30',
      }, { isDeleted: true, status: 'deleted' });
      await insertEvents(db, [master, exception]);

      const res = await queryAvailability('2026-04-14');

      expect(res.status).toBe(200);
      const roomData = res.body.find(r => r.room._id.toString() === roomId.toString());
      const reservations = roomData.conflicts.reservations;

      // The master's occurrence should appear (deleted exception doesn't suppress it)
      const masterEntries = reservations.filter(r =>
        r.id?.toString() === master._id.toString()
      );
      expect(masterEntries.length).toBeGreaterThanOrEqual(1);
    });
  });
});
