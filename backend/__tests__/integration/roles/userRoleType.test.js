/**
 * User Role Type & Title Tests (URT-1 to URT-10)
 *
 * Tests CRUD for the role types collection and
 * roleType/title fields on user documents.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('User Role Type & Title Tests (URT-1 to URT-10)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('userRoleType'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.ROLE_TYPES).deleteMany({});

    adminUser = createAdmin();
    requesterUser = createRequester();
    [adminUser, requesterUser] = await insertUsers(db, [adminUser, requesterUser]);

    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // ---- Role Types CRUD ----

  test('URT-1: GET /api/role-types returns seeded role types', async () => {
    // Seed some role types
    await db.collection(COLLECTIONS.ROLE_TYPES).insertMany([
      { name: 'None', key: '', description: 'No organizational role', displayOrder: 1, active: true },
      { name: 'Rabbi', key: 'rabbi', description: 'Rabbinical staff', displayOrder: 2, active: true },
      { name: 'Cantor', key: 'cantor', description: 'Cantorial staff', displayOrder: 3, active: true },
    ]);

    const res = await request(app)
      .get('/api/role-types')
      .expect(200);

    expect(res.body).toHaveLength(3);
    expect(res.body[0].key).toBe('');
    expect(res.body[1].key).toBe('rabbi');
    expect(res.body[2].key).toBe('cantor');
  });

  test('URT-2: GET /api/role-types filters inactive by default', async () => {
    await db.collection(COLLECTIONS.ROLE_TYPES).insertMany([
      { name: 'Rabbi', key: 'rabbi', description: 'Rabbinical staff', displayOrder: 1, active: true },
      { name: 'Retired', key: 'retired', description: 'Retired', displayOrder: 2, active: false },
    ]);

    const res = await request(app)
      .get('/api/role-types')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe('rabbi');

    // With active=false, returns all
    const allRes = await request(app)
      .get('/api/role-types?active=false')
      .expect(200);

    expect(allRes.body).toHaveLength(2);
  });

  test('URT-3: POST /api/role-types creates a new role type', async () => {
    const res = await request(app)
      .post('/api/role-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Educator', key: 'educator', description: 'Education staff' })
      .expect(201);

    expect(res.body.name).toBe('Educator');
    expect(res.body.key).toBe('educator');
    expect(res.body.active).toBe(true);
    expect(res.body.displayOrder).toBeDefined();
  });

  test('URT-4: POST /api/role-types rejects duplicate key', async () => {
    await db.collection(COLLECTIONS.ROLE_TYPES).insertOne({
      name: 'Rabbi', key: 'rabbi', description: 'Rabbinical staff', displayOrder: 1, active: true
    });

    await request(app)
      .post('/api/role-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Another Rabbi', key: 'rabbi', description: 'Duplicate' })
      .expect(400);
  });

  test('URT-5: PUT /api/role-types/:id updates a role type', async () => {
    const inserted = await db.collection(COLLECTIONS.ROLE_TYPES).insertOne({
      name: 'Rabbi', key: 'rabbi', description: 'Rabbinical staff', displayOrder: 1, active: true
    });

    const res = await request(app)
      .put(`/api/role-types/${inserted.insertedId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Updated description' })
      .expect(200);

    expect(res.body.description).toBe('Updated description');
    expect(res.body.name).toBe('Rabbi');
  });

  test('URT-6: DELETE /api/role-types/:id deletes a role type', async () => {
    const inserted = await db.collection(COLLECTIONS.ROLE_TYPES).insertOne({
      name: 'Temp', key: 'temp', description: 'Temporary', displayOrder: 1, active: true
    });

    await request(app)
      .delete(`/api/role-types/${inserted.insertedId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const remaining = await db.collection(COLLECTIONS.ROLE_TYPES).countDocuments();
    expect(remaining).toBe(0);
  });

  test('URT-7: DELETE /api/role-types/:id blocks deleting default (empty key)', async () => {
    const inserted = await db.collection(COLLECTIONS.ROLE_TYPES).insertOne({
      name: 'None', key: '', description: 'Default', displayOrder: 1, active: true
    });

    await request(app)
      .delete(`/api/role-types/${inserted.insertedId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  // ---- User roleType & title fields ----

  test('URT-8: PUT /api/users/:id updates roleType and title', async () => {
    const res = await request(app)
      .put(`/api/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleType: 'rabbi', title: 'Senior Rabbi' })
      .expect(200);

    expect(res.body.roleType).toBe('rabbi');
    expect(res.body.title).toBe('Senior Rabbi');
  });

  test('URT-9: POST /api/users creates user with roleType and title', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'newrabbi@emanuelnyc.org',
        displayName: 'New Rabbi',
        userId: 'new-rabbi-user',
        role: 'approver',
        roleType: 'rabbi',
        title: 'Associate Rabbi',
      })
      .expect(201);

    expect(res.body.roleType).toBe('rabbi');
    expect(res.body.title).toBe('Associate Rabbi');
  });

  test('URT-10: roleType and title can be cleared (set to null)', async () => {
    // First set them
    await request(app)
      .put(`/api/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleType: 'rabbi', title: 'Senior Rabbi' })
      .expect(200);

    // Then clear them
    const res = await request(app)
      .put(`/api/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleType: null, title: null })
      .expect(200);

    expect(res.body.roleType).toBeNull();
    expect(res.body.title).toBeNull();
  });
});
