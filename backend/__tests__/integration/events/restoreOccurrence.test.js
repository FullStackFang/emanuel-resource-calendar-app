/**
 * Restore Single Occurrence Tests (R-1 to R-10)
 *
 * Covers DL-9 / DL-10 / DL-11 from the recurrence spec
 * (`docs/superpowers/specs/2026-04-24-recurrence-business-logic-design.md`).
 *
 * Restore is initiated by a master-update PUT (`PUT /api/admin/events/:id` with
 * `editScope: 'allEvents'`) carrying a `recurrence` object whose `exclusions[]`
 * has shrunk. The endpoint must:
 *   - Compute removed dates via `exclusionsRemoved()`
 *   - Run conflict detection on each restored date's effective times BEFORE mutating
 *   - For each removed date, undelete any matching soft-deleted exception doc
 *     (preserving `overrides`) — DL-10
 *   - Best-effort Graph reconcile on published series — non-fatal
 *   - Persist the master with the smaller `exclusions[]`
 *   - Push statusHistory entries on master AND each resurrected exception
 *   - Return `200` with `restoredOccurrences: [{ date, hadException, graphReconciled }]`
 *
 * R-2 (resurrect-with-customization) currently seeds the post-delete state
 * directly because the audit plan's DL-1 fix has not shipped. When DL-1 lands,
 * R-2 should be retrofitted to drive through the real DELETE thisEvent path.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createApprover,
  createRequester,
  createSecurityUser,
  createViewer,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createExceptionDocument,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Restore Single Occurrence Tests (R-1 to R-10)', () => {
  let mongoClient, db, app;
  let adminUser, adminToken;
  let requesterUser, requesterToken;
  let viewerUser, viewerToken;
  let departmentUser, departmentToken;

  const roomId = new ObjectId();
  const roomDoc = {
    _id: roomId,
    name: 'Chapel',
    displayName: 'Chapel',
    isReservable: true,
    active: true,
    status: 'approved',
  };

  // Daily 4/15-4/30 series — gives us a wide pattern with predictable date math
  const dailyRecurrence = (extra = {}) => ({
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-30' },
    additions: [],
    exclusions: [],
    ...extra,
  });

  function buildMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      status: 'published',
      calendarOwner: TEST_CALENDAR_OWNER,
      eventTitle: 'Daily Standup',
      locations: [roomId],
      locationDisplayNames: ['Chapel'],
      recurrence: dailyRecurrence(),
      calendarData: {
        eventTitle: 'Daily Standup',
        startDateTime: '2026-04-15T09:00:00',
        endDateTime: '2026-04-15T09:30:00',
        startDate: '2026-04-15',
        startTime: '09:00',
        endDate: '2026-04-15',
        endTime: '09:30',
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        categories: ['Meeting'],
      },
      ...overrides,
    });
  }

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('restoreOccurrence'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).insertOne(roomDoc);
    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    viewerUser = createViewer();
    departmentUser = createSecurityUser();
    await insertUsers(db, [adminUser, requesterUser, viewerUser, departmentUser]);
    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
    viewerToken = await createMockToken(viewerUser);
    departmentToken = await createMockToken(departmentUser);
  });

  // ─── R-1: Idempotent re-restore (DL-11) ────────────────────────────────

  describe('R-1: idempotent re-restore', () => {
    it('returns 200 no-op when removing a date not in exclusions[]', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
      });
      const [saved] = await insertEvents(db, [master]);

      // Send same recurrence — exclusions identical, no removal happening
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
          editScope: 'allEvents',
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      // Either field absent or empty array — both are valid no-op signals
      const restored = res.body.restoredOccurrences || [];
      expect(restored).toEqual([]);

      const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(after.recurrence.exclusions).toEqual(['2026-04-20']);
    });
  });

  // ─── R-2: Resurrect with customization (DL-10) ─────────────────────────

  describe('R-2: resurrect with customization', () => {
    it('removes exclusion AND undeletes the exception with overrides preserved', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
      });
      // Seed post-DL-1 state directly: exclusion present + exception soft-deleted.
      // When DL-1 ships, retrofit to drive through DELETE thisEvent.
      const exception = createExceptionDocument(
        master,
        '2026-04-20',
        { eventTitle: 'Special Standup', startTime: '14:00' },
        { isDeleted: true, status: 'deleted', deletedAt: new Date(), deletedBy: adminUser.email }
      );
      const [savedMaster] = await insertEvents(db, [master, exception]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(savedMaster._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }), // 4/20 removed
          editScope: 'allEvents',
          _version: savedMaster._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.restoredOccurrences).toBeDefined();
      expect(res.body.restoredOccurrences).toHaveLength(1);
      expect(res.body.restoredOccurrences[0]).toMatchObject({
        date: '2026-04-20',
        hadException: true,
      });

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedMaster._id });
      expect(masterAfter.recurrence.exclusions).toEqual([]);

      const exceptionAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: exception.eventId });
      expect(exceptionAfter.isDeleted).toBe(false);
      expect(exceptionAfter.deletedAt).toBeUndefined();
      expect(exceptionAfter.deletedBy).toBeUndefined();
      // Customization preserved
      expect(exceptionAfter.overrides.eventTitle).toBe('Special Standup');
      expect(exceptionAfter.overrides.startTime).toBe('14:00');
      // Audit trail records the restore on the exception
      const exceptionRestoreEntry = exceptionAfter.statusHistory[exceptionAfter.statusHistory.length - 1];
      expect(exceptionRestoreEntry.reason).toMatch(/restore/i);
    });
  });

  // ─── R-3: Restore without exception doc ─────────────────────────────────

  describe('R-3: restore without exception doc', () => {
    it('removes exclusion, no exception resurrection, virtual occurrence reappears', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-22'] }),
      });
      const [saved] = await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.restoredOccurrences).toHaveLength(1);
      expect(res.body.restoredOccurrences[0]).toMatchObject({
        date: '2026-04-22',
        hadException: false,
      });

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(masterAfter.recurrence.exclusions).toEqual([]);

      // No exception doc was created
      const childCount = await db.collection(COLLECTIONS.EVENTS).countDocuments({
        seriesMasterEventId: master.eventId,
        eventType: { $in: ['exception', 'addition'] },
      });
      expect(childCount).toBe(0);
    });
  });

  // ─── R-4: Permission denial — department user ───────────────────────────

  describe('R-4: department user cannot restore', () => {
    it('returns 403 from admin PUT for a department user without approver role', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
      });
      const [saved] = await insertEvents(db, [master]);

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${departmentToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: saved._version,
        })
        .expect(403);

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(masterAfter.recurrence.exclusions).toEqual(['2026-04-20']);
    });
  });

  // ─── R-5: Permission denial — viewer / requester ────────────────────────

  describe('R-5: viewer/requester cannot restore', () => {
    it('returns 403 for requester', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
      });
      const [saved] = await insertEvents(db, [master]);

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: saved._version,
        })
        .expect(403);
    });

    it('returns 403 for viewer', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
      });
      const [saved] = await insertEvents(db, [master]);

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: saved._version,
        })
        .expect(403);
    });
  });

  // ─── R-6: Graph reconciliation on published series with stored graphEventId ─

  describe('R-6: Graph reconciliation on published series', () => {
    it('attempts Graph instance PATCH for resurrected exception with stored graphEventId', async () => {
      const masterGraphId = 'graph-master-r6';
      const exceptionGraphId = 'graph-exc-r6';
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-21'] }),
        graphData: { id: masterGraphId, start: { timeZone: 'America/New_York' } },
      });
      const exception = createExceptionDocument(
        master,
        '2026-04-21',
        { eventTitle: 'Sprint Planning', startTime: '10:00' },
        {
          isDeleted: true,
          status: 'deleted',
          deletedAt: new Date(),
          deletedBy: adminUser.email,
          graphEventId: exceptionGraphId,
        }
      );
      const [savedMaster] = await insertEvents(db, [master, exception]);

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(savedMaster._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: savedMaster._version,
        })
        .expect(200);

      // Graph mock should have received the PATCH call against exceptionGraphId
      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      const restoreCall = updateCalls.find(c => c.eventId === exceptionGraphId);
      expect(restoreCall).toBeDefined();
    });
  });

  // ─── R-7: Graph reconcile failure non-fatal ─────────────────────────────

  describe('R-7: Graph reconcile failure non-fatal', () => {
    it('still returns 200 and updates DB when Graph throws', async () => {
      const masterGraphId = 'graph-master-r7';
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-23'] }),
        graphData: { id: masterGraphId, start: { timeZone: 'America/New_York' } },
      });
      const exception = createExceptionDocument(
        master,
        '2026-04-23',
        { eventTitle: 'Special' },
        {
          isDeleted: true,
          status: 'deleted',
          deletedAt: new Date(),
          deletedBy: adminUser.email,
          graphEventId: 'graph-exc-r7',
        }
      );
      const [savedMaster] = await insertEvents(db, [master, exception]);

      // Force the mock to throw on updateCalendarEvent
      graphApiMock.setMockError('updateCalendarEvent', new Error('Graph 404'));

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(savedMaster._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: savedMaster._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      // DB state still updated despite Graph failure
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedMaster._id });
      expect(masterAfter.recurrence.exclusions).toEqual([]);
      const excAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: exception.eventId });
      expect(excAfter.isDeleted).toBe(false);
    });
  });

  // ─── R-8: Conflict detection 409 + forceUpdate override ─────────────────

  describe('R-8: conflict detection on restore', () => {
    it('returns 409 with conflict details, leaves state unchanged (atomic) when forceUpdate is absent', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
      });
      // Conflicting event was booked during the exclusion window
      const conflicter = createPublishedEvent({
        calendarOwner: TEST_CALENDAR_OWNER,
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        calendarData: {
          eventTitle: 'Other Booking',
          startDateTime: '2026-04-20T09:00:00',
          endDateTime: '2026-04-20T09:30:00',
          startDate: '2026-04-20',
          startTime: '09:00',
          endDate: '2026-04-20',
          endTime: '09:30',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
        },
      });
      const [savedMaster] = await insertEvents(db, [master, conflicter]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(savedMaster._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: savedMaster._version,
        })
        .expect(409);

      expect(res.body.error).toBe('SchedulingConflict');

      // State unchanged: exclusion still present
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedMaster._id });
      expect(masterAfter.recurrence.exclusions).toEqual(['2026-04-20']);
    });

    it('succeeds with forceUpdate: true (admin override)', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20'] }),
      });
      const conflicter = createPublishedEvent({
        calendarOwner: TEST_CALENDAR_OWNER,
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        calendarData: {
          eventTitle: 'Other Booking',
          startDateTime: '2026-04-20T09:00:00',
          endDateTime: '2026-04-20T09:30:00',
          startDate: '2026-04-20',
          startTime: '09:00',
          endDate: '2026-04-20',
          endTime: '09:30',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
        },
      });
      const [savedMaster] = await insertEvents(db, [master, conflicter]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(savedMaster._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          forceUpdate: true,
          _version: savedMaster._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedMaster._id });
      expect(masterAfter.recurrence.exclusions).toEqual([]);
    });
  });

  // ─── R-9: Multi-restore atomicity ───────────────────────────────────────

  describe('R-9: multi-restore atomicity', () => {
    it('removes all three exclusions atomically when no conflicts', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20', '2026-04-21', '2026-04-22'] }),
      });
      const [saved] = await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.restoredOccurrences).toHaveLength(3);
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(masterAfter.recurrence.exclusions).toEqual([]);
    });

    it('rolls back all when one date conflicts', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-20', '2026-04-21', '2026-04-22'] }),
      });
      // Conflict on 4/21 only
      const conflicter = createPublishedEvent({
        calendarOwner: TEST_CALENDAR_OWNER,
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
        calendarData: {
          eventTitle: 'Other',
          startDateTime: '2026-04-21T09:00:00',
          endDateTime: '2026-04-21T09:30:00',
          startDate: '2026-04-21',
          startTime: '09:00',
          endDate: '2026-04-21',
          endTime: '09:30',
          locations: [roomId],
          locationDisplayNames: ['Chapel'],
        },
      });
      const [savedMaster] = await insertEvents(db, [master, conflicter]);

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(savedMaster._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: dailyRecurrence({ exclusions: [] }),
          editScope: 'allEvents',
          _version: savedMaster._version,
        })
        .expect(409);

      // None of the three were removed
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedMaster._id });
      expect(masterAfter.recurrence.exclusions.sort()).toEqual(['2026-04-20', '2026-04-21', '2026-04-22']);
    });
  });

  // ─── R-10: Out-of-range date silently dropped ───────────────────────────

  describe('R-10: out-of-range date no-op', () => {
    it('silently drops exclusion for date no longer in pattern range when range shortened in same PUT', async () => {
      const master = buildMaster({
        recurrence: dailyRecurrence({ exclusions: ['2026-04-29'] }),
      });
      const [saved] = await insertEvents(db, [master]);

      // Shrink range to 4/15-4/25 (4/29 now outside) AND remove exclusion in same PUT
      const newRecurrence = {
        pattern: { type: 'daily', interval: 1 },
        range: { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-25' },
        additions: [],
        exclusions: [],
      };

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: newRecurrence,
          editScope: 'allEvents',
          _version: saved._version,
        })
        .expect(200);

      // Should be a no-op for the out-of-range date — no resurrection, no error
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(masterAfter.recurrence.exclusions).toEqual([]);
      expect(masterAfter.recurrence.range.endDate).toBe('2026-04-25');
    });
  });
});
