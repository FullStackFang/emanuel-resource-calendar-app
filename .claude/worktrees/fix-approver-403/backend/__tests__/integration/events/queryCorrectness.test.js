/**
 * Query Correctness Tests (QC-1 to QC-3)
 *
 * Tests for Phase 2 code review fixes:
 * - C3: Admin-browse date filter uses local-time strings (not UTC)
 * - C4: my-events view limit raised to 500
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
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Query Correctness Tests (QC-1 to QC-3)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('queryCorrectness'));

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
  // QC-1: my-events view returns more than 100 events (C4)
  // ============================================
  describe('QC-1: my-events view allows up to 500 results', () => {
    it('should return more than 100 events when limit=500', async () => {
      // Create 120 events for the requester
      const events = [];
      for (let i = 0; i < 120; i++) {
        events.push(createPendingEvent({
          eventTitle: `Event ${i}`,
          userId: requesterUser.odataId,
          requesterEmail: requesterUser.email,
          roomReservationData: {
            requestedBy: {
              userId: requesterUser.odataId,
              email: requesterUser.email,
            },
          },
        }));
      }
      await insertEvents(db, events);

      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({ view: 'my-events', limit: '500' })
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(200);
      const returnedEvents = res.body.events || [];
      // Should return all 120, not capped at 100
      expect(returnedEvents.length).toBe(120);
    });
  });

  // ============================================
  // QC-2: approval-queue still capped at 100 (C4 safety check)
  // ============================================
  describe('QC-2: approval-queue view stays capped at 100', () => {
    it('should cap at 100 for non-my-events views', async () => {
      const events = [];
      for (let i = 0; i < 110; i++) {
        events.push(createPendingEvent({
          eventTitle: `Queue Event ${i}`,
          userId: `other-user-${i}`,
          requesterEmail: `user${i}@external.com`,
          roomReservationData: {
            requestedBy: {
              userId: `other-user-${i}`,
              email: `user${i}@external.com`,
            },
          },
        }));
      }
      await insertEvents(db, events);

      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({ view: 'approval-queue', limit: '500' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const returnedEvents = res.body.events || [];
      expect(returnedEvents.length).toBe(100);
    });
  });

  // ============================================
  // QC-3: Admin-browse date filter uses local-time comparison (C3)
  // ============================================
  describe('QC-3: Admin-browse date filter matches local-time stored dates', () => {
    it('should find events by date using local-time string comparison', async () => {
      // Event stored with local-time startDateTime (no Z suffix)
      const event = createPendingEvent({
        eventTitle: 'March 15 Event',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        calendarData: {
          eventTitle: 'March 15 Event',
          startDateTime: '2026-03-15T14:00:00',  // Local time, 2pm
          endDateTime: '2026-03-15T16:00:00',
          startDate: '2026-03-15',
          startTime: '14:00',
          endDate: '2026-03-15',
          endTime: '16:00',
          locations: [],
          locationDisplayNames: '',
          categories: ['Meeting'],
        },
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
          },
        },
      });

      await insertEvents(db, [event]);

      // Filter for March 15 — should find the event
      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({
          view: 'admin-browse',
          startDate: '2026-03-15',
          endDate: '2026-03-15',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const events = res.body.events || [];
      const titles = events.map(e => e.calendarData?.eventTitle || e.eventTitle);
      expect(titles).toContain('March 15 Event');
    });

    it('should exclude events outside the date range', async () => {
      const event = createPendingEvent({
        eventTitle: 'March 20 Event',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        calendarData: {
          eventTitle: 'March 20 Event',
          startDateTime: '2026-03-20T09:00:00',
          endDateTime: '2026-03-20T10:00:00',
          startDate: '2026-03-20',
          startTime: '09:00',
          endDate: '2026-03-20',
          endTime: '10:00',
          locations: [],
          locationDisplayNames: '',
          categories: ['Meeting'],
        },
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
          },
        },
      });

      await insertEvents(db, [event]);

      // Filter for March 15 only — should NOT find the March 20 event
      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({
          view: 'admin-browse',
          startDate: '2026-03-15',
          endDate: '2026-03-15',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const events = res.body.events || [];
      const titles = events.map(e => e.calendarData?.eventTitle || e.eventTitle);
      expect(titles).not.toContain('March 20 Event');
    });
  });
});
