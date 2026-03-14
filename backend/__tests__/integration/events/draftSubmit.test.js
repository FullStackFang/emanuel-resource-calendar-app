/**
 * Draft Submit Tests (DS-1 to DS-13)
 *
 * Tests the draft submission workflow including:
 * - Requester submit → pending
 * - Admin/Approver submit → auto-published with Graph event
 * - Cross-user permissions
 * - Validation
 * - Recurring draft conflict downgrade (approver → pending, admin → published)
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createOtherRequester,
  createApprover,
  createAdmin,
  createViewer,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Draft Submit Tests (DS-1 to DS-13)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let requesterUser, otherRequesterUser, approverUser, adminUser, viewerUser;
  let requesterToken, otherRequesterToken, approverToken, adminToken, viewerToken;

  beforeAll(async () => {
    await initTestKeys();

    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    await db.createCollection(COLLECTIONS.USERS);
    await db.createCollection(COLLECTIONS.EVENTS);
    await db.createCollection(COLLECTIONS.LOCATIONS);
    await db.createCollection(COLLECTIONS.AUDIT_HISTORY);

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    if (mongoClient) await mongoClient.close();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    requesterUser = createRequester();
    otherRequesterUser = createOtherRequester();
    approverUser = createApprover();
    adminUser = createAdmin();
    viewerUser = createViewer();
    await insertUsers(db, [requesterUser, otherRequesterUser, approverUser, adminUser, viewerUser]);

    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
    viewerToken = await createMockToken(viewerUser);
  });

  /**
   * Helper to create a complete draft (passes validation)
   */
  function createCompleteDraft(overrides = {}) {
    return createDraftEvent({
      locations: [{ displayName: 'Room A' }],
      categories: ['Meeting'],
      setupTime: '15 minutes',
      doorOpenTime: '09:00',
      ...overrides,
    });
  }

  describe('DS-1: Requester submits own draft', () => {
    it('should transition draft to pending with no graphData or autoPublished', async () => {
      const draft = createCompleteDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Requester Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PENDING);
      expect(res.body.autoPublished).toBeUndefined();
      expect(res.body.event.graphData).toBeNull();
    });
  });

  describe('DS-2: Approver submits own draft', () => {
    it('should auto-publish with graphData and autoPublished flag', async () => {
      const draft = createCompleteDraft({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Approver Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
      expect(res.body.autoPublished).toBe(true);
      expect(res.body.graphEventId).toBeDefined();
      expect(res.body.event.graphData).toBeDefined();
      expect(res.body.event.graphData.id).toBeDefined();
    });
  });

  describe('DS-3: Admin submits own draft', () => {
    it('should auto-publish with graphData and autoPublished flag', async () => {
      const draft = createCompleteDraft({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Admin Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
      expect(res.body.autoPublished).toBe(true);
      expect(res.body.graphEventId).toBeDefined();
    });
  });

  describe('DS-4: Approver submits another user\'s draft', () => {
    it('should auto-publish (approvers can submit any draft)', async () => {
      const draft = createCompleteDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Someone Else Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
      expect(res.body.autoPublished).toBe(true);
    });
  });

  describe('DS-5: Requester cannot submit another user\'s draft', () => {
    it('should return 403', async () => {
      const draft = createCompleteDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Not My Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${otherRequesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/only.*submit.*own|permission denied/i);
    });
  });

  describe('DS-6: Viewer cannot submit another user\'s draft', () => {
    it('should return 403 when viewer tries to submit a draft they do not own', async () => {
      const draft = createCompleteDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Not Viewer Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body.error).toBeDefined();
    });
  });

  describe('DS-7: Auto-publish statusHistory entry', () => {
    it('should have statusHistory entry with published status and Auto-published reason', async () => {
      const draft = createCompleteDraft({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'History Check Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      const lastHistory = event.statusHistory[event.statusHistory.length - 1];
      expect(lastHistory.status).toBe('published');
      expect(lastHistory.reason).toMatch(/Auto-published/i);
      expect(lastHistory.changedByEmail).toBe(approverUser.email);
    });
  });

  describe('DS-8: Auto-publish stores graphData on event', () => {
    it('should have graphData.id set on the event document', async () => {
      const draft = createCompleteDraft({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Graph Data Check',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.graphData).toBeDefined();
      expect(event.graphData.id).toBeDefined();
      expect(event.graphData.iCalUId).toBeDefined();
      expect(event.graphData.webLink).toBeDefined();

      // Verify Graph API was called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.subject).toBe('Graph Data Check');
    });
  });

  describe('DS-9: Requester submit statusHistory entry', () => {
    it('should have statusHistory entry with pending status', async () => {
      const draft = createCompleteDraft({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Requester History Check',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      const lastHistory = event.statusHistory[event.statusHistory.length - 1];
      expect(lastHistory.status).toBe('pending');
      expect(lastHistory.reason).toBe('Submitted for review');
      expect(lastHistory.changedByEmail).toBe(requesterUser.email);
    });
  });

  describe('DS-10a: Admin simulating requester role skips auto-publish', () => {
    it('should transition to pending (not published) when X-Simulated-Role is requester', async () => {
      const draft = createCompleteDraft({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Simulated Requester Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'requester')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PENDING);
      expect(res.body.autoPublished).toBeUndefined();
      // Graph API should NOT have been called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(0);
    });
  });

  describe('DS-10b: Approver simulating viewer role skips auto-publish', () => {
    it('should transition to pending when X-Simulated-Role is viewer', async () => {
      const draft = createCompleteDraft({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Simulated Viewer Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .set('X-Simulated-Role', 'viewer')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PENDING);
      expect(res.body.autoPublished).toBeUndefined();
    });
  });

  describe('DS-10c: Simulating admin role still auto-publishes', () => {
    it('should auto-publish when X-Simulated-Role is admin', async () => {
      const draft = createCompleteDraft({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Simulated Admin Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'admin')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
      expect(res.body.autoPublished).toBe(true);
    });
  });

  describe('DS-10: Submit incomplete draft returns 400', () => {
    it('should return 400 with validationErrors when draft is missing required fields', async () => {
      // Create draft with no locations, categories, setupTime, or doorOpenTime
      const incompleteDraft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Incomplete Draft',
        locations: [],
        categories: [],
        setupTime: null,
        doorOpenTime: null,
      });
      const [savedDraft] = await insertEvents(db, [incompleteDraft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/incomplete/i);
      expect(res.body.validationErrors).toBeDefined();
      expect(res.body.validationErrors.length).toBeGreaterThanOrEqual(1);
      expect(res.body.validationErrors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/room/i),
          expect.stringMatching(/category/i),
        ])
      );
    });
  });

  describe('DS-11: Approver recurring draft with hard conflicts goes to pending', () => {
    it('should downgrade to pending when recurring occurrences conflict with published events', async () => {
      // Use a fixed Tuesday start date matching the recurring pattern
      const tuesdayStart = new Date('2026-03-17T10:00:00');
      const tuesdayEnd = new Date('2026-03-17T11:00:00');

      // Create a published event at the same time/room on a Tuesday that the recurring pattern will hit
      const conflictingEvent = createPublishedEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Blocking Published Event',
        startDateTime: tuesdayStart,
        endDateTime: tuesdayEnd,
        locations: [{ displayName: 'Room A' }],
        locationDisplayNames: ['Room A'],
        categories: ['Meeting'],
      });
      await insertEvents(db, [conflictingEvent]);

      // Create a recurring draft for the approver with same room/time
      const recurringDraft = createCompleteDraft({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Approver Recurring Draft',
        startDateTime: tuesdayStart,
        endDateTime: tuesdayEnd,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-04-14' },
          additions: [],
          exclusions: [],
        },
      });
      const [savedDraft] = await insertEvents(db, [recurringDraft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PENDING);
      expect(res.body.autoPublished).toBeUndefined();
      expect(res.body.conflictDowngradedToPending).toBe(true);
      expect(res.body.recurringConflicts).toBeDefined();
      expect(res.body.recurringConflicts.conflictingOccurrences).toBeGreaterThan(0);
      // No Graph event should have been created
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(0);
    });
  });

  describe('DS-12: Admin recurring draft with hard conflicts still auto-publishes', () => {
    it('should auto-publish for admin even when recurring occurrences have conflicts', async () => {
      const tuesdayStart = new Date('2026-03-17T10:00:00');
      const tuesdayEnd = new Date('2026-03-17T11:00:00');

      // Create a conflicting published event
      const conflictingEvent = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Blocking Published Event',
        startDateTime: tuesdayStart,
        endDateTime: tuesdayEnd,
        locations: [{ displayName: 'Room A' }],
        locationDisplayNames: ['Room A'],
        categories: ['Meeting'],
      });
      await insertEvents(db, [conflictingEvent]);

      // Create a recurring draft for the admin
      const recurringDraft = createCompleteDraft({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Admin Recurring Draft',
        startDateTime: tuesdayStart,
        endDateTime: tuesdayEnd,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-04-14' },
          additions: [],
          exclusions: [],
        },
      });
      const [savedDraft] = await insertEvents(db, [recurringDraft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
      expect(res.body.autoPublished).toBe(true);
      expect(res.body.conflictDowngradedToPending).toBeUndefined();
      expect(res.body.graphEventId).toBeDefined();
    });
  });

  describe('DS-13: Approver recurring draft without conflicts still auto-publishes', () => {
    it('should auto-publish for approver when no recurring conflicts exist', async () => {
      const tuesdayStart = new Date('2026-03-17T10:00:00');
      const tuesdayEnd = new Date('2026-03-17T11:00:00');

      // No conflicting events inserted — rooms are free

      const recurringDraft = createCompleteDraft({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Approver Recurring No Conflict',
        startDateTime: tuesdayStart,
        endDateTime: tuesdayEnd,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-04-14' },
          additions: [],
          exclusions: [],
        },
      });
      const [savedDraft] = await insertEvents(db, [recurringDraft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
      expect(res.body.autoPublished).toBe(true);
      expect(res.body.conflictDowngradedToPending).toBeUndefined();
      expect(res.body.graphEventId).toBeDefined();
    });
  });

  describe('DS-14: Auto-publish sends locations array to Graph', () => {
    it('should include locations array in Graph payload for multi-room draft', async () => {
      const draft = createDraftEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Multi-Room Draft',
        locationDisplayNames: 'Chapel; Social Hall',
      });
      const [saved] = await insertEvents(db, [draft]);

      await request(app)
        .post(`/api/room-reservations/draft/${saved._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls.length).toBe(1);
      expect(graphCalls[0].eventData.locations).toEqual([
        { displayName: 'Chapel', locationType: 'default' },
        { displayName: 'Social Hall', locationType: 'default' },
      ]);
    });
  });

  describe('DS-15: Auto-publish handles array locationDisplayNames', () => {
    it('should join array locationDisplayNames for Graph payload', async () => {
      const draft = createDraftEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Array Location Draft',
        locationDisplayNames: ['Room A', 'Room B'],
      });
      const [saved] = await insertEvents(db, [draft]);

      await request(app)
        .post(`/api/room-reservations/draft/${saved._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.location.displayName).toBe('Room A; Room B');
      expect(graphCalls[0].eventData.locations).toHaveLength(2);
    });
  });

  describe('DS-16: Auto-publish syncs occurrenceOverrides to Graph', () => {
    it('should PATCH Graph occurrences with overrides after auto-publish', async () => {
      const occurrenceDate = '2026-03-17';
      const mockOccId = 'mock-draft-occ-override';
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        { id: mockOccId, start: { dateTime: `${occurrenceDate}T14:00:00` }, end: { dateTime: `${occurrenceDate}T15:00:00` } }
      ]);

      const weeklyRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
      };

      const draft = createDraftEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Draft with Overrides',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
        occurrenceOverrides: [
          {
            occurrenceDate,
            categories: ['Special Event'],
          },
        ],
      });
      const [saved] = await insertEvents(db, [draft]);

      await request(app)
        .post(`/api/room-reservations/draft/${saved._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      const overrideUpdate = updateCalls.find(c => c.eventId === mockOccId);
      expect(overrideUpdate).toBeDefined();
      expect(overrideUpdate.eventData.categories).toEqual(['Special Event']);
    });
  });
});
