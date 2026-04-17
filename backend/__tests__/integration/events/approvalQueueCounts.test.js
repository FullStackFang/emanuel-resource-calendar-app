/**
 * Approval Queue Counts Tests (AQC-1 to AQC-6)
 *
 * Verifies that GET /api/events/list/counts?view=approval-queue returns
 * correct counts that match the events actually returned by the list endpoint.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  createRejectedEvent,
  createDeletedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Approval Queue Counts Tests (AQC-1 to AQC-6)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('approvalQueueCounts'));
    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
  });

  it('AQC-1: returns correct counts for pending events', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 1' }),
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 2' }),
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 3' }),
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(3);
    expect(res.body.all).toBe(3);
  });

  it('AQC-2: returns correct counts for mixed statuses', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending' }),
      createPublishedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Published' }),
      createRejectedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Rejected' }),
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(1);
    expect(res.body.published).toBe(1);
    expect(res.body.rejected).toBe(1);
    expect(res.body.all).toBe(3);
  });

  it('AQC-3: needs_attention = pending + published_edit + published_cancellation', async () => {
    const publishedWithCancel = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Published With Cancel',
    });
    publishedWithCancel.pendingCancellationRequest = {
      status: 'pending',
      requestedBy: requesterUser.email,
      requestedAt: new Date(),
      reason: 'No longer needed',
    };

    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending' }),
      createPublishedEventWithEditRequest({ requesterEmail: requesterUser.email, eventTitle: 'Published With Edit' }),
      publishedWithCancel,
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(1);
    expect(res.body.published_edit).toBe(1);
    expect(res.body.published_cancellation).toBe(1);

    // Frontend computes: needs_attention = pending + published_edit + published_cancellation
    const needsAttention = res.body.pending + res.body.published_edit + res.body.published_cancellation;
    expect(needsAttention).toBe(3);
  });

  it('AQC-4: deleted events are excluded from all counts', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending' }),
      createDeletedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Deleted' }),
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(1);
    expect(res.body.all).toBe(1);
  });

  it('AQC-5: counts match list endpoint results', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 1' }),
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 2' }),
      createPublishedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Published' }),
      createRejectedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Rejected' }),
    ]);

    const [countsRes, listRes] = await Promise.all([
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&limit=1000`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
    ]);

    // counts.all should equal the number of events returned by list (non-deleted)
    expect(countsRes.body.all).toBe(listRes.body.events.length);
  });

  it('AQC-6: published count excludes events with pending edit/cancel requests', async () => {
    const publishedWithCancel = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Published With Cancel',
    });
    publishedWithCancel.pendingCancellationRequest = {
      status: 'pending',
      requestedBy: requesterUser.email,
      requestedAt: new Date(),
      reason: 'No longer needed',
    };

    await insertEvents(db, [
      createPublishedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Plain Published' }),
      createPublishedEventWithEditRequest({ requesterEmail: requesterUser.email, eventTitle: 'Published With Edit' }),
      publishedWithCancel,
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    // published = publishedTotal - published_edit - published_cancellation
    // Only 'Plain Published' should be in the plain published count
    expect(res.body.published).toBe(1);
    expect(res.body.published_edit).toBe(1);
    expect(res.body.published_cancellation).toBe(1);
    // all = pending + publishedTotal + rejected = 0 + 3 + 0
    expect(res.body.all).toBe(3);
  });
});
