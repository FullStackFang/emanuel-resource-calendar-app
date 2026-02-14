/**
 * Approver Changes Detection Tests (RC-1 to RC-8)
 *
 * Tests that when an approver modifies a pending event before publishing,
 * the changes are captured and made available for email notifications.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Approver Changes Detection Tests (RC-1 to RC-8)', () => {
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

  describe('RC-1: Save with no changes stores no reviewChanges', () => {
    it('should not store reviewChanges when no fields are modified', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Board Meeting',
      });
      await insertEvents(db, [pending]);

      // Save with no field changes
      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);

      // Check that no reviewChanges were stored
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      expect(event.roomReservationData.reviewChanges).toBeUndefined();
    });
  });

  describe('RC-2: Save with title change stores reviewChanges', () => {
    it('should detect and store title change on pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Board Meeting',
      });
      await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Annual Board Meeting' });

      expect(res.status).toBe(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      const changes = event.roomReservationData.reviewChanges;
      expect(changes).toBeDefined();
      expect(changes).toHaveLength(1);
      expect(changes[0].displayName).toBe('Event Title');
      expect(changes[0].newValue).toBe('Annual Board Meeting');
    });
  });

  describe('RC-3: Save with time change stores reviewChanges', () => {
    it('should detect and store time change', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Meeting',
      });
      await insertEvents(db, [pending]);

      const newStart = '2025-06-15T15:00:00';
      const newEnd = '2025-06-15T17:00:00';

      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: newStart,
          endDateTime: newEnd,
        });

      expect(res.status).toBe(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      const changes = event.roomReservationData.reviewChanges;
      expect(changes).toBeDefined();
      expect(changes.length).toBeGreaterThanOrEqual(1);
      const fields = changes.map(c => c.displayName);
      expect(fields).toEqual(expect.arrayContaining(['Start Date/Time']));
    });
  });

  describe('RC-4: Save with multiple changes stores all reviewChanges', () => {
    it('should detect multiple field changes', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Meeting',
      });
      await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'New Title',
          categories: ['Workshop', 'Training'],
          attendeeCount: 200,
        });

      expect(res.status).toBe(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      const changes = event.roomReservationData.reviewChanges;
      expect(changes).toBeDefined();
      expect(changes.length).toBeGreaterThanOrEqual(2);
      const fields = changes.map(c => c.displayName);
      expect(fields).toEqual(expect.arrayContaining(['Event Title', 'Categories']));
    });
  });

  describe('RC-5: Save on published event does NOT store reviewChanges', () => {
    it('should not track changes for non-pending events', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Published Event',
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${published._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Updated Title' });

      expect(res.status).toBe(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: published._id });
      expect(event.roomReservationData?.reviewChanges).toBeUndefined();
    });
  });

  describe('RC-6: Publish endpoint reads and clears reviewChanges', () => {
    it('should include reviewChanges in publish response and clear from document', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Board Meeting',
      });
      await insertEvents(db, [pending]);

      // Step 1: Admin save modifies the title
      const saveRes = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Annual Board Meeting' });
      expect(saveRes.status).toBe(200);

      // Verify reviewChanges are stored
      const savedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      expect(savedEvent.roomReservationData.reviewChanges).toBeDefined();
      expect(savedEvent.roomReservationData.reviewChanges).toHaveLength(1);

      // Step 2: Publish the event
      const publishRes = await request(app)
        .put(`/api/admin/events/${pending._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(publishRes.status).toBe(200);

      // Response should include reviewChanges
      expect(publishRes.body.reviewChanges).toBeDefined();
      expect(publishRes.body.reviewChanges).toHaveLength(1);
      expect(publishRes.body.reviewChanges[0].displayName).toBe('Event Title');

      // Document should have reviewChanges cleared
      const publishedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      expect(publishedEvent.roomReservationData?.reviewChanges).toBeUndefined();
    });
  });

  describe('RC-7: Publish with no prior changes has no reviewChanges', () => {
    it('should not include reviewChanges when no modifications were made', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Board Meeting',
      });
      await insertEvents(db, [pending]);

      // Publish without any prior save
      const publishRes = await request(app)
        .put(`/api/admin/events/${pending._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(publishRes.status).toBe(200);
      expect(publishRes.body.reviewChanges).toBeUndefined();
    });
  });

  describe('RC-8: Audit log includes reviewChanges on publish', () => {
    it('should record approver modifications in the audit log', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Board Meeting',
      });
      await insertEvents(db, [pending]);

      // Step 1: Admin saves with title change
      await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventTitle: 'Annual Board Meeting' });

      // Step 2: Publish
      await request(app)
        .put(`/api/admin/events/${pending._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // Check audit log
      const auditEntry = await db.collection(COLLECTIONS.AUDIT_HISTORY).findOne({
        eventId: pending.eventId,
        action: 'published',
      });
      expect(auditEntry).toBeDefined();
      expect(auditEntry.reviewChanges).toBeDefined();
      expect(auditEntry.reviewChanges).toHaveLength(1);
      expect(auditEntry.reviewChanges[0].displayName).toBe('Event Title');
    });
  });
});
