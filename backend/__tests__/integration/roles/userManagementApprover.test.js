/**
 * Approver User-Management Tests (UMA-1 to UMA-15)
 *
 * Verifies that approvers can manage users but only within the viewer/requester
 * cap, that the write-field allowlist blocks privilege-escalation smuggling,
 * that self-protection holds, that admins remain unrestricted, and that every
 * mutation writes a user-management audit entry.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createApprover,
  createRequester,
  createViewer,
  insertUsers,
} = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

const USER_AUDIT_COLLECTION = 'templeEvents__UserAuditHistory';

// Poll an async assertion until it passes or times out — used for the
// fire-and-forget audit writes that are not awaited by the endpoints.
async function eventually(fn, { tries = 20, delayMs = 25 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

describe('Approver User-Management Tests (UMA-1 to UMA-15)', () => {
  let mongoClient;
  let db;
  let app;

  let approverUser, approverToken;
  let adminUser, adminToken;
  let viewerUser, viewerToken;
  let requesterUser, requesterToken;

  // Targets to act upon
  let viewerTarget, requesterTarget, approverTarget, adminTarget, legacyAdminTarget;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('userManagementApprover'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(USER_AUDIT_COLLECTION).deleteMany({});

    approverUser = createApprover();
    adminUser = createAdmin();
    viewerUser = createViewer();
    requesterUser = createRequester();

    viewerTarget = createViewer({ email: 'viewer.target@test.com', userId: 'viewer-target', displayName: 'Viewer Target' });
    requesterTarget = createRequester({ email: 'requester.target@test.com', userId: 'requester-target', displayName: 'Requester Target' });
    approverTarget = createApprover({ email: 'approver.target@test.com', userId: 'approver-target', displayName: 'Approver Target' });
    adminTarget = createAdmin({ email: 'admin.target@test.com', userId: 'admin-target', displayName: 'Admin Target' });
    // Legacy admin: no role field, escalates via isAdmin flag only
    legacyAdminTarget = createViewer({ email: 'legacy.admin@test.com', userId: 'legacy-admin', displayName: 'Legacy Admin', role: undefined, isAdmin: true });

    [approverUser, adminUser, viewerUser, requesterUser,
      viewerTarget, requesterTarget, approverTarget, adminTarget, legacyAdminTarget] =
      await insertUsers(db, [
        approverUser, adminUser, viewerUser, requesterUser,
        viewerTarget, requesterTarget, approverTarget, adminTarget, legacyAdminTarget,
      ]);

    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
    viewerToken = await createMockToken(viewerUser);
    requesterToken = await createMockToken(requesterUser);
  });

  const storedUser = (email) => db.collection(COLLECTIONS.USERS).findOne({ email });

  // ---- Create ----

  test('UMA-1: approver creates viewer and requester users', async () => {
    const v = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ email: 'new.viewer@test.com', displayName: 'New Viewer', role: 'viewer' })
      .expect(201);
    expect(v.body.effectiveRole).toBe('viewer');

    const r = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ email: 'new.requester@test.com', displayName: 'New Requester', role: 'requester' })
      .expect(201);
    expect(r.body.effectiveRole).toBe('requester');
  });

  test('UMA-2: approver cannot create approver or admin users', async () => {
    const a = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ email: 'new.approver@test.com', displayName: 'X', role: 'approver' })
      .expect(403);
    expect(a.body.code).toBe('USER_MANAGEMENT_FORBIDDEN');
    expect(await storedUser('new.approver@test.com')).toBeNull();

    const ad = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ email: 'new.admin@test.com', displayName: 'X', role: 'admin' })
      .expect(403);
    expect(ad.body.code).toBe('USER_MANAGEMENT_FORBIDDEN');
  });

  // ---- Re-assign role ----

  test('UMA-3: approver re-assigns within the cap (viewer <-> requester)', async () => {
    const up = await request(app)
      .put(`/api/users/${viewerTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ role: 'requester' })
      .expect(200);
    expect(up.body.effectiveRole).toBe('requester');

    const down = await request(app)
      .put(`/api/users/${requesterTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ role: 'viewer' })
      .expect(200);
    expect(down.body.effectiveRole).toBe('viewer');
  });

  test('UMA-4: approver cannot promote a requester above the cap', async () => {
    const res = await request(app)
      .put(`/api/users/${requesterTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ role: 'approver' })
      .expect(403);
    expect(res.body.code).toBe('USER_MANAGEMENT_FORBIDDEN');
    expect((await storedUser('requester.target@test.com')).role).toBe('requester');
  });

  // ---- Privileged targets ----

  test('UMA-5: approver cannot edit or delete approver/admin targets', async () => {
    await request(app)
      .put(`/api/users/${approverTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ title: 'hacked' })
      .expect(403);

    await request(app)
      .delete(`/api/users/${adminTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);

    expect(await storedUser('admin.target@test.com')).not.toBeNull();
  });

  test('UMA-6: approver cannot act on a legacy isAdmin target (classified by effective role)', async () => {
    const res = await request(app)
      .delete(`/api/users/${legacyAdminTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);
    expect(res.body.code).toBe('USER_MANAGEMENT_FORBIDDEN');
    expect(await storedUser('legacy.admin@test.com')).not.toBeNull();
  });

  // ---- Delete within cap ----

  test('UMA-7: approver can delete viewer and requester targets', async () => {
    await request(app)
      .delete(`/api/users/${viewerTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
    expect(await storedUser('viewer.target@test.com')).toBeNull();

    await request(app)
      .delete(`/api/users/${requesterTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
    expect(await storedUser('requester.target@test.com')).toBeNull();
  });

  // ---- Field-allowlist smuggle ----

  test('UMA-8: smuggled escalation fields are stripped on create', async () => {
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        email: 'smuggle.create@test.com',
        displayName: 'Smuggler',
        role: 'viewer',
        isAdmin: true,
        permissions: { canViewAllReservations: true },
        preferences: { isAdmin: true, defaultView: 'week' },
        userId: 'spoofed-oid',
      })
      .expect(201);

    const stored = await storedUser('smuggle.create@test.com');
    expect(stored.isAdmin).toBeUndefined();
    expect(stored.permissions).toBeUndefined();
    expect(stored.preferences?.isAdmin).toBeUndefined();
    expect(stored.preferences?.defaultView).toBe('week');
    expect(stored.userId).not.toBe('spoofed-oid');
    expect(stored.role).toBe('viewer');
  });

  test('UMA-9: smuggled escalation fields are stripped on update; effective role unchanged', async () => {
    await request(app)
      .put(`/api/users/${viewerTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ isAdmin: true, permissions: { canViewAllReservations: true }, title: 'ok' })
      .expect(200);

    const stored = await storedUser('viewer.target@test.com');
    expect(stored.isAdmin).toBeUndefined();
    expect(stored.permissions).toBeUndefined();
    expect(stored.title).toBe('ok');
    expect(stored.role).toBe('viewer');
  });

  // ---- Self-protection ----

  test('UMA-10: a caller cannot delete their own account', async () => {
    await request(app)
      .delete(`/api/users/${approverUser._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);
    expect(await storedUser(approverUser.email)).not.toBeNull();

    await request(app)
      .delete(`/api/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  test('UMA-11: an admin cannot lower their own role', async () => {
    const res = await request(app)
      .put(`/api/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'viewer' })
      .expect(403);
    expect(res.body.code).toBe('USER_MANAGEMENT_FORBIDDEN');
    expect((await storedUser(adminUser.email)).role).toBe('admin');
  });

  // ---- Admin unrestricted (regression) ----

  test('UMA-12: admin retains full unrestricted user management', async () => {
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'admin.made@test.com', displayName: 'Admin Made', role: 'admin' })
      .expect(201);

    await request(app)
      .put(`/api/users/${approverTarget._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' })
      .expect(200);

    await request(app)
      .delete(`/api/users/${adminTarget._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  // ---- Lower roles denied (regression) ----

  test('UMA-13: viewer and requester are denied on all user endpoints', async () => {
    for (const token of [viewerToken, requesterToken]) {
      await request(app).get('/api/users').set('Authorization', `Bearer ${token}`).expect(403);
      await request(app).post('/api/users').set('Authorization', `Bearer ${token}`)
        .send({ email: 'x@test.com', role: 'viewer' }).expect(403);
      await request(app).put(`/api/users/${viewerTarget._id}`).set('Authorization', `Bearer ${token}`)
        .send({ title: 'x' }).expect(403);
      await request(app).delete(`/api/users/${viewerTarget._id}`).set('Authorization', `Bearer ${token}`).expect(403);
    }
  });

  // ---- Audit trail ----

  test('UMA-14: create/update/delete each write a user-management audit entry', async () => {
    // create
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ email: 'audited@test.com', displayName: 'Audited', role: 'viewer' })
      .expect(201);
    await eventually(async () => {
      const entry = await db.collection(USER_AUDIT_COLLECTION).findOne({ changeType: 'create', targetEmail: 'audited@test.com' });
      expect(entry).not.toBeNull();
      expect(entry.callerEmail).toBe(approverUser.email);
      expect(entry.callerRole).toBe('approver');
      expect(entry.newRole).toBe('viewer');
    });

    // update (role change is captured old -> new)
    await request(app)
      .put(`/api/users/${viewerTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ role: 'requester' })
      .expect(200);
    await eventually(async () => {
      const entry = await db.collection(USER_AUDIT_COLLECTION).findOne({ changeType: 'update', targetEmail: 'viewer.target@test.com' });
      expect(entry).not.toBeNull();
      expect(entry.oldRole).toBe('viewer');
      expect(entry.newRole).toBe('requester');
    });

    // delete
    await request(app)
      .delete(`/api/users/${requesterTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
    await eventually(async () => {
      const entry = await db.collection(USER_AUDIT_COLLECTION).findOne({ changeType: 'delete', targetEmail: 'requester.target@test.com' });
      expect(entry).not.toBeNull();
      expect(entry.oldRole).toBe('requester');
    });
  });

  // ---- List projection ----

  test('UMA-15: list is approver-accessible and excludes legacy internals, includes effectiveRole', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    const legacy = res.body.find((u) => u.email === 'legacy.admin@test.com');
    expect(legacy).toBeDefined();
    // effectiveRole authoritatively classifies the legacy admin for client-side locking
    expect(legacy.effectiveRole).toBe('admin');
    // raw escalation internals are not leaked
    expect(legacy.isAdmin).toBeUndefined();
    expect(legacy.permissions).toBeUndefined();
    expect(legacy.userId).toBeUndefined();
  });

  // ---- Get-by-email hardening (parity with list / get-by-id) ----

  test('UMA-16: GET /api/users/email requires canManageUsers and returns the hardened read model', async () => {
    const url = `/api/users/email/${encodeURIComponent('legacy.admin@test.com')}`;

    // Lower roles are denied
    await request(app).get(url).set('Authorization', `Bearer ${viewerToken}`).expect(403);
    await request(app).get(url).set('Authorization', `Bearer ${requesterToken}`).expect(403);

    // Approver gets a read model with effectiveRole but no leaked internals
    const res = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
    expect(res.body.email).toBe('legacy.admin@test.com');
    expect(res.body.effectiveRole).toBe('admin');
    expect(res.body.isAdmin).toBeUndefined();
    expect(res.body.permissions).toBeUndefined();
    expect(res.body.userId).toBeUndefined();
  });

  // ---- Email uniqueness on update (parity with create) ----

  test('UMA-17: PUT rejects changing a user email to one another user already owns', async () => {
    // Collide viewerTarget's email with requesterTarget's existing email
    const res = await request(app)
      .put(`/api/users/${viewerTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ email: 'requester.target@test.com' })
      .expect(409);
    expect(res.body.error).toMatch(/already exists/i);
    // Unchanged in the DB
    expect((await storedUser('viewer.target@test.com'))).not.toBeNull();

    // A genuinely-new email still succeeds
    await request(app)
      .put(`/api/users/${viewerTarget._id}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ email: 'moved.viewer@test.com' })
      .expect(200);
    expect(await storedUser('moved.viewer@test.com')).not.toBeNull();
  });
});
