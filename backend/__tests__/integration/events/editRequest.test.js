/**
 * Edit Request Tests (A-14 to A-17)
 *
 * Tests the edit request workflow for published events.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Edit Request Tests (A-14 to A-17)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

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

    // Create test users
    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  describe('A-14: View edit requests', () => {
    it('should return events with pending edit requests', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        requestedChanges: { eventTitle: 'New Title' },
        editReason: 'Need to update',
      });
      await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .get('/api/admin/events')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const eventWithEditReq = res.body.events.find(e => e.pendingEditRequest);
      expect(eventWithEditReq).toBeDefined();
      expect(eventWithEditReq.pendingEditRequest.requestedChanges.eventTitle).toBe('New Title');
    });
  });

  describe('A-15: Approve edit request', () => {
    it('should apply requested changes to event', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        eventDescription: 'Original description',
        requestedChanges: {
          eventTitle: 'Updated Title',
          eventDescription: 'Updated description',
        },
        editReason: 'Need to correct info',
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${savedEvent._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.eventTitle).toBe('Updated Title');
      expect(res.body.event.eventDescription).toBe('Updated description');
      expect(res.body.event.pendingEditRequest).toBeUndefined();
    });

    it('should create audit log entry', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requestedChanges: { eventTitle: 'New Title' },
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      await request(app)
        .put(`/api/admin/events/${savedEvent._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedEvent.eventId,
        action: 'edit_approved',
        performedBy: approverUser.odataId,
      });
    });

    it('should return 400 when no pending edit request exists', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPublished._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/no pending edit request/i);
    });
  });

  describe('A-16: Reject edit request', () => {
    it('should remove edit request without applying changes', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        requestedChanges: { eventTitle: 'New Title' },
        editReason: 'Wanted to change',
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${savedEvent._id}/reject-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Change not appropriate' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.eventTitle).toBe('Original Title'); // Unchanged
      expect(res.body.event.pendingEditRequest).toBeUndefined();
    });

    it('should require rejection reason', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requestedChanges: { eventTitle: 'New Title' },
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${savedEvent._id}/reject-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({}) // No reason
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('should create audit log entry', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requestedChanges: { eventTitle: 'New Title' },
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      await request(app)
        .put(`/api/admin/events/${savedEvent._id}/reject-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Not allowed' })
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedEvent.eventId,
        action: 'edit_rejected',
        performedBy: approverUser.odataId,
      });
    });

    it('should return 400 when no pending edit request exists', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPublished._id}/reject-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Test' })
        .expect(400);

      expect(res.body.error).toMatch(/no pending edit request/i);
    });
  });

  describe('A-17: Edit request archived after processing', () => {
    it('should remove pendingEditRequest after approval', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requestedChanges: { eventTitle: 'New Title' },
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      await request(app)
        .put(`/api/admin/events/${savedEvent._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      // Verify in database
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(event.pendingEditRequest).toBeUndefined();
    });

    it('should remove pendingEditRequest after rejection', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requestedChanges: { eventTitle: 'New Title' },
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      await request(app)
        .put(`/api/admin/events/${savedEvent._id}/reject-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Not allowed' })
        .expect(200);

      // Verify in database
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(event.pendingEditRequest).toBeUndefined();
    });
  });

  describe('Edit request creation', () => {
    it('should allow requester to create edit request', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${savedPublished._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedChanges: { eventTitle: 'New Title' },
          reason: 'Need to update',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest).toBeDefined();
      expect(res.body.event.pendingEditRequest.requestedChanges.eventTitle).toBe('New Title');
      expect(res.body.event.pendingEditRequest.reason).toBe('Need to update');
    });

    it('should require both requestedChanges and reason', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      // Missing reason
      let res = await request(app)
        .post(`/api/events/${savedPublished._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedChanges: { eventTitle: 'New Title' },
        })
        .expect(400);

      expect(res.body.error).toMatch(/required/i);

      // Missing requestedChanges
      res = await request(app)
        .post(`/api/events/${savedPublished._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          reason: 'Need to update',
        })
        .expect(400);

      expect(res.body.error).toMatch(/required/i);
    });

    it('should only allow edit requests on published events', async () => {
      const pending = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      // Change status to pending
      pending.status = STATUS.PENDING;
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .post(`/api/events/${savedPending._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedChanges: { eventTitle: 'New Title' },
          reason: 'Need to update',
        })
        .expect(400);

      expect(res.body.error).toMatch(/only.*published/i);
    });
  });

  describe('Approver changes on edit requests', () => {
    it('should merge approver changes with proposed changes', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        eventDescription: 'Original description',
        requestedChanges: {
          eventTitle: 'Requester Title',
          eventDescription: 'Requester description',
        },
        editReason: 'Need to update',
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${savedEvent._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          approverChanges: {
            eventTitle: 'Approver Title',
          },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      // Approver's title override should take effect
      expect(res.body.event.eventTitle).toBe('Approver Title');
      // Requester's description change should still be applied
      expect(res.body.event.eventDescription).toBe('Requester description');
    });

    it('should work without approver changes (backward compatible)', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        requestedChanges: {
          eventTitle: 'Requester Title',
        },
        editReason: 'Need to update',
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${savedEvent._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.eventTitle).toBe('Requester Title');
    });

    it('should allow approver to add fields not in original request', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        requestedChanges: {
          eventTitle: 'Requester Title',
        },
        editReason: 'Need to update',
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${savedEvent._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          approverChanges: {
            eventDescription: 'Approver added description',
          },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      // Requester's title change should still apply
      expect(res.body.event.eventTitle).toBe('Requester Title');
      // Approver's additional field should apply
      expect(res.body.event.eventDescription).toBe('Approver added description');
    });

    it('should record approver changes in audit log', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        requestedChanges: {
          eventTitle: 'Requester Title',
        },
        editReason: 'Need to update',
      });
      const [savedEvent] = await insertEvents(db, [eventWithEdit]);

      await request(app)
        .put(`/api/admin/events/${savedEvent._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          approverChanges: {
            eventTitle: 'Approver Title',
          },
        })
        .expect(200);

      const audit = await db.collection(COLLECTIONS.AUDIT_HISTORY).findOne({
        eventId: savedEvent.eventId,
        action: 'edit_approved',
      });

      expect(audit).toBeTruthy();
      expect(audit.metadata).toBeDefined();
      expect(audit.metadata.approverChanges).toEqual({ eventTitle: 'Approver Title' });
      expect(audit.metadata.originalProposedChanges).toEqual({ eventTitle: 'Requester Title' });
    });
  });
});
