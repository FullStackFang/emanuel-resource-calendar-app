/**
 * Conflict Tier Tests (CT-1 to CT-7)
 *
 * Tests the tiered scheduling conflict system:
 * - Hard conflicts (published events) block actions
 * - Soft conflicts (pending edit proposals) warn but can be acknowledged
 * - Admin-only force override for hard conflicts
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Conflict Tier Tests (CT-1 to CT-7)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  const roomA = new ObjectId();
  const roomB = new ObjectId();

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('conflictTier'));

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

    adminUser = createAdmin();
    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, approverUser, requesterUser]);
    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);

    graphApiMock.resetMocks();
  });

  // CT-1: Published event conflict returns conflictTier: 'hard'
  describe('CT-1: Hard conflict response structure', () => {
    it('should return conflictTier hard with hardConflicts array for published event conflicts', async () => {
      const existingPublished = createPublishedEvent({
        eventTitle: 'Blocking Published Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'New Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });
      await insertEvents(db, [existingPublished, pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createCalendarEvent: false });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflictTier).toBe('hard');
      expect(res.body.hardConflicts).toHaveLength(1);
      expect(res.body.hardConflicts[0].eventTitle).toBe('Blocking Published Event');
      expect(res.body.conflicts).toHaveLength(1);
    });
  });

  // CT-2: Pending edit conflict returns conflictTier: 'soft'
  describe('CT-2: Soft conflict response structure', () => {
    it('should return conflictTier soft with softConflicts array for pending edit conflicts', async () => {
      // Published event with pending edit proposing move to Room B
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
          locationDisplayNames: 'Room B',
        },
      });

      // New event trying Room B at same time (conflicts with pending edit only)
      const newEvent = createPendingEvent({
        eventTitle: 'Soft Conflict Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomB],
      });

      await insertEvents(db, [editEvent, newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createCalendarEvent: false });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
      expect(res.body.conflictTier).toBe('soft');
      expect(res.body.softConflicts).toHaveLength(1);
      expect(res.body.softConflicts[0].isPendingEdit).toBe(true);
      expect(res.body.hardConflicts).toHaveLength(0);
    });
  });

  // CT-3: acknowledgeSoftConflicts bypasses soft-only 409
  describe('CT-3: Acknowledge soft conflicts bypasses 409', () => {
    it('should publish successfully when acknowledgeSoftConflicts is true and only soft conflicts exist', async () => {
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomA],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomB],
          locationDisplayNames: 'Room B',
        },
      });

      const newEvent = createPendingEvent({
        eventTitle: 'Acknowledged Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomB],
      });

      await insertEvents(db, [editEvent, newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createCalendarEvent: false, acknowledgeSoftConflicts: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
    });
  });

  // CT-4: acknowledgeSoftConflicts does NOT bypass hard conflicts
  describe('CT-4: Acknowledge soft conflicts does not bypass hard conflicts', () => {
    it('should still return 409 hard when published event conflicts exist even with acknowledgeSoftConflicts', async () => {
      const existingPublished = createPublishedEvent({
        eventTitle: 'Hard Blocking Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'Blocked Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });
      await insertEvents(db, [existingPublished, pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createCalendarEvent: false, acknowledgeSoftConflicts: true });

      expect(res.status).toBe(409);
      expect(res.body.conflictTier).toBe('hard');
      expect(res.body.hardConflicts).toHaveLength(1);
    });
  });

  // CT-5: forcePublishEdit rejected for approver (403)
  describe('CT-5: Approver cannot force-override publish-edit conflicts', () => {
    it('should return 403 when approver tries forcePublishEdit', async () => {
      // Create a published event with a pending edit that conflicts
      const blockingEvent = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });

      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T14:00:00'),
        endDateTime: new Date('2026-04-15T16:00:00'),
        proposedChanges: {
          locations: [roomA],
          startDateTime: '2026-04-15T10:00:00',
          endDateTime: '2026-04-15T12:00:00',
        },
      });

      await insertEvents(db, [blockingEvent, eventWithEdit]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EDIT(eventWithEdit._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          notes: 'Approved',
          _version: eventWithEdit._version,
          forcePublishEdit: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only admins');
    });
  });

  // CT-6: forcePublishEdit accepted for admin
  describe('CT-6: Admin can force-override publish-edit conflicts', () => {
    it('should succeed when admin uses forcePublishEdit', async () => {
      const blockingEvent = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });

      const eventWithEdit = createPublishedEventWithEditRequest({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T14:00:00'),
        endDateTime: new Date('2026-04-15T16:00:00'),
        proposedChanges: {
          locations: [roomA],
          startDateTime: '2026-04-15T10:00:00',
          endDateTime: '2026-04-15T12:00:00',
        },
      });

      await insertEvents(db, [blockingEvent, eventWithEdit]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EDIT(eventWithEdit._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Force approved',
          _version: eventWithEdit._version,
          forcePublishEdit: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // CT-7: Mixed hard+soft returns conflictTier: 'hard'
  describe('CT-7: Mixed hard and soft conflicts returns hard tier', () => {
    it('should return conflictTier hard when both published and pending edit conflicts exist', async () => {
      // A published event blocking Room A at 10:00-12:00
      const publishedBlocker = createPublishedEvent({
        eventTitle: 'Published Blocker',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });

      // Another event with pending edit proposing to also use Room A at 10:00-12:00
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomA],
          locationDisplayNames: 'Room A',
        },
      });

      // New event trying Room A at 10:00-12:00 (conflicts with both)
      const newEvent = createPendingEvent({
        eventTitle: 'Doubly Conflicting Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });

      await insertEvents(db, [publishedBlocker, editEvent, newEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(newEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createCalendarEvent: false });

      expect(res.status).toBe(409);
      expect(res.body.conflictTier).toBe('hard');
      expect(res.body.hardConflicts.length).toBeGreaterThanOrEqual(1);
      expect(res.body.softConflicts.length).toBeGreaterThanOrEqual(1);
      // allConflicts should include both
      expect(res.body.conflicts.length).toBe(
        res.body.hardConflicts.length + res.body.softConflicts.length
      );
    });
  });

  // CT-8: Owner edit soft conflict can be acknowledged
  describe('CT-8: Owner edit acknowledges soft conflicts', () => {
    it('should allow owner edit when soft conflicts are acknowledged', async () => {
      // Published event with pending edit proposing Room A at 10-12
      const editEvent = createPublishedEventWithEditRequest({
        locations: [roomB],
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        proposedChanges: {
          locations: [roomA],
          locationDisplayNames: 'Room A',
        },
      });

      // A pending event owned by requester in Room A
      const ownerEvent = createPendingEvent({
        eventTitle: 'Owner Event',
        startDateTime: new Date('2026-04-15T14:00:00'),
        endDateTime: new Date('2026-04-15T16:00:00'),
        locations: [roomA],
        requestedBy: {
          email: requesterUser.email,
          name: requesterUser.displayName,
          userId: requesterUser.odataId,
        },
      });

      await insertEvents(db, [editEvent, ownerEvent]);

      // First attempt without acknowledgement - should get soft conflict
      const res1 = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(ownerEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Owner Event',
          startDate: '2026-04-15',
          startTime: '10:00',
          endDate: '2026-04-15',
          endTime: '12:00',
          requestedRooms: [roomA],
          _version: ownerEvent._version,
          attendeeCount: 10,
        });

      expect(res1.status).toBe(409);
      expect(res1.body.conflictTier).toBe('soft');

      // Second attempt with acknowledgement - should succeed
      const res2 = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(ownerEvent._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Owner Event',
          startDate: '2026-04-15',
          startTime: '10:00',
          endDate: '2026-04-15',
          endTime: '12:00',
          requestedRooms: [roomA],
          _version: ownerEvent._version,
          acknowledgeSoftConflicts: true,
          attendeeCount: 10,
        });

      expect(res2.status).toBe(200);
    });
  });

  // CT-9: Admin save with canForce in hard conflict response
  describe('CT-9: Admin save hard conflict response includes canForce', () => {
    it('should include canForce: true and forceField in hard conflict response for admin save', async () => {
      const existingPublished = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'Event To Save',
        startDateTime: new Date('2026-04-15T14:00:00'),
        endDateTime: new Date('2026-04-15T16:00:00'),
        locations: [roomA],
      });
      await insertEvents(db, [existingPublished, pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Event To Save',
          startDateTime: '2026-04-15T10:00:00',
          endDateTime: '2026-04-15T12:00:00',
          locations: [roomA],
          _version: pendingEvent._version,
        });

      expect(res.status).toBe(409);
      expect(res.body.conflictTier).toBe('hard');
      expect(res.body.canForce).toBe(true);
      expect(res.body.forceField).toBe('forceUpdate');
    });
  });

  // CT-10: Publish hard conflict includes canForce and forceField
  describe('CT-10: Publish hard conflict response includes force info', () => {
    it('should include canForce and forceField in publish hard conflict response', async () => {
      const existingPublished = createPublishedEvent({
        eventTitle: 'Blocking Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });
      const pendingEvent = createPendingEvent({
        eventTitle: 'Blocked Event',
        startDateTime: new Date('2026-04-15T10:00:00'),
        endDateTime: new Date('2026-04-15T12:00:00'),
        locations: [roomA],
      });
      await insertEvents(db, [existingPublished, pendingEvent]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(pendingEvent._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ createCalendarEvent: false });

      expect(res.status).toBe(409);
      expect(res.body.canForce).toBe(true);
      expect(res.body.forceField).toBe('forcePublish');
    });
  });
});
