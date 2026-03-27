/**
 * Occurrence Override Persistence Tests (OOP-1 to OOP-8)
 *
 * Tests bulk occurrence override persistence via the Recurrence tab:
 * - OOP-1: Admin save (allEvents) persists occurrenceOverrides
 * - OOP-2: Admin save frontend override wins over cascade for same date
 * - OOP-3: Admin save cascade updates inherited overrides, skips custom ones
 * - OOP-4: Admin save adds new overrides (dates not in existing array)
 * - OOP-5: Admin save (thisEvent) ignores bulk occurrenceOverrides
 * - OOP-6: Draft save persists occurrenceOverrides
 * - OOP-7: Draft save clearOccurrenceOverrides takes precedence
 * - OOP-8: Draft save writes overrides to both top-level and calendarData
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Occurrence Override Persistence Tests (OOP-1 to OOP-8)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken, requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('occurrenceOverridePersistence'));
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

    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // ── Helpers ──────────────────────────────────────────────────────

  const RECURRENCE = {
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-13' },
    additions: [],
    exclusions: [],
  };

  function createTestSeriesMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      status: STATUS.PENDING,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      recurrence: RECURRENCE,
      startDateTime: new Date('2026-03-11T14:00:00'),
      endDateTime: new Date('2026-03-11T15:00:00'),
      calendarData: {
        eventTitle: 'Daily Standup',
        eventDescription: 'Test recurring event',
        startDateTime: '2026-03-11T14:00:00',
        endDateTime: '2026-03-11T15:00:00',
        startDate: '2026-03-11',
        startTime: '14:00',
        endDate: '2026-03-11',
        endTime: '15:00',
        locations: [],
        locationDisplayNames: '',
        categories: ['Meeting'],
        recurrence: RECURRENCE,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      ...overrides,
    });
  }

  function createTestDraft(overrides = {}) {
    return createDraftEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventType: 'seriesMaster',
      recurrence: RECURRENCE,
      startDateTime: new Date('2026-03-11T14:00:00'),
      endDateTime: new Date('2026-03-11T15:00:00'),
      calendarData: {
        eventTitle: 'Recurring Draft',
        eventDescription: 'Test recurring draft',
        startDateTime: '2026-03-11T14:00:00',
        endDateTime: '2026-03-11T15:00:00',
        startDate: '2026-03-11',
        startTime: '14:00',
        endDate: '2026-03-11',
        endTime: '15:00',
        locations: [],
        locationDisplayNames: '',
        categories: ['Meeting'],
        recurrence: RECURRENCE,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      ...overrides,
    });
  }

  // ── Admin Save Tests ────────────────────────────────────────────

  describe('OOP-1: Admin save (allEvents) persists occurrenceOverrides', () => {
    it('should persist bulk occurrenceOverrides in the save payload', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const overrides = [
        { occurrenceDate: '2026-03-11', eventTitle: 'Custom Monday' },
        { occurrenceDate: '2026-03-12', startTime: '16:00', endTime: '17:00' },
      ];

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Daily Standup',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: RECURRENCE,
          occurrenceOverrides: overrides,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updated.occurrenceOverrides).toHaveLength(2);
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-11').eventTitle).toBe('Custom Monday');
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12').startTime).toBe('16:00');

      // Also persisted in calendarData
      expect(updated.calendarData.occurrenceOverrides).toHaveLength(2);
    });
  });

  describe('OOP-2: Admin save frontend override wins over cascade for same date', () => {
    it('should prefer frontend override fields over cascade result', async () => {
      // Master has existing overrides that inherited the title
      const master = createTestSeriesMaster({
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-12', eventTitle: 'Daily Standup', eventDescription: 'Custom desc' },
        ],
      });
      await insertEvents(db, [master]);

      // Change master title (cascade should propagate to inherited titles)
      // But also send frontend overrides with a DIFFERENT custom title for 3/12
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'New Master Title',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: RECURRENCE,
          occurrenceOverrides: [
            { occurrenceDate: '2026-03-12', eventTitle: 'Frontend Override Title', eventDescription: 'Custom desc' },
          ],
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const override = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      // Frontend override wins
      expect(override.eventTitle).toBe('Frontend Override Title');
      // Custom desc preserved (not affected by cascade since master desc didn't change)
      expect(override.eventDescription).toBe('Custom desc');
    });
  });

  describe('OOP-3: Admin save cascade updates inherited overrides, skips custom ones', () => {
    it('should cascade master title change to inherited override but not custom one', async () => {
      const master = createTestSeriesMaster({
        occurrenceOverrides: [
          // This one inherits the master title (matches) — cascade should update it
          { occurrenceDate: '2026-03-11', eventTitle: 'Daily Standup' },
          // This one has a custom title — cascade should skip it
          { occurrenceDate: '2026-03-12', eventTitle: 'Custom Title' },
        ],
      });
      await insertEvents(db, [master]);

      // Change master title, but do NOT send occurrenceOverrides in payload
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'New Master Title',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: RECURRENCE,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const o11 = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-11');
      const o12 = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      // Inherited title was cascaded
      expect(o11.eventTitle).toBe('New Master Title');
      // Custom title was NOT cascaded
      expect(o12.eventTitle).toBe('Custom Title');
    });
  });

  describe('OOP-4: Admin save adds new overrides not in existing array', () => {
    it('should merge new overrides with existing ones', async () => {
      const master = createTestSeriesMaster({
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-11', eventTitle: 'Existing Override' },
        ],
      });
      await insertEvents(db, [master]);

      // Send overrides that include the existing one and a new one
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Daily Standup',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: RECURRENCE,
          occurrenceOverrides: [
            { occurrenceDate: '2026-03-11', eventTitle: 'Updated Existing' },
            { occurrenceDate: '2026-03-13', eventTitle: 'Brand New Override' },
          ],
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updated.occurrenceOverrides).toHaveLength(2);
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-11').eventTitle).toBe('Updated Existing');
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-13').eventTitle).toBe('Brand New Override');
    });
  });

  describe('OOP-5: Admin save (thisEvent) ignores bulk occurrenceOverrides', () => {
    it('should use $pull/$push for thisEvent, not bulk array', async () => {
      const master = createTestSeriesMaster({
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-11', eventTitle: 'Old Override' },
        ],
      });
      await insertEvents(db, [master]);

      // Send thisEvent edit WITH bulk occurrenceOverrides — bulk should be ignored
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'This Event Edit',
          startTime: '16:00',
          endTime: '17:00',
          occurrenceOverrides: [
            { occurrenceDate: '2026-03-13', eventTitle: 'Should Be Ignored' },
          ],
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      // Should have old override + new thisEvent override
      expect(updated.occurrenceOverrides).toHaveLength(2);
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-11').eventTitle).toBe('Old Override');
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12').eventTitle).toBe('This Event Edit');
      // The bulk-provided 3/13 override should NOT exist
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-13')).toBeUndefined();
    });
  });

  // ── Draft Save Tests ────────────────────────────────────────────

  describe('OOP-6: Draft save persists occurrenceOverrides', () => {
    it('should persist bulk occurrenceOverrides in draft save payload', async () => {
      const draft = createTestDraft();
      await insertEvents(db, [draft]);

      const overrides = [
        { occurrenceDate: '2026-03-11', eventTitle: 'Custom Draft Day 1' },
        { occurrenceDate: '2026-03-12', startTime: '16:00', endTime: '17:00' },
      ];

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Recurring Draft',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: RECURRENCE,
          occurrenceOverrides: overrides,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toHaveLength(2);
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-11').eventTitle).toBe('Custom Draft Day 1');
      expect(updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12').startTime).toBe('16:00');
    });
  });

  describe('OOP-7: Draft save clearOccurrenceOverrides takes precedence', () => {
    it('should clear overrides even when occurrenceOverrides is also provided', async () => {
      const draft = createTestDraft({
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-12', eventTitle: 'Existing' },
        ],
      });
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Recurring Draft',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: RECURRENCE,
          clearOccurrenceOverrides: true,
          occurrenceOverrides: [
            { occurrenceDate: '2026-03-13', eventTitle: 'Should Not Persist' },
          ],
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toEqual([]);
      expect(updated.calendarData.occurrenceOverrides).toEqual([]);
    });
  });

  describe('OOP-8: Draft save writes overrides to both top-level and calendarData', () => {
    it('should write occurrenceOverrides to both storage locations', async () => {
      const draft = createTestDraft();
      await insertEvents(db, [draft]);

      const overrides = [
        { occurrenceDate: '2026-03-12', eventTitle: 'Dual Storage Test' },
      ];

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Recurring Draft',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: RECURRENCE,
          occurrenceOverrides: overrides,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });

      // Top-level
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-12');
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Dual Storage Test');

      // calendarData mirror
      expect(updated.calendarData.occurrenceOverrides).toHaveLength(1);
      expect(updated.calendarData.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-12');
      expect(updated.calendarData.occurrenceOverrides[0].eventTitle).toBe('Dual Storage Test');
    });
  });
});
