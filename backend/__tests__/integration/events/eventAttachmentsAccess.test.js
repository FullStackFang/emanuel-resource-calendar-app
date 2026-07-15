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

  it('ATT-7: requester can download a file on an event they do not own by OID (imported events)', async () => {
    // Production repro: rsched-imported events carry the import CLI's userId,
    // so the legacy { userId, eventId } download scope matches no interactive
    // user — even the requester who uploaded the file got 403 on download.
    const importedEventId = `rssched-${Date.now()}`;
    const imported = createPendingEvent({
      eventId: importedEventId,
      userId: 'rsched-import-cli-oid', // owned by nobody interactive
      requesterEmail: requesterUser.email,
      eventTitle: 'Imported Event Download Test',
    });
    await insertEvents(db, [imported]);

    const upload = await request(app)
      .post(`/api/events/${importedEventId}/attachments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'Intro Floorplan.pdf')
      .expect(201);

    const fileId = upload.body.attachment.fileId;

    const res = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.toString()).toContain('%PDF-1.4');
  });

  it('ATT-8: approver can download a file on another user\'s event', async () => {
    const importedEventId = `rssched-${Date.now()}-b`;
    const imported = createPendingEvent({
      eventId: importedEventId,
      userId: 'rsched-import-cli-oid',
      requesterEmail: requesterUser.email,
      eventTitle: 'Imported Event Approver Download Test',
    });
    await insertEvents(db, [imported]);

    const upload = await request(app)
      .post(`/api/events/${importedEventId}/attachments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'Intro Floorplan.pdf')
      .expect(201);

    await request(app)
      .get(`/api/files/${upload.body.attachment.fileId}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
  });

  it('ATT-9: an unrelated requester cannot download another user\'s event attachment', async () => {
    const importedEventId = `rssched-${Date.now()}-c`;
    const imported = createPendingEvent({
      eventId: importedEventId,
      userId: 'rsched-import-cli-oid',
      requesterEmail: requesterUser.email,
      eventTitle: 'Imported Event Denied Download Test',
    });
    await insertEvents(db, [imported]);

    const upload = await request(app)
      .post(`/api/events/${importedEventId}/attachments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'Intro Floorplan.pdf')
      .expect(201);

    await request(app)
      .get(`/api/files/${upload.body.attachment.fileId}`)
      .set('Authorization', `Bearer ${otherRequesterToken}`)
      .expect(403);
  });

  it('ATT-6: approver whose DB email casing differs from JWT casing can read attachments', async () => {
    // Production repro: templeEvents__Users docs can store mixed-case emails
    // (e.g. 'Daniela.Guitelman@emanuelnyc.org') while verifyToken always
    // lowercases req.user.email from the JWT. The endpoint's case-sensitive
    // findOne({ email }) then misses the user doc, drops the approver role,
    // and denies attachment access with 403.
    const mixedCaseApprover = createApprover({
      email: 'Mixed.Case.Approver@emanuelnyc.org',
      odataId: 'test-mixed-case-approver-oid',
    });
    await insertUsers(db, [mixedCaseApprover]);

    // Token presents the email the way production verifyToken does: lowercased.
    const mixedCaseToken = await createMockToken({
      ...mixedCaseApprover,
      email: mixedCaseApprover.email.toLowerCase(),
    });

    const res = await request(app)
      .get(`/api/events/${reservationEventId}/attachments`)
      .set('Authorization', `Bearer ${mixedCaseToken}`)
      .expect(200);

    expect(res.body.totalCount).toBe(1);
  });
});
