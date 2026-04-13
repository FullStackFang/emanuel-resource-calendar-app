/**
 * Recurring Occurrence Additional Info Edit Tests (ROA-1 to ROA-4)
 *
 * Tests editing "Additional Information" tab fields on a recurring event occurrence
 * via PUT /api/admin/events/:id with editScope='thisEvent'.
 *
 * Reproduces reported 500 error when saving occurrence edits.
 *
 * ROA-1: Minimal payload — editScope + setupNotes (baseline)
 * ROA-2: Full frontend payload — mimics real editableData from useReviewModal
 * ROA-3: Published series master — triggers Graph sync code path
 * ROA-4: Edit doorNotes and setupNotes together
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
  createRecurringSeriesMaster,
  createPublishedEventWithGraph,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Recurring Occurrence Additional Info Edit Tests (ROA-1 to ROA-4)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurringOccurrenceAdditionalInfo'));
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
  });

  // ── Helpers ──────────────────────────────────────────────────────

  const RECURRENCE = {
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-15' },
    additions: [],
    exclusions: [],
  };

  function createPendingSeriesMaster(overrides = {}) {
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
        startDateTime: '2026-03-11T14:00',
        endDateTime: '2026-03-11T15:00',
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
        setupNotes: '',
        doorNotes: '',
        eventNotes: '',
        specialRequirements: '',
      },
      ...overrides,
    });
  }

  /**
   * Build a payload that mimics what the real frontend sends via useReviewModal.handleSave.
   * The frontend spreads the full occurrence editableData (including calendarData, graphData,
   * roomReservationData, start/end objects, etc.) and adds editScope + occurrenceDate on top.
   */
  function buildFullFrontendPayload(master, occurrenceDate, fieldOverrides = {}) {
    return {
      // === Fields from editableData (occurrence item spread) ===
      // These are the extra fields the frontend includes but the thisEvent handler ignores
      _id: String(master._id),
      eventId: `${master.eventId}-occurrence-${occurrenceDate}`,
      calendarData: master.calendarData,
      roomReservationData: master.roomReservationData,
      graphData: master.graphData ? {
        ...master.graphData,
        id: `${master.graphData.id}-occurrence-${occurrenceDate}`,
        type: 'occurrence',
        seriesMasterId: master.graphData.id,
      } : null,
      start: { dateTime: `${occurrenceDate}T14:00`, timeZone: 'America/New_York' },
      end: { dateTime: `${occurrenceDate}T15:00`, timeZone: 'America/New_York' },
      startDateTime: `${occurrenceDate}T14:00`,
      endDateTime: `${occurrenceDate}T15:00`,
      startDate: occurrenceDate,
      startTime: '14:00',
      endDate: occurrenceDate,
      endTime: '15:00',
      isRecurringOccurrence: true,
      masterEventId: master.eventId,
      eventTitle: master.calendarData?.eventTitle || 'Daily Standup',
      eventDescription: master.calendarData?.eventDescription || '',
      categories: master.calendarData?.categories || ['Meeting'],
      services: master.calendarData?.services || [],
      locations: master.calendarData?.locations || [],
      recurrence: RECURRENCE, // notifyDataChange sends master's recurrence

      // === Edit scope fields ===
      editScope: 'thisEvent',
      occurrenceDate: `${occurrenceDate}T14:00`,
      seriesMasterId: master.graphData?.id || master.seriesMasterId || null,

      // === OCC ===
      _version: master._version || 1,

      // === User's edit (the actual field change) ===
      ...fieldOverrides,
    };
  }

  // ── ROA-1: Minimal payload (baseline) ──

  describe('ROA-1: Minimal thisEvent payload with setupNotes edit', () => {
    it('should save setupNotes override on occurrence with minimal payload', async () => {
      const master = createPendingSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          setupNotes: 'Bring extra chairs',
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const override = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      expect(override).toBeDefined();
      expect(override.setupNotes).toBe('Bring extra chairs');
    });
  });

  // ── ROA-2: Full frontend payload ──

  describe('ROA-2: Full frontend payload with setupNotes edit', () => {
    it('should save setupNotes override when full editableData payload is sent', async () => {
      const master = createPendingSeriesMaster();
      await insertEvents(db, [master]);

      const payload = buildFullFrontendPayload(master, '2026-03-12', {
        setupNotes: 'AV setup needed',
      });

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const override = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      expect(override).toBeDefined();
      expect(override.setupNotes).toBe('AV setup needed');
    });
  });

  // ── ROA-3: Published series master with Graph sync ──

  describe('ROA-3: Published series master occurrence edit triggers Graph sync path', () => {
    it('should save setupNotes on published recurring event without 500 error', async () => {
      const graphId = 'AAMkAGraphRecurring123';
      const master = createRecurringSeriesMaster({
        status: STATUS.PUBLISHED,
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        recurrence: RECURRENCE,
        startDateTime: new Date('2026-03-11T14:00:00'),
        endDateTime: new Date('2026-03-11T15:00:00'),
        eventType: 'seriesMaster',
        graphData: {
          id: graphId,
          iCalUId: `ical-${graphId}`,
          subject: 'Daily Standup',
          start: { dateTime: '2026-03-11T14:00:00', timeZone: 'America/New_York' },
          end: { dateTime: '2026-03-11T15:00:00', timeZone: 'America/New_York' },
        },
        calendarData: {
          eventTitle: 'Daily Standup',
          eventDescription: 'Test recurring event',
          startDateTime: '2026-03-11T14:00',
          endDateTime: '2026-03-11T15:00',
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
          setupNotes: '',
          doorNotes: '',
        },
      });
      await insertEvents(db, [master]);

      // Mock: return an instance for the occurrence date
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        {
          id: `${graphId}-instance-2026-03-12`,
          start: { dateTime: '2026-03-12T14:00:00', timeZone: 'America/New_York' },
          end: { dateTime: '2026-03-12T15:00:00', timeZone: 'America/New_York' },
        },
      ]);

      const payload = buildFullFrontendPayload(master, '2026-03-12', {
        setupNotes: 'Projector needed',
      });

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const override = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      expect(override).toBeDefined();
      expect(override.setupNotes).toBe('Projector needed');
    });
  });

  // ── ROA-5: Reproduce 500 error — occurrenceOverrides is null ──

  describe('ROA-5: Occurrence edit when occurrenceOverrides is null (500 bug)', () => {
    it('should NOT 500 when series master has occurrenceOverrides: null', async () => {
      // This reproduces the actual bug: creation endpoints set occurrenceOverrides: null
      // instead of []. When the thisEvent handler does $pull on null, MongoDB throws
      // "Cannot apply $pull to a non-array value".
      const master = createPendingSeriesMaster({
        occurrenceOverrides: null, // <-- The root cause!
        calendarData: {
          eventTitle: 'Daily Standup',
          eventDescription: 'Test recurring event',
          startDateTime: '2026-03-11T14:00',
          endDateTime: '2026-03-11T15:00',
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
          setupNotes: '',
          doorNotes: '',
          occurrenceOverrides: null, // Also null in calendarData
        },
      });
      await insertEvents(db, [master]);

      // Verify the document actually has null (not undefined or [])
      const before = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(before.occurrenceOverrides).toBeNull();

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          setupNotes: 'New setup notes',
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(Array.isArray(updated.occurrenceOverrides)).toBe(true);
      const override = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      expect(override).toBeDefined();
      expect(override.setupNotes).toBe('New setup notes');
    });
  });

  // ── ROA-4: Edit doorNotes and setupNotes together ──

  describe('ROA-4: Edit multiple Additional Information fields on occurrence', () => {
    it('should save both doorNotes and setupNotes overrides', async () => {
      const master = createPendingSeriesMaster();
      await insertEvents(db, [master]);

      const payload = buildFullFrontendPayload(master, '2026-03-13', {
        setupNotes: 'Extra tables needed',
        doorNotes: 'Lock side entrance',
        eventNotes: 'VIP event',
        specialRequirements: 'Wheelchair access',
      });

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(master._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      const override = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-13');
      expect(override).toBeDefined();
      expect(override.setupNotes).toBe('Extra tables needed');
      expect(override.doorNotes).toBe('Lock side entrance');
      expect(override.eventNotes).toBe('VIP event');
      expect(override.specialRequirements).toBe('Wheelchair access');
    });
  });
});
