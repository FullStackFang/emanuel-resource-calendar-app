/**
 * Draft Submit Tests (DS-1 to DS-10)
 *
 * Tests the draft submission workflow including:
 * - Requester submit → pending
 * - Admin/Approver submit → auto-approved with Graph event
 * - Cross-user permissions
 * - Validation
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
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Draft Submit Tests (DS-1 to DS-10)', () => {
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
    it('should transition draft to pending with no graphData or autoApproved', async () => {
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
      expect(res.body.autoApproved).toBeUndefined();
      expect(res.body.event.graphData).toBeNull();
    });
  });

  describe('DS-2: Approver submits own draft', () => {
    it('should auto-approve with graphData and autoApproved flag', async () => {
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
      expect(res.body.event.status).toBe(STATUS.APPROVED);
      expect(res.body.autoApproved).toBe(true);
      expect(res.body.graphEventId).toBeDefined();
      expect(res.body.event.graphData).toBeDefined();
      expect(res.body.event.graphData.id).toBeDefined();
    });
  });

  describe('DS-3: Admin submits own draft', () => {
    it('should auto-approve with graphData and autoApproved flag', async () => {
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
      expect(res.body.event.status).toBe(STATUS.APPROVED);
      expect(res.body.autoApproved).toBe(true);
      expect(res.body.graphEventId).toBeDefined();
    });
  });

  describe('DS-4: Approver submits another user\'s draft', () => {
    it('should auto-approve (approvers can submit any draft)', async () => {
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
      expect(res.body.event.status).toBe(STATUS.APPROVED);
      expect(res.body.autoApproved).toBe(true);
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

  describe('DS-7: Auto-approve statusHistory entry', () => {
    it('should have statusHistory entry with approved status and Auto-approved reason', async () => {
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
      expect(lastHistory.status).toBe('approved');
      expect(lastHistory.reason).toMatch(/Auto-approved/i);
      expect(lastHistory.changedByEmail).toBe(approverUser.email);
    });
  });

  describe('DS-8: Auto-approve stores graphData on event', () => {
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
});
