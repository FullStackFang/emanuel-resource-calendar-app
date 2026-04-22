/**
 * Event Rejection Tests (A-8, A-9)
 *
 * Tests the rejection workflow for pending events by approvers.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createDraftEvent,
  createPublishedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  createAdditionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { assertAuditEntry } = require('../../__helpers__/dbHelpers');

describe('Event Rejection Tests (A-8, A-9)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('eventReject'));

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
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    // Create token
    approverToken = await createMockToken(approverUser);
  });

  describe('A-8: Reject pending event', () => {
    it('should transition pending event to rejected', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Event to Reject',
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Room not available on requested date' })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Real server returns { success, _version, changeKey } — verify status in DB
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPending._id });
      expect(updated.status).toBe(STATUS.REJECTED);
      expect(updated.roomReservationData.reviewedBy.reviewedAt).toBeDefined();
      expect(updated.roomReservationData.reviewedBy.name).toBeDefined();
      expect(updated.roomReservationData.reviewNotes).toBe('Room not available on requested date');
    });

    it('should create audit log entry with rejection reason', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Conflict with existing event' })
        .expect(200);

      const audit = await assertAuditEntry(db, {
        eventId: savedPending.eventId,
        action: 'rejected',
        performedBy: approverUser.odataId,
      });

      // Real server stores changes as an array of { field, oldValue, newValue }
      const reviewNotesChange = audit.changes.find(c => c.field === 'reviewNotes');
      expect(reviewNotesChange).toBeDefined();
      expect(reviewNotesChange.newValue).toBe('Conflict with existing event');
    });

    it('should return 404 for non-existent event', async () => {
      const res = await request(app)
        .put('/api/admin/events/507f1f77bcf86cd799439011/reject')
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Test rejection' })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
    });

    it('should return 400 when trying to reject draft', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/admin/events/${savedDraft._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Test rejection' })
        .expect(400);

      expect(res.body.error).toMatch(/cannot reject|not a pending/i);
    });

    it('should return 400 when trying to reject already published event', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPublished] = await insertEvents(db, [published]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPublished._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Test rejection' })
        .expect(400);

      expect(res.body.error).toMatch(/cannot reject|not a pending/i);
    });
  });

  describe('A-9: Rejection requires reason', () => {
    it('should return 400 when no reason is provided', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({}) // No reason
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('should return 400 when reason is empty string', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: '' })
        .expect(400);

      expect(res.body.error).toMatch(/reason.*required/i);
    });

    it('should accept reason with whitespace and trim', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [savedPending] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: '  Valid reason with spaces  ' })
        .expect(200);

      expect(res.body.success).toBe(true);
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedPending._id });
      expect(updated.status).toBe(STATUS.REJECTED);
    });
  });

  describe('RR-REC: Rejecting a recurring series cascades to exception/addition docs', () => {
    // Guards against orphan-exception bug: rejecting the series master must also
    // flip status='rejected' on all exception and addition children. Otherwise the
    // children keep status='pending' and continue to render on the calendar after
    // the parent series is rejected.

    it('RR-REC-1: rejecting a seriesMaster cascades exception doc status to rejected', async () => {
      const master = createRecurringSeriesMaster({
        status: 'pending',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Recurring pending series',
      });
      const exception = createExceptionDocument(
        master,
        '2026-03-17',
        { startTime: '10:30', endTime: '11:30' },
        { status: 'pending' }
      );
      const [savedMaster] = await insertEvents(db, [master, exception]);

      await request(app)
        .put(`/api/admin/events/${savedMaster._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Rejecting whole series' })
        .expect(200);

      const updatedMaster = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedMaster._id });
      expect(updatedMaster.status).toBe(STATUS.REJECTED);

      const updatedException = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: master.eventId,
        eventType: 'exception',
      });
      expect(updatedException).toBeTruthy();
      expect(updatedException.status).toBe(STATUS.REJECTED);

      // statusHistory should reflect the cascade transition
      const lastHistory = updatedException.statusHistory[updatedException.statusHistory.length - 1];
      expect(lastHistory.status).toBe(STATUS.REJECTED);
      expect(lastHistory.reason).toMatch(/series rejected/i);
    });

    it('RR-REC-2: rejecting a seriesMaster cascades addition doc status to rejected', async () => {
      const master = createRecurringSeriesMaster({
        status: 'pending',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const addition = createAdditionDocument(
        master,
        '2026-04-01',
        { startTime: '09:00', endTime: '10:00' },
        { status: 'pending' }
      );
      const [savedMaster] = await insertEvents(db, [master, addition]);

      await request(app)
        .put(`/api/admin/events/${savedMaster._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Rejecting whole series' })
        .expect(200);

      const updatedAddition = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: master.eventId,
        eventType: 'addition',
      });
      expect(updatedAddition).toBeTruthy();
      expect(updatedAddition.status).toBe(STATUS.REJECTED);
    });

    it('RR-REC-3: already soft-deleted exceptions are not touched by the cascade', async () => {
      // Regression guard: cascadeStatusUpdate filters isDeleted:{ $ne: true }.
      // A soft-deleted exception should remain status='deleted', not flip to 'rejected'.
      const master = createRecurringSeriesMaster({
        status: 'pending',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const deletedException = createExceptionDocument(
        master,
        '2026-03-17',
        { startTime: '10:30', endTime: '11:30' },
        { status: 'deleted', isDeleted: true }
      );
      const [savedMaster] = await insertEvents(db, [master, deletedException]);

      await request(app)
        .put(`/api/admin/events/${savedMaster._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Rejecting whole series' })
        .expect(200);

      const stillDeleted = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: master.eventId,
        eventType: 'exception',
      });
      expect(stillDeleted.status).toBe('deleted');
      expect(stillDeleted.isDeleted).toBe(true);
    });

    it('RR-REC-4: rejecting a non-recurring pending event does not error and touches no other docs', async () => {
      // Guards against accidentally cascading on non-recurring events, which have no children.
      // Also ensures the cascade branch does not break the existing non-recurring reject flow.
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      // Unrelated recurring series in the DB — its children must not be touched.
      const otherMaster = createRecurringSeriesMaster({
        status: 'pending',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const otherException = createExceptionDocument(
        otherMaster,
        '2026-03-17',
        { startTime: '10:30' },
        { status: 'pending' }
      );
      const [savedPending] = await insertEvents(db, [pending, otherMaster, otherException]);

      await request(app)
        .put(`/api/admin/events/${savedPending._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Unrelated rejection' })
        .expect(200);

      const untouchedException = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: otherMaster.eventId,
        eventType: 'exception',
      });
      expect(untouchedException.status).toBe('pending');
    });
  });
});
