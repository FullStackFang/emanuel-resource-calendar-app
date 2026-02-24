/**
 * Proposed Changes Merge Tests (PM-1 to PM-8)
 *
 * Tests that when an approver edits a published event with a pending edit request,
 * fields the approver modified are removed from pendingEditRequest.requestedChanges
 * so that publish-edit won't revert the approver's work.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEventWithEditRequest,
  createPublishedEvent,
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Proposed Changes Merge Tests (PM-1 to PM-8)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let requesterUser;

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

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
  });

  describe('PM-1: Approver changes field in requestedChanges', () => {
    it('should remove the changed field from requestedChanges', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        requestedChanges: {
          eventTitle: 'Requester Wants This Title',
          eventDescription: 'Requester Wants This Description',
        },
      });
      await insertEvents(db, [event]);

      // Approver changes the title (same field as in requestedChanges)
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Approver Chose This Title' });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(updated.eventTitle).toBe('Approver Chose This Title');

      // eventTitle should be removed from requestedChanges, eventDescription should remain
      const remaining = updated.pendingEditRequest.requestedChanges;
      expect(remaining.eventTitle).toBeUndefined();
      expect(remaining.eventDescription).toBe('Requester Wants This Description');
    });
  });

  describe('PM-2: Approver changes field NOT in requestedChanges', () => {
    it('should leave requestedChanges unchanged', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        requestedChanges: {
          eventTitle: 'Requester Wants This Title',
        },
      });
      await insertEvents(db, [event]);

      // Approver changes a field NOT in requestedChanges
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventDescription: 'Approver added a description' });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });

      // requestedChanges should be unchanged
      const remaining = updated.pendingEditRequest.requestedChanges;
      expect(remaining.eventTitle).toBe('Requester Wants This Title');
    });
  });

  describe('PM-3: Approver changes 1 of 2 proposed fields', () => {
    it('should remove only the changed field, keep the other', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        eventDescription: 'Original Description',
        requestedChanges: {
          eventTitle: 'New Title From Requester',
          eventDescription: 'New Description From Requester',
        },
      });
      await insertEvents(db, [event]);

      // Approver only changes eventTitle
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Approver Title' });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      const remaining = updated.pendingEditRequest.requestedChanges;

      expect(remaining.eventTitle).toBeUndefined();
      expect(remaining.eventDescription).toBe('New Description From Requester');
      expect(Object.keys(remaining)).toHaveLength(1);
    });
  });

  describe('PM-4: Approver changes ALL proposed fields', () => {
    it('should result in empty requestedChanges', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        eventDescription: 'Original Description',
        requestedChanges: {
          eventTitle: 'New Title',
          eventDescription: 'New Description',
        },
      });
      await insertEvents(db, [event]);

      // Approver changes both fields
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Approver Title',
          eventDescription: 'Approver Description',
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      const remaining = updated.pendingEditRequest.requestedChanges;

      expect(remaining).toEqual({});
    });
  });

  describe('PM-5: Event has no pendingEditRequest', () => {
    it('should not create a pendingEditRequest', async () => {
      const event = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'No Edit Request Event',
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Updated Title' });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(updated.pendingEditRequest).toBeUndefined();
    });
  });

  describe('PM-6: Pending event (not published) with edit does not merge', () => {
    it('should track reviewChanges but not merge requestedChanges', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Pending Event',
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Updated Pending Title' });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });

      // reviewChanges should be tracked for pending events
      expect(updated.roomReservationData.reviewChanges).toBeDefined();

      // No pendingEditRequest should exist
      expect(updated.pendingEditRequest).toBeUndefined();
    });
  });

  describe('PM-7: Approver changes locations removes related fields', () => {
    it('should remove requestedRooms and locationDisplayNames when approver modifies locations', async () => {
      const { ObjectId } = require('mongodb');
      const locationId1 = new ObjectId();
      const locationId2 = new ObjectId();

      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Location Event',
        requestedChanges: {
          requestedRooms: [locationId2],
          locationDisplayNames: 'New Room',
          eventDescription: 'Also changed description',
        },
      });
      await insertEvents(db, [event]);

      // Approver changes locations (which maps from requestedRooms)
      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requestedRooms: [locationId1] });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      const remaining = updated.pendingEditRequest.requestedChanges;

      // Location-related fields should be removed
      expect(remaining.requestedRooms).toBeUndefined();
      expect(remaining.locationDisplayNames).toBeUndefined();

      // Non-location field should remain
      expect(remaining.eventDescription).toBe('Also changed description');
    });
  });

  describe('PM-8: publish-edit after merge applies only remaining changes', () => {
    it('should preserve approver edits and apply only remaining requestedChanges', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        eventDescription: 'Original Description',
        requestedChanges: {
          eventTitle: 'Requester Title',
          eventDescription: 'Requester Description',
        },
      });
      await insertEvents(db, [event]);

      // Step 1: Approver changes eventTitle only
      const saveRes = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Approver Title' });

      expect(saveRes.status).toBe(200);

      // Verify intermediate state
      const afterSave = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });
      expect(afterSave.eventTitle).toBe('Approver Title');
      expect(afterSave.pendingEditRequest.requestedChanges.eventTitle).toBeUndefined();
      expect(afterSave.pendingEditRequest.requestedChanges.eventDescription).toBe('Requester Description');

      // Step 2: publish-edit applies remaining changes
      const publishRes = await request(app)
        .put(ENDPOINTS.PUBLISH_EDIT(event._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(publishRes.status).toBe(200);

      const final = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: event._id });

      // Approver's title should be preserved (publish-edit only applied eventDescription)
      expect(final.eventTitle).toBe('Approver Title');
      // Requester's description should be applied
      expect(final.eventDescription).toBe('Requester Description');
      // pendingEditRequest should be cleared
      expect(final.pendingEditRequest).toBeUndefined();
    });
  });
});
