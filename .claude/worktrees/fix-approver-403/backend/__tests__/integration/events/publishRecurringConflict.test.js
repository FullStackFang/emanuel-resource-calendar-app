/**
 * Publish Recurring Conflict Tests (PRC-1 to PRC-4)
 *
 * Tests that publishing recurring events is non-blocking (conflicts reported, not 409),
 * while non-recurring events retain the blocking 409 behavior.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Publish Recurring Conflict Tests (PRC-1 to PRC-4)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  const roomId = new ObjectId();

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('publishRecurringConflict'));

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

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);

    graphApiMock.resetMocks();
  });

  // PRC-1: Recurring publish succeeds even with conflicts (non-blocking)
  describe('PRC-1: Recurring publish succeeds with conflicts', () => {
    it('should publish a recurring event even when some occurrences have conflicts', async () => {
      // Create a published event that conflicts with one occurrence
      const conflictEvent = createPublishedEvent({
        eventTitle: 'Existing Meeting',
        startDateTime: new Date('2026-03-17T14:00:00'),
        endDateTime: new Date('2026-03-17T15:00:00'),
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
      });
      await insertEvents(db, [conflictEvent]);

      // Create a pending recurring event
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
      await insertEvents(db, [recurringPending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(recurringPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Should succeed (200), NOT 409
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // PRC-2: Response includes recurringConflicts data
  describe('PRC-2: Response includes recurringConflicts data', () => {
    it('should include recurringConflicts in the publish response when conflicts exist', async () => {
      const conflictEvent = createPublishedEvent({
        eventTitle: 'Board Meeting',
        startDateTime: new Date('2026-03-17T14:00:00'),
        endDateTime: new Date('2026-03-17T15:00:00'),
        locations: [roomId],
        locationDisplayNames: ['Chapel'],
      });
      await insertEvents(db, [conflictEvent]);

      const recurringPending = createPendingEvent({
        eventTitle: 'Weekly Class',
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
      expect(res.body.recurringConflicts).toBeDefined();
      expect(res.body.recurringConflicts.totalOccurrences).toBe(12);
      expect(res.body.recurringConflicts.conflictingOccurrences).toBe(1);
      expect(res.body.recurringConflicts.conflicts).toHaveLength(1);
      expect(res.body.recurringConflicts.conflicts[0].occurrenceDate).toBe('2026-03-17');
    });
  });

  // PRC-3: recurringConflictSnapshot stored on event document
  describe('PRC-3: recurringConflictSnapshot stored on event', () => {
    it('should store recurringConflictSnapshot on the published event document', async () => {
      const conflictEvent = createPublishedEvent({
        eventTitle: 'Existing Event',
        startDateTime: new Date('2026-03-17T14:00:00'),
        endDateTime: new Date('2026-03-17T15:00:00'),
        locations: [roomId],
      });
      await insertEvents(db, [conflictEvent]);

      const recurringPending = createPendingEvent({
        eventTitle: 'Weekly Recurring',
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

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(recurringPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Check the stored document
      const storedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: recurringPending._id });
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
