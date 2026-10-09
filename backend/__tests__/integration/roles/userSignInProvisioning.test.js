/**
 * User record created on first sign-in (SIP-1 to SIP-7)
 *
 * The app is single-tenant, so a valid token already proves the person has an
 * Entra account. On the first authenticated load, GET /api/users/current or
 * GET /api/users/me/permissions (whichever arrives first) creates a viewer
 * record so an admin can find the person in User Management and raise their
 * role. Both fire in parallel on a cold load, so this suite installs the
 * PRODUCTION unique indexes (userId, email) and checks the race leaves one
 * record.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

const NEW_OID = '33333333-3333-3333-3333-333333333333';

describe('User record created on first sign-in (SIP-1 to SIP-7)', () => {
  let mongoClient;
  let db;
  let app;
  let users;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('userSignInProvisioning'));
    app = await setupTestApp(db);
    users = db.collection(COLLECTIONS.USERS);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await users.deleteMany({});
    // Mirror production: both userId and email are unique.
    await users.dropIndexes().catch(() => {});
    await users.createIndex({ userId: 1 }, { name: 'userId_1', unique: true });
    await users.createIndex({ email: 1 }, { name: 'email_1', unique: true });
  });

  const tokenFor = (overrides = {}) => createMockToken({
    email: 'new.person@test.com', odataId: NEW_OID, displayName: 'New Person', ...overrides,
  });
  const getCurrent = (token) => request(app).get('/api/users/current').set('Authorization', `Bearer ${token}`);
  const getPermissions = (token) => request(app).get('/api/users/me/permissions').set('Authorization', `Bearer ${token}`);

  test('SIP-1: GET /current for someone with no record creates a viewer record and returns it', async () => {
    const res = await getCurrent(await tokenFor()).expect(200);

    expect(res.body).toMatchObject({ email: 'new.person@test.com', displayName: 'New Person', role: 'viewer' });
    const stored = await users.find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: NEW_OID, email: 'new.person@test.com', role: 'viewer', createdBy: 'sign-in' });
    expect(stored[0].lastLogin).toBeInstanceOf(Date);
  });

  test('SIP-2: GET /me/permissions (every device, phones included) also creates the record', async () => {
    const res = await getPermissions(await tokenFor()).expect(200);

    expect(res.body.role).toBe('viewer');
    expect(await users.countDocuments({ userId: NEW_OID })).toBe(1);
  });

  test('SIP-3: the two parallel first-load requests leave exactly one record', async () => {
    const token = await tokenFor();

    const [current, perms] = await Promise.all([getCurrent(token), getPermissions(token)]);

    expect(current.status).toBe(200);
    expect(perms.status).toBe(200);
    expect(await users.countDocuments({})).toBe(1);
  });

  test('SIP-4: a record an admin created in advance is matched by email, not duplicated, and keeps its role', async () => {
    await users.insertOne({ email: 'new.person@test.com', userId: 'pending:abc', role: 'approver', displayName: 'Admin Set' });

    const res = await getCurrent(await tokenFor()).expect(200);

    expect(res.body.role).toBe('approver');
    const stored = await users.find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: NEW_OID, role: 'approver', displayName: 'Admin Set' });
  });

  test('SIP-5: a role raised after the first sign-in survives the next sign-in', async () => {
    const token = await tokenFor();
    await getCurrent(token).expect(200);
    await users.updateOne({ userId: NEW_OID }, { $set: { role: 'requester' } });

    await getCurrent(token).expect(200);
    const perms = await getPermissions(token).expect(200);

    expect(perms.body.role).toBe('requester');
    expect(await users.countDocuments({})).toBe(1);
  });

  test('SIP-6: a mixed-case sign-in name is stored lowercased, so the email lookup finds it again', async () => {
    await getCurrent(await tokenFor({ email: 'New.Person@Test.com' })).expect(200);

    // Same person, token now without the oid match (simulates the email fallback path).
    await users.updateOne({}, { $set: { userId: 'pending:reset' } });
    await getCurrent(await tokenFor()).expect(200);

    const stored = await users.find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].email).toBe('new.person@test.com');
  });

  test('SIP-7: the existing first-save path (PUT /current) still finds the record instead of inserting a second', async () => {
    const token = await tokenFor();
    await getCurrent(token).expect(200);

    const res = await request(app)
      .put('/api/users/current')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: { defaultView: 'month' } })
      .expect(200);

    expect(res.body.preferences.defaultView).toBe('month');
    expect(await users.countDocuments({})).toBe(1);
  });
});
