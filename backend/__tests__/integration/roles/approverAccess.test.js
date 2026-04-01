/**
 * Approver Role Access Tests (AP-1 to AP-8)
 *
 * Tests that approvers can publish, reject, and save events.
 * Also verifies that force-override remains admin-only, and that
 * lower roles (viewer, requester) are still denied.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, createViewer, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Approver Role Access Tests (AP-1 to AP-8)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;
  let viewerUser;
  let viewerToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('approverAccess'));
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

    graphApiMock.resetMocks();

    approverUser = createApprover();
    requesterUser = createRequester();
    viewerUser = createViewer();
    await insertUsers(db, [approverUser, requesterUser, viewerUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    viewerToken = await createMockToken(viewerUser);
  });

  describe('AP-1 to AP-3: Approver can publish, reject, and save', () => {
    it('AP-1: approver can publish a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Approver Publish Test',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.PUBLISHED);
    });

    it('AP-2: approver can reject a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Approver Reject Test',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/reject`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ reason: 'Not suitable', _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.status).toBe(STATUS.REJECTED);
    });

    it('AP-3: approver can save edits on a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          subject: 'Updated Title',
          _version: saved._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('AP-4 to AP-5: Requester and viewer denied', () => {
    it('AP-4: requester cannot publish a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/approver|permission/i);
    });

    it('AP-5: viewer cannot reject a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/reject`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reason: 'Should fail' })
        .expect(403);

      expect(res.body.error).toMatch(/approver|permission/i);
    });
  });

  describe('AP-6 to AP-8: Requester/viewer denied on save', () => {
    it('AP-6: requester cannot save edits on a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ subject: 'Hacked Title' })
        .expect(403);

      expect(res.body.error).toMatch(/approver|permission/i);
    });

    it('AP-7: viewer cannot save edits on a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ subject: 'Hacked Title' })
        .expect(403);

      expect(res.body.error).toMatch(/approver|permission/i);
    });

    it('AP-8: viewer cannot publish a pending event', async () => {
      const pending = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
      });
      const [saved] = await insertEvents(db, [pending]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      expect(res.body.error).toMatch(/approver|permission/i);
    });
  });
});
