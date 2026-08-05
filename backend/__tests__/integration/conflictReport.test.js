/**
 * Room Conflict Report Tests (CR-1 to CR-16)
 *
 * The report inverts the traversal every other conflict check performs: instead
 * of "given this candidate, what does it hit?", it asks "across this window,
 * what is double-booked?". Nothing else in the system can answer that, which is
 * why Outlook-originated events and forced publishes can double-book a room
 * invisibly.
 *
 * Detection cases drive services/conflictReportService.js directly with an
 * explicit window, so fixtures can use fixed dates. The endpoint cases (CR-13)
 * go through supertest, because the gate and the window validation are the
 * endpoint's job, not the service's.
 */

const request = require('supertest');
const { ObjectId, Collection } = require('mongodb');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const {
  createRequester,
  createApprover,
  createAdmin,
  insertUsers,
} = require('../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createPublishedEvent,
  createRejectedEvent,
  createDeletedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  insertEvents,
} = require('../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../__helpers__/testConstants');

const { runConflictReport } = require('../../services/conflictReportService');

// A window far enough ahead of "today" that the endpoint's today-anchored
// window (CR-13) never picks up these fixtures.
const WINDOW_START = '2027-03-01';
const WINDOW_END = '2027-06-01';

const roomA = { _id: new ObjectId(), displayName: 'Sanctuary' };
const roomB = { _id: new ObjectId(), displayName: 'Chapel' };

describe('Room Conflict Report (CR-1 to CR-16)', () => {
  let mongoClient, db, app;
  let requesterUser, approverUser, adminUser;
  let requesterToken, approverToken, adminToken;

  /** Run the scan over the fixed fixture window. */
  function scan(overrides = {}) {
    return runConflictReport({
      eventsCollection: db.collection(COLLECTIONS.EVENTS),
      categoryMap: new Map(),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      calendarOwner: null,
      ...overrides,
    });
  }

  /**
   * A published event in a room, with local-time strings in calendarData —
   * the shape the scan actually reads.
   *
   * Buffer fields are written ONLY when the caller asks for them. That matters:
   * the buffer chain is `reservationStartMinutes ?? calendarData.
   * reservationStartMinutes ?? setupTimeMinutes ?? ...`, and `??` falls through
   * on null/undefined but NOT on 0. A fixture that always wrote
   * `reservationStartMinutes: 0` would shadow the setup fallback and test a
   * shape no real event has — legacy events omit the outer bounds entirely,
   * which is the only reason the fallback exists.
   */
  function published(opts) {
    const {
      title,
      start,
      end,
      rooms = [roomA._id],
      roomNames = ['Sanctuary'],
      categories = ['Meeting'],
      setupTimeMinutes,
      teardownTimeMinutes,
      reservationStartMinutes,
      reservationEndMinutes,
      factory = createPublishedEvent,
      ...rest
    } = opts;

    const buffers = {};
    if (setupTimeMinutes !== undefined) buffers.setupTimeMinutes = setupTimeMinutes;
    if (teardownTimeMinutes !== undefined) buffers.teardownTimeMinutes = teardownTimeMinutes;
    if (reservationStartMinutes !== undefined) buffers.reservationStartMinutes = reservationStartMinutes;
    if (reservationEndMinutes !== undefined) buffers.reservationEndMinutes = reservationEndMinutes;

    return factory({
      eventTitle: title,
      startDateTime: new Date(start),
      endDateTime: new Date(end),
      locations: rooms,
      locationDisplayNames: roomNames,
      categories,
      calendarData: {
        eventTitle: title,
        startDateTime: start,
        endDateTime: end,
        locations: rooms,
        locationDisplayNames: roomNames,
        categories,
        ...buffers,
      },
      ...rest,
    });
  }

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('conflictReport'));

    await db.collection(COLLECTIONS.LOCATIONS).insertMany([
      { ...roomA, isReservable: true, status: 'approved' },
      { ...roomB, isReservable: true, status: 'approved' },
    ]);

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    requesterUser = createRequester();
    approverUser = createApprover();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, approverUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  // -------------------------------------------------------------------------
  // Detection core
  // -------------------------------------------------------------------------

  describe('CR-1: two overlapping published events in one room', () => {
    test('reports exactly one conflict', async () => {
      await insertEvents(db, [
        published({ title: 'Board Meeting', start: '2027-03-10T10:00:00', end: '2027-03-10T12:00:00' }),
        published({ title: 'Choir Practice', start: '2027-03-10T11:00:00', end: '2027-03-10T13:00:00' }),
      ]);

      const report = await scan();

      expect(report.conflictCount).toBe(1);
      expect(report.conflicts).toHaveLength(1);

      const [conflict] = report.conflicts;
      expect(conflict.date).toBe('2027-03-10');
      expect(String(conflict.roomId)).toBe(String(roomA._id));
      expect(conflict.sides.map((s) => s.title).sort()).toEqual(['Board Meeting', 'Choir Practice']);
    });

    test('emits the pair once, not once per direction', async () => {
      await insertEvents(db, [
        published({ title: 'A', start: '2027-03-10T10:00:00', end: '2027-03-10T12:00:00' }),
        published({ title: 'B', start: '2027-03-10T11:00:00', end: '2027-03-10T13:00:00' }),
      ]);

      const report = await scan();
      const keys = report.conflicts.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toHaveLength(1);
    });
  });

  describe('CR-2: same room, non-overlapping times', () => {
    test('reports no conflict when the windows only touch', async () => {
      await insertEvents(db, [
        published({ title: 'Morning', start: '2027-03-10T09:00:00', end: '2027-03-10T10:00:00' }),
        published({ title: 'Midday', start: '2027-03-10T10:00:00', end: '2027-03-10T11:00:00' }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(0);
      expect(report.conflictCount).toBe(0);
    });

    test('reports no conflict when the windows are apart', async () => {
      await insertEvents(db, [
        published({ title: 'Morning', start: '2027-03-10T09:00:00', end: '2027-03-10T10:00:00' }),
        published({ title: 'Evening', start: '2027-03-10T18:00:00', end: '2027-03-10T19:00:00' }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });
  });

  describe('CR-3: overlapping in time but no shared room', () => {
    test('reports no conflict', async () => {
      await insertEvents(db, [
        published({ title: 'In Sanctuary', start: '2027-03-10T10:00:00', end: '2027-03-10T12:00:00' }),
        published({
          title: 'In Chapel',
          start: '2027-03-10T10:00:00',
          end: '2027-03-10T12:00:00',
          rooms: [roomB._id],
          roomNames: ['Chapel'],
        }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });

    test('reports one conflict when two multi-room events share only one room', async () => {
      await insertEvents(db, [
        published({
          title: 'Both Rooms',
          start: '2027-03-10T10:00:00',
          end: '2027-03-10T12:00:00',
          rooms: [roomA._id, roomB._id],
          roomNames: ['Sanctuary', 'Chapel'],
        }),
        published({
          title: 'Chapel Only',
          start: '2027-03-10T11:00:00',
          end: '2027-03-10T13:00:00',
          rooms: [roomB._id],
          roomNames: ['Chapel'],
        }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(1);
      expect(String(report.conflicts[0].roomId)).toBe(String(roomB._id));
    });
  });

  describe('CR-11: only published events are eligible', () => {
    test.each([
      ['draft', createDraftEvent],
      ['pending', createPendingEvent],
      ['rejected', createRejectedEvent],
      ['deleted', createDeletedEvent],
    ])('a %s event overlapping a published event produces no conflict', async (_label, factory) => {
      await insertEvents(db, [
        published({ title: 'Published', start: '2027-03-10T10:00:00', end: '2027-03-10T12:00:00' }),
        published({ title: 'Not Published', start: '2027-03-10T11:00:00', end: '2027-03-10T13:00:00', factory }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(0);
    });

    test('two non-published events overlapping each other produce no conflict', async () => {
      await insertEvents(db, [
        published({ title: 'Draft One', start: '2027-03-10T10:00:00', end: '2027-03-10T12:00:00', factory: createDraftEvent }),
        published({ title: 'Draft Two', start: '2027-03-10T11:00:00', end: '2027-03-10T13:00:00', factory: createDraftEvent }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Effective windows and buffers (D8)
  // -------------------------------------------------------------------------

  describe('CR-4: a conflict caused only by a buffer', () => {
    test('reports the conflict and names the buffer intersection, not either span', async () => {
      // Visible times do not overlap at all: 10:00-11:00 then 11:15-12:00.
      // The first event's 30-minute teardown runs to 11:30, so the room is
      // contested from 11:15 to 11:30. A row reading "10:00-11:00 vs
      // 11:15-12:00" is what an approver argues with; the contested interval
      // is what explains itself.
      await insertEvents(db, [
        published({
          title: 'Concert',
          start: '2027-03-12T10:00:00',
          end: '2027-03-12T11:00:00',
          teardownTimeMinutes: 30,
        }),
        published({ title: 'Study Group', start: '2027-03-12T11:15:00', end: '2027-03-12T12:00:00' }),
      ]);

      const report = await scan();

      expect(report.conflicts).toHaveLength(1);
      const [conflict] = report.conflicts;
      expect(conflict.overlapStart).toBe('2027-03-12T11:15:00');
      expect(conflict.overlapEnd).toBe('2027-03-12T11:30:00');

      // Each side still reports its own visible times underneath.
      const concert = conflict.sides.find((s) => s.title === 'Concert');
      expect(concert.startDateTime).toBe('2027-03-12T10:00:00');
      expect(concert.endDateTime).toBe('2027-03-12T11:00:00');
      expect(concert.effectiveEnd).toBe('2027-03-12T11:30:00');
    });

    test('a setup buffer on the later event conflicts with the earlier event', async () => {
      await insertEvents(db, [
        published({ title: 'Earlier', start: '2027-03-13T10:00:00', end: '2027-03-13T11:00:00' }),
        published({
          title: 'Later',
          start: '2027-03-13T11:30:00',
          end: '2027-03-13T12:30:00',
          setupTimeMinutes: 45, // effective start 10:45
        }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].overlapStart).toBe('2027-03-13T10:45:00');
      expect(report.conflicts[0].overlapEnd).toBe('2027-03-13T11:00:00');
    });

    test('reservationStartMinutes takes precedence over setupTimeMinutes', async () => {
      // The fallback chain exists because legacy events do not all carry the
      // outer reservation bounds. When both are present the outer bound wins;
      // if the precedence were reversed this pair would not overlap.
      await insertEvents(db, [
        published({ title: 'Earlier', start: '2027-03-14T10:00:00', end: '2027-03-14T11:00:00' }),
        published({
          title: 'Later',
          start: '2027-03-14T12:00:00',
          end: '2027-03-14T13:00:00',
          setupTimeMinutes: 15, // would give 11:45 — no overlap
          reservationStartMinutes: 90, // wins — 10:30, overlaps
        }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].overlapStart).toBe('2027-03-14T10:30:00');
    });

    test('no overlap after buffers is still no conflict', async () => {
      await insertEvents(db, [
        published({
          title: 'Concert',
          start: '2027-03-15T10:00:00',
          end: '2027-03-15T11:00:00',
          teardownTimeMinutes: 10, // to 11:10
        }),
        published({ title: 'Study Group', start: '2027-03-15T11:15:00', end: '2027-03-15T12:00:00' }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });
  });

  describe('CR-10: an effective window crossing midnight', () => {
    test('collides with an event on the following day in the same room', async () => {
      // The crossing comes from the buffer, not the visible time: bucketing on
      // the effective START day alone would put these two in different buckets
      // and silently drop the pair.
      await insertEvents(db, [
        published({
          title: 'Late Rehearsal',
          start: '2027-03-20T23:00:00',
          end: '2027-03-20T23:45:00',
          teardownTimeMinutes: 60, // effective end 2027-03-21T00:45
        }),
        published({ title: 'Early Setup', start: '2027-03-21T00:00:00', end: '2027-03-21T01:00:00' }),
      ]);

      const report = await scan();

      expect(report.conflicts).toHaveLength(1);
      const [conflict] = report.conflicts;
      expect(conflict.date).toBe('2027-03-21');
      expect(conflict.overlapStart).toBe('2027-03-21T00:00:00');
      expect(conflict.overlapEnd).toBe('2027-03-21T00:45:00');
    });

    test('a pair meeting in two day-buckets is reported once', async () => {
      // Both effective windows straddle the same midnight, so both land in the
      // 03-22 and the 03-23 buckets. Without cross-bucket dedup this reports
      // twice.
      await insertEvents(db, [
        published({ title: 'Overnight A', start: '2027-03-22T22:00:00', end: '2027-03-23T02:00:00' }),
        published({ title: 'Overnight B', start: '2027-03-22T23:00:00', end: '2027-03-23T03:00:00' }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].date).toBe('2027-03-22');
    });
  });

  // -------------------------------------------------------------------------
  // Recurring occurrences
  // -------------------------------------------------------------------------

  describe('CR-7 / CR-8: a series contributes per-occurrence', () => {
    /** Every Wednesday 10:00-11:00 through the whole fixture window. */
    function weeklySeries(overrides = {}) {
      return createRecurringSeriesMaster({
        status: STATUS.PUBLISHED,
        eventTitle: 'Weekly Class',
        locations: [roomA._id],
        locationDisplayNames: ['Sanctuary'],
        startDateTime: new Date('2027-03-03T10:00:00'),
        endDateTime: new Date('2027-03-03T11:00:00'),
        calendarData: {
          eventTitle: 'Weekly Class',
          startDateTime: '2027-03-03T10:00:00',
          endDateTime: '2027-03-03T11:00:00',
          locations: [roomA._id],
          locationDisplayNames: ['Sanctuary'],
          categories: ['Meeting'],
        },
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2027-03-03', endDate: '2027-05-26' },
          additions: [],
          exclusions: [],
        },
        ...overrides,
      });
    }

    test('CR-7: only the colliding occurrences are reported, each naming its date', async () => {
      // The series runs every Wednesday. Three one-off events collide with
      // three of those Wednesdays. checkRoomConflicts() cannot express this —
      // it breaks on the first overlapping occurrence and calls the whole
      // series conflicted.
      const collisionDates = ['2027-03-10', '2027-04-07', '2027-05-12'];
      await insertEvents(db, [
        weeklySeries(),
        ...collisionDates.map((date) =>
          published({ title: `One-off ${date}`, start: `${date}T10:30:00`, end: `${date}T11:30:00` })
        ),
      ]);

      const report = await scan();

      expect(report.conflicts).toHaveLength(3);
      const reportedDates = report.conflicts.map((c) => c.date).sort();
      expect(reportedDates).toEqual(collisionDates);

      for (const conflict of report.conflicts) {
        const seriesSide = conflict.sides.find((s) => s.title === 'Weekly Class');
        expect(seriesSide.isOccurrence).toBe(true);
        expect(seriesSide.occurrenceDate).toBe(conflict.date);
      }
    });

    test('CR-8: a date in recurrence.exclusions produces no occurrence and no conflict', async () => {
      await insertEvents(db, [
        weeklySeries({
          recurrence: {
            pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' },
            range: { type: 'endDate', startDate: '2027-03-03', endDate: '2027-05-26' },
            additions: [],
            exclusions: ['2027-03-10'],
          },
        }),
        published({ title: 'One-off', start: '2027-03-10T10:30:00', end: '2027-03-10T11:30:00' }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });

    test('the series master is never matched by its stored date range', async () => {
      // The master's stored end is 2027-03-03T11:00. If masters were fetched by
      // date range instead of by eventType, the "encompassing" overlap case
      // would make any same-room event in the series span a phantom conflict.
      // This event shares the room on a Thursday, when the series never meets.
      await insertEvents(db, [
        weeklySeries(),
        published({ title: 'Thursday Event', start: '2027-03-11T10:30:00', end: '2027-03-11T11:30:00' }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });
  });

  describe('CR-9: an exception document replaces the master occurrence', () => {
    function seriesFor(exclusions = []) {
      return createRecurringSeriesMaster({
        status: STATUS.PUBLISHED,
        eventTitle: 'Weekly Class',
        locations: [roomA._id],
        locationDisplayNames: ['Sanctuary'],
        startDateTime: new Date('2027-03-03T10:00:00'),
        endDateTime: new Date('2027-03-03T11:00:00'),
        calendarData: {
          eventTitle: 'Weekly Class',
          startDateTime: '2027-03-03T10:00:00',
          endDateTime: '2027-03-03T11:00:00',
          locations: [roomA._id],
          locationDisplayNames: ['Sanctuary'],
          categories: ['Meeting'],
        },
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2027-03-03', endDate: '2027-05-26' },
          additions: [],
          exclusions,
        },
      });
    }

    test('the master occurrence is suppressed and the exception is evaluated in its place', async () => {
      // The exception moves 03-10 from 10:00 to 14:00. The one-off at 10:30
      // would collide with the master's original occurrence but must not,
      // because that occurrence no longer happens. The one-off at 14:30 must
      // collide with the exception.
      const master = seriesFor();
      const exception = createExceptionDocument(master, '2027-03-10', {
        startDateTime: '2027-03-10T14:00:00',
        endDateTime: '2027-03-10T15:00:00',
      });
      exception.status = STATUS.PUBLISHED;
      exception.eventTitle = 'Weekly Class (moved)';
      exception.calendarData = {
        ...exception.calendarData,
        eventTitle: 'Weekly Class (moved)',
        startDateTime: '2027-03-10T14:00:00',
        endDateTime: '2027-03-10T15:00:00',
        locations: [roomA._id],
        locationDisplayNames: ['Sanctuary'],
        categories: ['Meeting'],
      };

      await insertEvents(db, [
        master,
        exception,
        published({ title: 'Original Slot', start: '2027-03-10T10:30:00', end: '2027-03-10T11:30:00' }),
        published({ title: 'Moved Slot', start: '2027-03-10T14:30:00', end: '2027-03-10T15:30:00' }),
      ]);

      const report = await scan();

      expect(report.conflicts).toHaveLength(1);
      const titles = report.conflicts[0].sides.map((s) => s.title).sort();
      expect(titles).toEqual(['Moved Slot', 'Weekly Class (moved)']);
    });

    test('an exception that moved the occurrence outside the window still suppresses it', async () => {
      // The exception lands in July, past windowEnd, so read 1 never returns
      // it. Read 3 exists precisely for this: without it the master's 03-10
      // occurrence would still be expanded and would conflict with an event
      // that in reality has the room to itself.
      const master = seriesFor();
      const exception = createExceptionDocument(master, '2027-03-10', {
        startDateTime: '2027-07-14T10:00:00',
        endDateTime: '2027-07-14T11:00:00',
      });
      exception.status = STATUS.PUBLISHED;
      exception.calendarData = {
        ...exception.calendarData,
        startDateTime: '2027-07-14T10:00:00',
        endDateTime: '2027-07-14T11:00:00',
        locations: [roomA._id],
        locationDisplayNames: ['Sanctuary'],
        categories: ['Meeting'],
      };

      await insertEvents(db, [
        master,
        exception,
        published({ title: 'Original Slot', start: '2027-03-10T10:30:00', end: '2027-03-10T11:30:00' }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Pairs, permitted overlaps, scoping, caps, degradation
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Hold events
  // -------------------------------------------------------------------------

  describe('CR-17: a Hold occupies its reservation window, not the whole day', () => {
    /**
     * A Hold is a room block with no scheduled event inside it — the system
     * identifies one as `!startTime && !endTime && (reservationStartTime ||
     * reservationEndTime)`. Because it has no event times, its stored
     * startDateTime/endDateTime are a WHOLE-DAY placeholder (00:00-23:59); the
     * real occupancy lives in reservationStartTime/reservationEndTime.
     * api-server.js does this same substitution when building the Graph event
     * (~6176), for exactly the same reason.
     *
     * Reading the stored datetimes instead makes every Hold block its room for
     * 24 hours and collide with everything in it — and the row renders
     * "12:00 AM - 12:00 AM", so the reader cannot even see why.
     */
    function hold(overrides = {}) {
      const { date = '2027-05-15', resStart = '13:00', resEnd = '16:00', ...rest } = overrides;
      return createPublishedEvent({
        eventTitle: 'Hold',
        startDateTime: new Date(`${date}T00:00:00`),
        endDateTime: new Date(`${date}T23:59:00`),
        locations: [roomA._id],
        locationDisplayNames: ['Sanctuary'],
        categories: ['Meeting'],
        calendarData: {
          eventTitle: 'Hold',
          startDateTime: `${date}T00:00:00`,
          endDateTime: `${date}T23:59:00`,
          startDate: date,
          endDate: date,
          startTime: '',
          endTime: '',
          reservationStartTime: resStart,
          reservationEndTime: resEnd,
          locations: [roomA._id],
          locationDisplayNames: ['Sanctuary'],
          categories: ['Meeting'],
        },
        ...rest,
      });
    }

    test('does not conflict with an event outside its reservation window', async () => {
      await insertEvents(db, [
        hold(),
        published({ title: 'Morning Class', start: '2027-05-15T08:30:00', end: '2027-05-15T11:15:00' }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });

    test('does conflict with an event inside its reservation window', async () => {
      // The control for the case above: if the Hold were simply being dropped,
      // this would also report zero and the fix would be a silencer.
      await insertEvents(db, [
        hold(),
        published({ title: 'Afternoon Class', start: '2027-05-15T14:00:00', end: '2027-05-15T15:00:00' }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].overlapStart).toBe('2027-05-15T14:00:00');
      expect(report.conflicts[0].overlapEnd).toBe('2027-05-15T15:00:00');
    });

    test('reports its reservation times as its own times, not midnight to midnight', async () => {
      await insertEvents(db, [
        hold(),
        published({ title: 'Afternoon Class', start: '2027-05-15T14:00:00', end: '2027-05-15T15:00:00' }),
      ]);

      const report = await scan();
      const holdSide = report.conflicts[0].sides.find((s) => s.title === 'Hold');
      expect(holdSide.startDateTime).toBe('2027-05-15T13:00:00');
      expect(holdSide.endDateTime).toBe('2027-05-15T16:00:00');
      expect(holdSide.isHold).toBe(true);
    });

    test('an occurrence of a recurring Hold uses the reservation window on its own date', async () => {
      // Expansion builds occurrence times from the master's stored datetimes,
      // which for a Hold are the whole-day placeholder. Without the same
      // substitution, every occurrence of a recurring Hold blocks its room all
      // day, on every date in the series.
      const master = createRecurringSeriesMaster({
        status: STATUS.PUBLISHED,
        eventTitle: 'Weekly Hold',
        locations: [roomA._id],
        locationDisplayNames: ['Sanctuary'],
        startDateTime: new Date('2027-05-05T00:00:00'),
        endDateTime: new Date('2027-05-05T23:59:00'),
        calendarData: {
          eventTitle: 'Weekly Hold',
          startDateTime: '2027-05-05T00:00:00',
          endDateTime: '2027-05-05T23:59:00',
          startDate: '2027-05-05',
          endDate: '2027-05-05',
          startTime: '',
          endTime: '',
          reservationStartTime: '13:00',
          reservationEndTime: '16:00',
          locations: [roomA._id],
          locationDisplayNames: ['Sanctuary'],
          categories: ['Meeting'],
        },
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2027-05-05', endDate: '2027-05-26' },
          additions: [],
          exclusions: [],
        },
      });

      await insertEvents(db, [
        master,
        published({ title: 'Morning Class', start: '2027-05-12T08:30:00', end: '2027-05-12T11:15:00' }),
        published({ title: 'Afternoon Class', start: '2027-05-19T14:00:00', end: '2027-05-19T15:00:00' }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].date).toBe('2027-05-19');
    });
  });

  describe('CR-14: three or more overlapping events report as pairs (D10)', () => {
    test('reports A/B and B/C with their own intervals, and nothing between A and C', async () => {
      // A merged "3-way conflict" row cannot state a truthful contested
      // interval: A/B contest 11:00-12:00 while B/C contest 13:00-14:00, and A
      // and C never share the room at all.
      await insertEvents(db, [
        published({ title: 'A', start: '2027-04-05T10:00:00', end: '2027-04-05T12:00:00' }),
        published({ title: 'B', start: '2027-04-05T11:00:00', end: '2027-04-05T14:00:00' }),
        published({ title: 'C', start: '2027-04-05T13:00:00', end: '2027-04-05T15:00:00' }),
      ]);

      const report = await scan();

      expect(report.conflicts).toHaveLength(2);
      const pairs = report.conflicts.map((c) => c.sides.map((s) => s.title).sort().join('/')).sort();
      expect(pairs).toEqual(['A/B', 'B/C']);

      const ab = report.conflicts.find((c) => c.sides.some((s) => s.title === 'A'));
      expect(ab.overlapStart).toBe('2027-04-05T11:00:00');
      expect(ab.overlapEnd).toBe('2027-04-05T12:00:00');

      const bc = report.conflicts.find((c) => c.sides.some((s) => s.title === 'C'));
      expect(bc.overlapStart).toBe('2027-04-05T13:00:00');
      expect(bc.overlapEnd).toBe('2027-04-05T14:00:00');
    });
  });

  describe('CR-5 / CR-6: overlaps the concurrency rules permit are excluded', () => {
    const worshipId = new ObjectId();
    const meetingId = new ObjectId();

    /** A's category grants B's. */
    const grantingMap = () =>
      new Map([
        ['Worship', { _id: worshipId, name: 'Worship', allowedConcurrentCategories: [meetingId] }],
        ['Meeting', { _id: meetingId, name: 'Meeting', allowedConcurrentCategories: [] }],
      ]);

    /** B's category grants A's — the reverse direction. */
    const reverseGrantingMap = () =>
      new Map([
        ['Worship', { _id: worshipId, name: 'Worship', allowedConcurrentCategories: [] }],
        ['Meeting', { _id: meetingId, name: 'Meeting', allowedConcurrentCategories: [worshipId] }],
      ]);

    const noGrantMap = () =>
      new Map([
        ['Worship', { _id: worshipId, name: 'Worship', allowedConcurrentCategories: [] }],
        ['Meeting', { _id: meetingId, name: 'Meeting', allowedConcurrentCategories: [] }],
      ]);

    async function insertOverlappingPair() {
      await insertEvents(db, [
        published({
          title: 'Service',
          start: '2027-04-10T10:00:00',
          end: '2027-04-10T12:00:00',
          categories: ['Worship'],
        }),
        published({
          title: 'Committee',
          start: '2027-04-10T11:00:00',
          end: '2027-04-10T13:00:00',
          categories: ['Meeting'],
        }),
      ]);
    }

    test('CR-5: a category grant in either direction suppresses the conflict', async () => {
      await insertOverlappingPair();

      // Control: without a grant the pair IS a conflict, so the two assertions
      // below are testing the grant and not a broken fixture.
      expect((await scan({ categoryMap: noGrantMap() })).conflicts).toHaveLength(1);

      expect((await scan({ categoryMap: grantingMap() })).conflicts).toHaveLength(0);
      expect((await scan({ categoryMap: reverseGrantingMap() })).conflicts).toHaveLength(0);
    });

    test('CR-5: a suppressed overlap is not counted either', async () => {
      await insertOverlappingPair();

      const report = await scan({ categoryMap: grantingMap() });
      expect(report.conflictCount).toBe(0);
      expect(report.groups).toHaveLength(0);
    });

    test('CR-6: a per-event concurrency flag suppresses the conflict', async () => {
      await insertEvents(db, [
        published({ title: 'Open Rehearsal', start: '2027-04-11T10:00:00', end: '2027-04-11T12:00:00' }),
        published({
          title: 'Shared Study',
          start: '2027-04-11T11:00:00',
          end: '2027-04-11T13:00:00',
          isAllowedConcurrent: true,
          allowedConcurrentCategories: [],
        }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });
  });

  describe('CR-12: results are scoped to a calendar', () => {
    const otherOwner = 'otherroom@emanuelnyc.org';

    test('the calendar filter scopes the scan', async () => {
      await insertEvents(db, [
        published({ title: 'Default A', start: '2027-04-20T10:00:00', end: '2027-04-20T12:00:00' }),
        published({ title: 'Default B', start: '2027-04-20T11:00:00', end: '2027-04-20T13:00:00' }),
        published({
          title: 'Other A',
          start: '2027-04-21T10:00:00',
          end: '2027-04-21T12:00:00',
          calendarOwner: otherOwner,
        }),
        published({
          title: 'Other B',
          start: '2027-04-21T11:00:00',
          end: '2027-04-21T13:00:00',
          calendarOwner: otherOwner,
        }),
      ]);

      // Unscoped sees both collisions.
      expect((await scan()).conflicts).toHaveLength(2);

      const scoped = await scan({ calendarOwner: otherOwner });
      expect(scoped.conflicts).toHaveLength(1);
      expect(scoped.conflicts[0].date).toBe('2027-04-21');
      expect(scoped.calendarOwner).toBe(otherOwner);
    });

    test('CR-12b: two events in DIFFERENT calendars never conflict, even unfiltered', async () => {
      // The scan compares within one calendar owner. Cross-mailbox room
      // collisions are a known, accepted blind spot (D6) — a room is a physical
      // object, so this IS a real double-booking, but no check in the system
      // can see it and this report does not change that.
      //
      // The failure this pins is not theoretical: the same event synced into
      // two mailboxes produces two documents with identical title, time, room
      // and requester. Comparing across owners reports every one of them as a
      // conflict with itself, which buries the genuine findings in noise and
      // makes the report read as broken on first contact.
      await insertEvents(db, [
        published({ title: 'Summer Torah Study', start: '2027-04-22T09:00:00', end: '2027-04-22T10:00:00' }),
        published({
          title: 'Summer Torah Study',
          start: '2027-04-22T09:00:00',
          end: '2027-04-22T10:00:00',
          calendarOwner: otherOwner,
        }),
      ]);

      expect((await scan()).conflicts).toHaveLength(0);
    });

    test('CR-12c: calendar owner comparison is case-insensitive', async () => {
      // calendarOwner is lowercased on write in some paths and not others.
      // Bucketing on the raw string would split one mailbox into two and hide
      // a genuine same-calendar conflict.
      await insertEvents(db, [
        published({
          title: 'A',
          start: '2027-04-23T09:00:00',
          end: '2027-04-23T11:00:00',
          calendarOwner: 'Mixed@Emanuelnyc.org',
        }),
        published({
          title: 'B',
          start: '2027-04-23T10:00:00',
          end: '2027-04-23T12:00:00',
          calendarOwner: 'mixed@emanuelnyc.org',
        }),
      ]);

      expect((await scan()).conflicts).toHaveLength(1);
    });

    test('CR-12d: each side reports which calendar it belongs to', async () => {
      // Without this the view cannot tell a genuine duplicate from two copies
      // of one event living in different mailboxes — every other field on the
      // two rows is identical.
      await insertEvents(db, [
        published({ title: 'A', start: '2027-04-24T09:00:00', end: '2027-04-24T11:00:00' }),
        published({ title: 'B', start: '2027-04-24T10:00:00', end: '2027-04-24T12:00:00' }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(1);
      for (const s of report.conflicts[0].sides) {
        expect(typeof s.calendarOwner).toBe('string');
        expect(s.calendarOwner.length).toBeGreaterThan(0);
      }
    });

    test('CR-12e: with no filter, only the allowed display calendars are scanned', async () => {
      // "All calendars" must mean "every calendar this app shows", not "every
      // calendarOwner that happens to exist in the collection". Sandbox and
      // other non-display mailboxes live in the same collection; scanning them
      // reports conflicts in calendars nobody can open, from a picker that does
      // not even offer them.
      await insertEvents(db, [
        published({ title: 'Sandbox A', start: '2027-04-26T09:00:00', end: '2027-04-26T11:00:00', calendarOwner: 'sandbox@emanuelnyc.org' }),
        published({ title: 'Sandbox B', start: '2027-04-26T10:00:00', end: '2027-04-26T12:00:00', calendarOwner: 'sandbox@emanuelnyc.org' }),
        published({ title: 'Allowed A', start: '2027-04-27T09:00:00', end: '2027-04-27T11:00:00', calendarOwner: 'allowed@emanuelnyc.org' }),
        published({ title: 'Allowed B', start: '2027-04-27T10:00:00', end: '2027-04-27T12:00:00', calendarOwner: 'allowed@emanuelnyc.org' }),
      ]);

      const report = await scan({ allowedCalendarOwners: ['Allowed@Emanuelnyc.org'] });

      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].date).toBe('2027-04-27');
    });

    test('CR-12f: an empty allowlist is disclosed, not reported as a clean calendar', async () => {
      // No configured calendars means nothing was scanned. Rendering that as
      // "no conflicts found" is the false all-clear D9 exists to prevent.
      await insertEvents(db, [
        published({ title: 'A', start: '2027-04-28T09:00:00', end: '2027-04-28T11:00:00' }),
        published({ title: 'B', start: '2027-04-28T10:00:00', end: '2027-04-28T12:00:00' }),
      ]);

      const report = await scan({ allowedCalendarOwners: [] });

      expect(report.conflicts).toHaveLength(0);
      expect(report.degraded).toEqual([expect.objectContaining({ stage: 'calendars' })]);
    });

    test('an unknown calendar returns an empty result rather than an error', async () => {
      await insertEvents(db, [
        published({ title: 'Default A', start: '2027-04-20T10:00:00', end: '2027-04-20T12:00:00' }),
        published({ title: 'Default B', start: '2027-04-20T11:00:00', end: '2027-04-20T13:00:00' }),
      ]);

      const report = await scan({ calendarOwner: 'nobody@emanuelnyc.org' });
      expect(report.conflicts).toHaveLength(0);
      expect(report.degraded).toHaveLength(0);
    });
  });

  describe('CR-15: an incomplete scan never reports a clean calendar (D9)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('a partial read failure is disclosed alongside the results obtained', async () => {
      await insertEvents(db, [
        published({ title: 'A', start: '2027-04-25T10:00:00', end: '2027-04-25T12:00:00' }),
        published({ title: 'B', start: '2027-04-25T11:00:00', end: '2027-04-25T13:00:00' }),
      ]);

      // Fail only the series-master read. The single-instance collision above
      // must still be reported, AND the response must say it is incomplete.
      const realFind = Collection.prototype.find;
      jest.spyOn(Collection.prototype, 'find').mockImplementation(function patched(query, ...rest) {
        if (query?.eventType === 'seriesMaster') {
          return { project: () => ({ toArray: () => Promise.reject(new Error('injected master read failure')) }) };
        }
        return realFind.call(this, query, ...rest);
      });

      const report = await scan();

      expect(report.conflicts).toHaveLength(1);
      expect(report.degraded).toEqual([
        expect.objectContaining({ stage: 'seriesMasters' }),
      ]);
    });

    test('a degraded scan finding nothing is marked incomplete, not clean', async () => {
      const realFind = Collection.prototype.find;
      jest.spyOn(Collection.prototype, 'find').mockImplementation(function patched(query, ...rest) {
        if (query?.eventType === 'seriesMaster') {
          return { project: () => ({ toArray: () => Promise.reject(new Error('injected master read failure')) }) };
        }
        return realFind.call(this, query, ...rest);
      });

      const report = await scan();

      // A false all-clear on a defect list is worse than an error: the approver
      // leaves believing the calendar is clean.
      expect(report.conflicts).toHaveLength(0);
      expect(report.degraded.length).toBeGreaterThan(0);
    });

    test('a total read failure throws rather than returning an empty list', async () => {
      jest.spyOn(Collection.prototype, 'find').mockImplementation(() => ({
        project: () => ({ toArray: () => Promise.reject(new Error('injected total failure')) }),
      }));

      await expect(scan()).rejects.toThrow(/could not read any events/i);
    });
  });

  describe('CR-16: scan volume is capped and disclosed', () => {
    test('the response is not marked truncated within the cap', async () => {
      await insertEvents(db, [
        published({ title: 'A', start: '2027-05-05T10:00:00', end: '2027-05-05T12:00:00' }),
        published({ title: 'B', start: '2027-05-05T11:00:00', end: '2027-05-05T13:00:00' }),
      ]);

      const report = await scan();
      expect(report.truncated).toBe(false);
      expect(report.occurrenceCount).toBe(2);
    });

    test('exceeding the cap sets truncated', async () => {
      await insertEvents(db, [
        published({ title: 'A', start: '2027-05-05T10:00:00', end: '2027-05-05T12:00:00' }),
        published({ title: 'B', start: '2027-05-05T11:00:00', end: '2027-05-05T13:00:00' }),
        published({ title: 'C', start: '2027-05-05T11:30:00', end: '2027-05-05T13:30:00' }),
      ]);

      // Drive the cap rather than inserting 20,000 documents — the behavior
      // under test is "stop and say so", not the constant's value.
      const report = await scan({ maxOccurrences: 2 });
      expect(report.truncated).toBe(true);
      expect(report.occurrenceCount).toBe(2);
    });
  });

  describe('grouping and stable identity', () => {
    test('conflicts are ordered by date, then room, then start time', async () => {
      await insertEvents(db, [
        // Later date, earlier alphabetically by room.
        published({ title: 'D1', start: '2027-05-20T10:00:00', end: '2027-05-20T12:00:00' }),
        published({ title: 'D2', start: '2027-05-20T11:00:00', end: '2027-05-20T13:00:00' }),
        // Earlier date, Chapel (sorts before Sanctuary), two separate times.
        published({
          title: 'C1',
          start: '2027-05-10T14:00:00',
          end: '2027-05-10T16:00:00',
          rooms: [roomB._id],
          roomNames: ['Chapel'],
        }),
        published({
          title: 'C2',
          start: '2027-05-10T15:00:00',
          end: '2027-05-10T17:00:00',
          rooms: [roomB._id],
          roomNames: ['Chapel'],
        }),
        published({ title: 'S1', start: '2027-05-10T09:00:00', end: '2027-05-10T11:00:00' }),
        published({ title: 'S2', start: '2027-05-10T10:00:00', end: '2027-05-10T12:00:00' }),
      ]);

      const report = await scan();
      expect(report.conflicts).toHaveLength(3);

      expect(report.conflicts.map((c) => [c.date, c.roomName])).toEqual([
        ['2027-05-10', 'Chapel'],
        ['2027-05-10', 'Sanctuary'],
        ['2027-05-20', 'Sanctuary'],
      ]);

      // The nested grouping mirrors the flat order.
      expect(report.groups.map((g) => g.date)).toEqual(['2027-05-10', '2027-05-20']);
      expect(report.groups[0].rooms.map((r) => r.roomName)).toEqual(['Chapel', 'Sanctuary']);
    });

    test('the same scan run twice produces the same keys', async () => {
      await insertEvents(db, [
        published({ title: 'A', start: '2027-05-25T10:00:00', end: '2027-05-25T12:00:00' }),
        published({ title: 'B', start: '2027-05-25T11:00:00', end: '2027-05-25T13:00:00' }),
      ]);

      const first = await scan();
      const second = await scan();
      expect(first.conflicts.map((c) => c.key)).toEqual(second.conflicts.map((c) => c.key));
    });

    test('CR-13-side: a side with no requester carries null so the view can label it Outlook-synced', async () => {
      await insertEvents(db, [
        published({ title: 'Reserved', start: '2027-05-26T10:00:00', end: '2027-05-26T12:00:00' }),
        published({
          title: 'Synced',
          start: '2027-05-26T11:00:00',
          end: '2027-05-26T13:00:00',
          roomReservationData: null,
        }),
      ]);

      const report = await scan();
      const synced = report.conflicts[0].sides.find((s) => s.title === 'Synced');
      const reserved = report.conflicts[0].sides.find((s) => s.title === 'Reserved');
      expect(synced.requesterName).toBeNull();
      expect(reserved.requesterName).toBe('Test Requester');
    });
  });

  // -------------------------------------------------------------------------
  // The endpoint
  // -------------------------------------------------------------------------

  describe('CR-13: GET /api/admin/reports/conflicts', () => {
    const ENDPOINT = '/api/admin/reports/conflicts';

    test('a requester is refused with 403', async () => {
      const res = await request(app).get(ENDPOINT).set('Authorization', `Bearer ${requesterToken}`);
      expect(res.status).toBe(403);
      expect(res.body.conflicts).toBeUndefined();
    });

    test('an unauthenticated request is refused', async () => {
      const res = await request(app).get(ENDPOINT);
      expect([401, 403]).toContain(res.status);
    });

    test('an approver gets 200', async () => {
      const res = await request(app).get(ENDPOINT).set('Authorization', `Bearer ${approverToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.conflicts)).toBe(true);
    });

    test('an administrator gets 200', async () => {
      const res = await request(app).get(ENDPOINT).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });

    test('the default window is 90 days starting today', async () => {
      const res = await request(app).get(ENDPOINT).set('Authorization', `Bearer ${approverToken}`);
      expect(res.status).toBe(200);
      expect(res.body.window.days).toBe(90);

      const start = new Date(`${res.body.window.startDate}T00:00:00`);
      const end = new Date(`${res.body.window.endDate}T00:00:00`);
      const spanDays = Math.round((end - start) / (24 * 60 * 60 * 1000));
      expect(spanDays).toBe(90);

      // Always today, never a caller-supplied start (D5: forward-only).
      const today = new Date();
      const pad2 = (n) => String(n).padStart(2, '0');
      const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
      expect(res.body.window.startDate).toBe(todayKey);
    });

    test.each([30, 90, 180, 365])('a %d-day window is accepted', async (days) => {
      const res = await request(app)
        .get(`${ENDPOINT}?days=${days}`)
        .set('Authorization', `Bearer ${approverToken}`);
      expect(res.status).toBe(200);
      expect(res.body.window.days).toBe(days);
    });

    test.each(['45', '0', '-30', 'abc', '90.5'])(
      'a window of %p is rejected with 400 rather than clamped',
      async (days) => {
        // A silently clamped window would make the report misstate its own
        // coverage — an approver would believe a year was scanned when 90 days
        // were.
        const res = await request(app)
          .get(`${ENDPOINT}?days=${days}`)
          .set('Authorization', `Bearer ${approverToken}`);
        expect(res.status).toBe(400);
        expect(res.body.conflicts).toBeUndefined();
      }
    );

    test('the calendar filter is passed through', async () => {
      const res = await request(app)
        .get(`${ENDPOINT}?calendarOwner=Other@Emanuelnyc.org`)
        .set('Authorization', `Bearer ${approverToken}`);
      expect(res.status).toBe(200);
      expect(res.body.calendarOwner).toBe('other@emanuelnyc.org');
    });

    test('the response carries a generated-at stamp', async () => {
      const res = await request(app).get(ENDPOINT).set('Authorization', `Bearer ${approverToken}`);
      expect(Number.isNaN(Date.parse(res.body.generatedAt))).toBe(false);
    });

    test('CR-13-writes: the scan writes nothing', async () => {
      // Read-only is a load-bearing property (D4): it is why the change adds no
      // collection, no schema field, and no concurrency concern.
      await insertEvents(db, [
        published({ title: 'A', start: '2027-05-30T10:00:00', end: '2027-05-30T12:00:00' }),
        published({ title: 'B', start: '2027-05-30T11:00:00', end: '2027-05-30T13:00:00' }),
      ]);

      const before = await db.collection(COLLECTIONS.EVENTS).find({}).toArray();
      const auditBefore = await db.collection(COLLECTIONS.AUDIT_HISTORY).countDocuments({});

      const res = await request(app)
        .get(`${ENDPOINT}?days=365`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      const after = await db.collection(COLLECTIONS.EVENTS).find({}).toArray();
      const auditAfter = await db.collection(COLLECTIONS.AUDIT_HISTORY).countDocuments({});

      expect(after).toEqual(before);
      expect(auditAfter).toBe(auditBefore);
      // No status history was appended to any event either.
      expect(after.map((e) => (e.statusHistory || []).length)).toEqual(
        before.map((e) => (e.statusHistory || []).length)
      );
    });
  });
});
