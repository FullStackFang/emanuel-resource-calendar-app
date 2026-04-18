/**
 * Pending Reservation Visibility Tests (PRV-1 to PRV-8)
 *
 * Tests that pending reservations appear as informational conflicts
 * in the GET /api/rooms/availability endpoint.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createDraftEvent,
  createRejectedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Pending Reservation Visibility Tests (PRV-1 to PRV-8)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let requesterUser;
  let requesterToken;

  const roomAId = new ObjectId();
  const roomBId = new ObjectId();

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('pendingVisibility'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);
    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);

    // Create two reservable rooms
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([
      {
        _id: roomAId,
        name: 'Room A',
        displayName: 'Room A',
        code: 'ROOM-A',
        isReservable: true,
        active: true,
        capacity: 50,
      },
      {
        _id: roomBId,
        name: 'Room B',
        displayName: 'Room B',
        code: 'ROOM-B',
        isReservable: true,
        active: true,
        capacity: 30,
      },
    ]);

    graphApiMock.resetMocks();
  });

  // PRV-1: Availability returns pending reservations in pendingReservations array
  describe('PRV-1: Pending reservations appear in availability', () => {
    it('should return pending events in the pendingReservations array', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Pending BM Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: '2026-04-15T00:00:00',
          endDateTime: '2026-04-15T23:59:59',
          roomIds: roomAId.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);

      const roomA = res.body[0];
      expect(roomA.conflicts.pendingReservations).toHaveLength(1);
      expect(roomA.conflicts.pendingReservations[0].eventTitle).toBe('Pending BM Event');
      expect(roomA.conflicts.pendingReservations[0].isPendingReservation).toBe(true);
      expect(roomA.conflicts.pendingReservations[0].status).toBe('pending');

      // totalConflicts should NOT include pending reservations (only hard conflicts)
      expect(roomA.conflicts.totalConflicts).toBe(0);
      expect(roomA.conflicts.reservations).toHaveLength(0);
    });
  });

  // PRV-2: Pending reservation for room A does NOT appear in room B
  describe('PRV-2: Room isolation', () => {
    it('should not return pending events from other rooms', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Room A Only Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: '2026-04-15T00:00:00',
          endDateTime: '2026-04-15T23:59:59',
          roomIds: roomBId.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].conflicts.pendingReservations).toHaveLength(0);
    });
  });

  // PRV-3: excludeEventId excludes the user's own pending event
  describe('PRV-3: Self-exclusion via excludeEventId', () => {
    it('should exclude the specified event from pendingReservations', async () => {
      const myPending = createPendingEvent({
        eventTitle: 'My Own Pending Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });
      const otherPending = createPendingEvent({
        eventTitle: 'Other Pending Event',
        startDateTime: new Date('2026-04-15T11:00:00'),
        endDateTime: new Date('2026-04-15T13:00:00'),
        locations: [roomAId],
      });
      const [savedMy, savedOther] = await insertEvents(db, [myPending, otherPending]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: '2026-04-15T00:00:00',
          endDateTime: '2026-04-15T23:59:59',
          roomIds: roomAId.toString(),
          excludeEventId: savedMy._id.toString(),
        });

      expect(res.status).toBe(200);
      const roomA = res.body[0];
      expect(roomA.conflicts.pendingReservations).toHaveLength(1);
      expect(roomA.conflicts.pendingReservations[0].eventTitle).toBe('Other Pending Event');
    });
  });

  // PRV-4: Draft and rejected events are NOT in pendingReservations
  describe('PRV-4: Only pending status returned', () => {
    it('should not return draft or rejected events in pendingReservations', async () => {
      const draftEvent = createDraftEvent({
        eventTitle: 'Draft Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });
      const rejectedEvent = createRejectedEvent({
        eventTitle: 'Rejected Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });
      await insertEvents(db, [draftEvent, rejectedEvent]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: '2026-04-15T00:00:00',
          endDateTime: '2026-04-15T23:59:59',
          roomIds: roomAId.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body[0].conflicts.pendingReservations).toHaveLength(0);
      // Draft/rejected also don't appear in hard conflicts
      expect(res.body[0].conflicts.reservations).toHaveLength(0);
    });
  });

  // PRV-5: Pending reservations with non-overlapping times are NOT returned
  describe('PRV-5: Time window filtering', () => {
    it('should not return pending events outside the queried time window', async () => {
      const earlyPending = createPendingEvent({
        eventTitle: 'Early Morning Event',
        startDateTime: new Date('2026-04-15T06:00:00'),
        endDateTime: new Date('2026-04-15T08:00:00'),
        locations: [roomAId],
      });
      const latePending = createPendingEvent({
        eventTitle: 'Late Evening Event',
        startDateTime: new Date('2026-04-15T20:00:00'),
        endDateTime: new Date('2026-04-15T22:00:00'),
        locations: [roomAId],
      });
      await insertEvents(db, [earlyPending, latePending]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: '2026-04-15T10:00:00',
          endDateTime: '2026-04-15T14:00:00',
          roomIds: roomAId.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body[0].conflicts.pendingReservations).toHaveLength(0);
    });
  });

  // PRV-6: Multiple pending reservations for same room/time all appear
  describe('PRV-6: Multiple pending events returned', () => {
    it('should return all pending events for the same room/time window', async () => {
      const pending1 = createPendingEvent({
        eventTitle: 'BM Coordinator A',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });
      const pending2 = createPendingEvent({
        eventTitle: 'BM Coordinator B',
        startDateTime: new Date('2026-04-15T10:30:00'),
        endDateTime: new Date('2026-04-15T12:30:00'),
        locations: [roomAId],
      });
      const pending3 = createPendingEvent({
        eventTitle: 'BM Coordinator C',
        startDateTime: new Date('2026-04-15T11:00:00'),
        endDateTime: new Date('2026-04-15T13:00:00'),
        locations: [roomAId],
      });
      await insertEvents(db, [pending1, pending2, pending3]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: '2026-04-15T00:00:00',
          endDateTime: '2026-04-15T23:59:59',
          roomIds: roomAId.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body[0].conflicts.pendingReservations).toHaveLength(3);
    });
  });

  // PRV-7: Publish endpoint still ignores pending events (not blocking)
  describe('PRV-7: Pending events do not block publish', () => {
    it('should publish successfully even when pending events overlap', async () => {
      // Create an existing pending event in the same room/time
      const existingPending = createPendingEvent({
        eventTitle: 'Existing Pending BM',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });

      // Create the event to be published (also pending)
      const toPublish = createPendingEvent({
        eventTitle: 'Event To Publish',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });

      await insertEvents(db, [existingPending, toPublish]);
      const saved = await db.collection(COLLECTIONS.EVENTS).findOne({ 'calendarData.eventTitle': 'Event To Publish' });

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createCalendarEvent: false });

      // Should succeed — pending events do not create hard conflicts
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
    });
  });

  // PRV-8: Pending and published events coexist in response
  describe('PRV-8: Mixed pending and published events in response', () => {
    it('should return both pending and published events in separate arrays', async () => {
      const publishedEvent = createPublishedEvent({
        eventTitle: 'Published Event',
        startDateTime: new Date('2026-04-15T09:00:00'),
        endDateTime: new Date('2026-04-15T11:00:00'),
        locations: [roomAId],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'Pending Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomAId],
      });
      await insertEvents(db, [publishedEvent, pendingEvent]);

      const res = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: '2026-04-15T00:00:00',
          endDateTime: '2026-04-15T23:59:59',
          roomIds: roomAId.toString(),
        });

      expect(res.status).toBe(200);
      const roomA = res.body[0];

      // Published appears in reservations (hard conflicts)
      expect(roomA.conflicts.reservations).toHaveLength(1);
      expect(roomA.conflicts.reservations[0].eventTitle).toBe('Published Event');

      // Pending appears in pendingReservations (informational)
      expect(roomA.conflicts.pendingReservations).toHaveLength(1);
      expect(roomA.conflicts.pendingReservations[0].eventTitle).toBe('Pending Event');

      // totalConflicts only counts hard conflicts
      expect(roomA.conflicts.totalConflicts).toBe(1);
    });
  });
});
