/**
 * Approver Time Edits Tests (ATE-1 to ATE-4)
 *
 * Tests that when an approver edits start/end times on a pending event
 * and publishes, the time fields are correctly persisted in calendarData.
 *
 * Root cause: getProcessedFormData() deleted startDate/startTime/endDate/endTime
 * before sending to the backend, leaving calendarData.startTime/endTime stale.
 * The eventTransformers.js transformer then prioritized stale calendarData.startTime
 * over the correctly-updated calendarData.startDateTime, showing wrong/empty times.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Approver Time Edits Tests (ATE-1 to ATE-4)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('approverTimeEdits'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
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

  describe('ATE-1: Admin save with separate date/time fields persists calendarData times', () => {
    it('should update calendarData.startTime and calendarData.endTime when separate fields are sent', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Morning Meeting',
        // Factory defaults: startTime is derived from tomorrow's date
      });
      await insertEvents(db, [pending]);

      // Admin sends separate date/time fields (like handleSave does)
      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-04-01',
          startTime: '14:00',
          endDate: '2026-04-01',
          endTime: '16:00',
        });

      expect(res.status).toBe(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      expect(event.calendarData.startDate).toBe('2026-04-01');
      expect(event.calendarData.startTime).toBe('14:00');
      expect(event.calendarData.endDate).toBe('2026-04-01');
      expect(event.calendarData.endTime).toBe('16:00');
      expect(event.calendarData.startDateTime).toContain('2026-04-01T14:00');
      expect(event.calendarData.endDateTime).toContain('2026-04-01T16:00');
    });
  });

  describe('ATE-2: Admin save with only combined datetime derives separate fields', () => {
    it('should derive calendarData.startTime/endTime from startDateTime/endDateTime when separate fields are missing', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Afternoon Workshop',
      });
      await insertEvents(db, [pending]);

      // Admin sends ONLY combined datetime fields (like the broken approve flow did)
      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: '2026-04-01T10:30',
          endDateTime: '2026-04-01T12:00',
        });

      expect(res.status).toBe(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      // The defensive derivation should populate these
      expect(event.calendarData.startTime).toBe('10:30');
      expect(event.calendarData.endTime).toBe('12:00');
      expect(event.calendarData.startDate).toBe('2026-04-01');
      expect(event.calendarData.endDate).toBe('2026-04-01');
      expect(event.calendarData.startDateTime).toContain('2026-04-01T10:30');
      expect(event.calendarData.endDateTime).toContain('2026-04-01T12:00');
    });
  });

  describe('ATE-3: Separate fields take precedence over combined datetime', () => {
    it('should use separate fields when both combined and separate are provided', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Priority Test',
      });
      await insertEvents(db, [pending]);

      // Send both combined and separate fields (separate should win)
      const res = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDateTime: '2026-04-01T08:00',
          endDateTime: '2026-04-01T09:00',
          startDate: '2026-04-01',
          startTime: '09:00',
          endDate: '2026-04-01',
          endTime: '11:00',
        });

      expect(res.status).toBe(200);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      // Separate fields should be stored as-is
      expect(event.calendarData.startTime).toBe('09:00');
      expect(event.calendarData.endTime).toBe('11:00');
      expect(event.calendarData.startDate).toBe('2026-04-01');
      expect(event.calendarData.endDate).toBe('2026-04-01');
    });
  });

  describe('ATE-4: Full approve flow: save times then publish preserves correct times', () => {
    it('should persist time edits through the save-then-publish two-step flow', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Board Review',
        // Start with null/empty times to simulate [Hold] or unset times
        calendarData: {
          eventTitle: 'Board Review',
          eventDescription: 'Quarterly review',
          startDateTime: '2026-04-15T00:00',
          endDateTime: '2026-04-15T23:59',
          startDate: '2026-04-15',
          startTime: '',
          endDate: '2026-04-15',
          endTime: '',
          locations: [],
          locationDisplayNames: [],
          categories: ['Meeting'],
          setupTime: null,
          teardownTime: null,
          reservationStartTime: '',
          reservationEndTime: '',
          doorOpenTime: null,
          doorCloseTime: null,
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
        },
      });
      await insertEvents(db, [pending]);

      // Step 1: Approver saves time edits (mirroring handleApprove Step 1)
      const saveRes = await request(app)
        .put(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-04-15',
          startTime: '10:00',
          endDate: '2026-04-15',
          endTime: '12:00',
          startDateTime: '2026-04-15T10:00',
          endDateTime: '2026-04-15T12:00',
          eventTitle: 'Board Review',
        });

      expect(saveRes.status).toBe(200);
      const savedVersion = saveRes.body._version;

      // Verify Step 1 persisted the times
      const afterSave = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      expect(afterSave.calendarData.startTime).toBe('10:00');
      expect(afterSave.calendarData.endTime).toBe('12:00');
      expect(afterSave.calendarData.startDateTime).toContain('2026-04-15T10:00');
      expect(afterSave.calendarData.endDateTime).toContain('2026-04-15T12:00');

      // Step 2: Approver publishes (mirroring handleApprove Step 2)
      const publishRes = await request(app)
        .put(`/api/admin/events/${pending._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          _version: savedVersion,
          createCalendarEvent: true,
        });

      expect(publishRes.status).toBe(200);
      expect(publishRes.body.success).toBe(true);
      expect(publishRes.body.event.status).toBe('published');

      // Verify final state: times should still be correct after publish
      const afterPublish = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pending._id });
      expect(afterPublish.status).toBe('published');
      expect(afterPublish.calendarData.startTime).toBe('10:00');
      expect(afterPublish.calendarData.endTime).toBe('12:00');
      expect(afterPublish.calendarData.startDateTime).toContain('2026-04-15T10:00');
      expect(afterPublish.calendarData.endDateTime).toContain('2026-04-15T12:00');
    });
  });
});
