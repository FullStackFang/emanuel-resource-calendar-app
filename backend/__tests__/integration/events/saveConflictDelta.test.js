/**
 * Save Conflict Delta Gate — integration tests (SCG-1..SCG-7, SCG-13)
 *
 * A save is blocked only by hard conflicts it INTRODUCES, never by ones the
 * stored event already carries. Publish/approve/restore keep whole-state.
 * See openspec/changes/save-conflict-delta-gate.
 *
 * SCG-8..SCG-12 (occurrence thisEvent paths) live further down once those
 * branches are wired. SCG-1..SCG-6 + SCG-13 cover the general admin path;
 * the owner-edit general/resubmit cases are appended for task 5.
 *
 * Uses createAppForTest (the real api-server), NOT testApp.js — see memory
 * two-backend-test-harnesses.
 */

const request = require('supertest');
const { ObjectId, Collection } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createApprover,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createRejectedEvent,
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

// Count only the checkRoomConflicts main queries: each invocation issues
// exactly one find({ $and: [...] }). Other finds in the endpoint (by _id,
// series masters, exception dates) do not use a top-level $and, so this
// isolates "how many conflict batches ran".
function spyConflictQueries() {
  const seen = [];
  const orig = Collection.prototype.find;
  const spy = jest.spyOn(Collection.prototype, 'find').mockImplementation(function (query, ...rest) {
    if (query && Array.isArray(query.$and)) seen.push(query);
    return orig.call(this, query, ...rest);
  });
  return { spy, count: () => seen.length, restore: () => spy.mockRestore() };
}

describe('Save Conflict Delta Gate (SCG-1..7, SCG-13)', () => {
  let mongoClient, db, app;
  let approverUser, adminUser, requesterUser;
  let approverToken, adminToken, requesterToken;

  const roomA = new ObjectId();
  const roomB = new ObjectId();
  const roomC = new ObjectId();

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('saveConflictDelta'));

    // Seed rooms so the write-path location resolution finds them.
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([
      { _id: roomA, displayName: 'Room A', isReservable: true, status: 'approved' },
      { _id: roomB, displayName: 'Room B', isReservable: true, status: 'approved' },
      { _id: roomC, displayName: 'Room C', isReservable: true, status: 'approved' },
    ]);

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

    approverUser = createApprover();
    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, adminUser, requesterUser]);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // A published single blocker helper.
  function blocker(title, start, end, rooms) {
    return createPublishedEvent({
      eventTitle: title,
      startDateTime: new Date(start),
      endDateTime: new Date(end),
      locations: rooms,
      locationDisplayNames: rooms.map(() => 'Room'),
    });
  }

  // ── SCG-1: removing the colliding room saves (approver) ───────────────────
  describe('SCG-1: removing the colliding room saves', () => {
    it('lets an approver save a pending event with the colliding room dropped', async () => {
      const block = blocker('Blocker A', '2026-05-20T10:00:00', '2026-05-20T11:00:00', [roomA]);
      const pending = createPendingEvent({
        eventTitle: 'Pending In A',
        startDateTime: new Date('2026-05-20T10:00:00'),
        endDateTime: new Date('2026-05-20T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [block, pending]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(pending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ locations: [roomB.toString()] }); // drop A, move to free B

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('carries an unrelated collision (baseline runs, still 200)', async () => {
      // Pending books A and B; a blocker sits in B. The save drops A (which has
      // no blocker) but keeps B — the B collision is carried, not introduced.
      const blockB = blocker('Blocker B', '2026-05-21T10:00:00', '2026-05-21T11:00:00', [roomB]);
      const pending = createPendingEvent({
        eventTitle: 'Pending In A+B',
        startDateTime: new Date('2026-05-21T10:00:00'),
        endDateTime: new Date('2026-05-21T11:00:00'),
        locations: [roomA, roomB],
        locationDisplayNames: ['Room A', 'Room B'],
      });
      await insertEvents(db, [blockB, pending]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(pending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ locations: [roomB.toString()] }); // keep B (still collides), drop A

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── SCG-2: introducing a collision is blocked (deltaGate) ─────────────────
  describe('SCG-2: introducing a collision is blocked', () => {
    it('returns 409 deltaGate with only the introduced conflict', async () => {
      const blockY = blocker('Blocker Y', '2026-05-22T14:00:00', '2026-05-22T16:00:00', [roomA]);
      const pending = createPendingEvent({
        eventTitle: 'Clean Pending',
        startDateTime: new Date('2026-05-22T10:00:00'),
        endDateTime: new Date('2026-05-22T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [blockY, pending]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(pending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ startDateTime: '2026-05-22T14:30:00', endDateTime: '2026-05-22T15:30:00' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.deltaGate).toBe(true);
      expect(res.body.hardConflicts).toHaveLength(1);
      expect(res.body.hardConflicts[0].eventTitle).toBe('Blocker Y');
      expect(res.body.preexistingConflicts).toEqual([]);
      // approver cannot force
      expect(res.body.canForce).toBe(true); // admin path advertises force; owner path sets false
    });
  });

  // ── SCG-3: same weekly master, different occurrence, is new (locks D1) ─────
  describe('SCG-3: same master, different occurrence, is introduced', () => {
    it('returns 409 when moved to a different Monday that hits another occurrence', async () => {
      // Published weekly Tuesday master in room A, 10:00-11:00.
      const master = createRecurringSeriesMaster({
        status: STATUS.PUBLISHED,
        eventTitle: 'Weekly Master',
        startDateTime: new Date('2026-03-10T10:00:00'),
        endDateTime: new Date('2026-03-10T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
        calendarData: {
          eventTitle: 'Weekly Master',
          startDateTime: '2026-03-10T10:00:00',
          endDateTime: '2026-03-10T11:00:00',
          locations: [roomA],
          locationDisplayNames: ['Room A'],
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
      // Pending single collides with the 3/17 occurrence.
      const pending = createPendingEvent({
        eventTitle: 'Single vs Master',
        startDateTime: new Date('2026-03-17T10:30:00'),
        endDateTime: new Date('2026-03-17T11:30:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [master, pending]);

      // Move to 3/24 (a different Tuesday occurrence of the same master, same room).
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(pending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ startDateTime: '2026-03-24T10:30:00', endDateTime: '2026-03-24T11:30:00' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.deltaGate).toBe(true);
      expect(res.body.hardConflicts.length).toBeGreaterThanOrEqual(1);
      expect(res.body.hardConflicts[0].eventTitle).toBe('Weekly Master');
    });
  });

  // ── SCG-4: recurring — drop the colliding room saves ──────────────────────
  describe('SCG-4: recurring save dropping the colliding room', () => {
    it('returns 200 when the changed series no longer books the colliding room', async () => {
      const blockA = blocker('Blocker On A', '2026-03-10T10:00:00', '2026-03-10T11:00:00', [roomA]);
      const master = createRecurringSeriesMaster({
        status: STATUS.PENDING,
        eventTitle: 'Pending Series In A',
        startDateTime: new Date('2026-03-10T10:00:00'),
        endDateTime: new Date('2026-03-10T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
        calendarData: {
          eventTitle: 'Pending Series In A',
          startDateTime: '2026-03-10T10:00:00',
          endDateTime: '2026-03-10T11:00:00',
          locations: [roomA],
          locationDisplayNames: ['Room A'],
          categories: ['Meeting'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
        },
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-03-17' },
          additions: [],
          exclusions: [],
        },
      });
      await insertEvents(db, [blockA, master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ locations: [roomB.toString()] }); // move series off A

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── SCG-5: recurring — introduce collisions on 2 of N occurrences ─────────
  describe('SCG-5: recurring save introducing collisions on 2 dates', () => {
    it('returns 409 with conflictingOccurrences 2', async () => {
      // Two blockers in room A on 3/10 and 3/17.
      const block1 = blocker('Blk 3/10', '2026-03-10T10:00:00', '2026-03-10T11:00:00', [roomA]);
      const block2 = blocker('Blk 3/17', '2026-03-17T10:00:00', '2026-03-17T11:00:00', [roomA]);
      // Stored series in room B (clean), 2 Tuesday occurrences.
      const master = createRecurringSeriesMaster({
        status: STATUS.PENDING,
        eventTitle: 'Pending Series In B',
        startDateTime: new Date('2026-03-10T10:00:00'),
        endDateTime: new Date('2026-03-10T11:00:00'),
        locations: [roomB],
        locationDisplayNames: ['Room B'],
        calendarData: {
          eventTitle: 'Pending Series In B',
          startDateTime: '2026-03-10T10:00:00',
          endDateTime: '2026-03-10T11:00:00',
          locations: [roomB],
          locationDisplayNames: ['Room B'],
          categories: ['Meeting'],
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
        },
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-03-17' },
          additions: [],
          exclusions: [],
        },
      });
      await insertEvents(db, [block1, block2, master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ locations: [roomA.toString()] }); // move series onto A → collides both weeks

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.deltaGate).toBe(true);
      expect(res.body.recurringConflicts.conflictingOccurrences).toBe(2);
    });
  });

  // ── SCG-6: extending an existing overlap with a non-recurring neighbour ────
  describe('SCG-6: extending an existing overlap saves (extent not keyed)', () => {
    it('returns 200 when the window grows over the same neighbour/room', async () => {
      const blockX = blocker('Neighbour X', '2026-05-23T10:30:00', '2026-05-23T12:00:00', [roomA]);
      // Stored pending already overlaps X (10:00-11:00 vs 10:30-12:00).
      const pending = createPendingEvent({
        eventTitle: 'Already Overlapping',
        startDateTime: new Date('2026-05-23T10:00:00'),
        endDateTime: new Date('2026-05-23T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [blockX, pending]);

      // Extend to 10:00-13:00 — swallows X entirely; still room A, still X.
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(pending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ endDateTime: '2026-05-23T13:00:00' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── SCG-7: a clean save costs one conflict batch, not two ─────────────────
  describe('SCG-7: clean save runs the baseline check zero times', () => {
    it('issues one $and conflict query for a clean save, two for a conflicting one', async () => {
      const blockY = blocker('Blocker Y7', '2026-05-24T14:00:00', '2026-05-24T15:00:00', [roomA]);
      const cleanPending = createPendingEvent({
        eventTitle: 'Clean Move',
        startDateTime: new Date('2026-05-24T10:00:00'),
        endDateTime: new Date('2026-05-24T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [blockY, cleanPending]);

      // Clean save: move to a free slot → proposed clean → baseline skipped.
      let probe = spyConflictQueries();
      const cleanRes = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(cleanPending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ startDateTime: '2026-05-24T18:00:00', endDateTime: '2026-05-24T19:00:00' });
      const cleanCount = probe.count();
      probe.restore();
      expect(cleanRes.status).toBe(200);
      expect(cleanCount).toBe(1); // proposed only, no baseline

      // Conflicting save: move into the blocker → proposed non-empty → baseline runs.
      const conflictPending = createPendingEvent({
        eventTitle: 'Into Conflict',
        startDateTime: new Date('2026-05-24T09:00:00'),
        endDateTime: new Date('2026-05-24T09:30:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [conflictPending]);
      probe = spyConflictQueries();
      const conflictRes = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(conflictPending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ startDateTime: '2026-05-24T14:15:00', endDateTime: '2026-05-24T14:45:00' });
      const conflictCount = probe.count();
      probe.restore();
      expect(conflictRes.status).toBe(409);
      expect(conflictCount).toBe(2); // proposed + baseline
    });
  });

  // ── SCG-13: stale _version is answered before any conflict query ──────────
  describe('SCG-13: stale _version yields VERSION_CONFLICT, no conflict query', () => {
    it('returns VERSION_CONFLICT and issues zero conflict queries', async () => {
      const blockY = blocker('Blocker Y13', '2026-05-25T14:00:00', '2026-05-25T15:00:00', [roomA]);
      const pending = createPendingEvent({
        eventTitle: 'Stale Save',
        startDateTime: new Date('2026-05-25T10:00:00'),
        endDateTime: new Date('2026-05-25T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
        _version: 3,
      });
      await insertEvents(db, [blockY, pending]);

      const probe = spyConflictQueries();
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(pending._id))
        .set('Authorization', `Bearer ${approverToken}`)
        // stale version AND a move that WOULD introduce a conflict
        .send({ _version: 1, startDateTime: '2026-05-25T14:15:00', endDateTime: '2026-05-25T14:45:00' });
      const count = probe.count();
      probe.restore();

      expect(res.status).toBe(409);
      // Byte-identical to conditionalUpdate's envelope: top-level code is
      // 'CONFLICT', the VERSION_CONFLICT discriminator is in details.code.
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.details.code).toBe('VERSION_CONFLICT');
      expect(res.body.error).not.toBe('SchedulingConflict');
      expect(count).toBe(0); // no conflict query ran
    });
  });

  // ── Task 5: owner-edit general branch (PUT /api/room-reservations/:id/edit) ─
  // Ownership passes via the factory-default requestedBy.email
  // (requester@external.com === createRequester().email).
  describe('Owner edit: delta gate (canForce: false)', () => {
    it('SCG-O1: owner drops the colliding room → 200', async () => {
      const block = blocker('Owner Blocker A', '2026-07-10T10:00:00', '2026-07-10T11:00:00', [roomA]);
      const pending = createPendingEvent({
        eventTitle: 'Owner Pending In A',
        startDateTime: new Date('2026-07-10T10:00:00'),
        endDateTime: new Date('2026-07-10T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [block, pending]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pending._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Owner Pending In A',
          startDate: '2026-07-10', startTime: '10:00',
          endDate: '2026-07-10', endTime: '11:00',
          reservationStartTime: '10:00', reservationEndTime: '11:00',
          requestedRooms: [roomB.toString()], // drop A → free B
          attendeeCount: 10,
        });

      expect(res.status).toBe(200);
    });

    it('SCG-O2: owner introduces a collision → 409 deltaGate, canForce false', async () => {
      const blockY = blocker('Owner Blocker Y', '2026-07-11T14:00:00', '2026-07-11T16:00:00', [roomA]);
      const pending = createPendingEvent({
        eventTitle: 'Owner Clean Pending',
        startDateTime: new Date('2026-07-11T10:00:00'),
        endDateTime: new Date('2026-07-11T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [blockY, pending]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pending._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Owner Clean Pending',
          startDate: '2026-07-11', startTime: '14:30',
          endDate: '2026-07-11', endTime: '15:30',
          reservationStartTime: '14:30', reservationEndTime: '15:30',
          requestedRooms: [roomA.toString()],
          attendeeCount: 10,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.deltaGate).toBe(true);
      expect(res.body.canForce).toBe(false);
      expect(res.body.hardConflicts).toHaveLength(1);
      expect(res.body.hardConflicts[0].eventTitle).toBe('Owner Blocker Y');
    });

    it('SCG-O3: rejected→pending resubmit carrying a collision → 200 and pending', async () => {
      // A published blocker sits exactly where the rejected request is.
      const block = blocker('Resubmit Blocker', '2026-07-12T10:00:00', '2026-07-12T11:00:00', [roomA]);
      const rejected = createRejectedEvent({
        eventTitle: 'Rejected Request',
        startDateTime: new Date('2026-07-12T10:00:00'),
        endDateTime: new Date('2026-07-12T11:00:00'),
        locations: [roomA],
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [block, rejected]);

      // Resubmit unchanged times/room — the collision is carried, not introduced.
      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(rejected._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Rejected Request',
          startDate: '2026-07-12', startTime: '10:00',
          endDate: '2026-07-12', endTime: '11:00',
          reservationStartTime: '10:00', reservationEndTime: '11:00',
          requestedRooms: [roomA.toString()],
          attendeeCount: 10,
        });

      expect(res.status).toBe(200);
      const stored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: rejected._id });
      expect(stored.status).toBe('pending');
    });
  });

  // ── Task 6: occurrence (editScope: 'thisEvent') delta — admin AND owner ────
  // A pending weekly Tuesday master (3/10..6/30) in the given rooms.
  function pendingMaster(rooms, extraCd = {}) {
    return createRecurringSeriesMaster({
      status: STATUS.PENDING,
      eventTitle: 'Occurrence Master',
      startDateTime: new Date('2026-03-10T10:00:00'),
      endDateTime: new Date('2026-03-10T11:00:00'),
      locations: rooms,
      locationDisplayNames: rooms.map(() => 'Room'),
      calendarData: {
        eventTitle: 'Occurrence Master',
        startDateTime: '2026-03-10T10:00:00',
        endDateTime: '2026-03-10T11:00:00',
        startTime: '10:00',
        endTime: '11:00',
        locations: rooms,
        locationDisplayNames: rooms.map(() => 'Room'),
        categories: ['Meeting'],
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
        ...extraCd,
      },
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      },
    });
  }

  describe('Occurrence (thisEvent) delta: admin', () => {
    it('SCG-8: removing an inherited colliding room while others still collide → 200 (field repro)', async () => {
      // Occurrence 3/17 inherits rooms A+B; a blocker sits in EACH on that date.
      const blkA = blocker('Occ Blk A', '2026-03-17T10:00:00', '2026-03-17T11:00:00', [roomA]);
      const blkB = blocker('Occ Blk B', '2026-03-17T10:00:00', '2026-03-17T11:00:00', [roomB]);
      const master = pendingMaster([roomA, roomB]);
      await insertEvents(db, [blkA, blkB, master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ editScope: 'thisEvent', occurrenceDate: '2026-03-17', locations: [roomB.toString()] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('SCG-9: adding a colliding room → 409, approver canForce false', async () => {
      const blkA = blocker('Occ Blk A9', '2026-03-17T10:00:00', '2026-03-17T11:00:00', [roomA]);
      const master = pendingMaster([roomB]);
      await insertEvents(db, [blkA, master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${approverToken}`) // non-admin approver
        .send({ editScope: 'thisEvent', occurrenceDate: '2026-03-17', locations: [roomB.toString(), roomA.toString()] });

      expect(res.status).toBe(409);
      expect(res.body.deltaGate).toBe(true);
      expect(res.body.canForce).toBe(false); // approver is not admin
      expect(res.body.hardConflicts[0].eventTitle).toBe('Occ Blk A9');
    });

    it('SCG-10: admin adding a colliding room → 409 canForce true; forceUpdate → 200', async () => {
      const blkA = blocker('Occ Blk A10', '2026-03-17T10:00:00', '2026-03-17T11:00:00', [roomA]);
      const master = pendingMaster([roomB]);
      await insertEvents(db, [blkA, master]);

      const blocked = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ editScope: 'thisEvent', occurrenceDate: '2026-03-17', locations: [roomB.toString(), roomA.toString()] });
      expect(blocked.status).toBe(409);
      expect(blocked.body.canForce).toBe(true);
      expect(blocked.body.forceField).toBe('forceUpdate');

      const forced = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ editScope: 'thisEvent', occurrenceDate: '2026-03-17', locations: [roomB.toString(), roomA.toString()], forceUpdate: true });
      expect(forced.status).toBe(200);
      expect(forced.body.success).toBe(true);
    });

    it('SCG-11: buffer-only collision on the occurrence is caught (buffer from master)', async () => {
      // Master carries a 30-minute setup buffer. The blocker sits 09:30-10:00,
      // i.e. inside the setup zone of the 10:00 occurrence, not the event proper.
      const blkA = blocker('Buffer Blk', '2026-03-17T09:30:00', '2026-03-17T10:00:00', [roomA]);
      const master = pendingMaster([roomB], { setupTimeMinutes: 30 });
      await insertEvents(db, [blkA, master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ editScope: 'thisEvent', occurrenceDate: '2026-03-17', locations: [roomA.toString()] });

      // If buffers were read from the merged occurrence (0 min) the event window
      // 10:00-11:00 would NOT overlap 09:30-10:00 and this would wrongly 200.
      expect(res.status).toBe(409);
      expect(res.body.deltaGate).toBe(true);
      expect(res.body.hardConflicts[0].eventTitle).toBe('Buffer Blk');
    });
  });

  describe('Occurrence (thisEvent) delta: owner', () => {
    it('SCG-12: requester moves own occurrence into a collision → 409 canForce false', async () => {
      const blkA = blocker('Owner Occ Blk', '2026-03-17T10:00:00', '2026-03-17T11:00:00', [roomA]);
      const master = pendingMaster([roomB]); // owned by requester@external.com (factory default)
      await insertEvents(db, [blkA, master]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ editScope: 'thisEvent', occurrenceDate: '2026-03-17', requestedRooms: [roomA.toString()] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.deltaGate).toBe(true);
      expect(res.body.canForce).toBe(false);
    });
  });
});
