/**
 * Owner Occurrence Edit Tests (OOE-1 to OOE-6)
 *
 * Tests per-occurrence editing via PUT /api/room-reservations/:id/edit
 * with editScope='thisEvent'. This verifies that requesters editing a single
 * occurrence create an exception document instead of modifying the series master.
 *
 * Bug context: The requester edit endpoint lacked exception-as-document support,
 * so editing a single occurrence would overwrite the entire series master.
 * The admin endpoint (PUT /api/admin/events/:id) already handled this correctly.
 *
 * OOE-1: thisEvent save creates exception doc, does not modify series master
 * OOE-2: thisEvent with location change stores in exception doc only
 * OOE-3: thisEvent updates existing exception doc on re-edit
 * OOE-4: allEvents scope updates series master (existing behavior)
 * OOE-5: thisEvent on exception doc resolves master and updates exception
 * OOE-6: occurrenceDate outside series range returns 400
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createExceptionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Owner Occurrence Edit Tests (OOE-1 to OOE-6)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let locationA, locationB;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('ownerOccurrenceEdit'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});

    requesterUser = createRequester();
    await insertUsers(db, [requesterUser]);
    requesterToken = await createMockToken(requesterUser);

    locationA = { _id: new ObjectId(), name: 'Room A', displayName: 'Room A', isReservable: true };
    locationB = { _id: new ObjectId(), name: 'Room B', displayName: 'Room B', isReservable: true };
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([locationA, locationB]);
  });

  /**
   * Helper: create a pending recurring series master owned by the requester.
   * Daily pattern 3/11-3/13, 14:00-15:00, in Room A.
   */
  function createTestSeriesMaster(overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-13' },
      additions: [],
      exclusions: [],
    };
    return createRecurringSeriesMaster({
      status: STATUS.PENDING,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      recurrence,
      startDateTime: new Date('2026-03-11T14:00:00'),
      endDateTime: new Date('2026-03-11T15:00:00'),
      locations: [locationA._id],
      locationDisplayNames: ['Room A'],
      calendarData: {
        eventTitle: 'Daily Standup',
        eventDescription: 'Test recurring event',
        startDateTime: '2026-03-11T14:00:00',
        endDateTime: '2026-03-11T15:00:00',
        startDate: '2026-03-11',
        startTime: '14:00',
        endDate: '2026-03-11',
        endTime: '15:00',
        reservationStartTime: '14:00',
        reservationEndTime: '15:00',
        attendeeCount: 5,
        locations: [locationA._id],
        locationDisplayNames: 'Room A',
        categories: ['Meeting'],
        recurrence,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      roomReservationData: {
        requestedBy: {
          name: 'Test Requester',
          email: requesterUser.email,
          userId: requesterUser.odataId,
          department: 'Engineering',
        },
      },
      ...overrides,
    });
  }

  /**
   * Helper: build the standard owner edit payload with required fields.
   * Callers can spread additional fields on top.
   */
  function buildBasePayload(master, extra = {}) {
    return {
      _version: master._version || 1,
      eventTitle: master.calendarData?.eventTitle || 'Daily Standup',
      startDate: '2026-03-11',
      endDate: '2026-03-11',
      startTime: '14:00',
      endTime: '15:00',
      reservationStartTime: '14:00',
      reservationEndTime: '15:00',
      attendeeCount: 5,
      requestedRooms: [locationA._id.toString()],
      ...extra,
    };
  }

  describe('OOE-1: thisEvent save creates exception doc, master unchanged', () => {
    it('should create exception document and not modify series master calendarData', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send(buildBasePayload(master, {
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Modified Standup',
          startTime: '16:00',
          endTime: '17:00',
          reservationStartTime: '16:00',
          reservationEndTime: '17:00',
        }));

      expect(res.status).toBe(200);

      // Exception document should exist
      const exceptionDoc = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: master.eventId,
        eventType: 'exception',
        occurrenceDate: '2026-03-12',
      });
      expect(exceptionDoc).not.toBeNull();
      expect(exceptionDoc.calendarData.eventTitle).toBe('Modified Standup');
      expect(exceptionDoc.calendarData.startTime).toBe('16:00');
      expect(exceptionDoc.calendarData.endTime).toBe('17:00');

      // Series master calendarData should NOT have changed
      const updatedMaster = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updatedMaster.calendarData.eventTitle).toBe('Daily Standup');
      expect(updatedMaster.calendarData.startTime).toBe('14:00');
      expect(updatedMaster.calendarData.endTime).toBe('15:00');
    });
  });

  describe('OOE-2: thisEvent with location change stores in exception doc only', () => {
    it('should store location on exception doc without changing master locations', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send(buildBasePayload(master, {
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          requestedRooms: [locationB._id.toString()],
        }));

      expect(res.status).toBe(200);

      // Exception doc should have locationB
      const exceptionDoc = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: master.eventId,
        eventType: 'exception',
        occurrenceDate: '2026-03-12',
      });
      expect(exceptionDoc).not.toBeNull();
      expect(exceptionDoc.calendarData.locations).toHaveLength(1);
      expect(String(exceptionDoc.calendarData.locations[0])).toBe(String(locationB._id));

      // Master should still have locationA
      const updatedMaster = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updatedMaster.calendarData.locations).toHaveLength(1);
      expect(String(updatedMaster.calendarData.locations[0])).toBe(String(locationA._id));
    });
  });

  describe('OOE-3: thisEvent updates existing exception doc on re-edit', () => {
    it('should update existing exception document instead of creating a second one', async () => {
      const master = createTestSeriesMaster();
      const existingException = createExceptionDocument(master, '2026-03-12', {
        eventTitle: 'First Edit',
        startTime: '15:00',
        endTime: '16:00',
      });
      await insertEvents(db, [master, existingException]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send(buildBasePayload(master, {
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Second Edit',
          startTime: '17:00',
          endTime: '18:00',
          reservationStartTime: '17:00',
          reservationEndTime: '18:00',
        }));

      expect(res.status).toBe(200);

      // Should only be one exception doc for this date
      const exceptions = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: master.eventId,
        eventType: 'exception',
        occurrenceDate: '2026-03-12',
      }).toArray();
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].calendarData.eventTitle).toBe('Second Edit');
      expect(exceptions[0].calendarData.startTime).toBe('17:00');
    });
  });

  describe('OOE-4: allEvents / no scope updates series master directly', () => {
    it('should update series master when editScope is not thisEvent', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send(buildBasePayload(master, {
          eventTitle: 'Renamed Series',
        }));

      expect(res.status).toBe(200);

      // Master should be updated
      const updatedMaster = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: master._id });
      expect(updatedMaster.calendarData.eventTitle).toBe('Renamed Series');

      // No exception documents should exist
      const exceptions = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: master.eventId,
        eventType: 'exception',
      }).toArray();
      expect(exceptions).toHaveLength(0);
    });
  });

  describe('OOE-5: thisEvent on exception doc resolves master correctly', () => {
    it('should resolve to master when editing an existing exception document by its _id', async () => {
      const master = createTestSeriesMaster();
      const existingException = createExceptionDocument(master, '2026-03-12', {
        eventTitle: 'First Edit',
        startTime: '15:00',
        endTime: '16:00',
      });
      await insertEvents(db, [master, existingException]);

      // Edit the exception doc directly by its _id (simulates clicking on materialized occurrence)
      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(existingException._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send(buildBasePayload(master, {
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Updated Via Exception',
          startTime: '18:00',
          endTime: '19:00',
          reservationStartTime: '18:00',
          reservationEndTime: '19:00',
        }));

      expect(res.status).toBe(200);

      // Exception doc should be updated (not a new one created)
      const exceptions = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: master.eventId,
        eventType: 'exception',
        occurrenceDate: '2026-03-12',
      }).toArray();
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].calendarData.eventTitle).toBe('Updated Via Exception');
      expect(exceptions[0].calendarData.startTime).toBe('18:00');
    });
  });

  describe('OOE-6: occurrenceDate outside series range returns 400', () => {
    it('should reject edits for dates outside the recurrence range', async () => {
      const master = createTestSeriesMaster();
      await insertEvents(db, [master]);

      const res = await request(app)
        .put(ENDPOINTS.EDIT_RESERVATION(master._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send(buildBasePayload(master, {
          editScope: 'thisEvent',
          occurrenceDate: '2026-06-01', // Way outside 3/11-3/13 range
          eventTitle: 'Out of Range',
        }));

      expect(res.status).toBe(400);
    });
  });
});
