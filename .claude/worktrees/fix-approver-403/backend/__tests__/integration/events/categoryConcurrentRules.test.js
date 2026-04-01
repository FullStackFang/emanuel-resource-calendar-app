/**
 * Category-Level Concurrent Scheduling Rules Tests (CCR-1 to CCR-6)
 *
 * Tests that category-level allowedConcurrentCategories rules are respected
 * during conflict detection on publish, admin save, and owner edit endpoints.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Category-Level Concurrent Scheduling Rules (CCR-1 to CCR-6)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;

  const roomId = new ObjectId();
  const conflictStart = new Date('2026-04-15T10:00:00');
  const conflictEnd = new Date('2026-04-15T12:00:00');

  // Category IDs
  const shabbatCatId = new ObjectId();
  const bneiMitzvahCatId = new ObjectId();
  const hoildayCatId = new ObjectId();
  const meetingCatId = new ObjectId();

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('categoryConcurrentRules'));

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
    await db.collection(COLLECTIONS.CATEGORIES).deleteMany({});

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);

    graphApiMock.resetMocks();

    // Seed categories
    await db.collection(COLLECTIONS.CATEGORIES).insertMany([
      {
        _id: shabbatCatId,
        name: 'Shabbat Services',
        color: '#3b6eb8',
        allowedConcurrentCategories: [bneiMitzvahCatId], // Shabbat allows B/M
        active: true,
        displayOrder: 1,
      },
      {
        _id: bneiMitzvahCatId,
        name: 'Bnei Mitzvah',
        color: '#059669',
        allowedConcurrentCategories: [], // B/M has no rules of its own
        active: true,
        displayOrder: 2,
      },
      {
        _id: hoildayCatId,
        name: 'Holiday',
        color: '#dc2626',
        allowedConcurrentCategories: [shabbatCatId], // Holiday allows Shabbat
        active: true,
        displayOrder: 3,
      },
      {
        _id: meetingCatId,
        name: 'Meeting',
        color: '#d97706',
        allowedConcurrentCategories: [],
        active: true,
        displayOrder: 4,
      },
    ]);
  });

  // CCR-1: Category rule allows overlap (unilateral grant)
  describe('CCR-1: Category rule allows overlap', () => {
    it('should allow publish when existing event category grants incoming category', async () => {
      // Existing published Shabbat event (its category allows B/M)
      const existingEvent = createPublishedEvent({
        eventTitle: 'Shabbat Services',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Shabbat Services'],
      });
      await insertEvents(db, [existingEvent]);

      // New B/M event at same time/room
      const newEvent = createPendingEvent({
        eventTitle: 'Bar Mitzvah',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Bnei Mitzvah'],
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      expect(res.status).toBe(200);
    });
  });

  // CCR-2: No category rule blocks overlap
  describe('CCR-2: No category rule blocks overlap', () => {
    it('should return 409 when categories have no mutual concurrent rules', async () => {
      // Existing published Meeting event (no concurrent rules)
      const existingEvent = createPublishedEvent({
        eventTitle: 'Board Meeting',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Meeting'],
      });
      await insertEvents(db, [existingEvent]);

      // New B/M event at same time/room
      const newEvent = createPendingEvent({
        eventTitle: 'Bar Mitzvah',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Bnei Mitzvah'],
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  // CCR-3: Multi-category event uses union of rules
  describe('CCR-3: Multi-category event uses union of rules', () => {
    it('should allow publish when any of incoming event categories are allowed', async () => {
      // Existing Holiday event (allows Shabbat)
      const existingEvent = createPublishedEvent({
        eventTitle: 'High Holiday Service',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Holiday'],
      });
      await insertEvents(db, [existingEvent]);

      // New event with multiple categories including Shabbat (which Holiday allows)
      const newEvent = createPendingEvent({
        eventTitle: 'Special Shabbat',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Shabbat Services', 'Meeting'], // Shabbat is allowed by Holiday
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      expect(res.status).toBe(200);
    });
  });

  // CCR-4: No category rule falls back to per-event isAllowedConcurrent
  describe('CCR-4: Falls back to per-event flags when no category rules', () => {
    it('should allow publish when per-event isAllowedConcurrent is true and no category rules apply', async () => {
      // Existing event with isAllowedConcurrent (legacy per-event flag)
      const existingEvent = createPublishedEvent({
        eventTitle: 'Open Venue',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: [], // No categories = no category rules
        isAllowedConcurrent: true,
      });
      await insertEvents(db, [existingEvent]);

      const newEvent = createPendingEvent({
        eventTitle: 'New Event',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: [],
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      expect(res.status).toBe(200);
    });
  });

  // CCR-5: Bilateral grant (only conflict side has rule)
  describe('CCR-5: Bilateral grant from conflict side', () => {
    it('should allow publish when conflict event category grants incoming event category', async () => {
      // Existing published Shabbat event (Shabbat allows B/M)
      const existingEvent = createPublishedEvent({
        eventTitle: 'Shabbat Services',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Shabbat Services'],
      });
      await insertEvents(db, [existingEvent]);

      // New B/M event - B/M itself has NO rules, but Shabbat grants B/M
      const newEvent = createPendingEvent({
        eventTitle: 'Bat Mitzvah',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Bnei Mitzvah'],
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      // Shabbat Services category allows Bnei Mitzvah, so no conflict
      expect(res.status).toBe(200);
    });
  });

  // CCR-6: Category concurrent rules are read by conflict check
  describe('CCR-6: Category rules are used in conflict check', () => {
    it('should detect conflict when category rule is removed', async () => {
      // Remove the Shabbat -> B/M rule
      await db.collection(COLLECTIONS.CATEGORIES).updateOne(
        { _id: shabbatCatId },
        { $set: { allowedConcurrentCategories: [] } }
      );

      // Existing Shabbat event
      const existingEvent = createPublishedEvent({
        eventTitle: 'Shabbat Services',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Shabbat Services'],
      });
      await insertEvents(db, [existingEvent]);

      // New B/M event — should now conflict since rule was removed
      const newEvent = createPendingEvent({
        eventTitle: 'Bar Mitzvah',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Bnei Mitzvah'],
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });

    it('should allow overlap when adding a new category rule', async () => {
      // Add Meeting -> B/M rule
      await db.collection(COLLECTIONS.CATEGORIES).updateOne(
        { _id: meetingCatId },
        { $set: { allowedConcurrentCategories: [bneiMitzvahCatId] } }
      );

      // Existing Meeting event
      const existingEvent = createPublishedEvent({
        eventTitle: 'Board Meeting',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Meeting'],
      });
      await insertEvents(db, [existingEvent]);

      // New B/M event — should now be allowed
      const newEvent = createPendingEvent({
        eventTitle: 'Bar Mitzvah',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Bnei Mitzvah'],
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      expect(res.status).toBe(200);
    });

    it('should store allowedConcurrentCategories as ObjectIds in DB', async () => {
      const cat = await db.collection(COLLECTIONS.CATEGORIES).findOne({ _id: shabbatCatId });
      expect(cat.allowedConcurrentCategories).toHaveLength(1);
      expect(cat.allowedConcurrentCategories[0].toString()).toBe(bneiMitzvahCatId.toString());
    });
  });

  // CCR-7: Categories only in calendarData (production shape)
  describe('CCR-7: Conflict event with categories only in calendarData', () => {
    it('should allow overlap when conflict event stores categories only in calendarData', async () => {
      // Insert a published Shabbat event with categories ONLY in calendarData (strip top-level)
      const existingEvent = createPublishedEvent({
        eventTitle: 'Shabbat Services',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Shabbat Services'],
      });
      // Strip top-level categories to simulate production data shape
      delete existingEvent.categories;
      await insertEvents(db, [existingEvent]);

      // Verify the inserted event has no top-level categories
      const inserted = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: existingEvent._id });
      expect(inserted.categories).toBeUndefined();
      expect(inserted.calendarData.categories).toEqual(['Shabbat Services']);

      // New B/M event at same time/room — should be allowed by Shabbat's category rules
      const newEvent = createPendingEvent({
        eventTitle: 'Bar Mitzvah',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Bnei Mitzvah'],
      });
      await insertEvents(db, [newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: newEvent._version });

      expect(res.status).toBe(200);
    });
  });

  // CCR-8: Draft submit with category concurrent rules
  describe('CCR-8: Draft submit respects category concurrent rules', () => {
    it('should allow draft submit when existing event category grants draft category', async () => {
      // Existing published Shabbat event (allows B/M)
      const existingEvent = createPublishedEvent({
        eventTitle: 'Shabbat Services',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Shabbat Services'],
      });
      await insertEvents(db, [existingEvent]);

      // Create a draft B/M event
      const draft = createDraftEvent({
        eventTitle: 'Bar Mitzvah',
        startDateTime: conflictStart,
        endDateTime: conflictEnd,
        locations: [roomId],
        categories: ['Bnei Mitzvah'],
        calendarOwner: 'templeeventssandbox@emanuelnyc.org',
        calendarId: 'default',
      });
      await insertEvents(db, [draft]);

      const res = await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(draft._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: draft._version });

      // Admin submit auto-publishes; should succeed because Shabbat allows B/M
      expect(res.status).toBe(200);
    });
  });
});
