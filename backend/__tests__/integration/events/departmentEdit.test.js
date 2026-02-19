/**
 * Department Edit Tests (DE-1 to DE-8)
 *
 * Tests department-based editing: same-department colleagues can edit
 * pending/rejected events via PUT /api/room-reservations/:id/edit
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase, getTestCollections } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createSecurityUser,
  createMaintenanceUser,
  createApprover,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createRejectedEvent,
  createPublishedEvent,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Department Edit Tests (DE-1 to DE-8)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;

  // Security department users
  let securityUser1;
  let securityUser1Token;
  let securityUser2;
  let securityUser2Token;

  // Maintenance department user
  let maintenanceUser;
  let maintenanceUserToken;

  // No-department requester
  let noDeptRequester;
  let noDeptRequesterToken;

  // Approver
  let approverUser;
  let approverToken;

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
    await db.createCollection(COLLECTIONS.RESERVATION_TOKENS);
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
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    // Two security department users
    securityUser1 = createSecurityUser({
      email: 'security1@emanuelnyc.org',
      displayName: 'Security Staff 1',
    });
    securityUser2 = createSecurityUser({
      email: 'security2@emanuelnyc.org',
      displayName: 'Security Staff 2',
    });

    // Maintenance department user
    maintenanceUser = createMaintenanceUser();

    // Requester with no department
    noDeptRequester = createRequester({ department: null });

    // Approver
    approverUser = createApprover();

    await insertUsers(db, [securityUser1, securityUser2, maintenanceUser, noDeptRequester, approverUser]);

    securityUser1Token = await createMockToken(securityUser1);
    securityUser2Token = await createMockToken(securityUser2);
    maintenanceUserToken = await createMockToken(maintenanceUser);
    noDeptRequesterToken = await createMockToken(noDeptRequester);
    approverToken = await createMockToken(approverUser);
  });

  const editPayload = {
    eventTitle: 'Updated Event Title',
    eventDescription: 'Updated description',
    startDate: '2026-03-15',
    startTime: '10:00',
    endDate: '2026-03-15',
    endTime: '12:00',
    attendeeCount: 25,
    requestedRooms: [],
    specialRequirements: 'Updated requirements',
    categories: ['meeting'],
    services: {},
  };

  // ============================================
  // DE-1: Same-department user can edit a pending event
  // ============================================
  describe('DE-1: Same-department user can edit a pending event', () => {
    it('should return 200 when security user edits another security user\'s pending event', async () => {
      // Event created by securityUser1
      const pendingEvent = createPendingEvent({
        userId: securityUser1.userId,
        requesterEmail: securityUser1.email,
        requesterName: securityUser1.displayName,
        department: 'security',
      });
      await insertEvents(db, [pendingEvent]);

      // securityUser2 (same department) edits it
      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${securityUser2Token}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Reservation updated successfully');

      // Verify the update was persisted
      const updated = await findEvent(db, pendingEvent._id);
      expect(updated.calendarData.eventTitle).toBe('Updated Event Title');
    });
  });

  // ============================================
  // DE-2: Same-department user can edit and resubmit a rejected event
  // ============================================
  describe('DE-2: Same-department user can edit and resubmit a rejected event', () => {
    it('should return 200 and set status to pending', async () => {
      const rejectedEvent = createRejectedEvent({
        userId: securityUser1.userId,
        requesterEmail: securityUser1.email,
        requesterName: securityUser1.displayName,
        department: 'security',
      });
      await insertEvents(db, [rejectedEvent]);

      // securityUser2 edits and resubmits
      const res = await request(app)
        .put(`/api/room-reservations/${rejectedEvent._id}/edit`)
        .set('Authorization', `Bearer ${securityUser2Token}`)
        .send({ ...editPayload, _version: rejectedEvent._version });

      expect(res.status).toBe(200);

      // Rejected events edited via this endpoint get resubmitted (status → pending)
      const updated = await findEvent(db, rejectedEvent._id);
      expect(updated.status).toBe(STATUS.PENDING);
    });
  });

  // ============================================
  // DE-3: Different-department user gets 403
  // ============================================
  describe('DE-3: Different-department user gets 403', () => {
    it('should return 403 when maintenance user tries to edit security event', async () => {
      const pendingEvent = createPendingEvent({
        userId: securityUser1.userId,
        requesterEmail: securityUser1.email,
        requesterName: securityUser1.displayName,
        department: 'security',
      });
      await insertEvents(db, [pendingEvent]);

      // maintenanceUser (different department) tries to edit
      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${maintenanceUserToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('department');
    });
  });

  // ============================================
  // DE-4: User with no department gets 403 on someone else's event
  // ============================================
  describe('DE-4: User with no department gets 403 on someone else\'s event', () => {
    it('should return 403 when user without department tries to edit', async () => {
      const pendingEvent = createPendingEvent({
        userId: securityUser1.userId,
        requesterEmail: securityUser1.email,
        requesterName: securityUser1.displayName,
        department: 'security',
      });
      await insertEvents(db, [pendingEvent]);

      // noDeptRequester (no department) tries to edit
      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${noDeptRequesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // DE-5: Event with no requester department — only owner can edit
  // ============================================
  describe('DE-5: Event with no requester department — only owner can edit', () => {
    it('should return 403 when same-department user tries to edit event with no department', async () => {
      // Event with no department set
      const pendingEvent = createPendingEvent({
        userId: noDeptRequester.userId,
        requesterEmail: noDeptRequester.email,
        requesterName: noDeptRequester.displayName,
        department: '', // empty department
      });
      await insertEvents(db, [pendingEvent]);

      // securityUser1 tries to edit — event has no department, so no match
      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${securityUser1Token}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // DE-6: Department match is case-insensitive
  // ============================================
  describe('DE-6: Department match is case-insensitive', () => {
    it('should allow edit when departments differ only in case', async () => {
      // Event with uppercase department
      const pendingEvent = createPendingEvent({
        userId: securityUser1.userId,
        requesterEmail: securityUser1.email,
        requesterName: securityUser1.displayName,
        department: 'SECURITY', // uppercase
      });
      await insertEvents(db, [pendingEvent]);

      // securityUser2 has lowercase 'security' department
      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${securityUser2Token}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(200);
    });
  });

  // ============================================
  // DE-7: Owner can still edit (regression check)
  // ============================================
  describe('DE-7: Owner can still edit (regression check)', () => {
    it('should allow the original requester to edit their own pending event', async () => {
      const pendingEvent = createPendingEvent({
        userId: securityUser1.userId,
        requesterEmail: securityUser1.email,
        requesterName: securityUser1.displayName,
        department: 'security',
      });
      await insertEvents(db, [pendingEvent]);

      // securityUser1 (owner) edits their own event
      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${securityUser1Token}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Reservation updated successfully');
    });

    it('should allow owner to edit even when they have no department', async () => {
      const pendingEvent = createPendingEvent({
        userId: noDeptRequester.userId,
        requesterEmail: noDeptRequester.email,
        requesterName: noDeptRequester.displayName,
        department: '',
      });
      await insertEvents(db, [pendingEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${pendingEvent._id}/edit`)
        .set('Authorization', `Bearer ${noDeptRequesterToken}`)
        .send({ ...editPayload, _version: pendingEvent._version });

      expect(res.status).toBe(200);
    });
  });

  // ============================================
  // DE-8: Published event cannot be edited via this endpoint (regression)
  // ============================================
  describe('DE-8: Published event cannot be edited via owner endpoint', () => {
    it('should return 400 even for same-department colleague on published event', async () => {
      const publishedEvent = createPublishedEvent({
        userId: securityUser1.userId,
        requesterEmail: securityUser1.email,
        requesterName: securityUser1.displayName,
        department: 'security',
      });
      await insertEvents(db, [publishedEvent]);

      const res = await request(app)
        .put(`/api/room-reservations/${publishedEvent._id}/edit`)
        .set('Authorization', `Bearer ${securityUser2Token}`)
        .send({ ...editPayload, _version: publishedEvent._version });

      // Status guard should block before department check matters
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('pending or rejected');
    });
  });
});
