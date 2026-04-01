/**
 * Audit & Ownership Tests (AO-1 to AO-4)
 *
 * Tests for Phase 4 code review fixes:
 * - I1: No spurious statusHistory push on pending edit
 * - I6: Email-based ownership checks (consistent with restore/delete)
 * - I8: Numbered range respects pre-window occurrence count
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createOtherRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createRejectedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const { expandRecurringOccurrencesInWindow } = require('../../../utils/recurrenceExpansion');

describe('Audit & Ownership Tests (AO-1 to AO-4)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('auditOwnership'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    requesterUser = createRequester();
    await insertUsers(db, [requesterUser]);

    requesterToken = await createMockToken(requesterUser);
  });

  const editPayload = {
    eventTitle: 'Updated Title',
    startDate: '2026-06-10',
    startTime: '10:00',
    endDate: '2026-06-10',
    endTime: '12:00',
    attendeeCount: 25,
    requestedRooms: [],
    categories: ['meeting'],
    services: {},
  };

  // ============================================
  // AO-1: Editing pending event does NOT push spurious statusHistory (I1)
  // ============================================
  describe('AO-1: No spurious statusHistory on pending edit', () => {
    it('should not add a statusHistory entry when editing a pending event', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Original Title',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
          },
          department: 'General',
        },
        statusHistory: [{
          status: 'pending',
          changedAt: new Date(),
          changedBy: requesterUser.odataId,
          reason: 'Event created',
        }],
      });
      await insertEvents(db, [pendingEvent]);

      const originalHistoryLength = pendingEvent.statusHistory.length;

      await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      const updated = await findEvent(db, pendingEvent._id);
      // statusHistory should NOT grow — no status change happened
      expect(updated.statusHistory.length).toBe(originalHistoryLength);
    });
  });

  // ============================================
  // AO-2: Resubmitting rejected event DOES push statusHistory (I1 regression)
  // ============================================
  describe('AO-2: Resubmit does push statusHistory', () => {
    it('should add a statusHistory entry when resubmitting a rejected event', async () => {
      const rejectedEvent = createRejectedEvent({
        eventTitle: 'Rejected Event',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
          },
          department: 'General',
        },
        statusHistory: [
          { status: 'pending', changedAt: new Date(), changedBy: requesterUser.odataId, reason: 'Created' },
          { status: 'rejected', changedAt: new Date(), changedBy: 'admin', reason: 'Rejected' },
        ],
      });
      await insertEvents(db, [rejectedEvent]);

      const originalHistoryLength = rejectedEvent.statusHistory.length;

      await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(rejectedEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      const updated = await findEvent(db, rejectedEvent._id);
      // statusHistory SHOULD grow — status changed from rejected → pending
      expect(updated.statusHistory.length).toBe(originalHistoryLength + 1);
      const lastEntry = updated.statusHistory[updated.statusHistory.length - 1];
      expect(lastEntry.status).toBe('pending');
      expect(lastEntry.reason).toContain('Resubmitted');
    });
  });

  // ============================================
  // AO-3: Email-based ownership allows access for mismatched userId (I6)
  // ============================================
  describe('AO-3: Email-based ownership on edit endpoint', () => {
    it('should allow edit when email matches but userId differs', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Mismatched UserId Event',
        userId: 'old-user-id-format', // Old/different userId
        roomReservationData: {
          requestedBy: {
            userId: 'old-user-id-format', // Doesn't match requesterUser.odataId
            email: requesterUser.email,    // But email DOES match
          },
          department: 'General',
        },
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      // Should succeed because email matches (not blocked by userId mismatch)
      expect(res.status).toBe(200);
    });
  });

  // ============================================
  // AO-4: Numbered recurrence respects pre-window occurrences (I8)
  // ============================================
  describe('AO-4: Numbered recurrence window expansion', () => {
    it('should limit occurrences based on total count including pre-window', () => {
      // 10-occurrence weekly series starting 2026-01-05 (Monday)
      const masterEvent = {
        calendarData: {
          startDateTime: '2026-01-05T10:00:00',
          endDateTime: '2026-01-05T11:00:00',
        },
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
          range: { type: 'numbered', startDate: '2026-01-05', numberOfOccurrences: 10 },
        },
      };

      // Window starts at week 7 (2026-02-16), ends at week 15 (2026-04-13)
      const windowStart = new Date('2026-02-16T00:00:00');
      const windowEnd = new Date('2026-04-13T23:59:59');

      const occurrences = expandRecurringOccurrencesInWindow(
        masterEvent,
        windowStart,
        windowEnd
      );

      // Series has 10 occurrences total: Jan 5, 12, 19, 26, Feb 2, 9, 16, 23, Mar 2, 9
      // Window starts Feb 16 — that's occurrence #7
      // Remaining occurrences in window: Feb 16, 23, Mar 2, 9 = 4 occurrences
      expect(occurrences.length).toBe(4);
    });

    it('should return all occurrences when window covers entire series', () => {
      const masterEvent = {
        calendarData: {
          startDateTime: '2026-01-05T10:00:00',
          endDateTime: '2026-01-05T11:00:00',
        },
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
          range: { type: 'numbered', startDate: '2026-01-05', numberOfOccurrences: 5 },
        },
      };

      const windowStart = new Date('2026-01-01T00:00:00');
      const windowEnd = new Date('2026-12-31T23:59:59');

      const occurrences = expandRecurringOccurrencesInWindow(
        masterEvent,
        windowStart,
        windowEnd
      );

      expect(occurrences.length).toBe(5);
    });
  });
});
