/**
 * Time Ordering Validation Tests (TO-1 to TO-10)
 *
 * Verifies that the backend enforces the time ordering chain:
 * Res Start <= Setup <= Door Open <= Event Start <= Door Close <= Event End <= Teardown <= Res End
 *
 * Door Close sits between Event Start and Event End (doors can close during the event).
 * Event End must be at or before Res End.
 *
 * Tests cover draft submit, owner edit, and draft save (warning-only) endpoints.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createApprover,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Time Ordering Validation Tests (TO-1 to TO-8)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser, approverUser;
  let requesterToken, approverToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('timeOrdering'));
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
    approverUser = createApprover();
    await insertUsers(db, [requesterUser, approverUser]);

    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
  });

  /**
   * Helper to create a draft with properly ordered HH:MM times.
   * All operational times use HH:MM format (not '15 minutes' style).
   */
  function createTimedDraft(overrides = {}) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const startDT = new Date(tomorrow);
    startDT.setHours(11, 0, 0, 0);
    const endDT = new Date(tomorrow);
    endDT.setHours(13, 0, 0, 0);

    return createDraftEvent({
      locations: [{ displayName: 'Room A' }],
      categories: ['Meeting'],
      attendeeCount: 10,
      // Properly ordered: 10:00 <= 10:15 <= 10:30 <= 11:00 <= 12:30 <= 13:00 <= 13:30 < 14:00
      reservationStartTime: '10:00',
      setupTime: '10:15',
      doorOpenTime: '10:30',
      startTime: '11:00',
      doorCloseTime: '12:30',
      endTime: '13:00',
      teardownTime: '13:30',
      reservationEndTime: '14:00',
      startDateTime: startDT,
      endDateTime: endDT,
      ...overrides,
    });
  }

  // ─── TO-1: Valid ordering accepted ────────────────────────────────────

  describe('TO-1: Draft submit with valid time ordering', () => {
    it('should accept submission when all times are in correct order', async () => {
      const draft = createTimedDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── TO-2: Setup before reservation start ─────────────────────────────

  describe('TO-2: Setup time before reservation start', () => {
    it('should reject when setupTime is earlier than reservationStartTime', async () => {
      const draft = createTimedDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        setupTime: '09:30',         // BEFORE reservation start (10:00)
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(400);

      expect(res.body.validationErrors).toEqual(
        expect.arrayContaining([expect.stringContaining('Reservation Start')])
      );
    });
  });

  // ─── TO-3: Teardown after reservation end ─────────────────────────────

  describe('TO-3: Teardown time after reservation end', () => {
    it('should reject when teardownTime is later than reservationEndTime', async () => {
      const draft = createTimedDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        teardownTime: '15:00',      // AFTER reservation end (14:00)
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(400);

      expect(res.body.validationErrors).toEqual(
        expect.arrayContaining([expect.stringContaining('Teardown')])
      );
    });
  });

  // ─── TO-4: Event start after event end ────────────────────────────────

  describe('TO-4: Event start after event end', () => {
    it('should reject when startTime is after endTime', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const startDT = new Date(tomorrow);
      startDT.setHours(13, 0, 0, 0);
      const endDT = new Date(tomorrow);
      endDT.setHours(11, 0, 0, 0);

      const draft = createTimedDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        startTime: '13:00',         // AFTER end (11:00)
        endTime: '11:00',
        startDateTime: startDT,
        endDateTime: endDT,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(400);

      expect(res.body.validationErrors).toEqual(
        expect.arrayContaining([expect.stringContaining('Event Start')])
      );
    });
  });

  // ─── TO-5: Only reservation times (no operational) ────────────────────

  describe('TO-5: Only reservation times, no operational times', () => {
    it('should accept when only reservation start/end are set', async () => {
      const draft = createTimedDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        // Clear all operational times
        setupTime: null,
        doorOpenTime: null,
        doorCloseTime: null,
        teardownTime: null,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── TO-6: Multi-day event skips ordering ─────────────────────────────

  describe('TO-6: Multi-day event skips time ordering', () => {
    it('should accept multi-day events even with cross-day times', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);

      const startDT = new Date(tomorrow);
      startDT.setHours(14, 0, 0, 0); // 2 PM tomorrow
      const endDT = new Date(dayAfter);
      endDT.setHours(10, 0, 0, 0); // 10 AM day after

      // Use explicit dates to guarantee multi-day detection regardless of timezone
      const startDateStr = `${startDT.getFullYear()}-${String(startDT.getMonth() + 1).padStart(2, '0')}-${String(startDT.getDate()).padStart(2, '0')}`;
      const endDateStr = `${endDT.getFullYear()}-${String(endDT.getMonth() + 1).padStart(2, '0')}-${String(endDT.getDate()).padStart(2, '0')}`;

      const draft = createTimedDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        startTime: '14:00',
        endTime: '10:00',           // Next day — would be invalid same-day
        startDateTime: startDT,
        endDateTime: endDT,
        reservationStartTime: '13:00',
        reservationEndTime: '11:00',
        setupTime: null,
        doorOpenTime: null,
        doorCloseTime: null,
        teardownTime: null,
        // Explicit calendarData with local-time dates to ensure multi-day detection
        calendarData: {
          eventTitle: 'Multi-Day Event',
          eventDescription: 'Test multi-day',
          startDateTime: `${startDateStr}T14:00:00`,
          endDateTime: `${endDateStr}T10:00:00`,
          startDate: startDateStr,
          endDate: endDateStr,
          startTime: '14:00',
          endTime: '10:00',
          reservationStartTime: '13:00',
          reservationEndTime: '11:00',
          locations: [{ displayName: 'Room A' }],
          locationDisplayNames: ['Room A'],
          categories: ['Meeting'],
          attendeeCount: 10,
        },
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── TO-7: Draft save with bad ordering (warning only) ────────────────

  describe('TO-7: Draft save with invalid ordering returns warning', () => {
    it('should save the draft but include timeOrderingWarnings', async () => {
      const draft = createTimedDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      // Update with out-of-order times — should still save (200) with warnings
      const res = await request(app)
        .put(`/api/room-reservations/draft/${savedDraft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Updated Draft',
          startDate: savedDraft.calendarData.startDate,
          endDate: savedDraft.calendarData.endDate,
          startTime: '11:00',
          endTime: '13:00',
          reservationStartTime: '10:00',
          reservationEndTime: '14:00',
          setupTime: '09:00',        // BEFORE reservation start — ordering violation
          attendeeCount: 10,
        })
        .expect(200);

      // Should save successfully (response is the draft document with optional timeOrderingWarnings)
      expect(res.body._id).toBeDefined();
      // Should include warnings
      expect(res.body.timeOrderingWarnings).toBeDefined();
      expect(res.body.timeOrderingWarnings.length).toBeGreaterThan(0);
      expect(res.body.timeOrderingWarnings[0]).toContain('Reservation Start');
    });
  });

  // ─── TO-8: Door close before event end is valid ──────────────────────

  describe('TO-8: Door close before event end is valid', () => {
    it('should accept door close between event start and event end', async () => {
      const pendingEvent = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        reservationStartTime: '10:00',
        reservationEndTime: '14:00',
      });
      const [savedEvent] = await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${savedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: savedEvent._version,
          eventTitle: 'Edited Event',
          startDate: savedEvent.calendarData.startDate,
          endDate: savedEvent.calendarData.endDate,
          startTime: '11:00',
          endTime: '13:00',
          attendeeCount: 10,
          reservationStartTime: '10:00',
          reservationEndTime: '14:00',
          doorOpenTime: '10:45',
          doorCloseTime: '12:00',    // BEFORE event end — valid (doors can close during event)
        })
        .expect(200);

      expect(res.body.reservation).toBeDefined();
    });
  });

  // ─── TO-9: Door close after event end is rejected ───────────────────

  describe('TO-9: Door close after event end is rejected', () => {
    it('should return 400 when doorCloseTime exceeds event end', async () => {
      const pendingEvent = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        reservationStartTime: '10:00',
        reservationEndTime: '14:00',
      });
      const [savedEvent] = await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${savedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: savedEvent._version,
          eventTitle: 'Edited Event',
          startDate: savedEvent.calendarData.startDate,
          endDate: savedEvent.calendarData.endDate,
          startTime: '11:00',
          endTime: '13:00',
          attendeeCount: 10,
          reservationStartTime: '10:00',
          reservationEndTime: '14:00',
          doorCloseTime: '13:30',    // AFTER event end (13:00) — rejected
        })
        .expect(400);

      expect(res.body.error).toBe('Invalid time ordering');
      expect(res.body.validationErrors).toBeDefined();
      expect(res.body.validationErrors[0]).toContain('Door Close');
      expect(res.body.validationErrors[0]).toContain('Event End');
    });
  });

  // ─── TO-10: Event end equal to reservation end is accepted ──

  describe('TO-10: Event end can equal reservation end', () => {
    it('should accept when event end equals reservation end', async () => {
      const pendingEvent = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        reservationStartTime: '10:00',
        reservationEndTime: '14:00',
      });
      const [savedEvent] = await insertEvents(db, [pendingEvent]);

      await request(app)
        .put(`/api/room-reservations/${savedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: savedEvent._version,
          eventTitle: 'Edited Event',
          startDate: savedEvent.calendarData.startDate,
          endDate: savedEvent.calendarData.endDate,
          startTime: '11:00',
          endTime: '14:00',          // EQUALS reservation end — now allowed
          attendeeCount: 10,
          reservationStartTime: '10:00',
          reservationEndTime: '14:00',
        })
        .expect(200);
    });
  });
});
