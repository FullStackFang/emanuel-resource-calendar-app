/**
 * Viewer Role Access Tests (V-1 to V-11)
 *
 * Tests that viewers have minimal permissions and cannot perform
 * privileged actions like creating drafts, approving events, etc.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase, getTestCollections } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createViewer, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createPendingEvent,
  createApprovedEvent,
  createDeletedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Viewer Role Access Tests (V-1 to V-11)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let viewerUser;
  let viewerToken;
  let requesterUser;
  let testEvents;

  beforeAll(async () => {
    // Initialize test keys for JWT signing
    await initTestKeys();

    // Start in-memory MongoDB (with platform-specific options for Windows ARM64)
    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    // Create collections
    await db.createCollection(COLLECTIONS.USERS);
    await db.createCollection(COLLECTIONS.EVENTS);
    await db.createCollection(COLLECTIONS.LOCATIONS);
    await db.createCollection(COLLECTIONS.RESERVATION_TOKENS);
    await db.createCollection(COLLECTIONS.AUDIT_HISTORY);

    // Set test database for the app
    setTestDatabase(db);

    // Create test app
    app = createTestApp();
  });

  afterAll(async () => {
    if (mongoClient) await mongoClient.close();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear collections
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.RESERVATION_TOKENS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    // Create test users
    viewerUser = createViewer();
    requesterUser = createRequester();
    await insertUsers(db, [viewerUser, requesterUser]);

    // Create test token for viewer
    viewerToken = await createMockToken(viewerUser);

    // Create sample events for testing
    const draft = createDraftEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Test Draft Event',
    });
    const pending = createPendingEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Test Pending Event',
    });
    const approved = createApprovedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Test Approved Event',
    });
    const deleted = createDeletedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Test Deleted Event',
    });

    testEvents = await insertEvents(db, [draft, pending, approved, deleted]);
  });

  describe('V-1: Viewer CAN view calendar', () => {
    it('should allow viewer to get their own reservations', async () => {
      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('reservations');
      expect(Array.isArray(res.body.reservations)).toBe(true);
    });

    it('should allow viewer to get their permissions', async () => {
      const res = await request(app)
        .get('/api/users/me/permissions')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('role', 'viewer');
      expect(res.body).toHaveProperty('canViewCalendar', true);
    });
  });

  describe('V-2: Viewer CANNOT create draft', () => {
    it('should return 403 when viewer tries to create a draft', async () => {
      const res = await request(app)
        .post('/api/room-reservations/draft')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          eventTitle: 'Viewer Draft',
          startDateTime: new Date(Date.now() + 86400000).toISOString(),
          endDateTime: new Date(Date.now() + 90000000).toISOString(),
        })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-3: Viewer CANNOT submit reservation', () => {
    it('should return 403 when viewer tries to submit a draft', async () => {
      const draft = testEvents[0]; // Draft event

      const res = await request(app)
        .post(`/api/room-reservations/draft/${draft._id}/submit`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-4: Viewer CANNOT edit any event', () => {
    it('should return 403 when viewer tries to edit a draft', async () => {
      const draft = testEvents[0];

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ eventTitle: 'Updated Title' })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-5: Viewer CANNOT delete any event', () => {
    it('should return 403 when viewer tries to delete a draft', async () => {
      const draft = testEvents[0];

      const res = await request(app)
        .delete(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });

    it('should return 403 when viewer tries to delete an approved event', async () => {
      const approved = testEvents[2];

      const res = await request(app)
        .delete(`/api/admin/events/${approved._id}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-6: Viewer CANNOT approve requests', () => {
    it('should return 403 when viewer tries to approve a pending event', async () => {
      const pending = testEvents[1];

      const res = await request(app)
        .put(`/api/admin/events/${pending._id}/approve`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-7: Viewer CANNOT reject requests', () => {
    it('should return 403 when viewer tries to reject a pending event', async () => {
      const pending = testEvents[1];

      const res = await request(app)
        .put(`/api/admin/events/${pending._id}/reject`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reason: 'Test rejection' })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-8: Viewer CANNOT view pending queue (admin events)', () => {
    it('should return 403 when viewer tries to access admin events endpoint', async () => {
      const res = await request(app)
        .get('/api/admin/events')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });

    it('should return 403 when viewer tries to access specific admin event', async () => {
      const pending = testEvents[1];

      const res = await request(app)
        .get(`/api/admin/events/${pending._id}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-9: Viewer CANNOT restore deleted events', () => {
    it('should return 403 when viewer tries to restore a deleted event', async () => {
      const deleted = testEvents[3];

      const res = await request(app)
        .put(`/api/admin/events/${deleted._id}/restore`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-10: Viewer CANNOT access admin panel', () => {
    it('should return 403 when viewer queries with admin status filters', async () => {
      const res = await request(app)
        .get('/api/admin/events?status=pending')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('V-11: Viewer CANNOT generate reservation tokens', () => {
    it('should return 403 when viewer tries to generate a token', async () => {
      const res = await request(app)
        .post('/api/room-reservations/generate-token')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/permission denied/i);
    });
  });

  describe('Authentication Edge Cases', () => {
    it('should return 401 when no token is provided', async () => {
      const res = await request(app)
        .get('/api/reservations/my')
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/authentication required/i);
    });

    it('should return 401 for malformed token', async () => {
      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 401 for missing Bearer prefix', async () => {
      const res = await request(app)
        .get('/api/reservations/my')
        .set('Authorization', viewerToken)
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });
});
