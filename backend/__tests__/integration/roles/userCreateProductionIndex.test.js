/**
 * User creation under the PRODUCTION users indexes (UCI-1 to UCI-2)
 *
 * Production (createUserIndexes in api-server.js) puts a UNIQUE index on
 * `userId`. Users created from the admin screen have no Azure OID yet, so the
 * insert carries no `userId` at all. MongoDB treats a missing indexed field as
 * `null` for uniqueness, so the SECOND admin-created user ever inserted collides
 * with the first (E11000) and the endpoint answers 500.
 *
 * testSetup.js never installs that index, which is why UMA-1 (two creates in a
 * row) passes in CI while the same flow fails on Azure. This suite installs the
 * production index explicitly so the collision is reproduced here.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('User creation under production indexes (UCI-1 to UCI-2)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('userCreateProductionIndex'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    const users = db.collection(COLLECTIONS.USERS);
    await users.deleteMany({});
    // Mirror the production index exactly (api-server.js createUserIndexes).
    await users.dropIndex('userId_unique').catch(() => {});
    await users.createIndex({ userId: 1 }, { name: 'userId_unique', unique: true, background: true });

    adminUser = createAdmin();
    [adminUser] = await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);
  });

  const create = (email) =>
    request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, displayName: email.split('@')[0], role: 'viewer' });

  test('UCI-1: two admin-created users (no Azure OID yet) both get 201', async () => {
    await create('first.person@test.com').expect(201);
    const second = await create('second.person@test.com').expect(201);
    expect(second.body.email).toBe('second.person@test.com');
  });

  test('UCI-2: the provisional userId is stored but never returned to the client', async () => {
    const res = await create('first.person@test.com').expect(201);
    expect(res.body.userId).toBeUndefined();

    const stored = await db.collection(COLLECTIONS.USERS).findOne({ email: 'first.person@test.com' });
    expect(stored.userId).toBe(`pending:${stored._id.toHexString()}`);
  });

  test('UCI-3: first sign-in reconciles the provisional userId to the real Azure oid', async () => {
    await create('first.person@test.com').expect(201);
    await create('second.person@test.com').expect(201);

    // The new person signs in: the JWT carries their real oid and email. The
    // oid lookup misses, the email fallback finds them, and userId is reconciled.
    const firstLoginToken = await createMockToken({
      email: 'second.person@test.com',
      odataId: 'real-oid-second-person',
    });
    await request(app)
      .get('/api/users/current')
      .set('Authorization', `Bearer ${firstLoginToken}`)
      .expect(200);

    const stored = await db.collection(COLLECTIONS.USERS).findOne({ email: 'second.person@test.com' });
    expect(stored.userId).toBe('real-oid-second-person');

    // The other pending user is untouched.
    const other = await db.collection(COLLECTIONS.USERS).findOne({ email: 'first.person@test.com' });
    expect(other.userId).toMatch(/^pending:/);
  });
});
