/**
 * Hold Event Tests (HE-1 to HE-7)
 *
 * Tests that [Hold] events (reservation times set, event times blank)
 * are stored correctly across all submission paths, ensuring
 * calendarData.startTime/endTime remain empty for isHold detection.
 *
 * HE-6/HE-7: Verify that calendar-load (POST /api/events/calendar-load)
 * returns event.subject with [Hold] prefix for hold events.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createApprover,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Hold Event Tests (HE-1 to HE-5)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser, approverUser, adminUser;
  let requesterToken, approverToken, adminToken;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('holdEvent'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    graphApiMock.resetMocks();

    requesterUser = createRequester();
    approverUser = createApprover();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, approverUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  describe('HE-1: Requester submits event with reservation times but no event times', () => {
    it('should store empty calendarData.startTime/endTime for [Hold] detection', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Hold Event - No Times',
          startDateTime: `${dateStr}T08:00`,
          endDateTime: `${dateStr}T18:00`,
          locations: [],
          requesterName: requesterUser.name || requesterUser.displayName,
          requesterEmail: requesterUser.email,
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          // Raw event times: empty (user did not specify)
          eventStartTime: '',
          eventEndTime: '',
        })
        .expect(201);

      // calendarData.startTime and endTime should be empty (not extracted from startDateTime)
      expect(res.body.calendarData.startTime).toBe('');
      expect(res.body.calendarData.endTime).toBe('');
      // But reservationStartTime/reservationEndTime should be preserved
      expect(res.body.calendarData.reservationStartTime).toBe('08:00');
      expect(res.body.calendarData.reservationEndTime).toBe('18:00');
      // startDateTime should still be populated (for calendar positioning)
      expect(res.body.calendarData.startDateTime).toBeTruthy();
    });
  });

  describe('HE-2: Requester submits event with both event times and reservation times', () => {
    it('should store event times in calendarData.startTime/endTime (not Hold)', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Normal Event - With Times',
          startDateTime: `${dateStr}T10:00`,
          endDateTime: `${dateStr}T16:00`,
          locations: [],
          requesterName: requesterUser.name || requesterUser.displayName,
          requesterEmail: requesterUser.email,
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          // Raw event times: user specified these
          eventStartTime: '10:00',
          eventEndTime: '16:00',
        })
        .expect(201);

      // calendarData.startTime and endTime should have the event times
      expect(res.body.calendarData.startTime).toBe('10:00');
      expect(res.body.calendarData.endTime).toBe('16:00');
    });
  });

  describe('HE-3: Backward compatibility - request without eventStartTime/eventEndTime', () => {
    it('should fall back to extracting times from startDateTime', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Legacy Event - No Raw Times',
          startDateTime: `${dateStr}T10:00`,
          endDateTime: `${dateStr}T16:00`,
          locations: [],
          requesterName: requesterUser.name || requesterUser.displayName,
          requesterEmail: requesterUser.email,
          // No eventStartTime/eventEndTime fields (older client)
        })
        .expect(201);

      // Should fall back to extracting from startDateTime
      expect(res.body.calendarData.startTime).toBe('10:00');
      expect(res.body.calendarData.endTime).toBe('16:00');
    });
  });

  describe('HE-4: Publishing a [Hold] event uses [Hold] prefix in subject', () => {
    it('should add [Hold] prefix when calendarData.startTime/endTime are empty', async () => {
      // Create a pending event with empty startTime/endTime (Hold event)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Hold For Publish',
          startDateTime: `${dateStr}T08:00`,
          endDateTime: `${dateStr}T18:00`,
          locations: [],
          requesterName: requesterUser.name || requesterUser.displayName,
          requesterEmail: requesterUser.email,
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          eventStartTime: '',
          eventEndTime: '',
        })
        .expect(201);

      const eventId = res.body._id;

      // Verify the stored event has empty startTime/endTime
      const storedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: new ObjectId(eventId) });
      expect(storedEvent.calendarData.startTime).toBe('');
      expect(storedEvent.calendarData.endTime).toBe('');

      // Publish the event
      const publishRes = await request(app)
        .put(`/api/admin/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: 1, forcePublish: true })
        .expect(200);

      // Verify the Graph event subject has [Hold] prefix
      const publishedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: new ObjectId(eventId) });
      expect(publishedEvent.status).toBe(STATUS.PUBLISHED);
      // The graphData.subject should have the [Hold] prefix via buildGraphSubject
      if (publishedEvent.graphData?.subject) {
        expect(publishedEvent.graphData.subject).toContain('[Hold]');
      }
    });
  });

  describe('HE-5: Draft-submit path still preserves [Hold] behavior (regression)', () => {
    it('should keep empty startTime/endTime through draft submit flow', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      // Create a draft with empty event times but with reservation times
      const draft = createDraftEvent({
        userId: approverUser.odataId,
        requesterEmail: approverUser.email,
        eventTitle: 'Draft Hold Event',
        calendarData: {
          eventTitle: 'Draft Hold Event',
          eventDescription: '',
          startDateTime: `${dateStr}T08:00`,
          endDateTime: `${dateStr}T18:00`,
          startDate: dateStr,
          startTime: '',
          endDate: dateStr,
          endTime: '',
          locations: [{ displayName: 'Room A' }],
          locationDisplayNames: ['Room A'],
          categories: ['Meeting'],
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          setupTime: null,
          teardownTime: null,
          doorOpenTime: null,
          doorCloseTime: null,
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartMinutes: 0,
          reservationEndMinutes: 0,
        },
      });
      const [savedDraft] = await insertEvents(db, [draft]);

      // Submit the draft (approver auto-publishes)
      const res = await request(app)
        .post(`/api/room-reservations/draft/${savedDraft._id}/submit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify the submitted event still has empty startTime/endTime
      const submittedEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedDraft._id });
      expect(submittedEvent.calendarData.startTime).toBe('');
      expect(submittedEvent.calendarData.endTime).toBe('');
      expect(submittedEvent.calendarData.reservationStartTime).toBe('08:00');
      expect(submittedEvent.calendarData.reservationEndTime).toBe('18:00');
    });
  });

  describe('HE-6: Calendar-load returns [Hold] prefix in event.subject for hold events', () => {
    it('should include [Hold] prefix in subject for pending hold events', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      // Create a pending hold event (no event times, has reservation times)
      const holdEvent = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Room Hold Pending',
        calendarData: {
          eventTitle: 'Room Hold Pending',
          eventDescription: '',
          startDateTime: `${dateStr}T08:00`,
          endDateTime: `${dateStr}T18:00`,
          startDate: dateStr,
          startTime: '',
          endDate: dateStr,
          endTime: '',
          locations: [],
          locationDisplayNames: [],
          categories: ['Meeting'],
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartMinutes: 0,
          reservationEndMinutes: 0,
        },
      });
      await insertEvents(db, [holdEvent]);

      // Load events via calendar-load endpoint (mirrors getUnifiedEvents normalization)
      const res = await request(app)
        .post('/api/events/calendar-load')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: `${dateStr}T00:00:00`,
          endDate: `${dateStr}T23:59:59`,
        })
        .expect(200);

      const loadedEvent = res.body.events.find(e => String(e._id) === String(holdEvent._id));
      expect(loadedEvent).toBeDefined();
      expect(loadedEvent.subject).toBe('[Hold] Room Hold Pending');
    });

    it('should NOT include [Hold] prefix for events with event times', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      // Create a normal pending event (has event times)
      const normalEvent = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Normal Pending Event',
        calendarData: {
          eventTitle: 'Normal Pending Event',
          eventDescription: '',
          startDateTime: `${dateStr}T10:00`,
          endDateTime: `${dateStr}T16:00`,
          startDate: dateStr,
          startTime: '10:00',
          endDate: dateStr,
          endTime: '16:00',
          locations: [],
          locationDisplayNames: [],
          categories: ['Meeting'],
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartMinutes: 0,
          reservationEndMinutes: 0,
        },
      });
      await insertEvents(db, [normalEvent]);

      const res = await request(app)
        .post('/api/events/calendar-load')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: `${dateStr}T00:00:00`,
          endDate: `${dateStr}T23:59:59`,
        })
        .expect(200);

      const loadedEvent = res.body.events.find(e => String(e._id) === String(normalEvent._id));
      expect(loadedEvent).toBeDefined();
      expect(loadedEvent.subject).toBe('Normal Pending Event');
    });
  });

  describe('HE-7: Calendar-load returns [Hold] for published hold events', () => {
    it('should include [Hold] prefix for published events without event times', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      // Create a published hold event (no event times, has reservation times)
      const holdEvent = createPublishedEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Published Room Hold',
        calendarData: {
          eventTitle: 'Published Room Hold',
          eventDescription: '',
          startDateTime: `${dateStr}T08:00`,
          endDateTime: `${dateStr}T18:00`,
          startDate: dateStr,
          startTime: '',
          endDate: dateStr,
          endTime: '',
          locations: [],
          locationDisplayNames: [],
          categories: ['Meeting'],
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartMinutes: 0,
          reservationEndMinutes: 0,
        },
      });
      await insertEvents(db, [holdEvent]);

      const res = await request(app)
        .post('/api/events/calendar-load')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: `${dateStr}T00:00:00`,
          endDate: `${dateStr}T23:59:59`,
        })
        .expect(200);

      const loadedEvent = res.body.events.find(e => String(e._id) === String(holdEvent._id));
      expect(loadedEvent).toBeDefined();
      expect(loadedEvent.subject).toBe('[Hold] Published Room Hold');
    });
  });

  describe('HE-8: [Hold] prefix stacking regression — contaminated eventTitle is healed', () => {
    it('should strip stacked [Hold] prefixes and produce exactly one', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      // Simulate a contaminated event where Graph sync wrote [Hold] back to eventTitle
      // multiple times (the bug being fixed)
      const contaminatedEvent = createPublishedEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: '[Hold] [Hold] [Hold] Stacked Title',
        calendarData: {
          eventTitle: '[Hold] [Hold] [Hold] Stacked Title',
          eventDescription: '',
          startDateTime: `${dateStr}T08:00`,
          endDateTime: `${dateStr}T18:00`,
          startDate: dateStr,
          startTime: '',
          endDate: dateStr,
          endTime: '',
          locations: [],
          locationDisplayNames: [],
          categories: ['Meeting'],
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartMinutes: 0,
          reservationEndMinutes: 0,
        },
      });
      await insertEvents(db, [contaminatedEvent]);

      const res = await request(app)
        .post('/api/events/calendar-load')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: `${dateStr}T00:00:00`,
          endDate: `${dateStr}T23:59:59`,
        })
        .expect(200);

      const loadedEvent = res.body.events.find(e => String(e._id) === String(contaminatedEvent._id));
      expect(loadedEvent).toBeDefined();
      // Should have exactly one [Hold] prefix, not stacked
      expect(loadedEvent.subject).toBe('[Hold] Stacked Title');
    });

    it('should not add [Hold] prefix to contaminated title when event has times', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      // Event WITH times but with leftover [Hold] in eventTitle (data corruption)
      const contaminatedNormal = createPublishedEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: '[Hold] Should Not Be Hold',
        calendarData: {
          eventTitle: '[Hold] Should Not Be Hold',
          eventDescription: '',
          startDateTime: `${dateStr}T10:00`,
          endDateTime: `${dateStr}T16:00`,
          startDate: dateStr,
          startTime: '10:00',
          endDate: dateStr,
          endTime: '16:00',
          locations: [],
          locationDisplayNames: [],
          categories: ['Meeting'],
          reservationStartTime: '08:00',
          reservationEndTime: '18:00',
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
          reservationStartMinutes: 0,
          reservationEndMinutes: 0,
        },
      });
      await insertEvents(db, [contaminatedNormal]);

      const res = await request(app)
        .post('/api/events/calendar-load')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: `${dateStr}T00:00:00`,
          endDate: `${dateStr}T23:59:59`,
        })
        .expect(200);

      const loadedEvent = res.body.events.find(e => String(e._id) === String(contaminatedNormal._id));
      expect(loadedEvent).toBeDefined();
      // Should strip [Hold] and NOT re-add it (event has times, not a hold)
      expect(loadedEvent.subject).toBe('Should Not Be Hold');
    });
  });
});
