/**
 * Calendar Load Tests (PL-1 to PL-6, DL-1 to DL-4)
 *
 * Tests that pending and draft events appear correctly in the calendar view
 * based on user role and ownership.
 *
 * PL-1: Admin sees pending events on calendar
 * PL-2: Approver sees pending events on calendar
 * PL-3: Requester sees only their own pending events
 * PL-4: Requester does NOT see others' pending events
 * PL-5: Viewer sees NO pending events
 * PL-6: room-reservation-request status also shows for admins
 *
 * DL-1: Creator sees their own draft on calendar
 * DL-2: Admin does NOT see others' drafts on calendar
 * DL-3: Incomplete drafts (no dates) are excluded
 * DL-4: Draft shows with correct status field in response
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createApprover,
  createRequester,
  createOtherRequester,
  createViewer,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createDraftEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS, TEST_CALENDAR_OWNER, TEST_EMAILS } = require('../../__helpers__/testConstants');

describe('Calendar Load Tests', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;

  // Users
  let adminUser, approverUser, requesterUser, otherRequesterUser, viewerUser;
  let adminToken, approverToken, requesterToken, otherRequesterToken, viewerToken;

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

    // Create users
    adminUser = createAdmin();
    approverUser = createApprover();
    requesterUser = createRequester();
    otherRequesterUser = createOtherRequester();
    viewerUser = createViewer();

    await insertUsers(db, [adminUser, approverUser, requesterUser, otherRequesterUser, viewerUser]);

    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequesterUser);
    viewerToken = await createMockToken(viewerUser);
  });

  // Helper to load calendar events
  const loadCalendarEvents = async (token, calendarOwner = TEST_CALENDAR_OWNER) => {
    const response = await request(app)
      .post(ENDPOINTS.LOAD_EVENTS)
      .set('Authorization', `Bearer ${token}`)
      .send({ calendarOwner });
    return response;
  };

  // ==========================================
  // PENDING EVENT TESTS (PL-1 to PL-6)
  // ==========================================

  describe('Pending Events on Calendar', () => {
    let requesterPending, otherPending, publishedEvent;

    beforeEach(async () => {
      // Create a pending event owned by requester
      requesterPending = createPendingEvent({
        eventTitle: 'Requester Pending Event',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        createdByEmail: requesterUser.email,
      });

      // Create a pending event owned by other requester
      otherPending = createPendingEvent({
        eventTitle: 'Other Pending Event',
        userId: otherRequesterUser.odataId,
        requesterEmail: otherRequesterUser.email,
        createdByEmail: otherRequesterUser.email,
      });

      // Create a published event (visible to all)
      publishedEvent = createPublishedEvent({
        eventTitle: 'Published Event',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        createdByEmail: requesterUser.email,
      });

      await insertEvents(db, [requesterPending, otherPending, publishedEvent]);
    });

    test('PL-1: Admin sees all pending events on calendar', async () => {
      const res = await loadCalendarEvents(adminToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      expect(eventTitles).toContain('Requester Pending Event');
      expect(eventTitles).toContain('Other Pending Event');
      expect(eventTitles).toContain('Published Event');
    });

    test('PL-2: Approver sees all pending events on calendar', async () => {
      const res = await loadCalendarEvents(approverToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      expect(eventTitles).toContain('Requester Pending Event');
      expect(eventTitles).toContain('Other Pending Event');
      expect(eventTitles).toContain('Published Event');
    });

    test('PL-3: Requester sees only their own pending events', async () => {
      const res = await loadCalendarEvents(requesterToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      expect(eventTitles).toContain('Requester Pending Event');
      expect(eventTitles).toContain('Published Event');
    });

    test('PL-4: Requester does NOT see others\' pending events', async () => {
      const res = await loadCalendarEvents(requesterToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      expect(eventTitles).not.toContain('Other Pending Event');
    });

    test('PL-5: Viewer sees NO pending events', async () => {
      const res = await loadCalendarEvents(viewerToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const pendingEvents = events.filter(e => e.status === 'pending');

      expect(pendingEvents).toHaveLength(0);
      // But published event should still be visible
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);
      expect(eventTitles).toContain('Published Event');
    });

    test('PL-6: room-reservation-request status shows for admins', async () => {
      // Create event with room-reservation-request status
      const rrEvent = createPendingEvent({
        eventTitle: 'Room Request Event',
        status: 'room-reservation-request',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        createdByEmail: requesterUser.email,
      });
      await insertEvents(db, [rrEvent]);

      const res = await loadCalendarEvents(adminToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      expect(eventTitles).toContain('Room Request Event');
    });
  });

  // ==========================================
  // DRAFT EVENT TESTS (DL-1 to DL-4)
  // ==========================================

  describe('Draft Events on Calendar', () => {
    let requesterDraft, adminDraft, publishedEvent;

    beforeEach(async () => {
      // Create a draft with dates owned by requester
      requesterDraft = createDraftEvent({
        eventTitle: 'Requester Draft',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        createdByEmail: requesterUser.email,
      });

      // Create a draft with dates owned by admin
      adminDraft = createDraftEvent({
        eventTitle: 'Admin Draft',
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        createdByEmail: adminUser.email,
      });

      // Create a published event
      publishedEvent = createPublishedEvent({
        eventTitle: 'Published Event',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        createdByEmail: requesterUser.email,
      });

      await insertEvents(db, [requesterDraft, adminDraft, publishedEvent]);
    });

    test('DL-1: Creator sees their own draft on calendar', async () => {
      const res = await loadCalendarEvents(requesterToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      expect(eventTitles).toContain('Requester Draft');
      expect(eventTitles).toContain('Published Event');
    });

    test('DL-2: Admin does NOT see others\' drafts on calendar', async () => {
      const res = await loadCalendarEvents(adminToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      // Admin sees their own draft
      expect(eventTitles).toContain('Admin Draft');
      // Admin does NOT see requester's draft
      expect(eventTitles).not.toContain('Requester Draft');
      // But published events are visible
      expect(eventTitles).toContain('Published Event');
    });

    test('DL-3: Incomplete drafts (no dates) are excluded', async () => {
      // Create a draft without dates
      const incompleteDraft = createDraftEvent({
        eventTitle: 'Incomplete Draft',
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        createdByEmail: requesterUser.email,
        calendarData: {
          startDateTime: null,
          endDateTime: null,
          eventTitle: 'Incomplete Draft',
          locations: [],
        },
      });
      await insertEvents(db, [incompleteDraft]);

      const res = await loadCalendarEvents(requesterToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const eventTitles = events.map(e => e.eventTitle || e.calendarData?.eventTitle || e.subject);

      // Complete draft should be visible
      expect(eventTitles).toContain('Requester Draft');
      // Incomplete draft should NOT be visible
      expect(eventTitles).not.toContain('Incomplete Draft');
    });

    test('DL-4: Draft shows with correct status field in response', async () => {
      const res = await loadCalendarEvents(requesterToken);
      expect(res.status).toBe(200);

      const events = res.body.events;
      const draft = events.find(e => (e.eventTitle || e.calendarData?.eventTitle || e.subject) === 'Requester Draft');

      expect(draft).toBeDefined();
      expect(draft.status).toBe('draft');
    });
  });
});
