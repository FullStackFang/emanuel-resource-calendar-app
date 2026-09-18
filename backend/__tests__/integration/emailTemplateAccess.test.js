/**
 * Email template access + stale-save guard.
 *
 * openspec/changes/schedule-email-template-editing (D2, D9):
 *   - the five template routes admit approvers (canEditEmailTemplates),
 *     never requesters — not even an Events-department requester, whose
 *     department grants scheduling-sheet access but NOT template editing;
 *   - the three delivery-settings routes stay admin-only;
 *   - PUT accepts an optional expectedUpdatedAt and refuses a stale save
 *     with 409 TEMPLATE_CHANGED instead of overwriting.
 */

const request = require('supertest');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const { createAdmin, createApprover, createRequester, insertUsers } = require('../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');

const SETTINGS = 'templeEvents__SystemSettings';
const TEMPLATE_ID = 'assignment-schedule';
const OVERRIDE_ID = `email-template-${TEMPLATE_ID}`;

describe('Email template access (canEditEmailTemplates)', () => {
  let mongoClient, db, app;
  let adminToken, approverToken, requesterToken, eventsRequesterToken;
  let approver;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('emailTemplateAccess'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection('templeEvents__Users').deleteMany({});
    await db.collection(SETTINGS).deleteMany({});

    const admin = createAdmin();
    approver = createApprover();
    const requester = createRequester();
    const eventsRequester = createRequester({ email: 'events.requester@test.com', department: 'events' });
    await insertUsers(db, [admin, approver, requester, eventsRequester]);
    adminToken = await createMockToken(admin);
    approverToken = await createMockToken(approver);
    requesterToken = await createMockToken(requester);
    eventsRequesterToken = await createMockToken(eventsRequester);
  });

  const auth = (req, token) => req.set('Authorization', `Bearer ${token}`);
  const list = (t) => auth(request(app).get('/api/admin/email/templates'), t);
  const getOne = (t) => auth(request(app).get(`/api/admin/email/templates/${TEMPLATE_ID}`), t);
  const save = (t, body) => auth(request(app).put(`/api/admin/email/templates/${TEMPLATE_ID}`), t).send(body);
  const preview = (t) => auth(request(app).post(`/api/admin/email/templates/${TEMPLATE_ID}/preview`), t).send({});
  const reset = (t) => auth(request(app).post(`/api/admin/email/templates/${TEMPLATE_ID}/reset`), t).send({});
  const body = { subject: 'Your schedule', body: '<p>Hello {{recipientName}}</p>' };

  describe('template routes', () => {
    it('ETA-1: an approver can list, get, save, preview and reset', async () => {
      expect((await list(approverToken)).status).toBe(200);
      expect((await getOne(approverToken)).status).toBe(200);

      const saved = await save(approverToken, body);
      expect(saved.status).toBe(200);
      const stored = await db.collection(SETTINGS).findOne({ _id: OVERRIDE_ID });
      expect(stored.updatedBy).toBe(approver.email);

      expect((await preview(approverToken)).status).toBe(200);
      expect((await reset(approverToken)).status).toBe(200);
      expect(await db.collection(SETTINGS).findOne({ _id: OVERRIDE_ID })).toBeNull();
    });

    it('ETA-2: an admin keeps full access', async () => {
      expect((await list(adminToken)).status).toBe(200);
      expect((await save(adminToken, body)).status).toBe(200);
    });

    it.each([
      ['requester', () => requesterToken],
      ['events-department requester', () => eventsRequesterToken],
    ])('ETA-3: a %s gets 403 on all five and nothing is written', async (_label, tokenOf) => {
      const t = tokenOf();
      expect((await list(t)).status).toBe(403);
      expect((await getOne(t)).status).toBe(403);
      expect((await save(t, body)).status).toBe(403);
      expect((await preview(t)).status).toBe(403);
      expect((await reset(t)).status).toBe(403);
      expect(await db.collection(SETTINGS).findOne({ _id: OVERRIDE_ID })).toBeNull();
    });
  });

  describe('delivery settings stay admin-only', () => {
    it('ETA-4: an approver gets 403 on config, settings and test, and no setting changes', async () => {
      expect((await auth(request(app).get('/api/admin/email/config'), approverToken)).status).toBe(403);
      const put = await auth(request(app).put('/api/admin/email/settings'), approverToken).send({ enabled: false });
      expect(put.status).toBe(403);
      const test = await auth(request(app).post('/api/admin/email/test'), approverToken).send({ to: 'x@test.com' });
      expect(test.status).toBe(403);
      expect(await db.collection(SETTINGS).findOne({ _id: 'email-settings' })).toBeNull();
    });

    it('ETA-5: an admin still reads config', async () => {
      expect((await auth(request(app).get('/api/admin/email/config'), adminToken)).status).toBe(200);
    });
  });

  describe('expectedUpdatedAt precondition (D9)', () => {
    const T1 = new Date('2026-09-01T10:00:00.000Z');
    const T2 = new Date('2026-09-02T10:00:00.000Z');
    const seed = (updatedAt, updatedBy = 'someone.else@test.com') =>
      db.collection(SETTINGS).insertOne({
        _id: OVERRIDE_ID, subject: 'Their subject', body: '<p>Their body</p>', updatedAt, updatedBy,
      });

    it('ETC-1: a stale expectedUpdatedAt is refused with 409 TEMPLATE_CHANGED carrying the current content, and nothing is written', async () => {
      await seed(T2);
      const res = await save(approverToken, { ...body, expectedUpdatedAt: T1.toISOString() });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TEMPLATE_CHANGED');
      expect(res.body.current).toMatchObject({
        subject: 'Their subject', body: '<p>Their body</p>', updatedBy: 'someone.else@test.com',
      });
      expect(new Date(res.body.current.updatedAt).toISOString()).toBe(T2.toISOString());
      const stored = await db.collection(SETTINGS).findOne({ _id: OVERRIDE_ID });
      expect(stored.body).toBe('<p>Their body</p>');
    });

    it('ETC-2: expectedUpdatedAt null while an override now exists is refused', async () => {
      await seed(T2);
      const res = await save(approverToken, { ...body, expectedUpdatedAt: null });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TEMPLATE_CHANGED');
    });

    it('ETC-3: a matching expectedUpdatedAt saves', async () => {
      await seed(T1);
      const res = await save(approverToken, { ...body, expectedUpdatedAt: T1.toISOString() });
      expect(res.status).toBe(200);
      expect((await db.collection(SETTINGS).findOne({ _id: OVERRIDE_ID })).body).toBe(body.body);
    });

    it('ETC-4: expectedUpdatedAt null with no override stored saves', async () => {
      const res = await save(approverToken, { ...body, expectedUpdatedAt: null });
      expect(res.status).toBe(200);
    });

    it('ETC-5: omitting expectedUpdatedAt keeps last-write-wins', async () => {
      await seed(T2);
      const res = await save(approverToken, body);
      expect(res.status).toBe(200);
      expect((await db.collection(SETTINGS).findOne({ _id: OVERRIDE_ID })).body).toBe(body.body);
    });
  });
});
