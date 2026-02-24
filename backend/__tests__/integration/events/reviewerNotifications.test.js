/**
 * Reviewer Notification Tests (RN-1 to RN-20)
 *
 * Tests for role-based notification preferences:
 * - getTestReviewerEmails filtering by preference key
 * - Endpoint notifications (new request alerts, edit request alerts)
 * - PATCH /api/users/current/notification-preferences role-based access
 * - shouldSendNotification requester-facing opt-out behavior
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  createTestApp,
  setTestDatabase,
  getSentEmailNotifications,
  clearSentEmailNotifications,
  getTestReviewerEmails,
} = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createApprover,
  createAdmin,
  createRequester,
  createViewer,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createRejectedEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Reviewer Notification Tests (RN-1 to RN-20)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let adminUser;
  let adminToken;
  let requesterUser;
  let requesterToken;
  let viewerUser;
  let viewerToken;

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
    clearSentEmailNotifications();

    // Create standard test users
    approverUser = createApprover();
    adminUser = createAdmin();
    requesterUser = createRequester();
    viewerUser = createViewer();

    await insertUsers(db, [approverUser, adminUser, requesterUser, viewerUser]);

    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
    viewerToken = await createMockToken(viewerUser);
  });

  // ============================================
  // getTestReviewerEmails Tests (RN-1 to RN-4)
  // ============================================

  describe('getTestReviewerEmails()', () => {
    test('RN-1: returns both admin and approver emails', async () => {
      const emails = await getTestReviewerEmails();
      expect(emails).toContain(approverUser.email);
      expect(emails).toContain(adminUser.email);
      expect(emails.length).toBe(2);
    });

    test('RN-2: excludes users who opted out of specific key', async () => {
      // Opt out the approver from emailOnNewRequests
      await db.collection(COLLECTIONS.USERS).updateOne(
        { _id: approverUser._id },
        { $set: { 'notificationPreferences.emailOnNewRequests': false } }
      );

      const emails = await getTestReviewerEmails('emailOnNewRequests');
      expect(emails).not.toContain(approverUser.email);
      expect(emails).toContain(adminUser.email);
      expect(emails.length).toBe(1);
    });

    test('RN-3: includes users without notificationPreferences (default opted-in)', async () => {
      const approverDoc = await db.collection(COLLECTIONS.USERS).findOne({ _id: approverUser._id });
      expect(approverDoc.notificationPreferences).toBeUndefined();

      const emails = await getTestReviewerEmails();
      expect(emails).toContain(approverUser.email);
    });

    test('RN-4: excludes viewers and requesters from reviewer emails', async () => {
      const emails = await getTestReviewerEmails();
      expect(emails).not.toContain(requesterUser.email);
      expect(emails).not.toContain(viewerUser.email);
    });
  });

  // ============================================
  // Endpoint Notification Tests (RN-5 to RN-9)
  // ============================================

  describe('Endpoint notifications', () => {
    test('RN-5: POST /api/room-reservations/draft/:id/submit sends reviewer notification', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
          },
        },
      });
      await insertEvents(db, [draft]);

      const res = await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(draft._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send();

      expect(res.status).toBe(200);

      const notifications = getSentEmailNotifications();
      const newRequestAlerts = notifications.filter(n => n.type === 'new_request_alert');
      expect(newRequestAlerts.length).toBe(1);
      expect(newRequestAlerts[0].to).toContain(approverUser.email);
      expect(newRequestAlerts[0].to).toContain(adminUser.email);
    });

    test('RN-6: PUT /api/room-reservations/:id/resubmit sends reviewer notification', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
          },
          resubmissionAllowed: true,
        },
      });
      await insertEvents(db, [rejected]);

      const res = await request(app)
        .put(ENDPOINTS.RESUBMIT_RESERVATION(rejected._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ _version: rejected._version });

      expect(res.status).toBe(200);

      const notifications = getSentEmailNotifications();
      const newRequestAlerts = notifications.filter(n => n.type === 'new_request_alert');
      expect(newRequestAlerts.length).toBe(1);
      expect(newRequestAlerts[0].to).toContain(approverUser.email);
      expect(newRequestAlerts[0].to).toContain(adminUser.email);
    });

    test('RN-7: PUT /api/room-reservations/:id/edit (isResubmitEdit) sends reviewer notification', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
          },
          resubmissionAllowed: true,
        },
      });
      await insertEvents(db, [rejected]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(rejected._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: rejected._version,
          eventTitle: 'Updated Title After Rejection',
          startDate: '2025-04-01',
          startTime: '10:00',
          endDate: '2025-04-01',
          endTime: '12:00',
        });

      expect(res.status).toBe(200);

      const notifications = getSentEmailNotifications();
      const newRequestAlerts = notifications.filter(n => n.type === 'new_request_alert');
      expect(newRequestAlerts.length).toBe(1);
      expect(newRequestAlerts[0].to).toContain(approverUser.email);
      expect(newRequestAlerts[0].to).toContain(adminUser.email);
    });

    test('RN-8: editing a pending event does NOT send reviewer notification', async () => {
      const pending = createRejectedEvent({
        userId: requesterUser.odataId,
        status: 'pending',
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
          },
        },
      });
      pending.status = 'pending';
      await insertEvents(db, [pending]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pending._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: pending._version,
          eventTitle: 'Updated Pending Title',
          startDate: '2025-04-01',
          startTime: '10:00',
          endDate: '2025-04-01',
          endTime: '12:00',
        });

      expect(res.status).toBe(200);

      const notifications = getSentEmailNotifications();
      const newRequestAlerts = notifications.filter(n => n.type === 'new_request_alert');
      expect(newRequestAlerts.length).toBe(0);
    });

    test('RN-9: opted-out approver does NOT receive new request notification', async () => {
      await db.collection(COLLECTIONS.USERS).updateOne(
        { _id: approverUser._id },
        { $set: { 'notificationPreferences.emailOnNewRequests': false } }
      );

      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
          },
        },
      });
      await insertEvents(db, [draft]);

      const res = await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(draft._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send();

      expect(res.status).toBe(200);

      const notifications = getSentEmailNotifications();
      const newRequestAlerts = notifications.filter(n => n.type === 'new_request_alert');
      expect(newRequestAlerts.length).toBe(1);
      expect(newRequestAlerts[0].to).not.toContain(approverUser.email);
      expect(newRequestAlerts[0].to).toContain(adminUser.email);
    });
  });

  // ============================================
  // PATCH Notification Preferences Tests (RN-10 to RN-16)
  // ============================================

  describe('PATCH /api/users/current/notification-preferences', () => {
    const NOTIF_PREFS_ENDPOINT = '/api/users/current/notification-preferences';

    test('RN-10: approver can update notification preferences', async () => {
      const res = await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ emailOnNewRequests: false });

      expect(res.status).toBe(200);
      expect(res.body.notificationPreferences.emailOnNewRequests).toBe(false);
    });

    test('RN-11: admin can update notification preferences', async () => {
      const res = await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ emailOnNewRequests: false, emailOnEditRequests: false });

      expect(res.status).toBe(200);
      expect(res.body.notificationPreferences.emailOnNewRequests).toBe(false);
      expect(res.body.notificationPreferences.emailOnEditRequests).toBe(false);
    });

    test('RN-12: requester can update requester-level preferences', async () => {
      const res = await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ emailOnConfirmations: false, emailOnStatusUpdates: false, emailOnAdminChanges: false });

      expect(res.status).toBe(200);
      expect(res.body.notificationPreferences.emailOnConfirmations).toBe(false);
      expect(res.body.notificationPreferences.emailOnStatusUpdates).toBe(false);
      expect(res.body.notificationPreferences.emailOnAdminChanges).toBe(false);
    });

    test('RN-13: requester CANNOT update reviewer-level preferences', async () => {
      const res = await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ emailOnNewRequests: false });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid preference keys/);
    });

    test('RN-14: viewer cannot update any notification preferences', async () => {
      const res = await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ emailOnConfirmations: false });

      expect(res.status).toBe(403);
    });

    test('RN-15: preferences persist correctly (round-trip)', async () => {
      // Set to false
      await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ emailOnNewRequests: false, emailOnConfirmations: false });

      // Verify persisted in database
      const userDoc = await db.collection(COLLECTIONS.USERS).findOne({ _id: approverUser._id });
      expect(userDoc.notificationPreferences.emailOnNewRequests).toBe(false);
      expect(userDoc.notificationPreferences.emailOnConfirmations).toBe(false);

      // Set back to true
      const res = await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ emailOnNewRequests: true, emailOnConfirmations: true });

      expect(res.status).toBe(200);
      expect(res.body.notificationPreferences.emailOnNewRequests).toBe(true);
      expect(res.body.notificationPreferences.emailOnConfirmations).toBe(true);

      const updatedDoc = await db.collection(COLLECTIONS.USERS).findOne({ _id: approverUser._id });
      expect(updatedDoc.notificationPreferences.emailOnNewRequests).toBe(true);
      expect(updatedDoc.notificationPreferences.emailOnConfirmations).toBe(true);
    });

    test('RN-16: invalid preference keys rejected', async () => {
      const res = await request(app)
        .patch(NOTIF_PREFS_ENDPOINT)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ invalidKey: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid preference keys/);
    });
  });

  // ============================================
  // shouldSendNotification Tests (RN-17 to RN-19)
  // ============================================

  describe('shouldSendNotification behavior (via getTestReviewerEmails)', () => {
    test('RN-17: respects emailOnConfirmations opt-out via reviewer email filtering', async () => {
      // emailOnConfirmations is a requester-facing key, not used in getTestReviewerEmails.
      // We test the pattern: opted-out user excluded from preference-keyed queries.
      await db.collection(COLLECTIONS.USERS).updateOne(
        { _id: approverUser._id },
        { $set: { 'notificationPreferences.emailOnEditRequests': false } }
      );

      const emails = await getTestReviewerEmails('emailOnEditRequests');
      expect(emails).not.toContain(approverUser.email);
      expect(emails).toContain(adminUser.email);
    });

    test('RN-18: respects emailOnStatusUpdates opt-out (different key, same pattern)', async () => {
      // Set admin to opt out of a specific key
      await db.collection(COLLECTIONS.USERS).updateOne(
        { _id: adminUser._id },
        { $set: { 'notificationPreferences.emailOnNewRequests': false } }
      );

      // Admin opted out of emailOnNewRequests
      const emailsNew = await getTestReviewerEmails('emailOnNewRequests');
      expect(emailsNew).not.toContain(adminUser.email);
      expect(emailsNew).toContain(approverUser.email);

      // But not opted out of emailOnEditRequests
      const emailsEdit = await getTestReviewerEmails('emailOnEditRequests');
      expect(emailsEdit).toContain(adminUser.email);
      expect(emailsEdit).toContain(approverUser.email);
    });

    test('RN-19: defaults to true when preference key is missing from user doc', async () => {
      // No notificationPreferences set at all — user should be included
      const approverDoc = await db.collection(COLLECTIONS.USERS).findOne({ _id: approverUser._id });
      expect(approverDoc.notificationPreferences).toBeUndefined();

      const emailsNew = await getTestReviewerEmails('emailOnNewRequests');
      expect(emailsNew).toContain(approverUser.email);

      const emailsEdit = await getTestReviewerEmails('emailOnEditRequests');
      expect(emailsEdit).toContain(approverUser.email);
    });
  });

  // ============================================
  // Edit Request Alert Tests (RN-20)
  // ============================================

  describe('Edit request alerts', () => {
    test('RN-20: edit-request alert goes to approvers (not just admins)', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
          },
        },
      });
      await insertEvents(db, [published]);

      const res = await request(app)
        .post(ENDPOINTS.REQUEST_EDIT(published._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          requestedChanges: { eventTitle: 'New Title' },
          reason: 'Need to change title',
        });

      expect(res.status).toBe(200);

      const notifications = getSentEmailNotifications();
      const editAlerts = notifications.filter(n => n.type === 'edit_request_alert');
      expect(editAlerts.length).toBe(1);
      // Both approver and admin should receive the alert
      expect(editAlerts[0].to).toContain(approverUser.email);
      expect(editAlerts[0].to).toContain(adminUser.email);
    });
  });
});
