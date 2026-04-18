/**
 * Event Publishing Tests (A-7)
 *
 * Tests the publishing workflow for pending events by approvers.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createDraftEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Event Publishing Tests (A-7)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('eventPublish'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
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

  describe('A-7: Publish pending event', () => {
    it('should transition pending event to published', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event to Publish',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Real server returns { success, _version, changeKey } — verify status in DB
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPending._id });
      expect(updated.status).toBe(STATUS.PUBLISHED);
      expect(updated.roomReservationData.reviewedBy.reviewedAt).toBeDefined();
      expect(updated.roomReservationData.reviewedBy.name).toBeDefined();
    });

    it('should create Graph API event on publishing', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Graph Sync Event',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .put(`/api/admin/events/${savedPending._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ createCalendarEvent: true })
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
        graphData: {},  // Must be non-null for MongoDB dot-notation $set to work
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ createCalendarEvent: true })
        .expect(200);

      // Real server stores graphData in DB via fire-and-forget with 500ms setTimeout;
      // allow enough time for the deferred write to complete
      await new Promise(r => setTimeout(r, 1500));
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPending._id });
      expect(updated.graphData).toBeDefined();
      expect(updated.graphData.id).toBeDefined();
      expect(updated.graphData.iCalUId).toBeDefined();
      expect(updated.graphData.iCalUId).toMatch(/^ical-/);
    });

    it('should create audit log entry', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .put(`/api/admin/events/${savedPending._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedPending.eventId,
        action: 'published',
        performedBy: approverUser.odataId,
      });
    });

    it('should return 404 for non-existent event', async () => {
      const res = await request(app)
        .put('/api/admin/events/507f1f77bcf86cd799439011/publish')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('should return 400 when trying to publish draft', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDraft._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/cannot publish|not a pending/i);
    });

    it('should return 400 when trying to publish already published event', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPublished._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/cannot publish|not a pending/i);
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
        .put(`/api/admin/events/${savedPending._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ createCalendarEvent: true })
        .expect(500);

      expect(res.body.error).toBeDefined();

      // Verify event status was not changed
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPending._id });
      expect(event.status).toBe(STATUS.PENDING);
    });
  });
});
