/**
 * Event Attachments Access Tests (ATT-1 to ATT-5)
 *
 * Regression coverage for the production 404 on
 * GET /api/events/:eventId/attachments. The endpoint formerly scoped the event
 * lookup by the logged-in user's id ({ userId, eventId }), so an admin/approver
 * opening someone else's reservation request in the review modal got a 404.
 * Access is now: event looked up by id, then authorized for staff, the
 * requester (by email), or the owner (by OID).
 *
 * Uses the REAL api-server app via setupTestApp so the actual route + permission
 * gate are exercised (no route mirror that could drift).
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createAdmin, createRequester, createOtherRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPendingEvent, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

const ATTACHMENTS_COLLECTION = 'templeEvents__EventAttachments';

describe('Event Attachments Access (ATT-1 to ATT-5)', () => {
  let mongoClient;
  let db;
  let app;
  let approverToken;
  let adminToken;
  let requesterUser;
  let requesterToken;
  let otherRequesterToken;
  let reservationEventId;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('eventAttachmentsAccess'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(ATTACHMENTS_COLLECTION).deleteMany({});

    const approverUser = createApprover();
    const adminUser = createAdmin();
    requesterUser = createRequester();
    const otherRequester = createOtherRequester();
    await insertUsers(db, [approverUser, adminUser, requesterUser, otherRequester]);

    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
    requesterToken = await createMockToken(requesterUser);
    otherRequesterToken = await createMockToken(otherRequester);

    // A reservation request owned by the requester (userId = requester OID,
    // requestedBy.email = requester email) — the exact shape that 404'd.
    reservationEventId = `evt-request-${Date.now()}-abc123`;
    const event = createPendingEvent({
      eventId: reservationEventId,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Attachment Access Test',
    });
    await insertEvents(db, [event]);

    // Seed one (non-floor-plan) attachment so 200 responses assert the payload.
    await db.collection(ATTACHMENTS_COLLECTION).insertOne({
      eventId: reservationEventId,
      gridfsFileId: new ObjectId(),
      fileName: 'site-plan.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      uploadedBy: requesterUser.odataId,
      uploadedAt: new Date(),
      description: '',
      isFloorPlan: false,
    });
  });

  it('ATT-1: approver can read attachments on another user\'s request (was 404)', async () => {
    const res = await request(app)
      .get(`/api/events/${reservationEventId}/attachments`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.eventId).toBe(reservationEventId);
    expect(res.body.totalCount).toBe(1);
    expect(res.body.attachments[0].fileName).toBe('site-plan.pdf');
  });

  it('ATT-2: admin can read attachments on another user\'s request', async () => {
    const res = await request(app)
      .get(`/api/events/${reservationEventId}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.totalCount).toBe(1);
  });

  it('ATT-3: the requester (owner) can read their own attachments', async () => {
    const res = await request(app)
      .get(`/api/events/${reservationEventId}/attachments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.totalCount).toBe(1);
  });

  it('ATT-4: an unrelated requester is denied (403, not 404)', async () => {
    await request(app)
      .get(`/api/events/${reservationEventId}/attachments`)
      .set('Authorization', `Bearer ${otherRequesterToken}`)
      .expect(403);
  });

  it('ATT-5: a non-existent event returns 404', async () => {
    await request(app)
      .get('/api/events/evt-request-does-not-exist/attachments')
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(404);
  });
});
