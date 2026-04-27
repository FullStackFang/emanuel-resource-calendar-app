/**
 * Edit Request Approval Queue Visibility Tests (ERAQ-1 to ERAQ-4)
 *
 * Verifies that events with pendingEditRequest.status === 'pending'
 * appear in the approval queue even when they lack roomReservationData
 * (e.g. rsSched-imported or Graph-synced events).
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEventWithEditRequest,
  createOwnerlessPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const {
  seedPendingEditRequestForEvent,
  createApprovedEditRequest,
  insertEditRequest,
} = require('../../__helpers__/editRequestFactory');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Edit Request Approval Queue Visibility (ERAQ-1 to ERAQ-4)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestApprovalQueue'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.EDIT_REQUESTS).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
  });

  // ============================================
  // ERAQ-1: Ownerless event with pending edit request appears in approval queue
  // ============================================
  describe('ERAQ-1: Ownerless event with pending edit shows in approval queue', () => {
    it('should return an event without roomReservationData that has a pending edit request', async () => {
      // Create a published event WITHOUT roomReservationData but WITH pending edit
      const ownerlessEvent = createOwnerlessPublishedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'rsSched Imported Event',
      });
      const [insertedEvent] = await insertEvents(db, [ownerlessEvent]);
      // Edit request lives in templeEvents__EditRequests now.
      await seedPendingEditRequestForEvent(db, insertedEvent, {
        userId: requesterUser.odataId,
        requestedBy: { email: requesterUser.email, name: requesterUser.email },
        proposedChanges: { attendeeCount: 10 },
      });

      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({ view: 'approval-queue' })
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const events = res.body.events || [];
      expect(events.length).toBe(1);
      expect(events[0].eventId).toBe(ownerlessEvent.eventId);
    });
  });

  // ============================================
  // ERAQ-2: Counts endpoint includes ownerless event in published_edit
  // ============================================
  describe('ERAQ-2: Counts endpoint counts ownerless edit requests', () => {
    it('should count ownerless events with pending edits in published_edit', async () => {
      const ownerlessEvent = createOwnerlessPublishedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'Counts Test Event',
      });
      const [insertedEvent] = await insertEvents(db, [ownerlessEvent]);
      await seedPendingEditRequestForEvent(db, insertedEvent, {
        userId: requesterUser.odataId,
        requestedBy: { email: requesterUser.email, name: requesterUser.email },
        proposedChanges: { eventDescription: 'Updated' },
      });

      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS_COUNTS)
        .query({ view: 'approval-queue' })
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.published_edit).toBe(1);
      expect(res.body.all).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================
  // ERAQ-3: Approved edit request on ownerless event no longer appears
  // ============================================
  describe('ERAQ-3: Approved edit request on ownerless event disappears from queue', () => {
    it('should not return ownerless event once edit request is approved', async () => {
      const ownerlessEvent = createOwnerlessPublishedEvent({
        userId: requesterUser.odataId,
        eventTitle: 'Approved Edit Event',
      });
      const [insertedEvent] = await insertEvents(db, [ownerlessEvent]);
      // Seed an APPROVED (not pending) request — this is the negative case.
      // Approved requests must not surface the event in the approval queue.
      await insertEditRequest(db, createApprovedEditRequest({
        eventId: insertedEvent.eventId,
        eventObjectId: insertedEvent._id,
        userId: requesterUser.odataId,
        requestedBy: { email: requesterUser.email, name: requesterUser.email },
        proposedChanges: { attendeeCount: 5 },
        reviewedBy: { userId: approverUser.odataId, email: approverUser.email, name: approverUser.email },
        reviewNotes: 'Approved',
      }));

      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({ view: 'approval-queue' })
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const events = res.body.events || [];
      // Event has no roomReservationData AND edit is not pending — should not appear
      expect(events.length).toBe(0);
    });
  });

  // ============================================
  // ERAQ-4: Event with roomReservationData AND pending edit still appears (no regression)
  // ============================================
  describe('ERAQ-4: Event with roomReservationData and pending edit still appears', () => {
    it('should return events with roomReservationData regardless of edit request', async () => {
      // Standard reservation event with pending edit — should always appear
      const reservationEvent = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Reservation With Edit',
        requestedChanges: { eventTitle: 'Updated Title' },
      });

      await insertEvents(db, [reservationEvent]);

      const res = await request(app)
        .get(ENDPOINTS.LIST_EVENTS)
        .query({ view: 'approval-queue' })
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const events = res.body.events || [];
      expect(events.length).toBe(1);
      expect(events[0].eventId).toBe(reservationEvent.eventId);
    });
  });
});
