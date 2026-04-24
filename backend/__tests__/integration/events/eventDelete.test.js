/**
 * Event Delete/Restore Tests (A-13, A-19, A-20, A-21, A-22, A-23)
 *
 * Tests the delete and restore functionality for events.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, createOtherRequester, createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createPublishedEvent,
  createRejectedEvent,
  createDeletedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Event Delete/Restore Tests (A-13, A-19 to A-23)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let adminUser;
  let adminToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('eventDelete'));

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

    // Create test users
    approverUser = createApprover();
    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, adminUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);

    // Clear deletion email tracking
    app.locals.lastDeletionEmail = undefined;
  });

  describe('A-13: Delete published event', () => {
    it('should soft delete a published event', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event to Delete',
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify in database
      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPublished._id });
      expect(event.isDeleted).toBe(true);
      expect(event.status).toBe(STATUS.DELETED);
      expect(event.previousStatus).toBe(STATUS.PUBLISHED);
      expect(event.deletedAt).toBeDefined();
      expect(event.deletedBy).toBe(approverUser.odataId);
    });

    it('should create audit log entry', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedPublished.eventId,
        action: 'deleted',
        performedBy: approverUser.odataId,
      });
    });
  });

  describe('A-19: Delete rejected event (admin only for others events)', () => {
    it('should soft delete a rejected event as admin', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Rejected Event to Delete',
      });
      const [savedRejected] = await insertEvents(db, [rejected]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedRejected._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedRejected._id });
      expect(event.isDeleted).toBe(true);
      expect(event.previousStatus).toBe(STATUS.REJECTED);
    });

    it('should return 403 when approver deletes others rejected event', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Rejected Event - Not Mine',
      });
      const [savedRejected] = await insertEvents(db, [rejected]);

      await request(app)
        .delete(`/api/admin/events/${savedRejected._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(403);
    });
  });

  describe('A-20: View deleted events', () => {
    it('should return deleted events when queried', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Already Deleted Event',
      });
      await insertEvents(db, [deleted]);

      const res = await request(app)
        .get('/api/admin/events?isDeleted=true')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].eventTitle).toBe('Already Deleted Event');
      expect(res.body.events[0].isDeleted).toBe(true);
    });

    it('should exclude deleted events by default', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'Active Event',
      });
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'Deleted Event',
      });
      await insertEvents(db, [published, deleted]);

      const res = await request(app)
        .get('/api/admin/events?isDeleted=false')
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].eventTitle).toBe('Active Event');
    });
  });

  describe('A-21: Restore deleted event (Admin only)', () => {
    it('should restore deleted event to previous status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Restore Me',
        previousStatus: STATUS.PUBLISHED,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(STATUS.PUBLISHED);
    });

    it('should return 404 when event is not deleted', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPublished._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedPublished._version })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('should create audit log entry', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        previousStatus: STATUS.PENDING,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      await assertAuditEntry(db, {
        eventId: savedDeleted.eventId,
        action: 'restored',
        performedBy: adminUser.odataId,
      });
    });
  });

  describe('A-23: Restored event preserves previous status', () => {
    it('should restore to published status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        previousStatus: STATUS.PUBLISHED,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.PUBLISHED);
    });

    it('should restore to pending status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        previousStatus: STATUS.PENDING,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.PENDING);
    });

    it('should restore to rejected status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
        previousStatus: STATUS.REJECTED,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.REJECTED);
    });

    it('should default to draft if no previous status', async () => {
      const deleted = createDeletedEvent({
        userId: requesterUser.odataId,
      });
      // Remove previousStatus and statusHistory to simulate legacy data
      delete deleted.previousStatus;
      deleted.statusHistory = [];
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDeleted._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: savedDeleted._version })
        .expect(200);

      expect(res.body.status).toBe(STATUS.DRAFT);
    });
  });

  describe('Deletion Notification (DN-1 to DN-5)', () => {
    it('DN-1: should trigger deletion notification when deleting a published event', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Published Event for Notification',
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify deletion notification was tracked
      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.recipientEmail).toBe(requesterUser.email);
      expect(emailTracked.eventTitle).toBe('Published Event for Notification');
    });

    it('DN-2: should trigger notification when admin deletes others pending event (third-party delete)', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Pending Event Third Party Delete',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .delete(`/api/admin/events/${savedPending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Third-party delete should trigger notification
      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.recipientEmail).toBe(requesterUser.email);
    });

    it('DN-3: should NOT trigger notification when owner deletes own draft', async () => {
      const draft = createDraftEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'My Own Draft',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      await request(app)
        .delete(`/api/admin/events/${savedDraft._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      // Owner deleting own event — no notification
      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).toBeNull();
    });

    it('DN-4: deletion notification should include correct event details', async () => {
      const startDateTime = new Date('2026-04-15T14:00:00');
      const endDateTime = new Date('2026-04-15T16:00:00');
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        requesterName: 'Jane Doe',
        eventTitle: 'Annual Gala Dinner',
        startDateTime,
        endDateTime,
        locationDisplayNames: ['Main Sanctuary', 'Social Hall'],
      });
      const [savedPublished] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.eventTitle).toBe('Annual Gala Dinner');
      expect(emailTracked.recipientEmail).toBe(requesterUser.email);
      expect(emailTracked.requesterName).toBe('Jane Doe');
      expect(emailTracked.locationDisplayNames).toEqual(['Main Sanctuary', 'Social Hall']);
    });

    it('DN-5: no notification triggered if requester has no email', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'No Email Event',
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'No Email User',
            email: null,
            department: 'General',
            phone: '555-0000',
          },
          attendees: 5,
          eventSetup: 'standard',
          notes: '',
          submittedAt: new Date(),
          currentRevision: 1,
        },
      });
      const [savedPublished] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      // Email was tracked but with null recipient
      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.recipientEmail).toBeNull();
    });

    it('DN-6: deletion notification should include deletedByName when third-party deletes', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event Deleted By Approver',
      });
      const [savedPublished] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.deletedByName).toBe(approverUser.displayName);
    });

    it('DN-7: deletion notification should include reason when provided', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event With Deletion Reason',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .delete(`/api/admin/events/${savedPending._id}`)
        .send({ reason: 'Room is under renovation' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.deletionReason).toBe('Room is under renovation');
    });

    it('DN-8: deletion notification should have null reason when none provided', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event Without Reason',
      });
      const [savedPublished] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.deletionReason).toBeNull();
    });

    it('DN-9: delete response should include emailNotification status', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Response Email Status',
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedPublished._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.emailNotification).toBeDefined();
      expect(res.body.emailNotification.sent).toBe(true);
      expect(res.body.emailNotification.recipientEmail).toBe(requesterUser.email);
    });

    it('DN-10: delete response should have emailNotification.sent=false when no notification needed', async () => {
      // Owner deleting own draft — no notification
      const draft = createDraftEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'My Own Draft No Email',
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedDraft._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.emailNotification).toBeDefined();
      expect(res.body.emailNotification.sent).toBe(false);
    });
  });

  describe('Delete idempotency', () => {
    it('should return success when deleting already deleted event', async () => {
      const deleted = createDeletedEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
      });
      const [savedDeleted] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .delete(`/api/admin/events/${savedDeleted._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/already deleted/i);
    });
  });

  describe('Approver Delete Permissions (AD-1 to AD-11)', () => {
    let requesterToken;

    beforeEach(async () => {
      requesterToken = await createMockToken(requesterUser);
    });

    it('AD-1: Approver can delete own draft', async () => {
      const draft = createDraftEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Approver Own Draft',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('AD-2: Approver can delete own pending with reason', async () => {
      const pending = createPendingEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Approver Own Pending',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'No longer needed' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('AD-3: Approver can delete own pending without reason (uses Delete button, not Withdraw)', async () => {
      const pending = createPendingEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Approver Own Pending No Reason',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('AD-4: Approver can delete own published', async () => {
      const published = createPublishedEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Approver Own Published',
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('AD-5: Approver can delete others published event', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Others Published Event',
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('AD-6: Approver cannot delete others pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Others Pending Event',
      });
      const [saved] = await insertEvents(db, [pending]);

      await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(403);
    });

    it('AD-7: Approver cannot delete others draft event', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Others Draft Event',
      });
      const [saved] = await insertEvents(db, [draft]);

      await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(403);
    });

    it('AD-8: Approver cannot delete others rejected event', async () => {
      const rejected = createRejectedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Others Rejected Event',
      });
      const [saved] = await insertEvents(db, [rejected]);

      await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(403);
    });

    it('AD-9: Requester cannot delete own pending without reason', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Requester Own Pending',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('AD-10: Delete with reason stores reason in statusHistory', async () => {
      const published = createPublishedEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Event With Reason',
      });
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Duplicate event' })
        .expect(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      const lastHistory = event.statusHistory[event.statusHistory.length - 1];
      expect(lastHistory.reason).toBe('Duplicate event');
    });

    it('AD-12: Admin can delete own pending event without reason', async () => {
      const pending = createPendingEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Admin Own Pending No Reason',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const event = await db.collection('templeEvents__Events').findOne({ _id: saved._id });
      expect(event.status).toBe('deleted');
    });

    it('AD-11: Third-party delete tracks notification email', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Notify On Third Party Delete',
      });
      const [saved] = await insertEvents(db, [published]);

      await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const emailTracked = app.locals.lastDeletionEmail;
      expect(emailTracked).not.toBeNull();
      expect(emailTracked.recipientEmail).toBe(requesterUser.email);
    });
  });

  describe('Requester Draft Delete Permissions (RD-1 to RD-4)', () => {
    let requesterToken;
    let otherRequesterUser;
    let otherRequesterToken;

    beforeEach(async () => {
      requesterToken = await createMockToken(requesterUser);
      otherRequesterUser = createOtherRequester();
      await insertUsers(db, [otherRequesterUser]);
      otherRequesterToken = await createMockToken(otherRequesterUser);
    });

    it('RD-1: Requester can delete own draft via /api/admin/events/:id without reason', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Requester Own Draft',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.status).toBe('deleted');
      expect(event.isDeleted).toBe(true);
    });

    it('RD-2: Requester cannot delete another requester\'s draft (403)', async () => {
      const otherDraft = createDraftEvent({
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
        eventTitle: 'Other Requester Draft',
      });
      const [saved] = await insertEvents(db, [otherDraft]);

      await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(event.status).toBe('draft');
      expect(event.isDeleted).not.toBe(true);
    });

    it('RD-3: Own draft delete writes statusHistory entry with changedBy=requester', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Status History Draft',
      });
      const [saved] = await insertEvents(db, [draft]);

      await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      const lastHistory = event.statusHistory[event.statusHistory.length - 1];
      expect(lastHistory.status).toBe('deleted');
      expect(lastHistory.changedByEmail).toBe(requesterUser.email);
    });

    it('RD-4: Requester pending-withdraw still requires reason (regression guard)', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Regression Guard Pending',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .delete(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });
  });
});
