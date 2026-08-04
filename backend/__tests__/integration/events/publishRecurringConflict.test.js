/**
 * Publish Recurring Conflict Tests (PRC-1 to PRC-5)
 *
 * Tests that publishing recurring events BLOCKS on hard conflicts (409 with
 * canForce for admins), that forced publishes still record the conflict
 * snapshot, and that non-recurring events retain their blocking behavior.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Publish Recurring Conflict Tests (PRC-1 to PRC-5)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  const roomId = new ObjectId();

  // Weekly Tuesday series 2026-03-10 → 2026-05-26 (12 occurrences),
  // conflicting with a published event on 2026-03-17.
  function buildConflictedRecurringFixture() {
    const conflictEvent = createPublishedEvent({
      eventTitle: 'Existing Meeting',
      startDateTime: new Date('2026-03-17T14:00:00'),
      endDateTime: new Date('2026-03-17T15:00:00'),
      locations: [roomId],
      locationDisplayNames: ['Chapel'],
    });
    const recurringPending = createPendingEvent({
      eventTitle: 'Weekly Tuesday Class',
      startDateTime: new Date('2026-03-10T14:00:00'),
      endDateTime: new Date('2026-03-10T15:00:00'),
      locations: [roomId],
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-05-26' },
        exclusions: [],
        additions: [],
      },
    });
    return { conflictEvent, recurringPending };
  }

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('publishRecurringConflict'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);

    graphApiMock.resetMocks();
  });

  // PRC-1: Recurring publish blocks on conflicts (409, event untouched)
  describe('PRC-1: Recurring publish blocks on conflicts', () => {
    it('should return 409 and leave the event pending when occurrences conflict', async () => {
      const { conflictEvent, recurringPending } = buildConflictedRecurringFixture();
      await insertEvents(db, [conflictEvent, recurringPending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(recurringPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflictTier).toBe('hard');
      expect(res.body.canForce).toBe(true);
      expect(res.body.forceField).toBe('forcePublish');

      // Event untouched: still pending, version unchanged, no snapshot
      const storedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: recurringPending._id });
      expect(storedEvent.status).toBe('pending');
      expect(storedEvent._version).toBe(recurringPending._version);
      expect(storedEvent.recurringConflictSnapshot).toBeUndefined();
      expect(res.body._version).toBe(recurringPending._version);
    });
  });

  // PRC-2: 409 body carries grouped payload + flattened parity arrays
  describe('PRC-2: 409 body includes recurringConflicts and flattened entries', () => {
    it('should include grouped recurringConflicts and flattened hardConflicts with occurrenceDate', async () => {
      const { conflictEvent, recurringPending } = buildConflictedRecurringFixture();
      await insertEvents(db, [conflictEvent, recurringPending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(recurringPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('1 of 12');

      // Grouped payload (per-occurrence)
      expect(res.body.recurringConflicts).toBeDefined();
      expect(res.body.recurringConflicts.totalOccurrences).toBe(12);
      expect(res.body.recurringConflicts.conflictingOccurrences).toBe(1);
      expect(res.body.recurringConflicts.conflicts).toHaveLength(1);
      expect(res.body.recurringConflicts.conflicts[0].occurrenceDate).toBe('2026-03-17');

      // Flattened parity arrays (single-event 409 entry shape + occurrenceDate)
      expect(res.body.hardConflicts).toHaveLength(1);
      const entry = res.body.hardConflicts[0];
      expect(entry.occurrenceDate).toBe('2026-03-17');
      expect(entry.id).toBeDefined();
      expect(entry.eventTitle).toBe('Existing Meeting');
      expect(entry.startDateTime).toBeDefined();
      expect(entry.endDateTime).toBeDefined();
      expect(entry.status).toBe('published');
      expect(res.body.conflicts).toEqual(res.body.hardConflicts);
      expect(res.body.softConflicts).toEqual([]);
    });
  });

  // PRC-3: Forced publish succeeds and still records the conflict snapshot
  describe('PRC-3: Admin forcePublish records recurringConflictSnapshot', () => {
    it('should publish with forcePublish and store the snapshot with correct counts', async () => {
      const { conflictEvent, recurringPending } = buildConflictedRecurringFixture();
      await insertEvents(db, [conflictEvent, recurringPending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(recurringPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ forcePublish: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // The check ran despite forcing: response carries the conflicts so the
      // post-publish warning toasts fire.
      expect(res.body.recurringConflicts).toBeDefined();
      expect(res.body.recurringConflicts.conflictingOccurrences).toBe(1);

      const storedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: recurringPending._id });
      expect(storedEvent.status).toBe('published');
      expect(storedEvent.recurringConflictSnapshot).toBeDefined();
      expect(storedEvent.recurringConflictSnapshot.conflictCount).toBe(1);
      expect(storedEvent.recurringConflictSnapshot.totalOccurrences).toBe(12);
      expect(storedEvent.recurringConflictSnapshot.checkedAt).toBeDefined();
    });
  });

  // PRC-4: Non-recurring events still 409 on conflicts (regression)
  describe('PRC-4: Non-recurring events still block on conflicts', () => {
    it('should return 409 for non-recurring events with hard conflicts', async () => {
      const conflictEvent = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomId],
      });
      await insertEvents(db, [conflictEvent]);

      // Non-recurring pending event at same time
      const singlePending = createPendingEvent({
        eventTitle: 'Single Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomId],
      });
      await insertEvents(db, [singlePending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(singlePending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Should be 409 (blocking), NOT 200
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflictTier).toBe('hard');
      expect(res.body.recurringConflicts).toBeUndefined();
    });
  });

  // PRC-5: No recurringConflicts in response when all occurrences are clean
  describe('PRC-5: No recurringConflicts when clean', () => {
    it('should not include recurringConflicts when no conflicts exist', async () => {
      const recurringPending = createPendingEvent({
        eventTitle: 'Clean Recurring',
        startDateTime: new Date('2026-03-10T14:00:00'),
        endDateTime: new Date('2026-03-10T15:00:00'),
        locations: [roomId],
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-05-26' },
          exclusions: [],
          additions: [],
        },
      });
      await insertEvents(db, [recurringPending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(recurringPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // recurringConflicts should not be in response when there are no conflicts
      expect(res.body.recurringConflicts).toBeUndefined();
    });
  });
});
