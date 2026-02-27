/**
 * Event Updated Notification Tests (EU-1 to EU-10)
 *
 * EU-1 to EU-7: Tests that when an admin edits a published event's key fields
 * (title, date/time, location), the requester receives an email notification.
 * Non-key field edits (description, categories, etc.) should NOT trigger emails.
 *
 * EU-8 to EU-10: Tests that when an admin publishes an edit request, the requester
 * receives an email with a before/after changes table for key field changes.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  createTestApp,
  setTestDatabase,
  getSentEmailNotifications,
  clearSentEmailNotifications,
} = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Published Event Updated Notification Tests (EU-1 to EU-7)', () => {
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
    clearSentEmailNotifications();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
  });

  describe('EU-1: Admin edits published event title → email sent', () => {
    it('should send event updated notification when title changes', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requesterName: 'Test Requester',
        eventTitle: 'Original Title',
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${published._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Title',
          _version: published._version,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify email was sent
      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(1);
      expect(emails[0].type).toBe('event_updated');
      expect(emails[0].to).toBe(requesterUser.email);
      expect(emails[0].eventTitle).toBe('Updated Title');
      expect(emails[0].changes).toHaveLength(1);
      expect(emails[0].changes[0].displayName).toBe('Event Title');
    });
  });

  describe('EU-2: Admin edits published event start/end time → email sent', () => {
    it('should send event updated notification when date/time changes', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Board Meeting',
        startDateTime: new Date('2026-03-15T10:00:00'),
        endDateTime: new Date('2026-03-15T11:00:00'),
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${published._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: '2026-03-15T14:00:00',
          endDateTime: '2026-03-15T15:00:00',
          _version: published._version,
        });

      expect(res.status).toBe(200);

      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(1);
      expect(emails[0].type).toBe('event_updated');
      expect(emails[0].to).toBe(requesterUser.email);

      // Should have changes for both start and end time
      const changeFields = emails[0].changes.map(c => c.displayName);
      expect(changeFields).toContain('Start Date/Time');
      expect(changeFields).toContain('End Date/Time');
    });
  });

  describe('EU-3: Admin edits published event location → email sent', () => {
    it('should send event updated notification when locationDisplayNames changes', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Workshop',
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${published._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          locationDisplayNames: ['Room B', 'Room C'],
          _version: published._version,
        });

      expect(res.status).toBe(200);

      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(1);
      expect(emails[0].type).toBe('event_updated');

      const changeFields = emails[0].changes.map(c => c.displayName);
      expect(changeFields).toContain('Location(s)');
    });
  });

  describe('EU-4: Admin edits non-key field (description) → NO email', () => {
    it('should NOT send notification when only non-key fields change', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Lecture',
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${published._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventDescription: 'Updated description text',
          categories: ['Education', 'Lecture'],
          setupTime: '30 minutes',
          _version: published._version,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // No email should be sent
      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(0);
    });
  });

  describe('EU-5: Admin edits pending event → NO event-updated email', () => {
    it('should NOT send event-updated notification for pending events (existing reviewChanges preserved)', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Pending Event',
      });
      await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Pending Title',
          _version: pending._version,
        });

      expect(res.status).toBe(200);

      // No event-updated email should be sent (pending events use reviewChanges flow)
      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(0);

      // Verify reviewChanges were stored instead (existing pending behavior)
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      expect(updated.roomReservationData.reviewChanges).toBeDefined();
      expect(updated.roomReservationData.reviewChanges.length).toBeGreaterThan(0);
    });
  });

  describe('EU-6: Admin edits published event with no actual changes → NO email', () => {
    it('should NOT send notification when submitted values match existing values', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Same Title',
        locationDisplayNames: ['Room A'],
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${published._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          // Send the same title back - no real change
          eventTitle: 'Same Title',
          locationDisplayNames: ['Room A'],
          _version: published._version,
        });

      expect(res.status).toBe(200);

      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(0);
    });
  });

  describe('EU-7: Published event with no requester email → email skipped', () => {
    it('should gracefully skip notification when no requester email exists', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'No Email Event',
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'No Email User',
            // No email field
            department: 'General',
          },
          attendees: 10,
          eventSetup: 'standard',
          notes: '',
          submittedAt: new Date(),
          currentRevision: 1,
        },
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${published._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Changed Title',
          _version: published._version,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // No email should be sent (no recipient)
      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(0);
    });
  });
});

describe('Edit Request Approved Notification Tests (EU-8 to EU-10)', () => {
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
    clearSentEmailNotifications();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
  });

  describe('EU-8: Publish edit request with title change → email includes changes', () => {
    it('should include changes table with displayName when title changes', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requesterName: 'Test Requester',
        eventTitle: 'Original Board Meeting',
        pendingEditRequest: {
          requestedAt: new Date(),
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
          },
          proposedChanges: {
            eventTitle: 'Renamed Board Meeting',
          },
          changeReason: 'Need to rename event',
        },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Approved rename' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(1);
      expect(emails[0].type).toBe('edit_request_approved');
      expect(emails[0].to).toBe(requesterUser.email);
      expect(emails[0].eventTitle).toBe('Renamed Board Meeting');

      // Should have exactly one change for the title
      expect(emails[0].changes).toHaveLength(1);
      expect(emails[0].changes[0].displayName).toBe('Event Title');
    });
  });

  describe('EU-9: Publish edit request with only non-key field changes → no changes in notification', () => {
    it('should send email but with empty changes when only description changes', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requesterName: 'Test Requester',
        eventTitle: 'Workshop',
        pendingEditRequest: {
          requestedAt: new Date(),
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
          },
          proposedChanges: {
            eventDescription: 'Updated workshop description',
            categories: ['Education', 'Workshop'],
          },
          changeReason: 'Updated details',
        },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: '' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Email is always sent for edit request approval, but changes array should be empty
      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(1);
      expect(emails[0].type).toBe('edit_request_approved');
      expect(emails[0].changes).toHaveLength(0);
    });
  });

  describe('EU-10: Publish edit request with date/time + location changes → all key changes in table', () => {
    it('should include all key field changes in notification', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requesterName: 'Test Requester',
        eventTitle: 'Gala Dinner',
        startDateTime: new Date('2026-04-10T18:00:00'),
        endDateTime: new Date('2026-04-10T22:00:00'),
        locationDisplayNames: ['Ballroom A'],
        pendingEditRequest: {
          requestedAt: new Date(),
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
          },
          proposedChanges: {
            startDateTime: '2026-04-11T19:00:00',
            endDateTime: '2026-04-11T23:00:00',
            locationDisplayNames: ['Ballroom B', 'Garden'],
          },
          changeReason: 'Venue change and date shift',
        },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Venue confirmed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const emails = getSentEmailNotifications();
      expect(emails).toHaveLength(1);
      expect(emails[0].type).toBe('edit_request_approved');
      expect(emails[0].to).toBe(requesterUser.email);

      // Should have changes for start, end, and location
      const changeFields = emails[0].changes.map(c => c.displayName);
      expect(changeFields).toContain('Start Date/Time');
      expect(changeFields).toContain('End Date/Time');
      expect(changeFields).toContain('Location(s)');
      expect(emails[0].changes.length).toBeGreaterThanOrEqual(3);
    });
  });
});
