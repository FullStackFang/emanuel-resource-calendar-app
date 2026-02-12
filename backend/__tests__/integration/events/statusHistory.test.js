/**
 * StatusHistory Tracking Tests (SH-1 to SH-12)
 *
 * Tests that all status transitions push entries to statusHistory,
 * and that restore correctly uses statusHistory to determine the previous status.
 *
 * SH-1 to SH-3: Submit, publish, reject push to statusHistory
 * SH-4 to SH-6: Delete + restore uses statusHistory to restore correct status
 * SH-7 to SH-9: Cancel, resubmit push to statusHistory
 * SH-10 to SH-12: Full lifecycle tests (submit → publish → delete → restore)
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createRequester, createAdmin, createApprover, insertUsers } = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createPublishedEvent,
  createRejectedEvent,
  createDeletedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('StatusHistory Tracking Tests (SH-1 to SH-12)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let approverUser;
  let approverToken;
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();

    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

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
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});
    graphApiMock.resetMocks();

    requesterUser = createRequester();
    approverUser = createApprover();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, approverUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  // ============================================
  // SH-1 to SH-3: Basic statusHistory recording
  // ============================================

  describe('SH-1: Submit pushes to statusHistory', () => {
    it('should record pending entry in statusHistory when draft is submitted', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Draft to Submit',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.event.status).toBe(STATUS.PENDING);

      // Verify statusHistory was populated (factory creates initial draft entry + submit adds pending)
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.statusHistory).toBeDefined();
      expect(event.statusHistory).toHaveLength(2);
      expect(event.statusHistory[0].status).toBe(STATUS.DRAFT); // Initial from factory
      expect(event.statusHistory[1].status).toBe(STATUS.PENDING);
      expect(event.statusHistory[1].changedBy).toBe(requesterUser.odataId);
      expect(event.statusHistory[1].changedByEmail).toBe(requesterUser.email);
      expect(event.statusHistory[1].reason).toBe('Submitted for review');
    });
  });

  describe('SH-2: Publish pushes to statusHistory', () => {
    it('should record published entry in statusHistory when event is published', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Pending to Publish',
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date(), changedBy: requesterUser.odataId, changedByEmail: requesterUser.email, reason: 'Submitted for review' },
        ],
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.event.status).toBe(STATUS.PUBLISHED);

      // Verify statusHistory has 2 entries (pending + published)
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.statusHistory).toHaveLength(2);
      expect(event.statusHistory[1].status).toBe(STATUS.PUBLISHED);
      expect(event.statusHistory[1].changedByEmail).toBe(approverUser.email);
    });
  });

  describe('SH-3: Reject pushes to statusHistory', () => {
    it('should record rejected entry in statusHistory when event is rejected', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Pending to Reject',
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date(), changedBy: requesterUser.odataId, changedByEmail: requesterUser.email, reason: 'Submitted for review' },
        ],
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(ENDPOINTS.REJECT_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Room not available', _version: saved._version })
        .expect(200);

      expect(res.body.event.status).toBe(STATUS.REJECTED);

      // Verify statusHistory has 2 entries (pending + rejected)
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.statusHistory).toHaveLength(2);
      expect(event.statusHistory[1].status).toBe(STATUS.REJECTED);
      expect(event.statusHistory[1].changedByEmail).toBe(approverUser.email);
      expect(event.statusHistory[1].reason).toBe('Room not available');
    });
  });

  // ============================================
  // SH-4 to SH-6: Delete + Restore with statusHistory
  // ============================================

  describe('SH-4: Submitted pending event restores to pending (not draft)', () => {
    it('should restore to pending when event was submitted then deleted', async () => {
      // Create a deleted event that had been submitted (pending) before deletion
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Was Pending Before Delete',
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedBy: requesterUser.odataId, changedByEmail: requesterUser.email, reason: 'Submitted for review' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-02'), changedBy: adminUser.odataId, changedByEmail: adminUser.email, reason: 'Deleted by admin' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      // Should restore to pending, NOT draft
      expect(res.body.status).toBe(STATUS.PENDING);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.status).toBe(STATUS.PENDING);
      expect(event.isDeleted).toBe(false);
    });
  });

  describe('SH-5: Published event restores to published', () => {
    it('should restore to published when event was published then deleted', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Was Published Before Delete',
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedBy: requesterUser.odataId, changedByEmail: requesterUser.email, reason: 'Submitted for review' },
          { status: STATUS.PUBLISHED, changedAt: new Date('2026-01-02'), changedBy: approverUser.odataId, changedByEmail: approverUser.email, reason: 'Published' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedBy: adminUser.odataId, changedByEmail: adminUser.email, reason: 'Deleted by admin' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.PUBLISHED);
    });
  });

  describe('SH-6: Rejected event restores to rejected', () => {
    it('should restore to rejected when event was rejected then deleted', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Was Rejected Before Delete',
        statusHistory: [
          { status: STATUS.PENDING, changedAt: new Date('2026-01-01'), changedBy: requesterUser.odataId, changedByEmail: requesterUser.email, reason: 'Submitted for review' },
          { status: STATUS.REJECTED, changedAt: new Date('2026-01-02'), changedBy: approverUser.odataId, changedByEmail: approverUser.email, reason: 'No room' },
          { status: STATUS.DELETED, changedAt: new Date('2026-01-03'), changedBy: adminUser.odataId, changedByEmail: adminUser.email, reason: 'Deleted by admin' },
        ],
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.REJECTED);
    });
  });

  // ============================================
  // SH-7 to SH-9: Full lifecycle submit → delete → restore
  // ============================================

  describe('SH-7: Full lifecycle: submit → delete → restore returns to pending', () => {
    it('should restore a submitted-then-deleted event back to pending', async () => {
      // Step 1: Create draft and submit it
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Lifecycle Test - Submit Delete Restore',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      // Submit the draft
      await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(savedDraft._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      // Verify it's now pending with statusHistory (factory draft entry + submit pending entry)
      let event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.status).toBe(STATUS.PENDING);
      expect(event.statusHistory).toHaveLength(2);
      expect(event.statusHistory[1].status).toBe(STATUS.PENDING);

      // Step 2: Admin deletes the pending event
      await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      // Verify it's deleted with 3 statusHistory entries (draft + pending + deleted)
      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.status).toBe(STATUS.DELETED);
      expect(event.statusHistory).toHaveLength(3);
      expect(event.statusHistory[2].status).toBe(STATUS.DELETED);

      // Step 3: Admin restores the event
      const restoreRes = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      // Should restore to PENDING (not draft)
      expect(restoreRes.body.status).toBe(STATUS.PENDING);

      // Verify final state (draft + pending + deleted + restored)
      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.status).toBe(STATUS.PENDING);
      expect(event.isDeleted).toBe(false);
      expect(event.statusHistory).toHaveLength(4);
      expect(event.statusHistory[3].status).toBe(STATUS.PENDING);
      expect(event.statusHistory[3].reason).toBe('Restored by admin');
    });
  });

  describe('SH-8: Full lifecycle: submit → publish → delete → restore returns to published', () => {
    it('should restore a submitted-published-deleted event back to published', async () => {
      // Step 1: Create draft and submit
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Lifecycle Publish Test',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(savedDraft._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      let event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });

      // Step 2: Publish
      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: event._version })
        .expect(200);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.status).toBe(STATUS.PUBLISHED);
      expect(event.statusHistory).toHaveLength(3); // draft + pending + published

      // Step 3: Delete
      await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.statusHistory).toHaveLength(4); // + deleted

      // Step 4: Restore
      const restoreRes = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      expect(restoreRes.body.status).toBe(STATUS.PUBLISHED);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.status).toBe(STATUS.PUBLISHED);
      expect(event.statusHistory).toHaveLength(5); // draft + pending + published + deleted + restored
    });
  });

  describe('SH-9: Full lifecycle: submit → reject → delete → restore returns to rejected', () => {
    it('should restore a submitted-rejected-deleted event back to rejected', async () => {
      // Step 1: Create draft and submit
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Lifecycle Reject Test',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(savedDraft._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      let event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });

      // Step 2: Reject
      await request(app)
        .put(ENDPOINTS.REJECT_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Not available', _version: event._version })
        .expect(200);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(event.status).toBe(STATUS.REJECTED);

      // Step 3: Delete
      await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });

      // Step 4: Restore
      const restoreRes = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(savedDraft._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      expect(restoreRes.body.status).toBe(STATUS.REJECTED);
    });
  });

  // ============================================
  // SH-10 to SH-12: StatusHistory entry validation
  // ============================================

  describe('SH-10: statusHistory entries have required fields', () => {
    it('should include status, changedAt, changedBy, changedByEmail, reason in each entry', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Field Validation Test',
      });
      const [saved] = await insertEvents(db, [draft]);

      await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      // [0] is the initial draft entry from factory, [1] is the submit entry
      const entry = event.statusHistory[1];

      expect(entry).toHaveProperty('status', STATUS.PENDING);
      expect(entry).toHaveProperty('changedAt');
      expect(entry.changedAt).toBeInstanceOf(Date);
      expect(entry).toHaveProperty('changedBy', requesterUser.odataId);
      expect(entry).toHaveProperty('changedByEmail', requesterUser.email);
      expect(entry).toHaveProperty('reason', 'Submitted for review');
    });
  });

  describe('SH-11: Multiple statusHistory entries accumulate correctly', () => {
    it('should accumulate all status changes in order', async () => {
      // Create draft, submit, publish, delete, restore — 4 statusHistory entries
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Accumulation Test',
      });
      const [saved] = await insertEvents(db, [draft]);

      // Submit
      await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      let event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });

      // Publish
      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: event._version })
        .expect(200);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });

      // Delete
      await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });

      // Restore
      await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      // Verify full history (draft + pending + published + deleted + restored)
      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.statusHistory).toHaveLength(5);
      expect(event.statusHistory.map(e => e.status)).toEqual([
        STATUS.DRAFT,     // Initial from factory
        STATUS.PENDING,
        STATUS.PUBLISHED,
        STATUS.DELETED,
        STATUS.PUBLISHED,  // Restored to published
      ]);
    });
  });

  describe('SH-12: Event without statusHistory defaults to draft on restore', () => {
    it('should fall back to draft when statusHistory is empty or missing', async () => {
      // Create a deleted event with no statusHistory (legacy data)
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Legacy No History',
        statusHistory: [],
      });
      delete deleted.previousStatus;
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      // Default fallback is draft
      expect(res.body.status).toBe(STATUS.DRAFT);
    });
  });

  // ============================================
  // SH-13 to SH-15: Creation path statusHistory initialization
  // ============================================

  describe('SH-13: Draft creation via API initializes statusHistory', () => {
    it('should have statusHistory with draft entry after creating a draft via API', async () => {
      const res = await request(app)
        .post(ENDPOINTS.CREATE_DRAFT)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'New Draft via API',
          eventDescription: 'Testing statusHistory initialization',
          startDateTime: new Date(Date.now() + 86400000).toISOString(),
          endDateTime: new Date(Date.now() + 90000000).toISOString(),
        })
        .expect(201);

      expect(res.body.draft).toBeDefined();
      const draftId = res.body.draft._id;

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: new (require('mongodb').ObjectId)(draftId) });
      expect(event.statusHistory).toBeDefined();
      expect(event.statusHistory).toHaveLength(1);
      expect(event.statusHistory[0].status).toBe(STATUS.DRAFT);
      expect(event.statusHistory[0].changedBy).toBe(requesterUser.odataId);
      expect(event.statusHistory[0].changedByEmail).toBe(requesterUser.email);
      expect(event.statusHistory[0].reason).toBe('Draft created');
    });
  });

  describe('SH-14: Draft creation + submit accumulates 2 entries', () => {
    it('should have draft + pending entries after creating and submitting a draft', async () => {
      // Step 1: Create draft via API
      const createRes = await request(app)
        .post(ENDPOINTS.CREATE_DRAFT)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Draft Then Submit',
          eventDescription: 'Testing accumulation',
          startDateTime: new Date(Date.now() + 86400000).toISOString(),
          endDateTime: new Date(Date.now() + 90000000).toISOString(),
          locations: [{ displayName: 'Room A' }],
          categories: ['Meeting'],
          setupTime: '15 minutes',
          doorOpenTime: '09:00',
        })
        .expect(201);

      const draftId = createRes.body.draft._id;

      // Step 2: Submit the draft
      await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(draftId))
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: new (require('mongodb').ObjectId)(draftId) });
      expect(event.statusHistory).toHaveLength(2);
      expect(event.statusHistory[0].status).toBe(STATUS.DRAFT);
      expect(event.statusHistory[0].reason).toBe('Draft created');
      expect(event.statusHistory[1].status).toBe(STATUS.PENDING);
      expect(event.statusHistory[1].reason).toBe('Submitted for review');
    });
  });

  describe('SH-15: Event created as pending → delete → restore returns to pending', () => {
    it('should restore to pending when event was created directly as pending', async () => {
      // Simulate an event created as pending (e.g., via room reservation form)
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Direct Pending Creation',
        statusHistory: [{
          status: STATUS.PENDING,
          changedAt: new Date(),
          changedBy: requesterUser.odataId,
          changedByEmail: requesterUser.email,
          reason: 'Room reservation submitted'
        }],
      });
      const [saved] = await insertEvents(db, [pending]);

      // Delete the event
      await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      let event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.status).toBe(STATUS.DELETED);
      expect(event.statusHistory).toHaveLength(2);

      // Restore the event
      const restoreRes = await request(app)
        .put(ENDPOINTS.RESTORE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: event._version })
        .expect(200);

      // Should restore to pending (not draft!)
      expect(restoreRes.body.status).toBe(STATUS.PENDING);

      event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.status).toBe(STATUS.PENDING);
      expect(event.statusHistory).toHaveLength(3);
      expect(event.statusHistory[2].status).toBe(STATUS.PENDING);
      expect(event.statusHistory[2].reason).toBe('Restored by admin');
    });
  });
});
