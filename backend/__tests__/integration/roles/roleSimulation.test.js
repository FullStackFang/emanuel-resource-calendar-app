/**
 * Role Simulation Tests (RS-1 to RS-12)
 *
 * Tests that the X-Simulated-Role header correctly restricts admin users
 * to the simulated role's permissions. The emulator must produce identical
 * behavior to real role-based access.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, createRequester, createViewer, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createDraftEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Role Simulation Tests (RS-1 to RS-12)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('roleSimulation'));
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
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // ── events/list role gates ──

  describe('RS-1 to RS-4: Admin simulating lower roles gets 403 from restricted views', () => {
    it('RS-1: admin simulating viewer gets 403 from approval-queue', async () => {
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'viewer')
        .expect(403);
    });

    it('RS-2: admin simulating viewer gets 403 from admin-browse', async () => {
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'viewer')
        .expect(403);
    });

    it('RS-3: admin simulating requester gets 403 from approval-queue', async () => {
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'requester')
        .expect(403);
    });

    it('RS-4: admin simulating requester gets 403 from admin-browse', async () => {
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'requester')
        .expect(403);
    });
  });

  describe('RS-5 to RS-6: Admin simulating approver gets scoped access', () => {
    it('RS-5: admin simulating approver gets 200 from approval-queue', async () => {
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'approver')
        .expect(200);
    });

    it('RS-6: admin simulating approver gets 403 from admin-browse', async () => {
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'approver')
        .expect(403);
    });
  });

  // ── events/list/counts ──

  describe('RS-7: Counts endpoint respects simulation', () => {
    it('RS-7: admin simulating requester gets 403 from approval-queue counts', async () => {
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'requester')
        .expect(403);
    });
  });

  // ── my-events scoping ──

  describe('RS-8: my-events scopes by email during simulation', () => {
    it('RS-8: admin simulating viewer can access my-events (scoped by email)', async () => {
      // Create an event owned by the admin
      const adminEvent = createPendingEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Admin Own Event',
      });
      // Create an event owned by someone else
      const otherEvent = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Other User Event',
      });
      await insertEvents(db, [adminEvent, otherEvent]);

      const res = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'viewer')
        .expect(200);

      // Should only see admin's own events (scoped by email, not role)
      const titles = res.body.events.map(e => e.eventTitle || e.calendarData?.eventTitle);
      expect(titles).toContain('Admin Own Event');
      expect(titles).not.toContain('Other User Event');
    });
  });

  // ── Draft auto-publish ──

  describe('RS-9 to RS-10: Draft submit respects simulated role for auto-publish', () => {
    it('RS-9: admin simulating requester — draft submit goes to pending (no auto-publish)', async () => {
      const draft = createDraftEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Requester Draft Test',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${saved._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'requester')
        .expect(200);

      expect(res.body.event.status).toBe(STATUS.PENDING);
      expect(res.body.autoPublished).toBeFalsy();
    });

    it('RS-10: admin simulating approver — draft submit auto-publishes', async () => {
      const draft = createDraftEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Approver Draft Test',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${saved._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'approver')
        .expect(200);

      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
      expect(res.body.autoPublished).toBe(true);
    });
  });

  // ── Security validation ──

  describe('RS-11 to RS-12: Security — simulation header validation', () => {
    it('RS-11: non-admin user sending X-Simulated-Role header is ignored', async () => {
      // Requester tries to simulate admin — should be ignored
      // Approval-queue requires approver+ so requester should get 403
      await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .set('X-Simulated-Role', 'admin')
        .expect(403);
    });

    it('RS-12: invalid X-Simulated-Role value is ignored', async () => {
      // Admin sends invalid role — should fall back to actual admin role
      const res = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=admin-browse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Simulated-Role', 'superadmin')
        .expect(200);

      // Admin-browse should work since the invalid role falls back to actual admin
      expect(res.body.events).toBeDefined();
    });
  });
});
