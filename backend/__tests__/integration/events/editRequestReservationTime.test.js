/**
 * Edit Request Reservation Time Tests (ERT-1 to ERT-5)
 *
 * Tests that reservation time fields (reservationStartTime, reservationEndTime,
 * reservationStartMinutes, reservationEndMinutes) are properly tracked and
 * applied through the edit request pipeline.
 *
 * Bug context: When a requester changed reservationStartTime in an edit request,
 * the field was missing from proposedChanges and not shown to the approver.
 * Root cause: reservationStartTime/reservationEndTime were not in the backend's
 * fieldsToCompare array in POST /api/events/:id/request-edit.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Edit Request Reservation Time Tests (ERT-1 to ERT-5)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestReservationTime'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  describe('Request-edit: reservation time change detection', () => {
    it('ERT-1: should store reservationStartTime change in proposedChanges', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        reservationStartTime: '06:00',
        reservationEndTime: '09:00',
        reservationStartMinutes: 60,
        reservationEndMinutes: 30,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: { reservationStartTime: '06:30' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.reservationStartTime).toBe('06:30');
    });

    it('ERT-2: should store reservationEndTime change in proposedChanges', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        reservationStartTime: '06:00',
        reservationEndTime: '09:00',
        reservationStartMinutes: 60,
        reservationEndMinutes: 30,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: { reservationEndTime: '09:30' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.reservationEndTime).toBe('09:30');
    });

    it('ERT-3: should store reservationStartMinutes change in proposedChanges', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        reservationStartMinutes: 60,
        reservationEndMinutes: 30,
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: { reservationStartMinutes: 30 },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.reservationStartMinutes).toBe(30);
    });
  });

  describe('Publish-edit: reservation time change application', () => {
    it('ERT-4: should apply reservationStartTime from proposedChanges to calendarData', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Test Event',
        reservationStartTime: '06:00',
        reservationEndTime: '09:00',
        reservationStartMinutes: 60,
        reservationEndMinutes: 30,
        requestedChanges: {
          reservationStartTime: '06:30',
          reservationStartMinutes: 30,
        },
      });
      const [saved] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify reservation time was written to calendarData
      const dbEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(dbEvent.calendarData.reservationStartTime).toBe('06:30');
      expect(dbEvent.calendarData.reservationStartMinutes).toBe(30);
    });

    it('ERT-5: should preserve unchanged reservation time fields when applying other changes', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        reservationStartTime: '06:00',
        reservationEndTime: '09:00',
        reservationStartMinutes: 60,
        reservationEndMinutes: 30,
        requestedChanges: {
          eventTitle: 'Updated Title',
        },
      });
      const [saved] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Title should be updated
      const dbEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(dbEvent.calendarData.eventTitle).toBe('Updated Title');

      // Reservation times should be preserved (unchanged)
      expect(dbEvent.calendarData.reservationStartTime).toBe('06:00');
      expect(dbEvent.calendarData.reservationEndTime).toBe('09:00');
      expect(dbEvent.calendarData.reservationStartMinutes).toBe(60);
      expect(dbEvent.calendarData.reservationEndMinutes).toBe(30);
    });
  });

  describe('Publish-edit: [Hold] event time preservation', () => {
    it('ERT-6: should preserve empty startTime/endTime when proposedChanges includes startTime', async () => {
      // [Hold] event: startTime='' (no event time), but startDateTime has reservation time
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Hold Event',
        reservationStartTime: '14:00',
        reservationEndTime: '17:00',
        requestedChanges: {
          eventTitle: 'Updated Hold',
          // startTime: '' explicitly in proposedChanges — activates the publish-edit guard
          startTime: '',
          endTime: '',
        },
      });
      // Override calendarData to simulate a Hold event
      eventWithEdit.calendarData.startTime = '';
      eventWithEdit.calendarData.endTime = '';
      eventWithEdit.calendarData.startDateTime = '2026-04-15T14:00:00';
      eventWithEdit.calendarData.endDateTime = '2026-04-15T17:00:00';

      const [saved] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const dbEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      // Title should be updated
      expect(dbEvent.calendarData.eventTitle).toBe('Updated Hold');
      // Event times must remain empty — NOT overwritten by reservation times
      expect(dbEvent.calendarData.startTime).toBe('');
      expect(dbEvent.calendarData.endTime).toBe('');
    });

  });
});
