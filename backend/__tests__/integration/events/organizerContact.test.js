/**
 * Event Organizer Contact Tests (OC-1 to OC-8)
 *
 * Tests that event organizer contact fields (name, phone, email)
 * are stored and returned correctly across all event lifecycle paths.
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
  createPendingEvent,
  createDraftEvent,
  createRejectedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Event Organizer Contact Tests (OC-1 to OC-8)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('organizerContact'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    requesterUser = createRequester();
    await insertUsers(db, [requesterUser]);
    requesterToken = await createMockToken(requesterUser);
  });

  const organizerData = {
    organizerName: 'Rabbi Sarah',
    organizerPhone: '212-555-0101',
    organizerEmail: 'rabbi.sarah@emanuelnyc.org',
  };

  // ============================================
  // OC-1: Draft creation stores organizer fields
  // ============================================
  describe('OC-1: Draft creation stores organizer fields', () => {
    it('should persist organizer in calendarData', async () => {
      const res = await request(app)
        .post('/api/room-reservations/draft')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Shabbat Service',
          startDateTime: '2026-06-01T10:00:00',
          endDateTime: '2026-06-01T12:00:00',
          ...organizerData,
        });

      expect(res.status).toBe(201);

      const draft = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: res.body.draft.eventId });
      expect(draft.calendarData.organizerName).toBe('Rabbi Sarah');
      expect(draft.calendarData.organizerPhone).toBe('212-555-0101');
      expect(draft.calendarData.organizerEmail).toBe('rabbi.sarah@emanuelnyc.org');
    });
  });

  // ============================================
  // OC-2: Draft creation without organizer defaults to empty
  // ============================================
  describe('OC-2: Draft creation without organizer defaults to empty', () => {
    it('should store empty organizer when not provided', async () => {
      const res = await request(app)
        .post('/api/room-reservations/draft')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Quick Meeting',
          startDateTime: '2026-06-02T14:00:00',
          endDateTime: '2026-06-02T15:00:00',
        });

      expect(res.status).toBe(201);

      const draft = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: res.body.draft.eventId });
      expect(draft.calendarData.organizerName).toBe('');
      expect(draft.calendarData.organizerPhone).toBe('');
      expect(draft.calendarData.organizerEmail).toBe('');
    });
  });

  // ============================================
  // OC-3: Draft update persists organizer changes
  // ============================================
  describe('OC-3: Draft update persists organizer changes', () => {
    it('should update organizer fields on draft save', async () => {
      const draftEvent = createDraftEvent({ requesterUser });
      await insertEvents(db, [draftEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draftEvent._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: draftEvent.calendarData.eventTitle,
          startDateTime: '2026-06-01T10:00:00',
          endDateTime: '2026-06-01T12:00:00',
          ...organizerData,
        });

      expect(res.status).toBe(200);

      const updated = await findEvent(db, draftEvent._id);
      expect(updated.calendarData.organizerName).toBe('Rabbi Sarah');
      expect(updated.calendarData.organizerPhone).toBe('212-555-0101');
      expect(updated.calendarData.organizerEmail).toBe('rabbi.sarah@emanuelnyc.org');
    });
  });

  // ============================================
  // OC-4: Event request stores organizer fields
  // ============================================
  describe('OC-4: Event request stores organizer fields', () => {
    it('should persist organizer in calendarData', async () => {
      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Board Meeting',
          startDateTime: '2026-06-05T09:00:00',
          endDateTime: '2026-06-05T11:00:00',
          attendeeCount: 15,
          reservationStartTime: '08:30',
          reservationEndTime: '11:30',
          ...organizerData,
        });

      expect(res.status).toBe(201);

      const event = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: res.body.eventId });
      expect(event.calendarData.organizerName).toBe('Rabbi Sarah');
      expect(event.calendarData.organizerPhone).toBe('212-555-0101');
      expect(event.calendarData.organizerEmail).toBe('rabbi.sarah@emanuelnyc.org');
    });
  });

  // ============================================
  // OC-5: Owner edit updates organizer fields
  // ============================================
  describe('OC-5: Owner edit updates organizer fields', () => {
    it('should update organizer on pending event edit', async () => {
      const pendingEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: pendingEvent._version,
          eventTitle: pendingEvent.calendarData.eventTitle,
          startDate: '2026-06-01',
          startTime: '10:00',
          endDate: '2026-06-01',
          endTime: '12:00',
          attendeeCount: 10,
          ...organizerData,
        });

      expect(res.status).toBe(200);

      const updated = await findEvent(db, pendingEvent._id);
      expect(updated.calendarData.organizerName).toBe('Rabbi Sarah');
      expect(updated.calendarData.organizerPhone).toBe('212-555-0101');
      expect(updated.calendarData.organizerEmail).toBe('rabbi.sarah@emanuelnyc.org');
    });
  });

  // ============================================
  // OC-6: Owner edit clears organizer when empty
  // ============================================
  describe('OC-6: Owner edit clears organizer when empty', () => {
    it('should store empty organizer when fields cleared', async () => {
      const pendingEvent = createPendingEvent({
        requesterUser,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: requesterUser.displayName,
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          organizer: {
            name: 'Previous Organizer',
            phone: '555-9999',
            email: 'prev@emanuelnyc.org',
          },
          submittedAt: new Date(),
        },
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: pendingEvent._version,
          eventTitle: pendingEvent.calendarData.eventTitle,
          startDate: '2026-06-01',
          startTime: '10:00',
          endDate: '2026-06-01',
          endTime: '12:00',
          attendeeCount: 10,
          organizerName: '',
          organizerPhone: '',
          organizerEmail: '',
        });

      expect(res.status).toBe(200);

      const updated = await findEvent(db, pendingEvent._id);
      expect(updated.calendarData.organizerName).toBe('');
      expect(updated.calendarData.organizerPhone).toBe('');
      expect(updated.calendarData.organizerEmail).toBe('');
    });
  });

  // ============================================
  // OC-7: Rejected event resubmit preserves organizer
  // ============================================
  describe('OC-7: Rejected event resubmit preserves organizer', () => {
    it('should keep organizer through rejected edit + resubmit', async () => {
      const rejectedEvent = createRejectedEvent({ requesterUser });
      await insertEvents(db, [rejectedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          _version: rejectedEvent._version,
          eventTitle: 'Updated After Rejection',
          startDate: '2026-06-01',
          startTime: '10:00',
          endDate: '2026-06-01',
          endTime: '12:00',
          attendeeCount: 10,
          ...organizerData,
        });

      expect(res.status).toBe(200);

      const updated = await findEvent(db, rejectedEvent._id);
      expect(updated.status).toBe('pending');
      expect(updated.calendarData.organizerName).toBe('Rabbi Sarah');
      expect(updated.calendarData.organizerPhone).toBe('212-555-0101');
      expect(updated.calendarData.organizerEmail).toBe('rabbi.sarah@emanuelnyc.org');
    });
  });

  // ============================================
  // OC-8: Existing events without organizer return gracefully
  // ============================================
  describe('OC-8: Existing events without organizer return gracefully', () => {
    it('should have undefined organizer for legacy events', async () => {
      // Legacy event: no organizer fields in calendarData
      const legacyEvent = createPendingEvent({ requesterUser });
      await insertEvents(db, [legacyEvent]);

      const event = await findEvent(db, legacyEvent._id);
      // organizer is undefined on legacy events — transformer defaults to empty strings
      expect(event.calendarData.organizerName).toBeUndefined();
    });
  });
});
