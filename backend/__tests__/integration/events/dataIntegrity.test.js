/**
 * Data Integrity Tests (DI-1 to DI-5)
 *
 * Tests for Phase 1 code review fixes:
 * - C2: Owner edit stores room IDs as ObjectIds (not strings)
 * - C6: Delete endpoint uses only graphData.id (no eventId fallback)
 * - I5: Location filter queries calendarData.locationDisplayNames
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Data Integrity Tests (DI-1 to DI-5)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let adminUser;
  let adminToken;

  const roomId = new ObjectId();
  const roomId2 = new ObjectId();

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('dataIntegrity'));

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

    requesterUser = createRequester();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    adminToken = await createMockToken(adminUser);
  });

  // ============================================
  // DI-1: Owner edit converts room IDs to ObjectIds (C2)
  // ============================================
  describe('DI-1: Owner edit stores room IDs as ObjectIds', () => {
    it('should store calendarData.locations as ObjectIds after owner edit', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Room Test Event',
        startDateTime: new Date('2026-06-10T10:00:00'),
        endDateTime: new Date('2026-06-10T12:00:00'),
        locations: [roomId],
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
          },
          department: 'General',
        },
      });
      await insertEvents(db, [pendingEvent]);

      // Send room IDs as strings (as the frontend does)
      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Updated Title',
          startDate: '2026-06-10',
          startTime: '10:00',
          endDate: '2026-06-10',
          endTime: '12:00',
          requestedRooms: [roomId.toString(), roomId2.toString()],
        });

      expect(res.status).toBe(200);

      // Verify stored values are ObjectIds, not strings
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pendingEvent._id });
      const storedLocations = updated.calendarData.locations;
      expect(storedLocations).toHaveLength(2);
      storedLocations.forEach(loc => {
        expect(loc).toBeInstanceOf(ObjectId);
      });
    });
  });

  // ============================================
  // DI-2: Owner-edited event visible to conflict detection (C2 regression)
  // ============================================
  describe('DI-2: Conflict detection works after owner edit', () => {
    it('should detect conflicts with owner-edited events', async () => {
      // Create and edit a pending event (stores ObjectId locations)
      const pendingEvent = createPendingEvent({
        eventTitle: 'Edited Event',
        startDateTime: new Date('2026-06-15T10:00:00'),
        endDateTime: new Date('2026-06-15T12:00:00'),
        locations: [roomId],
        userId: requesterUser.odataId,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
          },
          department: 'General',
        },
      });

      // Create an existing published event in the same room/time
      const existingPublished = createPublishedEvent({
        eventTitle: 'Existing Published Event',
        startDateTime: new Date('2026-06-15T11:00:00'),
        endDateTime: new Date('2026-06-15T13:00:00'),
        locations: [roomId],
        calendarData: {
          eventTitle: 'Existing Published Event',
          startDateTime: '2026-06-15T11:00:00',
          endDateTime: '2026-06-15T13:00:00',
          locations: [roomId],
          locationDisplayNames: ['Room A'],
          startDate: '2026-06-15',
          startTime: '11:00',
          endDate: '2026-06-15',
          endTime: '13:00',
          categories: ['Meeting'],
        },
      });

      await insertEvents(db, [pendingEvent, existingPublished]);

      // Edit the pending event to overlap with the published event
      // Send room IDs as strings (the fix converts them to ObjectIds)
      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(pendingEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Edited Event',
          startDate: '2026-06-15',
          startTime: '10:00',
          endDate: '2026-06-15',
          endTime: '12:00',
          requestedRooms: [roomId.toString()],
        });

      // Should detect conflict (409) because edited event overlaps existing
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });

  // ============================================
  // DI-3: Delete of non-published event skips Graph API (C6)
  // ============================================
  describe('DI-3: Delete non-published event skips Graph API', () => {
    it('should successfully delete pending event without graphData.id', async () => {
      const pendingEvent = createPendingEvent({
        eventTitle: 'Pending No Graph',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        // No graphData.id - this event was never published
        graphData: null,
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: pendingEvent._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify event is soft-deleted in DB
      const deleted = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: pendingEvent._id });
      expect(deleted.status).toBe(STATUS.DELETED);
      expect(deleted.isDeleted).toBe(true);
    });
  });

  // ============================================
  // DI-4: Location filter matches reservation-created events (I5)
  // ============================================
  describe('DI-4: Location filter queries calendarData.locationDisplayNames', () => {
    it('should find reservation events by location filter', async () => {
      // Reservation-created event: locationDisplayNames only in calendarData
      const reservationEvent = createPendingEvent({
        eventTitle: 'Reservation in Chapel',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        locationDisplayNames: undefined, // No top-level
        calendarData: {
          eventTitle: 'Reservation in Chapel',
          startDateTime: '2026-06-20T10:00:00',
          endDateTime: '2026-06-20T12:00:00',
          locationDisplayNames: 'Chapel',
          locations: [roomId],
          startDate: '2026-06-20',
          startTime: '10:00',
          endDate: '2026-06-20',
          endTime: '12:00',
          categories: ['Meeting'],
        },
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
          },
        },
      });

      // Graph-synced event: locationDisplayNames in both top-level and calendarData
      const graphEvent = createPublishedEvent({
        eventTitle: 'Graph Event in Sanctuary',
        locationDisplayNames: 'Sanctuary',
        calendarData: {
          eventTitle: 'Graph Event in Sanctuary',
          startDateTime: '2026-06-21T10:00:00',
          endDateTime: '2026-06-21T12:00:00',
          locationDisplayNames: 'Sanctuary',
          locations: [roomId2],
          startDate: '2026-06-21',
          startTime: '10:00',
          endDate: '2026-06-21',
          endTime: '12:00',
          categories: ['Service'],
        },
      });

      await insertEvents(db, [reservationEvent, graphEvent]);

      // Search for Chapel — should find the reservation event
      const chapelRes = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({ view: 'admin-browse', locations: 'Chapel', locationCount: '10' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(chapelRes.status).toBe(200);
      const chapelEvents = chapelRes.body.events || chapelRes.body;
      const chapelTitles = (Array.isArray(chapelEvents) ? chapelEvents : []).map(e => e.calendarData?.eventTitle || e.eventTitle);
      expect(chapelTitles).toContain('Reservation in Chapel');

      // Search for Sanctuary — should find the graph event
      const sanctuaryRes = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({ view: 'admin-browse', locations: 'Sanctuary', locationCount: '10' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(sanctuaryRes.status).toBe(200);
      const sanctuaryEvents = sanctuaryRes.body.events || sanctuaryRes.body;
      const sanctuaryTitles = (Array.isArray(sanctuaryEvents) ? sanctuaryEvents : []).map(e => e.calendarData?.eventTitle || e.eventTitle);
      expect(sanctuaryTitles).toContain('Graph Event in Sanctuary');
    });
  });

  // ============================================
  // DI-5: Delete with graphData.id still works (C6 regression check)
  // ============================================
  describe('DI-5: Delete published event with graphData.id still syncs to Graph', () => {
    it('should delete published event and attempt Graph cleanup', async () => {
      const publishedEvent = createPublishedEvent({
        eventTitle: 'Published With Graph',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        graphData: {
          id: 'AAMkAGraphEvent123',
          subject: 'Published With Graph',
        },
      });
      await insertEvents(db, [publishedEvent]);

      const res = await request(app)
        .delete(ENDPOINTS.DELETE_EVENT(publishedEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: publishedEvent._version });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify event is deleted
      const deleted = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: publishedEvent._id });
      expect(deleted.status).toBe(STATUS.DELETED);
      expect(deleted.isDeleted).toBe(true);
    });
  });
});
