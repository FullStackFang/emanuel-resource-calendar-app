/**
 * Event Approval Tests (A-7)
 *
 * Tests the approval workflow for pending events by approvers.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createDraftEvent,
  createApprovedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Event Approval Tests (A-7)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();

    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    // Create collections
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
    // Clear collections
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    // Reset graph API mock
    graphApiMock.resetMocks();

    // Create test users
    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    // Create token
    approverToken = await createMockToken(approverUser);
  });

  describe('A-7: Approve pending event', () => {
    it('should transition pending event to approved', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event to Approve',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.APPROVED);
      expect(res.body.event.approvedAt).toBeDefined();
      expect(res.body.event.approvedBy).toBe(approverUser.email);
    });

    it('should create Graph API event on approval', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Graph Sync Event',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .put(`/api/admin/events/${savedPending._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      // Verify Graph API was called
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.subject).toBe('Graph Sync Event');
    });

    it('should store graphData in the event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.event.graphData).toBeDefined();
      expect(res.body.event.graphData.id).toBeDefined();
      expect(res.body.event.graphData.iCalUId).toBeDefined();
      expect(res.body.event.graphData.iCalUId).toMatch(/^ical-/);
      expect(res.body.event.graphData.webLink).toBeDefined();
    });

    it('should create audit log entry', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .put(`/api/admin/events/${savedPending._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedPending.eventId,
        action: 'approved',
        performedBy: approverUser.odataId,
      });
    });

    it('should return 404 for non-existent event', async () => {
      const res = await request(app)
        .put('/api/admin/events/507f1f77bcf86cd799439011/approve')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('should return 400 when trying to approve draft', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDraft._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/cannot approve/i);
    });

    it('should return 400 when trying to approve already approved event', async () => {
      const approved = createApprovedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedApproved] = await insertEvents(db, [approved]);

      const res = await request(app)
        .put(`/api/admin/events/${savedApproved._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/cannot approve/i);
    });

    it('should handle Graph API failure gracefully', async () => {
      // Set mock to fail
      graphApiMock.setMockError('createCalendarEvent', new Error('Graph API unavailable'));

      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(500);

      expect(res.body.error).toBeDefined();

      // Verify event status was not changed
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPending._id });
      expect(event.status).toBe(STATUS.PENDING);
    });
  });
});
